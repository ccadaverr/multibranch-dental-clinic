<?php

namespace App\Http\Controllers;

use App\Mail\PaymentReceiptMail;
use App\Models\Invoice;
use App\Services\Audit\AuditService;
use App\Services\Billing\BillingDocuments;
use App\Services\Mail\MailDispatcher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\HttpFoundation\Response;

/**
 * Downloads of the same PDFs that are emailed: the invoice (once issued) and its Payment Receipt (once paid). Access follows the
 * invoice's own visibility rule (Invoice::visibleTo): a Patient only their own, Staff their branch scopes, the Owner all.
 * Another person's invoice answers 404, so its existence is not revealed. The file is never cached by the browser.
 */
class BillingDocumentController extends Controller
{
    public function invoice(Request $request, string $invoice, BillingDocuments $documents): Response
    {
        $row = $this->visible($request, $invoice);
        abort_unless(in_array($row->status, ['Issued', 'Paid'], true), 404);

        $response = $this->pdf($documents->invoicePdf($row), BillingDocuments::invoiceFileName($row));
        $response->headers->set('X-Invoice-Id', $row->public_id);
        $response->headers->set('X-Patient-Id', $row->patient->public_id);
        return $response;
    }

    public function receipt(Request $request, string $invoice, BillingDocuments $documents): Response
    {
        $row = $this->visible($request, $invoice);
        $receipt = $row->receipt;
        abort_unless($receipt !== null, 404);

        $response = $this->pdf($documents->receiptPdf($receipt), BillingDocuments::receiptFileName($receipt));
        $response->headers->set('X-Invoice-Id', $row->public_id);
        $response->headers->set('X-Patient-Id', $row->patient->public_id);
        $response->headers->set('X-Receipt-Id', $receipt->public_id);
        return $response;
    }

    public function resendReceipt(Request $request, string $invoice, MailDispatcher $dispatcher, AuditService $audit): JsonResponse
    {
        $request->validate([
            'email' => ['prohibited'],
            'recipient' => ['prohibited'],
            'recipient_email' => ['prohibited'],
            'to' => ['prohibited'],
        ]);

        $row = $this->visible($request, $invoice);
        $receipt = $row->receipt;
        if ($row->status !== 'Paid' || $receipt === null) {
            return response()->json([
                'code' => 'receipt_not_available',
                'message' => 'A receipt can only be resent for a paid invoice.',
            ], 422);
        }

        $row->loadMissing(['patient.person', 'patient.user', 'branch', 'lines']);
        $email = $row->patient?->contactUser()?->email ?? $row->patient?->person?->email;
        if (! $email) {
            return response()->json([
                'code' => 'recipient_email_missing',
                'message' => 'No email address is on file for this patient.',
            ], 422);
        }

        $rateKey = 'resend-receipt:'.$request->user()->id.':'.$row->id;
        if (RateLimiter::tooManyAttempts($rateKey, 3)) {
            $seconds = RateLimiter::availableIn($rateKey);

            return response()->json([
                'code' => 'rate_limited',
                'message' => 'Please wait before requesting another receipt email.',
                'retry_after' => $seconds,
            ], 429, ['Retry-After' => (string) $seconds]);
        }
        RateLimiter::hit($rateKey, 3600);

        $result = $dispatcher->send(
            $email,
            new PaymentReceiptMail($row, $receipt),
            'payment_receipt',
            $request->user(),
            $receipt
        );

        $audit->record([
            'action' => 'billing.receipt_resent',
            'category' => 'financial',
            'severity' => $result['status'] === 'failed' ? 'warning' : 'info',
            'actor' => $request->user(),
            'target' => $row,
            'branch_id' => $row->branch_id,
            'payload' => [
                'invoice_number' => $row->invoice_number,
                'receipt_number' => $receipt->receipt_number,
                'mail_status' => $result['status'],
                'transport_kind' => $result['transport_kind'],
            ],
        ]);

        if ($result['status'] === 'failed') {
            return response()->json([
                'code' => 'mail_send_failed',
                'status' => $result['status'],
                'transport_kind' => $result['transport_kind'],
                'message' => $result['message'],
            ], 502);
        }

        return response()->json([
            'data' => [
                'invoice_id' => $row->public_id,
                'receipt_number' => $receipt->receipt_number,
                'status' => $result['status'],
                'transport_kind' => $result['transport_kind'],
                'message' => $result['message'],
            ],
        ]);
    }

    private function visible(Request $request, string $publicId): Invoice
    {
        return Invoice::visibleTo($request->user())->where('public_id', strtolower($publicId))->firstOrFail();
    }

    private function pdf(string $bytes, string $name): Response
    {
        return response($bytes, 200, ['Content-Type' => 'application/pdf', 'Content-Disposition' => 'attachment; filename="'.$name.'"',
            'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff']);
    }
}

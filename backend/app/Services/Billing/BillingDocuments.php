<?php

namespace App\Services\Billing;

use App\Models\Appointment;
use App\Models\Invoice;
use App\Models\Receipt;
use App\Support\Brand;
use App\Support\ClinicClock;
use Barryvdh\DomPDF\Facade\Pdf;

/**
 * What a Payment Receipt or Invoice shows (decisions 8 and 10), shared by the emails and their PDF copies so both always agree.
 * Read-only: it formats stored records and never changes them. Titles are "Payment Receipt" and "Invoice"; BIR fields appear
 * only when the branch has them filled in.
 */
class BillingDocuments
{
    /** The Patient's saved billing address as printable lines ([] when none). */
    private function billingAddressLines(Invoice $invoice): array
    {
        $a = $invoice->patient?->billing_address;
        if (! is_array($a) || trim((string) ($a['line1'] ?? '')) === '') return [];
        $country = strtoupper((string) ($a['country'] ?? ''));

        return array_values(array_filter([
            $a['line1'] ?? null, $a['line2'] ?? null,
            trim(implode(', ', array_filter([$a['city'] ?? null, trim(($a['state'] ?? '').' '.($a['postal_code'] ?? ''))]))),
            $country === 'PH' ? 'Philippines' : ($country ?: null),
        ], fn ($v) => is_string($v) && trim($v) !== ''));
    }

    /** @return array<string, mixed> shared by both documents */
    private function common(Invoice $invoice): array
    {
        return [
            'patientEmail' => $invoice->patient?->user?->email ?? $invoice->patient?->person?->email,
            'billingAddress' => $this->billingAddressLines($invoice),
            'bookingCredit' => $invoice->bookingCredit(),
            'issuedOn' => Brand::date($invoice->issued_at),
            'subtotal' => Brand::money($invoice->gross_amount),
            'discountShare' => (float) ($invoice->discount_amount ?? 0) > 0 ? Brand::money($invoice->discount_amount) : null,
            'discountType' => $invoice->discount_type,
            'discountIdNumber' => $invoice->discount_id_number,
            'hmoShare' => (float) $invoice->hmo_coverage_amount > 0 ? Brand::money($invoice->hmo_coverage_amount) : null,
            'total' => Brand::money($invoice->patient_responsibility_amount),
            'design' => Brand::design(),
        ];
    }

    /** @return array<string, mixed> */
    public function receipt(Receipt $receipt): array
    {
        $invoice = $receipt->invoice;
        $invoice->loadMissing(['lines', 'branch', 'patient.person', 'patient.user']);
        $balance = $invoice->balance();

        return [
            'invoice' => $invoice, 'receipt' => $receipt, 'branch' => $invoice->branch,
            'patientName' => $this->patientName($invoice, $receipt),
            'amount' => Brand::money($receipt->amount),
            'paidAt' => Brand::dateTime($receipt->issued_at),
            'method' => Brand::paymentMethod($receipt->method),
            'reference' => $receipt->external_reference,
            'referenceShort' => Brand::shortReference($receipt->external_reference),
            'balance' => Brand::money($balance),
            'settled' => (float) $balance <= 0,
            'bir' => Brand::bir($invoice->branch),
            'receiptDate' => Brand::date($receipt->issued_at),
        ] + $this->common($invoice);
    }

    /** @return array<string, mixed> */
    public function invoice(Invoice $invoice): array
    {
        $invoice->loadMissing(['lines', 'branch', 'patient.person', 'patient.user']);
        $balance = $invoice->balance();

        return [
            'invoice' => $invoice, 'branch' => $invoice->branch,
            'patientName' => $this->patientName($invoice),
            'amountDue' => Brand::money($balance),
            'issuedOn' => Brand::date($invoice->issued_at),
            'paid' => $invoice->status === 'Paid' || (float) $balance <= 0,
            'bir' => Brand::bir($invoice->branch),
            'methods' => app(\App\Services\Payment\PayMongoService::class)->acceptedMethodNames(),
        ] + $this->common($invoice);
    }

    public function receiptPdf(Receipt $receipt): string
    {
        return $this->pdf('pdf.payment-receipt', $this->receipt($receipt), 'Payment Receipt '.$receipt->receipt_number);
    }

    public function invoicePdf(Invoice $invoice): string
    {
        return $this->pdf('pdf.invoice', $this->invoice($invoice), 'Invoice '.$invoice->invoice_number);
    }

    public static function receiptFileName(Receipt $receipt): string
    {
        return 'Payment-Receipt-'.preg_replace('/[^A-Za-z0-9-]/', '', $receipt->receipt_number).'.pdf';
    }

    public static function invoiceFileName(Invoice $invoice): string
    {
        return 'Invoice-'.preg_replace('/[^A-Za-z0-9-]/', '', $invoice->invoice_number).'.pdf';
    }

    public function bookingDepositPdf(Appointment $appointment): string
    {
        $appointment->loadMissing(['patient.person', 'patient.user', 'branch', 'service', 'dentist.person']);
        $person = $appointment->patient?->person;
        $depositNumber = 'DEP-'.$appointment->appointment_code;
        $paidAt = $appointment->booking_paid_at ? ClinicClock::local($appointment->booking_paid_at) : ClinicClock::local($appointment->starts_at);

        return $this->documentPdf('pdf.booking-deposit-receipt', [
            'appointment' => $appointment,
            'branch' => $appointment->branch,
            'patientName' => $person ? trim($person->first_name.' '.$person->last_name) : 'Patient',
            'patientEmail' => $appointment->patient?->user?->email ?? $person?->email,
            'depositNumber' => $depositNumber,
            'date' => $paidAt->format('F j, Y'),
            'paidAt' => $paidAt->format('F j, Y \a\t g:i A'),
            'amount' => Brand::money($appointment->booking_fee_php ?? 0),
            'method' => $appointment->booking_payment_method ?: 'PayMongo (Online)',
            'reference' => $appointment->booking_payment_ref,
            'bir' => Brand::bir($appointment->branch),
        ], 'Booking Deposit Receipt '.$depositNumber);
    }

    public static function bookingDepositFileName(Appointment $appointment): string
    {
        return 'Booking-Deposit-Receipt-'.preg_replace('/[^A-Za-z0-9-]/', '', $appointment->appointment_code).'.pdf';
    }

    /** Pages of the marked rows in the last PDF made (pdf-tail, pdf-totals, pdf-end); used by tests to check the totals stay together. */
    public array $lastLayout = [];

    /** Another clinic document (M19 prescription) with the same renderer, header data and page-numbered footer. */
    public function documentPdf(string $view, array $data, string $documentLabel): string
    {
        return $this->pdf($view, $data, $documentLabel);
    }

    private function pdf(string $view, array $data, string $documentLabel): string
    {
        $brand = Brand::forEmail($data['branch'] ?? null);
        $dompdf = $this->render($view, $data, $brand, false, $pages);
        // Keep the totals with the last procedures: if the totals or the note landed on a later page than the second-to-last
        // procedure, render again with a page break before it (the column headings repeat on the new page).
        if (isset($pages['pdf-tail'], $pages['pdf-totals'], $pages['pdf-end']) && max($pages['pdf-totals'], $pages['pdf-end']) > $pages['pdf-tail']) {
            $dompdf = $this->render($view, $data, $brand, true, $pages);
        }
        $this->lastLayout = $pages;
        $this->footer($dompdf, $brand, $documentLabel);

        return (string) $dompdf->output();
    }

    /** One rendering pass; $pages receives the (last) page number of the marked rows. */
    private function render(string $view, array $data, array $brand, bool $breakTail, ?array &$pages): \Dompdf\Dompdf
    {
        $pages = [];
        // No remote fetches: the logo and the wave are data URIs and every style is inline.
        $dompdf = Pdf::setOption(['isRemoteEnabled' => false, 'isFontSubsettingEnabled' => true, 'defaultFont' => 'DejaVu Sans'])
            ->loadView($view, $data + ['brand' => $brand, 'logo' => Brand::logoDataUri(), 'breakTail' => $breakTail,
                'wave' => Brand::design() === 'fresh' ? Brand::dataUri(Brand::wavePath('#eaf5f2', '#ffffff')) : null])
            ->setPaper('a4')->getDomPDF();
        $dompdf->setCallbacks([['event' => 'end_frame', 'f' => function ($frame, $canvas) use (&$pages) {
            $node = $frame->get_node();
            if ($node instanceof \DOMElement && in_array($id = $node->getAttribute('id'), ['pdf-tail', 'pdf-totals', 'pdf-end'], true)) {
                $pages[$id] = max($pages[$id] ?? 0, $canvas->get_page_number());
            }
        }]]);
        $dompdf->render();

        return $dompdf;
    }

    /**
     * The footer on every page, drawn by the renderer after layout so "Page X of Y" is exact (no PHP runs inside the template):
     * a thin rule, the clinic name and contact on the left, the document and page number on the right.
     */
    private function footer(\Dompdf\Dompdf $dompdf, array $brand, string $documentLabel): void
    {
        $canvas = $dompdf->getCanvas();
        $metrics = $dompdf->getFontMetrics();
        $font = $metrics->getFont('DejaVu Sans');
        $size = 7.6;
        $grey = [0.47, 0.53, 0.6];
        $margin = 16 * 72 / 25.4; // 16 mm, the page's side margins
        [$width, $height] = [$canvas->get_width(), $canvas->get_height()];
        $y = $height - 15 * 72 / 25.4; // 15 mm from the bottom edge
        $left = implode('  ·  ', array_filter([$brand['name'], $brand['branch_phone'] ?: $brand['phone'], $brand['email']]));
        $right = $documentLabel.'  ·  Page {PAGE_NUM} of {PAGE_COUNT}';
        $rightWidth = $metrics->getTextWidth(str_replace(['{PAGE_NUM}', '{PAGE_COUNT}'], '9', $right), $font, $size);
        $leftWidth = $metrics->getTextWidth($left, $font, $size);
        $canvas->page_line($margin, $y - 5, $width - $margin, $y - 5, [0.86, 0.89, 0.92], 0.6);
        // When both do not fit on one line, the document label and page number go on a second line.
        $secondLine = $leftWidth + $rightWidth + 24 > $width - 2 * $margin;
        $canvas->page_text($margin, $y, $left, $font, $size, $grey);
        $canvas->page_text($width - $margin - $rightWidth, $secondLine ? $y + 11 : $y, $right, $font, $size, $grey);
    }

    /** The name as it was when the invoice was issued (decision 2); documents from before that snapshot show the current name. */
    private function patientName(Invoice $invoice, ?Receipt $receipt = null): string
    {
        $snapshot = trim((string) ($receipt?->received_from_name ?: $invoice->billed_to_name));
        if ($snapshot !== '') return $snapshot;
        $person = $invoice->patient?->person;

        return trim(($person?->first_name ?? '').' '.($person?->last_name ?? '')) ?: 'Patient';
    }
}

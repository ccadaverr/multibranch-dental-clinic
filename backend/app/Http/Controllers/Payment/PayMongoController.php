<?php

namespace App\Http\Controllers\Payment;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Invoice;
use App\Models\UserBranchScope;
use App\Services\Billing\BillingException;
use App\Services\Payment\PayMongoService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

// Online payment endpoints (M11). Initiation: the Patient who owns the invoice, or Staff within the invoice's authorization branch
// scope; the Owner and Dentist have no payment initiation. The webhook never trusts its caller: it needs a valid signature over the
// raw body, and what it can do is decided by PayMongoService (session binding, provider confirmation, exact amount).
class PayMongoController extends Controller
{
    private const FORBIDDEN_BODY = [
        'success_url', 'cancel_url', 'amount', 'amount_php', 'currency', 'status', 'paid_amount', 'settlement_type', 'provider_status',
        'provider_transaction_id', 'checkout_session_id', 'checkout_url', 'patient_id', 'branch_id', 'invoice_id', 'created_by', 'paid_by',
    ];

    public function __construct(private readonly PayMongoService $payMongoService) {}

    private function mayPay($user, Invoice $invoice): bool
    {
        return match ($user->role) {
            // A guardian pays for a dependent (intake, R2-12).
            Role::Patient => $user->patient !== null && in_array($invoice->patient_id, \App\Services\Intake\Guardianship::patientIdsFor($user), true),
            Role::Staff => UserBranchScope::where('user_id', $user->id)->where('branch_id', $invoice->branch_id)->exists(),
            default => false, // Owner and Dentist: no payment initiation
        };
    }

    /** GET /api/invoices/{invoice}/payment-options — what the Review and Pay page needs: accepted methods and the address prefill. */
    public function options(Request $request, string $invoice): JsonResponse
    {
        $user = $request->user();
        abort_unless(in_array($user->role, [Role::Patient, Role::Staff], true), 403);
        $invoice = Invoice::visibleTo($user)->where('public_id', strtolower($invoice))->first();
        abort_unless($invoice && $this->mayPay($user, $invoice), 404, 'Invoice not found.');
        $patient = $invoice->patient()->with('person')->first();
        $saved = is_array($patient?->billing_address) ? array_intersect_key($patient->billing_address, array_flip(PayMongoService::ADDRESS_KEYS)) : null;
        // Without a saved address, the free-text profile address is offered as line 1 for the Patient to complete (never sent unseen).
        $prefill = $saved ?: ($patient?->person?->address ? ['line1' => mb_substr($patient->person->address, 0, 255), 'country' => 'PH'] : ['country' => 'PH']);

        return response()->json(['data' => [
            'methods' => $this->payMongoService->acceptedMethodNames(),
            'billing_address' => array_merge(array_fill_keys(PayMongoService::ADDRESS_KEYS, ''), $prefill),
            'billing_address_saved' => (bool) $saved,
            'can_save_billing_address' => $user->role === Role::Patient,
        ]]);
    }

    /** POST /api/invoices/{invoice}/paymongo-checkout */
    public function checkout(Request $request, Invoice $invoice): JsonResponse
    {
        $user = $request->user();
        if (! $this->mayPay($user, $invoice)) {
            return response()->json(['message' => 'You are not authorized to pay for this invoice.'], 403);
        }
        // The return URLs and every money field are chosen by the server; supplying one is refused, not ignored.
        $request->validate(array_fill_keys(self::FORBIDDEN_BODY, ['prohibited']) + [
            // Decision 9: optional. When given, it is complete (PayMongo's own form asks for these) and uses PayMongo's keys.
            'billing_address' => ['sometimes', 'nullable', 'array:'.implode(',', PayMongoService::ADDRESS_KEYS)],
            'billing_address.line1' => ['required_with:billing_address', 'string', 'max:255'],
            'billing_address.line2' => ['nullable', 'string', 'max:255'],
            'billing_address.city' => ['required_with:billing_address', 'string', 'max:100'],
            'billing_address.state' => ['required_with:billing_address', 'string', 'max:100'],
            'billing_address.postal_code' => ['required_with:billing_address', 'string', 'max:20', 'regex:/^[A-Za-z0-9 -]+$/'],
            'billing_address.country' => ['required_with:billing_address', 'string', 'regex:/^[A-Za-z]{2}$/'],
            'save_billing_address' => ['sometimes', 'boolean'],
        ]);
        $address = $request->input('billing_address');
        if (is_array($address)) {
            $address = array_map(fn ($v) => trim((string) $v), array_merge(array_fill_keys(PayMongoService::ADDRESS_KEYS, ''), $address));
            $address['country'] = strtoupper($address['country']);
        }

        try {
            return response()->json(['data' => $this->payMongoService->createCheckoutSession($invoice, $user, is_array($address) ? $address : null, $request->boolean('save_billing_address'))]);
        } catch (BillingException $e) {
            return response()->json($e->responseBody(), $e->getStatusCode());
        }
    }

    /** POST /api/webhooks/paymongo — public; signature-verified. */
    public function webhook(Request $request): JsonResponse
    {
        try {
            if (! $this->payMongoService->verifyWebhookSignature($request->getContent(), $request->header('Paymongo-Signature'))) {
                return response()->json(['message' => 'Invalid or missing webhook signature.'], 400);
            }
            $payload = json_decode($request->getContent(), true);
            if (! is_array($payload)) {
                return response()->json(['message' => 'Malformed event.'], 400);
            }
            if (! $this->payMongoService->eventMatchesMode($payload)) {
                // A correctly signed event for the other mode (test vs live) is never processed by this endpoint.
                return response()->json(['message' => 'Event mode does not match this endpoint.'], 400);
            }
            $result = $this->payMongoService->handleEvent($payload);

            return response()->json(['received' => $result['http'] < 300, 'status' => $result['status']], $result['http']);
        } catch (BillingException $e) {
            // 503 (not configured) must be visible to the operator and retried by the provider; other refusals are permanent.
            return response()->json(['received' => false, 'code' => $e->getCode(), 'message' => $e->getMessage()], $e->getStatusCode());
        } catch (\Throwable $e) {
            report($e);

            return response()->json(['received' => false, 'message' => 'The event could not be processed. It will be retried.'], 500);
        }
    }
}

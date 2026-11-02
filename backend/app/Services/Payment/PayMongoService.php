<?php

namespace App\Services\Payment;

use App\Models\Appointment;
use App\Models\Invoice;
use App\Models\PaymentCheckoutSession;
use App\Models\PaymentProviderEvent;
use App\Models\User;
use App\Services\Audit\AuditService;
use App\Services\Billing\BillingException;
use App\Services\Billing\BillingService;
use App\Support\ClinicClock;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

// PayMongo hosted-checkout integration for M11.
//
// What this class guarantees (technical, and covered by tests):
//   * credentials come only from server configuration; a missing key or webhook secret fails closed — there is no simulated or
//     "test" fallback, no placeholder secret and no signature bypass;
//   * the browser is never proof of payment: only a signature-verified provider event, bound to a checkout session THIS server
//     created for THAT invoice, and confirmed by asking the provider directly, can settle an invoice;
//   * the amount captured must equal the server's current balance exactly (integer centavos, never a float);
//   * every verified event is stored by its provider event id before it is acted on, so a duplicate delivery is harmless and a
//     captured payment that cannot be applied stays on record as "Needs review" instead of vanishing.
//
// DOCUMENTATION COMPATIBILITY (checked against docs.paymongo.com): Hosted Checkout is created with POST /v2/checkout_sessions (the
// recommended version for new integrations) using HTTP Basic auth with the secret key and integer-centavo PHP line items;
// the paid event is checkout_session.payment.paid; a session is read back with GET /v1/checkout_sessions/{id}, whose
// data.attributes.payments[] carry id, status, amount and currency; the webhook header is `t=<timestamp>,te=<test>,li=<live>` and
// the signature is HMAC-SHA256 over "<t>.<raw request body>" with the endpoint secret, `te` for test mode and `li` for live mode,
// compared in constant time.
// LIVE TEST-MODE CHECK (October 14, 2026, docs/PAYMENT_LIVE_TEST.md): a v2-created session IS readable with GET /v1/checkout_sessions
// /{id}; the paid event arrived signed as documented and settled the invoice. Live mode has not been run. The payment methods a
// merchant may offer depend on its PayMongo account, so they are configured explicitly (no default list) and must be documented
// method names.
class PayMongoService
{
    public const PAID_EVENT = 'checkout_session.payment.paid';

    public const CURRENCY = 'PHP';

    /** The payment_method_types PayMongo documents for Checkout; anything else is a configuration error, never sent. */
    public const ALLOWED_METHODS = ['shopee_pay', 'qrph', 'billease', 'card', 'dob', 'dob_ubp', 'brankas_bdo', 'brankas_landbank', 'brankas_metrobank', 'gcash', 'grab_pay', 'paymaya'];

    /** Stored with the payment as "PayMongo (<LABEL>)"; shown to people in plain words by App\Support\Brand::paymentMethod(). */
    private const METHOD_LABELS = ['gcash' => 'GCASH', 'paymaya' => 'MAYA', 'card' => 'CARD', 'grab_pay' => 'GRABPAY', 'shopee_pay' => 'SHOPEEPAY', 'billease' => 'BILLEASE',
        'dob' => 'ONLINE BANKING', 'dob_ubp' => 'ONLINE BANKING', 'brankas_bdo' => 'ONLINE BANKING', 'brankas_landbank' => 'ONLINE BANKING', 'brankas_metrobank' => 'ONLINE BANKING', 'qrph' => 'QR PH'];

    /** PayMongo's documented minimum amount (PHP 1.00). A smaller balance is refused here instead of by the provider. */
    public const MIN_CENTAVOS = 100;

    /** PayMongo's documented limit for a line item's name and description. */
    private const TEXT_LIMIT = 255;

    public const ADDRESS_KEYS = ['line1', 'line2', 'city', 'state', 'postal_code', 'country'];

    public function __construct(private readonly BillingService $billing, private readonly AuditService $audit) {}

    private function secretKey(): string
    {
        return $this->required('services.paymongo.secret_key');
    }

    private function webhookSecret(): string
    {
        return $this->required('services.paymongo.webhook_secret');
    }

    private function host(): string
    {
        // PAYMONGO_BASE_URL is the API host; a trailing /v1 or /v2 left over from older configuration is ignored.
        return preg_replace('#/v\d+$#', '', rtrim((string) config('services.paymongo.base_url', 'https://api.paymongo.com'), '/'));
    }

    /** True for a live-mode endpoint. The mode is configured explicitly and must agree with the key's own prefix. */
    private function live(): bool
    {
        $mode = $this->required('services.paymongo.mode');
        $key = $this->secretKey();
        if (! in_array($mode, ['test', 'live'], true) || ($mode === 'live') === str_starts_with($key, 'sk_test_') || ($mode === 'test') === str_starts_with($key, 'sk_live_')) {
            throw new BillingException(503, 'payment_not_configured', 'Online payment is not configured on this server.');
        }

        return $mode === 'live';
    }

    /** @return list<string> */
    private function paymentMethodTypes(): array
    {
        $configured = config('services.paymongo.payment_method_types');
        $types = is_array($configured) ? $configured : (is_string($configured) ? explode(',', $configured) : []);
        $types = array_values(array_unique(array_filter(array_map(fn ($t) => strtolower(trim((string) $t)), $types), fn ($t) => $t !== '')));
        if (! $types || array_diff($types, self::ALLOWED_METHODS)) {
            // An undocumented method name would make PayMongo refuse every checkout; it is reported as a configuration error.
            // The methods a merchant may accept depend on its PayMongo account; none are assumed.
            throw new BillingException(503, 'payment_not_configured', 'Online payment methods are not configured on this server.');
        }

        return $types;
    }

    /** A missing credential is an explicit configuration error, never a silent default. */
    private function required(string $key): string
    {
        $value = config($key);
        if (! is_string($value) || trim($value) === '') {
            throw new BillingException(503, 'payment_not_configured', 'Online payment is not configured on this server.');
        }

        return $value;
    }

    // ---- checkout ---------------------------------------------------------------------------------------------------

    /** The configured payment methods in plain words for the Review and Pay page ([] when online payment is not configured). */
    public function acceptedMethodNames(): array
    {
        try {
            $this->secretKey();
            $this->live();
            $this->webhookSecret();
            $types = $this->paymentMethodTypes();
        } catch (BillingException) {
            return [];
        }

        return array_values(array_unique(array_map(fn ($t) => \App\Support\Brand::paymentMethod('PayMongo ('.self::METHOD_LABELS[$t].')'), $types)));
    }

    /** True when online payment credentials and methods are configured on this server. */
    public function isConfigured(): bool
    {
        return ! empty($this->acceptedMethodNames());
    }

    /**
     * What PayMongo is asked to show: one line per performed procedure when the procedures add up to exactly the amount due (no
     * HMO share, no earlier payment), otherwise one "Balance due" line whose description carries the breakdown. Integer centavos.
     *
     * @return array{0: list<array<string, mixed>>, 1: 'itemized'|'single'}
     */
    public function lineItems(Invoice $invoice, int $centavos): array
    {
        $lines = $invoice->relationLoaded('lines') ? $invoice->lines : $invoice->lines()->get();
        $items = [];
        $sum = 0;
        foreach ($lines as $line) {
            $unit = $this->billing->centavos((string) $line->unit_price);
            $qty = (int) $line->quantity;
            if ($qty < 1 || $unit < 1 || $unit * $qty !== $this->billing->centavos((string) $line->line_total)) {
                $items = null;
                break;
            }
            $items[] = ['name' => $this->limit((string) $line->service_name), 'amount' => $unit, 'currency' => self::CURRENCY, 'quantity' => $qty];
            $sum += $unit * $qty;
        }
        if ($items && $sum === $centavos) {
            return [$items, 'itemized'];
        }
        $parts = ['Charges '.$this->peso((string) $invoice->gross_amount)];
        if ((float) $invoice->hmo_coverage_amount > 0) $parts[] = 'Less coverage -'.$this->peso((string) $invoice->hmo_coverage_amount);
        if ((float) $invoice->paid_amount > 0) $parts[] = 'Already paid -'.$this->peso((string) $invoice->paid_amount);
        $parts[] = 'Balance due '.$this->peso(number_format($centavos / 100, 2, '.', ''));

        return [[[
            'name' => $this->limit("Balance due for Invoice {$invoice->invoice_number}"),
            'description' => $this->limit(implode('; ', $parts)),
            'amount' => $centavos, 'currency' => self::CURRENCY, 'quantity' => 1,
        ]], 'single'];
    }

    /**
     * Creates a hosted checkout session for the invoice's exact current balance and records it. The return URLs are built by the
     * server from the configured SPA origin; a client cannot choose where the provider sends the browser. A provider failure is an
     * explicit error — never a simulated session. $address is an optional, already-validated structured billing address
     * (ADDRESS_KEYS); with $saveAddress the Patient who owns the invoice keeps it on their profile.
     */
    public function createCheckoutSession(Invoice $invoice, User $actor, ?array $address = null, bool $saveAddress = false): array
    {
        $secret = $this->secretKey();
        $this->live(); // mode/key consistency is checked before anything is sent
        $methods = $this->paymentMethodTypes();
        // Serialized per invoice: a second initiation (double click, retry, two tabs) waits here and then sees the first one's session.
        return DB::transaction(function () use ($invoice, $actor, $secret, $methods, $address, $saveAddress) {
            $invoice = Invoice::whereKey($invoice->id)->lockForUpdate()->firstOrFail();
            $invoice->loadMissing(['patient.person', 'patient.user', 'branch', 'lines']);
            $balance = $this->billing->payableBalance($invoice); // refuses Paid, non-Issued and HMO-held invoices
            $centavos = $this->billing->centavos($balance);
            if ($centavos < self::MIN_CENTAVOS) {
                throw new BillingException(422, 'amount_below_minimum', 'Online payment needs a balance of at least PHP 1.00. Please settle this balance at the clinic.');
            }
            // Saved back to the profile only when ticked, and only by the Patient who owns the invoice (Staff never change it here).
            if ($saveAddress && $address && $actor->role === \App\Enums\Role::Patient && $actor->patient?->id === $invoice->patient_id) {
                $invoice->patient->forceFill(['billing_address' => $address])->save();
            }

            $frontend = \App\Support\Brand::frontendUrl();
            $billing = array_filter([
                'name' => trim(($invoice->patient?->person?->first_name ?? '').' '.($invoice->patient?->person?->last_name ?? '')) ?: null,
                // Only a real address: a placeholder would send the provider's messages to a stranger.
                'email' => $invoice->patient?->user?->email ?? $invoice->patient?->person?->email,
                'phone' => $invoice->patient?->person?->phone,
                'address' => $address ? array_filter($address, fn ($v) => $v !== null && $v !== '') : null,
            ]);
            [$lineItems, $mode] = $this->lineItems($invoice, $centavos);
            $returnTo = fn (string $status) => "{$frontend}/?invoice={$invoice->public_id}&payment={$status}#sign-in";
            $attributes = [
                'line_items' => $lineItems,
                'payment_method_types' => $methods,
                'description' => $this->limit("Invoice {$invoice->invoice_number} - ".\App\Support\Brand::name()),
                'reference_number' => $invoice->public_id,
                // Our own branded Payment Receipt is the only receipt the Patient gets (answer 7).
                'send_email_receipt' => false,
                'show_description' => true, 'show_line_items' => true,
                'success_url' => $returnTo('success'),
                'cancel_url' => $returnTo('cancelled'),
                'metadata' => ['invoice_public_id' => $invoice->public_id, 'invoice_number' => $invoice->invoice_number],
            ];
            if ($billing) {
                $attributes['billing'] = $billing;
            }
            $fingerprint = hash('sha256', json_encode([$balance, $attributes]));

            $existing = PaymentCheckoutSession::where('invoice_id', $invoice->id)->where('status', 'Open')->first();
            if ($existing && $existing->checkout_url && (string) $existing->amount === (string) $balance && $existing->request_fingerprint === $fingerprint) {
                // Same invoice, same balance, same details: the same hosted page is returned; no second payable opportunity is created.
                return ['checkout_session_id' => $existing->provider_session_id, 'checkout_url' => $existing->checkout_url, 'reference_number' => $invoice->public_id, 'amount_php' => $balance, 'line_items_mode' => $mode];
            }
            if ($existing) {
                // The balance or the details changed: the old session can no longer settle this invoice. It is retired here and
                // expired at PayMongo so its page stops taking payments.
                $existing->update(['status' => 'Superseded']);
                $this->expireAtProvider($existing, $secret);
            }

            // The same request (same invoice, same details, same attempt number) carries the same key, so a retry after a lost
            // response returns the session PayMongo already made instead of creating a second one.
            $attempt = PaymentCheckoutSession::where('invoice_id', $invoice->id)->count();
            $idempotencyKey = 'checkout-'.substr(hash('sha256', $invoice->public_id.'|'.$fingerprint.'|'.$attempt), 0, 48);
            try {
                $response = Http::withBasicAuth($secret, '')->acceptJson()->asJson()->timeout(15)->withHeaders(['Idempotency-Key' => $idempotencyKey])
                    ->post($this->host().'/v2/checkout_sessions', ['data' => ['attributes' => $attributes]]);
            } catch (ConnectionException) {
                throw new BillingException(502, 'payment_gateway_unavailable', 'The payment provider could not be reached. No payment was started.');
            }
            if (! $response->successful()) {
                report(new \RuntimeException('PayMongo checkout creation refused with HTTP '.$response->status()));
                throw new BillingException(502, 'payment_gateway_error', 'The payment provider could not start this payment. No payment was started.');
            }
            $sessionId = $response->json('data.id');
            $checkoutUrl = $response->json('data.attributes.checkout_url');
            $reportedLive = $response->json('data.attributes.livemode');
            if (is_bool($reportedLive) && $reportedLive !== $this->live()) {
                throw new BillingException(502, 'payment_gateway_invalid_response', 'The payment provider answered for a different mode than this server is configured for. No payment was started.');
            }
            if (! is_string($sessionId) || $sessionId === '' || ! is_string($checkoutUrl) || ! str_starts_with($checkoutUrl, 'https://')) {
                throw new BillingException(502, 'payment_gateway_invalid_response', 'The payment provider returned an unusable response. No payment was started.');
            }

            PaymentCheckoutSession::create([
                'invoice_id' => $invoice->id, 'provider_session_id' => $sessionId, 'checkout_url' => $checkoutUrl, 'amount' => $balance, 'currency' => self::CURRENCY,
                'status' => 'Open', 'initiated_by_user_id' => $actor->id, 'request_fingerprint' => $fingerprint,
            ]);

            return ['checkout_session_id' => $sessionId, 'checkout_url' => $checkoutUrl, 'reference_number' => $invoice->public_id, 'amount_php' => $balance, 'line_items_mode' => $mode];
        });
    }

    /**
     * Checks open checkout sessions against PayMongo directly (useful when webhooks are delayed or in local development).
     */
    public function syncSessionForInvoice(Invoice $invoice): ?Invoice
    {
        if ($invoice->status === 'Paid') {
            return $invoice;
        }

        $session = PaymentCheckoutSession::where('invoice_id', $invoice->id)->where('status', 'Open')->latest('id')->first();
        if (! $session) {
            return null;
        }

        try {
            $paid = $this->confirmWithProvider($session, []);
        } catch (\Throwable) {
            return null;
        }

        if (! is_array($paid)) {
            return null;
        }

        if ($paid['currency'] !== self::CURRENCY || $paid['centavos'] !== $this->billing->centavos((string) $session->amount)) {
            return null;
        }

        return DB::transaction(function () use ($session, $paid) {
            $invoice = $session->invoice()->lockForUpdate()->firstOrFail();
            if ($invoice->status === 'Paid') {
                return $invoice;
            }

            $settled = $this->billing->payOnline(
                $invoice,
                'PayMongo ('.(self::METHOD_LABELS[$paid['method']] ?? 'ONLINE').')',
                $paid['id'],
                $session->initiatedBy()->firstOrFail(),
                (string) $session->amount
            );
            $session->update(['status' => 'Settled']);

            return $settled;
        });
    }

    /**
     * Checks open checkout sessions against PayMongo directly for an appointment booking
     * (crucial for local development where webhooks cannot reach localhost, and when webhooks are delayed).
     */
    public function syncSessionForAppointment(Appointment $appointment): ?Appointment
    {
        if ($appointment->booking_payment_status === 'paid') {
            return $appointment;
        }

        $session = PaymentCheckoutSession::where('appointment_id', $appointment->id)->where('status', 'Open')->latest('id')->first();
        if (! $session) {
            return null;
        }

        try {
            $paid = $this->confirmWithProvider($session, []);
        } catch (\Throwable) {
            return null;
        }

        if (! is_array($paid)) {
            return null;
        }

        if ($paid['currency'] !== self::CURRENCY || $paid['centavos'] !== $this->billing->centavos((string) $session->amount)) {
            return null;
        }

        return DB::transaction(function () use ($session, $paid) {
            $appointment = $session->appointment()->lockForUpdate()->firstOrFail();
            if ($appointment->booking_payment_status === 'paid') {
                return $appointment;
            }
            if ($appointment->booking_payment_ref) {
                return $appointment->booking_payment_ref === $paid['id'] ? $appointment : null;
            }
            if (! in_array($appointment->status, ['Pending', 'Confirmed'], true) || $session->fresh()?->status !== 'Open') {
                return null;
            }

            $from = $appointment->status;
            $method = 'PayMongo ('.(self::METHOD_LABELS[$paid['method']] ?? 'ONLINE').')';
            $appointment->update([
                'status' => 'Confirmed',
                'booking_payment_status' => 'paid',
                'booking_payment_method' => $method,
                'booking_payment_ref' => $paid['id'],
                'booking_paid_at' => ClinicClock::now(),
                'booking_hold_expires_at' => null,
                'revision' => $appointment->revision + 1,
            ]);

            app(\App\Services\Appointments\AppointmentService::class)->record($appointment, null, 'appointment.booking_paid', $from);
            \App\Services\Automations\FillFreedSlots::claimByBooking($appointment);
            \App\Services\Followups\Followups::booked($appointment);

            try {
                app(\App\Services\Mail\MailOutbox::class)->queue(
                    'appointment_confirmation',
                    "appointment_confirmation:{$appointment->public_id}:r{$appointment->revision}",
                    $appointment,
                    $appointment->revision,
                    $appointment->patient?->contactUser(),
                    null
                );
            } catch (\Throwable $e) {
                report($e);
            }
            app(\App\Services\Notifications\NotificationCenter::class)->appointment($appointment, 'appointment_confirmation');

            $this->audit->record([
                'action' => 'billing.booking_payment_received',
                'category' => 'financial',
                'severity' => 'info',
                'actor' => null,
                'target' => $appointment,
                'branch_id' => $appointment->branch_id,
                'payload' => [
                    'appointment_code' => $appointment->appointment_code,
                    'amount' => (string) $session->amount,
                    'method' => $method,
                    'provider_payment_id' => $paid['id'],
                ],
            ]);

            $session->update(['status' => 'Settled']);

            return $appointment;
        });
    }

    /**
     * Creates a hosted checkout session for an appointment booking fee (Section 22.3).
     * The slot is held as Pending during checkout; verified provider reconciliation (webhook or polling) confirms it.
     */
    public function createAppointmentCheckoutSession(Appointment $appointment, User $actor, ?array $address = null): array
    {
        $secret = $this->secretKey();
        $this->live();
        $methods = $this->paymentMethodTypes();

        return DB::transaction(function () use ($appointment, $actor, $secret, $methods, $address) {
            $appointment = Appointment::whereKey($appointment->id)->lockForUpdate()->firstOrFail();
            $appointment->loadMissing(['patient.person', 'patient.user', 'branch', 'service']);

            $fee = $appointment->booking_fee_php;
            if ($fee === null || (float) $fee <= 0) {
                $targetService = $appointment->service;
                if ($targetService->online_booking === 'consultation_first' && $targetService->consultation_service_id) {
                    $targetService = \App\Models\Service::find($targetService->consultation_service_id) ?? $targetService;
                }
                $date = ClinicClock::local($appointment->starts_at)->toDateString();
                $resolved = app(\App\Services\Pricing\PriceResolver::class)->resolve($targetService, $appointment->branch, $date);
                $fee = ($resolved instanceof \App\Services\Pricing\ResolvedPrice)
                    ? $resolved->amount()
                    : null;
                $appointment->booking_fee_php = $fee;
            }
            if ($fee === null) {
                throw new BillingException(422, 'booking_price_unavailable', 'Online payment is unavailable because no confirmed booking price applies. Please contact the clinic.');
            }

            $centavos = $this->billing->centavos((string) $fee);
            if ($centavos < self::MIN_CENTAVOS) {
                throw new BillingException(422, 'amount_below_minimum', 'Online payment needs an amount of at least PHP 1.00.');
            }

            $frontend = \App\Support\Brand::frontendUrl();
            $billing = array_filter([
                'name' => trim(($appointment->patient?->person?->first_name ?? '').' '.($appointment->patient?->person?->last_name ?? '')) ?: null,
                'email' => $appointment->patient?->user?->email ?? $appointment->patient?->person?->email,
                'phone' => $appointment->patient?->person?->phone,
                'address' => $address ? array_filter($address, fn ($v) => $v !== null && $v !== '') : ($appointment->patient?->billing_address ? array_filter($appointment->patient->billing_address, fn ($v) => $v !== null && $v !== '') : null),
            ]);

            $lineItems = [[
                'name' => $this->limit("{$appointment->service->name} Appointment Fee"),
                'description' => $this->limit("Appointment {$appointment->appointment_code} at {$appointment->branch->name}"),
                'amount' => $centavos,
                'currency' => self::CURRENCY,
                'quantity' => 1,
            ]];

            $returnTo = fn (string $status) => "{$frontend}/?appointment={$appointment->public_id}&payment={$status}";
            $attributes = [
                'line_items' => $lineItems,
                'payment_method_types' => $methods,
                'description' => $this->limit("Appointment {$appointment->appointment_code} - ".\App\Support\Brand::name()),
                'reference_number' => $appointment->public_id,
                'send_email_receipt' => false,
                'show_description' => true,
                'show_line_items' => true,
                'success_url' => $returnTo('success'),
                'cancel_url' => $returnTo('cancelled'),
                'metadata' => [
                    'appointment_public_id' => $appointment->public_id,
                    'appointment_code' => $appointment->appointment_code,
                    'type' => 'appointment_booking',
                ],
            ];
            if ($billing) {
                $attributes['billing'] = $billing;
            }
            $fingerprint = hash('sha256', json_encode([(string) $fee, $attributes]));

            $existing = PaymentCheckoutSession::where('appointment_id', $appointment->id)->where('status', 'Open')->first();
            if ($existing && $existing->checkout_url && (string) $existing->amount === (string) $fee && $existing->request_fingerprint === $fingerprint) {
                return [
                    'checkout_session_id' => $existing->provider_session_id,
                    'checkout_url' => $existing->checkout_url,
                    'reference_number' => $appointment->public_id,
                    'amount_php' => (string) $fee,
                ];
            }
            if ($existing) {
                $existing->update(['status' => 'Superseded']);
                $this->expireAtProvider($existing, $secret);
            }

            $attempt = PaymentCheckoutSession::where('appointment_id', $appointment->id)->count();
            $idempotencyKey = 'checkout-apt-'.substr(hash('sha256', $appointment->public_id.'|'.$fingerprint.'|'.$attempt), 0, 44);
            try {
                $response = Http::withBasicAuth($secret, '')->acceptJson()->asJson()->timeout(15)->withHeaders(['Idempotency-Key' => $idempotencyKey])
                    ->post($this->host().'/v2/checkout_sessions', ['data' => ['attributes' => $attributes]]);
            } catch (ConnectionException) {
                throw new BillingException(502, 'payment_gateway_unavailable', 'The payment provider could not be reached. No payment was started.');
            }
            if (! $response->successful()) {
                report(new \RuntimeException('PayMongo appointment checkout creation refused with HTTP '.$response->status()));
                throw new BillingException(502, 'payment_gateway_error', 'The payment provider could not start this payment. No payment was started.');
            }

            $sessionId = $response->json('data.id');
            $checkoutUrl = $response->json('data.attributes.checkout_url');
            $reportedLive = $response->json('data.attributes.livemode');
            if (is_bool($reportedLive) && $reportedLive !== $this->live()) {
                throw new BillingException(502, 'payment_gateway_invalid_response', 'The payment provider answered for a different mode than this server is configured for. No payment was started.');
            }
            if (! is_string($sessionId) || $sessionId === '' || ! is_string($checkoutUrl) || ! str_starts_with($checkoutUrl, 'https://')) {
                throw new BillingException(502, 'payment_gateway_invalid_response', 'The payment provider returned an unusable response. No payment was started.');
            }

            PaymentCheckoutSession::create([
                'appointment_id' => $appointment->id,
                'provider_session_id' => $sessionId,
                'checkout_url' => $checkoutUrl,
                'amount' => $fee,
                'currency' => self::CURRENCY,
                'status' => 'Open',
                'initiated_by_user_id' => $actor->id,
                'request_fingerprint' => $fingerprint,
            ]);

            $appointment->update([
                'booking_fee_php' => $fee,
                'booking_payment_status' => 'held',
                'booking_hold_expires_at' => ClinicClock::now()->addMinutes(15),
            ]);

            return [
                'checkout_session_id' => $sessionId,
                'checkout_url' => $checkoutUrl,
                'reference_number' => $appointment->public_id,
                'amount_php' => (string) $fee,
            ];
        });
    }

    /**
     * Refunds an appointment booking payment (Section 22.3).
     * Used automatically for cancellations >= 24h, or manually by front desk.
     */
    public function refundAppointment(Appointment $appointment, string $reason = 'requested_by_customer'): array
    {
        $secret = $this->secretKey();
        $this->live();

        if (! $appointment->booking_payment_ref || ! in_array($appointment->booking_payment_status, ['paid', 'forfeited'], true)) {
            throw new BillingException(422, 'no_refundable_payment', 'This appointment does not have a settled booking payment to refund.');
        }

        $centavos = $this->billing->centavos((string) $appointment->booking_fee_php);
        $validReason = in_array($reason, ['duplicate', 'fraudulent', 'requested_by_customer', 'others'], true) ? $reason : 'requested_by_customer';

        try {
            $request = Http::withBasicAuth($secret, '')->acceptJson()->asJson()->timeout(15);
            // A provider-acknowledged refund is reconciled by id, never created again. A lost creation response
            // retries with the same key (provider idempotency retention is finite; unknown outcomes need review).
            $response = $appointment->booking_refund_ref
                ? $request->get($this->host().'/v1/refunds/'.rawurlencode($appointment->booking_refund_ref))
                : $request->withHeaders(['Idempotency-Key' => 'booking-refund-'.substr(hash('sha256', $appointment->public_id.'|'.$appointment->booking_payment_ref), 0, 48)])
                ->post($this->host().'/v1/refunds', [
                    'data' => [
                        'attributes' => [
                            'amount' => $centavos,
                            'payment_id' => $appointment->booking_payment_ref,
                            'reason' => $validReason,
                            'notes' => "Refund for Appointment {$appointment->appointment_code}",
                        ],
                    ],
                ]);
        } catch (ConnectionException) {
            throw new BillingException(502, 'payment_gateway_unavailable', 'The payment provider could not be reached to process the refund.');
        }

        if (! $response->successful()) {
            report(new \RuntimeException('PayMongo refund refused with HTTP '.$response->status()));
            throw new BillingException(502, 'payment_gateway_error', 'The payment provider could not complete the refund.');
        }

        $refundId = $response->json('data.id');
        $status = $response->json('data.attributes.status');
        $amount = $response->json('data.attributes.amount');
        if (! is_string($refundId) || $refundId === '' || ($appointment->booking_refund_ref && $refundId !== $appointment->booking_refund_ref)
            || ! in_array($status, ['pending', 'processing', 'succeeded', 'failed'], true)
            || ! (is_int($amount) || (is_string($amount) && ctype_digit($amount))) || (int) $amount !== $centavos) {
            throw new BillingException(502, 'payment_gateway_invalid_response', 'The provider did not return verifiable refund confirmation. Please contact the clinic before retrying.');
        }
        $appointment->update([
            'booking_payment_status' => $status === 'succeeded' ? 'refunded' : $appointment->booking_payment_status,
            'booking_refund_ref' => $refundId,
            'booking_refunded_at' => $status === 'succeeded' ? ClinicClock::now() : null,
        ]);

        $this->audit->record([
            'action' => $status === 'succeeded' ? 'billing.booking_payment_refunded' : 'billing.booking_payment_refund_requested',
            'category' => 'financial',
            'severity' => 'info',
            'actor' => null,
            'target' => $appointment,
            'branch_id' => $appointment->branch_id,
            'payload' => [
                'appointment_code' => $appointment->appointment_code,
                'fee' => (string) $appointment->booking_fee_php,
                'refund_id' => $refundId,
                'provider_status' => $status,
                'reason' => $validReason,
            ],
        ]);

        return ['refund_id' => $refundId, 'status' => $status === 'succeeded' ? 'refunded' : $status];
    }

    /**
     * Best effort: asks PayMongo to expire a retired session (POST /v1/checkout_sessions/{id}/expire). PayMongo answers 400 when the
     * session is already paid, in progress or expired; a payment that still lands on it is caught by the webhook as "Needs review"
     * (its amount no longer matches), never applied. A failure here never blocks the new checkout.
     */
    private function expireAtProvider(PaymentCheckoutSession $session, string $secret): void
    {
        try {
            $response = Http::withBasicAuth($secret, '')->acceptJson()->timeout(10)
                ->post($this->host().'/v1/checkout_sessions/'.rawurlencode($session->provider_session_id).'/expire');
            if (! $response->successful() && $response->status() !== 400) {
                report(new \RuntimeException('PayMongo session expiry refused with HTTP '.$response->status()));
            }
        } catch (ConnectionException $e) {
            report($e);
        }
    }

    private function limit(string $text): string
    {
        return mb_strlen($text) > self::TEXT_LIMIT ? rtrim(mb_substr($text, 0, self::TEXT_LIMIT - 1)).'…' : $text;
    }

    private function peso(string $amount): string
    {
        return 'PHP '.number_format((float) $amount, 2);
    }

    // ---- webhook ----------------------------------------------------------------------------------------------------

    /**
     * Verifies the `Paymongo-Signature` header exactly as documented: `t=<timestamp>,te=<test signature>,li=<live signature>`;
     * the signed string is `<t>.<raw request body>`; HMAC-SHA256 with the endpoint's webhook secret; `te` is compared for a
     * test-mode endpoint and `li` for a live-mode endpoint (the configured mode — never anything read from the body); the
     * comparison is constant-time. It must be called with the UNMODIFIED raw body, before anything is parsed. A header that is
     * malformed, repeats a component, lacks `t`, lacks the component for this mode, or whose signature is not 64 hex characters
     * is refused. The timestamp is part of the signed string, so it is also checked: a delivery whose `t` is more than
     * services.paymongo.webhook_tolerance_seconds (default 300) away from this server's clock is refused as a replay. The live
     * test (October 14, 2026) showed PayMongo re-signs each retry with a fresh `t` (a retry 31 s later carried t+31), so the
     * window never blocks a genuine retry. Event-id de-duplication and idempotent settlement remain the second line of defence.
     * A missing secret or mode fails closed.
     */
    public function verifyWebhookSignature(string $rawPayload, ?string $signatureHeader): bool
    {
        $secret = $this->webhookSecret();
        $live = $this->live();
        $header = trim((string) $signatureHeader);
        if ($header === '' || $rawPayload === '') {
            return false;
        }
        $parts = [];
        foreach (explode(',', $header) as $pair) {
            $pair = trim($pair);
            if ($pair === '' || ! str_contains($pair, '=')) {
                return false; // malformed component
            }
            [$name, $value] = explode('=', $pair, 2);
            $name = trim($name);
            if (! in_array($name, ['t', 'te', 'li'], true) || array_key_exists($name, $parts)) {
                return false; // unknown or repeated component
            }
            $parts[$name] = trim($value);
        }
        $timestamp = $parts['t'] ?? '';
        $given = $parts[$live ? 'li' : 'te'] ?? '';
        if (! preg_match('/^\d{1,20}$/', $timestamp) || ! preg_match('/^[0-9a-fA-F]{64}$/', $given)) {
            return false;
        }

        if (! hash_equals(hash_hmac('sha256', $timestamp.'.'.$rawPayload, $secret), strtolower($given))) {
            return false;
        }

        return abs(time() - (int) $timestamp) <= max(1, (int) config('services.paymongo.webhook_tolerance_seconds', 300));
    }

    /** True when the verified event's own `livemode` flag equals this endpoint's configured mode. */
    public function eventMatchesMode(array $payload): bool
    {
        return ($payload['data']['attributes']['livemode'] ?? null) === $this->live();
    }

    /**
     * Handles one signature-verified event. Returns ['http' => status, 'status' => event status, 'invoice' => public id|null].
     * 200 means "stop retrying" (settled, duplicate, ignored, or recorded for review); 503 asks the provider to retry because the
     * provider could not be asked to confirm right now.
     */
    public function handleEvent(array $payload): array
    {
        $eventId = $payload['data']['id'] ?? null;
        $type = $payload['data']['attributes']['type'] ?? null;
        if (! is_string($eventId) || $eventId === '' || strlen($eventId) > 120 || ! is_string($type) || $type === '') {
            throw new BillingException(422, 'malformed_event', 'The event is missing its identifier or type.');
        }

        $event = PaymentProviderEvent::where('provider_event_id', $eventId)->first();
        if ($event && $event->status !== 'Received') {
            return $this->outcome($event, 200); // a duplicate delivery: never act twice
        }
        if (! $event) {
            try {
                $event = PaymentProviderEvent::create([
                    'provider_event_id' => $eventId, 'event_type' => substr($type, 0, 100), 'status' => 'Received', 'received_at' => now(),
                    'provider_session_id' => is_string($payload['data']['attributes']['data']['id'] ?? null) ? substr($payload['data']['attributes']['data']['id'], 0, 120) : null,
                ]);
            } catch (UniqueConstraintViolationException) {
                $event = PaymentProviderEvent::where('provider_event_id', $eventId)->firstOrFail(); // a concurrent delivery stored it first
            }
        }

        if ($type !== self::PAID_EVENT) {
            return $this->finish($event, 'Ignored', 'event_type_not_handled', 200);
        }

        return DB::transaction(function () use ($event, $payload) {
            $event = PaymentProviderEvent::whereKey($event->id)->lockForUpdate()->firstOrFail();
            if ($event->status !== 'Received') {
                return $this->outcome($event, 200);
            }
            $session = PaymentCheckoutSession::where('provider_session_id', $event->provider_session_id)->with(['invoice', 'appointment'])->first();
            if (! $session) {
                return $this->review($event, null, 'unknown_checkout_session');
            }
            if ($session->invoice_id) {
                $event->invoice_id = $session->invoice_id;
            }
            if ($session->appointment_id) {
                $event->appointment_id = $session->appointment_id;
            }

            try {
                $paid = $this->confirmWithProvider($session, (array) ($payload['data']['attributes']['data']['attributes'] ?? []));
            } catch (ConnectionException) {
                $targetId = $session->invoice?->public_id ?? $session->appointment?->public_id;
                return ['http' => 503, 'status' => 'Received', 'invoice' => $targetId, 'reference' => $targetId]; // retry later; the event stays stored
            }
            if (is_string($paid)) {
                return $this->review($event, $session, $paid);
            }
            $event->provider_payment_id = $paid['id'];
            $event->amount_centavos = $paid['centavos'];
            $event->currency = $paid['currency'];

            if ($paid['currency'] !== self::CURRENCY || $paid['centavos'] !== $this->billing->centavos((string) $session->amount)) {
                return $this->review($event, $session, 'amount_mismatch');
            }

            // Section 22.3: Appointment booking settlement path
            if ($session->appointment_id) {
                $appointment = Appointment::whereKey($session->appointment_id)->lockForUpdate()->firstOrFail();
                // Provider event ids deduplicate deliveries, not payments: polling or a differently named event may
                // already have settled this payment. Never replay its status/history/notifications over clinical care.
                if ($appointment->booking_payment_ref) {
                    if ($appointment->booking_payment_ref === $paid['id']) {
                        return $this->finish($event, 'Duplicate', 'booking_payment_already_applied', 200, $appointment->public_id);
                    }
                    return $this->review($event, $session, 'booking_already_paid');
                }
                if ($appointment->status === 'Cancelled') {
                    // Captured by provider but appointment was already cancelled/expired: keep event for review
                    return $this->review($event, $session, 'appointment_already_cancelled', 'Needs review');
                }
                if (! in_array($appointment->status, ['Pending', 'Confirmed'], true) || $session->fresh()?->status !== 'Open') {
                    return $this->review($event, $session, 'appointment_not_payable');
                }
                $from = $appointment->status;
                $method = 'PayMongo ('.(self::METHOD_LABELS[$paid['method']] ?? 'ONLINE').')';
                $appointment->update([
                    'status' => 'Confirmed',
                    'booking_payment_status' => 'paid',
                    'booking_payment_method' => $method,
                    'booking_payment_ref' => $paid['id'],
                    'booking_paid_at' => ClinicClock::now(),
                    'booking_hold_expires_at' => null,
                    'revision' => $appointment->revision + 1,
                ]);

                app(\App\Services\Appointments\AppointmentService::class)->record($appointment, null, 'appointment.booking_paid', $from);
                \App\Services\Automations\FillFreedSlots::claimByBooking($appointment);
                \App\Services\Followups\Followups::booked($appointment);

                try {
                    app(\App\Services\Mail\MailOutbox::class)->queue(
                        'appointment_confirmation',
                        "appointment_confirmation:{$appointment->public_id}:r{$appointment->revision}",
                        $appointment,
                        $appointment->revision,
                        $appointment->patient?->contactUser(),
                        null
                    );
                } catch (\Throwable $e) {
                    report($e);
                }
                app(\App\Services\Notifications\NotificationCenter::class)->appointment($appointment, 'appointment_confirmation');

                $this->audit->record([
                    'action' => 'billing.booking_payment_received',
                    'category' => 'financial',
                    'severity' => 'info',
                    'actor' => null,
                    'target' => $appointment,
                    'branch_id' => $appointment->branch_id,
                    'payload' => [
                        'appointment_code' => $appointment->appointment_code,
                        'amount' => (string) $session->amount,
                        'method' => $method,
                        'provider_payment_id' => $paid['id'],
                    ],
                ]);

                $session->update(['status' => 'Settled']);

                return $this->finish($event, 'Settled', null, 200, $appointment->public_id);
            }

            try {
                $settled = $this->billing->payOnline($session->invoice, 'PayMongo ('.(self::METHOD_LABELS[$paid['method']] ?? 'ONLINE').')', $paid['id'], $session->initiatedBy()->firstOrFail(), (string) $session->amount);
            } catch (BillingException $e) {
                // The provider captured funds the invoice can no longer take: keep the event, flag it, never drop it.
                return $this->review($event, $session, $e->getCode(), $e->getCode() === 'already_paid' ? 'Duplicate' : 'Needs review');
            }
            $session->update(['status' => 'Settled']);

            return $this->finish($event, 'Settled', null, 200, $settled->public_id);
        }, 3);
    }

    /**
     * Asks the provider directly (server to server, with the secret key) what it captured for this session, so the settlement
     * never rests on the contents of an inbound request. The session read back must be in this endpoint's mode, carry OUR invoice
     * or appointment reference, and hold a paid payment with an id, an integer amount and a currency; when the event itself names
     * a payment or a reference it must agree. Returns the paid payment, or a review reason string; throws ConnectionException when
     * the provider cannot be asked (the provider then retries the event).
     *
     * @return array{id:string,centavos:int,currency:string,method:string}|string
     */
    private function confirmWithProvider(PaymentCheckoutSession $session, array $eventSession): array|string
    {
        $response = Http::withBasicAuth($this->secretKey(), '')->acceptJson()->timeout(10)->get($this->host().'/v1/checkout_sessions/'.rawurlencode($session->provider_session_id));
        if ($response->serverError() || $response->status() === 429) {
            throw new ConnectionException('provider temporarily unavailable');
        }
        if (! $response->successful()) {
            return 'provider_confirmation_refused';
        }
        if (($response->json('data.attributes.livemode')) !== $this->live()) {
            return 'livemode_mismatch';
        }
        $targetPublicId = $session->invoice?->public_id ?? $session->appointment?->public_id;
        if ($response->json('data.attributes.reference_number') !== $targetPublicId
            || (isset($eventSession['reference_number']) && $eventSession['reference_number'] !== $targetPublicId)) {
            return 'reference_mismatch';
        }
        $payments = $response->json('data.attributes.payments');
        if (! is_array($payments)) {
            return 'provider_reports_no_payment';
        }
        foreach ($payments as $payment) {
            $attributes = $payment['attributes'] ?? [];
            if (($attributes['status'] ?? null) !== 'paid') {
                continue;
            }
            $id = $payment['id'] ?? null;
            $amount = $attributes['amount'] ?? null;
            $currency = $attributes['currency'] ?? null;
            if (! is_string($id) || $id === '' || ! (is_int($amount) || (is_string($amount) && ctype_digit($amount))) || ! is_string($currency) || $currency === '') {
                return 'unverifiable_payment';
            }
            // If the event names payments, the paid payment it reports must be the same one the provider reports.
            foreach ((array) ($eventSession['payments'] ?? []) as $eventPayment) {
                if (($eventPayment['attributes']['status'] ?? null) === 'paid' && ($eventPayment['id'] ?? $id) !== $id) {
                    return 'event_provider_payment_disagree';
                }
            }

            // The payment's own source type; when absent, the session's payment_method_used (seen filled on read-back in the live test).
            $method = (string) ($attributes['source']['type'] ?? '') ?: (string) ($response->json('data.attributes.payment_method_used') ?? '');

            return ['id' => $id, 'centavos' => (int) $amount, 'currency' => strtoupper($currency), 'method' => $method];
        }

        return 'provider_reports_not_paid';
    }

    private function review(PaymentProviderEvent $event, ?PaymentCheckoutSession $session, string $reason, string $status = 'Needs review'): array
    {
        $target = $session?->invoice ?? $session?->appointment;
        $branchId = $session?->invoice?->branch_id ?? $session?->appointment?->branch_id;
        $publicId = $session?->invoice?->public_id ?? $session?->appointment?->public_id;

        $this->audit->record([
            'action' => 'billing.provider_payment_unreconciled', 'category' => 'financial', 'severity' => 'critical', 'actor' => null, 'actor_name' => 'Payment provider event',
            'actor_role' => 'system', 'target' => $target, 'branch_id' => $branchId,
            // The captured payment is on record and needs a person: identifiers, a reason and a decimal-safe amount only.
            'payload' => ['reason' => $reason, 'status' => $status, 'provider_event_id' => $event->provider_event_id, 'provider_payment_id' => $event->provider_payment_id,
                'amount' => $event->amount_centavos === null ? null : number_format($event->amount_centavos / 100, 2, '.', '')],
        ]);

        return $this->finish($event, $status, $reason, 200, $publicId);
    }

    private function finish(PaymentProviderEvent $event, string $status, ?string $reason, int $http, ?string $targetPublicId = null): array
    {
        $event->forceFill(['status' => $status, 'reason' => $reason, 'processed_at' => now()])->save();
        $publicId = $targetPublicId ?? $event->invoice?->public_id ?? $event->appointment?->public_id;

        return ['http' => $http, 'status' => $status, 'invoice' => $publicId, 'reference' => $publicId];
    }

    private function outcome(PaymentProviderEvent $event, int $http): array
    {
        $publicId = $event->invoice?->public_id ?? $event->appointment?->public_id;

        return ['http' => $http, 'status' => $event->status, 'invoice' => $publicId, 'reference' => $publicId];
    }
}

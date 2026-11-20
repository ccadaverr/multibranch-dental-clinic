<?php

namespace Tests\Feature\Payment;

use App\Enums\Role;
use App\Mail\PaymentReceiptMail;
use App\Models\AuditLog;
use App\Models\PatientHmoMembership;
use App\Models\Payment;
use App\Models\PaymentCheckoutSession;
use App\Models\PaymentProviderEvent;
use App\Models\Receipt;
use App\Models\SystemEvent;
use App\Models\Branch;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\Patient;
use App\Models\Person;
use App\Models\Service;
use App\Models\ServicePrice;
use App\Models\Treatment;
use App\Models\User;
use App\Models\UserBranchScope;
use App\Models\Visit;
use App\Services\Payment\PayMongoService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class PayMongoPaymentTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $patientUser;
    private Patient $patient;
    private Branch $branch;
    private Invoice $invoice;

    protected function setUp(): void
    {
        parent::setUp();

        Mail::fake();
        // Fake credentials for the unit tests only; the application has no defaults and refuses to run without real ones.
        config(['services.paymongo.secret_key' => 'sk_test_unit_secret', 'services.paymongo.webhook_secret' => 'whsec_unit_test_secret', 'services.paymongo.mode' => 'test', 'services.paymongo.payment_method_types' => 'gcash, card', 'services.paymongo.base_url' => 'https://api.paymongo.com', 'app.frontend_url' => 'http://localhost:5173']);

        // Seed basic reference models
        $this->owner = User::factory()->create([
            'role' => Role::Owner,
            'email' => 'owner@example.test',
        ]);

        $person = Person::create([
            'first_name' => 'Maria',
            'last_name' => 'Santos',
            'date_of_birth' => '1995-05-15',
            'gender' => 'Female',
            'phone_number' => '+639171234567',
        ]);

        $this->patientUser = User::factory()->create([
            'role' => Role::Patient,
            'person_id' => $person->id,
            'email' => 'maria@example.test',
            'email_verified_at' => now(),
        ]);

        $this->patient = Patient::create([
            'person_id' => $person->id,
            'patient_code' => 'PAT-TEST-001',
            'consent' => true,
        ]);

        $this->branch = Branch::create([
            'legacy_ref' => 'b_qc',
            'name' => 'QC Branch',
            'branch_code' => 'QC-01',
            'city' => 'Quezon City',
            'address' => '123 West Ave, Quezon City',
            'phone' => '02-8123-4567',
            'status' => 'Open',
            'open_time' => '09:00',
            'close_time' => '18:00',
        ]);

        $service = Service::create([
            'code' => 'CLN',
            'name' => 'Dental Cleaning',
            'category' => 'Preventive',
            'duration_minutes' => 45,
            'status' => 'Active',
            'legacy_ref' => 'srv_cleaning',
        ]);

        $price = ServicePrice::create([
            'service_id' => $service->id,
            'branch_id' => null,
            'kind' => 'priced',
            'amount' => '1500.00',
            'effective_from' => now()->subDay()->toDateString(),
            'source' => 'owner_confirmed',
            'created_by_user_id' => $this->owner->id,
            'created_at' => now(),
        ]);

        $visit = Visit::create([
            'patient_id' => $this->patient->id,
            'branch_id' => $this->branch->id,
            'clinic_date' => now()->toDateString(),
            'source' => 'walk_in',
            'status' => 'In Treatment',
            'arrived_at' => now(),
        ]);

        $dentistPerson = Person::create([
            'first_name' => 'Dana',
            'last_name' => 'Roxas',
            'date_of_birth' => '1980-01-01',
            'gender' => 'Female',
        ]);
        $dentist = \App\Models\DentistProfile::create([
            'legacy_ref' => 'd_test',
            'person_id' => $dentistPerson->id,
            'license_no' => 'DENT-999',
            'specialty' => 'General Dentistry',
            'shift_start' => '09:00',
            'shift_end' => '18:00',
        ]);

        $treatment = Treatment::create([
            'visit_id' => $visit->id,
            'dentist_profile_id' => $dentist->id,
            'status' => 'Completed',
            'started_at' => now()->subMinutes(30),
            'completed_at' => now(),
            'created_by_user_id' => $this->owner->id,
            'updated_by_user_id' => $this->owner->id,
        ]);

        // Create an Issued invoice
        $this->invoice = Invoice::create([
            'treatment_id' => $treatment->id,
            'visit_id' => $visit->id,
            'patient_id' => $this->patient->id,
            'branch_id' => $this->branch->id,
            'invoice_number' => 'INV-2026-999901',
            'status' => 'Issued',
            'revision' => 2,
            'gross_amount' => 1500.00,
            'hmo_coverage_amount' => 0.00,
            'patient_responsibility_amount' => 1500.00,
            'paid_amount' => 0.00,
            'issued_at' => now(),
            'created_by_user_id' => $this->owner->id,
            'updated_by_user_id' => $this->owner->id,
        ]);

        InvoiceLine::create([
            'invoice_id' => $this->invoice->id,
            'service_id' => $service->id,
            'service_price_id' => $price->id,
            'line_no' => 1,
            'service_code' => 'CLN',
            'service_name' => 'Dental Cleaning',
            'quantity' => 1,
            'unit_price' => 1500.00,
            'line_total' => 1500.00,
        ]);
    }

    private const SECRET = 'whsec_unit_test_secret';

    // ---- helpers ----------------------------------------------------------------------------------------------------

    /** A fresh fake: stubs registered earlier in a test must not shadow the one being set up. */
    private function freshHttp(): void
    {
        Http::swap(new \Illuminate\Http\Client\Factory());
    }

    private function fakeCheckout(string $sessionId = 'cs_unit_1', ?string $retire = null): void
    {
        $this->freshHttp();
        Http::preventStrayRequests();
        $responses = ['https://api.paymongo.com/v2/checkout_sessions' => Http::response(['data' => ['id' => $sessionId, 'attributes' => ['checkout_url' => "https://checkout.paymongo.com/{$sessionId}", 'livemode' => false]]], 200)];
        if ($retire !== null) {
            $responses["https://api.paymongo.com/v1/checkout_sessions/{$retire}/expire"] = Http::response($this->expiredCheckout($retire));
        }
        Http::fake($responses);
    }

    private function expiredCheckout(string $id): array
    {
        return ['data' => ['id' => $id, 'attributes' => [
            'status' => 'expired', 'reference_number' => $this->invoice->public_id, 'livemode' => false, 'payments' => [],
        ]]];
    }

    private function startCheckout(string $sessionId = 'cs_unit_1'): void
    {
        $this->fakeCheckout($sessionId);
        $this->actingAs($this->patientUser)->postJson("/api/invoices/{$this->invoice->public_id}/paymongo-checkout")->assertOk();
    }

    /** What the provider says it captured for the session when the server asks it directly. */
    private function fakeProvider(string $sessionId, array $payments, array $override = []): void
    {
        $this->freshHttp();
        $attributes = ['status' => 'active', 'reference_number' => $this->invoice->public_id, 'livemode' => false, 'payments' => $payments] + [];
        Http::fake(["https://api.paymongo.com/v1/checkout_sessions/{$sessionId}" => Http::response(['data' => ['id' => $sessionId, 'attributes' => array_replace($attributes, $override)]], 200)]);
    }

    private function paid(string $paymentId = 'pay_unit_1', int $centavos = 150000, string $type = 'gcash', string $currency = 'PHP'): array
    {
        return [['id' => $paymentId, 'attributes' => ['status' => 'paid', 'amount' => $centavos, 'currency' => $currency, 'source' => ['type' => $type]]]];
    }

    private function event(string $eventId = 'evt_unit_1', string $sessionId = 'cs_unit_1', string $type = 'checkout_session.payment.paid', array $extra = []): array
    {
        return ['data' => ['id' => $eventId, 'attributes' => ['type' => $type, 'livemode' => $extra['__live'] ?? false, 'data' => ['id' => $sessionId, 'attributes' => array_diff_key($extra, ['__live' => 1])]]]];
    }

    /** Signs exactly as documented: HMAC-SHA256 over "<t>.<raw body>" in `te` (test) or `li` (live), the other component empty. */
    private function deliver(array $payload, string $mode = 'test', ?string $secret = null, ?\Closure $mutate = null): \Illuminate\Testing\TestResponse
    {
        $raw = json_encode($payload);
        $t = (string) time();
        $signature = hash_hmac('sha256', $t.'.'.$raw, $secret ?? self::SECRET);
        $header = $mode === 'live' ? "t={$t},te=,li={$signature}" : "t={$t},te={$signature},li=";
        if ($mutate) {
            [$raw, $header] = $mutate($raw, $header, $t, $signature);
        }

        return $this->postRaw($raw, $header);
    }

    private function postRaw(string $raw, ?string $header): \Illuminate\Testing\TestResponse
    {
        return $this->call('POST', '/api/webhooks/paymongo', [], [], [], ['CONTENT_TYPE' => 'application/json'] + ($header === null ? [] : ['HTTP_Paymongo_Signature' => $header]), $raw);
    }

    private function settledSetup(string $sessionId = 'cs_unit_1', string $paymentId = 'pay_unit_1'): void
    {
        $this->startCheckout($sessionId);
        $this->fakeProvider($sessionId, $this->paid($paymentId));
    }

    // ---- checkout ---------------------------------------------------------------------------------------------------

    public function test_the_patient_who_owns_the_invoice_starts_a_checkout_with_server_built_urls_and_integer_centavos(): void
    {
        $this->startCheckout('cs_unit_1');

        Http::assertSent(function ($request) {
            $attr = $request->data()['data']['attributes'];
            return $request->url() === 'https://api.paymongo.com/v2/checkout_sessions'
                && $attr['line_items'][0]['amount'] === 150000 && is_int($attr['line_items'][0]['amount']) && $attr['line_items'][0]['currency'] === 'PHP'
                && str_starts_with($attr['success_url'], 'http://localhost:5173/') && str_contains($attr['success_url'], $this->invoice->public_id)
                && $attr['reference_number'] === $this->invoice->public_id
                && ($attr['billing']['email'] ?? null) === 'maria@example.test';
        });
        $session = PaymentCheckoutSession::sole();
        $this->assertSame(['cs_unit_1', '1500.00', 'PHP', 'Open', $this->patientUser->id, $this->invoice->id], [$session->provider_session_id, (string) $session->amount, $session->currency, $session->status, $session->initiated_by_user_id, $session->invoice_id]);
    }

    public function test_centavo_conversion_is_exact_for_awkward_amounts(): void
    {
        $this->invoice->update(['gross_amount' => '1.15', 'patient_responsibility_amount' => '1.15']);
        $this->startCheckout('cs_unit_cents');
        Http::assertSent(fn ($r) => str_contains($r->url(), 'checkout_sessions') && $r->data()['data']['attributes']['line_items'][0]['amount'] === 115); // (int) (1.15 * 100) float code yields 114
        $this->assertSame('1.15', (string) PaymentCheckoutSession::sole()->amount);
    }

    public function test_money_return_urls_and_provider_fields_cannot_be_supplied_by_the_client(): void
    {
        $this->fakeCheckout();
        foreach (['success_url' => 'https://evil.example/done', 'cancel_url' => 'https://evil.example/no', 'amount' => '1.00', 'currency' => 'USD', 'status' => 'Paid', 'paid_amount' => '1500.00', 'checkout_url' => 'https://evil.example', 'invoice_id' => 'x'] as $field => $value) {
            $this->actingAs($this->patientUser)->postJson("/api/invoices/{$this->invoice->public_id}/paymongo-checkout", [$field => $value])->assertStatus(422)->assertJsonValidationErrors($field);
        }
        $this->assertSame(0, PaymentCheckoutSession::count());
        Http::assertNothingSent();
    }

    public function test_only_the_owning_patient_or_scoped_staff_may_start_a_checkout(): void
    {
        $url = "/api/invoices/{$this->invoice->public_id}/paymongo-checkout";
        $this->fakeCheckout();
        $otherPerson = Person::create(['first_name' => 'Intruder', 'last_name' => 'Patient', 'date_of_birth' => '1990-01-01', 'email' => 'intruder@example.test']);
        $other = User::factory()->create(['role' => Role::Patient, 'person_id' => $otherPerson->id, 'email' => 'intruder@example.test']);
        Patient::create(['person_id' => $otherPerson->id, 'patient_code' => 'PAT-TEST-002', 'consent' => true]);
        $this->actingAs($other)->postJson($url)->assertForbidden();
        $this->actingAs($this->owner)->postJson($url)->assertForbidden(); // Owner: no payment initiation
        $dentist = User::factory()->create(['role' => Role::Dentist]);
        $this->actingAs($dentist)->postJson($url)->assertForbidden();
        $staff = User::factory()->create(['role' => Role::Staff]);
        $this->actingAs($staff)->postJson($url)->assertForbidden(); // no branch scope
        $this->assertSame(0, PaymentCheckoutSession::count());
        $scoped = User::factory()->create(['role' => Role::Staff]);
        UserBranchScope::create(['user_id' => $scoped->id, 'branch_id' => $this->branch->id]);
        $this->actingAs($scoped)->postJson($url)->assertOk();
        $this->assertSame($scoped->id, PaymentCheckoutSession::sole()->initiated_by_user_id);
    }

    public function test_numeric_and_malformed_invoice_references_are_not_found(): void
    {
        $this->actingAs($this->patientUser);
        $this->postJson('/api/invoices/'.$this->invoice->id.'/paymongo-checkout')->assertNotFound();
        $this->postJson('/api/invoices/not-a-ulid/paymongo-checkout')->assertNotFound();
    }

    public function test_checkout_is_refused_for_an_invoice_that_cannot_take_payment(): void
    {
        $url = "/api/invoices/{$this->invoice->public_id}/paymongo-checkout";
        $this->fakeCheckout();
        $this->invoice->update(['status' => 'Draft']);
        $this->actingAs($this->patientUser)->postJson($url)->assertStatus(422)->assertJsonPath('code', 'invalid_invoice_state');
        $this->invoice->update(['status' => 'Issued']);
        // An active HMO membership with no claim decision holds payment (M12 gate): money must not be taken that cannot be applied.
        PatientHmoMembership::create(['patient_id' => $this->patient->id, 'provider_name' => 'Insurer', 'member_number' => 'M-1', 'status' => 'active', 'created_by_user_id' => $this->owner->id, 'created_at' => now()]);
        $this->actingAs($this->patientUser)->postJson($url)->assertStatus(422)->assertJsonPath('code', 'hmo_financial_hold');
        $this->assertSame(0, PaymentCheckoutSession::count());
        Http::assertNothingSent();
    }

    public function test_a_provider_failure_is_an_explicit_error_and_never_a_simulated_session(): void
    {
        $url = "/api/invoices/{$this->invoice->public_id}/paymongo-checkout";
        // Even with a test-prefixed key and the testing environment, the old code returned a fake "simulated" session here.
        config(['services.paymongo.secret_key' => 'sk_test_looks_like_a_test_key']);
        $this->freshHttp();
        Http::fake(['*' => Http::response(['errors' => [['detail' => 'secret provider detail']]], 500)]);
        $this->actingAs($this->patientUser)->postJson($url)->assertStatus(502)->assertJsonPath('code', 'payment_gateway_error')->assertJsonMissing(['detail' => 'secret provider detail']);
        $this->freshHttp();
        Http::fake(fn () => throw new \Illuminate\Http\Client\ConnectionException('timeout'));
        $this->actingAs($this->patientUser)->postJson($url)->assertStatus(502)->assertJsonPath('code', 'payment_gateway_unavailable');
        foreach ([['data' => ['attributes' => ['checkout_url' => 'https://checkout.paymongo.com/x']]], ['data' => ['id' => 'cs_x', 'attributes' => []]], ['data' => ['id' => 'cs_x', 'attributes' => ['checkout_url' => 'http://insecure.example/x']]], []] as $bad) {
            $this->freshHttp();
            Http::fake(['*' => Http::response($bad, 200)]);
            $this->actingAs($this->patientUser)->postJson($url)->assertStatus(502)->assertJsonPath('code', 'payment_gateway_invalid_response');
        }
        $this->assertSame(0, PaymentCheckoutSession::count());
    }

    public function test_missing_credentials_fail_closed_instead_of_using_placeholders(): void
    {
        config(['services.paymongo.secret_key' => null]);
        Http::fake();
        $this->actingAs($this->patientUser)->postJson("/api/invoices/{$this->invoice->public_id}/paymongo-checkout")->assertStatus(503)->assertJsonPath('code', 'payment_not_configured');
        Http::assertNothingSent();
        config(['services.paymongo.webhook_secret' => '']);
        $this->deliver($this->event(), 'test', 'whsec_sample')->assertStatus(503)->assertJsonPath('code', 'payment_not_configured');
        $this->assertSame(0, PaymentProviderEvent::count());
        $this->assertSame('Issued', $this->invoice->fresh()->status);
    }

    public function test_no_secret_defaults_exist_in_configuration(): void
    {
        $source = file_get_contents(base_path('config/services.php'));
        $this->assertDoesNotMatchRegularExpression("/PAYMONGO_(SECRET_KEY|WEBHOOK_SECRET|PUBLIC_KEY)',\s*'/", $source);
        $this->assertStringNotContainsString('sk_test_sample', $source.file_get_contents(app_path('Services/Payment/PayMongoService.php')));
        $this->assertStringNotContainsString('whsec_sample', $source.file_get_contents(app_path('Services/Payment/PayMongoService.php')));
        $this->assertStringNotContainsString('test_mock_valid', file_get_contents(app_path('Services/Payment/PayMongoService.php')));
    }

    // ---- webhook: signature -----------------------------------------------------------------------------------------

    /** The documented scheme, line by line: header t/te/li, signed string "<t>.<raw body>", te = test endpoint, li = live endpoint. */
    public function test_the_signature_is_t_dot_raw_body_with_te_for_test_and_li_for_live(): void
    {
        $this->settledSetup();
        $payload = $this->event('evt_sig_ok', 'cs_unknown_a', 'payment.failed');
        $this->deliver($payload, 'test')->assertOk()->assertJsonPath('status', 'Ignored'); // correct test signature

        config(['services.paymongo.secret_key' => 'sk_live_unit_secret', 'services.paymongo.mode' => 'live']);
        $live = $this->event('evt_sig_live', 'cs_unknown_b', 'payment.failed', ['__live' => true]);
        $this->deliver($live, 'live')->assertOk()->assertJsonPath('status', 'Ignored'); // correct live signature
    }

    public function test_every_malformed_wrong_swapped_or_tampered_signature_is_refused_before_anything_is_stored(): void
    {
        $this->settledSetup();
        $payload = $this->event('evt_sig_bad', 'cs_unit_1');
        $raw = json_encode($payload);
        $t = (string) time();
        $good = hash_hmac('sha256', $t.'.'.$raw, self::SECRET);
        $wrong = hash_hmac('sha256', $t.'.'.$raw, 'a-different-secret');
        $bodyOnly = hash_hmac('sha256', $raw, self::SECRET); // the previously accepted, undocumented layout

        $cases = [
            'no header' => null, 'empty' => '', 'garbage' => 'invalid_signature_header', 'old bypass literal' => 'test_mock_valid',
            'body-only HMAC (no timestamp)' => $bodyOnly, 'te over body only' => "t={$t},te={$bodyOnly},li=",
            'wrong te' => "t={$t},te={$wrong},li=", 'swapped: valid signature in li on a test endpoint' => "t={$t},te=,li={$good}",
            'te empty' => "t={$t},te=,li=", 'te missing' => "t={$t},li={$good}", 'li only garbage' => "t={$t},te={$good}x,li=",
            't missing' => "te={$good},li=", 't empty' => "t=,te={$good},li=", 't not numeric' => "t=abc,te={$good},li=",
            'modified timestamp' => 't='.($t + 1).",te={$good},li=", 'timestamp reused for another body' => "t={$t},te=".hash_hmac('sha256', $t.'.'.$raw.' ', self::SECRET).',li=',
            'duplicate te' => "t={$t},te={$good},te={$good},li=", 'duplicate t' => "t={$t},t={$t},te={$good},li=", 'unknown component' => "t={$t},te={$good},li=,x=1",
            'component without =' => "t={$t},te={$good},li", 'short hex' => "t={$t},te=".substr($good, 0, 60).',li=', 'non-hex 64 chars' => "t={$t},te=".str_repeat('z', 64).',li=',
            'spaces inside the signature' => "t={$t},te=".substr($good, 0, 32).' '.substr($good, 32).',li=',
        ];
        foreach ($cases as $why => $header) {
            $this->postRaw($raw, $header)->assertStatus(400, "must refuse: {$why}");
        }
        $this->postRaw($raw.' ', "t={$t},te={$good},li=")->assertStatus(400); // a modified raw body
        $this->postRaw(json_encode($payload, JSON_PRETTY_PRINT), "t={$t},te={$good},li=")->assertStatus(400); // re-serialized JSON is not the signed body
        $this->assertSame(['Issued', 0, 0], [$this->invoice->fresh()->status, Payment::count(), PaymentProviderEvent::count()]);
        $this->postRaw($raw, "t={$t},te={$good},li=")->assertOk(); // and the genuine one is accepted
    }

    public function test_a_live_endpoint_accepts_only_li_and_the_event_mode_must_match(): void
    {
        config(['services.paymongo.secret_key' => 'sk_live_unit_secret', 'services.paymongo.mode' => 'live']);
        $payload = $this->event('evt_live_1', 'cs_unknown_c', 'payment.failed', ['__live' => true]);
        $raw = json_encode($payload);
        $t = (string) time();
        $good = hash_hmac('sha256', $t.'.'.$raw, self::SECRET);
        $this->postRaw($raw, "t={$t},te={$good},li=")->assertStatus(400);      // test component presented to a live endpoint
        $this->postRaw($raw, "t={$t},te={$good},li=".strrev($good))->assertStatus(400); // wrong li
        $this->postRaw($raw, "t={$t},te=,li={$good}")->assertOk();
        // A correctly signed event whose own livemode flag is the other mode is never processed.
        $test = $this->event('evt_live_2', 'cs_unknown_d', 'payment.failed', ['__live' => false]);
        $this->deliver($test, 'live')->assertStatus(400)->assertJsonPath('message', 'Event mode does not match this endpoint.');
        $this->assertSame(1, PaymentProviderEvent::count());
    }

    public function test_the_mode_and_the_secret_key_prefix_must_agree_and_payment_methods_must_be_configured(): void
    {
        $url = "/api/invoices/{$this->invoice->public_id}/paymongo-checkout";
        Http::fake();
        foreach ([['sk_live_unit_secret', 'test'], ['sk_test_unit_secret', 'live'], ['sk_test_unit_secret', null], ['sk_test_unit_secret', 'staging']] as [$key, $mode]) {
            config(['services.paymongo.secret_key' => $key, 'services.paymongo.mode' => $mode]);
            $this->actingAs($this->patientUser)->postJson($url)->assertStatus(503)->assertJsonPath('code', 'payment_not_configured');
            $this->postRaw('{}', 't=1,te='.str_repeat('a', 64).',li=')->assertStatus(503);
        }
        config(['services.paymongo.secret_key' => 'sk_test_unit_secret', 'services.paymongo.mode' => 'test']);
        foreach ([null, '', ' , ', 'bad method!'] as $methods) {
            config(['services.paymongo.payment_method_types' => $methods]);
            $this->actingAs($this->patientUser)->postJson($url)->assertStatus(503)->assertJsonPath('code', 'payment_not_configured');
        }
        Http::assertNothingSent();
        $this->assertSame(0, PaymentCheckoutSession::count());
    }

    public function test_the_configured_methods_and_the_documented_v2_endpoint_are_what_is_sent(): void
    {
        config(['services.paymongo.payment_method_types' => 'qrph, gcash']);
        $this->startCheckout();
        Http::assertSent(fn ($r) => $r->url() === 'https://api.paymongo.com/v2/checkout_sessions' && $r->method() === 'POST'
            && $r->data()['data']['attributes']['payment_method_types'] === ['qrph', 'gcash']
            && $r->hasHeader('Authorization', 'Basic '.base64_encode('sk_test_unit_secret:')));
        // an older base URL ending in /v1 does not change the endpoint versions used
        config(['services.paymongo.base_url' => 'https://api.paymongo.com/v1']);
        PaymentCheckoutSession::query()->update(['status' => 'Superseded']);
        $this->fakeCheckout('cs_unit_9');
        $this->actingAs($this->patientUser)->postJson("/api/invoices/{$this->invoice->public_id}/paymongo-checkout")->assertOk();
        Http::assertSent(fn ($r) => $r->url() === 'https://api.paymongo.com/v2/checkout_sessions');
    }

    public function test_a_session_created_for_the_other_mode_is_refused_and_a_malformed_body_is_a_400(): void
    {
        $this->freshHttp();
        Http::fake(['https://api.paymongo.com/v2/checkout_sessions' => Http::response(['data' => ['id' => 'cs_x', 'attributes' => ['checkout_url' => 'https://checkout.paymongo.com/x', 'livemode' => true]]], 200)]);
        $this->actingAs($this->patientUser)->postJson("/api/invoices/{$this->invoice->public_id}/paymongo-checkout")->assertStatus(502)->assertJsonPath('code', 'payment_gateway_invalid_response');
        $this->assertSame(0, PaymentCheckoutSession::count());
        $raw = '{not json';
        $t = (string) time();
        $this->postRaw($raw, "t={$t},te=".hash_hmac('sha256', $t.'.'.$raw, self::SECRET).',li=')->assertStatus(400);
        $this->deliver(['data' => ['attributes' => ['type' => 'x', 'livemode' => false]]])->assertStatus(422); // no event id
    }

    // ---- webhook: settlement ----------------------------------------------------------------------------------------

    public function test_a_verified_event_for_our_session_settles_exactly_once_with_a_truthful_receipt(): void
    {
        $this->settledSetup();
        // The inbound request claims a different amount: the provider's own record is the authority, not the request.
        $payload = $this->event('evt_unit_1', 'cs_unit_1', 'checkout_session.payment.paid', ['reference_number' => $this->invoice->public_id, 'amount' => 1, 'status' => 'paid', 'payments' => [['id' => 'pay_unit_1', 'attributes' => ['status' => 'paid', 'amount' => 1]]]]);

        $this->deliver($payload)->assertOk()->assertJsonPath('status', 'Settled');

        $fresh = $this->invoice->fresh(['payment', 'receipt']);
        $this->assertSame(['Paid', '1500.00'], [$fresh->status, (string) $fresh->paid_amount]);
        $this->assertSame(['1500.00', 'PayMongo (GCASH)', 'pay_unit_1', $this->patientUser->id], [(string) $fresh->payment->amount, $fresh->payment->method, $fresh->payment->external_reference, $fresh->payment->recorded_by_user_id]);
        $this->assertSame(['1500.00', 'pay_unit_1'], [(string) $fresh->receipt->amount, $fresh->receipt->external_reference]);
        $this->assertStringStartsWith('RCT-', $fresh->receipt->receipt_number);
        $event = PaymentProviderEvent::sole();
        $this->assertSame(['Settled', 'pay_unit_1', 150000, $this->invoice->id], [$event->status, $event->provider_payment_id, $event->amount_centavos, $event->invoice_id]);
        $this->assertSame('Settled', PaymentCheckoutSession::sole()->status);
        Mail::assertSent(PaymentReceiptMail::class, fn ($mail) => $mail->hasTo('maria@example.test'));
    }

    public function test_a_reference_livemode_or_payment_the_provider_does_not_confirm_is_kept_for_review(): void
    {
        $this->startCheckout();
        $cases = [
            'event names another invoice' => [$this->paid(), [], ['reference_number' => 'forged-reference'], 'reference_mismatch'],
            'provider holds another invoice reference' => [$this->paid(), ['reference_number' => 'someone-else'], [], 'reference_mismatch'],
            'provider session in the other mode' => [$this->paid(), ['livemode' => true], [], 'livemode_mismatch'],
            'event reports a different paid payment' => [$this->paid('pay_real'), [], ['payments' => [['id' => 'pay_other', 'attributes' => ['status' => 'paid', 'amount' => 150000]]]], 'event_provider_payment_disagree'],
            'payment has no currency' => [[['id' => 'pay_nc', 'attributes' => ['status' => 'paid', 'amount' => 150000]]], [], [], 'unverifiable_payment'],
            'payment has no amount' => [[['id' => 'pay_na', 'attributes' => ['status' => 'paid', 'currency' => 'PHP']]], [], [], 'unverifiable_payment'],
        ];
        $i = 0;
        foreach ($cases as $why => [$payments, $override, $eventExtra, $reason]) {
            $this->fakeProvider('cs_unit_1', $payments, $override);
            $this->deliver($this->event('evt_review_'.(++$i), 'cs_unit_1', 'checkout_session.payment.paid', $eventExtra))->assertOk()->assertJsonPath('status', 'Needs review');
            $this->assertSame($reason, PaymentProviderEvent::where('provider_event_id', 'evt_review_'.$i)->value('reason'), $why);
        }
        $this->assertSame(['Issued', 0, 0], [$this->invoice->fresh()->status, Payment::count(), Receipt::count()]);
    }

    public function test_online_payment_audit_and_automation_ledger_are_recorded(): void
    {
        $this->settledSetup();
        $this->deliver($this->event())->assertOk();
        $log = AuditLog::where('action', 'billing.payment_recorded')->sole();
        $this->assertSame(['financial', 'info', 'Invoice', $this->invoice->public_id, $this->invoice->branch_id, $this->patientUser->id], [$log->category, $log->severity, $log->auditable_type, $log->auditable_public_id, $log->branch_id, $log->actor_user_id]);
        $this->assertEqualsCanonicalizing(['invoice_number', 'receipt_number', 'amount', 'method'], array_keys($log->payload));
        $this->assertSame('1500.00', $log->payload['amount']);
        $this->assertStringNotContainsString('pay_unit_1', json_encode($log->payload), 'no provider reference in the audit payload');
        $this->assertStringNotContainsString('sk_unit', json_encode($log->payload));
        $this->assertSame(1, SystemEvent::where('event_type', 'billing.payment_received')->count());
    }

    public function test_a_replayed_event_changes_nothing_and_a_new_event_for_the_same_payment_is_idempotent(): void
    {
        $this->settledSetup();
        $this->deliver($this->event('evt_unit_1'))->assertOk()->assertJsonPath('status', 'Settled');
        $this->deliver($this->event('evt_unit_1'))->assertOk()->assertJsonPath('status', 'Settled'); // duplicate delivery
        $this->deliver($this->event('evt_unit_2'))->assertOk()->assertJsonPath('status', 'Settled'); // a new event id for the same captured payment
        $this->assertSame([1, 1, 2], [Payment::count(), Receipt::count(), PaymentProviderEvent::count()]);
        $this->assertSame(1, AuditLog::where('action', 'billing.payment_recorded')->count());
        $this->assertSame(1, SystemEvent::where('event_type', 'billing.payment_received')->count());
        Mail::assertSent(PaymentReceiptMail::class, 1);
    }

    public function test_events_that_are_not_a_paid_checkout_are_acknowledged_and_never_settle_anything(): void
    {
        $this->settledSetup();
        foreach (['payment.failed', 'payment.paid', 'source.chargeable', 'checkout_session.payment.failed'] as $i => $type) {
            $this->deliver($this->event("evt_other_{$i}", 'cs_unit_1', $type, ['reference_number' => $this->invoice->public_id, 'status' => 'paid']))->assertOk()->assertJsonPath('status', 'Ignored');
        }
        $this->assertSame(['Issued', 0, 0], [$this->invoice->fresh()->status, Payment::count(), Receipt::count()]);
    }

    public function test_an_event_for_a_session_this_server_never_created_is_kept_for_review_not_trusted(): void
    {
        $this->actingAs($this->patientUser);
        $this->deliver($this->event('evt_stranger', 'cs_not_ours', 'checkout_session.payment.paid', ['reference_number' => $this->invoice->public_id, 'status' => 'paid']))
            ->assertOk()->assertJsonPath('status', 'Needs review');
        $this->assertSame(['Issued', 0], [$this->invoice->fresh()->status, Payment::count()]);
        $this->assertSame(['Needs review', 'unknown_checkout_session'], [PaymentProviderEvent::sole()->status, PaymentProviderEvent::sole()->reason]);
        $log = AuditLog::where('action', 'billing.provider_payment_unreconciled')->sole();
        $this->assertSame(['critical', 'system', 'financial'], [$log->severity, $log->actor_role, $log->category]);
    }

    public function test_a_captured_amount_that_differs_from_the_balance_is_never_settled_and_never_lost(): void
    {
        $this->startCheckout();
        foreach ([[100000, 'PHP'], [150001, 'PHP'], [150000, 'USD']] as $i => [$centavos, $currency]) {
            $this->fakeProvider('cs_unit_1', $this->paid('pay_wrong_'.$i, $centavos, 'card', $currency));
            $this->deliver($this->event("evt_wrong_{$i}"))->assertOk()->assertJsonPath('status', 'Needs review');
        }
        $this->assertSame(['Issued', 0, 0], [$this->invoice->fresh()->status, Payment::count(), Receipt::count()]);
        $this->assertSame(3, PaymentProviderEvent::where('reason', 'amount_mismatch')->count());
        $this->assertSame(3, AuditLog::where('action', 'billing.provider_payment_unreconciled')->where('severity', 'critical')->count());
        $this->assertSame('Open', PaymentCheckoutSession::sole()->status);
    }

    public function test_the_provider_is_asked_to_confirm_and_a_claimed_payment_it_does_not_report_is_not_settled(): void
    {
        $this->startCheckout();
        foreach ([[], [['id' => 'pay_x', 'attributes' => ['status' => 'failed', 'amount' => 150000, 'currency' => 'PHP']]], [['id' => 'pay_y', 'attributes' => ['status' => 'paid']]]] as $i => $payments) {
            $this->fakeProvider('cs_unit_1', $payments);
            $this->deliver($this->event("evt_unconfirmed_{$i}", 'cs_unit_1', 'checkout_session.payment.paid', ['status' => 'paid', 'amount' => 150000]))->assertOk()->assertJsonPath('status', 'Needs review');
        }
        $this->assertSame(['Issued', 0], [$this->invoice->fresh()->status, Payment::count()]);
        Http::assertSent(fn ($r) => $r->method() === 'GET' && str_contains($r->url(), '/checkout_sessions/cs_unit_1') && $r->hasHeader('Authorization'));
    }

    public function test_when_the_provider_cannot_be_asked_the_event_stays_stored_and_a_retry_settles_it(): void
    {
        $this->startCheckout();
        $this->freshHttp();
        Http::fake(['https://api.paymongo.com/v1/checkout_sessions/cs_unit_1' => Http::response([], 503)]);
        $this->deliver($this->event('evt_retry'))->assertStatus(503);
        $this->assertSame(['Received', 'Issued'], [PaymentProviderEvent::sole()->status, $this->invoice->fresh()->status]);

        $this->fakeProvider('cs_unit_1', $this->paid('pay_retry'));
        $this->deliver($this->event('evt_retry'))->assertOk()->assertJsonPath('status', 'Settled'); // the provider's retry of the same event
        $this->assertSame(['Paid', 1, 1], [$this->invoice->fresh()->status, Payment::count(), PaymentProviderEvent::count()]);
    }

    public function test_a_second_capture_for_an_already_paid_invoice_is_recorded_as_a_duplicate_for_refund_review(): void
    {
        $this->startCheckout('cs_unit_1');
        $this->fakeProvider('cs_unit_1', $this->paid('pay_first'));
        $this->deliver($this->event('evt_first'))->assertOk()->assertJsonPath('status', 'Settled');

        $this->startCheckoutAgainForSecondSession();
        $this->fakeProvider('cs_unit_2', $this->paid('pay_second'));
        $this->deliver($this->event('evt_second', 'cs_unit_2'))->assertOk()->assertJsonPath('status', 'Duplicate');

        $this->assertSame([1, 1], [Payment::count(), Receipt::count()]);
        $this->assertSame('pay_first', $this->invoice->fresh('payment')->payment->external_reference);
        $this->assertSame(['Duplicate', 'already_paid', 'pay_second'], [PaymentProviderEvent::where('provider_event_id', 'evt_second')->value('status'), PaymentProviderEvent::where('provider_event_id', 'evt_second')->value('reason'), PaymentProviderEvent::where('provider_event_id', 'evt_second')->value('provider_payment_id')]);
        $this->assertSame(1, AuditLog::where('action', 'billing.provider_payment_unreconciled')->count());
    }

    private function startCheckoutAgainForSecondSession(): void
    {
        // The invoice is Paid now, so a second session cannot be created through the API; insert the record a still-open earlier
        // checkout page would have left (two browser tabs paying the same invoice).
        PaymentCheckoutSession::create(['invoice_id' => $this->invoice->id, 'provider_session_id' => 'cs_unit_2', 'amount' => '1500.00', 'currency' => 'PHP', 'status' => 'Open', 'initiated_by_user_id' => $this->patientUser->id]);
    }

    public function test_an_hmo_hold_that_appears_after_checkout_keeps_the_captured_payment_on_record(): void
    {
        $this->settledSetup();
        PatientHmoMembership::create(['patient_id' => $this->patient->id, 'provider_name' => 'Insurer', 'member_number' => 'M-2', 'status' => 'active', 'created_by_user_id' => $this->owner->id, 'created_at' => now()]);
        $this->deliver($this->event())->assertOk()->assertJsonPath('status', 'Needs review');
        $this->assertSame(['Issued', 0, 'hmo_financial_hold'], [$this->invoice->fresh()->status, Payment::count(), PaymentProviderEvent::sole()->reason]);
        $this->assertSame('Open', PaymentCheckoutSession::sole()->status);
    }

    public function test_an_unexpected_failure_never_leaks_internal_messages(): void
    {
        $this->startCheckout();
        $this->freshHttp();
        Http::fake(['https://api.paymongo.com/v1/checkout_sessions/cs_unit_1' => fn () => throw new \RuntimeException('secret-internal-detail /var/www/path')]);
        $response = $this->deliver($this->event('evt_boom'))->assertStatus(500);
        $this->assertStringNotContainsString('secret-internal-detail', $response->getContent());
        $this->assertStringNotContainsString('/var/www', $response->getContent());
    }

    public function test_a_failing_audit_never_undoes_a_captured_payment_and_a_failing_ledger_does_not_suppress_it(): void
    {
        $this->settledSetup();
        $this->app->bind(\App\Services\Automation\WorkflowAutomationService::class, fn () => new class(app(\App\Services\Audit\AuditService::class)) extends \App\Services\Automation\WorkflowAutomationService {
            public function __construct(\App\Services\Audit\AuditService $audit) { parent::__construct($audit); }
            public function recordEvent(array $data): \App\Models\SystemEvent { throw new \RuntimeException('automation unavailable'); }
        });
        $reported = [];
        $this->app->make(\Illuminate\Contracts\Debug\ExceptionHandler::class)->reportable(function (\Throwable $e) use (&$reported) { $reported[] = $e->getMessage(); });
        $this->deliver($this->event())->assertOk();
        $this->assertSame('Paid', $this->invoice->fresh()->status);
        $this->assertSame(1, AuditLog::where('action', 'billing.payment_recorded')->count());
        $this->assertContains('automation unavailable', $reported, 'the failure is reported, not swallowed');
    }

    // ---- database invariants ----------------------------------------------------------------------------------------

    public function test_the_database_refuses_inconsistent_financial_rows(): void
    {
        $attempt = function (\Closure $change, string $why): void {
            try {
                \Illuminate\Support\Facades\DB::transaction($change);
                $this->fail("the database should refuse: {$why}");
            } catch (\Illuminate\Database\QueryException) {
                $this->addToAssertionCount(1);
            }
        };
        $attempt(fn () => $this->invoice->update(['status' => 'Paid', 'paid_amount' => '100.00']), 'a Paid invoice that is not fully settled');
        $attempt(fn () => $this->invoice->update(['settlement_type' => 'full_hmo_coverage']), 'full-HMO settlement on an invoice with a balance');
        $attempt(fn () => $this->invoice->update(['settlement_type' => 'anything_else']), 'an unknown settlement type');
        $attempt(fn () => Payment::create(['invoice_id' => $this->invoice->id, 'amount' => '0.00', 'method' => 'Cash', 'recorded_by_user_id' => $this->owner->id, 'recorded_at' => now()]), 'a zero-peso payment');
    }

    public function test_the_not_valid_constraints_are_declared_unvalidated_but_enforced_for_new_writes(): void
    {
        // NOT VALID: PostgreSQL enforces them for every new or changed row but does not scan existing rows, so legacy data cannot
        // block deployment. They are therefore NOT claimed as validated historical integrity until VALIDATE CONSTRAINT succeeds.
        $rows = \Illuminate\Support\Facades\DB::select("select conname, convalidated from pg_constraint where conname in ('invoices_paid_settled_check','invoices_settlement_type_check','payments_amount_positive_check','receipts_amount_positive_check') order by conname");
        $this->assertSame(['invoices_paid_settled_check', 'invoices_settlement_type_check', 'payments_amount_positive_check', 'receipts_amount_positive_check'], array_column($rows, 'conname'));
        $this->assertSame([false, false, false, false], array_map(fn ($r) => (bool) $r->convalidated, $rows));
        // A new row that violates one is refused even though the constraint is not validated.
        $this->expectException(\Illuminate\Database\QueryException::class);
        $this->invoice->update(['status' => 'Paid', 'paid_amount' => '1.00']);
    }

    // ---- checkout multiplicity ------------------------------------------------------------------------------------------

    public function test_repeated_initiation_returns_the_same_open_session_and_calls_the_provider_once(): void
    {
        $this->fakeCheckout('cs_unit_1');
        $url = "/api/invoices/{$this->invoice->public_id}/paymongo-checkout";
        $first = $this->actingAs($this->patientUser)->postJson($url)->assertOk()->json('data');
        $second = $this->actingAs($this->patientUser)->postJson($url)->assertOk()->json('data');
        $this->assertSame($first, $second);
        Http::assertSentCount(1);
        $this->assertSame(1, PaymentCheckoutSession::where('invoice_id', $this->invoice->id)->where('status', 'Open')->count());
    }

    public function test_the_database_refuses_a_second_open_session_for_one_invoice(): void
    {
        $this->startCheckout('cs_unit_1');
        $this->expectException(\Illuminate\Database\UniqueConstraintViolationException::class);
        PaymentCheckoutSession::create(['invoice_id' => $this->invoice->id, 'provider_session_id' => 'cs_unit_dup', 'amount' => '1500.00', 'currency' => 'PHP', 'status' => 'Open', 'initiated_by_user_id' => $this->patientUser->id]);
    }

    public function test_a_changed_balance_supersedes_the_old_session_and_never_reuses_it(): void
    {
        $this->startCheckout('cs_unit_1');
        // The old link must be closed at the provider before the replacement exists.
        PaymentCheckoutSession::where('provider_session_id', 'cs_unit_1')->update(['amount' => '1400.00']);
        $this->fakeCheckout('cs_unit_2', 'cs_unit_1');
        $data = $this->actingAs($this->patientUser)->postJson("/api/invoices/{$this->invoice->public_id}/paymongo-checkout")->assertOk()->json('data');
        $this->assertSame('cs_unit_2', $data['checkout_session_id']);
        $this->assertSame(['Superseded', 'Open'], [PaymentCheckoutSession::where('provider_session_id', 'cs_unit_1')->value('status'), PaymentCheckoutSession::where('provider_session_id', 'cs_unit_2')->value('status')]);
    }

    public function test_no_new_checkout_for_a_paid_invoice_a_held_invoice_or_after_settlement_and_a_provider_failure_leaves_no_session(): void
    {
        // provider failure: nothing recorded, and the next attempt is a clean retry
        $this->freshHttp();
        Http::fake(['https://api.paymongo.com/v2/checkout_sessions' => Http::response([], 500)]);
        $url = "/api/invoices/{$this->invoice->public_id}/paymongo-checkout";
        $this->actingAs($this->patientUser)->postJson($url)->assertStatus(502);
        $this->assertSame(0, PaymentCheckoutSession::count());
        $this->fakeCheckout('cs_unit_1');
        $this->actingAs($this->patientUser)->postJson($url)->assertOk();
        $this->assertSame(1, PaymentCheckoutSession::count());
        // settled invoice: an existing open session is never handed out again
        $this->fakeProvider('cs_unit_1', $this->paid('pay_unit_1'));
        $this->deliver($this->event())->assertOk()->assertJsonPath('status', 'Settled');
        $this->actingAs($this->patientUser)->postJson($url)->assertStatus(422)->assertJsonPath('code', 'already_paid');
        $this->assertSame(1, Payment::count());
    }

    public function test_an_hmo_hold_appearing_after_a_session_exists_blocks_re_initiation(): void
    {
        $this->startCheckout('cs_unit_1');
        $this->invoice->update(['hmo_status' => 'Pending']);
        $res = $this->actingAs($this->patientUser)->postJson("/api/invoices/{$this->invoice->public_id}/paymongo-checkout");
        $res->assertStatus(409); // the financial state moved since the invoice was issued: refused, nothing handed out
        $this->assertNotSame('cs_unit_1', $res->json('data.checkout_session_id'));
        $this->assertSame(1, PaymentCheckoutSession::count());
    }

    public function test_one_provider_payment_id_can_settle_one_payment_only(): void
    {
        $this->settledSetup();
        $this->deliver($this->event())->assertOk();
        \Illuminate\Support\Facades\DB::table('visits')->where('id', $this->invoice->visit_id)->update(['status' => 'Completed', 'closed_at' => now()]);
        $second = Invoice::create(['treatment_id' => Treatment::create(['visit_id' => Visit::create(['patient_id' => $this->patient->id, 'branch_id' => $this->branch->id, 'clinic_date' => now()->toDateString(), 'source' => 'walk_in', 'status' => 'In Treatment', 'arrived_at' => now()])->id, 'dentist_profile_id' => $this->invoice->treatment->dentist_profile_id, 'status' => 'Completed', 'started_at' => now()->subHour(), 'completed_at' => now(), 'created_by_user_id' => $this->owner->id, 'updated_by_user_id' => $this->owner->id])->id,
            'visit_id' => $this->invoice->visit_id, 'patient_id' => $this->patient->id, 'branch_id' => $this->branch->id, 'invoice_number' => 'INV-2026-999902', 'status' => 'Issued', 'revision' => 2,
            'gross_amount' => '10.00', 'hmo_coverage_amount' => '0.00', 'patient_responsibility_amount' => '10.00', 'paid_amount' => '0.00', 'created_by_user_id' => $this->owner->id, 'updated_by_user_id' => $this->owner->id]);
        $this->expectException(\Illuminate\Database\UniqueConstraintViolationException::class);
        Payment::create(['invoice_id' => $second->id, 'amount' => '10.00', 'method' => 'PayMongo (CARD)', 'external_reference' => 'pay_unit_1', 'recorded_by_user_id' => $this->owner->id, 'recorded_at' => now()]);
    }

    public function test_the_reconciliation_worklist_is_read_only_and_scoped(): void
    {
        $this->actingAs($this->patientUser);
        $this->deliver($this->event('evt_review', 'cs_not_ours'));
        $this->actingAs($this->patientUser)->getJson('/api/billing/provider-events')->assertForbidden();
        $rows = $this->actingAs($this->owner)->getJson('/api/billing/provider-events')->assertOk()->json('data');
        $this->assertSame(['Needs review', 'unknown_checkout_session'], [$rows[0]['status'], $rows[0]['reason']]);
        $this->assertStringNotContainsString('payload', json_encode($rows));
        $staff = User::factory()->create(['role' => Role::Staff]);
        $this->actingAs($staff)->getJson('/api/billing/provider-events')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($this->owner)->postJson('/api/billing/provider-events', [])->assertStatus(405);
    }

    // ---- P3: line items, billing address, provider fixes ---------------------------------------------------------------

    private function sentAttributes(): array
    {
        $sent = Http::recorded(fn ($r) => $r->url() === 'https://api.paymongo.com/v2/checkout_sessions')->last();

        return $sent[0]->data()['data']['attributes'];
    }

    public function test_procedures_that_add_up_to_the_balance_are_sent_as_itemized_lines_and_paymongo_sends_no_receipt_of_its_own(): void
    {
        InvoiceLine::where('invoice_id', $this->invoice->id)->update(['unit_price' => '500.00', 'quantity' => 2, 'line_total' => '1000.00']);
        InvoiceLine::create(['invoice_id' => $this->invoice->id, 'service_id' => InvoiceLine::first()->service_id, 'service_price_id' => InvoiceLine::first()->service_price_id,
            'line_no' => 2, 'service_code' => 'FIL', 'service_name' => str_repeat('R', 255), 'quantity' => 1, 'unit_price' => '500.00', 'line_total' => '500.00']);
        $this->fakeCheckout();
        $this->actingAs($this->patientUser)->postJson("/api/invoices/{$this->invoice->public_id}/paymongo-checkout")->assertOk()->assertJsonPath('data.line_items_mode', 'itemized');
        $attr = $this->sentAttributes();
        $this->assertSame([['Dental Cleaning', 50000, 2], [str_repeat('R', 255), 50000, 1]],
            array_map(fn ($i) => [$i['name'], $i['amount'], $i['quantity']], $attr['line_items']));
        $this->assertLessThanOrEqual(255, mb_strlen($attr['line_items'][1]['name']));
        $this->assertFalse($attr['send_email_receipt']);
        $this->assertSame("http://localhost:5173/?invoice={$this->invoice->public_id}&payment=success#sign-in", $attr['success_url']);
        $this->assertSame("http://localhost:5173/?invoice={$this->invoice->public_id}&payment=cancelled#sign-in", $attr['cancel_url']);
    }

    public function test_an_hmo_share_or_earlier_payment_falls_back_to_one_balance_line_with_the_breakdown(): void
    {
        $service = app(\App\Services\Payment\PayMongoService::class);
        // The HMO gate is covered by the billing tests; here only what PayMongo would be shown is checked.
        $invoice = $this->invoice->fresh('lines')->forceFill(['hmo_coverage_amount' => '500.00', 'patient_responsibility_amount' => '1000.00']);
        [$items, $mode] = $service->lineItems($invoice, 100000);
        $this->assertSame('single', $mode);
        $this->assertSame([['Balance due for Invoice INV-2026-999901', 100000, 1, 'Charges PHP 1,500.00; Less coverage -PHP 500.00; Balance due PHP 1,000.00']],
            array_map(fn ($i) => [$i['name'], $i['amount'], $i['quantity'], $i['description']], $items));
        [$items, $mode] = $service->lineItems($this->invoice->fresh('lines')->forceFill(['paid_amount' => '200.00']), 130000);
        $this->assertSame(['single', 'Charges PHP 1,500.00; Already paid -PHP 200.00; Balance due PHP 1,300.00'], [$mode, $items[0]['description']]);
        [, $mode] = $service->lineItems($this->invoice->fresh('lines'), 150000);
        $this->assertSame('itemized', $mode);
    }

    public function test_a_balance_below_the_documented_minimum_is_refused_before_paymongo_is_called(): void
    {
        $this->invoice->update(['gross_amount' => '0.99', 'patient_responsibility_amount' => '0.99']);
        Http::fake();
        $this->actingAs($this->patientUser)->postJson("/api/invoices/{$this->invoice->public_id}/paymongo-checkout")->assertStatus(422)->assertJsonPath('code', 'amount_below_minimum');
        Http::assertNothingSent();
    }

    public function test_an_undocumented_payment_method_is_a_configuration_error(): void
    {
        config(['services.paymongo.payment_method_types' => 'card, venmo']);
        Http::fake();
        $this->actingAs($this->patientUser)->postJson("/api/invoices/{$this->invoice->public_id}/paymongo-checkout")->assertStatus(503)->assertJsonPath('code', 'payment_not_configured');
        Http::assertNothingSent();
    }

    public function test_creation_carries_an_idempotency_key_that_is_stable_for_a_retry_and_new_after_a_change(): void
    {
        $this->startCheckout('cs_unit_1');
        $first = Http::recorded(fn ($r) => str_contains($r->url(), 'v2/checkout_sessions'))->last()[0]->header('Idempotency-Key')[0];
        $this->assertMatchesRegularExpression('/^checkout-[0-9a-f]{48}$/', $first);
        PaymentCheckoutSession::query()->update(['amount' => '1400.00']); // balance changed: a new session is needed
        $this->fakeCheckout('cs_unit_2', 'cs_unit_1');
        $this->actingAs($this->patientUser)->postJson("/api/invoices/{$this->invoice->public_id}/paymongo-checkout")->assertOk();
        $second = Http::recorded(fn ($r) => str_contains($r->url(), 'v2/checkout_sessions'))->last()[0]->header('Idempotency-Key')[0];
        $this->assertNotSame($first, $second);
    }

    public function test_unconfirmed_expiry_blocks_a_second_checkout(): void
    {
        $this->startCheckout('cs_unit_1');
        PaymentCheckoutSession::query()->update(['amount' => '1400.00']);
        $this->freshHttp();
        Http::preventStrayRequests();
        Http::fake(['https://api.paymongo.com/v1/checkout_sessions/cs_unit_1/expire' => Http::response(['errors' => [['code' => 'resource_failed_state']]], 400),
            'https://api.paymongo.com/v1/checkout_sessions/cs_unit_1' => Http::response(['data' => ['id' => 'cs_unit_1', 'attributes' => ['status' => 'active']]])]);
        $this->actingAs($this->patientUser)->postJson("/api/invoices/{$this->invoice->public_id}/paymongo-checkout")->assertConflict()
            ->assertJsonPath('code', 'checkout_expiry_unconfirmed');
        Http::assertSent(fn ($r) => $r->method() === 'POST' && $r->url() === 'https://api.paymongo.com/v1/checkout_sessions/cs_unit_1/expire');
        Http::assertNotSent(fn ($r) => str_contains($r->url(), '/v2/checkout_sessions'));
        $this->assertSame('Open', PaymentCheckoutSession::where('provider_session_id', 'cs_unit_1')->value('status'));
    }

    public function test_branch_staff_can_close_an_authoritatively_unpaid_sandbox_checkout_and_collect_cash_once(): void
    {
        $this->startCheckout('cs_unit_1');
        $staff = User::factory()->create(['role' => Role::Staff]);
        UserBranchScope::create(['user_id' => $staff->id, 'branch_id' => $this->branch->id]);
        $path = "/api/invoices/{$this->invoice->public_id}";
        $key = ['Idempotency-Key' => 'close-checkout-fixture'];
        $body = ['expected_revision' => 2];
        $this->actingAs($this->owner)->postJson("$path/close-checkout", $body, $key)->assertForbidden();
        $this->freshHttp();
        Http::preventStrayRequests();
        Http::fake(['https://api.paymongo.com/v1/checkout_sessions/cs_unit_1/expire' => Http::response($this->expiredCheckout('cs_unit_1'))]);
        $this->actingAs($staff)->postJson("$path/close-checkout", $body, $key)->assertOk()
            ->assertJsonPath('data.has_open_checkout', false)->assertJsonPath('data.status', 'Issued')->assertJsonPath('data.revision', 3);
        $this->postJson("$path/close-checkout", $body, $key)->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        Http::assertSentCount(1);
        $this->postJson("$path/payment", ['expected_revision' => 3, 'method' => 'Cash', 'amount' => '1500.00'],
            ['Idempotency-Key' => 'collect-after-close'])->assertOk()->assertJsonPath('data.receipt.method', 'Cash');
        $this->assertSame(1, Payment::count());
        $this->assertSame(1, Receipt::count());
    }

    public function test_a_billing_address_is_sent_with_paymongo_keys_validated_and_saved_only_when_the_patient_ticks_save(): void
    {
        $url = "/api/invoices/{$this->invoice->public_id}/paymongo-checkout";
        $address = ['line1' => '37 MacArthur Hwy', 'line2' => '', 'city' => 'Bocaue', 'state' => 'Bulacan', 'postal_code' => '3018', 'country' => 'ph'];
        $this->fakeCheckout();
        $this->actingAs($this->patientUser)->postJson($url, ['billing_address' => $address])->assertOk();
        $this->assertSame(['line1' => '37 MacArthur Hwy', 'city' => 'Bocaue', 'state' => 'Bulacan', 'postal_code' => '3018', 'country' => 'PH'], $this->sentAttributes()['billing']['address']);
        $this->assertNull($this->patient->fresh()->billing_address, 'not saved without the tick');

        $this->fakeCheckout('cs_unit_2');
        $this->actingAs($this->patientUser)->postJson($url, ['billing_address' => $address + [], 'save_billing_address' => true])->assertOk()
            ->assertJsonPath('data.checkout_session_id', 'cs_unit_1'); // identical request: the open session is reused
        $this->assertSame('PH', $this->patient->fresh()->billing_address['country']);

        $this->fakeCheckout('cs_unit_3', 'cs_unit_1');
        $this->actingAs($this->patientUser)->postJson($url, ['billing_address' => ['line1' => 'x', 'country' => 'Philippines']])->assertStatus(422)
            ->assertJsonValidationErrors(['billing_address.city', 'billing_address.state', 'billing_address.postal_code', 'billing_address.country']);
        $this->actingAs($this->patientUser)->postJson($url, ['billing_address' => $address + ['street' => 'x']])->assertStatus(422);
        $this->actingAs($this->patientUser)->postJson($url, ['billing_address' => array_replace($address, ['city' => 'Malolos'])])->assertOk()
            ->assertJsonPath('data.checkout_session_id', 'cs_unit_3'); // a changed address starts a new session
    }

    public function test_payment_options_offer_plain_method_names_and_a_prefill_to_the_payer_only(): void
    {
        config(['services.paymongo.payment_method_types' => 'card,gcash,paymaya,qrph']);
        $url = "/api/invoices/{$this->invoice->public_id}/payment-options";
        $this->actingAs($this->patientUser)->getJson($url)->assertOk()
            ->assertJsonPath('data.methods', ['Card', 'GCash', 'Maya', 'QR Ph'])
            ->assertJsonPath('data.billing_address.country', 'PH')
            ->assertJsonPath('data.billing_address_saved', false)
            ->assertJsonPath('data.can_save_billing_address', true);
        $this->patient->forceFill(['billing_address' => ['line1' => 'Saved', 'city' => 'Bocaue', 'state' => 'Bulacan', 'postal_code' => '3018', 'country' => 'PH']])->save();
        $this->actingAs($this->patientUser)->getJson($url)->assertJsonPath('data.billing_address.line1', 'Saved')->assertJsonPath('data.billing_address_saved', true);
        $this->actingAs($this->owner)->getJson($url)->assertForbidden();
    }

    public function test_the_method_falls_back_to_the_sessions_payment_method_used(): void
    {
        $this->startCheckout('cs_unit_1');
        $payment = [['id' => 'pay_unit_1', 'attributes' => ['status' => 'paid', 'amount' => 150000, 'currency' => 'PHP']]];
        $this->fakeProvider('cs_unit_1', $payment, ['payment_method_used' => 'paymaya']);
        $this->deliver($this->event())->assertOk();
        $this->assertSame('PayMongo (MAYA)', \App\Models\Receipt::sole()->method);
    }

    public function test_a_signed_webhook_outside_the_five_minute_window_is_refused_as_a_replay(): void
    {
        $this->startCheckout('cs_unit_1');
        $this->fakeProvider('cs_unit_1', $this->paid());
        $raw = json_encode($this->event());
        $signed = fn (int $t) => "t={$t},te=".hash_hmac('sha256', $t.'.'.$raw, self::SECRET).',li=';
        $this->postRaw($raw, $signed(time() - 301))->assertStatus(400);
        $this->postRaw($raw, $signed(time() + 301))->assertStatus(400);
        $this->assertSame(0, \App\Models\PaymentProviderEvent::count(), 'a refused delivery is not stored');
        // A retry is re-signed with a fresh timestamp, so it is accepted (and settles once).
        $this->postRaw($raw, $signed(time() - 120))->assertOk();
        $this->postRaw($raw, $signed(time()))->assertOk();
        $this->assertSame(1, \App\Models\Receipt::count());
    }
}

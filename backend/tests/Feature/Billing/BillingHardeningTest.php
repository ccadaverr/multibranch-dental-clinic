<?php

namespace Tests\Feature\Billing;

use App\Enums\Role;
use App\Models\{AuditLog,HmoCase,Invoice,InvoiceHistory,PatientHmoMembership,Payment,Receipt,ServicePrice,Treatment,TreatmentProcedure,Visit};
use App\Services\Audit\AuditService;
use App\Services\Billing\BillingException;
use App\Services\Billing\BillingService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** M11 hardening: server-owned money and state, role/branch/IDOR boundaries, audit participation, decimal-safe arithmetic. */
class BillingHardeningTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private int $key = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        DB::table('m11_billing_cutovers')->where('id', 1)->update(['established_at' => '2026-09-01 00:00:00+08']);
        $this->travelTo(CarbonImmutable::parse('2026-09-28 10:00:00', 'Asia/Manila'));
    }

    private function key(): string { return 'm11-'.(++$this->key); }

    private function completed(string $service = 'svc1', string $branch = 'b1', string $when = '2026-09-28 09:00:00'): Treatment
    {
        $visit = Visit::create(['patient_id' => $this->p['A']->id, 'branch_id' => $this->b[$branch]->id, 'source' => 'walk_in', 'status' => 'In Treatment', 'responsible_dentist_profile_id' => $this->d[$branch === 'b1' ? 'd1' : 'd3']->id, 'requested_service_id' => $this->svc[$service]->id, 'arrived_at' => $when, 'clinic_date' => substr($when, 0, 10), 'revision' => 1, 'created_by_user_id' => $this->u['staffB1']->id, 'updated_by_user_id' => $this->u['staffB1']->id]);
        $treatment = Treatment::create(['visit_id' => $visit->id, 'dentist_profile_id' => $visit->responsible_dentist_profile_id, 'status' => 'In Treatment', 'procedure_summary' => 'Completed procedure', 'started_at' => $when, 'revision' => 1, 'created_by_user_id' => $this->u['dentist1']->id, 'updated_by_user_id' => $this->u['dentist1']->id]);
        TreatmentProcedure::create(['treatment_id' => $treatment->id, 'service_id' => $this->svc[$service]->id, 'line_no' => 1, 'quantity' => 2, 'service_code' => $this->svc[$service]->code, 'service_name' => $this->svc[$service]->name]);
        DB::transaction(function () use ($treatment, $visit, $when) {
            $visit->update(['status' => 'Completed', 'closed_at' => $when, 'revision' => 2]);
            $treatment->update(['status' => 'Completed', 'completed_at' => $when, 'revision' => 2]);
        });
        return $treatment->fresh(['visit.branch','visit.patient.person','procedures.service']);
    }

    private function price(string $service = 'svc1', string $branch = 'b1', string $amount = '125.50', string $date = '2026-09-01'): ServicePrice
    {
        return ServicePrice::create(['service_id' => $this->svc[$service]->id, 'branch_id' => $this->b[$branch]->id, 'kind' => 'priced', 'amount' => $amount, 'effective_from' => $date, 'source' => 'owner_confirmed', 'created_by_user_id' => $this->u['owner']->id, 'created_at' => now()]);
    }

    private function hmoCase(Treatment $t, string $status, ?string $approved = null): HmoCase
    {
        $membership = PatientHmoMembership::create(['patient_id'=>$this->p['A']->id,'provider_name'=>'Insurer','member_number'=>'M-'.uniqid(),'status'=>'active','created_by_user_id'=>$this->u['staffB1']->id,'created_at'=>now()]);
        $final = in_array($status, ['Approved','Rejected','Withdrawn'], true);
        $submitted = in_array($status, ['Pending','Escalated','Returned','Approved','Rejected'], true);
        return HmoCase::create(['visit_id'=>$t->visit_id,'patient_id'=>$this->p['A']->id,'branch_id'=>$this->b['b1']->id,'membership_id'=>$membership->id,'provider_name'=>'Insurer','member_number'=>$membership->member_number,'status'=>$status,'submission_cycle'=>$submitted?1:0,'submitted_at'=>$submitted?now():null,'escalated_at'=>$status==='Escalated'?now():null,'final_at'=>$final?now():null,'approved_amount'=>$status==='Approved'?$approved:null,'revision'=>1,'created_by_user_id'=>$this->u['staffB1']->id,'updated_by_user_id'=>$this->u['staffB1']->id]);
    }

    private function createInvoice(Treatment $t): \Illuminate\Testing\TestResponse
    {
        $this->actingAsUser('staffB1');
        return $this->postJson("/api/invoices/from-treatment/{$t->public_id}", [], ['Idempotency-Key' => $this->key()]);
    }


    private function issued(string $amount = '125.50'): Invoice
    {
        $this->price('svc1', 'b1', $amount);
        $invoice = Invoice::where('public_id', $this->createInvoice($this->completed())->json('data.id'))->firstOrFail();
        $this->actingAsUser('staffB1');
        $this->postJson("/api/invoices/{$invoice->public_id}/review", ['expected_revision' => 1], ['Idempotency-Key' => $this->key()])->assertOk();
        $this->postJson("/api/invoices/{$invoice->public_id}/issue", ['expected_revision' => 2], ['Idempotency-Key' => $this->key()])->assertOk();

        return $invoice->fresh();
    }

    /** A verified booking deposit is fixture evidence; exercise the real invoice-issue command to apply its credit. */
    private function issuedWithBookingDeposit(string $deposit = '300.00'): Invoice
    {
        Http::preventStrayRequests();
        Mail::fake();
        $this->price('svc1', 'b1', '500.00'); // The existing completed-treatment fixture has quantity two.
        $treatment = $this->completed();
        $appointment = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '09:00', 30, 'Completed');
        $appointment->update([
            'booking_payment_status' => 'paid', 'booking_fee_php' => $deposit,
            'booking_payment_ref' => 'fin01-booking-fixture', 'booking_payment_method' => 'PayMongo (GCASH)',
            'booking_paid_at' => now()->subDay(),
        ]);
        $treatment->visit->update(['source' => 'appointment', 'appointment_id' => $appointment->id]);
        $invoice = Invoice::where('public_id', $this->createInvoice($treatment)->assertCreated()->json('data.id'))->firstOrFail();
        $this->postJson("/api/invoices/{$invoice->public_id}/review", ['expected_revision' => 1], ['Idempotency-Key' => $this->key()])->assertOk();
        $this->postJson("/api/invoices/{$invoice->public_id}/issue", ['expected_revision' => 2], ['Idempotency-Key' => $this->key()])->assertOk();

        return $invoice->fresh(['visit.appointment', 'payment', 'receipt']);
    }

    public function test_booking_deposit_plus_cash_remainder_preserves_credit_and_replays_once(): void
    {
        $invoice = $this->issuedWithBookingDeposit();
        $this->assertSame(['Issued', '300.00', '700.00', 'partial_booking_deposit'], [
            $invoice->status, (string) $invoice->paid_amount, $invoice->balance(), $invoice->settlement_type,
        ]);
        $this->assertSame([0, 0], [Payment::count(), Receipt::count()]);
        $key = $this->key();
        $payload = ['expected_revision' => 3, 'method' => 'Cash', 'amount' => '700.00'];
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", $payload, ['Idempotency-Key' => $key])
            ->assertOk()->assertJsonPath('data.status', 'Paid')->assertJsonPath('data.paid_amount', '1000.00')
            ->assertJsonPath('data.balance', '0.00')->assertJsonPath('data.payment.amount', '700.00')
            ->assertJsonPath('data.receipt.amount', '700.00');
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", $payload, ['Idempotency-Key' => $key])
            ->assertOk()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.paid_amount', '1000.00');
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", $payload, ['Idempotency-Key' => $this->key()])
            ->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        $this->assertSame([1, 1, 1], [Payment::count(), Receipt::count(), AuditLog::where('action', 'billing.payment_recorded')->count()]);
        $this->assertSame('1000.00', InvoiceHistory::where('invoice_id', $invoice->id)->where('event', 'invoice.paid')->sole()->snapshot['paid_amount']);
        $this->assertSame('700.00', AuditLog::where('action', 'billing.payment_recorded')->sole()->payload['amount']);
        $this->assertSame('300.00', (string) $invoice->visit->appointment->fresh()->booking_fee_php);
    }

    public function test_booking_deposit_plus_verified_online_remainder_preserves_credit_and_provider_replay(): void
    {
        $invoice = $this->issuedWithBookingDeposit();
        $billing = app(BillingService::class);
        // This service boundary receives an already-verified capture; no provider HTTP call is made by this test.
        $paid = $billing->payOnline($invoice, 'PayMongo (CARD)', 'fin01-remainder-fixture', $this->u['patientA'], '700.00');
        $this->assertSame(['Paid', '1000.00', '0.00'], [$paid->status, (string) $paid->paid_amount, $paid->balance()]);
        $this->assertSame(['700.00', 'fin01-remainder-fixture'], [(string) $paid->payment->amount, $paid->payment->external_reference]);
        $this->assertSame('700.00', (string) $paid->receipt->amount);
        $replayed = $billing->payOnline($paid, 'PayMongo (CARD)', 'fin01-remainder-fixture', $this->u['patientA'], '700.00');
        $this->assertSame($paid->id, $replayed->id);
        $this->assertSame([1, 1, 1], [Payment::count(), Receipt::count(), InvoiceHistory::where('event', 'invoice.paid')->count()]);
    }

    public function test_booking_credit_and_remainder_keep_exact_centavos(): void
    {
        $invoice = $this->issuedWithBookingDeposit('300.01');
        $this->assertSame('699.99', $invoice->balance());
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", [
            'expected_revision' => 3, 'method' => 'Cash', 'amount' => '699.99',
        ], ['Idempotency-Key' => $this->key()])->assertOk()->assertJsonPath('data.paid_amount', '1000.00')
            ->assertJsonPath('data.balance', '0.00')->assertJsonPath('data.receipt.amount', '699.99');
    }

    public function test_booking_remainder_refuses_a_mismatched_verified_capture_without_writes(): void
    {
        $invoice = $this->issuedWithBookingDeposit();
        try {
            app(BillingService::class)->payOnline($invoice, 'PayMongo (CARD)', 'fin01-wrong-capture-fixture', $this->u['patientA'], '1000.00');
            $this->fail('The captured amount must equal the remainder, not the full responsibility.');
        } catch (BillingException $e) {
            $this->assertSame('amount_mismatch', $e->responseBody()['code']);
        }
        $this->assertSame([0, 0, 'Issued', '300.00', 3], [Payment::count(), Receipt::count(), $invoice->fresh()->status, (string) $invoice->fresh()->paid_amount, $invoice->fresh()->revision]);
        $this->assertSame(0, InvoiceHistory::where('event', 'invoice.paid')->count());
    }

    public function test_full_booking_deposit_settles_at_issue_and_cannot_collect_again(): void
    {
        $invoice = $this->issuedWithBookingDeposit('1000.00');
        $this->assertSame(['Paid', '1000.00', '0.00', 'booking_deposit'], [
            $invoice->status, (string) $invoice->paid_amount, $invoice->balance(), $invoice->settlement_type,
        ]);
        $this->assertSame('1000.00', (string) $invoice->payment->amount);
        $this->assertSame('1000.00', (string) $invoice->receipt->amount);
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", [
            'expected_revision' => 3, 'method' => 'Cash', 'amount' => '0.00',
        ], ['Idempotency-Key' => $this->key()])->assertStatus(422)->assertJsonPath('code', 'already_paid');
        $this->assertSame([1, 1], [Payment::count(), Receipt::count()]);
    }

    public function test_zero_remaining_balance_does_not_create_a_zero_payment_on_an_issued_invoice(): void
    {
        $invoice = $this->issuedWithBookingDeposit();
        // Deliberately inconsistent lifecycle fixture: a fully credited invoice still marked Issued.
        $invoice->update(['paid_amount' => '1000.00']);
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", [
            'expected_revision' => 3, 'method' => 'Cash', 'amount' => '0.00',
        ], ['Idempotency-Key' => $this->key()])->assertStatus(422)->assertJsonPath('code', 'already_paid');
        $this->assertSame([0, 0, 'Issued', 3], [Payment::count(), Receipt::count(), $invoice->fresh()->status, $invoice->fresh()->revision]);
    }

    public function test_booking_remainder_rejects_wrong_amount_reference_revision_and_branch_without_writes(): void
    {
        $invoice = $this->issuedWithBookingDeposit();
        $path = "/api/invoices/{$invoice->public_id}/payment";
        foreach (['1000.00', '699.99', '0.00'] as $amount) {
            $this->postJson($path, ['expected_revision' => 3, 'method' => 'Cash', 'amount' => $amount], ['Idempotency-Key' => $this->key()])
                ->assertStatus(422)->assertJsonPath('code', 'invalid_payment_amount');
        }
        $this->postJson($path, ['expected_revision' => 3, 'method' => 'Card/POS', 'amount' => '700.00'], ['Idempotency-Key' => $this->key()])
            ->assertStatus(422)->assertJsonPath('code', 'invalid_payment_reference');
        $this->postJson($path, ['expected_revision' => 2, 'method' => 'Cash', 'amount' => '700.00'], ['Idempotency-Key' => $this->key()])
            ->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        $this->actingAsUser('staffB2');
        $this->postJson($path, ['expected_revision' => 3, 'method' => 'Cash', 'amount' => '700.00'], ['Idempotency-Key' => $this->key()])->assertForbidden();
        $this->assertSame([0, 0, 'Issued', '300.00', 3], [Payment::count(), Receipt::count(), $invoice->fresh()->status, (string) $invoice->fresh()->paid_amount, $invoice->fresh()->revision]);
        $this->assertSame(0, InvoiceHistory::where('event', 'invoice.paid')->count());
        $this->assertSame(0, AuditLog::where('action', 'billing.payment_recorded')->count());
    }

    public function test_booking_credit_survives_a_failed_remainder_payment_transaction(): void
    {
        $invoice = $this->issuedWithBookingDeposit();
        $this->app->bind(AuditService::class, fn () => new class extends AuditService {
            public function record(array $attributes): AuditLog
            {
                throw new \RuntimeException('fin01 audit fixture unavailable');
            }
        });
        $this->withoutExceptionHandling();
        try {
            $this->postJson("/api/invoices/{$invoice->public_id}/payment", [
                'expected_revision' => 3, 'method' => 'Cash', 'amount' => '700.00',
            ], ['Idempotency-Key' => $this->key()]);
            $this->fail('A remainder payment must roll back if its audit cannot be written.');
        } catch (\RuntimeException $e) {
            $this->assertSame('fin01 audit fixture unavailable', $e->getMessage());
        }
        $this->assertSame([0, 0, 'Issued', '300.00', 3], [Payment::count(), Receipt::count(), $invoice->fresh()->status, (string) $invoice->fresh()->paid_amount, $invoice->fresh()->revision]);
        $this->assertSame(0, InvoiceHistory::where('event', 'invoice.paid')->count());
        $this->assertSame(0, DB::table('command_keys')->where('command', 'billing.payment')->count());
    }

    // ---- arithmetic and price authority -----------------------------------------------------------------------------

    public function test_money_is_exact_decimal_arithmetic_end_to_end(): void
    {
        // 19.99 x 2 and 0.29 x 2 are the classic binary-float traps (39.980000000000004, 0.5800000000000001). Prices are
        // append-only M13 versions, so each case uses its own effective date and treatment date.
        $day = 1;
        foreach (['19.99' => '39.98', '0.29' => '0.58', '33.33' => '66.66', '1234567.89' => '2469135.78'] as $unit => $total) {
            $date = sprintf('2026-09-%02d', ++$day);
            $this->price('svc1', 'b1', $unit, $date);
            $created = $this->createInvoice($this->completed('svc1', 'b1', "{$date} 09:00:00"))->assertCreated();
            $this->assertSame($total, $created->json('data.gross_amount'), "gross for unit {$unit}");
            $this->assertSame($total, $created->json('data.lines.0.line_total'));
            $this->assertIsString($created->json('data.gross_amount'), 'money crosses the API as a decimal string');
        }
    }

    public function test_partial_hmo_coverage_is_exact_and_the_balance_is_the_remainder(): void
    {
        $this->price('svc1', 'b1', '125.50');
        $t = $this->completed();
        $membership = PatientHmoMembership::create(['patient_id' => $this->p['A']->id, 'provider_name' => 'Insurer', 'member_number' => 'M-9', 'status' => 'active', 'created_by_user_id' => $this->u['staffB1']->id, 'created_at' => now()]);
        $this->hmoApproved($t, $membership, '100.10');
        $invoice = Invoice::where('public_id', $this->createInvoice($t)->json('data.id'))->firstOrFail();
        $this->actingAsUser('staffB1');
        $this->postJson("/api/invoices/{$invoice->public_id}/review", ['expected_revision' => 1], ['Idempotency-Key' => $this->key()]);
        $issued = $this->postJson("/api/invoices/{$invoice->public_id}/issue", ['expected_revision' => 2], ['Idempotency-Key' => $this->key()])->assertOk();
        $this->assertSame(['251.00', '100.10', '150.90', 'Issued', '150.90'], [$issued->json('data.gross_amount'), $issued->json('data.hmo_coverage_amount'), $issued->json('data.patient_responsibility_amount'), $issued->json('data.status'), $issued->json('data.balance')]);
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", ['expected_revision' => 3, 'method' => 'Cash', 'amount' => '251.00'], ['Idempotency-Key' => $this->key()])->assertStatus(422)->assertJsonPath('code', 'invalid_payment_amount');
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", ['expected_revision' => 3, 'method' => 'Cash', 'amount' => '150.90'], ['Idempotency-Key' => $this->key()])->assertOk();
        $this->assertSame('150.90', (string) Payment::sole()->amount);
        $this->assertSame('150.90', (string) Receipt::sole()->amount);
    }

    private function hmoApproved(Treatment $t, $membership, string $amount): void
    {
        HmoCase::create(['visit_id' => $t->visit_id, 'patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id, 'membership_id' => $membership->id, 'provider_name' => 'Insurer', 'member_number' => $membership->member_number, 'status' => 'Approved', 'submission_cycle' => 1, 'submitted_at' => now(), 'final_at' => now(), 'approved_amount' => $amount, 'revision' => 2, 'created_by_user_id' => $this->u['staffB1']->id, 'updated_by_user_id' => $this->u['staffB1']->id]);
    }

    public function test_a_later_price_change_never_rewrites_an_existing_invoice(): void
    {
        $invoice = $this->issued('125.50');
        $this->price('svc1', 'b1', '999.00', '2026-09-28'); // a newer M13 price version
        $this->actingAsUser('staffB1');
        $shown = $this->getJson("/api/invoices/{$invoice->public_id}")->assertOk();
        $this->assertSame(['125.50', '251.00', '251.00'], [$shown->json('data.lines.0.unit_price'), $shown->json('data.gross_amount'), $shown->json('data.patient_responsibility_amount')]);
    }

    public function test_m11_prices_exactly_what_the_m13_resolver_returns_for_branch_base_and_missing_prices(): void
    {
        $resolver = app(\App\Services\Pricing\PriceResolver::class);
        // Base price for svc1 plus a branch override at b1; svc2 has only a base price; a third treatment has no price at all.
        ServicePrice::create(['service_id' => $this->svc['svc1']->id, 'branch_id' => null, 'kind' => 'priced', 'amount' => '100.10', 'effective_from' => '2026-09-01', 'source' => 'owner_confirmed', 'created_by_user_id' => $this->u['owner']->id, 'created_at' => now()]);
        $this->price('svc1', 'b1', '125.55', '2026-09-15');
        ServicePrice::create(['service_id' => $this->svc['svc2']->id, 'branch_id' => null, 'kind' => 'priced', 'amount' => '19.99', 'effective_from' => '2026-09-01', 'source' => 'owner_confirmed', 'created_by_user_id' => $this->u['owner']->id, 'created_at' => now()]);

        $branchTreated = $this->completed('svc1');
        $baseTreated = $this->completed('svc2');
        foreach ([[$branchTreated, 'svc1', '125.55', 'branch'], [$baseTreated, 'svc2', '19.99', 'base']] as [$treatment, $service, $amount, $level]) {
            $direct = $resolver->resolve($this->svc[$service], $this->b['b1'], '2026-09-28');
            $this->assertSame([$amount, $level], [$direct->amount(), $direct->level()]);
            $line = $this->createInvoice($treatment)->assertCreated()->json('data.lines.0');
            $this->assertSame($direct->amount(), $line['unit_price'], 'M11 snapshots exactly the M13 price');
        }
        // 19.99 x 2 and 125.55 x 2 are exact.
        $this->assertSame('39.98', Invoice::whereHas('treatment', fn ($q) => $q->whereKey($baseTreated->id))->value('gross_amount'));
        $this->assertSame('251.10', Invoice::whereHas('treatment', fn ($q) => $q->whereKey($branchTreated->id))->value('gross_amount'));

        // The base price applies to a branch with no override of its own (b2 is billed the base).
        $this->assertSame('100.10', $resolver->resolve($this->svc['svc1'], $this->b['b2'], '2026-09-28')->amount());
        // No authoritative price on the treatment's clinic date (before the first version): an explicit refusal, never a guess or the reference fee.
        $unpriced = $this->completed('svc1', 'b1', '2026-08-15 09:00:00');
        $this->createInvoice($unpriced)->assertStatus(422);
        $this->assertSame(0, Invoice::whereHas('treatment', fn ($q) => $q->whereKey($unpriced->id))->count());
    }

    public function test_payment_amounts_are_validated_decimals_and_never_negative_zero_or_exponent(): void
    {
        $invoice = $this->issued();
        foreach (['-1', '0', '0.00', '1e3', '0.001', 'abc', '251.001', '251,00', '+251.00', '0x10'] as $bad) {
            $this->postJson("/api/invoices/{$invoice->public_id}/payment", ['expected_revision' => 3, 'method' => 'Cash', 'amount' => $bad], ['Idempotency-Key' => $this->key()])->assertStatus(422);
        }
        $this->assertSame([0, 'Issued'], [Payment::count(), $invoice->fresh()->status]);
    }

    // ---- server-owned fields ----------------------------------------------------------------------------------------

    public function test_money_state_ownership_and_evidence_fields_are_refused_on_every_command(): void
    {
        $this->price();
        $t = $this->completed();
        $invoice = Invoice::where('public_id', $this->createInvoice($t)->json('data.id'))->firstOrFail();
        $forged = ['status' => 'Paid', 'total' => '1.00', 'subtotal' => '1.00', 'gross_amount' => '1.00', 'hmo_coverage_amount' => '251.00', 'patient_responsibility_amount' => '0.00', 'amount_due' => '0.00',
            'balance' => '0.00', 'paid_amount' => '251.00', 'settlement_type' => 'full_hmo_coverage', 'receipt_number' => 'RCT-FORGED', 'provider_status' => 'paid', 'provider_transaction_id' => 'pay_forged',
            'created_by' => 1, 'paid_by' => 1, 'patient_id' => 1, 'branch_id' => 1, 'lines' => [['unit_price' => '0.01']], 'issued_at' => '2000-01-01', 'paid_at' => '2000-01-01', 'revision' => 99, 'id' => 1, 'public_id' => 'x'];
        $this->actingAsUser('staffB1');
        foreach ($forged as $field => $value) {
            $this->postJson("/api/invoices/{$invoice->public_id}/review", [$field => $value, 'expected_revision' => 1], ['Idempotency-Key' => $this->key()])->assertStatus(422)->assertJsonValidationErrors($field);
            $this->postJson("/api/invoices/{$invoice->public_id}/issue", [$field => $value, 'expected_revision' => 1], ['Idempotency-Key' => $this->key()])->assertStatus(422)->assertJsonValidationErrors($field);
            $this->postJson("/api/invoices/{$invoice->public_id}/payment", [$field => $value, 'expected_revision' => 1, 'method' => 'Cash'], ['Idempotency-Key' => $this->key()])->assertStatus(422)->assertJsonValidationErrors($field);
            $this->postJson("/api/invoices/from-treatment/{$t->public_id}", [$field => $value], ['Idempotency-Key' => $this->key()])->assertStatus(422)->assertJsonValidationErrors($field);
        }
        $fresh = $invoice->fresh();
        $this->assertSame(['Draft', '251.00', '0.00', 1, 0, 0], [$fresh->status, (string) $fresh->gross_amount, (string) $fresh->paid_amount, $fresh->revision, Payment::count(), Receipt::count()]);
    }

    // ---- roles, branches and IDOR ----------------------------------------------------------------------------------

    public function test_the_financial_access_matrix(): void
    {
        $invoice = $this->issued();
        $show = "/api/invoices/{$invoice->public_id}";
        $this->app['auth']->forgetGuards();
        foreach (['/api/invoices', $show, '/api/invoices/mine', '/api/receipts/mine', '/api/billing/treatments', '/api/billing/provider-events'] as $url) {
            $this->getJson($url)->assertUnauthorized();
        }
        // Owner: read-only management view, never a mutation.
        $this->actingAsUser('owner');
        $this->getJson('/api/invoices')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson($show)->assertOk();
        $this->getJson('/api/billing/treatments')->assertOk();
        $this->postJson("{$show}/payment", ['expected_revision' => 3, 'method' => 'Cash'], ['Idempotency-Key' => $this->key()])->assertForbidden();
        $this->postJson("{$show}/review", ['expected_revision' => 3], ['Idempotency-Key' => $this->key()])->assertForbidden();
        $this->getJson('/api/invoices/mine')->assertForbidden();
        // Dentist: no financial access merely because they treated the Patient.
        $this->actingAsUser('dentist1');
        foreach (['/api/invoices', $show, '/api/invoices/mine', '/api/receipts/mine', '/api/billing/treatments', '/api/billing/provider-events'] as $url) {
            $this->getJson($url)->assertForbidden();
        }
        $this->postJson("{$show}/payment", ['expected_revision' => 3, 'method' => 'Cash'], ['Idempotency-Key' => $this->key()])->assertForbidden();
        // Staff of another branch, and Staff with no scope.
        foreach (['staffB2', 'staffNone'] as $who) {
            $this->actingAsUser($who);
            $this->getJson($show)->assertForbidden();
            $this->getJson('/api/invoices')->assertStatus($who === 'staffNone' ? 200 : 200)->assertJsonCount(0, 'data');
            $this->postJson("{$show}/payment", ['expected_revision' => 3, 'method' => 'Cash'], ['Idempotency-Key' => $this->key()])->assertForbidden();
            $this->postJson("{$show}/review", ['expected_revision' => 3], ['Idempotency-Key' => $this->key()])->assertForbidden();
        }
        // Patients never mutate; they see only their own.
        $this->actingAsUser('patientA');
        $this->getJson($show)->assertOk();
        $this->postJson("{$show}/payment", ['expected_revision' => 3, 'method' => 'Cash'], ['Idempotency-Key' => $this->key()])->assertForbidden();
        $this->getJson('/api/invoices')->assertForbidden();
        $this->assertSame([0, 'Issued'], [Payment::count(), $invoice->fresh()->status]);
    }

    public function test_one_patient_cannot_see_another_patients_invoice_or_receipt(): void
    {
        $invoice = $this->issued();
        $this->actingAsUser('staffB1');
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", ['expected_revision' => 3, 'method' => 'Cash'], ['Idempotency-Key' => $this->key()])->assertOk();
        $this->actingAsUser('patientB');
        $this->getJson("/api/invoices/{$invoice->public_id}")->assertForbidden();
        $this->assertCount(0, $this->getJson('/api/invoices/mine')->assertOk()->json('data'));
        $this->assertCount(0, $this->getJson('/api/receipts/mine')->assertOk()->json('data'));
        $this->actingAsUser('patientA');
        $this->assertCount(1, $this->getJson('/api/receipts/mine')->assertOk()->json('data'));
        $json = json_encode($this->getJson('/api/invoices/mine')->json());
        foreach (['"patient_id"', '"created_by_user_id"', '"recorded_by_user_id"', '"treatment_id":1', '"invoice_id":'] as $leak) {
            $this->assertStringNotContainsString($leak, $json);
        }
    }

    public function test_invoices_resolve_by_public_id_only(): void
    {
        $invoice = $this->issued();
        $this->actingAsUser('staffB1');
        $this->getJson('/api/invoices/'.$invoice->id)->assertNotFound();
        $this->getJson('/api/invoices/not-a-ulid')->assertNotFound();
        $this->getJson('/api/invoices/01ARZ3NDEKTSV4RRFFQ69G5FAV')->assertNotFound();
        $this->postJson('/api/invoices/'.$invoice->id.'/payment', ['expected_revision' => 3, 'method' => 'Cash'], ['Idempotency-Key' => $this->key()])->assertNotFound();
        $this->postJson('/api/invoices/from-treatment/'.Treatment::first()->id, [], ['Idempotency-Key' => $this->key()])->assertNotFound();
    }

    // ---- audit participation ---------------------------------------------------------------------------------------

    public function test_issue_and_staff_payment_write_safe_audit_events(): void
    {
        $invoice = $this->issued();
        $issue = AuditLog::where('action', 'billing.invoice_issued')->sole();
        $this->assertSame(['financial', 'Invoice', $invoice->public_id, $this->b['b1']->id, $this->u['staffB1']->id], [$issue->category, $issue->auditable_type, $issue->auditable_public_id, $issue->branch_id, $issue->actor_user_id]);
        $this->assertSame('251.00', $issue->payload['gross_amount']);
        $this->actingAsUser('staffB1');
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", ['expected_revision' => 3, 'method' => 'Card/POS', 'external_reference' => 'POS-SECRET-REF-1'], ['Idempotency-Key' => $this->key()])->assertOk();
        $pay = AuditLog::where('action', 'billing.payment_recorded')->sole();
        $this->assertEqualsCanonicalizing(['invoice_number', 'receipt_number', 'amount', 'method'], array_keys($pay->payload));
        $this->assertSame('251.00', $pay->payload['amount']);
        $this->assertStringNotContainsString('POS-SECRET-REF-1', json_encode($pay->payload));
    }

    public function test_a_replayed_payment_command_writes_one_audit_event(): void
    {
        $invoice = $this->issued();
        $this->actingAsUser('staffB1');
        $key = $this->key();
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", ['expected_revision' => 3, 'method' => 'Cash'], ['Idempotency-Key' => $key])->assertOk();
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", ['expected_revision' => 3, 'method' => 'Cash'], ['Idempotency-Key' => $key])->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->assertSame([1, 1, 1], [Payment::count(), Receipt::count(), AuditLog::where('action', 'billing.payment_recorded')->count()]);
    }

    public function test_a_staff_payment_and_its_audit_event_commit_or_roll_back_together(): void
    {
        $invoice = $this->issued();
        $this->app->bind(AuditService::class, fn () => new class extends AuditService {
            public function record(array $attributes): AuditLog
            {
                throw new \RuntimeException('audit store unavailable');
            }
        });
        $this->actingAsUser('staffB1');
        $this->withoutExceptionHandling();
        try {
            $this->postJson("/api/invoices/{$invoice->public_id}/payment", ['expected_revision' => 3, 'method' => 'Cash'], ['Idempotency-Key' => $this->key()]);
            $this->fail('a payment must not commit without its audit event');
        } catch (\RuntimeException $e) {
            $this->assertSame('audit store unavailable', $e->getMessage());
        }
        $this->assertSame([0, 0, 'Issued', 3], [Payment::count(), Receipt::count(), $invoice->fresh()->status, $invoice->fresh()->revision]);
    }

    public function test_full_hmo_settlement_is_audited_as_hmo_coverage_with_no_payment_or_receipt(): void
    {
        $this->price();
        $t = $this->completed();
        $membership = PatientHmoMembership::create(['patient_id' => $this->p['A']->id, 'provider_name' => 'Insurer', 'member_number' => 'M-3', 'status' => 'active', 'created_by_user_id' => $this->u['staffB1']->id, 'created_at' => now()]);
        $this->hmoApproved($t, $membership, '251.00');
        $invoice = Invoice::where('public_id', $this->createInvoice($t)->json('data.id'))->firstOrFail();
        $this->actingAsUser('staffB1');
        $this->postJson("/api/invoices/{$invoice->public_id}/review", ['expected_revision' => 1], ['Idempotency-Key' => $this->key()]);
        $this->postJson("/api/invoices/{$invoice->public_id}/issue", ['expected_revision' => 2], ['Idempotency-Key' => $this->key()])->assertOk()->assertJsonPath('data.settlement_type', 'full_hmo_coverage');
        $this->assertSame([0, 0, 0, 1, 0], [Payment::count(), Receipt::count(), (int) (string) $invoice->fresh()->paid_amount, AuditLog::where('action', 'billing.invoice_settled_by_hmo')->count(), AuditLog::where('action', 'billing.payment_recorded')->count()]);
        $this->assertSame('full_hmo_coverage', AuditLog::where('action', 'billing.invoice_settled_by_hmo')->sole()->payload['settlement_type']);
        // Paid is terminal: nothing can pay or re-issue it.
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", ['expected_revision' => 3, 'method' => 'Cash'], ['Idempotency-Key' => $this->key()])->assertStatus(422)->assertJsonPath('code', 'already_paid');
        $this->postJson("/api/invoices/{$invoice->public_id}/issue", ['expected_revision' => 3], ['Idempotency-Key' => $this->key()])->assertStatus(422);
    }

    // ---- pagination ---------------------------------------------------------------------------------------------------

    /** @return list<string> public ids, oldest first */
    private function manyInvoices(int $n): array
    {
        $this->price();
        $ids = [];
        for ($i = 0; $i < $n; $i++) {
            $ids[] = $this->createInvoice($this->completed())->assertCreated()->json('data.id');
        }

        return $ids;
    }

    public function test_the_staff_invoice_list_is_cursor_paged_newest_first_with_no_gaps_or_repeats(): void
    {
        $made = $this->manyInvoices(5);
        $newestFirst = array_reverse($made);
        $this->actingAsUser('staffB1');

        $page1 = $this->getJson('/api/invoices?per_page=2')->assertOk();
        $this->assertSame(array_slice($newestFirst, 0, 2), array_column($page1->json('data'), 'id'));
        $this->assertSame([2, $newestFirst[1]], [$page1->json('meta.per_page'), $page1->json('meta.next_cursor')]);
        $page2 = $this->getJson('/api/invoices?per_page=2&cursor='.$page1->json('meta.next_cursor'))->assertOk();
        $page3 = $this->getJson('/api/invoices?per_page=2&cursor='.$page2->json('meta.next_cursor'))->assertOk();
        $this->assertSame(array_slice($newestFirst, 2, 2), array_column($page2->json('data'), 'id'));
        $this->assertSame([$newestFirst[4]], array_column($page3->json('data'), 'id'));
        $this->assertNull($page3->json('meta.next_cursor'), 'the last page has no cursor');

        // An invoice created while paging neither shifts nor repeats rows already paged through.
        $late = $this->createInvoice($this->completed())->assertCreated()->json('data.id');
        $again = $this->getJson('/api/invoices?per_page=2&cursor='.$page1->json('meta.next_cursor'))->assertOk();
        $this->assertSame(array_slice($newestFirst, 2, 2), array_column($again->json('data'), 'id'));
        $this->assertSame($late, $this->getJson('/api/invoices?per_page=1')->json('data.0.id'));
        $all = [];
        $cursor = null;
        do {
            $page = $this->getJson('/api/invoices?per_page=2'.($cursor ? "&cursor={$cursor}" : ''))->assertOk();
            array_push($all, ...array_column($page->json('data'), 'id'));
            $cursor = $page->json('meta.next_cursor');
        } while ($cursor);
        $this->assertCount(6, $all);
        $this->assertSame($all, array_values(array_unique($all)), 'no repeats');
        $this->assertEqualsCanonicalizing([...$made, $late], $all, 'no omissions');
    }

    public function test_the_page_size_is_bounded_and_the_default_is_stated(): void
    {
        $this->manyInvoices(2);
        $this->actingAsUser('staffB1');
        $this->assertSame(50, $this->getJson('/api/invoices')->assertOk()->json('meta.per_page'));
        foreach (['per_page=0', 'per_page=101', 'per_page=abc', 'per_page[]=2', 'cursor=short', 'cursor[]=x', 'status=Void', 'status[]=Paid', 'limit=5000'] as $bad) {
            $query = $this->getJson('/api/invoices?'.$bad);
            $bad === 'limit=5000' ? $query->assertOk() : $query->assertStatus(422);
        }
        $this->assertCount(2, $this->getJson('/api/invoices?per_page=100')->json('data'));
        $this->assertCount(0, $this->getJson('/api/invoices?cursor=01ARZ3NDEKTSV4RRFFQ69G5FAV')->json('data'), 'an unknown cursor is an empty page');
    }

    public function test_filters_only_narrow_what_the_account_is_already_authorized_to_see(): void
    {
        $made = $this->manyInvoices(2);
        $this->actingAsUser('staffB1');
        $this->postJson("/api/invoices/{$made[0]}/review", ['expected_revision' => 1], ['Idempotency-Key' => $this->key()])->assertOk();
        $this->assertSame([$made[0]], array_column($this->getJson('/api/invoices?status=Review')->json('data'), 'id'));
        $this->assertCount(2, $this->getJson('/api/invoices?branch_id=b1')->json('data'));
        $this->assertCount(2, $this->getJson('/api/invoices?branch_id='.$this->b['b1']->public_id)->json('data'));
        $this->assertCount(2, $this->getJson('/api/invoices?patient_id='.$this->p['A']->public_id)->json('data'));
        $this->assertCount(0, $this->getJson('/api/invoices?patient_id='.$this->p['B']->public_id)->json('data'));
        $this->assertCount(0, $this->getJson('/api/invoices?patient_id='.$this->p['A']->id)->json('data'), 'a numeric patient id matches nothing');
        $this->getJson('/api/invoices?branch_id=nope')->assertStatus(422);
        $this->getJson('/api/invoices?branch_id='.$this->b['b1']->id)->assertStatus(422);
        // Another branch's Staff cannot widen their scope with a filter; Owner sees everything.
        $this->actingAsUser('staffB2');
        foreach (['', '?branch_id=b1', '?branch_id=b2', '?patient_id='.$this->p['A']->public_id] as $q) {
            $this->assertCount(0, $this->getJson('/api/invoices'.$q)->assertOk()->json('data'));
        }
        $this->actingAsUser('owner');
        $this->assertCount(1, $this->getJson('/api/invoices?per_page=1&branch_id=b1')->json('data'));
        $this->assertCount(1, $this->getJson('/api/invoices?per_page=1')->json('data'));
        $this->assertNotNull($this->getJson('/api/invoices?per_page=1')->json('meta.next_cursor'));
    }

    public function test_a_patient_pages_only_their_own_invoices_and_cannot_filter_by_someone_else(): void
    {
        $made = $this->manyInvoices(3);
        $this->actingAsUser('patientA');
        $first = $this->getJson('/api/invoices/mine?per_page=2')->assertOk();
        $second = $this->getJson('/api/invoices/mine?per_page=2&cursor='.$first->json('meta.next_cursor'))->assertOk();
        $this->assertEqualsCanonicalizing($made, [...array_column($first->json('data'), 'id'), ...array_column($second->json('data'), 'id')]);
        $this->assertNull($second->json('meta.next_cursor'));
        $this->getJson('/api/invoices/mine?patient_id='.$this->p['B']->public_id)->assertStatus(422);
        $this->getJson('/api/invoices/mine?branch_id=b1')->assertStatus(422);
        $this->actingAsUser('patientB');
        $this->assertCount(0, $this->getJson('/api/invoices/mine')->assertOk()->json('data'));
        $this->assertCount(0, $this->getJson('/api/invoices/mine?cursor='.$first->json('meta.next_cursor'))->json('data'), 'a cursor from another account leaks nothing');
    }

    // ---- receipt pagination -------------------------------------------------------------------------------------------

    public function test_a_patient_pages_their_receipts_newest_first_without_gaps_repeats_or_leaks(): void
    {
        $receipts = [];
        for ($i = 0; $i < 5; $i++) {
            $i === 0 && $this->price();
            $invoice = Invoice::where('public_id', $this->createInvoice($this->completed())->assertCreated()->json('data.id'))->firstOrFail();
            $this->actingAsUser('staffB1');
            $this->postJson("/api/invoices/{$invoice->public_id}/review", ['expected_revision' => 1], ['Idempotency-Key' => $this->key()])->assertOk();
            $this->postJson("/api/invoices/{$invoice->public_id}/issue", ['expected_revision' => 2], ['Idempotency-Key' => $this->key()])->assertOk();
            $this->postJson("/api/invoices/{$invoice->public_id}/payment", ['expected_revision' => 3, 'method' => 'Cash'], ['Idempotency-Key' => $this->key()])->assertOk();
            $receipts[] = $invoice->fresh()->receipt->public_id;
        }
        $newest = array_reverse($receipts);
        $this->actingAsUser('patientA');
        $one = $this->getJson('/api/receipts/mine?per_page=2')->assertOk();
        $two = $this->getJson('/api/receipts/mine?per_page=2&cursor='.$one->json('meta.next_cursor'))->assertOk();
        $three = $this->getJson('/api/receipts/mine?per_page=2&cursor='.$two->json('meta.next_cursor'))->assertOk();
        $this->assertSame($newest, [...array_column($one->json('data'), 'id'), ...array_column($two->json('data'), 'id'), ...array_column($three->json('data'), 'id')]);
        $this->assertSame($newest[1], $one->json('meta.next_cursor'), 'the cursor is a public id');
        $this->assertNull($three->json('meta.next_cursor'));
        $this->assertSame(50, $this->getJson('/api/receipts/mine')->json('meta.per_page'));
        foreach (['per_page=0', 'per_page=101', 'per_page=x', 'cursor=short', 'cursor[]=a'] as $bad) {
            $this->getJson('/api/receipts/mine?'.$bad)->assertStatus(422);
        }
        $this->assertStringNotContainsString('"patient_id"', json_encode($one->json()));
        // Patient B: nothing, and a cursor taken from Patient A's list reveals nothing about it.
        $this->actingAsUser('patientB');
        $foreign = $this->getJson('/api/receipts/mine?cursor='.$one->json('meta.next_cursor'))->assertOk();
        $unknown = $this->getJson('/api/receipts/mine?cursor=01ARZ3NDEKTSV4RRFFQ69G5FAV')->assertOk();
        $this->assertSame($unknown->json(), $foreign->json());
        $this->assertSame([], $foreign->json('data'));
        $this->actingAsUser('staffB1');
        $this->getJson('/api/receipts/mine')->assertForbidden();
    }
}

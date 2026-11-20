<?php

namespace Tests\Feature\Billing;

use App\Enums\Role;
use App\Models\{HmoCase,Invoice,InvoiceHistory,PatientHmoMembership,Payment,Receipt,ServicePrice,Treatment,TreatmentProcedure,Visit};
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Focused M11 financial boundary coverage. M5/M12/M13 retain their own suites. */
class BillingTest extends TestCase
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

    public function test_only_completed_post_cutover_treatments_create_one_invoice_and_snapshot_m13_price(): void
    {
        $this->price();
        $t = $this->completed();
        $first = $this->createInvoice($t)->assertCreated()->assertJsonPath('data.status', 'Draft');
        $this->createInvoice($t)->assertCreated()->assertJsonPath('data.id', $first->json('data.id'));
        $invoice = Invoice::with('lines')->sole();
        $this->assertSame('251.00', (string) $invoice->gross_amount);
        $this->assertSame('125.50', (string) $invoice->lines->sole()->unit_price);
        $this->assertSame('251.00', (string) $invoice->lines->sole()->line_total);
        $this->assertSame(1, InvoiceHistory::where('event', 'invoice.created')->count());
    }

    public function test_cash_review_and_owner_acknowledgement_keep_the_original_financial_evidence(): void
    {
        $this->price();
        $invoice = $this->createInvoice($this->completed())->json('data.id');
        $path = "/api/invoices/{$invoice}";
        $review = "{$path}/cash-correction-review";
        $ack = "{$path}/cash-correction-acknowledgement";
        $this->postJson("{$path}/review", ['expected_revision' => 1], ['Idempotency-Key' => $this->key()])->assertOk();
        $this->postJson("{$path}/issue", ['expected_revision' => 2], ['Idempotency-Key' => $this->key()])->assertOk();
        $paid = $this->postJson("{$path}/payment", ['expected_revision' => 3, 'method' => 'Cash', 'amount' => '251.00'],
            ['Idempotency-Key' => $this->key()])->assertOk()->assertJsonPath('data.cash_review_available', true)->json('data');

        $command = ['expected_revision' => 4, 'reason' => 'refund_requested'];
        $key = ['Idempotency-Key' => $this->key()];
        $this->actingAsUser('staffB2');
        $this->postJson($review, $command, $key)->assertForbidden();
        $this->actingAsUser('staffB1');
        $this->postJson($review, $command + ['amount' => '999.00'], $key)->assertUnprocessable();
        $this->postJson($review, $command, $key)->assertOk()
            ->assertJsonPath('data.cash_correction.status', 'requested')->assertJsonPath('data.refund_status', 'none');
        $this->postJson($review, $command, $key)->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->postJson($review, $command, ['Idempotency-Key' => $this->key()])->assertConflict();
        $this->postJson($ack, ['expected_revision' => 5], ['Idempotency-Key' => $this->key()])->assertForbidden();

        $this->actingAsUser('owner');
        $this->getJson($path)->assertOk()->assertJsonPath('data.cash_correction.reason', 'refund_requested');
        $this->postJson($ack, ['expected_revision' => 5], ['Idempotency-Key' => $this->key()])->assertOk()
            ->assertJsonPath('data.cash_correction.status', 'acknowledged')->assertJsonPath('data.payment.id', $paid['payment']['id'])
            ->assertJsonPath('data.receipt.id', $paid['receipt']['id'])->assertJsonPath('data.paid_amount', '251.00')
            ->assertJsonPath('data.balance', '0.00')->assertJsonPath('data.refund_status', 'none');
        $this->actingAsUser('patientA');
        $this->getJson($path)->assertOk()->assertJsonMissingPath('data.cash_correction')
            ->assertJsonMissing(['event' => InvoiceHistory::CASH_REVIEW_REQUESTED])
            ->assertJsonMissing(['event' => InvoiceHistory::CASH_REVIEW_ACKNOWLEDGED])
            ->assertJsonPath('data.receipt.number', $paid['receipt']['number']);
        $this->assertSame(1, Payment::count());
        $this->assertSame(1, Receipt::count());
        $this->assertSame(2, InvoiceHistory::whereIn('event', [InvoiceHistory::CASH_REVIEW_REQUESTED, InvoiceHistory::CASH_REVIEW_ACKNOWLEDGED])->count());
    }

    public function test_open_online_checkout_blocks_full_counter_collection_under_the_invoice_lock(): void
    {
        $this->price();
        $id = $this->createInvoice($this->completed())->json('data.id');
        $path = "/api/invoices/{$id}";
        $this->postJson("{$path}/review", ['expected_revision' => 1], ['Idempotency-Key' => $this->key()])->assertOk();
        $this->postJson("{$path}/issue", ['expected_revision' => 2], ['Idempotency-Key' => $this->key()])->assertOk();
        $invoice = Invoice::where('public_id', $id)->firstOrFail();
        $invoice->openCheckouts()->create([
            'provider_session_id' => 'cs_counter_cash_fixture', 'checkout_url' => 'https://checkout.example.test/session',
            'amount' => '251.00', 'currency' => 'PHP', 'status' => 'Open', 'initiated_by_user_id' => $this->u['patientA']->id,
        ]);
        $this->getJson('/api/invoices')->assertOk()->assertJsonPath('data.0.has_open_checkout', true);
        $this->postJson("{$path}/payment", ['expected_revision' => 3, 'method' => 'Cash', 'amount' => '251.00'],
            ['Idempotency-Key' => $this->key()])->assertConflict()->assertJsonPath('code', 'checkout_reconciliation_required');
        $this->assertSame('Issued', $invoice->fresh()->status);
        $this->assertSame(0, Payment::count());
        $this->assertSame(0, Receipt::count());
    }

    public function test_missing_price_is_safe_and_does_not_change_completed_treatment_or_use_reference_fee(): void
    {
        $t = $this->completed();
        $this->createInvoice($t)->assertStatus(422)->assertJsonPath('code', 'pricing_unavailable')->assertJsonPath('details.services.0.service', 'svc1');
        $this->assertSame(0, Invoice::count());
        $this->assertSame('Completed', $t->fresh()->status);
    }

    public function test_cutover_boundary_refuses_pre_cutover_and_accepts_post_cutover_treatment(): void
    {
        $this->price();
        DB::table('m11_billing_cutovers')->where('id', 1)->update(['established_at' => '2026-09-29 00:00:00+08']);
        $this->createInvoice($this->completed())->assertStatus(422)->assertJsonPath('code', 'treatment_before_cutover');
        DB::table('m11_billing_cutovers')->where('id', 1)->update(['established_at' => '2026-09-01 00:00:00+08']);
        $this->createInvoice($this->completed())->assertCreated();
        $this->assertSame(1, DB::table('m11_billing_cutovers')->count());
    }

    public function test_active_hmo_membership_without_case_allows_draft_but_blocks_issue(): void
    {
        $this->price(); $t = $this->completed();
        PatientHmoMembership::create(['patient_id'=>$this->p['A']->id,'provider_name'=>'Insurer','member_number'=>'M-1','status'=>'active','created_by_user_id'=>$this->u['staffB1']->id,'created_at'=>now()]);
        $invoice = Invoice::where('public_id', $this->createInvoice($t)->json('data.id'))->firstOrFail(); $this->actingAsUser('staffB1');
        $this->postJson("/api/invoices/{$invoice->public_id}/review", ['expected_revision'=>1], ['Idempotency-Key'=>$this->key()])->assertOk();
        $this->postJson("/api/invoices/{$invoice->public_id}/issue", ['expected_revision'=>2], ['Idempotency-Key'=>$this->key()])->assertStatus(422)->assertJsonPath('code','hmo_financial_hold');
        $this->assertSame('Review', $invoice->fresh()->status);
    }

    public function test_stale_revision_is_refused_and_terminal_invoice_cannot_transition(): void
    {
        $this->price(); $t = $this->completed(); $invoice = Invoice::where('public_id', $this->createInvoice($t)->json('data.id'))->firstOrFail(); $this->actingAsUser('staffB1');
        $this->postJson("/api/invoices/{$invoice->public_id}/review", ['expected_revision'=>99], ['Idempotency-Key'=>$this->key()])->assertStatus(409)->assertJsonPath('code','stale_revision');
        $this->postJson("/api/invoices/{$invoice->public_id}/review", ['expected_revision'=>1], ['Idempotency-Key'=>$this->key()])->assertOk();
        $this->postJson("/api/invoices/{$invoice->public_id}/issue", ['expected_revision'=>2], ['Idempotency-Key'=>$this->key()])->assertOk();
        $this->postJson("/api/invoices/{$invoice->public_id}/review", ['expected_revision'=>3], ['Idempotency-Key'=>$this->key()])->assertStatus(422)->assertJsonPath('code','invalid_invoice_state');
    }

    public function test_approved_hmo_full_coverage_settles_without_payment_or_receipt(): void
    {
        $this->price(); $t = $this->completed();
        $membership = PatientHmoMembership::create(['patient_id'=>$this->p['A']->id,'provider_name'=>'Insurer','member_number'=>'M-2','status'=>'active','created_by_user_id'=>$this->u['staffB1']->id,'created_at'=>now()]);
        HmoCase::create(['visit_id'=>$t->visit_id,'patient_id'=>$this->p['A']->id,'branch_id'=>$this->b['b1']->id,'membership_id'=>$membership->id,'provider_name'=>'Insurer','member_number'=>'M-2','status'=>'Approved','submission_cycle'=>1,'submitted_at'=>now(),'final_at'=>now(),'approved_amount'=>'9999.00','revision'=>2,'created_by_user_id'=>$this->u['staffB1']->id,'updated_by_user_id'=>$this->u['staffB1']->id]);
        $invoice = Invoice::where('public_id', $this->createInvoice($t)->json('data.id'))->firstOrFail(); $this->actingAsUser('staffB1');
        $this->postJson("/api/invoices/{$invoice->public_id}/review", ['expected_revision'=>1], ['Idempotency-Key'=>$this->key()]);
        $this->postJson("/api/invoices/{$invoice->public_id}/issue", ['expected_revision'=>2], ['Idempotency-Key'=>$this->key()])->assertOk()->assertJsonPath('data.status','Paid')->assertJsonPath('data.settlement_type','full_hmo_coverage')->assertJsonPath('data.paid_amount','0.00')->assertJsonPath('data.balance','0.00');
        $this->assertSame(0, Payment::count()); $this->assertSame(0, Receipt::count());
    }

    public function test_each_supported_payment_method_records_exact_balance_and_reference_rules(): void
    {
        $this->price();
        foreach ([['Cash', null], ['Card/POS', 'POS-1'], ['Bank Transfer', 'BANK-1'], ['E-Wallet', 'WALLET-1']] as [$method, $reference]) {
            $t = $this->completed(); $invoice = Invoice::where('public_id', $this->createInvoice($t)->json('data.id'))->firstOrFail(); $this->actingAsUser('staffB1');
            $this->postJson("/api/invoices/{$invoice->public_id}/review", ['expected_revision'=>1], ['Idempotency-Key'=>$this->key()]);
            $this->postJson("/api/invoices/{$invoice->public_id}/issue", ['expected_revision'=>2], ['Idempotency-Key'=>$this->key()]);
            $this->postJson("/api/invoices/{$invoice->public_id}/payment", ['expected_revision'=>3,'amount'=>'1.00','method'=>$method,'external_reference'=>$reference], ['Idempotency-Key'=>$this->key()])->assertStatus(422)->assertJsonPath('code','invalid_payment_amount');
            if ($method !== 'Cash') $this->postJson("/api/invoices/{$invoice->public_id}/payment", ['expected_revision'=>3,'amount'=>'251.00','method'=>$method], ['Idempotency-Key'=>$this->key()])->assertStatus(422)->assertJsonPath('code','invalid_payment_reference');
            $response = $this->postJson("/api/invoices/{$invoice->public_id}/payment", ['expected_revision'=>3,'amount'=>'251.00','method'=>$method,'external_reference'=>$reference], ['Idempotency-Key'=>$this->key()])->assertOk();
            $this->assertSame($method, Payment::where('invoice_id',$invoice->id)->sole()->method); $this->assertSame($reference, Payment::where('invoice_id',$invoice->id)->sole()->external_reference); $this->assertSame('0.00', (string)$invoice->fresh()->balance());
        }
        $this->assertSame(4, Payment::count()); $this->assertSame(4, Receipt::count());
    }

    public function test_hmo_gate_matrix_allows_only_final_billing_outcomes(): void
    {
        $this->price();
        foreach (['Missing Requirements','Ready for Submission','Pending','Escalated','Returned'] as $status) {
            $t=$this->completed(); $case=$this->hmoCase($t,$status); $invoice=Invoice::where('public_id',$this->createInvoice($t)->json('data.id'))->firstOrFail(); $this->actingAsUser('staffB1');
            $this->postJson("/api/invoices/{$invoice->public_id}/review",['expected_revision'=>1],['Idempotency-Key'=>$this->key()]);
            $this->postJson("/api/invoices/{$invoice->public_id}/issue",['expected_revision'=>2],['Idempotency-Key'=>$this->key()])->assertStatus(422)->assertJsonPath('code','hmo_financial_hold'); $case->membership()->update(['status'=>'ended','ended_at'=>now(),'ended_by_user_id'=>$this->u['staffB1']->id]);
        }
        foreach ([['Rejected','0.00'],['Withdrawn','0.00'],['Approved','100.00']] as [$status,$coverage]) {
            $t=$this->completed(); $case=$this->hmoCase($t,$status,$status==='Approved'?'100.00':null); $invoice=Invoice::where('public_id',$this->createInvoice($t)->json('data.id'))->firstOrFail(); $this->actingAsUser('staffB1');
            $this->postJson("/api/invoices/{$invoice->public_id}/review",['expected_revision'=>1],['Idempotency-Key'=>$this->key()]);
            $response=$this->postJson("/api/invoices/{$invoice->public_id}/issue",['expected_revision'=>2],['Idempotency-Key'=>$this->key()])->assertOk();
            $this->assertSame($coverage,$response->json('data.hmo_coverage_amount')); $case->membership()->update(['status'=>'ended','ended_at'=>now(),'ended_by_user_id'=>$this->u['staffB1']->id]);
        }
    }

    public function test_wrong_branch_staff_owner_and_dentist_cannot_mutate(): void
    {
        $this->price(); $t = $this->completed();
        $this->actingAsUser('staffB2'); $this->postJson("/api/invoices/from-treatment/{$t->public_id}", [], ['Idempotency-Key' => $this->key()])->assertForbidden();
        $this->actingAsUser('owner'); $this->postJson("/api/invoices/from-treatment/{$t->public_id}", [], ['Idempotency-Key' => $this->key()])->assertForbidden();
        $this->actingAsUser('dentist1'); $this->postJson("/api/invoices/from-treatment/{$t->public_id}", [], ['Idempotency-Key' => $this->key()])->assertForbidden();
    }

    public function test_persisted_command_replay_and_reused_key_conflict(): void
    {
        $this->price(); $t = $this->completed(); $this->actingAsUser('staffB1'); $key = $this->key();
        $one = $this->postJson("/api/invoices/from-treatment/{$t->public_id}", [], ['Idempotency-Key' => $key])->assertCreated();
        $this->postJson("/api/invoices/from-treatment/{$t->public_id}", [], ['Idempotency-Key' => $key])->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
        $other = $this->completed();
        $this->postJson('/api/invoices/from-treatment/'.$other->public_id, [], ['Idempotency-Key' => $key])->assertStatus(409)->assertJsonPath('code', 'idempotency_key_reused');
        $this->assertSame(1, DB::table('command_keys')->where('command', 'billing.draft')->count());
        $this->assertSame($one->json('data.id'), Invoice::sole()->public_id);
    }

    public function test_review_issue_and_full_cash_payment_are_atomic_and_receipt_is_immutable(): void
    {
        $this->price(); $t = $this->completed(); $invoice = Invoice::where('public_id', $this->createInvoice($t)->json('data.id'))->firstOrFail(); $this->actingAsUser('staffB1');
        $this->postJson("/api/invoices/{$invoice->public_id}/review", ['expected_revision' => 1], ['Idempotency-Key' => $this->key()])->assertOk();
        $issued = $this->postJson("/api/invoices/{$invoice->public_id}/issue", ['expected_revision' => 2], ['Idempotency-Key' => $this->key()])->assertOk();
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", ['expected_revision' => 3, 'method' => 'Cash'], ['Idempotency-Key' => $this->key()])->assertOk();
        $this->assertSame(1, Payment::count()); $this->assertSame(1, Receipt::count()); $this->assertSame('Paid', $invoice->fresh()->status);
        $receipt = Receipt::sole(); $this->assertSame('251.00', (string) $receipt->amount); $this->assertSame('Cash', $receipt->method);
        $this->assertDatabaseHas('invoice_histories', ['event' => 'invoice.reviewed']); $this->assertDatabaseHas('invoice_histories', ['event' => 'invoice.issued']); $this->assertDatabaseHas('invoice_histories', ['event' => 'invoice.paid']);
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", ['expected_revision' => 4, 'method' => 'Cash'], ['Idempotency-Key' => $this->key()])->assertStatus(422)->assertJsonPath('code', 'already_paid');
    }

    public function test_payment_reference_rules_and_patient_mine_is_owned(): void
    {
        $this->price(); $t = $this->completed(); $invoice = Invoice::where('public_id', $this->createInvoice($t)->json('data.id'))->firstOrFail(); $this->actingAsUser('staffB1');
        $this->postJson("/api/invoices/{$invoice->public_id}/review", ['expected_revision' => 1], ['Idempotency-Key' => $this->key()]); $this->postJson("/api/invoices/{$invoice->public_id}/issue", ['expected_revision' => 2], ['Idempotency-Key' => $this->key()]);
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", ['expected_revision' => 3, 'method' => 'Card/POS'], ['Idempotency-Key' => $this->key()])->assertStatus(422)->assertJsonPath('code', 'invalid_payment_reference');
        $this->actingAsUser('patientA'); $this->getJson('/api/invoices/mine')->assertOk()->assertJsonMissing(['id' => (string) $invoice->id]);
        $this->getJson('/api/receipts/mine')->assertOk();
    }

    public function test_staff_can_apply_and_clear_20_percent_senior_pwd_statutory_discount_on_draft(): void
    {
        $this->price();
        $t = $this->completed();
        $invoice = Invoice::where('public_id', $this->createInvoice($t)->json('data.id'))->firstOrFail();
        $this->assertSame('251.00', (string) $invoice->gross_amount);
        $this->assertSame('0.00', (string) $invoice->discount_amount);
        $this->assertSame('251.00', (string) $invoice->patient_responsibility_amount);

        // Apply Senior Citizen discount: 20% of 251.00 = 50.20
        $this->actingAsUser('staffB1');
        $res = $this->postJson("/api/invoices/{$invoice->public_id}/discount", [
            'expected_revision' => 1,
            'discount_type' => 'Senior Citizen',
            'discount_id_number' => 'OSCA-12345',
        ], ['Idempotency-Key' => $this->key()])->assertOk();

        $this->assertSame('Senior Citizen', $res->json('data.discount_type'));
        $this->assertSame('OSCA-12345', $res->json('data.discount_id_number'));
        $this->assertSame('50.20', $res->json('data.discount_amount'));
        $this->assertSame('200.80', $res->json('data.patient_responsibility_amount'));

        $fresh = $invoice->fresh();
        $this->assertSame('Senior Citizen', $fresh->discount_type);
        $this->assertSame('OSCA-12345', $fresh->discount_id_number);
        $this->assertSame('50.20', (string) $fresh->discount_amount);
        $this->assertSame('200.80', (string) $fresh->patient_responsibility_amount);

        // Clear discount:
        $resClear = $this->postJson("/api/invoices/{$invoice->public_id}/discount", [
            'expected_revision' => 2,
            'discount_type' => null,
            'discount_id_number' => null,
        ], ['Idempotency-Key' => $this->key()])->assertOk();

        $this->assertNull($resClear->json('data.discount_type'));
        $this->assertSame('0.00', $resClear->json('data.discount_amount'));
        $this->assertSame('251.00', $resClear->json('data.patient_responsibility_amount'));

        // Apply PWD discount:
        $resPwd = $this->postJson("/api/invoices/{$invoice->public_id}/discount", [
            'expected_revision' => 3,
            'discount_type' => 'PWD',
            'discount_id_number' => 'PWD-999',
        ], ['Idempotency-Key' => $this->key()])->assertOk();
        $this->assertSame('PWD', $resPwd->json('data.discount_type'));
        $this->assertSame('50.20', $resPwd->json('data.discount_amount'));

        // Transition to Review and Issue, verify invoice and receipt totals
        $this->postJson("/api/invoices/{$invoice->public_id}/review", ['expected_revision' => 4], ['Idempotency-Key' => $this->key()])->assertOk();
        $this->postJson("/api/invoices/{$invoice->public_id}/issue", ['expected_revision' => 5], ['Idempotency-Key' => $this->key()])->assertOk();

        // Cannot mutate discount on Issued invoice
        $this->postJson("/api/invoices/{$invoice->public_id}/discount", [
            'expected_revision' => 6,
            'discount_type' => null,
        ], ['Idempotency-Key' => $this->key()])->assertStatus(422);

        // Payment of net balance 200.80
        $this->postJson("/api/invoices/{$invoice->public_id}/payment", [
            'expected_revision' => 6,
            'method' => 'Cash',
            'amount' => '200.80',
        ], ['Idempotency-Key' => $this->key()])->assertOk();

        $this->assertSame('Paid', $invoice->fresh()->status);
        $receipt = Receipt::where('invoice_id', $invoice->id)->sole();
        $this->assertSame('200.80', (string) $receipt->amount);
    }
}

<?php

namespace Tests\Feature\Hmo;

use App\Models\HmoCase;
use App\Models\HmoCaseEvent;
use App\Models\PatientHmoMembership;
use App\Models\Visit;
use App\Services\Hmo\HmoFinancialGate;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

// Minimal M12 HMO foundation (memberships, Visit-anchored cases, lifecycle incl. Withdrawn, the financial gate).
// Clinic clock frozen at 2026-09-28 10:00 Asia/Manila (SchedulingFixture); staffB1 is scoped to b1, staffB2 to b2.
class HmoTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private int $keys = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        // One active Visit per Patient (M8): scenarios needing several open Visits use distinct Patients.
        foreach (['C', 'D', 'E'] as $i => $code) {
            [$this->u['patient'.$code], $this->p[$code]] = $this->patient('PAT-001'.$i);
        }
    }

    private function key(): string
    {
        return 'hk-'.(++$this->keys);
    }

    private function send(string $path, array $body = [], ?string $key = null)
    {
        return $this->postJson($path, $body, ['Idempotency-Key' => $key ?? $this->key()]);
    }

    private function walkIn(string $patient = 'A', string $dentist = 'd1', string $branch = 'b1', string $staff = 'staffB1'): Visit
    {
        $this->actingAsUser($staff);
        $id = $this->send('/api/visits/walk-in', ['patient_id' => $this->p[$patient]->public_id, 'branch_ref' => $branch, 'service_ref' => 'svc1', 'dentist_ref' => $dentist])
            ->assertCreated()->json('data.id');

        return Visit::where('public_id', $id)->sole();
    }

    /** Completes the Visit's treatment through the M5 API (as its responsible Dentist). */
    private function completeTreatment(Visit $visit, string $dentist = 'dentist1'): void
    {
        $this->actingAsUser('staffB1');
        $entry = $visit->fresh()->queueEntry;
        $this->send("/api/queue/{$entry->public_id}/call", ['expected_revision' => $entry->revision])->assertOk();
        $this->actingAsUser($dentist);
        $this->send("/api/visits/{$visit->public_id}/treatment", ['expected_revision' => $visit->fresh()->revision])->assertCreated();
        $t = $visit->fresh()->treatment;
        $this->send("/api/treatments/{$t->public_id}/document", ['expected_revision' => 1, 'procedure_summary' => 'Consultation', 'prescription_required' => false,
            'followup_required' => false, 'procedures' => [['service_ref' => 'svc1', 'quantity' => 1]]])->assertOk();
        $this->send("/api/treatments/{$t->public_id}/complete", ['expected_revision' => 2])->assertOk();
    }

    /** Sets the Patient's membership through the operational context of their latest Visit (or the given one). */
    private function membership(string $patient = 'A', string $provider = 'Insurer One', string $member = 'M-000123', ?string $expected = null, ?Visit $visit = null, array $extra = [])
    {
        $visit ??= Visit::where('patient_id', $this->p[$patient]->id)->latest('id')->firstOrFail();

        return $this->send("/api/visits/{$visit->public_id}/hmo-membership", ['provider_name' => $provider, 'member_number' => $member, 'expected_active_id' => $expected] + $extra);
    }

    private function open(Visit $visit)
    {
        return $this->send("/api/visits/{$visit->public_id}/hmo-case");
    }

    private function cmd(HmoCase|string $case, string $command, array $body = [], ?string $key = null)
    {
        $case = $case instanceof HmoCase ? $case : HmoCase::where('public_id', $case)->sole();

        return $this->send("/api/hmo-cases/{$case->public_id}/{$command}", $body + ['expected_revision' => $case->fresh()->revision], $key);
    }

    private function gate(Visit $visit): array
    {
        return app(HmoFinancialGate::class)->forVisit($visit->fresh());
    }

    private function gateFlags(Visit $visit): array
    {
        $g = $this->gate($visit);

        return [$g['requires_claim_decision'], $g['blocks_invoice_issue'], $g['blocks_payment'], $g['coverage_status'], $g['approved_amount'], $g['stage']];
    }

    private function openedCase(string $patient = 'A'): array
    {
        $visit = $this->walkIn($patient);
        $this->membership($patient)->assertCreated();
        $id = $this->open($visit)->assertCreated()->json('data.id');

        return [$visit, HmoCase::where('public_id', $id)->sole()];
    }

    // ---- MEMBERSHIP --------------------------------------------------------------------------------------------------

    public function test_memberships_are_server_patient_scoped_one_active_with_history(): void
    {
        $this->assertSame(0, PatientHmoMembership::count(), 'no provider or membership is seeded');
        $visit = $this->walkIn();
        $first = $this->membership()->assertCreated()->assertJsonPath('data.active.provider_name', 'Insurer One')->json('data.active.id');
        $this->membership('A', 'Insurer Two', 'X-9', null)->assertStatus(409)->assertJsonPath('code', 'stale_membership');   // stale expectation
        $second = $this->membership('A', 'Insurer Two', 'X-9', $first)->assertCreated()
            ->assertJsonPath('data.active.provider_name', 'Insurer Two')->assertJsonCount(2, 'data.history')->json('data.active.id');
        $this->assertSame(['ended', 'active'], PatientHmoMembership::orderBy('id')->pluck('status')->all());
        $this->assertNotSame($first, $second);
        $this->send("/api/visits/{$visit->public_id}/hmo-membership/end", ['expected_active_id' => $second])->assertOk()->assertJsonPath('data.active', null);

        // Browser/local ids are never a context; the retired Patient-id mutation routes no longer exist.
        $this->send('/api/visits/v1/hmo-membership', ['provider_name' => 'X', 'member_number' => 'Y', 'expected_active_id' => null])->assertNotFound();
        $this->send("/api/patients/{$this->p['A']->public_id}/hmo-membership", ['provider_name' => 'X', 'member_number' => 'Y', 'expected_active_id' => null])->assertStatus(405);
        $this->send("/api/patients/{$this->p['A']->public_id}/hmo-membership/end", ['expected_active_id' => $second])->assertNotFound();
        $this->membership('A', ' ', 'Y')->assertStatus(422);

        foreach (['owner', 'dentist1', 'patientA', 'staffNone', 'staffB2'] as $who) {
            $this->actingAsUser($who);
            $this->membership('A', 'Z', 'Z', null)->assertForbidden();
        }
        $this->actingAsUser('owner');
        $this->getJson("/api/patients/{$this->p['A']->public_id}/hmo-membership")->assertOk()->assertJsonCount(2, 'data.history')->assertJsonPath('data.active', null);
        $this->actingAsUser('patientA');
        $this->getJson("/api/patients/{$this->p['A']->public_id}/hmo-membership")->assertForbidden();

        // History is kept by the database: a row is never rewritten or deleted.
        foreach ([fn () => DB::table('patient_hmo_memberships')->update(['provider_name' => 'Edited']), fn () => DB::table('patient_hmo_memberships')->delete()] as $write) {
            try {
                DB::transaction($write);
                $this->fail('expected membership history to be protected');
            } catch (QueryException) {
                $this->assertTrue(true);
            }
        }
    }

    public function test_membership_read_requires_an_in_scope_patient_or_owner(): void
    {
        $path = "/api/patients/{$this->p['A']->public_id}/hmo-membership";
        $this->getJson($path)->assertUnauthorized();
        $visit = $this->walkIn('A');
        $this->membership(visit: $visit)->assertCreated();
        $this->getJson($path)->assertOk()->assertJsonPath('data.active.member_number', 'M-000123');
        foreach (['staffB2', 'staffNone'] as $who) {
            $this->actingAsUser($who);
            $this->getJson($path)->assertNotFound()->assertJsonMissingPath('data');
        }
        $this->actingAsUser('owner');
        $this->getJson($path)->assertOk()->assertJsonCount(1, 'data.history');
    }

    public function test_membership_mutation_requires_an_in_scope_visit_of_that_patient(): void
    {
        $aVisit = $this->walkIn('A');                                   // Patient A: operational context in Branch A (b1)
        $cVisit = $this->walkIn('C', 'd3', 'b2', 'staffB2');            // Patient C: only context is Branch B (b2)

        // 1. Staff in Branch A manage A's membership through A's Branch A Visit; the membership carries no branch.
        $this->actingAsUser('staffB1');
        $this->membership('A', visit: $aVisit)->assertCreated()->assertJsonPath('data.patient.id', $this->p['A']->public_id);
        $this->assertFalse(\Illuminate\Support\Facades\Schema::hasColumn('patient_hmo_memberships', 'branch_id'));

        // 2 + 3. Holding a Branch A scope is not enough to reach a Patient whose only context is Branch B.
        $this->membership('C', visit: $cVisit)->assertForbidden();
        $this->send("/api/visits/{$cVisit->public_id}/hmo-membership/end", ['expected_active_id' => 'x'])->assertForbidden();
        $this->assertSame(0, PatientHmoMembership::where('patient_id', $this->p['C']->id)->count());

        // 4. A forged Patient id cannot switch the target: the Patient always comes from the Visit.
        foreach ([['patient_id' => $this->p['C']->public_id], ['patient_ref' => 'p2']] as $forged) {
            $this->membership('A', 'Other', 'O-1', $this->activeId('A'), $aVisit, $forged)->assertStatus(422);
        }
        $this->assertSame(0, PatientHmoMembership::where('patient_id', $this->p['C']->id)->count());

        // 5. A forged branch cannot grant access (the Visit's branch decides) and is refused even on an in-scope Visit.
        foreach ([['branch_ref' => 'b1'], ['branch_id' => $this->b['b1']->id]] as $forged) {
            $this->membership('C', visit: $cVisit, extra: $forged)->assertForbidden();
            $this->membership('A', 'Other', 'O-1', $this->activeId('A'), $aVisit, $forged)->assertStatus(422);
        }

        // Staff scoped to Branch B manage C through C's own Visit; Staff scoped to both branches reach both.
        $this->actingAsUser('staffB2');
        $this->membership('C', visit: $cVisit)->assertCreated();
        $this->actingAsUser('staffBoth');
        $this->membership('A', 'Insurer Two', 'X-2', $this->activeId('A'), $aVisit)->assertCreated();
        $this->membership('C', 'Insurer Two', 'X-3', $this->activeId('C'), $cVisit)->assertCreated();

        // 6. Replacement ends the old membership and creates one new active one, in one transaction.
        $this->assertSame(['ended', 'active'], PatientHmoMembership::where('patient_id', $this->p['A']->id)->orderBy('id')->pluck('status')->all());
        $before = $this->activeId('A');
        PatientHmoMembership::creating(fn () => throw new \RuntimeException('simulated failure'));
        try {
            $this->membership('A', 'Insurer Three', 'X-4', $before, $aVisit)->assertServerError();
        } finally {
            PatientHmoMembership::flushEventListeners();
        }
        $this->assertSame($before, $this->activeId('A'), 'the failed replacement did not end the active membership');
        $this->assertSame(1, PatientHmoMembership::where('patient_id', $this->p['A']->id)->where('status', 'active')->count());
    }

    private function activeId(string $patient): ?string
    {
        return PatientHmoMembership::where('patient_id', $this->p[$patient]->id)->where('status', 'active')->value('public_id');
    }

    // ---- CASE --------------------------------------------------------------------------------------------------------

    public function test_a_case_is_opened_once_per_visit_from_the_active_membership(): void
    {
        $visit = $this->walkIn();
        $this->open($visit)->assertStatus(422)->assertJsonPath('code', 'membership_required');
        $this->membership()->assertCreated();
        $body = $this->open($visit)->assertCreated()
            ->assertJsonPath('data.status', 'Missing Requirements')->assertJsonPath('data.provider_name', 'Insurer One')->assertJsonPath('data.member_number', 'M-000123')
            ->assertJsonPath('data.visit.id', $visit->public_id)->assertJsonPath('data.patient.id', $this->p['A']->public_id)->assertJsonPath('data.branch.id', 'b1')
            ->assertJsonPath('data.submission_cycle', 0)->assertJsonPath('data.events.0.kind', 'created')->json('data');
        $this->assertSame(['Missing', 'Missing', 'Missing'], array_column($body['requirements'], 'state'), 'the treatment request waits for a completed treatment');
        $this->open($visit)->assertStatus(409)->assertJsonPath('code', 'hmo_case_exists');

        $case = HmoCase::sole();
        $this->assertSame([$visit->patient_id, $visit->branch_id], [$case->patient_id, $case->branch_id]);
        $this->assertNotSame('Draft', $case->status);
        // The anchor never moves and the Patient/branch must match the Visit (database guard).
        foreach ([['patient_id' => $this->p['B']->id], ['branch_id' => $this->b['b2']->id], ['visit_id' => $this->walkIn('C')->id]] as $change) {
            try {
                DB::transaction(fn () => DB::table('hmo_cases')->where('id', $case->id)->update($change));
                $this->fail('expected the Visit anchor to be enforced: '.json_encode(array_keys($change)));
            } catch (QueryException) {
                $this->assertTrue(true);
            }
        }

        // Wrong branch / other roles cannot open a case.
        $b2Visit = $this->walkIn('B', 'd3', 'b2', 'staffB2');
        $this->actingAsUser('staffB2');
        $this->membership('B')->assertCreated();
        foreach (['staffB1', 'owner', 'dentist3', 'patientB'] as $who) {
            $this->actingAsUser($who);
            $this->open($b2Visit)->assertForbidden();
        }
    }

    public function test_the_treatment_request_is_satisfied_only_by_the_completed_treatment(): void
    {
        $visit = $this->walkIn();
        $this->membership()->assertCreated();
        $case = HmoCase::where('public_id', $this->open($visit)->json('data.id'))->sole();
        $this->cmd($case, 'requirements/treatment-request')->assertStatus(422)->assertJsonPath('code', 'treatment_not_completed');
        $this->completeTreatment($visit);
        $this->actingAsUser('staffB1');
        $this->cmd($case, 'requirements/treatment-request')->assertOk()->assertJsonPath('data.requirements.2.state', 'Validated');

        // A case opened after completion starts with it validated.
        $other = $this->walkIn('B', 'd2');
        $this->membership('B')->assertCreated();
        $this->completeTreatment($other, 'dentist2');
        $this->actingAsUser('staffB1');
        $this->open($other)->assertCreated()->assertJsonPath('data.requirements.2.state', 'Validated')
            ->assertJsonPath('data.requirements.2.document_label', 'Completed treatment record');
    }

    public function test_the_full_lifecycle_with_follow_up_escalation_return_and_approval(): void
    {
        [$visit, $case] = $this->openedCase();
        $this->completeTreatment($visit);
        $this->actingAsUser('staffB1');
        $this->cmd($case, 'requirements/hmo-card', ['document_label' => 'Card photo'])->assertOk()->assertJsonPath('data.status', 'Missing Requirements');
        $this->cmd($case, 'requirements/valid-id')->assertOk();
        $this->cmd($case, 'requirements/treatment-request')->assertOk()->assertJsonPath('data.status', 'Ready for Submission');
        $this->cmd($case, 'submit', ['method' => 'Bogus', 'note' => 'x'])->assertStatus(422);
        $this->cmd($case, 'submit', ['method' => 'Portal', 'note' => 'Sent via portal'])->assertOk()
            ->assertJsonPath('data.status', 'Pending')->assertJsonPath('data.submission_cycle', 1)
            ->assertJsonPath('data.submitted_at', '2026-09-28T10:00:00+08:00')->assertJsonPath('data.follow_up_due_at', '2026-09-28T22:00:00+08:00');

        $this->cmd($case, 'escalate')->assertStatus(422)->assertJsonPath('code', 'escalation_not_allowed');   // not overdue
        $this->cmd($case, 'response', ['submission_cycle' => 2, 'outcome' => 'Rejected', 'method' => 'Email', 'note' => 'x'])->assertStatus(422)->assertJsonPath('code', 'wrong_cycle');
        $this->travelTo(CarbonImmutable::parse('2026-09-28 22:30:00', 'Asia/Manila'));
        $this->cmd($case, 'escalate')->assertStatus(422);                                                   // overdue but no contact
        $this->cmd($case, 'contact', ['method' => 'Phone', 'note' => 'Left a message', 'next_action' => 'Call tomorrow'])->assertOk();
        $this->cmd($case, 'escalate')->assertOk()->assertJsonPath('data.status', 'Escalated');

        $this->cmd($case, 'response', ['submission_cycle' => 1, 'outcome' => 'Returned', 'method' => 'Email', 'note' => 'ID unreadable'])->assertStatus(422)->assertJsonValidationErrors('returned_requirements');
        $this->cmd($case, 'response', ['submission_cycle' => 1, 'outcome' => 'Returned', 'method' => 'Email', 'note' => 'ID unreadable', 'returned_requirements' => ['valid-id']])
            ->assertOk()->assertJsonPath('data.status', 'Returned')->assertJsonPath('data.requirements.1.state', 'Missing')->assertJsonPath('data.final_at', null);
        $this->cmd($case, 'withdraw', ['reason' => 'Patient decided'])->assertStatus(422)->assertJsonPath('code', 'withdraw_not_allowed');
        $this->cmd($case, 'submit', ['method' => 'Portal', 'note' => 'again'])->assertStatus(422)->assertJsonPath('code', 'requirements_incomplete');   // correction first
        $this->cmd($case, 'requirements/valid-id', ['document_label' => 'Clear ID'])->assertOk()->assertJsonPath('data.status', 'Ready for Submission');
        $this->cmd($case, 'withdraw', ['reason' => 'Patient decided'])->assertStatus(422)->assertJsonPath('code', 'withdraw_not_allowed');    // already submitted once
        $this->cmd($case, 'submit', ['method' => 'Email', 'note' => 'Resubmitted'])->assertOk()->assertJsonPath('data.submission_cycle', 2);

        $this->cmd($case, 'response', ['submission_cycle' => 2, 'outcome' => 'Approved', 'method' => 'Email', 'note' => 'LOA received'])->assertStatus(422)->assertJsonValidationErrors('approved_amount');
        foreach (['-1', '12.345', '1,200', 'abc'] as $bad) {
            $this->cmd($case, 'response', ['submission_cycle' => 2, 'outcome' => 'Approved', 'method' => 'Email', 'note' => 'x', 'approved_amount' => $bad])->assertStatus(422)->assertJsonValidationErrors('approved_amount');
        }
        $this->cmd($case, 'response', ['submission_cycle' => 2, 'outcome' => 'Approved', 'method' => 'Email', 'note' => 'LOA received', 'provider_reference' => 'LOA-77', 'approved_amount' => '1200.00'])
            ->assertOk()->assertJsonPath('data.status', 'Approved')->assertJsonPath('data.approved_amount', '1200.00')->assertJsonPath('data.final_at', '2026-09-28T22:30:00+08:00');
        $this->assertSame('1200.00', DB::table('hmo_cases')->where('id', $case->id)->value('approved_amount'));

        // Final is terminal: no command, no in-place rewrite.
        foreach (['withdraw' => ['reason' => 'x'], 'submit' => ['method' => 'Portal', 'note' => 'x'], 'escalate' => []] as $command => $body) {
            $this->cmd($case, $command, $body)->assertStatus(422)->assertJsonPath('code', 'case_final');
        }
        try {
            DB::transaction(fn () => DB::table('hmo_cases')->where('id', $case->id)->update(['approved_amount' => '5000.00']));
            $this->fail('expected a final case to be read-only');
        } catch (QueryException) {
            $this->assertTrue(true);
        }
        $this->assertSame(['created', 'requirement', 'requirement', 'requirement', 'submission', 'contact', 'escalation', 'response', 'requirement', 'submission', 'response'],
            HmoCaseEvent::where('hmo_case_id', $case->id)->orderBy('id')->pluck('kind')->all());
        $this->assertSame('LOA-77', HmoCaseEvent::where('kind', 'response')->orderByDesc('id')->value('provider_reference'));
    }

    public function test_rejected_zero_approved_and_withdrawal_rules(): void
    {
        [$visit, $case] = $this->openedCase();
        $this->completeTreatment($visit);
        $this->actingAsUser('staffB1');
        foreach (['hmo-card', 'valid-id', 'treatment-request'] as $rule) {
            $this->cmd($case, "requirements/{$rule}")->assertOk();
        }
        $this->cmd($case, 'submit', ['method' => 'Portal', 'note' => 'sent'])->assertOk();
        $this->cmd($case, 'response', ['submission_cycle' => 1, 'outcome' => 'Rejected', 'method' => 'Email', 'note' => 'x', 'approved_amount' => '10.00'])->assertStatus(422)->assertJsonValidationErrors('approved_amount');
        $this->cmd($case, 'response', ['submission_cycle' => 1, 'outcome' => 'Rejected', 'method' => 'Email', 'note' => 'Not covered'])->assertOk()->assertJsonPath('data.approved_amount', null);

        // Approved with 0.00 is a valid recorded amount.
        [, $zero] = $this->openedCase('B');
        $this->actingAsUser('staffB1');
        DB::table('hmo_case_requirements')->where('hmo_case_id', $zero->id)->update(['state' => 'Validated', 'validated_at' => now()]);
        DB::table('hmo_cases')->where('id', $zero->id)->update(['status' => 'Ready for Submission']);
        $this->cmd($zero, 'submit', ['method' => 'Portal', 'note' => 'sent'])->assertOk();
        $this->cmd($zero, 'response', ['submission_cycle' => 1, 'outcome' => 'Approved', 'method' => 'Phone', 'note' => 'Approved, no amount', 'approved_amount' => '0'])->assertOk()->assertJsonPath('data.approved_amount', '0.00');
    }

    public function test_withdrawal_only_before_submission_with_a_reason(): void
    {
        [, $missing] = $this->openedCase();
        $this->actingAsUser('staffB1');
        $this->cmd($missing, 'withdraw', [])->assertStatus(422)->assertJsonValidationErrors('reason');
        $this->cmd($missing, 'withdraw', ['reason' => 'Patient will self-pay'])->assertOk()->assertJsonPath('data.status', 'Withdrawn')
            ->assertJsonPath('data.approved_amount', null)->assertJsonPath('data.events.1.note', 'Patient will self-pay');
        $this->cmd($missing, 'requirements/hmo-card')->assertStatus(422)->assertJsonPath('code', 'case_final');   // no reopening

        [, $ready] = $this->openedCase('B');
        $this->actingAsUser('staffB1');
        DB::table('hmo_case_requirements')->where('hmo_case_id', $ready->id)->update(['state' => 'Validated', 'validated_at' => now()]);
        DB::table('hmo_cases')->where('id', $ready->id)->update(['status' => 'Ready for Submission']);
        $this->cmd($ready, 'withdraw', ['reason' => 'No claim'])->assertOk()->assertJsonPath('data.status', 'Withdrawn');
    }

    public function test_self_pay_records_an_authoritative_withdrawn_disposition(): void
    {
        $visit = $this->walkIn();
        $this->send("/api/visits/{$visit->public_id}/hmo/self-pay", ['reason' => 'No claim'])->assertStatus(422)->assertJsonPath('code', 'membership_required');
        $this->membership()->assertCreated();
        $this->send("/api/visits/{$visit->public_id}/hmo/self-pay", [])->assertStatus(422)->assertJsonValidationErrors('reason');
        $this->send("/api/visits/{$visit->public_id}/hmo/self-pay", ['reason' => 'Patient pays directly'], 'sp-1')->assertCreated()
            ->assertJsonPath('data.status', 'Withdrawn')->assertJsonPath('data.provider_name', 'Insurer One')->assertJsonPath('data.submission_cycle', 0);
        $this->send("/api/visits/{$visit->public_id}/hmo/self-pay", ['reason' => 'Patient pays directly'], 'sp-1')->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
        $this->send("/api/visits/{$visit->public_id}/hmo/self-pay", ['reason' => 'Again'])->assertStatus(409)->assertJsonPath('code', 'hmo_case_exists');
        $this->assertSame(1, HmoCase::count());
        $this->assertSame(['created', 'withdrawal'], HmoCaseEvent::orderBy('id')->pluck('kind')->all());
        $this->assertNotNull(HmoCase::sole()->final_at);
        $this->assertSame(0, DB::table('invoices')->count(), 'M12 creates no invoice');
        $this->assertSame(0, DB::table('payments')->count(), 'M12 creates no payment');
    }

    // ---- FINANCIAL GATE ----------------------------------------------------------------------------------------------

    public function test_the_financial_gate_for_every_position(): void
    {
        $plain = $this->walkIn('B', 'd2');
        $this->assertSame([false, false, false, 'none', null, 'none'], $this->gateFlags($plain), 'no membership, no case: self-pay');

        $visit = $this->walkIn();
        $this->membership()->assertCreated();
        $this->assertSame([true, true, true, 'pending', null, 'none'], $this->gateFlags($visit), 'membership, no case: a claim decision is required');

        $case = HmoCase::where('public_id', $this->open($visit)->json('data.id'))->sole();
        $this->assertSame([false, true, true, 'pending', null, 'preparation'], $this->gateFlags($visit), 'Missing Requirements');
        $this->completeTreatment($visit);
        $this->actingAsUser('staffB1');
        foreach (['hmo-card', 'valid-id', 'treatment-request'] as $rule) {
            $this->cmd($case, "requirements/{$rule}")->assertOk();
        }
        $this->assertSame([false, true, true, 'pending', null, 'preparation'], $this->gateFlags($visit), 'Ready for Submission');
        $this->cmd($case, 'submit', ['method' => 'Portal', 'note' => 'sent'])->assertOk();
        $this->assertSame([false, true, true, 'pending', null, 'waiting'], $this->gateFlags($visit), 'Pending');
        $this->travelTo(CarbonImmutable::parse('2026-09-29 09:00:00', 'Asia/Manila'));
        $this->cmd($case, 'contact', ['method' => 'Phone', 'note' => 'x', 'next_action' => 'y'])->assertOk();
        $this->cmd($case, 'escalate')->assertOk();
        $this->assertSame([false, true, true, 'pending', null, 'waiting'], $this->gateFlags($visit), 'Escalated');
        $this->cmd($case, 'response', ['submission_cycle' => 1, 'outcome' => 'Returned', 'method' => 'Email', 'note' => 'x', 'returned_requirements' => ['hmo-card']])->assertOk();
        $this->assertSame([false, true, true, 'pending', null, 'action_required'], $this->gateFlags($visit), 'Returned');
        $this->cmd($case, 'requirements/hmo-card')->assertOk();
        $this->cmd($case, 'submit', ['method' => 'Portal', 'note' => 'again'])->assertOk();
        $this->cmd($case, 'response', ['submission_cycle' => 2, 'outcome' => 'Approved', 'method' => 'Email', 'note' => 'ok', 'approved_amount' => '1200.50'])->assertOk();
        $gate = $this->gate($visit);
        $this->assertSame([false, false, false, 'approved', '1200.50', 'approved'], $this->gateFlags($visit), 'Approved');
        $this->assertSame([true, true, $case->public_id, 'Approved'], [$gate['has_membership'], $gate['has_case'], $gate['case_public_id'], $gate['status']]);

        // Rejected and Withdrawn both give "0.00" usable coverage and release the holds.
        $rejectedVisit = $this->walkIn('C', 'd2');
        $this->membership('C')->assertCreated();
        $rejected = HmoCase::where('public_id', $this->open($rejectedVisit)->json('data.id'))->sole();
        DB::table('hmo_case_requirements')->where('hmo_case_id', $rejected->id)->update(['state' => 'Validated', 'validated_at' => now()]);
        DB::table('hmo_cases')->where('id', $rejected->id)->update(['status' => 'Ready for Submission']);
        $this->cmd($rejected, 'submit', ['method' => 'Portal', 'note' => 'sent'])->assertOk();
        $this->cmd($rejected, 'response', ['submission_cycle' => 1, 'outcome' => 'Rejected', 'method' => 'Email', 'note' => 'no'])->assertOk();
        $this->assertSame([false, false, false, 'rejected', '0.00', 'rejected'], $this->gateFlags($rejectedVisit));

        $selfPayVisit = $this->walkIn('D', 'd2');
        $this->membership('D')->assertCreated();
        $this->send("/api/visits/{$selfPayVisit->public_id}/hmo/self-pay", ['reason' => 'self-pay'])->assertCreated();
        $this->assertSame([false, false, false, 'none', '0.00', 'withdrawn'], $this->gateFlags($selfPayVisit));

        // The read endpoint returns the same facts to Staff in scope and the Owner only.
        $this->getJson("/api/visits/{$visit->public_id}/hmo-gate")->assertOk()->assertJsonPath('data.approved_amount', '1200.50');
        $this->actingAsUser('owner');
        $this->getJson("/api/visits/{$visit->public_id}/hmo-gate")->assertOk();
        foreach (['staffB2', 'dentist1', 'patientA'] as $who) {
            $this->actingAsUser($who);
            $this->getJson("/api/visits/{$visit->public_id}/hmo-gate")->assertForbidden();
        }
        // The gate is reachable from the Treatment (M11's path: Treatment → Visit → case).
        $this->assertSame('approved', app(HmoFinancialGate::class)->forTreatment($visit->fresh()->treatment)['coverage_status']);
    }

    // ---- READS / AUTHORIZATION ---------------------------------------------------------------------------------------

    public function test_role_projections_and_scope(): void
    {
        $this->getJson('/api/hmo-cases')->assertUnauthorized();
        $this->getJson('/api/hmo-cases/mine')->assertUnauthorized();
        [$visit, $case] = $this->openedCase();
        $this->cmd($case, 'requirements/hmo-card', ['document_label' => 'Internal label'])->assertOk();

        // Staff in scope: full case with history.
        $this->getJson('/api/hmo-cases')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.events.0.kind', 'created');
        $this->actingAsUser('staffB2');
        $this->getJson('/api/hmo-cases')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("/api/hmo-cases/{$case->public_id}")->assertForbidden();
        $this->cmd($case, 'requirements/valid-id')->assertForbidden();

        // Owner: full read, no mutation.
        $this->actingAsUser('owner');
        $this->getJson("/api/hmo-cases/{$case->public_id}")->assertOk()->assertJsonPath('data.member_number', 'M-000123');
        $this->cmd($case, 'requirements/valid-id')->assertForbidden();

        // Responsible Dentist: safe summary only; another Dentist nothing.
        $this->actingAsUser('dentist1');
        $summary = $this->getJson("/api/hmo-cases/{$case->public_id}")->assertOk()->json('data');
        foreach (['events', 'member_number', 'created_at'] as $hidden) {
            $this->assertArrayNotHasKey($hidden, $summary);
        }
        $this->assertArrayNotHasKey('document_label', $summary['requirements'][0]);
        $this->cmd($case, 'requirements/valid-id')->assertForbidden();
        $this->actingAsUser('dentist2');
        $this->getJson("/api/hmo-cases/{$case->public_id}")->assertForbidden();

        // Patient: own safe subset through the session only.
        $this->actingAsUser('patientA');
        $row = $this->getJson('/api/hmo-cases/mine')->assertOk()->assertJsonCount(1, 'data')->json('data.0');
        $this->assertSame(['id', 'status', 'provider_name', 'member_number', 'visit_date', 'appointment', 'branch', 'requirements', 'submitted_at', 'final_at', 'approved_amount'], array_keys($row));
        $this->assertSame('••••0123', $row['member_number']);
        $this->assertStringNotContainsString('Internal label', json_encode($row));
        $this->getJson('/api/hmo-cases/mine?patient_id='.$this->p['B']->public_id)->assertStatus(422);
        $this->getJson('/api/hmo-cases')->assertForbidden();
        $this->getJson("/api/hmo-cases/{$case->public_id}")->assertForbidden();
        $this->cmd($case, 'withdraw', ['reason' => 'x'])->assertForbidden();
        $this->actingAsUser('patientB');
        $this->getJson('/api/hmo-cases/mine')->assertOk()->assertJsonCount(0, 'data');

        // Claim decisions: Visits with an active membership and no case, in scope.
        $pending = $this->walkIn('B', 'd2');
        $this->membership('B')->assertCreated();
        $this->getJson('/api/hmo/claim-decisions')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.visit.id', $pending->public_id);
        $this->actingAsUser('staffB2');
        $this->getJson('/api/hmo/claim-decisions')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_stale_revision_idempotency_and_append_only_history(): void
    {
        [, $case] = $this->openedCase();
        $this->send("/api/hmo-cases/{$case->public_id}/requirements/hmo-card", ['expected_revision' => 1], 'same')->assertOk();
        $this->send("/api/hmo-cases/{$case->public_id}/requirements/hmo-card", ['expected_revision' => 1], 'same')->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->send("/api/hmo-cases/{$case->public_id}/requirements/valid-id", ['expected_revision' => 1])->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        $this->send("/api/hmo-cases/{$case->public_id}/requirements/valid-id", ['expected_revision' => 2], 'same')->assertStatus(422)->assertJsonPath('code', 'idempotency_key_reused');
        $this->send("/api/hmo-cases/{$case->public_id}/requirements/valid-id", ['expected_revision' => 2])->assertOk();
        $this->expectException(QueryException::class);
        DB::table('hmo_case_events')->update(['note' => 'tampered']);
    }
}

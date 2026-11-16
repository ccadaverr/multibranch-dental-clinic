<?php

namespace Tests\Feature\Automation;

use App\Models\AuditLog;
use App\Models\AutomatedAction;
use App\Models\Conversation;
use App\Models\Invoice;
use App\Models\Inquiry;
use App\Models\StaffProfile;
use App\Models\SystemEvent;
use App\Models\WorkflowRule;
use App\Services\Automation\WorkflowAutomationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

// M23 truthfulness: the module evaluates and records; it performs no business action. Results must say so, an empty history
// is "no data" (not 100%), a missing observation is never assumed to be zero, and manual dispatch cannot carry a Dentist's
// clinical decision, a Patient, a provider response or another actor.
class AutomationTruthfulnessTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private WorkflowAutomationService $automation;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->automation = app(WorkflowAutomationService::class);
    }

    private function record(string $type, array $payload = [], ?string $branch = null, ?string $key = null): SystemEvent
    {
        return $this->automation->recordEvent([
            'event_type' => $type, 'idempotency_key' => $key ?? 'k-'.uniqid(), 'domain' => 'test', 'aggregate_id' => 'agg-1',
            'branch_id' => $branch ? $this->b[$branch]->id : null, 'payload' => $payload,
        ]);
    }

    private function dispatch(string $rule, array $payload = [])
    {
        return $this->postJson('/api/automation/dispatch', ['rule_code' => $rule, 'payload' => $payload]);
    }

    private function counts(): array
    {
        return [Invoice::count(), Conversation::count(), Inquiry::count(), StaffProfile::count(), \App\Models\Treatment::count()];
    }

    // ---- E-4: results say what happened ------------------------------------------------------------------------------

    public function test_every_rule_result_states_evaluation_only_and_claims_no_action(): void
    {
        $cases = [
            ['appointment.lifecycle.changed', ['action_type' => 'moved']],
            ['hmo.pending.timer.updated', ['pending_hours' => 20]],
            ['patientflow.capacity.updated', ['estimated_wait_minutes' => 50]],
            ['clinical.treatment.completed', ['prescription_required' => true, 'followup_required' => true]],
            ['communication.message.received', []],
            ['access.user.changed', ['role' => 'Staff']],
        ];
        foreach ($cases as [$type, $payload]) {
            $action = $this->record($type, $payload)->actions()->sole();
            $this->assertStringContainsString('Evaluation only', $action->result_summary, $type);
            $this->assertDoesNotMatchRegularExpression('/draft invoice created|task staged|routed to|calendar reservation|synchronised with|obligation staged|dispatch staged/i', $action->result_summary, $type);
            $this->assertSame('evaluation_only', $action->details['execution'], $type);
        }
    }

    public function test_evaluating_rules_creates_no_invoice_conversation_inquiry_profile_or_treatment(): void
    {
        $before = $this->counts();
        $this->record('clinical.treatment.completed', ['prescription_required' => true, 'followup_required' => true]);
        $this->record('communication.message.received');
        $this->record('access.user.changed', ['role' => 'Dentist']);
        $this->record('appointment.lifecycle.changed', ['action_type' => 'created']);
        $this->record('hmo.pending.timer.updated', ['pending_hours' => 99]);
        $this->assertSame($before, $this->counts());
    }

    public function test_the_api_marks_every_action_row_as_evaluation_only_and_keeps_historical_text_unchanged(): void
    {
        // A row written before this correction, with wording that claimed an action.
        $rule = WorkflowRule::where('rule_code', 'R4_TREATMENT_DOWNSTREAM')->first();
        $event = $this->record('test.noop');
        $legacy = AutomatedAction::create(['workflow_rule_id' => $rule->id, 'system_event_id' => $event->id, 'idempotency_key' => 'legacy-1', 'status' => 'Success',
            'result_summary' => 'Treatment completed: Draft invoice created; Recall / follow-up obligation staged.', 'details' => ['followup_required' => true]]);
        $this->actingAsUser('owner');
        $row = collect($this->getJson('/api/automation/actions?per_page=100')->assertOk()->json('data'))->firstWhere('id', $legacy->public_id);
        $this->assertSame('Treatment completed: Draft invoice created; Recall / follow-up obligation staged.', $row['result_summary']); // history is not rewritten
        $this->assertSame('evaluation_only', $row['execution']);                                                                         // but it is not presented as executed
        $this->assertSame('legacy_proposed_description', $row['summary_kind']);
        $fresh = $this->record('hmo.pending.timer.updated', ['pending_hours' => 1])->actions()->sole();
        $this->assertSame('evaluation_result', collect($this->getJson('/api/automation/actions?per_page=100')->json('data'))->firstWhere('id', $fresh->public_id)['summary_kind']);
        $this->assertSame('Treatment completed: Draft invoice created; Recall / follow-up obligation staged.', $legacy->fresh()->result_summary);
        $this->assertSame('evaluation_only', $this->getJson('/api/automation/snapshot')->json('data.execution_model'));
    }

    public function test_thresholds_are_labelled_demonstration_values_and_boundaries_hold(): void
    {
        $this->assertSame('Success', $this->record('hmo.pending.timer.updated', ['pending_hours' => 11])->actions()->sole()->status);
        $warn = $this->record('hmo.pending.timer.updated', ['pending_hours' => 12])->actions()->sole();
        $this->assertSame('Warning', $warn->status);
        $this->assertStringContainsString('demonstration threshold', $warn->result_summary);
        $this->assertStringContainsString('not clinic policy', $warn->result_summary);
        $this->assertSame('Success', $this->record('patientflow.capacity.updated', ['estimated_wait_minutes' => 35])->actions()->sole()->status);
        $w = $this->record('patientflow.capacity.updated', ['estimated_wait_minutes' => 36])->actions()->sole();
        $this->assertSame('Warning', $w->status);
        $this->assertStringContainsString('Branch load is not evaluated', $w->result_summary);
    }

    public function test_a_missing_observation_fails_the_evaluation_and_is_never_assumed_to_be_zero(): void
    {
        foreach (['hmo.pending.timer.updated' => 'pending_hours', 'patientflow.capacity.updated' => 'estimated_wait_minutes'] as $type => $field) {
            foreach ([[], ['unrelated' => 1], [$field => 'abc'], [$field => 1.5], [$field => '1e3'], [$field => -3], [$field => '2.5'], [$field => null]] as $payload) {
                $a = $this->record($type, $payload)->actions()->sole();
                $this->assertSame('Failed', $a->status);
                $this->assertStringContainsString("did not include {$field}", $a->result_summary);
                $this->assertSame($field, $a->details['missing_observation']);
            }
        }
    }

    // ---- R4: caller-supplied flags are not a Dentist's decision ------------------------------------------------------

    public function test_r4_reports_caller_supplied_flags_as_unverified_and_creates_nothing(): void
    {
        $a = $this->record('clinical.treatment.completed', ['followup_required' => true, 'prescription_required' => true])->actions()->sole();
        $this->assertStringContainsString('not a Dentist-authorized decision', $a->result_summary);
        $this->assertStringContainsString('no invoice, prescription task, follow-up or recall was created', strtolower($a->result_summary));
        $this->assertSame('caller_supplied_unverified', $a->details['flag_origin']);
        $none = $this->record('clinical.treatment.completed', [])->actions()->sole();
        $this->assertStringNotContainsString('Caller-supplied', $none->result_summary);
    }

    public function test_manual_dispatch_refuses_clinical_flags_and_every_foreign_field(): void
    {
        $this->actingAsUser('owner');
        foreach (['followup_required', 'prescription_required'] as $flag) {
            $r = $this->dispatch('R4_TREATMENT_DOWNSTREAM', [$flag => true])->assertStatus(422)->assertJsonValidationErrors("payload.{$flag}");
            $this->assertStringContainsString('Dentist-documented Treatment', json_encode($r->json('errors')));
        }
        foreach (['patient_id', 'actor_user_id', 'dentist_id', 'treatment_status', 'treatment_id', 'provider_response', 'hmo_outcome', 'payment_reference', 'branch_id', 'invoice_id'] as $field) {
            \Illuminate\Support\Facades\Cache::flush();   // the 20/minute limiter counts refused requests too; reset it between fields
            $this->dispatch('R4_TREATMENT_DOWNSTREAM', [$field => 'x'])->assertStatus(422);
            $this->dispatch('R2_HMO_FOLLOWUP_REMINDER', ['pending_hours' => 14, $field => 'x'])->assertStatus(422);
        }
        $this->assertSame(0, SystemEvent::count());
    }

    // ---- manual dispatch validation, authorization, throttle ---------------------------------------------------------

    public function test_manual_dispatch_validates_each_rule_observation(): void
    {
        $this->actingAsUser('owner');
        $this->dispatch('NOPE')->assertStatus(422);
        $this->postJson('/api/automation/dispatch', [])->assertStatus(422);
        $this->postJson('/api/automation/dispatch', ['rule_code' => 'R2_HMO_FOLLOWUP_REMINDER', 'payload' => 'x'])->assertStatus(422);
        $this->dispatch('R2_HMO_FOLLOWUP_REMINDER', [])->assertStatus(422);
        $this->dispatch('R2_HMO_FOLLOWUP_REMINDER', ['diagnostic_check' => true])->assertStatus(422);   // the UI flag alone is not an observation
        $this->dispatch('R2_HMO_FOLLOWUP_REMINDER', ['pending_hours' => 'many'])->assertStatus(422);
        $this->dispatch('R2_HMO_FOLLOWUP_REMINDER', ['pending_hours' => -1])->assertStatus(422);
        $this->dispatch('R2_HMO_FOLLOWUP_REMINDER', ['pending_hours' => 9999])->assertStatus(422);
        $this->dispatch('R3_CAPACITY_ALERT', ['estimated_wait_minutes' => 1.5])->assertStatus(422);
        $this->dispatch('R1_APPT_LIFECYCLE', ['action_type' => '=cmd'])->assertStatus(422);
        $this->dispatch('R1_APPT_LIFECYCLE', [])->assertStatus(422);
        $this->assertSame(0, SystemEvent::count());
        $this->dispatch('R1_APPT_LIFECYCLE', ['action_type' => 'cancelled', 'diagnostic_check' => true])->assertCreated()->assertJsonPath('data.execution', 'evaluation_only');
        $this->dispatch('R2_HMO_FOLLOWUP_REMINDER', ['pending_hours' => 12])->assertCreated()->assertJsonPath('data.status', 'Warning');
        $this->dispatch('R3_CAPACITY_ALERT', ['estimated_wait_minutes' => 0])->assertCreated()->assertJsonPath('data.status', 'Success');
        $this->dispatch('R4_TREATMENT_DOWNSTREAM', ['diagnostic_check' => true])->assertCreated();
        $this->dispatch('R5_MESSAGE_ROUTING')->assertCreated();
        $this->dispatch('R6_USER_PROFILE_SYNC')->assertCreated();
    }

    public function test_the_manual_message_says_evaluated_not_executed_and_the_event_stores_no_email(): void
    {
        $this->actingAsUser('owner');
        $r = $this->dispatch('R2_HMO_FOLLOWUP_REMINDER', ['pending_hours' => 14])->assertCreated();
        $this->assertStringContainsString('No business action was performed', $r->json('message'));
        $this->assertStringNotContainsString('executed', $r->json('message'));
        $event = SystemEvent::latest('id')->first();
        $this->assertArrayNotHasKey('actor_email', $event->payload);
        $this->assertSame('Owner Manual Verification', $event->payload['triggered_by']);
        $this->assertSame($this->u['owner']->id, $event->actor_user_id);   // the actor is the authenticated Owner, never a payload field
    }

    public function test_only_the_owner_may_dispatch_and_authorization_precedes_validation(): void
    {
        foreach (['staffB1', 'dentist1', 'patientA'] as $who) {
            $this->actingAsUser($who);
            $this->dispatch('R4_TREATMENT_DOWNSTREAM', ['followup_required' => true])->assertStatus(403);
            $this->getJson('/api/automation/snapshot?branch_id=12')->assertStatus(403);
        }
        $this->assertSame(0, SystemEvent::count());
    }

    public function test_manual_dispatch_is_rate_limited(): void
    {
        $this->actingAsUser('owner');
        $last = null;
        for ($i = 0; $i < 22; $i++) {
            $last = $this->dispatch('R5_MESSAGE_ROUTING');
        }
        $last->assertStatus(429);
        $this->assertLessThanOrEqual(20, SystemEvent::count());
    }

    // ---- E-5 (M23): no data is not 100% ------------------------------------------------------------------------------

    private function automationReport(string $scope = 'all'): \Illuminate\Testing\TestResponse
    {
        return $this->getJson('/api/analytics/executive-summary?period=all&branch_id='.rawurlencode($scope));
    }

    public function test_health_is_null_with_no_evaluations_and_exact_otherwise(): void
    {
        $this->actingAsUser('owner');
        $this->automationReport()->assertOk()
            ->assertJsonPath('data.automation.health_rate_pct', null)->assertJsonPath('data.automation.total_actions', 0);

        $this->record('hmo.pending.timer.updated', ['pending_hours' => 1]);
        $this->automationReport()->assertOk()->assertJsonPath('data.automation.health_rate_pct', 100);
        $this->record('hmo.pending.timer.updated', ['pending_hours' => 30]);
        $this->automationReport()->assertOk()->assertJsonPath('data.automation.health_rate_pct', 50);
        $this->record('hmo.pending.timer.updated', []);   // Failed
        $this->automationReport()->assertOk()
            ->assertJsonPath('data.automation.health_rate_pct', 33)->assertJsonPath('data.automation.failed', 1);
    }

    public function test_a_genuine_zero_percent_is_not_confused_with_no_data(): void
    {
        $this->record('hmo.pending.timer.updated', []);
        $this->actingAsUser('owner');
        $this->automationReport()->assertOk()->assertJsonPath('data.automation.health_rate_pct', 0);
    }

    // ---- branch reference, history, privacy --------------------------------------------------------------------------

    public function test_report_branch_uses_the_m2_reference_contract_and_never_silently_widens(): void
    {
        $this->record('hmo.pending.timer.updated', ['pending_hours' => 1], 'b1');
        $this->record('hmo.pending.timer.updated', ['pending_hours' => 1], 'b2');
        $this->record('hmo.pending.timer.updated', ['pending_hours' => 1], 'b2');
        $this->actingAsUser('owner');
        $this->automationReport('b1')->assertOk()->assertJsonPath('data.automation.total_actions', 1);
        $this->automationReport($this->b['b2']->public_id)->assertOk()->assertJsonPath('data.automation.total_actions', 2);
        $this->automationReport()->assertOk()->assertJsonPath('data.automation.total_actions', 3);
        foreach ([(string) $this->b['b1']->id, '0', 'b9', '01ARZ3NDEKTSV4RRFFQ69G5FAV'] as $bad) {
            $this->automationReport($bad)->assertUnprocessable()->assertJsonValidationErrors('branch_id');
        }
    }

    public function test_duplicate_event_key_does_not_duplicate_the_evaluation_and_history_is_append_only(): void
    {
        $a = $this->record('communication.message.received', [], null, 'dup-1');
        $b = $this->record('communication.message.received', [], null, 'dup-1');
        $this->assertSame($a->id, $b->id);
        $this->assertSame(1, AutomatedAction::where('system_event_id', $a->id)->count());
        $this->expectException(\RuntimeException::class);
        $a->actions()->first()->update(['result_summary' => 'changed']);
    }

    public function test_audit_events_carry_no_event_body_and_the_csv_marks_evaluation_only(): void
    {
        $this->record('hmo.pending.timer.updated', ['pending_hours' => 40, 'hmo_case_id' => 'secret-case', 'patient_name' => 'Maria Santos']);
        $audit = AuditLog::where('category', 'automation')->latest('id')->first();
        $json = json_encode($audit->payload);
        $this->assertStringNotContainsString('Maria', $json);
        $this->assertStringNotContainsString('secret-case', $json);
        $this->assertArrayNotHasKey('payload', $audit->payload);
        $this->actingAsUser('owner');
        $csv = $this->get('/api/automation/export-csv')->assertOk()->streamedContent();
        $this->assertStringContainsString('Execution', $csv);
        $this->assertStringContainsString('"Evaluation only"', $csv);
    }

    public function test_the_billing_payment_event_still_records_with_no_rule_matching_it(): void
    {
        $e = $this->record('billing.payment_received', ['invoice_number' => 'INV-1']);
        $this->assertSame(0, $e->actions()->count());
    }

    public function test_legacy_descriptions_are_qualified_inside_the_csv_cell_and_in_the_exception_projection(): void
    {
        $rule = WorkflowRule::where('rule_code', 'R5_MESSAGE_ROUTING')->first();
        $event = $this->record('test.noop');
        AutomatedAction::create(['workflow_rule_id' => $rule->id, 'system_event_id' => $event->id, 'idempotency_key' => 'legacy-csv', 'status' => 'Warning',
            'result_summary' => 'Patient communication routed to responsible branch staff inbox.', 'details' => ['message_id' => 'm1']]);
        $this->record('hmo.pending.timer.updated', ['pending_hours' => 1]);
        $this->actingAsUser('owner');
        $csv = $this->get('/api/automation/export-csv')->assertOk()->streamedContent();
        $this->assertStringContainsString('[Legacy description of a proposed action; nothing was executed] Patient communication routed to responsible branch staff inbox.', $csv);
        $this->assertStringNotContainsString('[Legacy description of a proposed action; nothing was executed] HMO pending time', $csv);
        $rows = $this->getJson('/api/automation/snapshot')->json('data.recent_exceptions');
        $this->assertSame('legacy_proposed_description', $rows[0]['summary_kind']);
        $this->assertSame('Patient communication routed to responsible branch staff inbox.', AutomatedAction::where('idempotency_key', 'legacy-csv')->value('result_summary')); // not rewritten
    }

    public function test_repeated_manual_dispatches_are_independent_evaluations_with_no_idempotency_contract(): void
    {
        $this->actingAsUser('owner');
        $a = $this->dispatch('R3_CAPACITY_ALERT', ['estimated_wait_minutes' => 40])->assertCreated()->json('data.id');
        $b = $this->dispatch('R3_CAPACITY_ALERT', ['estimated_wait_minutes' => 40])->assertCreated()->json('data.id');
        $c = $this->postJson('/api/automation/dispatch', ['rule_code' => 'R3_CAPACITY_ALERT', 'payload' => ['estimated_wait_minutes' => 40]], ['Idempotency-Key' => 'same'])->assertCreated()->json('data.id');
        $d = $this->postJson('/api/automation/dispatch', ['rule_code' => 'R3_CAPACITY_ALERT', 'payload' => ['estimated_wait_minutes' => 40]], ['Idempotency-Key' => 'same'])->assertCreated()->json('data.id');
        $this->assertCount(4, array_unique([$a, $b, $c, $d]));
        $this->assertSame(4, SystemEvent::count());
        $this->assertSame(4, AutomatedAction::count());
    }

    public function test_whole_number_observations_are_accepted_as_int_or_digit_string_and_never_truncated(): void
    {
        foreach ([[12, 'Warning'], ['12', 'Warning'], [0, 'Success'], ['011', 'Success']] as [$value, $status]) {
            $this->assertSame($status, $this->record('hmo.pending.timer.updated', ['pending_hours' => $value])->actions()->sole()->status, var_export($value, true));
        }
    }

    public function test_manual_dispatch_refuses_unexpected_top_level_fields_too(): void
    {
        $this->actingAsUser('owner');
        foreach (['actor_user_id' => 1, 'followup_required' => true, 'patient_id' => 'x', 'branch_id' => 'b1', 'status' => 'Success'] as $key => $value) {
            \Illuminate\Support\Facades\Cache::flush();
            $this->postJson('/api/automation/dispatch', ['rule_code' => 'R5_MESSAGE_ROUTING', $key => $value])->assertStatus(422)->assertJsonValidationErrors($key);
        }
        $this->assertSame(0, SystemEvent::count());
        $this->postJson('/api/automation/dispatch', ['rule_code' => 'R5_MESSAGE_ROUTING', 'payload' => ['diagnostic_check' => true]])->assertCreated();
    }
}

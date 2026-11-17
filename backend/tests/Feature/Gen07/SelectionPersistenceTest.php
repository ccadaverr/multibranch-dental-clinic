<?php

namespace Tests\Feature\Gen07;

use App\Models\Appointment;
use App\Models\AssistantAnswer;
use App\Models\FollowupTask;
use App\Models\Prescription;
use App\Models\Visit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class SelectionPersistenceTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
    }

    public function test_owner_other_category_persists_and_clears_under_revision_control(): void
    {
        $body = ['question' => 'Where can visitors ask for assistance?', 'answer' => 'Please contact the branch for assistance.', 'category' => 'other', 'draft' => true];
        $headers = ['Idempotency-Key' => 'gen07-answer'];
        $this->actingAsUser('owner');
        $this->postJson('/api/assistant-answers', $body, $headers)->assertUnprocessable()->assertJsonValidationErrors('category_detail');
        $body['category_detail'] = 'Accessibility information';
        $answer = $this->postJson('/api/assistant-answers', $body, $headers)->assertCreated()
            ->assertJsonPath('data.category', 'other')->assertJsonPath('data.category_detail', $body['category_detail'])->json('data');
        $this->postJson('/api/assistant-answers', $body, $headers)->assertCreated()
            ->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $answer['id']);
        $record = AssistantAnswer::where('public_id', $answer['id'])->sole();
        $this->assertSame($body['category_detail'], $record->category_detail);
        $this->getJson('/api/assistant-answers')->assertOk()->assertJsonFragment(['id' => $answer['id'], 'category_detail' => $body['category_detail']]);
        $this->patchJson('/api/assistant-answers/'.$answer['id'], ['category' => 'about', 'expected_revision' => 1])
            ->assertOk()->assertJsonPath('data.category_detail', null);
        $this->assertNull($record->fresh()->category_detail);
        $this->patchJson('/api/assistant-answers/'.$answer['id'], ['category' => 'other', 'category_detail' => 'Stale', 'expected_revision' => 1])->assertConflict();
        $this->actingAsUser('staffB1');
        $this->getJson('/api/assistant-answers')->assertForbidden();
        $this->postJson('/api/assistant-answers', $body)->assertForbidden();
    }

    public function test_cancellation_stores_other_even_when_detail_matches_a_standard_category(): void
    {
        $this->actingAsUser('patientA');
        $id = $this->book()->assertCreated()->json('data.id');
        $url = '/api/appointments/'.$id;
        $body = ['expected_revision' => 1, 'reason_category' => 'Other'];
        $headers = ['Idempotency-Key' => 'gen07-cancel'];
        $this->postJson($url.'/cancel', $body, $headers)->assertUnprocessable()->assertJsonValidationErrors('reason_detail');
        $body['reason_detail'] = 'Schedule conflict';
        $this->postJson($url.'/cancel', $body, $headers)->assertOk()->assertJsonPath('data.cancellation_category', 'Other');
        $this->postJson($url.'/cancel', $body, $headers)->assertOk()->assertJsonPath('data.revision', 2);
        $this->getJson($url)->assertOk()->assertJsonPath('data.cancellation_detail', 'Schedule conflict');
        $row = Appointment::where('public_id', $id)->sole();
        $this->assertSame('Other', $row->cancellation_category);
        $this->assertSame('Schedule conflict', $row->cancellation_detail);
        $this->assertSame(2, $row->history()->count());
        $this->actingAsUser('staffB2');
        $this->getJson($url)->assertNotFound();
    }

    public function test_staff_cancellation_rejects_stale_detail_and_uses_existing_read_scope(): void
    {
        $this->actingAsUser('patientA');
        $id = $this->book()->assertCreated()->json('data.id');
        $url = '/api/appointments/'.$id;
        $this->actingAsUser('staffB2');
        $body = ['expected_revision' => 1, 'reason_category' => 'Patient requested cancellation'];
        $this->postJson($url.'/cancel', $body)->assertForbidden();
        $this->actingAsUser('staffB1');
        $this->postJson($url.'/cancel', $body + ['reason_detail' => 'Stale detail'])
            ->assertUnprocessable()->assertJsonValidationErrors('reason_detail');
        $this->postJson($url.'/cancel', $body)->assertOk()->assertJsonPath('data.cancellation_category', $body['reason_category'])
            ->assertJsonPath('data.cancellation_detail', null);
        $this->getJson($url)->assertOk()->assertJsonPath('data.cancellation_category', $body['reason_category']);
        $this->actingAsUser('patientA');
        $this->getJson($url)->assertOk()->assertJsonMissingPath('data.cancellation_detail');
    }

    public function test_followup_category_is_saved_without_changing_identity_or_scope(): void
    {
        $this->actingAsUser('patientA');
        $this->book()->assertCreated();
        $this->actingAsUser('staffB1');
        $body = ['patient_id' => $this->p['A']->public_id, 'branch_ref' => 'b1', 'due_on' => '2026-10-02', 'reason_category' => 'Other'];
        $headers = ['Idempotency-Key' => 'gen07-followup'];
        $this->postJson('/api/followups', $body, $headers)->assertUnprocessable()->assertJsonValidationErrors('reason_detail');
        $body['reason_detail'] = 'Post-Op Check';
        $id = $this->postJson('/api/followups', $body, $headers)->assertCreated()
            ->assertJsonPath('data.patient.id', $body['patient_id'])->assertJsonPath('data.reason_category', 'Other')->json('data.id');
        $this->postJson('/api/followups', $body, $headers)->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $id);
        $row = FollowupTask::where('public_id', $id)->sole();
        $this->assertSame('Other', $row->reason_category);
        $this->assertSame('Post-Op Check', $row->reason);
        $this->getJson('/api/followups/'.$id)->assertOk()->assertJsonPath('data.reason_detail', 'Post-Op Check');
        unset($body['reason_detail']);
        $body['reason_category'] = 'Post-Op Check';
        $this->postJson('/api/followups', $body)->assertCreated()->assertJsonPath('data.reason_detail', null);
        $this->actingAsUser('staffB2');
        $this->postJson('/api/followups', $body)->assertForbidden();
        $this->actingAsUser('owner');
        $this->getJson('/api/followups/'.$id)->assertForbidden();
    }

    public function test_treatment_snapshot_and_derived_task_keep_the_explicit_other_category(): void
    {
        $this->actingAsUser('staffB1');
        $arrival = $this->postJson('/api/visits/walk-in', ['patient_id' => $this->p['A']->public_id,
            'branch_ref' => 'b1', 'service_ref' => 'svc1', 'dentist_ref' => 'd1'], ['Idempotency-Key' => 'gen07-arrival'])->assertCreated()->json('data');
        $this->postJson('/api/queue/'.$arrival['queue']['id'].'/call', ['expected_revision' => 1], ['Idempotency-Key' => 'gen07-call'])->assertOk();
        $this->actingAsUser('dentist1');
        $treatment = $this->postJson('/api/visits/'.$arrival['id'].'/treatment', ['expected_revision' => 1], ['Idempotency-Key' => 'gen07-start'])
            ->assertCreated()->json('data.id');
        $url = '/api/treatments/'.$treatment;
        $body = ['expected_revision' => 1, 'prescription_required' => false, 'followup_required' => true,
            'followup_reason_category' => 'Other', 'procedure_summary' => 'Synthetic care', 'procedures' => [['service_ref' => 'svc1', 'quantity' => 1]]];
        $headers = ['Idempotency-Key' => 'gen07-document'];
        $this->postJson($url.'/document', $body, $headers)->assertUnprocessable()->assertJsonValidationErrors('followup_reason_detail');
        $body['followup_reason_detail'] = 'Post-Op Check';
        $this->postJson($url.'/document', $body, $headers)->assertOk()->assertJsonPath('data.followup_reason_category', 'Other');
        $this->getJson($url)->assertOk()->assertJsonPath('data.history.1.snapshot.followup_reason_category', 'Other');
        $this->postJson($url.'/complete', ['expected_revision' => 2], ['Idempotency-Key' => 'gen07-complete'])->assertOk();
        $task = FollowupTask::where('source', 'treatment')->sole();
        $this->assertSame('Other', $task->reason_category);
        $this->assertSame('Post-Op Check', $task->reason);
        $this->assertSame($this->p['A']->id, $task->patient_id);
    }

    public function test_prescription_origin_is_separate_from_the_encrypted_clinical_value(): void
    {
        $visit = Visit::create(['patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id, 'source' => 'walk_in',
            'status' => 'Checked In', 'responsible_dentist_profile_id' => $this->d['d1']->id, 'requested_service_id' => $this->svc['svc1']->id,
            'arrived_at' => '2026-09-28 09:00:00', 'clinic_date' => '2026-09-28', 'revision' => 1, 'created_by_user_id' => $this->u['staffB1']->id]);
        $this->actingAsUser('dentist1');
        $body = ['visit_id' => $visit->public_id, 'lines' => [['medicine' => 'Synthetic medicine', 'value_origins' => ['dosage' => 'other']]]];
        $headers = ['Idempotency-Key' => 'gen07-prescription'];
        $this->postJson('/api/prescriptions', $body, $headers)->assertUnprocessable()->assertJsonValidationErrors('lines.0.dosage');
        $body['lines'][0]['dosage'] = '500mg';
        $id = $this->postJson('/api/prescriptions', $body, $headers)->assertCreated()
            ->assertJsonPath('data.lines.0.value_origins.dosage', 'other')->json('data.id');
        $this->postJson('/api/prescriptions', $body, $headers)->assertCreated()->assertJsonPath('data.id', $id);
        $line = Prescription::where('public_id', $id)->sole()->lines()->sole();
        $this->assertSame(['dosage' => 'other'], $line->value_origins);
        $this->assertSame('500mg', $line->dosage);
        $this->assertNotSame('500mg', $line->getRawOriginal('dosage'));
        $this->getJson('/api/prescriptions/'.$id)->assertOk()->assertJsonPath('data.visit', $visit->public_id)
            ->assertJsonPath('data.lines.0.value_origins.dosage', 'other')->assertJsonPath('data.lines.0.dosage', '500mg');
        unset($body['visit_id']);
        $body['lines'][0]['value_origins']['dosage'] = 'standard';
        $body['expected_revision'] = 1;
        $this->putJson('/api/prescriptions/'.$id, $body, ['Idempotency-Key' => 'gen07-prescription-edit'])->assertOk()
            ->assertJsonPath('data.lines.0.value_origins.dosage', 'standard')->assertJsonPath('data.lines.0.dosage', '500mg');
        $this->actingAsUser('dentist3');
        $this->putJson('/api/prescriptions/'.$id, $body)->assertForbidden();
    }
}

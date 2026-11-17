<?php

namespace Tests\Feature\Gen07;

use App\Models\Appointment;
use App\Models\FollowupTask;
use App\Models\Visit;
use App\Support\CommandActor;
use App\Support\SelectionDetailsSchema;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** The unchanged 87-entry profile is a supported runtime, not a grant/schema cutover. */
class LegacySchemaCompatibilityTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->assertFalse(SelectionDetailsSchema::available(), 'Run against the reviewed 87-entry profile.');
    }

    public function test_legacy_followup_persists_and_replays_but_category_request_does_not_write(): void
    {
        $this->actingAsUser('patientA');
        $this->book()->assertCreated();
        $this->actingAsUser('staffB1');
        $body = ['patient_id' => $this->p['A']->public_id, 'branch_ref' => 'b1', 'due_on' => '2026-10-02', 'reason' => 'Synthetic follow-up'];
        $headers = ['Idempotency-Key' => 's02-legacy-followup'];
        $id = $this->postJson('/api/followups', $body, $headers)->assertCreated()->json('data.id');
        $this->postJson('/api/followups', $body, $headers)->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $id);
        $this->assertSame($body['reason'], FollowupTask::where('public_id', $id)->sole()->reason);
        unset($body['reason']);
        $body['reason_category'] = 'Other';
        $body['reason_detail'] = 'Synthetic detail';
        $this->postJson('/api/followups', $body)->assertStatus(503)->assertJsonPath('code', 'selection_details_unavailable');
        $this->assertSame(1, FollowupTask::count());
        $this->actingAsUser('staffB2');
        $this->getJson('/api/followups/'.$id)->assertNotFound();
        $this->postJson('/api/followups', $body)->assertForbidden();
    }

    public function test_cancel_legacy_text_is_persisted_and_typed_request_is_atomic(): void
    {
        $this->actingAsUser('patientA');
        $id = $this->book()->assertCreated()->json('data.id');
        $url = '/api/appointments/'.$id.'/cancel';
        $this->postJson($url, ['expected_revision' => 1, 'reason_category' => 'Other', 'reason_detail' => 'Synthetic detail'])
            ->assertStatus(503)->assertJsonPath('code', 'selection_details_unavailable');
        $row = Appointment::where('public_id', $id)->sole();
        $this->assertSame(1, $row->revision);
        $this->assertNotSame('Cancelled', $row->status);
        $headers = ['Idempotency-Key' => 's02-legacy-cancel'];
        $body = ['expected_revision' => 1, 'reason' => 'Synthetic cancellation'];
        $this->postJson($url, $body, $headers)->assertOk()->assertJsonPath('data.status', 'Cancelled');
        $this->postJson($url, $body, $headers)->assertOk()->assertJsonPath('data.revision', 2);
        $this->assertSame(2, $row->fresh()->history()->count());
    }

    public function test_legacy_prescription_still_encrypts_values_and_rejects_unavailable_origins(): void
    {
        $visit = Visit::create(['patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id, 'source' => 'walk_in',
            'status' => 'Checked In', 'responsible_dentist_profile_id' => $this->d['d1']->id, 'requested_service_id' => $this->svc['svc1']->id,
            'arrived_at' => '2026-09-28 09:00:00', 'clinic_date' => '2026-09-28', 'revision' => 1, 'created_by_user_id' => $this->u['staffB1']->id]);
        $this->actingAsUser('dentist1');
        $body = ['visit_id' => $visit->public_id, 'lines' => [['medicine' => 'Synthetic medicine', 'dosage' => '500mg', 'value_origins' => ['dosage' => 'other']]]];
        $this->postJson('/api/prescriptions', $body)->assertStatus(503);
        $this->assertDatabaseCount('prescriptions', 0);
        unset($body['lines'][0]['value_origins']);
        $id = $this->postJson('/api/prescriptions', $body)->assertCreated()->assertJsonPath('data.lines.0.dosage', '500mg')->json('data.id');
        $line = \App\Models\Prescription::where('public_id', $id)->sole()->lines()->sole();
        $this->assertNotSame('500mg', $line->getRawOriginal('dosage'));
        $this->assertSame('500mg', $line->dosage);
        $this->actingAsUser('dentist3');
        $this->getJson('/api/prescriptions/'.$id)->assertNotFound();
    }

    public function test_standard_assistant_answers_remain_editable_but_other_requires_installation(): void
    {
        $this->actingAsUser('owner');
        $body = ['question' => 'Where can visitors ask for assistance?', 'answer' => 'Please contact the branch for assistance.', 'category' => 'about', 'draft' => true];
        $id = $this->postJson('/api/assistant-answers', $body)->assertCreated()->json('data.id');
        $this->patchJson('/api/assistant-answers/'.$id, ['expected_revision' => 1, 'answer' => 'Please ask the branch for assistance.'])->assertOk();
        $this->postJson('/api/assistant-answers', array_replace($body, ['category' => 'other', 'category_detail' => 'Accessibility']))->assertStatus(503);
        $this->assertDatabaseCount('assistant_answers', 1);
        $this->actingAsUser('staffB1');
        $this->getJson('/api/assistant-answers')->assertForbidden();
    }

    public function test_locked_actor_rejects_revocation_before_work_or_receipt_replay(): void
    {
        $observed = $this->u['staffB1'];
        $observed->newQuery()->whereKey($observed->id)->increment('auth_version');
        $called = false;
        try {
            CommandActor::run($observed, function () use (&$called) { $called = true; });
            $this->fail('A revoked actor must not execute a command.');
        } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
            $this->assertSame(403, $e->getStatusCode());
        }
        $this->assertFalse($called);
    }
}

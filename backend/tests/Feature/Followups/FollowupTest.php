<?php

namespace Tests\Feature\Followups;

use App\Models\AuditLog;
use App\Models\AutomationSetting;
use App\Models\FollowupTask;
use App\Models\MailDispatch;
use App\Models\MessageTemplate;
use App\Models\Treatment;
use App\Models\TreatmentProcedure;
use App\Models\Visit;
use App\Services\Automations\FollowupReminders;
use App\Services\Followups\Followups;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** M20 Patient Follow-Up, frozen at Monday 2026-09-28 10:00 Asia/Manila (SchedulingFixture). */
class FollowupTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private const REASON = 'Check the healing of the extraction site';

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->setUpSchedulingWorld();
        $this->p['A']->person->update(['email' => 'patient.a@mailbox.ph']); // a deliverable address for the reminder
        $this->u['patientA']->update(['email' => 'patient.a@mailbox.ph']);
    }

    /** A completed visit whose treatment asks for a follow-up on 2026-10-05. */
    private function completedTreatment(string $patient = 'A', ?string $due = '2026-10-05'): Treatment
    {
        $visit = Visit::create(['patient_id' => $this->p[$patient]->id, 'branch_id' => $this->b['b1']->id, 'source' => 'walk_in', 'status' => 'In Treatment', 'responsible_dentist_profile_id' => $this->d['d1']->id,
            'requested_service_id' => $this->svc['svc1']->id, 'arrived_at' => '2026-09-28 09:00:00', 'clinic_date' => '2026-09-28', 'revision' => 1, 'created_by_user_id' => $this->u['staffB1']->id, 'updated_by_user_id' => $this->u['staffB1']->id]);
        $t = Treatment::create(['visit_id' => $visit->id, 'dentist_profile_id' => $this->d['d1']->id, 'status' => 'In Treatment', 'started_at' => '2026-09-28 09:00:00', 'revision' => 1,
            'followup_required' => true, 'followup_recommended_date' => $due, 'followup_reason' => self::REASON,
            'created_by_user_id' => $this->u['dentist1']->id, 'updated_by_user_id' => $this->u['dentist1']->id]);
        TreatmentProcedure::create(['treatment_id' => $t->id, 'service_id' => $this->svc['svc2']->id, 'line_no' => 1, 'quantity' => 1, 'service_code' => 'SVC2', 'service_name' => 'Service svc2']);
        DB::transaction(function () use ($visit, $t) {
            $visit->update(['status' => 'Completed', 'closed_at' => '2026-09-28 09:30:00', 'revision' => 2]);
            $t->update(['status' => 'Completed', 'completed_at' => '2026-09-28 09:30:00', 'revision' => 2]);
        });

        return $t->fresh();
    }

    public function test_a_completed_treatment_creates_one_task_and_booking_marks_it_booked_cancelling_reopens(): void
    {
        $t = $this->completedTreatment();
        $task = Followups::fromTreatment($t);
        $this->assertSame($task->id, Followups::fromTreatment($t)->id); // once per treatment
        $this->assertSame(['Open', '2026-10-05', 'svc2'], [$task->status, $task->dueOn(), $task->service->legacy_ref]);

        $this->actingAsUser('staffB1');
        $list = $this->getJson('/api/followups')->assertOk();
        $this->assertSame([$task->public_id, self::REASON, 'Branch front desk'], [$list->json('data.0.id'), $list->json('data.0.reason'), $list->json('data.0.assignee')]);
        $this->patchJson("/api/followups/{$task->public_id}", ['action' => 'contacted', 'expected_revision' => $task->fresh()->revision])->assertOk()->assertJsonPath('data.status', 'Contacted');

        // Booking the patient's next appointment (the normal booking command) marks it Booked.
        $booked = $this->postJson('/api/appointments', ['patient_id' => $this->p['A']->public_id, 'branch_ref' => 'b1', 'service_ref' => 'svc2', 'date' => '2026-10-05', 'start_time' => '10:00'])->assertCreated();
        $task->refresh();
        $this->assertSame('Booked', $task->status);
        $this->assertSame($booked->json('data.id'), $task->appointment->public_id);
        // Cancelling that appointment opens it again; closing without a booking needs a note.
        $this->postJson("/api/appointments/{$booked->json('data.id')}/cancel", ['expected_revision' => 1, 'reason' => 'Synthetic cancellation'])->assertOk();
        $this->assertSame('Open', $task->fresh()->status);
        $this->patchJson("/api/followups/{$task->public_id}", ['action' => 'close', 'expected_revision' => $task->fresh()->revision])->assertStatus(422)->assertJsonValidationErrors('note');
        $this->patchJson("/api/followups/{$task->public_id}", ['action' => 'close', 'note' => 'Patient moved abroad', 'expected_revision' => $task->fresh()->revision])->assertOk()->assertJsonPath('data.status', 'Closed');
        $this->expectException(\Illuminate\Database\QueryException::class);
        FollowupTask::query()->delete();
    }

    public function test_follow_up_creation_rejects_an_unknown_selected_service_and_recovers_the_original_task(): void
    {
        $this->completedTreatment();
        $this->actingAsUser('staffB1');
        $headers = ['Idempotency-Key' => 'followup-staff-recovery'];
        $request = [
            'patient_id' => $this->p['A']->public_id, 'branch_ref' => 'b1',
            'reason' => 'Schedule follow-up', 'due_on' => '2026-10-05',
        ];
        $this->postJson('/api/followups', $request + ['service_ref' => 'unknown-service'], $headers)
            ->assertUnprocessable()->assertJsonValidationErrors('service_ref');
        $this->assertSame(0, FollowupTask::count());
        $request['service_ref'] = 'svc1';
        $saved = $this->postJson('/api/followups', $request, $headers)->assertCreated()->json('data.id');
        $this->postJson('/api/followups', $request, $headers)->assertCreated()
            ->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $saved)
            ->assertJsonPath('data.patient.id', $request['patient_id'])->assertJsonPath('data.branch.id', 'b1')
            ->assertJsonPath('data.due_on', '2026-10-05')->assertJsonPath('data.service.id', 'svc1');
        $this->assertSame(1, FollowupTask::count());
    }

    public function test_dentist_scope_keyed_creation_and_required_revision(): void
    {
        $task = Followups::fromTreatment($this->completedTreatment());
        $path = '/api/followups/'.$task->public_id;
        $body = ['patient_id' => $this->p['A']->public_id, 'branch_ref' => 'b1', 'reason' => 'Synthetic follow-up', 'due_on' => '2026-10-10'];
        $headers = ['Idempotency-Key' => 'followup-dentist-retry'];
        $this->actingAsUser('dentist2');
        $this->getJson($path)->assertNotFound();
        $this->getJson('/api/followups')->assertOk()->assertJsonCount(0, 'data');
        $this->postJson('/api/followups', $body, $headers)->assertNotFound();
        $this->patchJson($path, ['action' => 'contacted', 'expected_revision' => 1])->assertNotFound();
        $this->actingAsUser('dentist1');
        $this->getJson($path)->assertOk();
        $this->postJson('/api/followups', $body)->assertUnprocessable();
        $id = $this->postJson('/api/followups', $body, $headers)->assertCreated()->json('data.id');
        $this->postJson('/api/followups', $body, $headers)->assertCreated()->assertJsonPath('data.id', $id);
        $this->assertSame(2, FollowupTask::count());
        $this->patchJson($path, ['action' => 'contacted'])->assertUnprocessable();
        $this->patchJson($path, ['action' => 'contacted', 'expected_revision' => 1])->assertOk()->assertJsonPath('data.status', 'Contacted');
        $this->patchJson($path, ['action' => 'contacted', 'expected_revision' => 1])->assertConflict();
    }

    public function test_scope_owner_metadata_overdue_flag_and_audit_without_reason(): void
    {
        $task = Followups::fromTreatment($this->completedTreatment('A', '2026-09-20'));
        $this->actingAsUser('staffB1');
        $this->assertTrue($this->getJson('/api/followups?due=overdue')->assertOk()->json('data.0.overdue'));
        $this->postJson('/api/followups', ['patient_id' => $this->p['A']->public_id, 'branch_ref' => 'b1', 'reason' => 'Recheck bite', 'due_on' => '2026-10-10'], ['Idempotency-Key' => 'followup-test-create'])->assertCreated();
        $this->actingAsUser('staffB2');
        $this->assertSame([], $this->getJson('/api/followups')->assertOk()->json('data'));
        $this->postJson('/api/followups', ['patient_id' => $this->p['A']->public_id, 'branch_ref' => 'b1', 'reason' => 'x', 'due_on' => '2026-10-10'])->assertForbidden();
        $this->actingAsUser('owner');
        $owner = $this->getJson('/api/followups')->assertOk();
        $this->assertSame(2, $owner->json('meta.counts.open'));
        $this->assertSame(1, $owner->json('meta.counts.overdue'));
        $this->assertStringNotContainsString(self::REASON, $owner->getContent());
        $this->assertStringNotContainsString('Recheck bite', $owner->getContent());
        $this->actingAsUser('patientA');
        $this->getJson('/api/followups')->assertForbidden();

        $audit = AuditLog::where('action', 'like', 'followup.%')->get()->toJson();
        $this->assertStringNotContainsString(self::REASON, $audit);
        $this->assertStringNotContainsString('Recheck bite', $audit);
        $this->assertNotSame(self::REASON, DB::table('followup_tasks')->where('id', $task->id)->value('reason')); // encrypted at rest
        $summary = \App\Services\Automations\OwnerSummaryData::forDate('2026-09-28');
        $b1 = collect($summary['branches'])->firstWhere('name', 'Branch B1');
        $this->assertSame([2, 1], [$b1['followups_open'], $b1['followups_overdue']]);
    }

    public function test_the_optional_reminder_is_off_by_default_needs_dentist_wording_and_sends_once_when_due(): void
    {
        $task = Followups::fromTreatment($this->completedTreatment('A', '2026-10-05'));
        $this->assertFalse(AutomationSetting::find('followup_reminders')->enabled);
        $this->assertTrue((bool) MessageTemplate::find('followup_due')->needs_dentist);
        $job = app(FollowupReminders::class);
        $settings = ['days_before' => 0];
        $this->assertSame(['sent' => 0, 'skipped' => 0], $job->run(CarbonImmutable::parse('2026-10-04 10:00', 'Asia/Manila'), $settings)); // not due yet
        $this->assertSame(['sent' => 1, 'skipped' => 0], $job->run(CarbonImmutable::parse('2026-10-05 10:00', 'Asia/Manila'), $settings));
        $this->assertSame(['sent' => 0, 'skipped' => 0], $job->run(CarbonImmutable::parse('2026-10-05 15:00', 'Asia/Manila'), $settings)); // once
        $this->assertSame(['sent' => 0, 'skipped' => 0], $job->run(CarbonImmutable::parse('2026-10-06 03:00', 'Asia/Manila'), $settings)); // branch closed at night
        $this->assertSame(1, MailDispatch::where('purpose', 'followup_due')->count());
        // The email carries no reason and no health advice.
        $mail = (new \App\Mail\FollowupDueMail($task->load(['patient.person', 'branch'])))->render();
        $this->assertStringNotContainsString('extraction', $mail);
        $this->assertStringContainsString('follow-up visit', $mail);
    }
}

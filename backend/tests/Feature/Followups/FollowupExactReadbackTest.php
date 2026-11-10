<?php

namespace Tests\Feature\Followups;

use App\Models\AuditLog;
use App\Models\FollowupTask;
use App\Models\MailDispatch;
use App\Models\UserBranchScope;
use App\Models\UserNotification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Authored only: requires separately approved disposable PostgreSQL; never run under the database hold. */
class FollowupExactReadbackTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private const REASON = 'Synthetic private readback reason';
    private const NOTE = 'Synthetic private readback closure';

    protected function setUp(): void
    {
        parent::setUp();
        config(['session.driver' => 'array']); // Isolate GET side-effect checks from session persistence.
        $this->setUpSchedulingWorld();
    }

    private function task(string $status = 'Open', int $revision = 1, string $branch = 'b1'): FollowupTask
    {
        return FollowupTask::create([
            'patient_id' => $this->p['A']->id, 'branch_id' => $this->b[$branch]->id,
            'reason' => self::REASON, 'due_on' => '2026-10-05', 'source' => 'front_desk',
            'status' => $status, 'revision' => $revision,
            'close_note' => $status === 'Closed' ? self::NOTE : null,
            'closed_at' => $status === 'Closed' ? now() : null,
            'contacted_at' => $status === 'Contacted' ? now() : null,
        ])->fresh();
    }

    private function path(FollowupTask $task): string
    {
        return '/api/followups/'.$task->public_id;
    }

    private function assertPrivateDataAbsent(string $body, FollowupTask $task): void
    {
        foreach ([self::REASON, self::NOTE, $task->public_id, $this->p['A']->public_id,
            $this->p['A']->person->fullName()] as $private) {
            $this->assertStringNotContainsString($private, $body);
        }
    }

    public function test_same_branch_staff_reads_exact_identity_without_generic_profile_access(): void
    {
        $task = $this->task();
        $this->actingAsUser('staffB1');
        // Existing work-list/update access is branch-based; patient-panel access is stricter.
        $this->assertFalse($this->u['staffB1']->can('viewProfile', $this->p['A']));
        $this->getJson($this->path($task))->assertOk()
            ->assertJsonPath('data.id', $task->public_id)
            ->assertJsonPath('data.patient.id', $this->p['A']->public_id)
            ->assertJsonPath('data.branch.id', 'b1')
            ->assertJsonPath('data.status', 'Open')->assertJsonPath('data.revision', 1)
            ->assertJsonPath('data.reason', self::REASON);
        $this->getJson('/api/patients/'.$this->p['A']->public_id.'/followups')->assertForbidden();
        $this->getJson('/api/followups')->assertOk()->assertJsonPath('data.0.id', $task->public_id);
    }

    public function test_assigned_dentist_reads_closed_task_and_revision(): void
    {
        $task = $this->task('Closed', 9);
        $this->actingAsUser('dentist1');
        $response = $this->getJson($this->path($task))->assertOk()
            ->assertJsonPath('data.id', $task->public_id)
            ->assertJsonPath('data.patient.id', $this->p['A']->public_id)
            ->assertJsonPath('data.branch.id', 'b1')->assertJsonPath('data.status', 'Closed')
            ->assertJsonPath('data.revision', 9)->assertJsonPath('data.close_note', self::NOTE)
            ->assertJsonPath('data.can_contact', false)->assertJsonPath('data.can_close', false);
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        $this->getJson('/api/followups')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_contacted_readback_uses_the_same_representation_as_the_list(): void
    {
        $task = $this->task('Contacted', 7);
        $this->actingAsUser('staffB1');
        $exact = $this->getJson($this->path($task))->assertOk()
            ->assertJsonPath('data.status', 'Contacted')->assertJsonPath('data.revision', 7)
            ->assertJsonPath('data.can_contact', false);
        $list = $this->getJson('/api/followups')->assertOk();
        $this->assertSame($list->json('data.0'), $exact->json('data'));
    }

    public function test_exact_read_is_available_beyond_both_list_caps(): void
    {
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-05', '09:00');
        $target = $this->task();
        for ($index = 0; $index < 300; $index++) {
            $other = $this->task();
            $other->update(['due_on' => '2026-10-04']);
        }
        $this->actingAsUser('staffB1');
        $workList = $this->getJson('/api/followups')->assertOk()->assertJsonCount(300, 'data');
        $this->assertNotContains($target->public_id, array_column($workList->json('data'), 'id'));
        // The patient panel sorts descending; make the target older than its latest 50.
        $target->update(['due_on' => '2026-10-03']);
        $patientList = $this->getJson('/api/patients/'.$this->p['A']->public_id.'/followups')
            ->assertOk()->assertJsonCount(50, 'data');
        $this->assertNotContains($target->public_id, array_column($patientList->json('data'), 'id'));
        $this->getJson($this->path($target))->assertOk()->assertJsonPath('data.id', $target->public_id);
    }

    public function test_booked_readback_preserves_the_linked_appointment_identity(): void
    {
        $appointment = $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-05', '10:00');
        $task = $this->task();
        $task->update(['status' => 'Booked', 'appointment_id' => $appointment->id, 'revision' => 6]);
        $this->actingAsUser('staffB1');
        $this->getJson($this->path($task))->assertOk()->assertJsonPath('data.status', 'Booked')
            ->assertJsonPath('data.revision', 6)->assertJsonPath('data.appointment.id', $appointment->public_id);
    }

    public function test_other_branch_staff_dentist_and_unscoped_staff_receive_no_clinical_details(): void
    {
        $task = $this->task('Closed', 4);
        foreach (['staffB2', 'dentist3', 'staffNone'] as $actor) {
            $this->actingAsUser($actor);
            $response = $this->getJson($this->path($task))->assertNotFound();
            $this->assertPrivateDataAbsent($response->getContent(), $task);
        }
    }

    public function test_owner_and_patient_are_denied_while_owner_list_stays_redacted(): void
    {
        $task = $this->task('Closed', 5);
        foreach (['owner', 'patientA', 'patientB'] as $actor) {
            $this->actingAsUser($actor);
            $response = $this->getJson($this->path($task))->assertForbidden();
            $this->assertPrivateDataAbsent($response->getContent(), $task);
        }
        $this->actingAsUser('owner');
        $owner = $this->getJson('/api/followups?status=Closed')->assertOk()
            ->assertJsonPath('data.0.id', $task->public_id)->assertJsonPath('data.0.revision', 5);
        $this->assertEqualsCanonicalizing(['id', 'status', 'due_on', 'overdue', 'branch', 'source', 'revision'],
            array_keys($owner->json('data.0')));
        $this->assertStringNotContainsString(self::REASON, $owner->getContent());
        $this->assertStringNotContainsString(self::NOTE, $owner->getContent());
    }

    public function test_guest_cannot_read_a_task(): void
    {
        $task = $this->task();
        $response = $this->getJson($this->path($task))->assertUnauthorized();
        $this->assertPrivateDataAbsent($response->getContent(), $task);
    }

    public function test_invalid_missing_and_internal_numeric_keys_are_not_task_identity(): void
    {
        $task = $this->task();
        $this->actingAsUser('staffB1');
        foreach (['not-a-task', '01ARZ3NDEKTSV4RRFFQ69G5FAV', (string) $task->id] as $key) {
            $response = $this->getJson('/api/followups/'.$key)->assertNotFound();
            $this->assertPrivateDataAbsent($response->getContent(), $task);
        }
    }

    public function test_current_row_overrides_a_stale_route_snapshot(): void
    {
        $task = $this->task();
        $snapshot = $task->fresh(['patient.person', 'branch']);
        Route::bind('followupTask', fn () => $snapshot);
        $task->update(['patient_id' => $this->p['B']->id, 'status' => 'Contacted', 'revision' => 12]);
        $this->actingAsUser('staffB1');
        $this->getJson($this->path($task))->assertOk()
            ->assertJsonPath('data.id', $task->public_id)->assertJsonPath('data.patient.id', $this->p['B']->public_id)
            ->assertJsonPath('data.branch.id', 'b1')->assertJsonPath('data.status', 'Contacted')
            ->assertJsonPath('data.revision', 12);
    }

    public function test_changed_branch_on_a_stale_route_snapshot_is_not_disclosed(): void
    {
        $task = $this->task();
        $snapshot = $task->fresh(['patient.person', 'branch']);
        Route::bind('followupTask', fn () => $snapshot);
        $task->update(['branch_id' => $this->b['b2']->id, 'revision' => 3]);
        $this->actingAsUser('staffB1');
        $response = $this->getJson($this->path($task))->assertNotFound();
        $this->assertPrivateDataAbsent($response->getContent(), $task);
    }

    public function test_staff_scope_and_dentist_assignment_revocation_apply_to_the_next_read(): void
    {
        $task = $this->task();
        $this->actingAsUser('staffB1');
        $this->getJson($this->path($task))->assertOk();
        UserBranchScope::where('user_id', $this->u['staffB1']->id)->update(['branch_id' => $this->b['b2']->id]);
        $this->assertPrivateDataAbsent($this->getJson($this->path($task))->assertNotFound()->getContent(), $task);
        $this->actingAsUser('dentist1');
        $this->getJson($this->path($task))->assertOk();
        $this->d['d1']->branches()->sync([$this->b['b2']->id]);
        $this->assertPrivateDataAbsent($this->getJson($this->path($task))->assertNotFound()->getContent(), $task);
    }

    public function test_exact_read_has_no_write_audit_or_notification_side_effects(): void
    {
        $task = $this->task('Closed', 11);
        $this->actingAsUser('staffB1');
        $before = $task->getRawOriginal();
        $counts = [FollowupTask::count(), AuditLog::count(), UserNotification::count(), MailDispatch::count()];
        DB::flushQueryLog();
        DB::enableQueryLog();
        try {
            $this->getJson($this->path($task))->assertOk();
            $this->getJson($this->path($task))->assertOk();
            $queries = DB::getQueryLog();
        } finally {
            DB::disableQueryLog();
            DB::flushQueryLog();
        }
        // This token-authenticated fixture does not write browser session state.
        foreach ($queries as $query) {
            $this->assertMatchesRegularExpression('/^select\b/i', ltrim($query['query']));
        }
        $this->assertSame($before, $task->fresh()->getRawOriginal());
        $this->assertSame($counts, [FollowupTask::count(), AuditLog::count(), UserNotification::count(), MailDispatch::count()]);
    }
}

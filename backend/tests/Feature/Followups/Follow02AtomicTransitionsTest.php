<?php

namespace Tests\Feature\Followups;

use App\Models\AuditLog;
use App\Models\FollowupTask;
use App\Services\Audit\AuditService;
use Closure;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use RuntimeException;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/**
 * FOLLOW-02: authored, NOT executed during continuous development.
 * Inherits TestCase's PostgreSQL scratch-database guard. DatabaseMigrations
 * provides committed fixtures for separate-process races; never run in parallel
 * with another suite sharing that database. Real races additionally require
 * FOLLOW02_RUN_CONCURRENCY=1 after explicit execution approval.
 */
class Follow02AtomicTransitionsTest extends TestCase
{
    use DatabaseMigrations, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        // Existing in-scope encounters grant Staff the same profile authority
        // used by the production create path; no Patient-policy bypass.
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-05', '09:00');
        $this->existing('B', 'd3', 'b2', 'svc1', '2026-10-05', '09:00');
    }

    private function payload(string $patient = 'A', string $branch = 'b1'): array
    {
        return ['patient_id' => $this->p[$patient]->public_id, 'branch_ref' => $branch,
            'reason' => 'Synthetic follow-up reason', 'due_on' => '2026-10-05'];
    }

    private function task(string $patient = 'A', string $branch = 'b1', array $extra = []): FollowupTask
    {
        return FollowupTask::create($extra + ['patient_id' => $this->p[$patient]->id, 'branch_id' => $this->b[$branch]->id,
            'reason' => 'Synthetic private reason', 'due_on' => '2026-10-05', 'source' => 'front_desk', 'status' => 'Open',
            'created_by_user_id' => $this->u['staffBoth']->id, 'updated_by_user_id' => $this->u['staffBoth']->id])->fresh();
    }

    private function logs()
    {
        return AuditLog::where('action', 'like', 'followup.%')->orderBy('id');
    }

    private function assertAudit(string $action, FollowupTask $task, string $actor = 'staffB1'): void
    {
        $log = $this->logs()->where('action', $action)->where('payload->task', $task->public_id)->sole();
        $this->assertSame($this->u[$actor]->id, $log->actor_user_id);
        $this->assertSame($this->u[$actor]->role->value, $log->actor_role);
        $this->assertSame('administrative', $log->category);
        $this->assertSame('Patient', $log->auditable_type);
        $this->assertSame($task->patient->public_id, $log->auditable_public_id);
        // Keep the established minimal audit projection, including branch ref
        // in metadata. No new clinical text or inferred branch column.
        $this->assertEquals(['task' => $task->public_id, 'status' => $task->status,
            'due_on' => $task->dueOn(), 'branch' => $task->branch->legacy_ref], $log->payload);
        $this->assertStringNotContainsString($task->reason, json_encode($log->payload));
        if ($task->close_note) $this->assertStringNotContainsString($task->close_note, json_encode($log->payload));
    }

    private function failingAudit(bool $afterInsert = false): void
    {
        $this->app->bind(AuditService::class, fn () => new class($afterInsert) extends AuditService {
            public function __construct(private bool $afterInsert) {}

            public function record(array $attributes): AuditLog
            {
                if ($this->afterInsert) parent::record($attributes);
                throw new RuntimeException('Synthetic follow-up audit failure');
            }
        });
    }

    private function assertFailure(Closure $command, string $message): void
    {
        $this->withoutExceptionHandling();
        try {
            $command();
            $this->fail('The command must propagate its failure.');
        } catch (RuntimeException $e) {
            $this->assertSame($message, $e->getMessage());
        } finally {
            $this->withExceptionHandling();
        }
    }

    /** Explicitly bind the earlier snapshot while preserving the real HTTP middleware. */
    private function bindSnapshot(FollowupTask $task): void
    {
        $snapshot = $task->fresh(['patient.person', 'branch', 'appointment']);
        Route::bind('followupTask', function (string $id) use ($snapshot) {
            $this->assertSame($snapshot->public_id, $id);

            return $snapshot;
        });
    }

    public function test_creation_and_its_required_audit_preserve_patient_and_branch_identity(): void
    {
        $this->actingAsUser('staffB2');
        $response = $this->postJson('/api/followups', $this->payload('B', 'b2'))->assertCreated()
            ->assertJsonPath('data.patient.id', $this->p['B']->public_id)->assertJsonPath('data.branch.id', 'b2')
            ->assertJsonPath('data.status', 'Open')->assertJsonPath('data.revision', 1);
        $task = FollowupTask::where('public_id', $response->json('data.id'))->sole();
        $this->assertSame(1, $this->logs()->count());
        $this->assertAudit('followup.created', $task, 'staffB2');
    }

    public function test_creation_audit_failure_rolls_back_the_new_task(): void
    {
        $this->actingAsUser('staffB1');
        $this->failingAudit();
        $this->assertFailure(fn () => $this->postJson('/api/followups', $this->payload()), 'Synthetic follow-up audit failure');
        $this->assertSame(0, FollowupTask::count());
        $this->assertSame(0, $this->logs()->count());
    }

    public function test_failure_after_creation_audit_insert_rolls_back_both_rows(): void
    {
        $this->actingAsUser('staffB1');
        $this->failingAudit(true);
        $this->assertFailure(fn () => $this->postJson('/api/followups', $this->payload()), 'Synthetic follow-up audit failure');
        $this->assertSame(0, FollowupTask::count());
        $this->assertSame(0, $this->logs()->count());
    }

    public function test_contacted_and_close_each_record_their_own_accepted_state(): void
    {
        $task = $this->task();
        $this->actingAsUser('staffB1');
        $this->patchJson("/api/followups/{$task->public_id}", ['action' => 'contacted'])->assertOk()
            ->assertJsonPath('data.status', 'Contacted')->assertJsonPath('data.revision', 2);
        $this->assertAudit('followup.contacted', $task->fresh());
        $this->patchJson("/api/followups/{$task->public_id}", ['action' => 'close', 'note' => 'Synthetic closure note'])->assertOk()
            ->assertJsonPath('data.status', 'Closed')->assertJsonPath('data.revision', 3);
        $this->assertAudit('followup.closed', $task->fresh());
        $this->assertSame(['Contacted', 'Closed'], $this->logs()->get()->map(fn ($log) => $log->payload['status'])->all());
    }

    public function test_audit_failure_restores_all_persisted_transition_fields(): void
    {
        foreach (['contacted', 'close'] as $action) {
            $task = $this->task();
            $before = $task->getRawOriginal();
            $this->actingAsUser('staffB1');
            $this->failingAudit();
            $this->assertFailure(fn () => $this->patchJson("/api/followups/{$task->public_id}",
                ['action' => $action, 'note' => 'Synthetic closure note']), 'Synthetic follow-up audit failure');
            $this->assertSame($before, $task->fresh()->getRawOriginal());
            $this->assertSame(0, $this->logs()->count());
        }
    }

    public function test_failure_after_transition_audit_insert_rolls_back_task_and_audit(): void
    {
        $task = $this->task();
        $before = $task->getRawOriginal();
        $this->actingAsUser('staffB1');
        $this->failingAudit(true);
        $this->assertFailure(fn () => $this->patchJson("/api/followups/{$task->public_id}", ['action' => 'contacted']), 'Synthetic follow-up audit failure');
        $this->assertSame($before, $task->fresh()->getRawOriginal());
        $this->assertSame(0, $this->logs()->count());
    }

    public function test_a_failed_mutation_emits_no_success_audit(): void
    {
        $task = $this->task();
        $before = $task->getRawOriginal();
        $this->actingAsUser('staffB1');
        $originalEvents = FollowupTask::getEventDispatcher();
        FollowupTask::setEventDispatcher(clone $originalEvents);
        try {
            FollowupTask::updating(function (FollowupTask $current) use ($task) {
                if ($current->id === $task->id) throw new RuntimeException('Synthetic follow-up mutation failure');
            });
            $this->assertFailure(fn () => $this->patchJson("/api/followups/{$task->public_id}", ['action' => 'contacted']), 'Synthetic follow-up mutation failure');
        } finally {
            FollowupTask::setEventDispatcher($originalEvents);
        }
        $this->assertSame($before, $task->fresh()->getRawOriginal());
        $this->assertSame(0, $this->logs()->count());
    }

    public function test_locked_branch_denies_a_stale_previously_authorized_snapshot(): void
    {
        $task = $this->task();
        $this->bindSnapshot($task);
        // Synthetic drift between route binding and locking; no transfer policy is introduced.
        $task->update(['branch_id' => $this->b['b2']->id]);
        $before = $task->fresh()->getRawOriginal();
        $this->actingAsUser('staffB1');
        $this->patchJson("/api/followups/{$task->public_id}", ['action' => 'contacted'])->assertForbidden();
        $this->assertSame($before, $task->fresh()->getRawOriginal());
        $this->assertSame(0, $this->logs()->count());
    }

    public function test_locked_state_and_identity_override_cached_route_relations(): void
    {
        $task = $this->task('B', 'b2');
        $this->bindSnapshot($task);
        $task->update(['patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id, 'status' => 'Contacted', 'revision' => 7]);
        $this->actingAsUser('staffB1');
        $this->patchJson("/api/followups/{$task->public_id}", ['action' => 'close', 'note' => 'Synthetic closure note'])->assertOk()
            ->assertJsonPath('data.patient.id', $this->p['A']->public_id)->assertJsonPath('data.branch.id', 'b1')
            ->assertJsonPath('data.status', 'Closed')->assertJsonPath('data.revision', 8);
        $this->assertAudit('followup.closed', $task->fresh());
    }

    public function test_locked_closed_state_preserves_validation_response_and_history(): void
    {
        $task = $this->task();
        $this->bindSnapshot($task);
        $task->update(['status' => 'Closed', 'close_note' => 'Synthetic earlier closure', 'revision' => 4]);
        $before = $task->fresh()->getRawOriginal();
        $this->actingAsUser('staffB1');
        $response = $this->patchJson("/api/followups/{$task->public_id}", ['action' => 'contacted'])->assertStatus(422)->assertJsonValidationErrors('action');
        $this->assertSame('This follow-up is already Closed.', $response->json('errors.action.0'));
        $this->assertSame($before, $task->fresh()->getRawOriginal());
        $this->assertSame(0, $this->logs()->count());
    }

    public function test_unbooked_close_requires_a_trimmed_note_and_booked_close_does_not(): void
    {
        $task = $this->task();
        $before = $task->getRawOriginal();
        $this->actingAsUser('staffB1');
        foreach ([[], ['note' => '   ']] as $body) {
            $this->patchJson("/api/followups/{$task->public_id}", ['action' => 'close'] + $body)->assertStatus(422)->assertJsonValidationErrors('note');
            $this->assertSame($before, $task->fresh()->getRawOriginal());
            $this->assertSame(0, $this->logs()->count());
        }
        $this->patchJson("/api/followups/{$task->public_id}", ['action' => 'close', 'note' => '  Synthetic reason  '])->assertOk();
        $this->assertSame('Synthetic reason', $task->fresh()->close_note);
        $appointment = $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-06', '10:00');
        $booked = $this->task('A', 'b1', ['status' => 'Booked', 'appointment_id' => $appointment->id]);
        $this->patchJson("/api/followups/{$booked->public_id}", ['action' => 'close'])->assertOk()
            ->assertJsonPath('data.status', 'Closed')->assertJsonPath('data.revision', 2)
            ->assertJsonPath('data.appointment.id', $appointment->public_id);
        $this->assertNull($booked->fresh()->close_note);
        $this->assertAudit('followup.closed', $booked->fresh());
    }

    public function test_repeated_commands_and_both_serial_contact_close_orders_keep_consistent_audits(): void
    {
        $this->actingAsUser('staffB1');
        $task = $this->task();
        $this->patchJson("/api/followups/{$task->public_id}", ['action' => 'contacted'])->assertOk();
        $this->patchJson("/api/followups/{$task->public_id}", ['action' => 'contacted'])->assertStatus(422);
        $this->patchJson("/api/followups/{$task->public_id}", ['action' => 'close', 'note' => 'Synthetic closure'])->assertOk();
        $this->patchJson("/api/followups/{$task->public_id}", ['action' => 'close', 'note' => 'Different note'])->assertStatus(422);
        $this->assertSame(['Closed', 3, 'Synthetic closure'], [$task->fresh()->status, $task->fresh()->revision, $task->fresh()->close_note]);
        $this->assertSame(2, $this->logs()->where('payload->task', $task->public_id)->count());
        $closedFirst = $this->task();
        $this->patchJson("/api/followups/{$closedFirst->public_id}", ['action' => 'close', 'note' => 'Synthetic closure'])->assertOk();
        $this->patchJson("/api/followups/{$closedFirst->public_id}", ['action' => 'contacted'])->assertStatus(422);
        $this->assertSame(['Closed', 2], [$closedFirst->fresh()->status, $closedFirst->fresh()->revision]);
        $this->assertSame(1, $this->logs()->where('payload->task', $closedFirst->public_id)->count());
    }

    public function test_branch_and_role_denials_leave_tasks_and_success_history_unchanged(): void
    {
        $task = $this->task();
        $before = $task->getRawOriginal();
        foreach (['staffB2', 'dentist3', 'owner', 'patientA'] as $actor) {
            $this->actingAsUser($actor);
            $this->patchJson("/api/followups/{$task->public_id}", ['action' => 'contacted'])->assertForbidden();
            $this->postJson('/api/followups', $this->payload())->assertForbidden();
        }
        $this->assertSame($before, $task->fresh()->getRawOriginal());
        $this->assertSame(1, FollowupTask::count());
        $this->assertSame(0, $this->logs()->count());
    }

    public function test_owner_summary_remains_redacted_and_an_authorized_dentist_can_create(): void
    {
        $task = $this->task('A', 'b1', ['status' => 'Closed', 'close_note' => 'Synthetic private closure']);
        $this->actingAsUser('owner');
        $response = $this->getJson('/api/followups?status=Closed')->assertOk();
        $this->assertEqualsCanonicalizing(['id', 'status', 'due_on', 'overdue', 'branch', 'source', 'revision'], array_keys($response->json('data.0')));
        $this->assertStringNotContainsString($task->reason, $response->getContent());
        $this->assertStringNotContainsString($task->close_note, $response->getContent());
        $this->actingAsUser('dentist1');
        $created = $this->postJson('/api/followups', $this->payload())->assertCreated()->json('data.id');
        $this->assertAudit('followup.created', FollowupTask::where('public_id', $created)->sole(), 'dentist1');
    }

    /** Real PostgreSQL races: separate kernels/connections, committed fixtures, explicit opt-in. */
    public function test_concurrent_duplicates_and_contact_close_keep_each_accepted_audit(): void
    {
        if (getenv('FOLLOW02_RUN_CONCURRENCY') !== '1' || ! function_exists('proc_open')) {
            $this->markTestSkipped('PostgreSQL concurrency execution is explicitly deferred; requires approved isolated execution and FOLLOW02_RUN_CONCURRENCY=1.');
        }
        $this->assertSame('pgsql', DB::connection()->getDriverName());
        $this->assertSame('dental_clinic_scratch', DB::connection()->getDatabaseName());
        $this->assertSame(0, DB::transactionLevel(), 'Race fixtures must be committed.');
        foreach ([['contacted', 'contacted'], ['close', 'close'], ['contacted', 'close']] as $actions) {
            $task = $this->task();
            $results = $this->race($task, $actions);
            $statuses = array_column($results, 'status');
            sort($statuses);
            $accepted = array_values(array_filter($results, fn ($r) => $r['status'] === 200));
            $fresh = $task->fresh();
            if ($actions[0] === $actions[1]) {
                $this->assertSame([200, 422], $statuses);
                $this->assertSame($actions[0] === 'close' ? 'Closed' : 'Contacted', $fresh->status);
            } else {
                $this->assertContains($statuses, [[200, 200], [200, 422]]);
                $this->assertSame('Closed', $fresh->status);
            }
            $this->assertSame(1 + count($accepted), $fresh->revision);
            $logs = $this->logs()->where('payload->task', $task->public_id)->get();
            $this->assertCount(count($accepted), $logs);
            foreach ($accepted as $response) {
                $this->assertSame($task->public_id, $response['body']['data']['id']);
                $this->assertSame($this->p['A']->public_id, $response['body']['data']['patient']['id']);
                $this->assertSame($response['action'] === 'close' ? 'Closed' : 'Contacted', $response['body']['data']['status']);
                $this->assertCount(1, $logs->filter(fn ($log) => $log->action === 'followup.'.($response['action'] === 'close' ? 'closed' : 'contacted')));
            }
            $this->assertSame($fresh->status, $logs->last()->payload['status']);
        }
    }

    private function race(FollowupTask $task, array $actions): array
    {
        $token = $this->u['staffB1']->createToken('follow02-concurrency')->plainTextToken;
        $startAt = microtime(true) + 2;
        $children = [];
        try {
            foreach ($actions as $action) {
                $process = proc_open([PHP_BINARY, base_path('tests/Support/concurrent_request.php'), $token,
                    "/api/followups/{$task->public_id}", json_encode(['action' => $action, 'note' => 'Synthetic concurrent closure']),
                    (string) $startAt, '{}', 'PATCH'], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path(),
                    array_merge(getenv(), ['APP_ENV' => 'testing', 'DB_CONNECTION' => 'pgsql', 'DB_DATABASE' => 'dental_clinic_scratch', 'DB_URL' => '',
                        'CACHE_STORE' => 'array', 'SESSION_DRIVER' => 'array', 'QUEUE_CONNECTION' => 'sync', 'PGOPTIONS' => '-c lock_timeout=5000 -c statement_timeout=10000']));
                if (! is_resource($process)) $this->fail('Could not start the isolated FOLLOW-02 worker.');
                $children[] = [$process, $pipes, $action];
            }
            $results = [];
            foreach ($children as [$process, $pipes, $action]) {
                $out = stream_get_contents($pipes[1]);
                stream_get_contents($pipes[2]); // Never print credentials or worker diagnostics.
                $result = json_decode($out, true);
                $this->assertIsArray($result, 'FOLLOW-02 worker returned no JSON result.');
                $this->assertArrayHasKey('status', $result);
                $results[] = ['action' => $action] + $result;
            }

            return $results;
        } finally {
            foreach ($children as [$process, $pipes]) {
                foreach ($pipes as $pipe) if (is_resource($pipe)) fclose($pipe);
                if (is_resource($process)) { proc_terminate($process); proc_close($process); }
            }
        }
    }
}

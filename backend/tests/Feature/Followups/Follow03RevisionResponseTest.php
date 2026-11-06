<?php

namespace Tests\Feature\Followups;

use App\Models\AuditLog;
use App\Models\FollowupTask;
use App\Services\Audit\AuditService;
use Closure;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** FOLLOW-03: authored only; uses the existing disposable PostgreSQL guard and fixtures. */
class Follow03RevisionResponseTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-05', '09:00');
        $this->actingAsUser('staffB1');
    }

    private function payload(): array
    {
        return ['patient_id' => $this->p['A']->public_id, 'branch_ref' => 'b1', 'reason' => 'Synthetic private FOLLOW-03 reason',
            'due_on' => '2026-10-05', 'service_ref' => 'svc1', 'assign_to_me' => true];
    }

    private function createTask()
    {
        return $this->postJson('/api/followups', $this->payload())->assertCreated();
    }

    private function assertFailure(Closure $command, string $message): void
    {
        $this->withoutExceptionHandling();
        try {
            $command();
            $this->fail('The required failure must propagate.');
        } catch (RuntimeException $e) {
            $this->assertSame($message, $e->getMessage());
        } finally {
            $this->withExceptionHandling();
        }
    }

    public function test_creation_returns_the_persisted_revision_and_one_unchanged_task_identity(): void
    {
        $response = $this->createTask()->assertJsonPath('data.revision', 1)->assertJsonPath('data.status', 'Open')
            ->assertJsonPath('data.patient.id', $this->p['A']->public_id)->assertJsonPath('data.branch.id', 'b1')
            ->assertJsonPath('data.reason', $this->payload()['reason'])->assertJsonPath('data.due_on', '2026-10-05')
            ->assertJsonPath('data.source', 'front_desk')->assertJsonPath('data.service.id', 'svc1');
        $id = $response->json('data.id');
        $this->assertMatchesRegularExpression('/^[0-9A-HJKMNP-TV-Z]{26}$/i', $id);
        $task = FollowupTask::where('public_id', $id)->sole();
        $storedRevision = DB::table('followup_tasks')->where('id', $task->id)->value('revision');
        $this->assertIsInt($response->json('data.revision'));
        $this->assertSame((int) $storedRevision, $response->json('data.revision'));
        $this->assertSame($task->revision, $response->json('data.revision'));
        $this->assertSame([$this->p['A']->id, $this->b['b1']->id, $this->svc['svc1']->id, $this->u['staffB1']->id],
            [$task->patient_id, $task->branch_id, $task->service_id, $task->assignee_user_id]);
        $this->assertSame(1, FollowupTask::count(), 'Reloading must never create another task.');
        $log = AuditLog::where('action', 'followup.created')->sole();
        $this->assertSame($id, $log->payload['task']);
        $this->assertSame($this->p['A']->public_id, $log->auditable_public_id);
        $this->assertStringNotContainsString($task->reason, $log->toJson());
        $this->assertNotSame($task->reason, DB::table('followup_tasks')->where('id', $task->id)->value('reason'));
    }

    public function test_creation_audit_stays_inside_the_mutation_transaction(): void
    {
        $baselineLevel = DB::transactionLevel();
        $audit = app(AuditService::class);
        $this->mock(AuditService::class)->shouldReceive('recordAdministrative')->once()->andReturnUsing(
            function (...$args) use ($baselineLevel, $audit) {
                $this->assertSame('followup.created', $args[0]);
                $this->assertGreaterThan($baselineLevel, DB::transactionLevel());

                return $audit->recordAdministrative(...$args);
            }
        );
        $this->createTask()->assertJsonPath('data.revision', 1);
        $this->assertSame($baselineLevel, DB::transactionLevel());
        $this->assertSame(1, FollowupTask::count());
        $this->assertSame(1, AuditLog::where('action', 'followup.created')->count());
    }

    public function test_audit_failure_before_or_after_insert_rolls_back_creation(): void
    {
        foreach ([false, true] as $afterInsert) {
            $this->app->bind(AuditService::class, fn () => new class($afterInsert) extends AuditService {
                public function __construct(private bool $afterInsert) {}

                public function record(array $attributes): AuditLog
                {
                    if ($this->afterInsert) parent::record($attributes);
                    throw new RuntimeException('Synthetic FOLLOW-03 audit failure');
                }
            });
            $this->assertFailure(fn () => $this->postJson('/api/followups', $this->payload()), 'Synthetic FOLLOW-03 audit failure');
            $this->assertSame(0, FollowupTask::count());
            $this->assertSame(0, AuditLog::where('action', 'followup.created')->count());
        }
    }

    public function test_failed_canonical_reload_rolls_back_the_task_and_creation_audit(): void
    {
        $events = FollowupTask::getEventDispatcher();
        FollowupTask::setEventDispatcher(clone $events);
        try {
            // Fail retrieval of the inserted Task, after its audit was written.
            // This catches moving the canonical reload outside the transaction.
            FollowupTask::retrieved(fn () => throw new RuntimeException('Synthetic FOLLOW-03 reload failure'));
            $this->assertFailure(fn () => $this->postJson('/api/followups', $this->payload()), 'Synthetic FOLLOW-03 reload failure');
        } finally {
            FollowupTask::setEventDispatcher($events);
        }
        $this->assertSame(0, FollowupTask::count());
        $this->assertSame(0, AuditLog::where('action', 'followup.created')->count());
    }

    public function test_follow02_transition_contract_increments_the_persisted_revision_and_preserves_rejections(): void
    {
        $id = $this->createTask()->assertJsonPath('data.revision', 1)->json('data.id');
        $task = FollowupTask::where('public_id', $id)->sole();
        $before = $task->getRawOriginal();
        $this->patchJson("/api/followups/$id", ['action' => 'close'])->assertStatus(422)->assertJsonValidationErrors('note');
        $this->assertSame($before, $task->fresh()->getRawOriginal());
        $this->patchJson("/api/followups/$id", ['action' => 'contacted'])->assertOk()->assertJsonPath('data.id', $id)
            ->assertJsonPath('data.status', 'Contacted')->assertJsonPath('data.revision', 2);
        $this->assertSame(2, $task->fresh()->revision);
        $before = $task->fresh()->getRawOriginal();
        $this->patchJson("/api/followups/$id", ['action' => 'contacted'])->assertStatus(422)->assertJsonValidationErrors('action');
        $this->assertSame($before, $task->fresh()->getRawOriginal());
        $this->patchJson("/api/followups/$id", ['action' => 'close', 'note' => 'Synthetic FOLLOW-03 closure'])->assertOk()
            ->assertJsonPath('data.id', $id)->assertJsonPath('data.status', 'Closed')->assertJsonPath('data.revision', 3);
        $this->assertSame(3, $task->fresh()->revision);
        $before = $task->fresh()->getRawOriginal();
        $this->patchJson("/api/followups/$id", ['action' => 'close', 'note' => 'Synthetic repeat'])->assertStatus(422)->assertJsonValidationErrors('action');
        $this->assertSame($before, $task->fresh()->getRawOriginal());
        $this->assertSame(1, FollowupTask::count());
        $logs = AuditLog::where('action', 'like', 'followup.%')->where('payload->task', $id)->orderBy('id')->get();
        $this->assertSame(['followup.created', 'followup.contacted', 'followup.closed'], $logs->pluck('action')->all());
        $this->assertSame(['Open', 'Contacted', 'Closed'], $logs->map(fn ($log) => $log->payload['status'])->all());
    }

    public function test_owner_metadata_projection_remains_redacted_with_the_canonical_revision(): void
    {
        $id = $this->createTask()->json('data.id');
        $this->actingAsUser('owner');
        $response = $this->getJson('/api/followups')->assertOk()->assertJsonPath('data.0.id', $id)->assertJsonPath('data.0.revision', 1);
        $this->assertEqualsCanonicalizing(['id', 'status', 'due_on', 'overdue', 'branch', 'source', 'revision'], array_keys($response->json('data.0')));
        $this->assertStringNotContainsString($this->payload()['reason'], $response->getContent());
        $this->postJson('/api/followups', $this->payload())->assertForbidden();
        $this->patchJson("/api/followups/$id", ['action' => 'contacted'])->assertForbidden();
        $this->assertSame(1, FollowupTask::where('public_id', $id)->sole()->revision);
    }
}

<?php

namespace Tests\Feature\Staffing;

use App\Http\Controllers\HandoverController;
use App\Models\AuditLog;
use App\Models\PatientHandover;
use App\Models\UserBranchScope;
use App\Services\Audit\AuditService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/**
 * Deferred simultaneous acceptance (separate from the deterministic stale-snapshot cases below):
 * independently verify a disposable PostgreSQL target using ScratchDatabaseGuard and committed fixtures;
 * release sending-side cancel and receiving-side acknowledge together on separate connections, in both
 * launch orders. Require exactly one 200 and one 422, one terminal state, only the winner's actor/timestamp,
 * and exactly one matching success audit. Never run that race inside RefreshDatabase's outer transaction.
 */
class Hnd01HandoverTransitionTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
    }

    private function handover(): PatientHandover
    {
        return PatientHandover::create([
            'patient_id' => $this->p['A']->id,
            'from_branch_id' => $this->b['b1']->id, 'to_branch_id' => $this->b['b2']->id,
            'from_dentist_profile_id' => $this->d['d1']->id, 'to_dentist_profile_id' => $this->d['d3']->id,
            'created_by_user_id' => $this->u['staffB1']->id,
            'summary' => 'HND-01 private summary', 'pending_treatment' => 'HND-01 private plan',
            'notes' => 'HND-01 private notes', 'document_ids' => [], 'status' => 'Sent',
        ]);
    }

    public static function transitions(): array
    {
        return [
            ['acknowledge', 'staffB2', 'Acknowledged', 'acknowledged', 'cancel', 'staffB1'],
            ['cancel', 'staffB1', 'Cancelled', 'cancelled', 'acknowledge', 'staffB2'],
        ];
    }

    #[DataProvider('transitions')]
    public function test_valid_transition_rejects_repeat_and_competing_stale_route_snapshot(
        string $command, string $who, string $status, string $event, string $otherCommand, string $otherWho
    ): void {
        $handover = $this->handover();
        $stale = $handover->fresh(); // Both requests bound the row while it was Sent.
        $this->actingAsUser($who);
        $path = "/api/handovers/{$handover->public_id}/{$command}";
        $this->postJson($path)->assertOk()->assertJsonPath('data.status', $status);
        $this->postJson($path)->assertStatus(422)->assertJsonValidationErrors('status');

        // Deterministic stale-snapshot regression, NOT a simultaneous PostgreSQL race test.
        $request = Request::create('/', 'POST');
        $request->setUserResolver(fn () => $this->u[$otherWho]);
        try {
            app(HandoverController::class)->{$otherCommand}($request, $stale);
            $this->fail('A stale Sent snapshot must not overwrite the winning transition.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('status', $exception->errors());
        }

        $fresh = $handover->fresh();
        $this->assertSame($status, $fresh->status);
        $this->assertSame($this->u[$who]->id, $fresh->getAttribute($event.'_by_user_id'));
        $this->assertNotNull($fresh->getAttribute($event.'_at'));
        $otherEvent = $event === 'acknowledged' ? 'cancelled' : 'acknowledged';
        $this->assertNull($fresh->getAttribute($otherEvent.'_at'));
        $this->assertNull($fresh->getAttribute($otherEvent.'_by_user_id'));
        $this->assertSame(['handover.'.$event], AuditLog::whereIn('action', ['handover.acknowledged', 'handover.cancelled'])->pluck('action')->all());
    }

    public static function rollbackTransitions(): array
    {
        return array_map(fn (array $transition) => array_slice($transition, 0, 4), self::transitions());
    }

    #[DataProvider('rollbackTransitions')]
    public function test_audit_failure_rolls_back_transition(string $command, string $who, string $status, string $event): void
    {
        $handover = $this->handover();
        $before = $handover->fresh()->getAttributes();
        $this->app->bind(AuditService::class, fn () => new class extends AuditService {
            public function record(array $attributes): AuditLog
            {
                parent::record($attributes);
                throw new \RuntimeException('HND-01 audit failure fixture');
            }
        });
        $this->actingAsUser($who);
        $this->withoutExceptionHandling();
        try {
            $this->postJson("/api/handovers/{$handover->public_id}/{$command}");
            $this->fail('The transition must roll back with its audit.');
        } catch (\RuntimeException $exception) {
            $this->assertSame('HND-01 audit failure fixture', $exception->getMessage());
        }
        $this->assertSame($before, $handover->fresh()->getAttributes());
        $this->assertSame(0, AuditLog::where('action', 'handover.'.$event)->count());
    }

    public function test_transition_authorization_and_owner_redaction_are_preserved(): void
    {
        $handover = $this->handover();
        foreach (['staffB1' => 'acknowledge', 'staffB2' => 'cancel', 'dentist1' => 'acknowledge', 'dentist3' => 'cancel'] as $who => $command) {
            $this->actingAsUser($who);
            $this->postJson("/api/handovers/{$handover->public_id}/{$command}")->assertForbidden();
        }
        foreach (['staffNone', 'dentist2', 'owner', 'patientA'] as $who) {
            $this->actingAsUser($who);
            foreach (['acknowledge', 'cancel'] as $command) {
                $this->postJson("/api/handovers/{$handover->public_id}/{$command}")->assertForbidden();
            }
        }
        $this->assertSame('Sent', $handover->fresh()->status);
        $this->assertSame(0, AuditLog::whereIn('action', ['handover.acknowledged', 'handover.cancelled'])->count());

        $this->actingAsUser('dentist3');
        $this->postJson("/api/handovers/{$handover->public_id}/acknowledge")->assertOk();
        $this->actingAsUser('owner');
        $this->getJson("/api/handovers/{$handover->public_id}")->assertOk()->assertJsonMissingPath('data.summary')
            ->assertJsonMissingPath('data.pending_treatment')->assertJsonMissingPath('data.notes')->assertJsonMissingPath('data.documents');
        $this->assertStringNotContainsString('HND-01 private', AuditLog::where('action', 'like', 'handover.%')->get()->toJson());
    }

    public function test_branch_scope_is_rechecked_and_historical_handover_remains_acknowledgeable(): void
    {
        $handover = $this->handover();
        $handover->update(['created_at' => now()->subDays(100)]);
        UserBranchScope::where('user_id', $this->u['staffB2']->id)->update(['branch_id' => $this->b['b1']->id]);
        $this->actingAsUser('staffB2');
        $this->postJson("/api/handovers/{$handover->public_id}/acknowledge")->assertForbidden();
        $this->assertSame('Sent', $handover->fresh()->status);
        $this->actingAsUser('dentist3');
        $this->postJson("/api/handovers/{$handover->public_id}/acknowledge")->assertOk();
    }

    public function test_authorization_uses_persisted_recipient_instead_of_stale_route_snapshot(): void
    {
        $handover = $this->handover();
        $stale = $handover->fresh();
        $handover->update(['to_dentist_profile_id' => null]);
        $request = Request::create('/', 'POST');
        $request->setUserResolver(fn () => $this->u['dentist3']);
        try {
            app(HandoverController::class)->acknowledge($request, $stale);
            $this->fail('A former recipient cannot acknowledge through a stale route snapshot.');
        } catch (\Symfony\Component\HttpKernel\Exception\HttpException $exception) {
            $this->assertSame(403, $exception->getStatusCode());
        }
        $this->assertSame('Sent', $handover->fresh()->status);
        $this->assertSame(0, AuditLog::where('action', 'handover.acknowledged')->count());
    }

    public function test_actor_role_is_reloaded_after_request_authentication(): void
    {
        $handover = $this->handover();
        $request = Request::create('/', 'POST');
        $request->setUserResolver(fn () => $this->u['dentist3']);
        // Persist the role change without updating the already authenticated User instance.
        $this->u['dentist3']->newQuery()->whereKey($this->u['dentist3']->id)->update(['role' => 'owner']);
        try {
            app(HandoverController::class)->acknowledge($request, $handover);
            $this->fail('A stale authenticated role cannot authorize the transition.');
        } catch (\Symfony\Component\HttpKernel\Exception\HttpException $exception) {
            $this->assertSame(403, $exception->getStatusCode());
        }
        $this->assertSame('Sent', $handover->fresh()->status);
        $this->assertSame(0, AuditLog::where('action', 'handover.acknowledged')->count());
    }
}

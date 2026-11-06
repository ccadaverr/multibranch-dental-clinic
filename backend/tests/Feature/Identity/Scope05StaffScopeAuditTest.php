<?php

namespace Tests\Feature\Identity;

use App\Models\AuditLog;
use App\Models\Person;
use App\Models\StaffProfile;
use App\Models\UserBranchScope;
use App\Services\Audit\AuditService;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/**
 * Deferred concurrency acceptance: verified disposable PostgreSQL, committed fixtures, separate connections.
 * Race assignment replacements and explicit account-scope replacements. Require each accepted audit to match
 * that command's serialized scope set; failed transactions leave neither grants nor success audit evidence.
 * Sequential assertions below do not verify concurrent lock or commit ordering.
 */
class Scope05StaffScopeAuditTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        foreach (['staffB1' => ['s-a', 'b1'], 'staffB2' => ['s-b', 'b2']] as $who => [$ref, $branch]) {
            StaffProfile::create([
                'legacy_ref' => $ref, 'person_id' => $this->u[$who]->person_id,
                'branch_id' => $this->b[$branch]->id, 'title' => 'Receptionist',
                'shift_start' => '09:00', 'shift_end' => '18:00', 'available' => true,
            ]);
        }
    }

    private function patchProfile(array $payload)
    {
        $this->actingAsUser('owner');

        return $this->patchJson('/api/staff/s-a', $payload);
    }

    private function audits()
    {
        return AuditLog::where('action', 'account.branch_scopes_changed')->orderBy('id');
    }

    public function test_reassignment_audits_actual_owner_target_and_resulting_grants_once(): void
    {
        $this->patchProfile(['branch_ref' => 'b2', 'actor_user_id' => $this->u['staffB1']->id, 'branch_refs' => ['b1']])
            ->assertOk()->assertJsonPath('data.id', 's-a')->assertJsonPath('data.branchId', 'b2');
        $audit = $this->audits()->sole();
        $this->assertSame($this->u['owner']->id, $audit->actor_user_id);
        $this->assertSame('owner', $audit->actor_role);
        $this->assertSame('User', $audit->auditable_type);
        $this->assertSame($this->u['staffB1']->public_id, $audit->auditable_public_id);
        $this->assertSame('administrative', $audit->category);
        $this->assertSame(['branch_refs' => ['b2']], $audit->payload);
        $this->assertSame([$this->b['b2']->id], UserBranchScope::where('user_id', $this->u['staffB1']->id)->pluck('branch_id')->all());
        $this->actingAsUser('staffB1');
        $this->getJson('/api/staff')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('data.0.id', 's-a')->assertJsonPath('data.1.id', 's-b');
    }

    public function test_audit_failure_after_insert_rolls_back_profile_scopes_and_audit(): void
    {
        $before = StaffProfile::where('legacy_ref', 's-a')->sole()->getAttributes();
        $this->app->bind(AuditService::class, fn () => new class extends AuditService {
            public function record(array $attributes): AuditLog
            {
                parent::record($attributes);
                throw new \RuntimeException('SCOPE-05 audit failure fixture');
            }
        });
        $this->withoutExceptionHandling();
        try {
            $this->patchProfile(['branch_ref' => 'b2', 'title' => 'Assistant']);
            $this->fail('Audit persistence is part of the assignment transaction.');
        } catch (\RuntimeException $exception) {
            $this->assertSame('SCOPE-05 audit failure fixture', $exception->getMessage());
        }
        $this->assertSame($before, StaffProfile::where('legacy_ref', 's-a')->sole()->getAttributes());
        $this->assertSame([$this->b['b1']->id], UserBranchScope::where('user_id', $this->u['staffB1']->id)->pluck('branch_id')->all());
        $this->assertSame(0, $this->audits()->count());
    }

    public function test_failed_scope_replacement_never_reaches_success_audit(): void
    {
        $this->mock(AuditService::class, fn ($mock) => $mock->shouldNotReceive('recordAdministrative'));
        $connection = DB::connection();
        $dispatcher = $connection->getEventDispatcher();
        $connection->setEventDispatcher(clone $dispatcher);
        $connection->listen(function (QueryExecuted $query) {
            if (str_starts_with($query->sql, 'delete from "user_branch_scopes"')) {
                throw new \RuntimeException('SCOPE-05 scope failure fixture');
            }
        });
        $this->withoutExceptionHandling();
        try {
            $this->patchProfile(['branch_ref' => 'b2']);
            $this->fail('A rejected replacement must not produce success evidence.');
        } catch (\RuntimeException $exception) {
            $this->assertSame('SCOPE-05 scope failure fixture', $exception->getMessage());
        } finally {
            $connection->setEventDispatcher($dispatcher);
        }
        $this->assertSame($this->b['b1']->id, StaffProfile::where('legacy_ref', 's-a')->sole()->branch_id);
        $this->assertSame([$this->b['b1']->id], UserBranchScope::where('user_id', $this->u['staffB1']->id)->pluck('branch_id')->all());
        $this->assertSame(0, $this->audits()->count());
    }

    public function test_metadata_only_update_emits_no_scope_change_event(): void
    {
        $this->patchProfile(['title' => 'Assistant', 'available' => false])->assertOk();
        $this->assertSame(0, $this->audits()->count());
        $this->assertSame([$this->b['b1']->id], UserBranchScope::where('user_id', $this->u['staffB1']->id)->pluck('branch_id')->all());
    }

    public function test_missing_staff_account_emits_no_scope_change_event(): void
    {
        StaffProfile::create([
            'legacy_ref' => 's-unlinked', 'person_id' => Person::factory()->create()->id, 'branch_id' => $this->b['b1']->id,
            'shift_start' => '09:00', 'shift_end' => '18:00', 'available' => true,
        ]);
        $count = UserBranchScope::count();
        $this->actingAsUser('owner');
        $this->patchJson('/api/staff/s-unlinked', ['branch_ref' => 'b2'])->assertOk();
        $this->assertSame(0, $this->audits()->count());
        $this->assertSame($count, UserBranchScope::count());
    }

    public function test_unresolved_null_policy_audits_the_legacy_grants_without_endorsing_them(): void
    {
        // P0 blocker: auditing these existing broad grants does not approve the null-assignment policy.
        $this->patchProfile(['branch_ref' => null])->assertOk()->assertJsonPath('data.branchId', null);
        $refs = $this->audits()->sole()->payload['branch_refs'];
        sort($refs);
        $this->assertSame(['b1', 'b2'], $refs);
        $this->assertSame(2, UserBranchScope::where('user_id', $this->u['staffB1']->id)->count());
    }

    public function test_sequential_accepted_replacements_have_matching_audits_and_one_final_scope(): void
    {
        $this->patchProfile(['branch_ref' => 'b2'])->assertOk();
        $this->patchProfile(['branch_ref' => 'b1'])->assertOk();
        $this->assertSame([['branch_refs' => ['b2']], ['branch_refs' => ['b1']]], $this->audits()->pluck('payload')->all());
        $this->assertSame($this->b['b1']->id, StaffProfile::where('legacy_ref', 's-a')->sole()->branch_id);
        $this->assertSame([$this->b['b1']->id], UserBranchScope::where('user_id', $this->u['staffB1']->id)->pluck('branch_id')->all());
    }

    public function test_rejected_non_owner_requests_emit_no_scope_success_audit(): void
    {
        $this->patchJson('/api/staff/s-a', ['branch_ref' => 'b2'])->assertUnauthorized();
        foreach (['staffB1', 'staffB2', 'dentist1', 'patientA'] as $who) {
            $this->actingAsUser($who);
            $this->patchJson('/api/staff/s-a', ['branch_ref' => 'b2'])->assertForbidden();
        }
        $this->assertSame(0, $this->audits()->count());
        $this->assertSame($this->b['b1']->id, StaffProfile::where('legacy_ref', 's-a')->sole()->branch_id);
    }
}

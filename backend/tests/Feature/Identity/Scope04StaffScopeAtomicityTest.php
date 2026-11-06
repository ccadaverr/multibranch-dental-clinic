<?php

namespace Tests\Feature\Identity;

use App\Models\Person;
use App\Models\StaffProfile;
use App\Models\User;
use App\Models\UserBranchScope;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/**
 * Deferred real-concurrency acceptance: on independently verified disposable PostgreSQL with committed fixtures,
 * race A->B and A->C assignments through separate connections; require one complete final assignment/scope set,
 * no mixed privileges and no duplicate rows. Also race assignment against explicit scope replacement and account
 * role/disable changes. These deterministic tests do not establish simultaneous-request acceptance.
 */
class Scope04StaffScopeAtomicityTest extends TestCase
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

    private function scopes(): array
    {
        return UserBranchScope::where('user_id', $this->u['staffB1']->id)->orderBy('branch_id')->pluck('branch_id')->all();
    }

    private function patchProfile(array $payload)
    {
        $this->actingAsUser('owner');

        return $this->patchJson('/api/staff/s-a', $payload);
    }

    public function test_reassignment_replaces_scopes_and_retry_does_not_duplicate_rows(): void
    {
        $this->patchProfile(['branch_ref' => 'b2'])->assertOk()->assertJsonPath('data.id', 's-a')
            ->assertJsonPath('data.branchId', 'b2')->assertJsonPath('data.branch', 'Branch B2');
        $this->assertSame($this->b['b2']->id, StaffProfile::where('legacy_ref', 's-a')->sole()->branch_id);
        $this->assertSame([$this->b['b2']->id], $this->scopes());
        $this->patchProfile(['branch_ref' => 'b2'])->assertOk();
        $this->assertSame([$this->b['b2']->id], $this->scopes());
        $this->assertSame(1, UserBranchScope::where('user_id', $this->u['staffB1']->id)->count());
        $this->actingAsUser('staffB1');
        $this->getJson('/api/staff')->assertOk()->assertJsonPath('data.0.id', 's-a')->assertJsonPath('data.1.id', 's-b');
    }

    public static function mutationFailures(): array
    {
        return [['update "staff_profiles"', 'profile'], ['delete from "user_branch_scopes"', 'delete'], ['insert into "user_branch_scopes"', 'insert']];
    }

    #[DataProvider('mutationFailures')]
    public function test_failure_after_each_write_rolls_back_profile_and_scope_replacement(string $prefix, string $stage): void
    {
        $profile = StaffProfile::where('legacy_ref', 's-a')->sole();
        $before = $profile->getAttributes();
        $beforeScopes = UserBranchScope::where('user_id', $this->u['staffB1']->id)->orderBy('id')->get()->toArray();
        $connection = DB::connection();
        $this->assertSame('pgsql', $connection->getDriverName());
        $dispatcher = $connection->getEventDispatcher();
        $connection->setEventDispatcher(clone $dispatcher);
        $observed = null;
        $connection->listen(function (QueryExecuted $query) use ($prefix, $profile, &$observed) {
            if (str_starts_with($query->sql, $prefix)) {
                $observed = [$profile->fresh()->branch_id, $this->scopes()];
                throw new \RuntimeException('SCOPE-04 write failure fixture');
            }
        });
        $this->withoutExceptionHandling();
        try {
            $this->patchProfile(['branch_ref' => 'b2']);
            $this->fail('Every mutation must roll back if scope replacement fails.');
        } catch (\RuntimeException $exception) {
            $this->assertSame('SCOPE-04 write failure fixture', $exception->getMessage());
        } finally {
            $connection->setEventDispatcher($dispatcher);
        }
        $expectedScopes = match ($stage) {
            'profile' => [$this->b['b1']->id], 'delete' => [], 'insert' => [$this->b['b2']->id],
        };
        $this->assertSame([$this->b['b2']->id, $expectedScopes], $observed);
        $this->assertSame($before, $profile->fresh()->getAttributes());
        $this->assertSame($beforeScopes, UserBranchScope::where('user_id', $this->u['staffB1']->id)->orderBy('id')->get()->toArray());
    }

    public function test_metadata_only_update_does_not_replace_existing_scopes(): void
    {
        UserBranchScope::firstOrCreate(['user_id' => $this->u['staffB1']->id, 'branch_id' => $this->b['b2']->id]);
        $beforeScopes = UserBranchScope::where('user_id', $this->u['staffB1']->id)->orderBy('id')->get()->toArray();
        $this->patchProfile(['title' => 'Assistant', 'available' => false, 'shift_start' => '10:00', 'shift_end' => '17:00'])
            ->assertOk()->assertJsonPath('data.title', 'Assistant')->assertJsonPath('data.available', false);
        $this->assertSame($beforeScopes, UserBranchScope::where('user_id', $this->u['staffB1']->id)->orderBy('id')->get()->toArray());
        $this->assertSame($this->b['b1']->id, StaffProfile::where('legacy_ref', 's-a')->sole()->branch_id);
    }

    public function test_profile_without_linked_account_updates_without_creating_accounts_or_grants(): void
    {
        StaffProfile::create([
            'legacy_ref' => 's-unlinked', 'person_id' => Person::factory()->create()->id, 'branch_id' => $this->b['b1']->id,
            'shift_start' => '09:00', 'shift_end' => '18:00', 'available' => true,
        ]);
        $counts = [User::count(), UserBranchScope::count()];
        $this->actingAsUser('owner');
        $this->patchJson('/api/staff/s-unlinked', ['branch_ref' => 'b2'])->assertOk()->assertJsonPath('data.branchId', 'b2');
        $this->assertSame($counts, [User::count(), UserBranchScope::count()]);
    }

    public function test_non_staff_link_is_not_granted_scopes(): void
    {
        DB::table('users')->where('id', $this->u['staffB1']->id)->update(['role' => 'dentist']);
        $before = $this->scopes();
        $this->patchProfile(['branch_ref' => 'b2'])->assertOk();
        $this->assertSame($before, $this->scopes());
    }

    public function test_null_assignment_characterizes_unresolved_broad_grant_policy_only(): void
    {
        // P0 unresolved policy, NOT an approved security requirement. Preserve existing behavior for this bounded fix.
        $this->patchProfile(['branch_ref' => null])->assertOk()->assertJsonPath('data.branchId', null);
        $this->assertNull(StaffProfile::where('legacy_ref', 's-a')->sole()->branch_id);
        $this->assertSame([$this->b['b1']->id, $this->b['b2']->id], $this->scopes());
    }

    public function test_owner_only_authority_and_immutable_identity_are_preserved(): void
    {
        $before = StaffProfile::where('legacy_ref', 's-a')->sole()->getAttributes();
        $this->patchJson('/api/staff/s-a', ['branch_ref' => 'b2'])->assertUnauthorized();
        foreach (['staffB1', 'staffB2', 'dentist1', 'patientA'] as $who) {
            $this->actingAsUser($who);
            $this->patchJson('/api/staff/s-a', ['branch_ref' => 'b2'])->assertForbidden();
        }
        foreach (['legacy_ref', 'legacy_user_ref', 'person_id', 'id'] as $field) {
            $this->patchProfile([$field => 'forbidden'])->assertStatus(422)->assertJsonValidationErrors($field);
        }
        $this->assertSame($before, StaffProfile::where('legacy_ref', 's-a')->sole()->getAttributes());
        $this->assertSame([$this->b['b1']->id], $this->scopes());
    }
}

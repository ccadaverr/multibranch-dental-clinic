<?php

namespace Tests\Feature\Identity;

use App\Models\AuditLog;
use App\Models\StaffProfile;
use App\Models\UserBranchScope;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

// Requires an explicitly verified and approved disposable PostgreSQL test database.
class StaffP0BranchScopePreservationTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        StaffProfile::create([
            'legacy_ref' => 's-p0', 'person_id' => $this->u['staffB1']->person_id,
            'branch_id' => $this->b['b1']->id, 'title' => 'Receptionist',
            'shift_start' => '09:00', 'shift_end' => '18:00', 'available' => true,
        ]);
        $this->actingAsUser('owner');
    }

    private function scopes(): array
    {
        return UserBranchScope::where('user_id', $this->u['staffB1']->id)
            ->orderBy('id')->get()->toArray();
    }

    private function auditCount(): int
    {
        return AuditLog::where('action', 'account.branch_scopes_changed')->count();
    }

    public static function unchangedAssignments(): array
    {
        $cases = [];
        foreach (['multiple scopes' => true, 'empty scopes' => false] as $label => $multiple) {
            foreach ([
                'hours only' => ['shift_start' => '10:00', 'shift_end' => '17:00'],
                'same branch' => ['branch_ref' => 'b1'],
                'same branch and hours' => ['branch_ref' => 'b1', 'shift_start' => '10:00', 'shift_end' => '17:00'],
                'metadata only' => ['title' => 'Assistant', 'available' => false],
            ] as $name => $payload) {
                $cases[$label.' / '.$name] = [$multiple, $payload];
            }
        }

        return $cases;
    }

    #[DataProvider('unchangedAssignments')]
    public function test_unchanged_assignment_preserves_exact_scope_rows_and_emits_no_scope_audit(bool $multiple, array $payload): void
    {
        if ($multiple) {
            UserBranchScope::firstOrCreate(['user_id' => $this->u['staffB1']->id, 'branch_id' => $this->b['b2']->id]);
        } else {
            // Fixture setup only: represent an account with no authorized branches.
            UserBranchScope::where('user_id', $this->u['staffB1']->id)->delete();
        }
        $before = $this->scopes();
        $audits = $this->auditCount();

        $this->patchJson('/api/staff/s-p0', $payload)->assertOk()->assertJsonPath('data.branchId', 'b1');

        $this->assertSame($before, $this->scopes());
        $this->assertSame($audits, $this->auditCount());
        $profile = StaffProfile::where('legacy_ref', 's-p0')->sole();
        foreach (array_diff_key($payload, ['branch_ref' => true]) as $field => $value) {
            $actual = $profile->$field;
            $this->assertSame($value, str_starts_with($field, 'shift_') ? substr($actual, 0, 5) : $actual);
        }
    }

    public function test_repeated_null_assignment_preserves_scopes_without_approving_a_null_policy(): void
    {
        // Fixture bypasses the command: no assertion that null should grant any particular branches.
        StaffProfile::where('legacy_ref', 's-p0')->update(['branch_id' => null]);
        $before = $this->scopes();
        $audits = $this->auditCount();

        $this->patchJson('/api/staff/s-p0', ['branch_ref' => null, 'shift_start' => '10:00', 'shift_end' => '17:00'])
            ->assertOk()->assertJsonPath('data.branchId', null)->assertJsonPath('data.shiftStart', '10:00:00');

        $this->assertSame($before, $this->scopes());
        $this->assertSame($audits, $this->auditCount());
    }

    public function test_real_reassignment_replaces_scopes_and_retry_preserves_subsequent_scope_edits(): void
    {
        $audits = $this->auditCount();
        $this->patchJson('/api/staff/s-p0', ['branch_ref' => 'b2'])->assertOk()->assertJsonPath('data.branchId', 'b2');
        $this->assertSame([$this->b['b2']->id], array_column($this->scopes(), 'branch_id'));
        $this->assertSame($audits + 1, $this->auditCount());
        $this->assertSame(['branch_refs' => ['b2']], AuditLog::where('action', 'account.branch_scopes_changed')->latest('id')->firstOrFail()->payload);

        // A later independent authorization must survive a retry of the accepted profile assignment.
        UserBranchScope::firstOrCreate(['user_id' => $this->u['staffB1']->id, 'branch_id' => $this->b['b1']->id]);
        $before = $this->scopes();
        $this->patchJson('/api/staff/s-p0', ['branch_ref' => 'b2'])->assertOk();
        $this->assertSame($before, $this->scopes());
        $this->assertSame($audits + 1, $this->auditCount());
    }
}

<?php

namespace Tests\Feature\Identity;

use App\Models\AuditLog;
use App\Models\StaffProfile;
use App\Models\UserBranchScope;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Run only through the guarded owned PostgreSQL test profile; no migration/reset is requested here. */
class StaffShiftRecoveryTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        StaffProfile::create(['legacy_ref' => 'shift-recovery', 'person_id' => $this->u['staffB1']->person_id,
            'branch_id' => $this->b['b1']->id, 'title' => 'Receptionist', 'shift_start' => '09:00', 'shift_end' => '17:00', 'available' => true]);
        $this->actingAsUser('owner');
    }

    private function command(): array
    {
        $row = collect($this->getJson('/api/staff')->assertOk()->json('data'))->firstWhere('id', 'shift-recovery');

        return ['shift_start' => '10:00', 'shift_end' => '18:00', 'expected_revision' => $row['revision'],
            'operation_id' => '11111111-1111-4111-8111-111111111111'];
    }

    public function test_replay_returns_exact_committed_receipt_after_later_edit_and_preserves_grants(): void
    {
        $beforeScopes = UserBranchScope::where('user_id', $this->u['staffB1']->id)->get()->toArray();
        $command = $this->command();
        $first = $this->patchJson('/api/staff/shift-recovery', $command)->assertOk()->assertJsonPath('meta.replayed', false)->json('data');
        $this->assertNotSame($command['expected_revision'], $first['revision']);
        $this->patchJson('/api/staff/shift-recovery', \Tests\Support\StaffProfileCommand::body('shift-recovery', ['title' => 'Assistant']))->assertOk();
        $this->patchJson('/api/staff/shift-recovery', $command)->assertOk()->assertJsonPath('meta.replayed', true)->assertExactJson([
            'data' => $first, 'meta' => ['operation_id' => $command['operation_id'], 'replayed' => true],
        ]);
        $this->assertSame(2, AuditLog::where('action', 'staff_profile.updated')->where('auditable_public_id', 'shift-recovery')->count());
        $this->assertSame($beforeScopes, UserBranchScope::where('user_id', $this->u['staffB1']->id)->get()->toArray());
        $this->assertSame('Assistant', StaffProfile::where('legacy_ref', 'shift-recovery')->sole()->title);
    }

    public function test_stale_editor_and_contradictory_retry_do_not_write(): void
    {
        $command = $this->command();
        $this->patchJson('/api/staff/shift-recovery', $command)->assertOk();
        $this->patchJson('/api/staff/shift-recovery', array_replace($command, ['shift_end' => '19:00']))
            ->assertConflict()->assertJsonPath('code', 'staff_operation_conflict');
        $this->patchJson('/api/staff/shift-recovery', array_replace($command, ['operation_id' => '22222222-2222-4222-8222-222222222222']))
            ->assertConflict()->assertJsonPath('code', 'staff_revision_conflict');
        $this->assertSame(1, AuditLog::where('action', 'staff_profile.updated')->count());
    }

    public function test_single_field_patches_validate_against_persisted_other_endpoint(): void
    {
        $this->patchJson('/api/staff/shift-recovery', \Tests\Support\StaffProfileCommand::body('shift-recovery', ['shift_start' => '18:00']))->assertUnprocessable()->assertJsonValidationErrors('shift_end');
        $this->patchJson('/api/staff/shift-recovery', \Tests\Support\StaffProfileCommand::body('shift-recovery', ['shift_end' => '08:00']))->assertUnprocessable()->assertJsonValidationErrors('shift_end');
        $this->patchJson('/api/staff/shift-recovery', \Tests\Support\StaffProfileCommand::body('shift-recovery', ['shift_end' => '19:00']))->assertOk()->assertJsonPath('data.shiftEnd', '19:00:00');
        $this->patchJson('/api/staff/shift-recovery', ['operation_id' => $this->command()['operation_id']])->assertUnprocessable()->assertJsonValidationErrors('expected_revision');
        $this->patchJson('/api/staff/shift-recovery', ['expected_revision' => $this->command()['expected_revision']])->assertUnprocessable()->assertJsonValidationErrors('operation_id');
    }

    public function test_other_roles_cannot_write_or_recover_owner_receipts(): void
    {
        $command = $this->command();
        $this->patchJson('/api/staff/shift-recovery', $command)->assertOk();
        foreach (['staffB1', 'staffB2', 'dentist1', 'patientA'] as $who) {
            $this->actingAsUser($who);
            $this->patchJson('/api/staff/shift-recovery', $command)->assertForbidden();
        }
        $this->actingAsUser('owner');
        $row = collect($this->getJson('/api/work-schedules')->assertOk()->json('data.staff'))->firstWhere('id', 'shift-recovery');
        $this->assertSame('10:00', $row['shift_start']);
        $this->assertSame('18:00', $row['shift_end']);
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $row['revision']);
    }

    public function test_legacy_writer_is_refused_without_overwriting_newer_changes(): void
    {
        $this->patchJson('/api/staff/shift-recovery', $this->command())->assertOk();
        $this->patchJson('/api/staff/shift-recovery', ['shift_start' => '08:00', 'shift_end' => '16:00'])
            ->assertConflict()->assertJsonPath('code', 'staff_precondition_required');
        $this->assertSame('10:00:00', StaffProfile::where('legacy_ref', 'shift-recovery')->sole()->shift_start);
        $this->assertSame(1, AuditLog::where('action', 'staff_profile.updated')->count());
    }
}

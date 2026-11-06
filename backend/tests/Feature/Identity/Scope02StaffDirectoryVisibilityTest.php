<?php

namespace Tests\Feature\Identity;

use App\Models\StaffProfile;
use App\Models\UserBranchScope;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class Scope02StaffDirectoryVisibilityTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->b['b3'] = $this->branch('b3');
        foreach ([['s-z', 'staffB1', 'b1'], ['s-a', 'staffB2', 'b2'], ['s-third', 'staffBoth', 'b3'], ['s-none', 'staffNone', null]] as [$ref, $who, $branch]) {
            StaffProfile::create([
                'legacy_ref' => $ref, 'legacy_user_ref' => 'legacy-'.$ref,
                'person_id' => $this->u[$who]->person_id, 'branch_id' => $branch ? $this->b[$branch]->id : null,
                'title' => 'Receptionist', 'shift_start' => '08:15', 'shift_end' => '16:45', 'available' => $ref !== 's-a',
            ]);
        }
    }

    private function directory(string $who, string $query = ''): array
    {
        $this->actingAsUser($who);

        return $this->getJson('/api/staff'.$query)->assertOk()->json('data');
    }

    public function test_owner_sees_all_profiles_in_primary_key_order_including_unassigned(): void
    {
        $rows = $this->directory('owner');
        // Deliberately nonalphabetical refs distinguish deterministic primary-key ordering from sorting by label.
        $this->assertSame(['s-z', 's-a', 's-third', 's-none'], array_column($rows, 'id'));
        $this->assertNull($rows[3]['branchId']);
        $this->assertSame('All Branches', $rows[3]['branch']); // Existing serialization, not an authorization grant.
    }

    public function test_staff_single_scope_filters_before_serialization_and_ignores_client_authority_claims(): void
    {
        $this->assertSame(['s-z'], array_column($this->directory('staffB1'), 'id'));
        $this->assertSame(['s-a'], array_column($this->directory('staffB2'), 'id'));
        $this->assertSame(['s-z'], array_column($this->directory('staffB1', '?branch_ref=b2&branch_id=b2&role=owner'), 'id'));
    }

    public function test_multiple_scopes_return_each_authorized_profile_once_and_exclude_unassigned(): void
    {
        // This viewer's own operational profile is at b3; authority remains b1+b2.
        $rows = $this->directory('staffBoth');
        $ids = array_column($rows, 'id');
        $this->assertSame(['s-z', 's-a'], $ids);
        $this->assertCount(count($ids), array_unique($ids));
        $this->assertSame(['b1', 'b2'], array_column($rows, 'branchId'));
    }

    public function test_unscoped_staff_receive_empty_collection_despite_operational_assignment(): void
    {
        StaffProfile::where('legacy_ref', 's-none')->update(['branch_id' => $this->b['b1']->id]);
        $this->assertSame([], $this->directory('staffNone'));
    }

    public function test_current_scope_rows_are_read_on_each_request(): void
    {
        $this->assertSame(['s-z'], array_column($this->directory('staffB1'), 'id'));
        UserBranchScope::where('user_id', $this->u['staffB1']->id)->update(['branch_id' => $this->b['b3']->id]);
        $this->assertSame(['s-third'], array_column($this->directory('staffB1'), 'id'));
    }

    public function test_resource_fields_identifiers_shift_values_and_availability_are_unchanged(): void
    {
        $profile = StaffProfile::where('legacy_ref', 's-a')->firstOrFail();
        $this->assertSame([[
            'id' => 's-a', 'userId' => 'legacy-s-a', 'personId' => 'per-s-a',
            'name' => $this->u['staffB2']->person->fullName(), 'title' => 'Receptionist',
            'branchId' => 'b2', 'branch' => 'Branch B2',
            'shiftStart' => $profile->shift_start, 'shiftEnd' => $profile->shift_end, 'available' => false,
        ]], $this->directory('staffB2'));
    }

    public function test_dentist_legacy_visibility_is_unchanged_pending_explicit_policy(): void
    {
        // Characterize preservation only; this does not establish an approved cross-branch Dentist permission.
        $this->assertSame(['s-z', 's-a', 's-third', 's-none'], array_column($this->directory('dentist1'), 'id'));
    }

    public function test_guests_and_patients_cannot_read_directory(): void
    {
        $this->getJson('/api/staff')->assertUnauthorized();
        $this->actingAsUser('patientA');
        $this->getJson('/api/staff')->assertForbidden();
    }
}

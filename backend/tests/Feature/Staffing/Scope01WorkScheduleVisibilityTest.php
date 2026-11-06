<?php

namespace Tests\Feature\Staffing;

use App\Models\DentistSchedule;
use App\Models\DentistScheduleException;
use App\Models\StaffProfile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class Scope01WorkScheduleVisibilityTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->b['b3'] = $this->branch('b3');
        foreach ([['s-a', 'staffB1', 'b1'], ['s-b', 'staffB2', 'b2'], ['s-c', 'staffBoth', 'b3'], ['s-none', 'staffNone', null]] as [$ref, $who, $branch]) {
            StaffProfile::create([
                'legacy_ref' => $ref, 'person_id' => $this->u[$who]->person_id,
                'title' => 'Receptionist', 'branch_id' => $branch ? $this->b[$branch]->id : null,
                'shift_start' => '08:15', 'shift_end' => '16:45', 'available' => $ref !== 's-b',
            ]);
        }
    }

    private function roster(string $who, string $query = ''): array
    {
        $this->actingAsUser($who);

        return $this->getJson('/api/work-schedules'.$query)->assertOk()->json('data.staff');
    }

    public function test_owner_sees_all_assigned_and_unassigned_profiles_in_existing_order_and_shape(): void
    {
        $rows = $this->roster('owner');
        $this->assertSame(['s-a', 's-b', 's-c', 's-none'], array_column($rows, 'id'));
        $this->assertSame(['id', 'name', 'title', 'branch', 'shift_start', 'shift_end', 'available'], array_keys($rows[0]));
        $this->assertSame(['id' => 'b1', 'name' => 'Branch B1'], $rows[0]['branch']);
        $this->assertSame($this->u['staffB1']->person->fullName(), $rows[0]['name']);
        $this->assertSame(['Receptionist', '08:15', '16:45', false], [
            $rows[1]['title'], $rows[1]['shift_start'], $rows[1]['shift_end'], $rows[1]['available'],
        ]);
        $this->assertNull($rows[3]['branch']);
    }

    public function test_staff_see_only_persisted_authorization_scopes_and_client_filters_cannot_widen_them(): void
    {
        $this->assertSame(['s-a'], array_column($this->roster('staffB1'), 'id'));
        $this->assertSame(['s-b'], array_column($this->roster('staffB2'), 'id'));
        $this->assertSame(['s-a'], array_column($this->roster('staffB1', '?branch_ref=b2&role=owner'), 'id'));
    }

    public function test_multiple_scopes_do_not_duplicate_profiles_or_use_operational_assignment_as_authority(): void
    {
        // staffBoth is operationally assigned to b3, but authorized only for b1 and b2.
        $rows = $this->roster('staffBoth');
        $this->assertSame(['s-a', 's-b'], array_column($rows, 'id'));
        $this->assertCount(count($rows), array_unique(array_column($rows, 'id')));
        $this->assertSame(['b1', 'b2'], array_column(array_column($rows, 'branch'), 'id'));
    }

    public function test_no_scope_is_a_valid_empty_array_even_with_an_operational_assignment(): void
    {
        StaffProfile::where('legacy_ref', 's-none')->update(['branch_id' => $this->b['b1']->id]);
        $this->assertSame([], $this->roster('staffNone'));
    }

    public function test_scope_without_matching_profiles_returns_empty_array(): void
    {
        StaffProfile::where('legacy_ref', 's-a')->update(['branch_id' => $this->b['b3']->id]);
        $this->assertSame([], $this->roster('staffB1'));
    }

    public function test_patient_and_guest_cannot_read_work_schedule_directory(): void
    {
        $this->getJson('/api/work-schedules')->assertUnauthorized();
        $this->actingAsUser('patientA');
        $this->getJson('/api/work-schedules')->assertForbidden();
    }

    public function test_dentist_own_weekly_schedule_exceptions_and_response_collections_are_preserved(): void
    {
        $this->d['d1']->branches()->attach($this->b['b2']->id);
        foreach ([['d1', 'b1', '09:00', '12:00'], ['d1', 'b2', '13:00', '17:00'], ['d3', 'b2', '09:00', '18:00']] as [$dentist, $branch, $start, $end]) {
            DentistSchedule::create([
                'dentist_profile_id' => $this->d[$dentist]->id, 'branch_id' => $this->b[$branch]->id,
                'weekday' => 1, 'start_time' => $start, 'end_time' => $end, 'status' => 'active', 'demo' => false,
            ]);
        }
        $exception = DentistScheduleException::create([
            'dentist_profile_id' => $this->d['d1']->id, 'branch_id' => $this->b['b2']->id,
            'on_date' => '2026-09-30', 'kind' => 'day_off', 'status' => 'active',
        ]);
        $this->actingAsUser('dentist1');
        $data = $this->getJson('/api/work-schedules')->assertOk()->json('data');
        $this->assertSame(['dentists', 'duty', 'staff', 'exceptions', 'branches', 'weekdays', 'wording_approved'], array_keys($data));
        $this->assertSame(['d1'], array_column($data['dentists'], 'id'));
        $this->assertSame(['b1', 'b2'], array_column(array_column($data['dentists'][0]['weekly'], 'branch'), 'id'));
        $this->assertSame(['09:00', '13:00'], array_column($data['dentists'][0]['weekly'], 'start'));
        $this->assertSame([$exception->public_id], array_column($data['exceptions'], 'id'));
        $this->assertSame(['b1', 'b2'], array_column($data['duty']['rows'], 'branch_id'));
        // No assertion endorses Dentist Staff-directory visibility: that permission still needs a decision.
    }

    public function test_owner_edits_remain_available_and_out_of_scope_staff_mutations_are_refused(): void
    {
        $this->actingAsUser('owner');
        $this->putJson('/api/work-schedules/d1/weekly', [
            'branch_ref' => 'b1', 'weekday' => 1, 'start_time' => '09:00', 'end_time' => '12:00',
        ])->assertOk();
        $this->actingAsUser('staffB2');
        $this->putJson('/api/work-schedules/d1/weekly', [
            'branch_ref' => 'b1', 'weekday' => 1, 'start_time' => '10:00', 'end_time' => '13:00',
        ])->assertForbidden();
        $this->patchJson('/api/staff/s-b', ['shift_start' => '10:00', 'shift_end' => '17:00'])->assertForbidden();
        $this->assertSame('09:00', substr((string) DentistSchedule::where('dentist_profile_id', $this->d['d1']->id)->sole()->start_time, 0, 5));
    }
}

<?php

namespace Tests\Feature\Staffing;

use App\Models\AutomationSetting;
use App\Models\DentistSchedule;
use App\Models\DentistScheduleException;
use App\Models\StaffProfile;
use App\Services\Scheduling\WorkSchedules;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class Scope03WorkScheduleProjectionTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private array $weeklyRows = [];

    private array $dated = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->d['d1']->branches()->attach($this->b['b2']->id);
        foreach (['b1' => ['09:00', '12:00'], 'b2' => ['13:00', '17:00']] as $branch => [$start, $end]) {
            $this->weeklyRows[$branch] = DentistSchedule::create([
                'dentist_profile_id' => $this->d['d1']->id, 'branch_id' => $this->b[$branch]->id,
                'weekday' => 1, 'start_time' => $start, 'end_time' => $end, 'status' => 'active', 'demo' => false,
            ]);
        }
        foreach (['b1' => '2026-09-29', 'b2' => '2026-09-30'] as $branch => $date) {
            $this->dated[$branch] = DentistScheduleException::create([
                'dentist_profile_id' => $this->d['d1']->id, 'branch_id' => $this->b[$branch]->id,
                'on_date' => $date, 'kind' => 'custom_hours', 'start_time' => '10:00', 'end_time' => '12:00',
                'status' => 'active', 'reason' => 'Restricted '.$branch.' exception detail',
            ]);
        }
        $this->dated['global'] = DentistScheduleException::create([
            'dentist_profile_id' => $this->d['d1']->id, 'branch_id' => null,
            'on_date' => '2026-10-01', 'kind' => 'day_off', 'status' => 'active',
        ]);
        $this->dated['other'] = DentistScheduleException::create([
            'dentist_profile_id' => $this->d['d3']->id, 'branch_id' => null,
            'on_date' => '2026-10-02', 'kind' => 'day_off', 'status' => 'active',
        ]);
        foreach (['staffB1' => 'b1', 'staffB2' => 'b2'] as $who => $branch) {
            StaffProfile::create([
                'legacy_ref' => 'scope03-'.$branch, 'person_id' => $this->u[$who]->person_id,
                'branch_id' => $this->b[$branch]->id, 'title' => 'Receptionist',
                'shift_start' => '09:00', 'shift_end' => '18:00', 'available' => true,
            ]);
        }
    }

    private function projection(string $who): array
    {
        $this->actingAsUser($who);

        return $this->getJson('/api/work-schedules?branch_ref=b2')->assertOk()->json('data');
    }

    public function test_staff_a_sees_only_a_operational_projections_of_shared_dentist(): void
    {
        $data = $this->projection('staffB1');
        $this->assertSame(['d1', 'd2'], array_column($data['dentists'], 'id'));
        $shared = $data['dentists'][0];
        $this->assertSame(['b1'], array_column($shared['branches'], 'id'));
        $this->assertSame([$this->weeklyRows['b1']->public_id], array_column($shared['weekly'], 'id'));
        $this->assertSame([$this->dated['b1']->public_id, $this->dated['global']->public_id], array_column($data['exceptions'], 'id'));
        $this->assertStringNotContainsString('Restricted b2 exception detail', json_encode($data));
        $this->assertSame(['b1'], array_values(array_unique(array_column($data['duty']['rows'], 'branch_id'))));
        $this->assertSame(['scope03-b1'], array_column($data['staff'], 'id'));
        // Public branch names/hours remain reference data, separate from personnel memberships.
        $this->assertSame(['b1', 'b2'], array_column($data['branches'], 'id'));
        $this->assertSame(['id', 'branch', 'weekday', 'start', 'end', 'break_start', 'break_end', 'demo'], array_keys($shared['weekly'][0]));
        $this->assertSame(['id', 'dentist', 'date', 'kind', 'branch', 'start', 'end', 'reason', 'editable'], array_keys($data['exceptions'][0]));
    }

    public function test_multiple_scopes_include_both_branches_without_duplicate_dentists(): void
    {
        $data = $this->projection('staffBoth');
        $ids = array_column($data['dentists'], 'id');
        $this->assertSame(['d1', 'd2', 'd3'], $ids);
        $this->assertCount(count($ids), array_unique($ids));
        $this->assertSame(['b1', 'b2'], array_column($data['dentists'][0]['branches'], 'id'));
        $this->assertSame([$this->weeklyRows['b1']->public_id, $this->weeklyRows['b2']->public_id], array_column($data['dentists'][0]['weekly'], 'id'));
        $this->assertCount(4, $data['exceptions']);
    }

    public function test_staff_without_scope_has_empty_operational_collections(): void
    {
        $data = $this->projection('staffNone');
        foreach (['dentists', 'exceptions', 'staff'] as $key) {
            $this->assertSame([], $data[$key]);
        }
        $this->assertSame([], $data['duty']['rows']);
        $this->assertSame(['b1', 'b2'], array_column($data['branches'], 'id'));
    }

    public function test_global_day_off_remains_relevant_and_scheduling_authority_is_not_filtered(): void
    {
        $this->dated['global']->update(['on_date' => '2026-09-28']);
        $data = $this->projection('staffB1');
        $global = collect($data['exceptions'])->firstWhere('id', $this->dated['global']->public_id);
        $this->assertSame('day_off', $global['kind']);
        $this->assertNull($global['branch']);
        // No assertion approves non-null global reason disclosure; that policy remains unresolved.
        $duty = collect($data['duty']['rows'])->firstWhere('dentist_id', 'd1');
        $this->assertFalse($duty['on_duty_today']);
        $this->assertFalse($duty['working_now']);
        $this->assertSame(0, $duty['working_minutes']);
        $work = new WorkSchedules;
        $this->assertSame(0, $work->minutes($this->d['d1'], $this->b['b1'], '2026-09-28'));
        $this->assertSame(0, $work->minutes($this->d['d1'], $this->b['b2'], '2026-09-28'));
    }

    public function test_owner_retains_clinic_wide_projection_and_dentist_retains_own_schedule(): void
    {
        $owner = $this->projection('owner');
        $this->assertSame(['d1', 'd2', 'd3'], array_column($owner['dentists'], 'id'));
        $this->assertCount(4, $owner['exceptions']);
        $this->assertCount(2, $owner['dentists'][0]['weekly']);
        $own = $this->projection('dentist1');
        $this->assertSame(['d1'], array_column($own['dentists'], 'id'));
        $this->assertSame(['b1', 'b2'], array_column($own['dentists'][0]['branches'], 'id'));
        $this->assertCount(2, $own['dentists'][0]['weekly']);
        $this->assertCount(3, $own['exceptions']);
        $this->assertSame(['b1', 'b2'], array_column($own['duty']['rows'], 'branch_id'));
        $this->assertFalse($own['dentists'][0]['branches'][0]['editable']);
    }

    public function test_hidden_weekly_rows_do_not_create_fabricated_profile_hour_fallback(): void
    {
        $this->weeklyRows['b1']->update(['status' => 'removed']);
        $data = $this->projection('staffB1');
        $this->assertSame([], $data['dentists'][0]['weekly']);
        $this->assertNull($data['dentists'][0]['profile_hours']);
        $duty = collect($data['duty']['rows'])->firstWhere('dentist_id', 'd1');
        $this->assertSame(0, $duty['working_minutes']);
        $this->assertFalse($duty['estimated']);
        $this->assertSame(240, (new WorkSchedules)->minutes($this->d['d1'], $this->b['b2'], '2026-09-28'));
    }

    public function test_visibility_does_not_confer_editability_and_mutation_permissions_are_preserved(): void
    {
        $setting = AutomationSetting::findOrFail('staffing');
        $setting->update(['settings' => array_merge($setting->settings, ['front_desk_edits_schedules' => false])]);
        $data = $this->projection('staffB1');
        $this->assertSame(['b1'], array_column($data['dentists'][0]['branches'], 'id'));
        $this->assertFalse($data['dentists'][0]['branches'][0]['editable']);
        $payload = ['branch_ref' => 'b1', 'weekday' => 1, 'start_time' => '10:00', 'end_time' => '12:00'];
        $this->putJson('/api/work-schedules/d1/weekly', $payload)->assertForbidden();
        $this->actingAsUser('staffB2');
        $this->putJson('/api/work-schedules/d1/weekly', $payload)->assertForbidden();
        $this->actingAsUser('dentist1');
        $this->putJson('/api/work-schedules/d1/weekly', $payload)->assertForbidden();
        $this->actingAsUser('owner');
        $this->putJson('/api/work-schedules/d1/weekly', $payload)->assertOk();
    }

    public function test_patient_and_guest_remain_excluded(): void
    {
        $this->getJson('/api/work-schedules')->assertUnauthorized();
        $this->actingAsUser('patientA');
        $this->getJson('/api/work-schedules')->assertForbidden();
    }
}

<?php

namespace Tests\Feature\Charts;

use App\Models\AutomationSetting;
use App\Models\ToothChartEntry;
use App\Models\Visit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class ChartWorkspaceReadbackTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        AutomationSetting::updateOrCreate(['key' => 'dental_chart'], ['enabled' => true, 'settings' => ['numbering' => 'fdi', 'statuses' => ['Crown', 'Caries', 'Filled', 'Sound']]]);
    }

    private function visit(string $patient = 'A', string $dentist = 'd1'): Visit
    {
        return Visit::create(['patient_id' => $this->p[$patient]->id, 'branch_id' => $this->b['b1']->id,
            'responsible_dentist_profile_id' => $this->d[$dentist]->id, 'source' => 'walk_in', 'status' => 'Checked In',
            'arrived_at' => '2026-09-28 09:00:00+08:00', 'clinic_date' => '2026-09-28', 'revision' => 1,
            'created_by_user_id' => $this->u['staffB1']->id, 'updated_by_user_id' => $this->u['staffB1']->id]);
    }

    public function test_visit_picker_source_is_dentist_scoped_and_never_requires_the_staff_directory(): void
    {
        $own = $this->visit();
        $this->visit('B', 'd2');
        $this->actingAsUser('dentist1');
        $this->getJson('/api/patients?search=Synthetic')->assertForbidden();
        $page = $this->getJson('/api/visits?from=2026-09-01&to=2026-09-28&per_page=100')->assertOk()->assertJsonCount(1, 'data');
        $page->assertJsonPath('data.0.id', $own->public_id)->assertJsonPath('data.0.patient.id', $this->p['A']->public_id)
            ->assertJsonPath('data.0.patient.code', $this->p['A']->patient_code)->assertJsonPath('data.0.dentist.id', 'd1');
        $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertOk()->assertJsonPath('data.patient.id', $this->p['A']->public_id);
    }

    public function test_current_projection_preserves_multiple_active_conditions_and_original_surface_history(): void
    {
        $this->visit();
        $this->visit('B', 'd2');
        $this->actingAsUser('dentist1');
        $url = '/api/patients/'.$this->p['A']->public_id.'/chart';
        $payload = ['tooth' => '16', 'recorded_on' => '2026-09-28', 'branch_ref' => 'b1', 'note' => 'Synthetic private chart observation'];
        $first = $this->postJson($url, $payload + ['status' => 'Crown', 'surfaces' => [], 'expected_revision' => 0], ['Idempotency-Key' => 'j04-crown'])->assertCreated()->json('meta.chart_receipt');
        $old = ToothChartEntry::sole()->getRawOriginal();
        $this->postJson($url, $payload + ['status' => 'Caries', 'surfaces' => ['M', 'O'], 'expected_revision' => 1], ['Idempotency-Key' => 'j04-caries'])->assertCreated();
        $this->postJson($url, $payload + ['status' => 'Filled', 'surfaces' => ['M'], 'expected_revision' => 2], ['Idempotency-Key' => 'j04-filled'])->assertCreated();
        $read = $this->getJson($url)->assertOk()->assertJsonPath('data.tooth_revisions.16', 3)->assertJsonCount(3, 'data.current')->assertJsonCount(3, 'data.history');
        $current = collect($read->json('data.current'))->keyBy('status');
        $this->assertSame([], $current['Crown']['surfaces']);
        $this->assertSame(['O'], $current['Caries']['surfaces']);
        $this->assertSame(['M'], $current['Filled']['surfaces']);
        $historical = collect($read->json('data.history'))->firstWhere('status', 'Caries');
        $this->assertSame(['M', 'O'], $historical['surfaces']);
        $this->assertSame($first['entry_id'], ToothChartEntry::oldest('id')->first()->public_id);
        $this->assertSame($old, ToothChartEntry::oldest('id')->first()->getRawOriginal());
        $this->actingAsUser('dentist2');
        $this->getJson($url)->assertNotFound();
        $this->actingAsUser('staffB1');
        $staff = $this->getJson($url)->assertOk();
        foreach ($staff->json('data.history') as $entry) {
            $this->assertArrayNotHasKey('note', $entry);
        }
        $this->actingAsUser('owner');
        $this->getJson($url)->assertForbidden();
    }
}

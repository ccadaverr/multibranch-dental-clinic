<?php

namespace Tests\Feature\Treatments;

use App\Models\Treatment;
use App\Models\Visit;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class HistoryDiscoveryPaginationTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
    }

    private function oldRecord(string $patient = 'A', string $branch = 'b1', string $dentist = 'd1'): Treatment
    {
        // Synthetic historical read fixture, not evidence of a lifecycle command.
        $visit = Visit::create(['patient_id' => $this->p[$patient]->id, 'branch_id' => $this->b[$branch]->id,
            'responsible_dentist_profile_id' => $this->d[$dentist]->id, 'source' => 'walk_in', 'status' => 'Completed',
            'arrived_at' => '2025-01-01 09:00:00+08:00', 'closed_at' => '2025-01-01 10:00:00+08:00', 'clinic_date' => '2025-01-01', 'revision' => 3]);

        return Treatment::create(['visit_id' => $visit->id, 'dentist_profile_id' => $this->d[$dentist]->id, 'status' => 'Completed',
            'started_at' => '2025-01-01 09:10:00+08:00', 'completed_at' => '2025-01-01 10:00:00+08:00', 'revision' => 3,
            'procedure_summary' => 'Synthetic historical read fixture', 'clinical_notes' => 'Synthetic private historical note']);
    }

    public function test_old_visits_and_completed_history_page_beyond_200_without_identity_substitution(): void
    {
        $ids = [];
        for ($i = 0; $i < 205; $i++) {
            $ids[] = $this->oldRecord()->public_id;
        }
        $this->oldRecord('B');
        $foreign = $this->oldRecord('B', 'b2', 'd3');
        $this->actingAsUser('dentist1');
        $path = '/api/treatments?patient_id='.$this->p['A']->public_id.'&per_page=20';
        $actual = [];
        for ($page = 1; $page <= 11; $page++) {
            $r = $this->getJson($path.'&page='.$page)->assertOk()->assertJsonPath('meta.current_page', $page)->assertJsonPath('meta.last_page', 11);
            foreach ($r->json('data') as $row) {
                $this->assertSame($this->p['A']->public_id, $row['patient']['id']);
                $this->assertSame('b1', $row['branch']['id']);
                $actual[] = $row['id'];
            }
        }
        $this->assertSame(array_reverse($ids), $actual);
        $this->getJson('/api/visits?from=2025-01-01&to=2025-01-31&per_page=100&page=3')->assertOk()->assertJsonCount(6, 'data')->assertJsonPath('meta.total', 206);
        $this->getJson('/api/visits?from=2025-01-01&to=2025-07-04')->assertUnprocessable();
        $this->getJson('/api/visits/'.$foreign->visit->public_id)->assertNotFound();
        $this->getJson('/api/treatments/'.$foreign->public_id)->assertForbidden();
        $this->actingAsUser('staffB2');
        $this->getJson($path)->assertOk()->assertJsonCount(0, 'data');
        $this->actingAsUser('owner');
        $this->getJson($path)->assertOk()->assertJsonMissingPath('data.0.clinical_notes');
    }
}

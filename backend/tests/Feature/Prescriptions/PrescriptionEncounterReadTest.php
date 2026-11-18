<?php

namespace Tests\Feature\Prescriptions;

use App\Models\Prescription;
use App\Models\Visit;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class PrescriptionEncounterReadTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
    }

    private function visit(): Visit
    {
        return Visit::create(['patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id,
            'responsible_dentist_profile_id' => $this->d['d1']->id, 'source' => 'walk_in', 'status' => 'Completed',
            'clinic_date' => '2026-09-28', 'arrived_at' => '2026-09-28 09:00:00+08:00', 'closed_at' => '2026-09-28 10:00:00+08:00', 'revision' => 3]);
    }

    public function test_exact_authorized_visit_remains_available_beyond_recent_100_and_prescription_pages_beyond_200(): void
    {
        $target = $this->visit();
        for ($i = 0; $i < 101; $i++) {
            $this->visit();
        }
        $this->actingAsUser('dentist1');
        $r = $this->getJson('/api/prescriptions/visits')->assertOk()->assertJsonCount(100, 'data');
        $this->assertNotContains($target->public_id, array_column($r->json('data'), 'id'));
        $this->getJson('/api/visits/'.$target->public_id)->assertOk()->assertJsonPath('data.patient.id', $this->p['A']->public_id)->assertJsonPath('data.branch.id', 'b1');
        $this->postJson('/api/prescriptions', ['visit_id' => $target->public_id, 'lines' => [['medicine' => 'Synthetic J07 fixture, not clinical advice']]], ['Idempotency-Key' => 'j07-exact-draft'])->assertCreated()->assertJsonPath('data.visit', $target->public_id);
        // Bulk rows are read fixtures, not lifecycle acceptance for 200 prescriptions.
        for ($i = 0; $i < 200; $i++) {
            Prescription::create(['visit_id' => $target->id, 'patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id,
                'dentist_profile_id' => $this->d['d1']->id, 'created_by_user_id' => $this->u['dentist1']->id, 'status' => 'Draft', 'revision' => 1]);
        }
        $url = '/api/prescriptions?patient_id='.$this->p['A']->public_id.'&visit_id='.$target->public_id.'&per_page=100';
        $ids = [];
        for ($page = 1; $page <= 3; $page++) {
            $r = $this->getJson($url.'&page='.$page)->assertOk()->assertJsonPath('meta.total', 201)->assertJsonPath('meta.current_page', $page);
            foreach ($r->json('data') as $row) {
                $this->assertSame($target->public_id, $row['visit']);
                $this->assertSame($this->p['A']->public_id, $row['patient']['id']);
                $this->assertSame('b1', $row['branch_id']);
                $ids[] = $row['id'];
            }
        }
        $this->assertCount(201, array_unique($ids));
        $this->actingAsUser('dentist3');
        $this->getJson('/api/visits/'.$target->public_id)->assertNotFound();
        $this->getJson($url)->assertOk()->assertJsonCount(0, 'data');
        $this->actingAsUser('patientA');
        $this->getJson('/api/prescriptions/visits')->assertForbidden();
    }
}

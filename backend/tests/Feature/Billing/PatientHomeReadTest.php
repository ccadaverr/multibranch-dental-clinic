<?php

namespace Tests\Feature\Billing;

use App\Models\Invoice;
use App\Models\Patient;
use App\Models\Payment;
use App\Models\Receipt;
use App\Models\Treatment;
use App\Models\Visit;
use App\Services\Intake\Guardianship;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Synthetic persisted read fixtures only; no payment, receipt or provider operation. */
class PatientHomeReadTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->setUpSchedulingWorld();
        $this->p['A']->person->update(['date_of_birth' => '1990-01-01']);
    }

    private function saved(Patient $patient, int $number, string $branch = 'b1', string $status = 'Issued'): Invoice
    {
        $dentist = $this->d[$branch === 'b1' ? 'd1' : 'd3'];
        $v = Visit::create(['patient_id' => $patient->id, 'branch_id' => $this->b[$branch]->id, 'source' => 'walk_in', 'status' => 'Completed',
            'responsible_dentist_profile_id' => $dentist->id, 'requested_service_id' => $this->svc['svc1']->id,
            'arrived_at' => '2026-09-28 09:00:00+08:00', 'closed_at' => '2026-09-28 09:30:00+08:00', 'clinic_date' => '2026-09-28',
            'revision' => 2, 'created_by_user_id' => $this->u['staffBoth']->id, 'updated_by_user_id' => $this->u['staffBoth']->id]);
        $t = Treatment::create(['visit_id' => $v->id, 'dentist_profile_id' => $dentist->id, 'status' => 'Completed',
            'started_at' => '2026-09-28 09:00:00+08:00', 'completed_at' => '2026-09-28 09:30:00+08:00', 'revision' => 2,
            'procedure_summary' => 'Synthetic Home read fixture', 'created_by_user_id' => $this->u['dentist1']->id, 'updated_by_user_id' => $this->u['dentist1']->id]);

        return Invoice::create(['treatment_id' => $t->id, 'visit_id' => $v->id, 'patient_id' => $patient->id, 'branch_id' => $this->b[$branch]->id,
            'invoice_number' => 'SYNTHETIC-J02-READ-'.$number, 'status' => $status, 'revision' => 3, 'gross_amount' => '10.10',
            'hmo_coverage_amount' => '0.00', 'patient_responsibility_amount' => '10.10', 'paid_amount' => '0.00',
            'issued_at' => $status === 'Issued' ? '2026-09-28 09:30:00+08:00' : null,
            'created_by_user_id' => $this->u['staffBoth']->id, 'updated_by_user_id' => $this->u['staffBoth']->id]);
    }

    public function test_home_can_read_every_issued_page_for_exact_own_and_dependent_patients_without_settlement(): void
    {
        $dependent = Guardianship::addDependent($this->p['A'], ['first_name' => 'Synthetic', 'last_name' => 'Dependent',
            'date_of_birth' => '2015-01-01', 'relationship' => 'Child'], $this->u['patientA']);
        for ($i = 1; $i <= 26; $i++) {
            $this->saved($this->p['A'], $i);
        }
        $this->saved($dependent, 27, 'b2');
        $foreign = $this->saved($this->p['B'], 28);
        $this->saved($this->p['A'], 29, 'b1', 'Draft');
        $before = Invoice::orderBy('id')->get()->map->getAttributes()->all();
        $this->actingAsUser('patientA');
        $this->getJson('/api/me/dependents')->assertOk()->assertJsonPath('meta.me.id', $this->p['A']->public_id)->assertJsonPath('data.0.id', $dependent->public_id);
        $cursor = null;
        $ids = [];
        $minor = 0;
        $pages = 0;
        do {
            $page = $this->getJson('/api/invoices/mine?status=Issued&per_page=25'.($cursor ? '&cursor='.$cursor : ''))
                ->assertOk()->assertHeader('Cache-Control', 'no-store, private');
            foreach ($page->json('data') as $row) {
                $this->assertContains($row['patient']['id'], [$this->p['A']->public_id, $dependent->public_id]);
                $this->assertSame('Issued', $row['status']);
                $ids[] = $row['id'];
                $minor += (int) round(((float) $row['balance']) * 100);
            }
            $cursor = $page->json('meta.next_cursor');
            if ($cursor) {
                $this->assertSame(end($ids), $cursor);
            }
            $pages++;
        } while ($cursor);
        $this->assertSame(2, $pages);
        $this->assertCount(27, array_unique($ids));
        $this->assertSame(27270, $minor);
        $this->assertNotContains($foreign->public_id, $ids);
        $this->assertSame($before, Invoice::orderBy('id')->get()->map->getAttributes()->all());
        $this->assertSame(0, Payment::count());
        $this->assertSame(0, Receipt::count());
    }

    public function test_current_role_and_revoked_patient_session_cannot_use_home_reads(): void
    {
        $this->saved($this->p['A'], 1);
        foreach (['dentist1', 'staffB1', 'owner'] as $who) {
            $this->actingAsUser($who);
            $this->getJson('/api/invoices/mine?status=Issued')->assertForbidden();
        }
        $this->app['auth']->forgetGuards();
        $this->actingAs($this->u['patientA']->fresh(), 'web');
        $this->getJson('/api/invoices/mine?status=Issued')->assertOk()->assertJsonCount(1, 'data');
        $this->u['patientA']->increment('auth_version');
        $this->getJson('/api/invoices/mine?status=Issued')->assertForbidden()->assertJsonPath('code', 'session_revoked');
    }
}

<?php

namespace Tests\Feature\Prescriptions;

use App\Models\Prescription;
use App\Models\Visit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class PrescriptionSearchTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->setUpSchedulingWorld();
    }

    private function saved(string $patient = 'A', string $branch = 'b1', bool $issue = true): array
    {
        $visit = Visit::create(['patient_id' => $this->p[$patient]->id, 'branch_id' => $this->b[$branch]->id, 'source' => 'walk_in',
            'status' => 'Completed', 'responsible_dentist_profile_id' => $this->d[$branch === 'b1' ? 'd1' : 'd3']->id,
            'requested_service_id' => $this->svc['svc1']->id, 'arrived_at' => '2026-09-28 09:00:00', 'closed_at' => '2026-09-28 09:30:00', 'clinic_date' => '2026-09-28',
            'revision' => 1, 'created_by_user_id' => $this->u['staffBoth']->id, 'updated_by_user_id' => $this->u['staffBoth']->id]);
        $this->actingAsUser($branch === 'b1' ? 'dentist1' : 'dentist3');
        $rx = $this->postJson('/api/prescriptions', ['visit_id' => $visit->public_id, 'note' => 'Synthetic private note',
            'lines' => [['medicine' => 'Synthetic private medicine']]])->assertCreated()->json('data');
        if ($issue) {
            $rx = $this->postJson('/api/prescriptions/'.$rx['id'].'/issue', ['expected_revision' => 1])->assertOk()->json('data');
        }

        return $rx;
    }

    public function test_search_finds_persisted_prescriptions_older_than_legacy_cap_and_pages_without_duplicates(): void
    {
        $old = $this->saved();
        $model = Prescription::where('public_id', $old['id'])->firstOrFail();
        for ($i = 0; $i < 205; $i++) {
            Prescription::create(['patient_id' => $model->patient_id, 'branch_id' => $model->branch_id, 'visit_id' => $model->visit_id,
                'dentist_profile_id' => $model->dentist_profile_id, 'created_by_user_id' => $model->created_by_user_id, 'status' => 'Draft']);
        }
        $before = [Prescription::count(), DB::table('audit_logs')->count(), DB::table('command_keys')->count()];
        $this->assertNotContains($old['id'], array_column($this->getJson('/api/prescriptions')->assertOk()->assertJsonCount(200, 'data')->json('data'), 'id'));
        $this->getJson('/api/prescriptions?page=1&per_page=20&q='.$old['number'])->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $old['id']);
        $ids = [];
        foreach ([1, 2, 3] as $page) {
            $response = $this->getJson('/api/prescriptions?page='.$page.'&per_page=100')->assertOk()->assertJsonPath('meta.total', 206)
                ->assertJsonPath('meta.current_page', $page)->assertJsonPath('meta.last_page', 3);
            $ids = array_merge($ids, array_column($response->json('data'), 'id'));
        }
        $this->assertCount(206, array_unique($ids));
        $this->assertSame($old['id'], end($ids));
        $this->assertSame($before, [Prescription::count(), DB::table('audit_logs')->count(), DB::table('command_keys')->count()]);
    }

    public function test_search_status_and_exact_encounter_filters_compose_inside_current_branch_scope(): void
    {
        $one = $this->saved();
        $two = $this->saved('B');
        $this->saved('A', 'b2');
        $this->saved('A', 'b1', false);
        $this->p['A']->person->update(['first_name' => 'SyntheticUnique', 'last_name' => 'Patient']);
        $path = '/api/prescriptions?page=1&per_page=20&status=Issued&q=syntheticunique%20patient&visit_id='.$one['visit'].'&patient_id='.$one['patient']['id'];
        $this->actingAsUser('dentist1');
        $this->getJson($path)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $one['id']);
        $this->getJson($path.'&patient_id='.$two['patient']['id'])->assertOk()->assertJsonPath('meta.total', 0);
        foreach (['dentist3', 'staffB2', 'staffNone'] as $who) {
            $this->actingAsUser($who);
            $this->getJson($path)->assertOk()->assertJsonCount(0, 'data')->assertJsonPath('meta.total', 0);
        }
        $this->actingAsUser('staffB1');
        $this->getJson($path)->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/prescriptions?page=1&status=Draft')->assertOk()->assertJsonPath('meta.total', 0);
        $this->actingAsUser('patientA');
        $this->getJson($path)->assertForbidden();
    }

    public function test_owner_search_cannot_match_patient_names_or_private_clinical_text(): void
    {
        $rx = $this->saved();
        $this->p['A']->person->update(['first_name' => 'SyntheticPrivateIdentity']);
        $this->actingAsUser('owner');
        foreach (['SyntheticPrivateIdentity', 'Synthetic private medicine', 'Synthetic private note'] as $term) {
            $this->getJson('/api/prescriptions?page=1&q='.rawurlencode($term))->assertOk()->assertJsonPath('meta.total', 0);
        }
        $row = $this->getJson('/api/prescriptions?page=1&q='.$rx['number'])->assertOk()->assertJsonPath('meta.total', 1)->json('data.0');
        foreach (['patient', 'visit', 'branch_id', 'lines', 'note'] as $private) {
            $this->assertArrayNotHasKey($private, $row);
        }
    }

    public function test_search_treats_wildcards_and_quotes_as_literal_input_and_rejects_invalid_page_shapes(): void
    {
        $rx = $this->saved();
        foreach (['%', '_', "' OR 1=1 --", '\\'] as $term) {
            $this->getJson('/api/prescriptions?page=1&q='.rawurlencode($term))->assertOk()->assertJsonPath('meta.total', 0);
        }
        foreach (['page=0', 'page[]=1', 'per_page=101', 'per_page=0', 'q[]=x', 'q='.str_repeat('x', 121)] as $query) {
            $this->getJson('/api/prescriptions?'.$query)->assertUnprocessable();
        }
        $this->getJson('/api/prescriptions?page=2&per_page=20')->assertOk()->assertJsonCount(0, 'data')->assertJsonPath('meta.total', 1);
        $this->getJson('/api/prescriptions?page=1&q='.strtolower($rx['number']))->assertOk()->assertJsonPath('data.0.id', $rx['id']);
    }

    public function test_branch_scope_revocation_applies_to_every_search_page_and_patient_reads_are_private(): void
    {
        $rx = $this->saved();
        $this->actingAsUser('staffB1');
        $path = '/api/prescriptions?page=1&q='.$rx['number'];
        $this->getJson($path)->assertOk()->assertJsonPath('meta.total', 1);
        DB::table('user_branch_scopes')->where('user_id', $this->u['staffB1']->id)->delete();
        $this->getJson($path)->assertOk()->assertJsonPath('meta.total', 0);
        $this->actingAsUser('patientA');
        $this->getJson('/api/me/prescriptions')->assertOk()->assertHeader('Cache-Control', 'no-store, private')->assertJsonPath('data.0.id', $rx['id'])
            ->assertJsonPath('data.0.patient.id', $this->p['A']->public_id)->assertJsonPath('data.0.visit', $rx['visit']);
        $this->actingAsUser('patientB');
        $this->getJson('/api/me/prescriptions')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_search_refreshes_cached_role_and_rejects_a_revoked_web_session(): void
    {
        $rx = $this->saved();
        $path = '/api/prescriptions?page=1&q='.$rx['number'];
        $this->getJson($path)->assertOk()->assertJsonPath('meta.total', 1);
        DB::table('users')->where('id', $this->u['dentist1']->id)->update(['role' => 'patient']);
        $this->getJson($path)->assertForbidden();
        DB::table('users')->where('id', $this->u['dentist1']->id)->update(['role' => 'dentist']);
        $this->actingAs($this->u['dentist1'], 'web');
        $this->getJson($path)->assertOk()->assertJsonPath('meta.total', 1);
        DB::table('users')->where('id', $this->u['dentist1']->id)->increment('auth_version');
        $this->getJson($path)->assertForbidden()->assertJsonPath('code', 'session_revoked');
        $this->assertSame(1, Prescription::count());
    }
}

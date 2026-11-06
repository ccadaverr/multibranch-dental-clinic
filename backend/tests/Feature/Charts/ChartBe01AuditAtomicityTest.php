<?php

namespace Tests\Feature\Charts;

use App\Models\AuditLog;
use App\Models\ToothChartEntry;
use App\Models\Treatment;
use App\Models\Visit;
use App\Services\Audit\AuditService;
use App\Support\ClinicClock;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class ChartBe01AuditAtomicityTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-29', '10:00');
    }

    private function record(array $extra = [])
    {
        return $this->postJson('/api/patients/'.$this->p['A']->public_id.'/chart', $extra + [
            'tooth' => '36', 'status' => 'Caries', 'surfaces' => ['O'],
            'branch_ref' => 'b1', 'recorded_on' => ClinicClock::today(), 'note' => 'CHART-BE-01 private note',
        ]);
    }

    public function test_success_records_correct_provenance_and_minimal_audit(): void
    {
        $this->actingAsUser('dentist1');
        $this->record()->assertCreated()->assertJsonPath('data.current.0.tooth', '36');
        $entry = ToothChartEntry::sole();
        $this->assertSame([$this->p['A']->id, $this->b['b1']->id, $this->d['d1']->id, $this->u['dentist1']->id], [
            $entry->patient_id, $entry->branch_id, $entry->dentist_profile_id, $entry->created_by_user_id,
        ]);
        $audit = AuditLog::where('action', 'chart.recorded')->sole();
        $this->assertSame($this->u['dentist1']->id, $audit->actor_user_id);
        $this->assertSame($this->p['A']->public_id, $audit->auditable_public_id);
        $this->assertSame('administrative', $audit->category);
        $this->assertSame(['entry' => $entry->public_id, 'tooth' => '36'], $audit->payload);
        $this->assertStringNotContainsString('CHART-BE-01 private note', $audit->toJson());
        $this->assertStringNotContainsString('Caries', $audit->toJson());
    }

    public function test_audit_failure_rolls_back_new_finding_and_audit_preserving_existing_history(): void
    {
        $this->actingAsUser('dentist1');
        $this->record()->assertCreated();
        $before = ToothChartEntry::sole()->getAttributes();
        $auditBefore = AuditLog::where('action', 'chart.recorded')->sole()->getAttributes();
        $this->app->bind(AuditService::class, fn () => new class extends AuditService {
            public function record(array $attributes): AuditLog
            {
                parent::record($attributes);
                throw new \RuntimeException('CHART-BE-01 audit failure fixture');
            }
        });
        $this->withoutExceptionHandling();
        try {
            $this->record(['status' => 'Filled']);
            $this->fail('A finding cannot persist when its required audit fails.');
        } catch (\RuntimeException $exception) {
            $this->assertSame('CHART-BE-01 audit failure fixture', $exception->getMessage());
        }
        $this->assertSame($before, ToothChartEntry::sole()->getAttributes());
        $this->assertSame($auditBefore, AuditLog::where('action', 'chart.recorded')->sole()->getAttributes());
    }

    public function test_failure_after_entry_insert_leaves_neither_entry_nor_success_audit(): void
    {
        $this->actingAsUser('dentist1');
        $this->mock(AuditService::class, fn ($mock) => $mock->shouldNotReceive('recordAdministrative'));
        $dispatcher = Model::getEventDispatcher();
        Model::setEventDispatcher(clone $dispatcher);
        ToothChartEntry::created(fn () => throw new \RuntimeException('CHART-BE-01 insert failure fixture'));
        $this->withoutExceptionHandling();
        try {
            $this->record();
            $this->fail('Failed creation must roll back its inserted finding.');
        } catch (\RuntimeException $exception) {
            $this->assertSame('CHART-BE-01 insert failure fixture', $exception->getMessage());
        } finally {
            Model::setEventDispatcher($dispatcher);
        }
        $this->assertSame(0, ToothChartEntry::count());
        $this->assertSame(0, AuditLog::where('action', 'chart.recorded')->count());
    }

    public function test_repeated_valid_recordings_append_distinct_entries_without_rewriting_history(): void
    {
        $this->actingAsUser('dentist1');
        $this->record()->assertCreated();
        $first = ToothChartEntry::sole();
        $before = $first->getAttributes();
        $response = $this->record()->assertCreated();
        $this->assertCount(2, $response->json('data.history'));
        $this->assertSame($before, $first->fresh()->getAttributes());
        $this->assertSame(2, ToothChartEntry::distinct()->count('public_id'));
        $this->assertSame(2, AuditLog::where('action', 'chart.recorded')->count());
        // Existing append behavior is preserved; no API idempotency contract is introduced.
    }

    public function test_permissions_and_read_redaction_remain_unchanged(): void
    {
        foreach (['dentist2', 'dentist3', 'staffB1', 'owner', 'patientA'] as $who) {
            $this->actingAsUser($who);
            $this->record()->assertForbidden();
        }
        $this->assertSame(0, ToothChartEntry::count());
        $this->assertSame(0, AuditLog::where('action', 'chart.recorded')->count());
        $this->actingAsUser('dentist1');
        $this->record()->assertCreated();
        $this->actingAsUser('staffB1');
        $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertOk()->assertJsonMissingPath('data.current.0.note');
        $this->actingAsUser('patientA');
        $this->getJson('/api/me/chart')->assertOk()->assertJsonPath('data.history', null)->assertJsonMissingPath('data.current.0.note');
        $this->actingAsUser('owner');
        $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertForbidden();
    }

    public function test_invalid_fields_and_unassigned_branch_create_no_finding_or_audit(): void
    {
        $this->actingAsUser('dentist1');
        foreach ([['status' => 'Not a configured status'], ['recorded_on' => '2026-09-30'], ['tooth' => '19'],
            ['surfaces' => ['invalid']], ['branch_ref' => 'b2'], ['branch_ref' => 'unknown'], ['treatment_id' => 'unknown']] as $payload) {
            $this->record($payload)->assertStatus(422);
        }
        $this->assertSame(0, ToothChartEntry::count());
        $this->assertSame(0, AuditLog::where('action', 'chart.recorded')->count());
    }

    public function test_linked_treatment_preserves_patient_and_branch_attribution(): void
    {
        $treatments = [];
        foreach ([['A', 'd1', 'b1', 'dentist1'], ['B', 'd3', 'b2', 'dentist3']] as [$patient, $dentist, $branch, $who]) {
            $visit = Visit::create([
                'patient_id' => $this->p[$patient]->id, 'branch_id' => $this->b[$branch]->id,
                'source' => 'walk_in', 'status' => 'In Treatment', 'responsible_dentist_profile_id' => $this->d[$dentist]->id,
                'arrived_at' => ClinicClock::now(), 'clinic_date' => ClinicClock::today(), 'revision' => 1,
                'created_by_user_id' => $this->u['staffB1']->id, 'updated_by_user_id' => $this->u['staffB1']->id,
            ]);
            $treatments[$patient] = Treatment::create([
                'visit_id' => $visit->id, 'dentist_profile_id' => $this->d[$dentist]->id, 'status' => 'In Treatment',
                'started_at' => ClinicClock::now(), 'revision' => 1,
                'created_by_user_id' => $this->u[$who]->id, 'updated_by_user_id' => $this->u[$who]->id,
            ]);
        }
        $this->actingAsUser('dentist1');
        $this->record(['treatment_id' => $treatments['A']->public_id])->assertCreated();
        $entry = ToothChartEntry::sole();
        $this->assertSame([$treatments['A']->id, $this->p['A']->id, $this->b['b1']->id], [$entry->treatment_id, $entry->patient_id, $entry->branch_id]);
        $this->record(['treatment_id' => $treatments['B']->public_id])->assertStatus(422)->assertJsonValidationErrors('treatment_id');
        $this->assertSame(1, ToothChartEntry::count());
        $this->assertSame(1, AuditLog::where('action', 'chart.recorded')->count());
    }
}

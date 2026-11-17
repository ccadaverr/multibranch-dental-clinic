<?php

namespace Tests\Feature\Charts;

use App\Http\Controllers\DentalChartController;
use App\Models\AuditLog;
use App\Models\ToothChartEntry;
use App\Services\Automations\AutomationCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** M10 Dental Charts (SchedulingFixture: patient A has an appointment at b1; d1, d2 at b1; d3 at b2). */
class DentalChartTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-29', '10:00');
    }

    private function record(array $body)
    {
        // Each helper invocation is a newly reviewed intent; stale/replay tests retain explicit originals elsewhere.
        $body += ['expected_revision' => ToothChartEntry::where('patient_id', $this->p['A']->id)->where('tooth', $body['tooth'] ?? '36')->count()];
        if (!empty($body['treatment_id'])) $body += ['expected_treatment_revision' => \App\Models\Treatment::where('public_id', $body['treatment_id'])->value('revision') ?? 1];
        return $this->postJson('/api/patients/'.$this->p['A']->public_id.'/chart', $body + ['tooth' => '36', 'status' => 'Caries', 'surfaces' => ['O', 'D'], 'note' => 'Deep lesion, monitor sensitivity'], ['Idempotency-Key' => (string) \Illuminate\Support\Str::uuid()]);
    }

    public function test_history_is_append_only_and_the_current_chart_is_the_latest_entry_per_tooth(): void
    {
        $this->actingAsUser('dentist1');
        $this->record([])->assertCreated();
        $chart = $this->record(['status' => 'Filled', 'surfaces' => ['O', 'D']])->assertCreated();
        $this->record(['tooth' => '55', 'status' => 'Healthy', 'surfaces' => []])->assertCreated(); // a primary tooth
        $chart = $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertOk();
        $current = collect($chart->json('data.current'))->keyBy('tooth');
        $this->assertSame('Filled', $current['36']['status']);
        $this->assertCount(3, $chart->json('data.history'));
        $this->assertSame('fdi', $chart->json('data.settings.numbering'));
        $this->assertSame(0, ToothChartEntry::whereNull('branch_id')->count(), 'Every tooth chart entry must have a non-null branch_id');
        $this->record(['status' => 'Purple'])->assertStatus(422); // only the Owner's list
        $this->record(['tooth' => '19'])->assertStatus(422);     // not a tooth
        $this->record(['recorded_on' => '2026-10-01'])->assertStatus(422); // not in the future
        foreach ([fn () => ToothChartEntry::query()->update(['status' => 'Healthy']), fn () => ToothChartEntry::query()->delete()] as $change) {
            try { DB::transaction($change); $this->fail('history changed'); } catch (\Illuminate\Database\QueryException) {}
        }
    }

    public function test_roles_see_what_they_should_and_audit_holds_no_notes(): void
    {
        $this->actingAsUser('dentist3');
        $this->record([])->assertForbidden(); // not caring for this patient
        $this->actingAsUser('dentist2');
        $this->record([])->assertForbidden(); // same branch, but not their patient: access is workflow-tied, never branch-wide
        $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertNotFound();
        $cancelled = $this->existing('A', 'd2', 'b1', 'svc1', '2026-09-30', '11:00');
        $cancelled->update(['status' => 'Cancelled']);
        $this->record([])->assertForbidden(); // a cancelled booking grants nothing
        $this->actingAsUser('dentist1');
        $this->record([])->assertCreated();

        $this->actingAsUser('staffB1');
        $staff = $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertOk();
        $this->assertSame('Caries', $staff->json('data.current.0.status'));
        $this->assertStringNotContainsString('Deep lesion', $staff->getContent()); // read-only chart without notes
        $this->record([])->assertForbidden();
        $this->actingAsUser('owner');
        $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertForbidden();
        $this->actingAsUser('patientA');
        $mine = $this->getJson('/api/me/chart')->assertOk();
        $this->assertSame('Caries', $mine->json('data.current.0.status'));
        $this->assertNull($mine->json('data.history'));
        $this->assertStringNotContainsString('Deep lesion', $mine->getContent());
        $this->actingAsUser('patientB');
        $this->getJson('/api/me/chart?patient_id='.$this->p['A']->public_id)->assertNotFound();

        $audit = AuditLog::where('action', 'like', 'chart.%')->get();
        $this->assertSame(['chart.recorded', 'chart.viewed'], $audit->pluck('action')->all());
        $this->assertStringNotContainsString('Deep lesion', $audit->toJson());
        $this->assertNotSame('Deep lesion, monitor sensitivity', DB::table('tooth_chart_entries')->value('note')); // encrypted at rest
    }

    public function test_a_handover_gives_the_receiving_dentist_chart_access_only_for_the_owner_days(): void
    {
        $this->actingAsUser('dentist1');
        $this->record([])->assertCreated();
        \App\Models\PatientHandover::create(['patient_id' => $this->p['A']->id, 'from_branch_id' => $this->b['b1']->id, 'to_branch_id' => $this->b['b2']->id,
            'to_dentist_profile_id' => $this->d['d3']->id, 'created_by_user_id' => $this->u['staffB1']->id, 'summary' => 'x', 'status' => 'Sent']);
        $this->actingAsUser('dentist3');
        $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertOk();
        $this->travel(61)->days();
        $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertNotFound();
    }

    public function test_chart_finding_without_treatment_takes_clinicians_branch(): void
    {
        $this->actingAsUser('dentist1');
        $res = $this->record(['tooth' => '11', 'status' => 'Healthy', 'surfaces' => []])->assertCreated();
        $entry = ToothChartEntry::where('tooth', '11')->first();
        $this->assertNotNull($entry);
        $this->assertSame($this->b['b1']->id, $entry->branch_id);
        $this->assertSame(0, ToothChartEntry::whereNull('branch_id')->count());
    }

    public function test_chart_finding_branch_resolution_and_validation(): void
    {
        // Dentist 1 is initially assigned only to b1. Attach dentist 1 to b2 as well.
        $this->d['d1']->branches()->syncWithoutDetaching([$this->b['b2']->id]);

        $this->actingAsUser('dentist1');
        // When dentist is at multiple branches and no visit today, passing explicit branch_ref works:
        $this->record(['tooth' => '21', 'status' => 'Healthy', 'surfaces' => [], 'branch_ref' => $this->b['b2']->legacy_ref, 'recorded_on' => '2026-09-20'])->assertCreated();
        $entry = ToothChartEntry::where('tooth', '21')->first();
        $this->assertSame($this->b['b2']->id, $entry->branch_id);

        // Unauthorized branch returns 422:
        $this->record(['tooth' => '22', 'status' => 'Healthy', 'surfaces' => [], 'branch_id' => 999999])->assertStatus(422);

        // Ambiguous branch without encounter and without parameter on a non-appointment date returns 422:
        $res = $this->record(['tooth' => '23', 'status' => 'Healthy', 'surfaces' => [], 'recorded_on' => '2026-08-01'])->assertStatus(422);
        $res->assertJsonValidationErrors(['branch_id']);
        $this->assertSame('Unable to determine clinic branch for this entry. Please select a branch.', $res->json('errors.branch_id.0'));
    }

    public function test_patient_cannot_post_chart_and_mine_has_no_notes_or_branch_exposure(): void
    {
        $this->actingAsUser('dentist1');
        $this->record(['tooth' => '16', 'status' => 'Caries', 'note' => 'Confidential clinical observation', 'surfaces' => ['O']])->assertCreated();

        // 1. Patient cannot POST to record a finding (403)
        $this->actingAsUser('patientA');
        $this->record(['tooth' => '11', 'status' => 'Healthy'])->assertForbidden();

        // 2. Patient GET /api/me/chart has no notes and no branch data
        $mine = $this->getJson('/api/me/chart')->assertOk();
        $this->assertNull($mine->json('data.history'));
        $this->assertStringNotContainsString('Confidential clinical observation', $mine->getContent());
        $this->assertArrayNotHasKey('note', $mine->json('data.current.0'));
        $this->assertArrayNotHasKey('branch_id', $mine->json('data.current.0'));
        $this->assertArrayNotHasKey('branch', $mine->json('data.current.0'));

        // Check summary has no notes or branch exposure
        $summary = collect($mine->json('data.summary'))->keyBy('status');
        $this->assertTrue($summary->has('Caries'));
        $this->assertArrayNotHasKey('note', $summary['Caries']['teeth'][0]);
        $this->assertArrayNotHasKey('branch_id', $summary['Caries']['teeth'][0]);
        $this->assertArrayNotHasKey('branch', $summary['Caries']['teeth'][0]);
    }

    public function test_multi_entry_per_tooth_preserves_distinct_surface_findings(): void
    {
        $this->actingAsUser('dentist1');

        // Entry A: Caries on O (Sept 10)
        $this->record(['tooth' => '16', 'status' => 'Caries', 'surfaces' => ['O'], 'recorded_on' => '2026-09-10', 'note' => 'O caries note'])->assertCreated();

        // Entry B: Filled on D (later date: Sept 25)
        $this->record(['tooth' => '16', 'status' => 'Filled', 'surfaces' => ['D'], 'recorded_on' => '2026-09-25', 'note' => 'D filling note'])->assertCreated();

        // 1. Dentist view
        $dentistView = $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertOk();
        $dentistCurrent = collect($dentistView->json('data.current'));
        $this->assertCount(2, $dentistCurrent->where('tooth', '16'));
        $this->assertTrue($dentistCurrent->contains(fn ($c) => $c['tooth'] === '16' && $c['status'] === 'Caries' && $c['surfaces'] === ['O'] && ($c['note'] ?? '') === 'O caries note'));
        $this->assertTrue($dentistCurrent->contains(fn ($c) => $c['tooth'] === '16' && $c['status'] === 'Filled' && $c['surfaces'] === ['D'] && ($c['note'] ?? '') === 'D filling note'));

        $dentistSummary = collect($dentistView->json('data.summary'))->keyBy('status');
        $this->assertTrue($dentistSummary->has('Caries'));
        $this->assertTrue($dentistSummary->has('Filled'));
        $this->assertSame(['O'], $dentistSummary['Caries']['teeth'][0]['surfaces']);
        $this->assertSame(['D'], $dentistSummary['Filled']['teeth'][0]['surfaces']);

        // 2. Staff view (same active findings, no notes)
        $this->actingAsUser('staffB1');
        $staffView = $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertOk();
        $staffCurrent = collect($staffView->json('data.current'));
        $this->assertCount(2, $staffCurrent->where('tooth', '16'));
        $this->assertArrayNotHasKey('note', $staffCurrent->firstWhere('status', 'Caries'));
        $this->assertArrayNotHasKey('note', $staffCurrent->firstWhere('status', 'Filled'));

        $staffSummary = collect($staffView->json('data.summary'))->keyBy('status');
        $this->assertTrue($staffSummary->has('Caries'));
        $this->assertTrue($staffSummary->has('Filled'));

        // 3. Patient view (same active findings, no notes, history is null)
        $this->actingAsUser('patientA');
        $patientView = $this->getJson('/api/me/chart')->assertOk();
        $patientCurrent = collect($patientView->json('data.current'));
        $this->assertCount(2, $patientCurrent->where('tooth', '16'));
        $this->assertNull($patientView->json('data.history'));
        $this->assertArrayNotHasKey('note', $patientCurrent->firstWhere('status', 'Caries'));
        $this->assertArrayNotHasKey('note', $patientCurrent->firstWhere('status', 'Filled'));

        $patientSummary = collect($patientView->json('data.summary'))->keyBy('status');
        $this->assertTrue($patientSummary->has('Caries'));
        $this->assertTrue($patientSummary->has('Filled'));
        $this->assertSame(['O'], $patientSummary['Caries']['teeth'][0]['surfaces']);
        $this->assertSame(['D'], $patientSummary['Filled']['teeth'][0]['surfaces']);
    }

    public function test_chart_payload_includes_summary_grouped_by_status(): void
    {
        $this->actingAsUser('dentist1');
        $this->record(['tooth' => '16', 'status' => 'Caries', 'surfaces' => ['M', 'O', 'D']])->assertCreated();
        $this->record(['tooth' => '26', 'status' => 'Caries', 'surfaces' => ['O']])->assertCreated();
        $this->record(['tooth' => '36', 'status' => 'Filled', 'surfaces' => ['O', 'D']])->assertCreated();

        // 1. Dentist view (has notes)
        $dentistView = $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertOk();
        $summary = collect($dentistView->json('data.summary'))->keyBy('status');
        $this->assertTrue($summary->has('Caries'));
        $this->assertTrue($summary->has('Filled'));
        $this->assertSame(2, $summary['Caries']['count']);
        $this->assertSame(1, $summary['Filled']['count']);
        $this->assertCount(2, $summary['Caries']['teeth']);

        // 2. Patient view (simplified, no notes)
        $this->actingAsUser('patientA');
        $mineView = $this->getJson('/api/me/chart')->assertOk();
        $mineSummary = collect($mineView->json('data.summary'))->keyBy('status');
        $this->assertTrue($mineSummary->has('Caries'));
        $this->assertSame(2, $mineSummary['Caries']['count']);
        $this->assertArrayNotHasKey('note', $mineSummary['Caries']['teeth'][0]);
    }

    /**
     * Follow-up #3: Whole-tooth statuses (surfaces: []) and surface finding precedence rules:
     * a) Caries on O, then Extracted (no surface) -> chart shows tooth as Extracted, no stale Caries on O.
     * b) Extracted, then Healthy/new finding later -> defined behavior: latest whole-tooth entry wins, older surface findings superseded.
     * c) Healthy (no surface) after Caries on O -> surface finding cleared.
     * d) Whole-tooth entry then a newer surface-specific finding -> both active, surface finding on top.
     * e) Summary groups and tooth highlight match current in all cases (Dentist, Staff, Patient).
     */
    public function test_whole_tooth_statuses_and_surface_finding_precedence(): void
    {
        $this->actingAsUser('dentist1');

        // Case a: Tooth 14 - Caries on O, then Extracted (no surface)
        $this->record(['tooth' => '14', 'status' => 'Caries', 'surfaces' => ['O'], 'recorded_on' => '2026-09-01', 'note' => 'Caries before extraction'])->assertCreated();
        $this->record(['tooth' => '14', 'status' => 'Extracted', 'surfaces' => [], 'recorded_on' => '2026-09-05', 'note' => 'Extracted tooth'])->assertCreated();

        // Case b: Tooth 15 - Extracted, then Healthy/new finding later (latest whole-tooth entry wins)
        $this->record(['tooth' => '15', 'status' => 'Extracted', 'surfaces' => [], 'recorded_on' => '2026-09-01', 'note' => 'Initial extraction record'])->assertCreated();
        $this->record(['tooth' => '15', 'status' => 'Healthy', 'surfaces' => [], 'recorded_on' => '2026-09-10', 'note' => 'Corrected/sound finding'])->assertCreated();

        // Case c: Tooth 16 - Healthy (no surface) after Caries on O (clears surface finding)
        $this->record(['tooth' => '16', 'status' => 'Caries', 'surfaces' => ['O'], 'recorded_on' => '2026-09-01', 'note' => 'Caries observed'])->assertCreated();
        $this->record(['tooth' => '16', 'status' => 'Healthy', 'surfaces' => [], 'recorded_on' => '2026-09-12', 'note' => 'Treated and sound now'])->assertCreated();

        // Case d: Tooth 17 - Whole-tooth entry (Crown) then a newer surface-specific finding (Caries on O)
        $this->record(['tooth' => '17', 'status' => 'Crown', 'surfaces' => [], 'recorded_on' => '2026-09-01', 'note' => 'Full ceramic crown placed'])->assertCreated();
        $this->record(['tooth' => '17', 'status' => 'Caries', 'surfaces' => ['O'], 'recorded_on' => '2026-09-15', 'note' => 'Margin caries on occlusal surface'])->assertCreated();

        // --- 1. Dentist Perspective ---
        $dentistView = $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertOk();
        $dentistCurrent = collect($dentistView->json('data.current'));

        // Case a check: Tooth 14 is Extracted only, no stale Caries on O
        $t14 = $dentistCurrent->where('tooth', '14');
        $this->assertCount(1, $t14);
        $this->assertSame('Extracted', $t14->first()['status']);
        $this->assertSame([], $t14->first()['surfaces']);
        $this->assertFalse($dentistCurrent->contains(fn ($c) => $c['tooth'] === '14' && $c['status'] === 'Caries'));

        // Case b check: Tooth 15 is Healthy (latest whole-tooth wins over Extracted)
        $t15 = $dentistCurrent->where('tooth', '15');
        $this->assertCount(1, $t15);
        $this->assertSame('Healthy', $t15->first()['status']);
        $this->assertSame([], $t15->first()['surfaces']);
        $this->assertFalse($dentistCurrent->contains(fn ($c) => $c['tooth'] === '15' && $c['status'] === 'Extracted'));

        // Case c check: Tooth 16 surface finding cleared by Healthy
        $t16 = $dentistCurrent->where('tooth', '16');
        $this->assertCount(1, $t16);
        $this->assertSame('Healthy', $t16->first()['status']);
        $this->assertSame([], $t16->first()['surfaces']);
        $this->assertFalse($dentistCurrent->contains(fn ($c) => $c['tooth'] === '16' && $c['status'] === 'Caries'));

        // Case d check: Tooth 17 has both Crown (whole tooth) and Caries on O (surface finding on top)
        $t17 = $dentistCurrent->where('tooth', '17');
        $this->assertCount(2, $t17);
        $crownEntry = $t17->firstWhere('status', 'Crown');
        $cariesEntry = $t17->firstWhere('status', 'Caries');
        $this->assertNotNull($crownEntry, 'Crown whole-tooth entry must remain active');
        $this->assertSame([], $crownEntry['surfaces']);
        $this->assertNotNull($cariesEntry, 'Caries surface entry must remain active');
        $this->assertSame(['O'], $cariesEntry['surfaces']);

        // Case e check: Summary groups match current (Healthy is excluded: Healthy != finding)
        $dentistSummary = collect($dentistView->json('data.summary'))->keyBy('status');
        $this->assertTrue($dentistSummary->has('Extracted'));
        $this->assertFalse($dentistSummary->has('Healthy'), 'Healthy must be excluded from summary');
        $this->assertTrue($dentistSummary->has('Crown'));
        $this->assertTrue($dentistSummary->has('Caries'));
        $this->assertSame(1, $dentistSummary['Extracted']['count']);
        $this->assertSame(1, $dentistSummary['Crown']['count']);
        $this->assertSame(1, $dentistSummary['Caries']['count']);
        $this->assertTrue(collect($dentistSummary['Crown']['teeth'])->contains('tooth', '17'));
        $this->assertTrue(collect($dentistSummary['Caries']['teeth'])->contains('tooth', '17'));

        // --- 2. Staff Perspective (same resolved findings, notes redacted) ---
        $this->actingAsUser('staffB1');
        $staffView = $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertOk();
        $staffCurrent = collect($staffView->json('data.current'));
        $this->assertCount(1, $staffCurrent->where('tooth', '14'));
        $this->assertCount(1, $staffCurrent->where('tooth', '15'));
        $this->assertCount(1, $staffCurrent->where('tooth', '16'));
        $this->assertCount(2, $staffCurrent->where('tooth', '17'));
        $this->assertArrayNotHasKey('note', $staffCurrent->firstWhere('tooth', '14'));
        $this->assertArrayNotHasKey('note', $staffCurrent->firstWhere('tooth', '17'));

        // --- 3. Patient Perspective (simplified, notes redacted, history strictly null) ---
        $this->actingAsUser('patientA');
        $patientView = $this->getJson('/api/me/chart')->assertOk();
        $patientCurrent = collect($patientView->json('data.current'));
        $this->assertCount(1, $patientCurrent->where('tooth', '14'));
        $this->assertCount(1, $patientCurrent->where('tooth', '15'));
        $this->assertCount(1, $patientCurrent->where('tooth', '16'));
        $this->assertCount(2, $patientCurrent->where('tooth', '17'));
        $this->assertNull($patientView->json('data.history'));
        $this->assertArrayNotHasKey('note', $patientCurrent->firstWhere('tooth', '14'));

        $patientSummary = collect($patientView->json('data.summary'))->keyBy('status');
        $this->assertTrue($patientSummary->has('Extracted'));
        $this->assertFalse($patientSummary->has('Healthy'), 'Healthy must be excluded from summary');
        $this->assertTrue($patientSummary->has('Crown'));
        $this->assertTrue($patientSummary->has('Caries'));
    }

    public function test_surface_finding_on_missing_or_extracted_tooth_is_rejected_with_422(): void
    {
        $this->actingAsUser('dentist1');

        // 1. Tooth 24 marked Extracted (whole-tooth)
        $this->record(['tooth' => '24', 'status' => 'Extracted', 'surfaces' => [], 'recorded_on' => '2026-09-01'])->assertCreated();

        // Attempting to record Caries on O on tooth 24 must return 422 with the exact rejection message
        $res = $this->record(['tooth' => '24', 'status' => 'Caries', 'surfaces' => ['O'], 'recorded_on' => '2026-09-05'])->assertStatus(422);
        $res->assertJsonValidationErrors(['status']);
        $this->assertSame(
            'Tooth is marked Extracted/Missing. Record a whole-tooth status first.',
            $res->json('errors.status.0')
        );

        // 2. Tooth 25 marked Missing (whole-tooth)
        $this->record(['tooth' => '25', 'status' => 'Missing', 'surfaces' => [], 'recorded_on' => '2026-09-01'])->assertCreated();

        // Attempting to record Filled on M on tooth 25 must return 422
        $res2 = $this->record(['tooth' => '25', 'status' => 'Filled', 'surfaces' => ['M'], 'recorded_on' => '2026-09-05'])->assertStatus(422);
        $res2->assertJsonValidationErrors(['status']);
        $this->assertSame(
            'Tooth is marked Extracted/Missing. Record a whole-tooth status first.',
            $res2->json('errors.status.0')
        );

        // 3. When a whole-tooth status (e.g. Implant) is recorded first, surface findings are then accepted:
        $this->record(['tooth' => '24', 'status' => 'Implant', 'surfaces' => [], 'recorded_on' => '2026-09-10'])->assertCreated();
        $this->record(['tooth' => '24', 'status' => 'Crown', 'surfaces' => ['O'], 'recorded_on' => '2026-09-15'])->assertCreated();

        $chart = $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertOk();
        $t24 = collect($chart->json('data.current'))->where('tooth', '24');
        $this->assertCount(2, $t24);
        $this->assertTrue($t24->contains('status', 'Implant'));
        $this->assertTrue($t24->contains('status', 'Crown'));
    }

    public function test_healthy_and_sound_excluded_from_summary_but_appear_in_current(): void
    {
        $this->actingAsUser('dentist1');

        $this->record(['tooth' => '31', 'status' => 'Healthy', 'surfaces' => [], 'recorded_on' => '2026-09-01', 'note' => 'Sound mandibular incisor'])->assertCreated();

        // Dentist view
        $dentistView = $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertOk();
        $summary = $dentistView->json('data.summary');
        $this->assertEmpty($summary, 'Summary must exclude Healthy/Sound entirely');
        $current = collect($dentistView->json('data.current'));
        $this->assertTrue($current->contains('tooth', '31'));
        $this->assertSame('Healthy', $current->firstWhere('tooth', '31')['status']);

        // Patient view
        $this->actingAsUser('patientA');
        $patientView = $this->getJson('/api/me/chart')->assertOk();
        $this->assertEmpty($patientView->json('data.summary'), 'Patient summary must exclude Healthy/Sound');
        $patientCurrent = collect($patientView->json('data.current'));
        $this->assertTrue($patientCurrent->contains('tooth', '31'));
        $this->assertNull($patientView->json('data.history'));
    }

    public function test_status_code_category_classification_and_fallback(): void
    {
        // 1. Every default status configured in automation settings must be classified into a valid category
        $statuses = AutomationCatalog::setting('dental_chart')?->settings['statuses'] ?? [];
        $this->assertNotEmpty($statuses);

        $validCategories = [
            DentalChartController::CATEGORY_BASELINE,
            DentalChartController::CATEGORY_STRUCTURAL,
            DentalChartController::CATEGORY_PATHOLOGY,
            DentalChartController::CATEGORY_ABSENT,
        ];

        foreach ($statuses as $status) {
            $cat = DentalChartController::statusCategory($status);
            $this->assertContains($cat, $validCategories, "Status '{$status}' must be classified into a valid category");
        }

        // 2. Specific known classifications
        $this->assertSame(DentalChartController::CATEGORY_BASELINE, DentalChartController::statusCategory('Healthy'));
        $this->assertSame(DentalChartController::CATEGORY_BASELINE, DentalChartController::statusCategory('Sound'));
        $this->assertSame(DentalChartController::CATEGORY_ABSENT, DentalChartController::statusCategory('Missing'));
        $this->assertSame(DentalChartController::CATEGORY_ABSENT, DentalChartController::statusCategory('Extracted'));
        $this->assertSame(DentalChartController::CATEGORY_STRUCTURAL, DentalChartController::statusCategory('Crown'));
        $this->assertSame(DentalChartController::CATEGORY_STRUCTURAL, DentalChartController::statusCategory('Root canal'));
        $this->assertSame(DentalChartController::CATEGORY_STRUCTURAL, DentalChartController::statusCategory('Implant'));
        $this->assertSame(DentalChartController::CATEGORY_PATHOLOGY, DentalChartController::statusCategory('Caries'));
        $this->assertSame(DentalChartController::CATEGORY_PATHOLOGY, DentalChartController::statusCategory('Filled'));
        $this->assertSame(DentalChartController::CATEGORY_PATHOLOGY, DentalChartController::statusCategory('To monitor'));

        // 3. Fallback for custom/unknown statuses added by the Owner
        // Custom status with surfaces -> fallback to pathology
        $this->assertSame(
            DentalChartController::CATEGORY_PATHOLOGY,
            DentalChartController::statusCategory('Custom Discoloration', ['B'])
        );
        // Custom status without surfaces -> fallback to structural
        $this->assertSame(
            DentalChartController::CATEGORY_STRUCTURAL,
            DentalChartController::statusCategory('Custom Zirconia Onlay', [])
        );
    }
}

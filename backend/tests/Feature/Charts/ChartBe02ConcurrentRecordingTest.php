<?php

namespace Tests\Feature\Charts;

use App\Models\AuditLog;
use App\Models\ToothChartEntry;
use App\Services\Audit\AuditService;
use App\Support\ClinicClock;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\Feature\Operations\OpsQa03SeparateConnectionHarness;
use Tests\TestCase;

require_once __DIR__.'/../Operations/OpsQa03AdmissionRaceTest.php';

/** CHART-BE-02 regression authoring only. Uses committed, guarded scratch data; never RefreshDatabase. */
class ChartBe02ConcurrentRecordingTest extends TestCase
{
    use SchedulingFixture;
    use OpsQa03SeparateConnectionHarness { requestSpec as private scratchRequestSpec; }

    protected function requestSpec(string $who, string $path, array $payload, ?string $key = null): array
    {
        return $this->scratchRequestSpec($who, $path, $payload, $key ?? 'chart-'.\Illuminate\Support\Str::uuid());
    }

    private function record(array $payload, array $headers = [])
    {
        return $this->postJson($this->path(), $payload, $headers ?: ['Idempotency-Key' => 'chart-'.\Illuminate\Support\Str::uuid()]);
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->prepareScratchWorld();
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-29', '10:00');
    }

    protected function tearDown(): void
    {
        try {
            $this->cleanScratchWorld();
        } finally {
            parent::tearDown();
        }
    }

    private function path(): string
    {
        return '/api/patients/'.$this->p['A']->public_id.'/chart';
    }

    private function payload(array $extra = []): array
    {
        return $extra + ['tooth' => '36', 'surfaces' => ['O'], 'status' => 'Caries', 'branch_ref' => 'b1',
            'expected_revision' => 0, 'recorded_on' => ClinicClock::today(), 'note' => 'CHART02 private synthetic note'];
    }

    private function holdTooth(string $tooth = '36'): void
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?), ?)', ['dental-chart:'.$this->p['A']->id, (int) $tooth]);
    }

    public function test_same_tooth_first_recordings_wait_then_only_original_revision_wins(): void
    {
        $specs = [
            $this->requestSpec('dentist1', $this->path(), $this->payload(), 'chart-a'),
            $this->requestSpec('dentist1', $this->path(), $this->payload(['status' => 'Filled', 'surfaces' => ['M']]), 'chart-b'),
        ];
        DB::beginTransaction();
        $this->holdTooth();
        $children = array_map(fn ($spec) => $this->launchRequest($spec), $specs);
        foreach ($children as $child) $this->awaitParentBlock($child, 'advisory');
        $this->assertSame(0, ToothChartEntry::count(), 'No child may append before it acquires the tooth lock.');
        DB::commit();
        $statuses = array_map(fn ($child) => $this->finishRequest($child)['status'], $children); sort($statuses);
        $this->assertSame([201, 409], $statuses);
        $this->assertSame(1, ToothChartEntry::count());
        $this->assertSame(1, ToothChartEntry::distinct()->count('public_id'));
        $this->assertSame(1, AuditLog::where('action', 'chart.recorded')->count());
        foreach (ToothChartEntry::all() as $entry) {
            $this->assertSame([$this->p['A']->id, $this->d['d1']->id, $this->b['b1']->id, $this->u['dentist1']->id],
                [$entry->patient_id, $entry->dentist_profile_id, $entry->branch_id, $entry->created_by_user_id]);
        }
    }

    public function test_surface_writer_waits_for_absent_recording_and_revalidates_the_committed_state(): void
    {
        $spec = $this->requestSpec('dentist1', $this->path(), $this->payload(), 'surface-behind-absent');
        DB::beginTransaction();
        $this->holdTooth();
        $child = $this->launchRequest($spec);
        $this->awaitParentBlock($child, 'advisory');
        $this->actingAsUser('dentist1');
        // Same connection owns the advisory lock, so this is the preceding writer in the controlled interleaving.
        $this->record($this->payload(['status' => 'Missing', 'surfaces' => []]))->assertCreated();
        $before = ToothChartEntry::sole()->getAttributes();
        DB::commit();
        $result = $this->finishRequest($child);
        $this->assertSame(409, $result['status']);
        $this->assertSame('chart_revision_changed', $result['body']['code']);
        $this->assertSame($before, ToothChartEntry::sole()->getAttributes());
        $this->assertSame(1, AuditLog::where('action', 'chart.recorded')->count());
        // An ambiguous/stale retry cannot use its previously valid draft to override the now-absent state.
        $this->record($this->payload(), ['Idempotency-Key' => 'surface-behind-absent'])->assertStatus(409);
        $this->assertSame(1, ToothChartEntry::count());
        $this->assertSame(1, AuditLog::where('action', 'chart.recorded')->count());
    }

    public function test_absent_writer_after_surface_recording_clears_only_the_current_projection(): void
    {
        $spec = $this->requestSpec('dentist1', $this->path(), $this->payload(['status' => 'Extracted', 'surfaces' => []]));
        DB::beginTransaction();
        $this->holdTooth();
        $child = $this->launchRequest($spec);
        $this->awaitParentBlock($child, 'advisory');
        $this->actingAsUser('dentist1');
        $this->record($this->payload())->assertCreated();
        $surface = ToothChartEntry::sole();
        $before = $surface->getAttributes();
        DB::commit();
        $result = $this->finishRequest($child);
        $this->assertSame(409, $result['status']);
        // Only a new explicitly reviewed revision may supersede the surface finding.
        $result = ['body' => $this->record($this->payload(['status' => 'Extracted', 'surfaces' => [], 'expected_revision' => 1]))->assertCreated()->json()];
        $this->assertCount(1, $result['body']['data']['current']);
        $this->assertSame('Extracted', $result['body']['data']['current'][0]['status']);
        $this->assertCount(2, $result['body']['data']['history']);
        $this->assertSame($before, $surface->fresh()->getAttributes());
        $this->assertSame(2, AuditLog::where('action', 'chart.recorded')->count());
    }

    public function test_different_teeth_can_finish_without_waiting_for_the_other_tooth_lock(): void
    {
        $spec = $this->requestSpec('dentist1', $this->path(), $this->payload(['tooth' => '37']));
        DB::beginTransaction();
        $this->holdTooth('36');
        $child = $this->launchRequest($spec);
        // Completion is required while the parent's tooth-36 lock is STILL held.
        $result = $this->finishRequest($child);
        $this->assertSame(201, $result['status']);
        $this->assertSame(1, DB::transactionLevel());
        DB::rollBack();
        $this->assertSame('37', ToothChartEntry::sole()->tooth);
        $this->assertSame(1, AuditLog::where('action', 'chart.recorded')->count());
    }

    public function test_rollback_releases_tooth_lock_and_preserves_chart_be01_audit_atomicity(): void
    {
        $this->actingAsUser('dentist1');
        $this->record($this->payload())->assertCreated();
        $entry = ToothChartEntry::sole()->getAttributes();
        $audit = AuditLog::where('action', 'chart.recorded')->sole()->getAttributes();
        $this->app->bind(AuditService::class, fn () => new class extends AuditService {
            public function record(array $attributes): AuditLog
            {
                parent::record($attributes);
                throw new RuntimeException('CHART02 synthetic audit failure');
            }
        });
        $this->withoutExceptionHandling();
        try {
            $this->record($this->payload(['status' => 'Filled', 'expected_revision' => 1]));
            $this->fail('A failed audit must roll back its finding.');
        } catch (RuntimeException $e) {
            $this->assertSame('CHART02 synthetic audit failure', $e->getMessage());
        }
        $this->assertSame($entry, ToothChartEntry::sole()->getAttributes());
        $this->assertSame($audit, AuditLog::where('action', 'chart.recorded')->sole()->getAttributes());
        $this->assertSame(0, DB::transactionLevel());
        // A different connection must now acquire the same tooth lock and append normally.
        $spec = $this->requestSpec('dentist1', $this->path(), $this->payload(['status' => 'Filled', 'expected_revision' => 1]));
        $this->assertSame(201, $this->finishRequest($this->launchRequest($spec))['status']);
        $this->assertSame(2, ToothChartEntry::count());
        $this->assertSame(2, AuditLog::where('action', 'chart.recorded')->count());
    }

    public function test_existing_status_branch_and_authorization_checks_leave_no_entry_or_success_audit(): void
    {
        $this->actingAsUser('dentist1');
        foreach ([['status' => 'Unknown'], ['branch_ref' => 'b2'], ['recorded_on' => '2026-09-30'], ['surfaces' => ['X']], ['tooth' => '19']] as $bad) {
            $this->record($this->payload($bad))->assertStatus(422);
        }
        foreach (['dentist2', 'dentist3', 'staffB1', 'owner', 'patientA'] as $who) {
            $this->actingAsUser($who);
            $this->record($this->payload())->assertForbidden();
        }
        $this->assertSame(0, ToothChartEntry::count());
        $this->assertSame(0, AuditLog::where('action', 'chart.recorded')->count());
    }

    public function test_ambiguous_success_retry_recovers_exact_entry_without_duplicate_history(): void
    {
        $this->actingAsUser('dentist1');
        $headers = ['Idempotency-Key' => 'chart-durable-original-intent'];
        $this->record($this->payload(), $headers)->assertCreated();
        $first = ToothChartEntry::sole();
        $before = $first->getAttributes();
        $this->record($this->payload(), $headers)->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
        $this->assertSame(1, ToothChartEntry::count());
        $this->assertSame(1, AuditLog::where('action', 'chart.recorded')->count());
        $this->assertSame($before, $first->fresh()->getAttributes());
        foreach (['status', 'note'] as $field) {
            try {
                DB::transaction(fn () => $first->update([$field => 'Synthetic rewrite attempt']));
                $this->fail('Chart history must remain append-only.');
            } catch (QueryException $e) {
                $this->assertStringContainsString('append-only', $e->getMessage());
            }
        }
        $this->assertSame($before, $first->fresh()->getAttributes());
    }
}

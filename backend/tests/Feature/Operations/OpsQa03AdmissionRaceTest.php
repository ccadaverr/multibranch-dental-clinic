<?php

namespace Tests\Feature\Operations;

use App\Models\Appointment;
use App\Models\AuditLog;
use App\Models\FollowupTask;
use App\Models\Treatment;
use App\Models\TreatmentHistory;
use App\Models\Visit;
use App\Services\Appointments\AppointmentService;
use App\Support\ClinicClock;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\Support\ScratchDatabaseGuard;
use Tests\TestCase;

/**
 * Shared ONLY by the two new concurrency test files. No test has been executed for this assignment.
 * Uses the existing scratch guard, real committed fixtures, separate PHP processes/connections, and observed
 * pg_blocking_pids evidence before releasing a blocker. A timer merely bounds failure; it never proves concurrency.
 */
trait OpsQa03SeparateConnectionHarness
{
    private bool $scratchPrepared = false;
    private array $children = [];

    protected function prepareScratchWorld(): void
    {
        ScratchDatabaseGuard::assertSafe($this->app);
        $this->assertSame('dental_clinic_scratch', DB::connection()->getDatabaseName());
        $this->scratchPrepared = true;
        $this->artisan('migrate:fresh')->assertSuccessful();
        $this->setUpSchedulingWorld();
        $this->assertSame(0, DB::transactionLevel(), 'Concurrency fixtures must be committed, not hidden by RefreshDatabase.');
        $this->assertSame('read committed', DB::selectOne('SHOW transaction_isolation')->transaction_isolation);
    }

    protected function cleanScratchWorld(): void
    {
        // Release parent locks and stop/join children BEFORE rebuilding; a failed assertion must not leak a writer.
        while (DB::transactionLevel() > 0) {
            DB::rollBack();
        }
        foreach ($this->children as [$process, $pipes]) {
            if (is_resource($process)) {
                if (proc_get_status($process)['running']) {
                    proc_terminate($process);
                }
                foreach ($pipes as $pipe) {
                    if (is_resource($pipe)) fclose($pipe);
                }
                proc_close($process);
            }
        }
        if ($this->scratchPrepared) {
            ScratchDatabaseGuard::assertSafe($this->app);
            $this->artisan('migrate:fresh')->assertSuccessful();
        }
    }

    protected function requestSpec(string $who, string $path, array $payload, ?string $key = null): array
    {
        $this->assertSame(0, DB::transactionLevel(), 'Create token before taking a blocker so the child can authenticate.');

        return ['token' => $this->u[$who]->createToken('ops03-scratch')->plainTextToken, 'path' => $path,
            'payload' => $payload, 'headers' => $key === null ? [] : ['Idempotency-Key' => $key],
            'name' => 'ops03-'.bin2hex(random_bytes(10))];
    }

    protected function launchRequest(array $spec): array
    {
        // Pass authentication only over stdin, never process arguments, output, or fixtures on disk.
        $script = <<<'PHP'
            require 'vendor/autoload.php';
            require_once 'tests/Support/ScratchDatabaseGuard.php';
            $app = require 'bootstrap/app.php';
            $kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
            $kernel->bootstrap();
            Tests\Support\ScratchDatabaseGuard::assertSafe($app);
            $spec = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
            Carbon\Carbon::setTestNow(Carbon\CarbonImmutable::parse('2026-09-28 10:00:00', 'Asia/Manila'));
            Carbon\CarbonImmutable::setTestNow(Carbon\CarbonImmutable::parse('2026-09-28 10:00:00', 'Asia/Manila'));
            Illuminate\Support\Facades\Http::preventStrayRequests();
            Illuminate\Support\Facades\Mail::fake();
            Illuminate\Support\Facades\DB::select('SELECT set_config(?, ?, false)', ['application_name', $spec['name']]);
            Illuminate\Support\Facades\DB::statement("SET statement_timeout = '15000ms'");
            Illuminate\Support\Facades\DB::statement("SET lock_timeout = '12000ms'");
            $server = ['HTTP_AUTHORIZATION' => 'Bearer '.$spec['token'], 'HTTP_ACCEPT' => 'application/json', 'CONTENT_TYPE' => 'application/json'];
            foreach ($spec['headers'] as $name => $value) $server['HTTP_'.strtoupper(str_replace('-', '_', $name))] = $value;
            $request = Illuminate\Http\Request::create($spec['path'], 'POST', [], [], [], $server, json_encode($spec['payload']));
            $response = $kernel->handle($request);
            echo json_encode(['status' => $response->getStatusCode(), 'body' => json_decode($response->getContent(), true),
                'replayed' => $response->headers->get('Idempotent-Replayed')]);
            $kernel->terminate($request, $response);
            PHP;
        $process = proc_open([PHP_BINARY, '-r', $script], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes,
            base_path(), array_merge(getenv(), ['APP_ENV' => 'testing', 'DB_CONNECTION' => 'pgsql',
                'DB_HOST' => '127.0.0.1', 'DB_PORT' => '5432', 'DB_DATABASE' => 'dental_clinic_scratch', 'DB_URL' => '',
                'CACHE_STORE' => 'array', 'SESSION_DRIVER' => 'array', 'QUEUE_CONNECTION' => 'sync', 'BCRYPT_ROUNDS' => '4']));
        $this->assertIsResource($process);
        fwrite($pipes[0], json_encode($spec, JSON_THROW_ON_ERROR));
        fclose($pipes[0]);
        unset($pipes[0]);
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);
        $this->children[] = [$process, $pipes];

        return [$process, $pipes, $spec['name']];
    }

    protected function awaitParentBlock(array $child, ?string $waitEvent = null): void
    {
        $parent = (int) DB::selectOne('SELECT pg_backend_pid() AS pid')->pid;
        $deadline = microtime(true) + 8;
        do {
            DB::select('SELECT pg_stat_clear_snapshot()');
            // Tuple-lock waiters may queue behind another child rather than directly behind the parent.
            // Follow PostgreSQL's actual blocking graph; the chain must reach this parent's backend PID.
            $row = DB::selectOne('WITH RECURSIVE blockers(pid) AS (
                    SELECT pid FROM pg_stat_activity WHERE application_name = ?
                    UNION SELECT unnest(pg_blocking_pids(blockers.pid)) FROM blockers
                ) SELECT wait_event_type, wait_event,
                    EXISTS (SELECT 1 FROM blockers WHERE pid = ?::integer) AS blocked
                FROM pg_stat_activity WHERE application_name = ?', [$child[2], $parent, $child[2]]);
            if ($row && $row->blocked && $row->wait_event_type === 'Lock' && ($waitEvent === null || $row->wait_event === $waitEvent)) {
                $this->assertTrue((bool) $row->blocked);

                return;
            }
            if (! proc_get_status($child[0])['running']) break;
            usleep(10000);
        } while (microtime(true) < $deadline);
        $this->fail('The child never demonstrably waited on the parent lock; concurrency was not established.');
    }

    protected function finishRequest(array $child): array
    {
        [$process, $pipes] = $child;
        $deadline = microtime(true) + 18;
        $out = '';
        $err = '';
        do {
            $out .= stream_get_contents($pipes[1]);
            $err .= stream_get_contents($pipes[2]);
            if (! proc_get_status($process)['running']) break;
            usleep(10000);
        } while (microtime(true) < $deadline);
        $this->assertFalse(proc_get_status($process)['running'], 'Child did not finish within its bounded timeout.');
        $out .= stream_get_contents($pipes[1]);
        $err .= stream_get_contents($pipes[2]);
        $result = json_decode($out, true);
        // Do not print stderr or provider/configuration material if bootstrap failed.
        $this->assertIsArray($result, 'Child returned no JSON result; inspect its local runtime separately.');
        $this->assertSame('', $err, 'Child emitted stderr; inspect its local runtime separately.');
        $this->assertArrayHasKey('status', $result);

        return $result;
    }

    protected function releaseTwoBehind(callable $lock, array $specs): array
    {
        DB::beginTransaction();
        $lock();
        $children = array_map(fn ($spec) => $this->launchRequest($spec), $specs);
        foreach ($children as $child) $this->awaitParentBlock($child);
        DB::commit();

        return array_map(fn ($child) => $this->finishRequest($child), $children);
    }
}

class OpsQa03AdmissionRaceTest extends TestCase
{
    use SchedulingFixture, OpsQa03SeparateConnectionHarness;

    protected function setUp(): void
    {
        parent::setUp();
        $this->prepareScratchWorld();
    }

    protected function tearDown(): void
    {
        try {
            $this->cleanScratchWorld();
        } finally {
            parent::tearDown();
        }
    }

    private function appointment(): Appointment
    {
        return $this->existing('A', 'd1', 'b1', 'svc1', ClinicClock::today(), '11:00');
    }

    private function admissionSpec(Appointment $appointment, int $revision = 1, string $who = 'staffB1', string $key = 'admit'): array
    {
        return $this->requestSpec($who, '/api/visits/check-in', ['appointment_id' => $appointment->public_id, 'expected_revision' => $revision], $key);
    }

    private function admissionAfter(Appointment $appointment, array $spec, callable $writer): array
    {
        DB::beginTransaction();
        $locked = Appointment::whereKey($appointment->id)->lockForUpdate()->firstOrFail();
        $child = $this->launchRequest($spec);
        $this->awaitParentBlock($child);
        $writer($locked);
        DB::commit();

        return $this->finishRequest($child);
    }

    public function test_admission_reads_a_newly_committed_hold_instead_of_its_earlier_unpaid_snapshot(): void
    {
        $appointment = $this->appointment();
        $result = $this->admissionAfter($appointment, $this->admissionSpec($appointment),
            fn ($locked) => $locked->update(['booking_payment_status' => 'held']));
        // Models checkout's existing held write without a revision increment. No provider API is called.
        $this->assertSame([422, 'booking_payment_pending'], [$result['status'], $result['body']['code']]);
        $this->assertSame(['Confirmed', 1, 'held'], [$appointment->fresh()->status, $appointment->fresh()->revision, $appointment->fresh()->booking_payment_status]);
        $this->assertNoAdmission();
    }

    public function test_payment_confirmation_race_rejects_the_old_revision_then_allows_a_fresh_retry(): void
    {
        $appointment = $this->appointment();
        $appointment->update(['status' => 'Pending', 'booking_payment_status' => 'held']);
        $result = $this->admissionAfter($appointment, $this->admissionSpec($appointment),
            fn ($locked) => $locked->update(['status' => 'Confirmed', 'booking_payment_status' => 'paid', 'revision' => 2]));
        // A fixture for the locked provider settlement state, not a claim of provider integration coverage.
        $this->assertSame([409, 'stale_revision'], [$result['status'], $result['body']['code']]);
        $this->assertNoAdmission();
        $spec = $this->admissionSpec($appointment, 2);
        $this->assertSame(201, $this->finishRequest($this->launchRequest($spec))['status']);
        $replay = $this->finishRequest($this->launchRequest($spec));
        $this->assertSame([201, 'true'], [$replay['status'], $replay['replayed']]);
        $this->assertSame(1, Visit::count());
        $this->assertSame(1, DB::table('queue_entries')->count());
    }

    public function test_expiry_committing_before_admission_leaves_no_partial_visit_or_queue(): void
    {
        $appointment = $this->appointment();
        $appointment->update(['status' => 'Pending', 'booking_payment_status' => 'held', 'booking_hold_expires_at' => ClinicClock::now()->subMinute()]);
        $result = $this->admissionAfter($appointment, $this->admissionSpec($appointment), function () {
            $this->assertSame(1, app(AppointmentService::class)->releaseExpiredHolds());
        });
        $this->assertSame([409, 'stale_revision'], [$result['status'], $result['body']['code']]);
        $this->assertSame('Cancelled', $appointment->fresh()->status);
        $this->assertSame(1, DB::table('appointment_history')->where('event', 'appointment.hold_expired')->count());
        $this->assertNoAdmission();
    }

    public function test_two_blocked_admissions_of_a_pay_at_clinic_booking_create_one_encounter(): void
    {
        $appointment = $this->appointment();
        $results = $this->releaseTwoBehind(fn () => Appointment::whereKey($appointment->id)->lockForUpdate()->firstOrFail(), [
            $this->admissionSpec($appointment), $this->admissionSpec($appointment, 1, 'staffBoth', 'admit-other'),
        ]);
        $statuses = array_column($results, 'status');
        sort($statuses);
        $this->assertSame([201, 409], $statuses);
        $loser = collect($results)->firstWhere('status', 409);
        $this->assertSame('visit_exists', $loser['body']['code']);
        $this->assertSame('unpaid', $appointment->fresh()->booking_payment_status);
        $this->assertSame(1, Visit::where('appointment_id', $appointment->id)->count());
        $this->assertSame(1, DB::table('queue_entries')->count());
        $this->assertSame(1, DB::table('visit_history')->where('event', 'visit.checked_in')->count());
        $this->assertSame(1, DB::table('queue_entry_history')->where('event', 'queue.entered')->count());
        $this->assertSame(1, DB::table('appointment_history')->where('event', 'appointment.checked_in')->count());
    }

    public function test_out_of_branch_staff_are_refused_without_an_admission(): void
    {
        $appointment = $this->appointment();
        foreach (['staffB2', 'staffNone', 'dentist1', 'patientA'] as $who) {
            $result = $this->finishRequest($this->launchRequest($this->admissionSpec($appointment, 1, $who, 'forbidden-'.$who)));
            $this->assertSame(403, $result['status']);
        }
        $this->assertNoAdmission();
    }

    private function called(): Visit
    {
        $appointment = $this->appointment();
        $this->actingAsUser('staffB1');
        $this->postJson('/api/visits/check-in', ['appointment_id' => $appointment->public_id, 'expected_revision' => 1], ['Idempotency-Key' => 'fixture-admit'])->assertCreated();
        $visit = Visit::where('appointment_id', $appointment->id)->sole();
        $entry = $visit->queueEntry;
        $this->postJson("/api/queue/{$entry->public_id}/call", ['expected_revision' => 1], ['Idempotency-Key' => 'fixture-call'])->assertOk();

        return $visit->fresh();
    }

    private function documented(): Treatment
    {
        $visit = $this->called();
        $this->actingAsUser('dentist1');
        $this->postJson("/api/visits/{$visit->public_id}/treatment", ['expected_revision' => 1], ['Idempotency-Key' => 'fixture-start'])->assertCreated();
        $treatment = Treatment::sole();
        $this->postJson("/api/treatments/{$treatment->public_id}/document", ['expected_revision' => 1, 'procedure_summary' => 'Synthetic procedure',
            'prescription_required' => false, 'followup_required' => true, 'followup_reason' => 'Synthetic review',
            'procedures' => [['service_ref' => 'svc1', 'quantity' => 1]]], ['Idempotency-Key' => 'fixture-doc'])->assertOk();

        return $treatment->fresh();
    }

    public function test_two_blocked_starts_for_one_visit_create_one_treatment_history_and_audit(): void
    {
        $visit = $this->called();
        $path = "/api/visits/{$visit->public_id}/treatment";
        $results = $this->releaseTwoBehind(fn () => Appointment::whereKey($visit->appointment_id)->lockForUpdate()->firstOrFail(), [
            $this->requestSpec('dentist1', $path, ['expected_revision' => 1], 'start-a'),
            $this->requestSpec('dentist1', $path, ['expected_revision' => 1], 'start-b'),
        ]);
        $statuses = array_column($results, 'status');
        sort($statuses);
        $this->assertSame([201, 409], $statuses);
        $this->assertSame('treatment_exists', collect($results)->firstWhere('status', 409)['body']['code']);
        $this->assertSame(1, Treatment::count());
        $this->assertSame(1, TreatmentHistory::where('event', 'treatment.started')->count());
        $this->assertSame(1, AuditLog::where('action', 'treatment.started')->count());
        $this->assertSame('Served', $visit->queueEntry->fresh()->status);
    }

    public function test_competing_ready_and_away_transitions_use_the_current_revision(): void
    {
        $visit = $this->called();
        $entry = $visit->queueEntry;
        $results = $this->releaseTwoBehind(fn () => Visit::whereKey($visit->id)->lockForUpdate()->firstOrFail(), [
            $this->requestSpec('staffB1', "/api/queue/{$entry->public_id}/ready", ['expected_revision' => 2], 'ready'),
            $this->requestSpec('staffBoth', "/api/queue/{$entry->public_id}/away", ['expected_revision' => 2], 'away'),
        ]);
        $statuses = array_column($results, 'status');
        sort($statuses);
        $this->assertSame([200, 409], $statuses);
        $this->assertSame('stale_revision', collect($results)->firstWhere('status', 409)['body']['code']);
        $this->assertSame(3, $entry->fresh()->revision);
        $this->assertSame(1, DB::table('queue_entry_history')->where('queue_entry_id', $entry->id)->whereIn('event', ['queue.ready', 'queue.away'])->count());
    }

    public function test_duplicate_completions_append_one_completion_and_one_followup(): void
    {
        $treatment = $this->documented();
        $path = "/api/treatments/{$treatment->public_id}/complete";
        $results = $this->releaseTwoBehind(fn () => Appointment::whereKey($treatment->visit->appointment_id)->lockForUpdate()->firstOrFail(), [
            $this->requestSpec('dentist1', $path, ['expected_revision' => 2], 'complete-a'),
            $this->requestSpec('dentist1', $path, ['expected_revision' => 2], 'complete-b'),
        ]);
        $this->assertSame([200, 200], array_column($results, 'status'));
        $this->assertSame(3, $treatment->fresh()->revision);
        $this->assertSame(1, TreatmentHistory::where('event', 'treatment.completed')->count());
        $this->assertSame(1, AuditLog::where('action', 'treatment.completed')->count());
        $this->assertSame(1, FollowupTask::where('treatment_id', $treatment->id)->count());
    }

    public function test_documentation_and_completion_serialize_and_only_one_can_use_a_revision(): void
    {
        $treatment = $this->documented();
        $line = $treatment->procedures->sole();
        $results = $this->releaseTwoBehind(fn () => Appointment::whereKey($treatment->visit->appointment_id)->lockForUpdate()->firstOrFail(), [
            $this->requestSpec('dentist1', "/api/treatments/{$treatment->public_id}/document", ['expected_revision' => 2,
                'procedure_summary' => 'Changed synthetic procedure', 'prescription_required' => false, 'followup_required' => true,
                'followup_reason' => 'Synthetic review', 'procedures' => [['id' => $line->public_id, 'service_ref' => 'svc1', 'quantity' => 2]]], 'doc-race'),
            $this->requestSpec('dentist1', "/api/treatments/{$treatment->public_id}/complete", ['expected_revision' => 2], 'complete-race'),
        ]);
        $statuses = array_column($results, 'status');
        sort($statuses);
        $this->assertSame([200, 409], $statuses);
        $fresh = $treatment->fresh();
        $this->assertSame(3, $fresh->revision);
        $this->assertSame($fresh->status, $fresh->visit->status);
        $this->assertSame($fresh->status, $fresh->visit->appointment->status);
        $completed = $fresh->status === 'Completed';
        $this->assertSame($completed ? 1 : 2, $line->fresh()->quantity);
        $this->assertSame($completed ? 1 : 0, FollowupTask::where('treatment_id', $treatment->id)->count());
        $this->assertSame(3, TreatmentHistory::where('treatment_id', $treatment->id)->max('revision'));
    }

    private function assertNoAdmission(): void
    {
        foreach (['visits', 'visit_history', 'queue_entries', 'queue_entry_history', 'command_keys'] as $table) {
            $this->assertSame(0, DB::table($table)->count(), $table);
        }
        $this->assertSame(0, DB::table('appointment_history')->where('event', 'appointment.checked_in')->count());
    }
}

<?php

namespace Tests\Feature\Prescriptions;

use App\Models\AuditLog;
use App\Models\CommandKey;
use App\Models\Prescription;
use App\Models\User;
use App\Models\Visit;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Symfony\Component\Process\Process;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Explicit new verified clone only; committed fixtures, no migrations/resets/cleanup. */
class PrescriptionContentionTest extends TestCase
{
    use SchedulingFixture;

    protected function setUp(): void
    {
        if (getenv('PRESCRIPTION_DISPOSABLE_POSTGRES_ACCEPTANCE') !== '1') {
            self::markTestSkipped('Use prescription-concurrency on a fresh clone.');
        }
        parent::setUp();
        self::assertSame(0, DB::transactionLevel());
        foreach (['users', 'branches', 'prescriptions'] as $table) {
            self::assertSame(0, DB::table($table)->count(), 'Fresh empty clone only.');
        }
        $this->setUpSchedulingWorld();
        Mail::fake();
        Http::preventStrayRequests();
    }

    private function visit(): Visit
    {
        return Visit::create(['patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id, 'source' => 'walk_in', 'status' => 'Checked In', 'responsible_dentist_profile_id' => $this->d['d1']->id, 'requested_service_id' => $this->svc['svc1']->id, 'arrived_at' => now(), 'clinic_date' => '2026-09-28', 'revision' => 1, 'created_by_user_id' => $this->u['staffB1']->id, 'updated_by_user_id' => $this->u['staffB1']->id]);
    }

    public function test_parallel_prescription_commands_preserve_revision_numbers_replay_and_revocation_boundaries(): void
    {
        $token = $this->u['dentist1']->createToken('synthetic-rx-races')->plainTextToken;
        foreach (['create_same', 'save_same', 'save_different', 'issue_same', 'issue_different', 'void_same', 'void_conflicting', 'issue_stale', 'branch_revoked', 'account_revoked'] as $index => $scenario) {
            // Independent race scenarios have independent synthetic minutes. Keep the real 30/minute throttle active.
            $this->travelTo(\Carbon\CarbonImmutable::parse('2026-09-28T10:00:00+08:00')->addMinutes($index));
            $this->actingAsUser('dentist1');
            $v = $index === 0 ? $this->visit() : $v;
            $create = ['visit_id' => $v->public_id, 'lines' => [['medicine' => 'Synthetic medicine '.$index]]];
            $p = null;
            if ($scenario !== 'create_same') {
                $id = $this->postJson('/api/prescriptions', $create)->assertCreated()->json('data.id');
                $p = Prescription::where('public_id', $id)->sole();
                if (str_starts_with($scenario, 'void')) {
                    $this->postJson('/api/prescriptions/'.$id.'/issue', ['expected_revision' => 1])->assertOk();
                }
                if ($scenario === 'issue_stale') {
                    $this->putJson('/api/prescriptions/'.$id, ['expected_revision' => 1, 'lines' => [['medicine' => 'Synthetic updated']]])->assertOk();
                }
            }
            $method = str_starts_with($scenario, 'save') ? 'PUT' : 'POST';
            $path = $scenario === 'create_same' ? '/api/prescriptions' : '/api/prescriptions/'.$p->public_id.(str_starts_with($scenario, 'save') ? '' : (str_starts_with($scenario, 'void') ? '/void' : '/issue'));
            $body = $scenario === 'create_same' ? $create : (str_starts_with($scenario, 'save') ? ['expected_revision' => 1, 'lines' => [['medicine' => 'Synthetic accepted save']]] : (str_starts_with($scenario, 'void') ? ['expected_revision' => 2, 'reason' => 'Synthetic void A'] : ['expected_revision' => 1]));
            $beforeRx = Prescription::count();
            $beforeCounter = (int) (DB::table('prescription_counters')->where('year', 2026)->value('last_number') ?? 0);
            $workers = [];
            $names = [];
            DB::beginTransaction();
            try {
                if ($scenario === 'create_same' || str_ends_with($scenario, 'revoked')) {
                    User::whereKey($this->u['dentist1']->id)->lockForUpdate()->firstOrFail();
                } else {
                    Prescription::whereKey($p->id)->lockForUpdate()->firstOrFail();
                }
                foreach ([0, 1] as $n) {
                    $name = 'rx_'.getmypid().'_'.$index.'_'.$n;
                    $names[] = $name;
                    $payload = $body;
                    if ($scenario === 'void_conflicting' && $n === 1) {
                        $payload['reason'] = 'Synthetic void B';
                    }
                    $same = in_array($scenario, ['create_same', 'save_same', 'issue_same', 'void_same', 'void_conflicting'], true);
                    $proc = new Process([PHP_BINARY, base_path('tests/Support/prescription_worker.php')], base_path(), getenv(), json_encode(['worker' => $name, 'token' => $token, 'path' => $path, 'method' => $method, 'body' => $payload, 'key' => 'rx-race-'.$index.'-'.($same ? 0 : $n), 'test_time' => now()->toIso8601String()]), 30);
                    $proc->start();
                    $workers[] = $proc;
                }
                $deadline = microtime(true) + 10;
                do {
                    DB::selectOne('select pg_stat_clear_snapshot()');
                    $waiting = (int) DB::selectOne("select count(*) as n from pg_stat_activity where application_name in (?,?) and wait_event_type='Lock'", $names)->n;
                    if ($waiting === 2) {
                        break;
                    }foreach ($workers as $w) {
                        // Report only scenario/status; never echo the secret-bearing worker input or a full trace.
                        $early = json_decode($w->getOutput(), true);
                        self::assertTrue($w->isRunning(), 'Worker exited before real contention: '.$scenario.' HTTP '.($early['status'] ?? 'no response').' exit '.($w->getExitCode() ?? 'running'));
                    }usleep(10000);
                } while (microtime(true) < $deadline);
                self::assertSame(2, $waiting, 'Both independent requests must wait on actual PostgreSQL locks.');
                if ($scenario === 'branch_revoked') {
                    $this->d['d1']->branches()->detach($this->b['b1']->id);
                }
                if ($scenario === 'account_revoked') {
                    $this->u['dentist1']->update(['account_status' => 'Inactive']);
                }
                DB::commit();
                $results = [];
                foreach ($workers as $w) {
                    self::assertSame(0, $w->wait());
                    $results[] = json_decode($w->getOutput(), true, flags: JSON_THROW_ON_ERROR);
                }
            } finally {
                if (DB::transactionLevel()) {
                    DB::rollBack();
                }foreach ($workers as $w) {
                    if ($w->isRunning()) {
                        $w->stop();
                    }
                }
            }
            $statuses = array_column($results, 'status');
            sort($statuses);
            $expected = match ($scenario) {
                'create_same' => [201, 201],'save_same','issue_same','void_same' => [200, 200],'save_different','issue_different','void_conflicting' => [200, 422],'issue_stale' => [422, 422],default => [403, 403]
            };
            self::assertSame($expected, $statuses, $scenario);
            if (in_array($scenario, ['create_same', 'save_same', 'issue_same', 'void_same'], true)) {
                self::assertSame($results[0]['body'], $results[1]['body']);
            }
            self::assertSame($beforeRx + ($scenario === 'create_same' ? 1 : 0), Prescription::count());
            $afterCounter = (int) (DB::table('prescription_counters')->where('year', 2026)->value('last_number') ?? 0);
            self::assertSame($beforeCounter + (in_array($scenario, ['issue_same', 'issue_different'], true) ? 1 : 0), $afterCounter);
            if ($p) {
                $current = $p->fresh();
                if (str_starts_with($scenario, 'void')) {
                    self::assertSame('Void', $current->status);
                    self::assertSame(3, $current->revision);
                    self::assertSame(1, AuditLog::where('action', 'prescription.voided')->where('payload->prescription', $p->public_id)->count());
                } elseif (str_starts_with($scenario, 'save')) {
                    self::assertSame(2, $current->revision);
                } elseif (in_array($scenario, ['issue_same', 'issue_different'])) {
                    self::assertSame('Issued', $current->status);
                    self::assertSame(1, AuditLog::where('action', 'prescription.issued')->where('payload->prescription', $p->public_id)->count());
                } else {
                    self::assertSame('Draft', $current->status);
                    self::assertNull($current->number);
                }
            }
            if (str_ends_with($scenario, 'revoked')) {
                self::assertSame(0, CommandKey::where('idempotency_key','like','rx-race-'.$index.'-%')->count());
            }
            if ($scenario === 'branch_revoked') {
                $this->d['d1']->branches()->attach($this->b['b1']->id);
            }
        }
    }
}

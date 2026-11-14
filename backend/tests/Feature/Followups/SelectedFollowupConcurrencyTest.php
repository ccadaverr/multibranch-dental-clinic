<?php

namespace Tests\Feature\Followups;

use App\Models\Appointment;
use App\Models\AppointmentCommandKey;
use App\Models\FollowupTask;
use App\Support\ClinicClock;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Group;
use Symfony\Component\Process\Process;
use Symfony\Component\Process\InputStream;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** AUTHORED, NOT EXECUTED. Committed synthetic fixtures on EMPTY, approved disposable PostgreSQL only.
 * No automatic migrations, resets or cleanup. Do not run with the ordinary Feature suite: explicit opt-in,
 * scratch guard, empty-fixture checks and independently approved provisioning are all required.
 */
#[Group('aud10-postgres-concurrency')]
final class SelectedFollowupConcurrencyTest extends TestCase
{
    use SchedulingFixture;

    protected function setUp(): void
    {
        if (getenv('AUD10_DISPOSABLE_POSTGRES_ACCEPTANCE') !== '1') {
            self::markTestSkipped('Separate disposable PostgreSQL approval/provisioning is required.');
        }
        parent::setUp();
        self::assertSame(0, DB::transactionLevel(), 'Workers must see committed fixtures.');
        foreach (['branches', 'users', 'patients', 'appointments', 'followup_tasks'] as $table) {
            self::assertSame(0, DB::table($table)->count(), 'Use an empty disposable fixture database, never shared data.');
        }
        $this->setUpSchedulingWorld();
        $this->travelBack(); // Workers and parent use the same real Manila clock.
    }

    public function test_real_row_lock_contention_serializes_selected_bookings_replay_and_closure(): void
    {
        $token = $this->u['staffB1']->createToken('aud10-disposable-worker')->plainTextToken;
        foreach (['different_keys', 'same_key', 'closed_while_waiting', 'ordinary_competitor'] as $index => $scenario) {
            $task = FollowupTask::create(['patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id,
                'reason' => 'Synthetic contention task', 'source' => 'front_desk', 'status' => 'Open',
                'due_on' => ClinicClock::today(), 'revision' => 7]);
            $base = ['patient_id' => $this->p['A']->public_id, 'branch_ref' => 'b1', 'service_ref' => 'svc1', 'dentist_ref' => 'd1',
                'date' => ClinicClock::now()->addDays(7 + $index)->toDateString(), 'start_time' => '10:00',
                'followup_task_id' => $task->public_id, 'followup_expected_revision' => 7];
            $before = Appointment::count();
            $beforeKeys = AppointmentCommandKey::count();
            $workers = [];
            $names = [];
            DB::beginTransaction();
            try {
                FollowupTask::whereKey($task->id)->lockForUpdate()->firstOrFail();
                foreach ([0, 1] as $number) {
                    $name = 'aud10_'.getmypid().'_'.$index.'_'.$number;
                    $names[] = $name;
                    $payload = $base;
                    if ($number === 1 && $scenario !== 'same_key') $payload['start_time'] = '11:00';
                    if ($number === 1 && $scenario === 'ordinary_competitor') unset($payload['followup_task_id'], $payload['followup_expected_revision']);
                    $key = 'aud10-'.$scenario.'-'.($scenario === 'same_key' ? 0 : $number);
                    $process = new Process([PHP_BINARY, base_path('tests/Support/aud10_booking_worker.php')], base_path(),
                        ['APP_ENV' => 'testing', 'DB_CONNECTION' => 'pgsql', 'DB_DATABASE' => 'dental_clinic_scratch', 'DB_URL' => '',
                            'CACHE_STORE' => 'array', 'SESSION_DRIVER' => 'array', 'QUEUE_CONNECTION' => 'sync',
                            'MAIL_MAILER' => 'array', 'BROADCAST_CONNECTION' => 'null'],
                        json_encode(['worker' => $name, 'token' => $token, 'payload' => $payload, 'key' => $key], JSON_THROW_ON_ERROR), 30);
                    $process->start();
                    $workers[] = $process;
                }
                // Both independent connections must actually block on PostgreSQL locks before release.
                // Same-key contender may wait on the journal unique index while the first waits on the task.
                $deadline = microtime(true) + 10;
                do {
                    DB::selectOne('select pg_stat_clear_snapshot()');
                    $waiting = (int) DB::selectOne("select count(*) as n from pg_stat_activity where application_name in (?, ?) and wait_event_type = 'Lock'", $names)->n;
                    if ($waiting === 2) break;
                    foreach ($workers as $worker) self::assertTrue($worker->isRunning(), 'Worker exited before reaching real contention.');
                    usleep(10000);
                } while (microtime(true) < $deadline);
                self::assertSame(2, $waiting, 'Required PostgreSQL contention was not observed.');
                if ($scenario === 'closed_while_waiting') {
                    $task->update(['status' => 'Closed', 'close_note' => 'Synthetic closure', 'closed_at' => now(), 'revision' => 8]);
                }
                DB::commit();
                $results = [];
                foreach ($workers as $worker) {
                    self::assertSame(0, $worker->wait(), 'Worker did not complete normally.');
                    $results[] = json_decode($worker->getOutput(), true, flags: JSON_THROW_ON_ERROR);
                }
            } finally {
                if (DB::transactionLevel() > 0) DB::rollBack();
                foreach ($workers as $worker) if ($worker->isRunning()) $worker->stop();
            }

            $statuses = array_column($results, 'status');
            sort($statuses);
            if ($scenario === 'closed_while_waiting') {
                self::assertSame([409, 409], $statuses);
                self::assertSame($before, Appointment::count());
                self::assertSame($beforeKeys, AppointmentCommandKey::count());
                self::assertNull($task->fresh()->appointment_id);
                self::assertSame('Closed', $task->fresh()->status);
                self::assertSame(8, $task->fresh()->revision);
            } elseif ($scenario === 'same_key') {
                self::assertSame([201, 201], $statuses);
                self::assertSame($results[0]['body'], $results[1]['body']);
                self::assertSame($before + 1, Appointment::count());
                self::assertSame($beforeKeys + 1, AppointmentCommandKey::count());
                self::assertSame(8, $task->fresh()->revision);
            } elseif ($scenario === 'different_keys') {
                self::assertSame([201, 409], $statuses);
                self::assertSame($before + 1, Appointment::count());
                self::assertSame($beforeKeys + 1, AppointmentCommandKey::count());
                self::assertSame(8, $task->fresh()->revision);
            } else {
                // Ordinary booking may succeed without linking if the selected command wins the task first.
                self::assertSame(201, $results[1]['status']);
                self::assertContains($results[0]['status'], [201, 409]);
                self::assertSame(8, $task->fresh()->revision, 'Exactly one task transition, with no overwritten linkage.');
                $linked = $task->fresh()->appointment->public_id;
                $winner = $results[0]['status'] === 201 ? $results[0] : $results[1];
                self::assertSame($winner['body']['data']['id'], $linked);
            }
            if ($task->fresh()->status === 'Booked') {
                self::assertTrue(Appointment::whereKey($task->fresh()->appointment_id)->exists());
            }
        }
        $this->assertOverlappingOrdinaryAndSelectedBookingDoesNotRetry($token);
    }

    /** R2: forces the original task/exclusion opposing cycle; normal retries cannot manufacture a passing result. */
    private function assertOverlappingOrdinaryAndSelectedBookingDoesNotRetry(string $token): void
    {
        $task = FollowupTask::create(['patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id,
            'reason' => 'Synthetic opposing-cycle task', 'source' => 'front_desk', 'status' => 'Open',
            'due_on' => ClinicClock::today(), 'revision' => 7]);
        $base = ['patient_id' => $this->p['A']->public_id, 'branch_ref' => 'b1', 'service_ref' => 'svc1', 'dentist_ref' => 'd1',
            'date' => ClinicClock::now()->addDays(11)->toDateString(), 'start_time' => '10:00'];
        $before = Appointment::count();
        $beforeKeys = AppointmentCommandKey::count();
        $workers = [];
        $inputs = [];
        try {
            foreach (['selected', 'ordinary'] as $kind) {
                $payload = $base;
                if ($kind === 'selected') $payload += ['followup_task_id' => $task->public_id, 'followup_expected_revision' => 7];
                $input = new InputStream();
                $input->write(json_encode(['worker' => 'aud10_'.getmypid().'_overlap_'.$kind, 'token' => $token,
                    'payload' => $payload, 'key' => 'aud10-overlap-'.$kind,
                    'barrier' => $kind === 'selected' ? 'before_appointment_insert' : 'after_appointment_insert'], JSON_THROW_ON_ERROR)."\n");
                $process = new Process([PHP_BINARY, base_path('tests/Support/aud10_booking_worker.php')], base_path(),
                    ['APP_ENV' => 'testing', 'DB_CONNECTION' => 'pgsql', 'DB_DATABASE' => 'dental_clinic_scratch', 'DB_URL' => '',
                        'CACHE_STORE' => 'array', 'SESSION_DRIVER' => 'array', 'QUEUE_CONNECTION' => 'sync',
                        'MAIL_MAILER' => 'array', 'BROADCAST_CONNECTION' => 'null'], $input, 30);
                $workers[$kind] = $process;
                $inputs[$kind] = $input;
                $process->start();
                $seen = '';
                self::assertTrue($process->waitUntil(function ($type, $output) use (&$seen) {
                    if ($type === Process::ERR) $seen .= $output;
                    return str_contains($seen, 'AUD10_INSERT_BARRIER');
                }), 'Worker did not reach its required insert barrier.');
                // Selected is now before INSERT (and held T here in R1); ordinary has inserted A and owns its constraint.
            }

            $inputs['selected']->write("continue\n");
            $inputs['selected']->close();
            $deadline = microtime(true) + 10;
            $blocked = false;
            do {
                DB::selectOne('select pg_stat_clear_snapshot()');
                $activity = DB::selectOne('select wait_event_type, query from pg_stat_activity where application_name = ?',
                    ['aud10_'.getmypid().'_overlap_selected']);
                $blocked = $activity && $activity->wait_event_type === 'Lock'
                    && str_starts_with(strtolower(ltrim($activity->query)), 'insert into "appointments"');
                if ($blocked) break;
                self::assertTrue($workers['selected']->isRunning(), 'Selected worker exited before exclusion contention.');
                usleep(10000);
            } while (microtime(true) < $deadline);
            self::assertTrue($blocked, 'The selected INSERT must actually wait for the uncommitted ordinary appointment.');

            // R1 ordinary now waits for selected's T: a real cycle. R2 ordinary obtains T and commits without a cycle.
            $inputs['ordinary']->write("continue\n");
            $inputs['ordinary']->close();
            $results = [];
            // Waiting for ordinary first also pumps its streaming stdin release before selected can unblock.
            foreach (['ordinary', 'selected'] as $kind) {
                $worker = $workers[$kind];
                self::assertSame(0, $worker->wait(), 'Opposing-cycle worker did not finish normally.');
                $results[$kind] = json_decode($worker->getOutput(), true, flags: JSON_THROW_ON_ERROR);
            }
            self::assertSame(201, $results['ordinary']['status']);
            self::assertSame(409, $results['selected']['status']);
            self::assertSame('schedule_conflict', $results['selected']['body']['code']);
            foreach ($results as $result) {
                self::assertSame(1, $result['probe']['command_attempts'], 'Booking-command retries must not hide the original opposing cycle.');
            }
            self::assertSame($before + 1, Appointment::count());
            self::assertSame($beforeKeys + 1, AppointmentCommandKey::count());
            self::assertSame('Booked', $task->fresh()->status);
            self::assertSame(8, $task->fresh()->revision);
            self::assertSame($results['ordinary']['body']['data']['id'], $task->fresh()->appointment->public_id);
            self::assertFalse(AppointmentCommandKey::where('user_id', $this->u['staffB1']->id)->where('idempotency_key', 'aud10-overlap-selected')->exists());
        } finally {
            foreach ($inputs as $input) $input->close();
            foreach ($workers as $worker) if ($worker->isRunning()) $worker->stop();
        }
    }
}

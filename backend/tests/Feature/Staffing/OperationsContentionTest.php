<?php

namespace Tests\Feature\Staffing;

use App\Models\AuditLog;
use App\Models\StaffProfile;
use App\Models\User;
use App\Models\UserNotification;
use App\Services\Notifications\NotificationCenter;
use App\Services\Scheduling\StaffShiftRevision;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Committed independent connections. No resets, migrations or cleanup; fresh clone only. */
class OperationsContentionTest extends TestCase
{
    use SchedulingFixture;

    protected function setUp(): void
    {
        if (getenv('OPERATIONS_DISPOSABLE_POSTGRES_ACCEPTANCE') !== '1') self::markTestSkipped('Use operations-contention on a fresh Operations clone.');
        parent::setUp();
        self::assertSame(0, DB::transactionLevel());
        foreach (['users', 'staff_profiles', 'notification_archives'] as $table) self::assertSame(0, DB::table($table)->count(), 'Fresh empty clone only.');
        $this->setUpSchedulingWorld();
    }

    public function test_branch_access_rechecks_actor_and_target_after_real_lock_waits(): void
    {
        $target = $this->u['staffB1'];
        $before = DB::table('user_branch_scopes')->where('user_id', $target->id)->orderBy('id')->get()->toJson();
        foreach (['inactive', 'auth_version', 'target_role'] as $index => $scenario) {
            $actor = $this->u['owner']->fresh();
            $token = $actor->createToken('synthetic-branch-authority')->plainTextToken;
            $auditBefore = AuditLog::where('action', 'account.branch_scopes_changed')->count();
            $workers = $names = [];
            DB::beginTransaction();
            try {
                User::whereKey($actor->id)->lockForUpdate()->firstOrFail();
                User::whereKey($target->id)->lockForUpdate()->firstOrFail();
                foreach ([0, 1] as $n) {
                    $name = 'ops_scope_'.getmypid().'_'.$index.'_'.$n;
                    $names[] = $name;
                    $worker = new Process([PHP_BINARY, base_path('tests/Support/operations_worker.php')], base_path(), getenv(), json_encode([
                        'worker' => $name, 'token' => $token, 'path' => '/api/users/'.$target->public_id.'/branch-scopes',
                        'method' => 'PUT', 'body' => ['branch_refs' => ['b2']],
                    ]), 30);
                    $worker->start(); $workers[] = $worker;
                }
                $deadline = microtime(true) + 10;
                do {
                    DB::selectOne('select pg_stat_clear_snapshot()');
                    $waiting = (int) DB::selectOne("select count(*) as n from pg_stat_activity where application_name in (?,?) and wait_event_type='Lock'", $names)->n;
                    if ($waiting === 2) break;
                    foreach ($workers as $worker) self::assertTrue($worker->isRunning(), 'Both requests must reach a real database lock.');
                    usleep(10000);
                } while (microtime(true) < $deadline);
                self::assertSame(2, $waiting, $scenario);
                if ($scenario === 'target_role') User::whereKey($target->id)->update(['role' => 'owner']);
                elseif ($scenario === 'inactive') User::whereKey($actor->id)->update(['account_status' => 'Inactive']);
                else User::whereKey($actor->id)->increment('auth_version');
                DB::commit();
                foreach ($workers as $worker) {
                    self::assertSame(0, $worker->wait());
                    self::assertSame($scenario === 'target_role' ? 422 : 403, json_decode($worker->getOutput(), true, flags: JSON_THROW_ON_ERROR)['status'], $scenario);
                }
            } finally {
                if (DB::transactionLevel()) DB::rollBack();
                foreach ($workers as $worker) if ($worker->isRunning()) $worker->stop();
            }
            self::assertSame($before, DB::table('user_branch_scopes')->where('user_id', $target->id)->orderBy('id')->get()->toJson());
            self::assertSame($auditBefore, AuditLog::where('action', 'account.branch_scopes_changed')->count());
            User::whereKey($actor->id)->update(['account_status' => 'Active']);
            User::whereKey($target->id)->update(['role' => 'staff']);
        }
        $this->actingAs($this->u['owner']->fresh());
        $this->putJson('/api/users/'.$target->public_id.'/branch-scopes', ['branch_refs' => ['b2']])->assertOk()
            ->assertJsonPath('data.user.id', $target->public_id)->assertJsonPath('data.branch_scopes.0.id', 'b2')->assertJsonCount(1, 'data.branch_scopes');
        self::assertSame([$this->b['b2']->id], DB::table('user_branch_scopes')->where('user_id', $target->id)->pluck('branch_id')->all());
        $audit = AuditLog::where('action', 'account.branch_scopes_changed')->sole();
        self::assertSame($target->public_id, $audit->auditable_public_id);
        self::assertSame($this->u['owner']->id, $audit->actor_user_id);
    }

    public function test_real_locks_preserve_replay_stale_refusal_archive_read_and_revocation(): void
    {
        $profile = StaffProfile::create(['legacy_ref' => 'ops-contention', 'person_id' => $this->u['staffB1']->person_id,
            'branch_id' => $this->b['b1']->id, 'title' => 'Synthetic Staff', 'shift_start' => '09:00', 'shift_end' => '17:00', 'available' => true]);
        $ownerToken = $this->u['owner']->createToken('synthetic-ops-contention')->plainTextToken;
        $staffToken = $this->u['staffB1']->createToken('synthetic-ops-contention')->plainTextToken;
        foreach (['staff_same', 'staff_stale', 'staff_conflicting', 'archive_same', 'read_archive', 'owner_revoked'] as $index => $scenario) {
            $archive = in_array($scenario, ['archive_same', 'read_archive'], true);
            $body = ['shift_start' => '10:00', 'shift_end' => '18:00', 'expected_revision' => StaffShiftRevision::for($profile->fresh()), 'operation_id' => (string) Str::uuid()];
            $note = null;
            if ($archive) {
                app(NotificationCenter::class)->staffNotice($this->u['staffB1'], 'record_shared', 'Synthetic contention notice', null, 'leave', null, 'ops-race-'.$index);
                $note = UserNotification::where('user_id', $this->u['staffB1']->id)->latest('id')->firstOrFail();
            }
            $auditBefore = AuditLog::where('action', $archive ? 'notification.archived' : 'staff_profile.updated')->count();
            $workers = $names = [];
            DB::beginTransaction();
            try {
                $archive ? UserNotification::whereKey($note->id)->lockForUpdate()->firstOrFail() : User::whereKey($this->u['owner']->id)->lockForUpdate()->firstOrFail();
                foreach ([0, 1] as $n) {
                    $payload = $body;
                    if ($scenario === 'staff_stale' && $n === 1) $payload['operation_id'] = (string) Str::uuid();
                    if ($scenario === 'staff_conflicting' && $n === 1) $payload['shift_end'] = '19:00';
                    $path = $archive ? '/api/notifications/'.$note->public_id.'/'.($scenario === 'read_archive' && $n === 0 ? 'read' : 'archive') : '/api/staff/ops-contention';
                    $name = 'ops_'.getmypid().'_'.$index.'_'.$n;
                    $names[] = $name;
                    $worker = new Process([PHP_BINARY, base_path('tests/Support/operations_worker.php')], base_path(), getenv(), json_encode([
                        'worker' => $name, 'token' => $archive ? $staffToken : $ownerToken, 'path' => $path, 'method' => $archive ? 'POST' : 'PATCH', 'body' => $archive ? [] : $payload,
                    ]), 30);
                    $worker->start();
                    $workers[] = $worker;
                }
                $deadline = microtime(true) + 10;
                do {
                    DB::selectOne('select pg_stat_clear_snapshot()');
                    $waiting = (int) DB::selectOne("select count(*) as n from pg_stat_activity where application_name in (?,?) and wait_event_type='Lock'", $names)->n;
                    if ($waiting === 2) break;
                    foreach ($workers as $worker) self::assertTrue($worker->isRunning(), 'Worker exited before actual lock contention.');
                    usleep(10000);
                } while (microtime(true) < $deadline);
                self::assertSame(2, $waiting, 'Two independent requests must actually wait on PostgreSQL locks.');
                if ($scenario === 'owner_revoked') $this->u['owner']->update(['account_status' => 'Inactive']);
                DB::commit();
                $results = [];
                foreach ($workers as $worker) {
                    self::assertSame(0, $worker->wait(), 'Worker must return a structured result.');
                    $results[] = json_decode($worker->getOutput(), true, flags: JSON_THROW_ON_ERROR);
                }
            } finally {
                if (DB::transactionLevel()) DB::rollBack();
                foreach ($workers as $worker) if ($worker->isRunning()) $worker->stop();
            }
            $statuses = array_column($results, 'status'); sort($statuses);
            self::assertSame(match ($scenario) { 'staff_stale', 'staff_conflicting' => [200,409], 'owner_revoked' => [403,403], default => [200,200] }, $statuses, $scenario);
            self::assertSame($auditBefore + ($scenario === 'owner_revoked' ? 0 : 1), AuditLog::where('action', $archive ? 'notification.archived' : 'staff_profile.updated')->count(), $scenario);
            if ($scenario === 'staff_same') {
                $left = $results[0]['body']['data']; $right = $results[1]['body']['data'];
                ksort($left); ksort($right); // JSONB object key order is not an HTTP receipt field.
                self::assertSame($left, $right);
            }
            if ($archive) {
                self::assertSame(1, DB::table('notification_archives')->where('notification_id', $note->id)->count());
                if ($scenario === 'read_archive') self::assertNotNull($note->fresh()->read_at);
            }
        }
    }
}

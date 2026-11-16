<?php

namespace Tests\Feature\Reference;

use App\Enums\Role;
use App\Models\{AuditLog, Branch, User};
use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Committed fixtures: run only on a fresh guarded clone, never the regular test profile. */
class BranchCodeContentionTest extends TestCase
{
    use SchedulingFixture;

    protected function setUp(): void
    {
        $manifest = getenv('DENTALOPS_LOCAL_TARGET');
        if (! $manifest || ! str_starts_with(basename(json_decode(file_get_contents($manifest), true)['runtime']), 'contention-')) {
            self::markTestSkipped('Use a fresh owned contention clone.');
        }
        parent::setUp();
        self::assertSame(0, DB::table('users')->count(), 'Fresh clone only');
        $this->setUpSchedulingWorld();
    }

    public function test_competing_branch_codes_return_one_receipt_and_one_recoverable_validation_refusal(): void
    {
        $original = array_map(fn ($branch) => $branch->branch_code, $this->b);
        $auditBefore = AuditLog::where('action', 'branch.updated')->count();
        $token = $this->u['owner']->createToken('synthetic-branch-code-race')->plainTextToken;
        $workers = [];
        DB::beginTransaction();
        try {
            Branch::whereIn('id', [$this->b['b1']->id, $this->b['b2']->id])->orderBy('id')->lockForUpdate()->get();
            foreach (['b1', 'b2'] as $index => $reference) {
                $name = 'branch_code_a_'.getmypid().'_'.$index;
                $worker = new Process([PHP_BINARY, base_path('tests/Support/branch_code_worker.php')], base_path(), getenv(),
                    json_encode(['worker' => $name, 'token' => $token, 'branch' => $reference], JSON_THROW_ON_ERROR), 30);
                $worker->start();
                $workers[$reference] = [$name, $worker];
            }
            $deadline = microtime(true) + 12;
            do {
                DB::selectOne('select pg_stat_clear_snapshot()');
                $waiting = (int) DB::selectOne("select count(*) as n from pg_stat_activity where application_name in (?, ?) and wait_event_type='Lock'",
                    array_column(array_values($workers), 0))->n;
                if ($waiting === 2) {
                    break;
                }
                foreach ($workers as [, $worker]) {
                    self::assertTrue($worker->isRunning(), 'Request must remain active before releasing branch locks');
                }
                usleep(10000);
            } while (microtime(true) < $deadline);
            self::assertSame(2, $waiting, 'Both real API requests passed validation and reached PostgreSQL lock waits');
            DB::commit();
            $results = [];
            foreach ($workers as $reference => [, $worker]) {
                self::assertSame(0, $worker->wait());
                $results[$reference] = json_decode($worker->getOutput(), true, flags: JSON_THROW_ON_ERROR);
            }
        } finally {
            if (DB::transactionLevel()) {
                DB::rollBack();
            }
            foreach ($workers as [, $worker]) {
                if ($worker->isRunning()) {
                    $worker->stop();
                }
            }
        }

        $statuses = array_column($results, 'status');
        sort($statuses);
        self::assertSame([200, 422], $statuses);
        self::assertSame(1, Branch::where('branch_code', 'BRC-C')->count());
        self::assertSame($auditBefore + 1, AuditLog::where('action', 'branch.updated')->count());
        foreach ($results as $reference => $result) {
            if ($result['status'] === 200) {
                self::assertSame($reference, $result['body']['data']['id']);
                self::assertSame('BRC-C', $result['body']['data']['branch_code']);
                continue;
            }
            self::assertArrayHasKey('branch_code', $result['body']['errors']);
            self::assertSame($original[$reference], $this->b[$reference]->fresh()->branch_code);
            $this->actingAsUser('owner');
            $this->patchJson('/api/branches/'.$reference, ['branch_code' => 'BRC-D'])->assertOk()
                ->assertJsonPath('data.id', $reference)->assertJsonPath('data.branch_code', 'BRC-D');
            $this->getJson('/api/branches')->assertOk();
            self::assertSame('BRC-D', $this->b[$reference]->fresh()->branch_code);
        }
        self::assertSame($auditBefore + 2, AuditLog::where('action', 'branch.updated')->count());
        $this->assertCurrentOwnerAfterLockWait();
    }

    private function assertCurrentOwnerAfterLockWait(): void
    {
        foreach (['inactive', 'role', 'auth_version'] as $index => $scenario) {
            $this->u['owner']->forceFill(['role' => Role::Owner, 'account_status' => 'Active'])->save();
            $token = $this->u['owner']->createToken('synthetic-branch-authority')->plainTextToken;
            $before = $this->b['b1']->fresh()->getAttributes();
            $audit = AuditLog::where('action', 'branch.updated')->count();
            $worker = null;
            DB::beginTransaction();
            try {
                User::whereKey($this->u['owner']->id)->lockForUpdate()->first();
                Branch::whereKey($this->b['b1']->id)->lockForUpdate()->first();
                $name = 'branch_code_a_'.getmypid().'_'.($index + 2);
                $worker = new Process([PHP_BINARY, base_path('tests/Support/branch_code_worker.php')], base_path(), getenv(),
                    json_encode(['worker' => $name, 'token' => $token, 'branch' => 'b1', 'mode' => 'authority'], JSON_THROW_ON_ERROR), 30);
                $worker->start();
                $deadline = microtime(true) + 12;
                do {
                    DB::selectOne('select pg_stat_clear_snapshot()');
                    $waiting = (int) DB::selectOne("select count(*) as n from pg_stat_activity where application_name=? and wait_event_type='Lock'", [$name])->n;
                    if ($waiting) {
                        break;
                    }
                    self::assertTrue($worker->isRunning());
                    usleep(10000);
                } while (microtime(true) < $deadline);
                self::assertSame(1, $waiting, 'Request must reach an actual PostgreSQL lock wait');
                match ($scenario) {
                    'inactive' => $this->u['owner']->update(['account_status' => 'Inactive']),
                    'role' => $this->u['owner']->update(['role' => Role::Staff]),
                    default => $this->u['owner']->forceFill(['auth_version' => $this->u['owner']->auth_version + 1])->save(),
                };
                DB::commit();
                self::assertSame(0, $worker->wait());
                $result = json_decode($worker->getOutput(), true, flags: JSON_THROW_ON_ERROR);
            } finally {
                if (DB::transactionLevel()) {
                    DB::rollBack();
                }
                if ($worker?->isRunning()) {
                    $worker->stop();
                }
            }
            self::assertSame(403, $result['status'], $scenario);
            self::assertSame($before, $this->b['b1']->fresh()->getAttributes());
            self::assertSame($audit, AuditLog::where('action', 'branch.updated')->count());
        }
    }
}

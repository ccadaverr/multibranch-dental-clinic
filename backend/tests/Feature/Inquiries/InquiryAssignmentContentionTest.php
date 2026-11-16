<?php

namespace Tests\Feature\Inquiries;

use App\Enums\Role;
use App\Models\{CommandKey, Inquiry, InquiryHistory, StaffProfile, User, UserBranchScope};
use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class InquiryAssignmentContentionTest extends TestCase
{
    use SchedulingFixture;

    protected function setUp(): void
    {
        $manifest = getenv('DENTALOPS_LOCAL_TARGET');
        if (! $manifest || ! str_starts_with(basename(json_decode(file_get_contents($manifest), true)['runtime']), 'contention-')) {
            self::markTestSkipped('Use a fresh owned contention clone.');
        }
        parent::setUp();
        self::assertSame(0, User::count(), 'Fresh clone only');
        $this->setUpSchedulingWorld();
    }

    public function test_a_waiting_capture_cannot_use_a_reassigned_branch_or_revoked_staff_actor(): void
    {
        $profile = StaffProfile::create(['legacy_ref' => 'inquiry-staff', 'person_id' => $this->u['staffB1']->person_id,
            'branch_id' => $this->b['b1']->id, 'title' => 'Reception', 'shift_start' => '09:00', 'shift_end' => '17:00', 'available' => true]);
        UserBranchScope::firstOrCreate(['user_id' => $this->u['staffB1']->id, 'branch_id' => $this->b['b2']->id]);
        foreach (['assignment', 'inactive', 'role', 'auth_version'] as $index => $scenario) {
            $profile->update(['branch_id' => $this->b['b1']->id]);
            $actor = $this->u['staffB1']->fresh();
            $actor->forceFill(['role' => Role::Staff, 'account_status' => 'Active'])->save();
            $token = $actor->createToken('synthetic-inquiry-assignment')->plainTextToken;
            $worker = null;
            DB::beginTransaction();
            try {
                StaffProfile::whereKey($profile->id)->lockForUpdate()->first();
                User::whereKey($actor->id)->lockForUpdate()->first();
                $name = 'inquiry_a_'.getmypid().'_'.$index;
                $worker = new Process([PHP_BINARY, base_path('tests/Support/inquiry_assignment_worker.php')], base_path(), getenv(),
                    json_encode(['worker' => $name, 'token' => $token], JSON_THROW_ON_ERROR), 30);
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
                self::assertSame(1, $waiting, 'Capture must reach a real PostgreSQL lock wait');
                match ($scenario) {
                    'assignment' => $profile->update(['branch_id' => $this->b['b2']->id]),
                    'inactive' => $actor->update(['account_status' => 'Inactive']),
                    'role' => $actor->update(['role' => Role::Owner]),
                    default => $actor->forceFill(['auth_version' => $actor->auth_version + 1])->save(),
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
            self::assertSame(0, Inquiry::count());
            self::assertSame(0, InquiryHistory::count());
            self::assertSame(0, CommandKey::where('command', 'inquiry.create')->count());
        }
    }
}

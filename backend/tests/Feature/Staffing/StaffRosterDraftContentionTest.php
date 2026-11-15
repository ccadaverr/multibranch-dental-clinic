<?php

namespace Tests\Feature\Staffing;

use App\Models\AuditLog;
use App\Models\StaffProfile;
use App\Models\StaffRosterDraft;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Committed independent requests; the guarded lane requires a fresh disposable clone. */
class StaffRosterDraftContentionTest extends TestCase
{
    use SchedulingFixture;

    protected function setUp(): void
    {
        if (getenv('OPERATIONS_DISPOSABLE_POSTGRES_ACCEPTANCE') !== '1') self::markTestSkipped('Use roster-draft-contention on a fresh clone.');
        parent::setUp();
        foreach (['users','staff_roster_drafts','staff_roster_draft_revisions'] as $table) self::assertSame(0, DB::table($table)->count(), 'Fresh clone only.');
        $this->setUpSchedulingWorld();
    }

    public function test_real_contention_serializes_create_replay_stale_payload_conflict_and_revocation(): void
    {
        $profile=StaffProfile::create(['legacy_ref'=>'ops-contention','person_id'=>$this->u['staffB1']->person_id,'branch_id'=>$this->b['b1']->id,'shift_start'=>'09:00','shift_end'=>'17:00','available'=>true]);
        $before=$profile->fresh()->getAttributes();
        $token=$this->u['owner']->createToken('synthetic-roster-contention')->plainTextToken;
        foreach (['replay','stale','contradictory','revoked'] as $index=>$scenario) {
            $body=['date'=>['2026-09-28','2026-09-29','2026-09-30','2026-10-01'][$index],'branch_ref'=>'b1','start_time'=>'10:00','end_time'=>'16:00','expected_revision'=>0,'operation_id'=>(string) Str::uuid()];
            $workers=$names=[]; DB::beginTransaction();
            try {
                User::whereKey($this->u['owner']->id)->lockForUpdate()->firstOrFail();
                foreach ([0,1] as $n) {
                    $payload=$body;
                    if ($scenario==='stale' && $n===1) $payload['operation_id']=(string) Str::uuid();
                    if ($scenario==='contradictory' && $n===1) $payload['end_time']='17:00';
                    $name='ops_draft_'.getmypid().'_'.$index.'_'.$n; $names[]=$name;
                    $worker=new Process([PHP_BINARY,base_path('tests/Support/operations_worker.php')],base_path(),getenv(),json_encode([
                        'worker'=>$name,'token'=>$token,'path'=>'/api/staff/ops-contention/roster-draft','method'=>'PUT','body'=>$payload,
                    ]),30);
                    $worker->start(); $workers[]=$worker;
                }
                $deadline=microtime(true)+10;
                do {
                    DB::selectOne('select pg_stat_clear_snapshot()');
                    $waiting=(int) DB::selectOne("select count(*) as n from pg_stat_activity where application_name in (?,?) and wait_event_type='Lock'",$names)->n;
                    if ($waiting===2) break;
                    foreach ($workers as $worker) self::assertTrue($worker->isRunning(),'Workers must reach actual PostgreSQL locks.');
                    usleep(10000);
                } while (microtime(true)<$deadline);
                self::assertSame(2,$waiting);
                if ($scenario==='revoked') $this->u['owner']->update(['account_status'=>'Inactive']);
                DB::commit(); $results=[];
                foreach ($workers as $worker) {
                    self::assertSame(0,$worker->wait());
                    $results[]=json_decode($worker->getOutput(),true,flags:JSON_THROW_ON_ERROR);
                }
            } finally {
                if (DB::transactionLevel()) DB::rollBack();
                foreach ($workers as $worker) if ($worker->isRunning()) $worker->stop();
            }
            $statuses=array_column($results,'status'); sort($statuses);
            self::assertSame(match($scenario){'stale','contradictory'=>[200,409],'revoked'=>[403,403],default=>[200,200]},$statuses,$scenario);
            self::assertSame(min($index+1,3),StaffRosterDraft::count());
            self::assertSame(min($index+1,3),DB::table('staff_roster_draft_revisions')->count());
            self::assertSame(min($index+1,3),AuditLog::where('action','staff_roster.draft_saved')->count());
            if ($scenario==='replay') {
                $left=$results[0]['body']['data']; $right=$results[1]['body']['data']; ksort($left); ksort($right);
                self::assertSame($left,$right); self::assertFalse($left['published']); self::assertSame(1,$left['revision']);
            }
            self::assertSame($before,$profile->fresh()->getAttributes());
        }
    }
}

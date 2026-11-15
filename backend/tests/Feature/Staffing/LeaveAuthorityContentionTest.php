<?php

namespace Tests\Feature\Staffing;

use App\Models\AuditLog;
use App\Models\AutomationSetting;
use App\Models\LeaveRequest;
use App\Models\StaffProfile;
use App\Models\User;
use App\Models\UserBranchScope;
use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Real committed requests in a fresh guarded clone; never reset a development database. */
class LeaveAuthorityContentionTest extends TestCase
{
    use SchedulingFixture;

    protected function setUp(): void
    {
        if (getenv('OPERATIONS_DISPOSABLE_POSTGRES_ACCEPTANCE')!=='1') self::markTestSkipped('Use leave-authority-contention on a fresh clone.');
        parent::setUp();
        foreach (['users','leave_requests'] as $table) self::assertSame(0,DB::table($table)->count(),'Fresh clone only.');
        $this->setUpSchedulingWorld();
    }

    public function test_revocation_while_waiting_refuses_leave_creation_decision_and_cancellation(): void
    {
        $staff=StaffProfile::create(['legacy_ref'=>'leave-authority','person_id'=>$this->u['staffB1']->person_id,'branch_id'=>$this->b['b1']->id,'shift_start'=>'09:00','shift_end'=>'17:00']);
        $leave=LeaveRequest::create(['requester_user_id'=>$this->u['staffB1']->id,'staff_profile_id'=>$staff->id,'type'=>'vacation','starts_at'=>'2027-01-10 13:00:00+08:00','ends_at'=>'2027-01-10 15:00:00+08:00','status'=>'Pending']);
        $before=$leave->fresh()->getAttributes();
        foreach (['decide','cancel','create','scope_decide','policy_decide'] as $index=>$scenario) {
            $frontDesk=in_array($scenario,['scope_decide','policy_decide'],true);
            if($frontDesk){
                AutomationSetting::whereKey('staffing')->update(['settings'=>['leave_approver'=>'owner_or_front_desk']]);
                UserBranchScope::where('user_id',$this->u['staffB2']->id)->firstOrFail()->update(['branch_id'=>$this->b['b1']->id]);
            }
            $actor=$this->u[$frontDesk?'staffB2':($scenario==='decide'?'owner':'staffB1')]->fresh();
            $token=$actor->createToken('synthetic-leave-authority')->plainTextToken;
            $action=$frontDesk?'decide':$scenario;
            $path=$action==='create'?'/api/leave':'/api/leave/'.$leave->public_id.'/'.$action;
            $body=match($action){'decide'=>['decision'=>'approve'],'create'=>['type'=>'vacation','start_date'=>'2027-02-10','end_date'=>'2027-02-10','start_time'=>'13:00','end_time'=>'15:00'],default=>[]};
            $workers=$names=[]; DB::beginTransaction();
            try {
                $locked=User::whereKey($actor->id)->lockForUpdate()->firstOrFail();
                foreach ([0,1] as $n) {
                    $name='ops_leave_'.getmypid().'_'.$index.'_'.$n; $names[]=$name;
                    $worker=new Process([PHP_BINARY,base_path('tests/Support/operations_worker.php')],base_path(),getenv(),json_encode([
                        'worker'=>$name,'token'=>$token,'path'=>$path,'method'=>'POST','body'=>$body,
                    ]),30);$worker->start();$workers[]=$worker;
                }
                $deadline=microtime(true)+10;
                do {
                    DB::selectOne('select pg_stat_clear_snapshot()');
                    $waiting=(int) DB::selectOne("select count(*) as n from pg_stat_activity where application_name in (?,?) and wait_event_type='Lock'",$names)->n;
                    if($waiting===2)break;
                    foreach($workers as $worker) self::assertTrue($worker->isRunning(),'Both authenticated requests must wait on real locks.');
                    usleep(10000);
                } while(microtime(true)<$deadline);
                self::assertSame(2,$waiting,$scenario);
                if($scenario==='scope_decide') UserBranchScope::where('user_id',$actor->id)->firstOrFail()->update(['branch_id'=>$this->b['b2']->id]);
                elseif($scenario==='policy_decide') AutomationSetting::whereKey('staffing')->update(['settings'=>['leave_approver'=>'owner']]);
                else $locked->update(['account_status'=>'Inactive']);
                DB::commit();
                foreach($workers as $worker){self::assertSame(0,$worker->wait());self::assertSame(403,json_decode($worker->getOutput(),true,flags:JSON_THROW_ON_ERROR)['status'],$scenario);}
            } finally {
                if(DB::transactionLevel())DB::rollBack();
                foreach($workers as $worker)if($worker->isRunning())$worker->stop();
            }
            self::assertSame($before,$leave->fresh()->getAttributes());
            self::assertSame(1,LeaveRequest::count());self::assertSame(0,AuditLog::where('action','like','leave.%')->count());
            // Re-enable only this synthetic actor for the next independent scenario; issue a new token there.
            if(!$frontDesk)$actor->fresh()->update(['account_status'=>'Active']);
        }
    }
}

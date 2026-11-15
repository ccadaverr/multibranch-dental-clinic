<?php
namespace Tests\Feature\Staffing;

use App\Models\AuditLog;
use App\Models\AutomationSetting;
use App\Models\LeaveCommandReceipt;
use App\Models\LeaveRequest;
use App\Models\StaffProfile;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class LeaveRecoveryContentionTest extends TestCase
{
    use SchedulingFixture;
    protected function setUp(): void
    {
        if(getenv('OPERATIONS_DISPOSABLE_POSTGRES_ACCEPTANCE')!=='1')self::markTestSkipped('Use leave-recovery-contention on a fresh clone.');
        parent::setUp();foreach(['users','leave_requests','leave_command_receipts'] as $table)self::assertSame(0,DB::table($table)->count(),'Fresh clone only.');
        $this->setUpSchedulingWorld();
    }
    public function test_real_create_replay_approver_and_requester_races_have_one_authoritative_winner(): void
    {
        $staff=StaffProfile::create(['legacy_ref'=>'recovery-contention','person_id'=>$this->u['staffB1']->person_id,'branch_id'=>$this->b['b1']->id,'shift_start'=>'09:00','shift_end'=>'17:00']);
        AutomationSetting::whereKey('staffing')->update(['settings'=>['leave_approver'=>'owner_or_front_desk']]);
        $tokens=[];foreach(['owner','staffB1','staffBoth'] as $who)$tokens[$who]=$this->u[$who]->createToken('synthetic-leave-recovery')->plainTextToken;
        foreach(['create_same','create_overlap','approve_same','approve_decline','cancel_approve','cancel_same'] as $index=>$scenario){
            $create=str_starts_with($scenario,'create');$operation=(string)Str::uuid();
            $leave=$create?null:LeaveRequest::create(['requester_user_id'=>$this->u['staffB1']->id,'staff_profile_id'=>$staff->id,'type'=>'vacation','starts_at'=>'2027-03-'.(10+$index).' 13:00:00+08:00','ends_at'=>'2027-03-'.(10+$index).' 15:00:00+08:00','status'=>'Pending']);
            $before=LeaveCommandReceipt::count();$audits=AuditLog::where('action','like','leave.%')->count();$workers=$names=[];DB::beginTransaction();
            try{
                $create?User::whereKey($this->u['staffB1']->id)->lockForUpdate()->firstOrFail():LeaveRequest::whereKey($leave->id)->lockForUpdate()->firstOrFail();
                foreach([0,1] as $n){
                    $who=$create?'staffB1':'owner';$action='decide';$body=['decision'=>'approve','expected_revision'=>1,'operation_id'=>$operation];
                    if($scenario==='approve_decline'&&$n===1){$who='staffBoth';$body['decision']='decline';$body['operation_id']=(string)Str::uuid();}
                    if($scenario==='cancel_approve'&&$n===0){$who='staffB1';$action='cancel';unset($body['decision']);}
                    if($scenario==='cancel_same'){$action='cancel';unset($body['decision']);}
                    if($create){$body=['type'=>'vacation','start_date'=>'2027-02-'.(10+$index),'end_date'=>'2027-02-'.(10+$index),'start_time'=>'13:00','end_time'=>'15:00','expected_revision'=>0,'operation_id'=>$scenario==='create_overlap'&&$n===1?(string)Str::uuid():$operation];}
                    $path=$create?'/api/leave':'/api/leave/'.$leave->public_id.'/'.$action;
                    $name='ops_recovery_'.getmypid().'_'.$index.'_'.$n;$names[]=$name;
                    $worker=new Process([PHP_BINARY,base_path('tests/Support/operations_worker.php')],base_path(),getenv(),json_encode(['worker'=>$name,'token'=>$tokens[$who],'path'=>$path,'method'=>'POST','body'=>$body]),30);
                    $worker->start();$workers[]=$worker;
                }
                $deadline=microtime(true)+10;
                do{
                    DB::selectOne('select pg_stat_clear_snapshot()');
                    $waiting=(int)DB::selectOne("select count(*) as n from pg_stat_activity where application_name in (?,?) and wait_event_type='Lock'",$names)->n;
                    if($waiting===2)break;
                    foreach($workers as $worker)self::assertTrue($worker->isRunning(),'Requests must actually wait on PostgreSQL locks.');
                    usleep(10000);
                }while(microtime(true)<$deadline);
                self::assertSame(2,$waiting,$scenario);DB::commit();$results=[];
                foreach($workers as $worker){self::assertSame(0,$worker->wait());$results[]=json_decode($worker->getOutput(),true,flags:JSON_THROW_ON_ERROR);}
            }finally{if(DB::transactionLevel())DB::rollBack();foreach($workers as $worker)if($worker->isRunning())$worker->stop();}
            $statuses=array_column($results,'status');sort($statuses);
            self::assertSame(match($scenario){'create_same'=>[201,201],'create_overlap'=>[201,422],'approve_decline','cancel_approve'=>[200,409],default=>[200,200]},$statuses,$scenario);
            self::assertSame($before+1,LeaveCommandReceipt::count());self::assertSame($audits+1,AuditLog::where('action','like','leave.%')->count());
            if(!$create)self::assertSame(2,$leave->fresh()->revision);
            if(in_array($scenario,['create_same','approve_same','cancel_same'],true))self::assertEquals($results[0]['body']['data'],$results[1]['body']['data'],'Exact duplicate command returns the first persisted receipt.');
        }
    }
}

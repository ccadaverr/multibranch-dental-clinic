<?php
namespace Tests\Feature\Staffing;

use App\Enums\Role;
use App\Models\{StaffProfile, User};
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class StaffRosterPublicationContentionTest extends TestCase
{
    use SchedulingFixture;
    protected function setUp(): void {
        if(getenv('OPERATIONS_DISPOSABLE_POSTGRES_ACCEPTANCE')!=='1')self::markTestSkipped('Use fresh publication clone lane.');
        parent::setUp();foreach(['users','staff_roster_drafts','staff_roster_publications'] as $t)self::assertSame(0,DB::table($t)->count(),'Fresh clone only');
        $this->setUpSchedulingWorld();
    }
    public function test_two_owners_overlap_exact_retry_and_lock_time_revocation(): void
    {
        $staff=StaffProfile::create(['legacy_ref'=>'ops-contention','person_id'=>$this->u['staffB1']->person_id,'branch_id'=>$this->b['b1']->id,'shift_start'=>'09:00','shift_end'=>'18:00']);
        $other=$this->account(Role::Owner,null);
        $tokens=[$this->u['owner']->createToken('publication-a')->plainTextToken,$other->createToken('publication-b')->plainTextToken,$this->u['staffB1']->createToken('request-edit')->plainTextToken];
        foreach(['overlap','replay','staff_edit','revoked','target_role'] as $index=>$scenario){
            $from=\Carbon\CarbonImmutable::parse('2026-09-28')->addWeeks($index*2)->toDateString();$until=\Carbon\CarbonImmutable::parse($from)->addDays(6)->toDateString();
            $dates=[$from,\Carbon\CarbonImmutable::parse($from)->addDay()->toDateString()];
            $this->actingAsUser('owner');
            foreach($scenario==='overlap'?$dates:[$dates[0]] as $date){
                $this->putJson('/api/staff/ops-contention/roster',['date'=>$date,'kind'=>'weekly','branch_ref'=>$date===$dates[0]?'b1':'b2','weekdays'=>[1,2,3,4,5],'effective_from'=>$from,'effective_until'=>$until,'start_time'=>'09:00','end_time'=>'17:00','exceptions'=>[],'expected_revision'=>0,'operation_id'=>(string)Str::uuid()])->assertOk();
                $this->postJson('/api/staff/ops-contention/roster/approve',['date'=>$date,'expected_revision'=>1,'operation_id'=>(string)Str::uuid()])->assertOk();
            }
            $before=DB::table('staff_roster_publications')->count();$workers=$names=[];$op=(string)Str::uuid();DB::beginTransaction();
            try{
                if($scenario==='revoked')User::whereKey($other->id)->lockForUpdate()->first();
                elseif($scenario==='target_role')User::whereKey($this->u['staffB1']->id)->lockForUpdate()->first();
                else StaffProfile::whereKey($staff->id)->lockForUpdate()->first();
                for($n=0;$n<2;$n++){
                    $name='ops_pub_'.getmypid().'_'.$index.'_'.$n;$names[]=$name;
                    $selfEdit=$scenario==='staff_edit'&&$n===1;
                    $body=['date'=>$scenario==='overlap'?$dates[$n]:$dates[0],'expected_revision'=>2,'operation_id'=>$scenario==='replay'?$op:(string)Str::uuid()];
                    if($selfEdit)$body+=['branch_ref'=>'b1','kind'=>'weekly','weekdays'=>[1,2,3,4,5],'effective_from'=>$from,'effective_until'=>$until,'start_time'=>'10:00','end_time'=>'16:00','exceptions'=>[]];
                    $worker=new Process([PHP_BINARY,base_path('tests/Support/operations_worker.php')],base_path(),getenv(),json_encode(['worker'=>$name,'token'=>$selfEdit?$tokens[2]:($scenario==='revoked'?$tokens[1]:(in_array($scenario,['replay','target_role','staff_edit'],true)?$tokens[0]:$tokens[$n])),'path'=>'/api/staff/ops-contention/roster'.($selfEdit?'':'/publish'),'method'=>$selfEdit?'PUT':'POST','body'=>$body]),30);
                    $worker->start();$workers[]=$worker;
                }
                $deadline=microtime(true)+12;
                do{DB::selectOne('select pg_stat_clear_snapshot()');$waiting=(int)DB::selectOne("select count(*) as n from pg_stat_activity where application_name in (?,?) and wait_event_type='Lock'",$names)->n;if($waiting===2)break;foreach($workers as $w)self::assertTrue($w->isRunning());usleep(10000);}while(microtime(true)<$deadline);
                self::assertSame(2,$waiting,'Both commands reached real lock waits');
                if($scenario==='revoked')$other->update(['account_status'=>'Inactive']);
                if($scenario==='target_role')$this->u['staffB1']->update(['role'=>Role::Owner]);
                DB::commit();$results=[];
                foreach($workers as $w){self::assertSame(0,$w->wait());$results[]=json_decode($w->getOutput(),true,flags:JSON_THROW_ON_ERROR);}
            }finally{if(DB::transactionLevel())DB::rollBack();foreach($workers as $w)if($w->isRunning())$w->stop();}
            $statuses=array_column($results,'status');sort($statuses);self::assertSame(match($scenario){'overlap'=>[200,422],'replay'=>[200,200],'staff_edit'=>[200,409],default=>[403,403]},$statuses,$scenario);
            $added=in_array($scenario,['overlap','replay'],true)?1:($scenario==='staff_edit'&&($results[0]['body']['data']['status']??null)==='Published'?1:0);
            self::assertSame($before+$added,DB::table('staff_roster_publications')->count());
            if($scenario==='replay'){self::assertEquals($results[0]['body']['data'],$results[1]['body']['data']);self::assertTrue($results[0]['body']['meta']['replayed']||$results[1]['body']['meta']['replayed']);}
        }
    }
}

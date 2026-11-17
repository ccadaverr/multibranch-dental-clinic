<?php
namespace Tests\Feature\Visits;
use App\Models\Appointment;
use App\Models\CommandKey;
use App\Models\QueueEntry;
use App\Models\Visit;
use App\Models\VisitHistory;
use App\Support\ClinicClock;
use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Committed fixtures only on a fresh, owned clone. No migrations/resets/cleanup. */
final class ArrivalContentionTest extends TestCase
{
 use SchedulingFixture;
 protected function setUp():void{
  if(getenv('ARRIVAL_DISPOSABLE_POSTGRES_ACCEPTANCE')!=='1')self::markTestSkipped('Separate owned contention clone required.');
  parent::setUp();self::assertSame(0,DB::transactionLevel());
  foreach(['branches','patients','visits','command_keys']as$table)self::assertSame(0,DB::table($table)->count());
  $this->setUpSchedulingWorld();$this->travelBack();
  // Explicit synthetic all-day fixture, not clinic policy or roster authority.
  $this->b['b1']->update(['open_time'=>'00:00','close_time'=>'23:59']);$this->d['d1']->update(['shift_start'=>'00:00','shift_end'=>'23:59']);
 }
 public function test_two_staff_accounts_and_same_command_replays_preserve_one_arrival():void{
  $tokens=[$this->u['staffB1']->createToken('arrival-worker')->plainTextToken,$this->u['staffBoth']->createToken('arrival-other-worker')->plainTextToken];
  foreach(['scheduled_distinct','scheduled_same_key','walkin_distinct','walkin_same_key','scheduled_vs_walkin']as$i=>$scenario){
   [,$this->p['A']]=$this->patient('PAT-ARRIVAL-'.($i+1));$patient=$this->p['A'];
   $scheduled=!str_starts_with($scenario,'walkin');$same=str_ends_with($scenario,'same_key');
   $a=$scheduled?$this->existing('A','d1','b1','svc1',ClinicClock::today(),sprintf('%02d:00',9+$i)):null;
   $before=[Visit::count(),QueueEntry::count(),VisitHistory::count(),CommandKey::count()];$workers=[];$names=[];
   DB::beginTransaction();
   try{
    DB::table('patients')->where('id',$patient->id)->lockForUpdate()->first();
    foreach([0,1]as$n){
     $asScheduled=$scheduled&& !($scenario==='scheduled_vs_walkin'&&$n===1);
     $payload=$asScheduled?['appointment_id'=>$a->public_id,'expected_revision'=>1,'id_confirmed'=>true]:['patient_id'=>$patient->public_id,'branch_ref'=>'b1','service_ref'=>'svc1','dentist_ref'=>'d1'];
     $name='arrival_'.getmypid().'_'.$i.'_'.$n;$names[]=$name;
     $worker=new Process([PHP_BINARY,base_path('tests/Support/arrival_worker.php')],base_path(),$this->workerEnvironment(),json_encode(['worker'=>$name,'token'=>$tokens[$same?0:$n],
      'path'=>$asScheduled?'/api/visits/check-in':'/api/visits/walk-in','payload'=>$payload,'key'=>'arrival-'.$scenario.'-'.($same?0:$n)],JSON_THROW_ON_ERROR),30);
     $worker->start();$workers[]=$worker;
    }
    $deadline=microtime(true)+10;$waiting=0;
    do{
     DB::selectOne('select pg_stat_clear_snapshot()');$waiting=(int)DB::selectOne("select count(*) as n from pg_stat_activity where application_name in (?,?) and wait_event_type='Lock'",$names)->n;
     if($waiting===2)break;foreach($workers as$worker)self::assertTrue($worker->isRunning(),'Worker exited before real contention');usleep(10000);
    }while(microtime(true)<$deadline);
    self::assertSame(2,$waiting,'Both independent PostgreSQL workers must actually wait on a lock.');DB::commit();$results=[];
    foreach($workers as$worker){self::assertSame(0,$worker->wait());$results[]=json_decode($worker->getOutput(),true,flags:JSON_THROW_ON_ERROR);}
   }finally{if(DB::transactionLevel()>0)DB::rollBack();foreach($workers as$worker)if($worker->isRunning())$worker->stop();}
   $statuses=array_column($results,'status');sort($statuses);self::assertSame($same?[201,201]:[201,409],$statuses);
   if($same)self::assertSame($results[0]['body'],$results[1]['body']);
   self::assertSame(array_map(fn($n)=>$n+1,$before),[Visit::count(),QueueEntry::count(),VisitHistory::count(),CommandKey::count()]);
   $visit=Visit::where('patient_id',$patient->id)->sole();$entry=QueueEntry::where('visit_id',$visit->id)->sole();
   self::assertSame('Checked In',$visit->status);self::assertSame('Waiting',$entry->status);self::assertNull($visit->closed_at);
   self::assertSame($patient->id,$visit->patient_id);self::assertSame($this->b['b1']->id,$visit->branch_id);self::assertSame($this->d['d1']->id,$visit->responsible_dentist_profile_id);
   $winner=current(array_filter($results,fn($r)=>$r['status']===201));self::assertSame($visit->public_id,$winner['body']['data']['id']);self::assertSame($entry->public_id,$winner['body']['data']['queue']['id']);
   if($a)self::assertSame($visit->appointment_id===$a->id?'Checked In':'Confirmed',$a->fresh()->status);
  }
 }
 private function workerEnvironment():array{
  $pg=config('database.connections.pgsql');return ['APP_ENV'=>'testing','APP_KEY'=>config('app.key'),'DB_CONNECTION'=>'pgsql','DB_DATABASE'=>$pg['database'],'DB_HOST'=>$pg['host'],'DB_PORT'=>(string)$pg['port'],
   'DB_USERNAME'=>$pg['username'],'DB_PASSWORD'=>$pg['password'],'DB_URL'=>'','CACHE_STORE'=>'array','SESSION_DRIVER'=>'array','QUEUE_CONNECTION'=>'sync','MAIL_MAILER'=>'array','BROADCAST_CONNECTION'=>'null',
   'DENTALOPS_LOCAL_TARGET'=>getenv('DENTALOPS_LOCAL_TARGET')?:'','ARRIVAL_DISPOSABLE_POSTGRES_ACCEPTANCE'=>'1'];
 }
}

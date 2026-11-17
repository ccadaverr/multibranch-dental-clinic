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
  $this->branchFifoAndMoveContention($tokens);
 }
 private function branchFifoAndMoveContention(array $tokens):void{
  $this->d['d2']->update(['shift_start'=>'00:00','shift_end'=>'23:59']);
  [,$one]=$this->patient('PAT-FIFO-RACE-1');[,$two]=$this->patient('PAT-FIFO-RACE-2');
  $requests=[];
  foreach([[$one,'d1'],[$two,'d2']]as$n=>[$patient,$dentist])$requests[]=['path'=>'/api/visits/walk-in','payload'=>['patient_id'=>$patient->public_id,'branch_ref'=>'b1','service_ref'=>'svc1','dentist_ref'=>$dentist],'key'=>'fifo-arrival-'.$n];
  $results=$this->branchLockedPair($tokens,$requests,'fifo');$statuses=array_column($results,'status');sort($statuses);self::assertSame([201,201],$statuses);
  $visits=Visit::whereIn('patient_id',[$one->id,$two->id])->orderBy('arrived_at')->orderBy('id')->get();self::assertCount(2,$visits);
  $order=app(\App\Services\Queue\QueueOrder::class);$date=ClinicClock::today();$branch=$this->b['b1']->id;
  $rows=$order->eligible($branch,$date);$pair=$rows->whereIn('visit_id',$visits->pluck('id'))->values();
  self::assertSame($visits->pluck('id')->all(),$pair->pluck('visit_id')->all(),'Cross-Dentist branch FIFO follows persisted arrival facts, never worker response order.');
  self::assertSame(2,$pair->pluck('dentist_queue_id')->unique()->count());
  $facts=$visits->mapWithKeys(fn($v)=>[$v->id,$v->getRawOriginal('arrived_at')])->all();
  $history=\App\Models\QueueEntryHistory::orderBy('id')->get()->map->getRawOriginal()->all();
  $snapshot=$order->snapshot($branch,$date);$anchor=$rows->first();$requests=[];
  foreach($pair as$n=>$entry)$requests[]=['path'=>'/api/queue/'.$entry->public_id.'/reorder','payload'=>['expected_revision'=>1,'order_revision'=>$snapshot['revision'],'before_entry_id'=>$anchor->public_id,'reason'=>'Synthetic concurrent operational move'],'key'=>'fifo-move-'.$n];
  $results=$this->branchLockedPair($tokens,$requests,'move');$statuses=array_column($results,'status');sort($statuses);self::assertSame([200,409],$statuses,'One reviewed order snapshot permits only one competing committed move.');
  $winner=current(array_filter($results,fn($r)=>$r['status']===200));self::assertSame($winner['body']['data']['id'],$order->eligible($branch,$date)->first()->public_id);
  self::assertSame(1,\App\Models\AuditLog::where('action','queue.reordered')->count());self::assertSame(1,\App\Models\QueueEntryHistory::where('event','queue.reordered')->count());
  self::assertSame($facts,Visit::whereIn('id',$visits->pluck('id'))->get()->mapWithKeys(fn($v)=>[$v->id,$v->getRawOriginal('arrived_at')])->all());
  self::assertSame($history,\App\Models\QueueEntryHistory::orderBy('id')->limit(count($history))->get()->map->getRawOriginal()->all());
 }
 private function branchLockedPair(array $tokens,array $requests,string $scenario):array{
  $workers=[];$names=[];DB::beginTransaction();
  try{
   app(\App\Services\Queue\QueueOrder::class)->lock($this->b['b1']->id,ClinicClock::today());
   foreach($requests as$n=>$request){$name='arrival_'.getmypid().'_'.$scenario.'_'.$n;$names[]=$name;
    $worker=new Process([PHP_BINARY,base_path('tests/Support/arrival_worker.php')],base_path(),$this->workerEnvironment(),json_encode($request+['worker'=>$name,'token'=>$tokens[$n]],JSON_THROW_ON_ERROR),30);$worker->start();$workers[]=$worker;
   }
   $deadline=microtime(true)+10;$waiting=0;
   do{DB::selectOne('select pg_stat_clear_snapshot()');$waiting=(int)DB::selectOne("select count(*) as n from pg_stat_activity where application_name in (?,?) and wait_event_type='Lock'",$names)->n;
    if($waiting===2)break;foreach($workers as$worker)self::assertTrue($worker->isRunning(),'Independent '.$scenario.' worker exited before branch contention.');usleep(10000);
   }while(microtime(true)<$deadline);
   self::assertSame(2,$waiting,'Both '.$scenario.' requests must actually wait on PostgreSQL locks.');DB::commit();$results=[];
   foreach($workers as$worker){self::assertSame(0,$worker->wait());$results[]=json_decode($worker->getOutput(),true,flags:JSON_THROW_ON_ERROR);}return $results;
  }finally{if(DB::transactionLevel()>0)DB::rollBack();foreach($workers as$worker)if($worker->isRunning())$worker->stop();}
 }
 private function workerEnvironment():array{
  $pg=config('database.connections.pgsql');return ['APP_ENV'=>'testing','APP_KEY'=>config('app.key'),'DB_CONNECTION'=>'pgsql','DB_DATABASE'=>$pg['database'],'DB_HOST'=>$pg['host'],'DB_PORT'=>(string)$pg['port'],
   'DB_USERNAME'=>$pg['username'],'DB_PASSWORD'=>$pg['password'],'DB_URL'=>'','CACHE_STORE'=>'array','SESSION_DRIVER'=>'array','QUEUE_CONNECTION'=>'sync','MAIL_MAILER'=>'array','BROADCAST_CONNECTION'=>'null',
   'DENTALOPS_LOCAL_TARGET'=>getenv('DENTALOPS_LOCAL_TARGET')?:'','ARRIVAL_DISPOSABLE_POSTGRES_ACCEPTANCE'=>'1'];
 }
}

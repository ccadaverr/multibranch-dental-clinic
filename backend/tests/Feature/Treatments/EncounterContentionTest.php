<?php
namespace Tests\Feature\Treatments;
use App\Models\{Visit,Treatment,TreatmentHistory,QueueEntry,CommandKey,AuditLog};
use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Real independent authenticated requests and commits. No migrations, resets or fixture deletion. */
final class EncounterContentionTest extends TestCase
{
 use SchedulingFixture;
 protected function setUp():void{
  if(getenv('ENCOUNTER_DISPOSABLE_POSTGRES_ACCEPTANCE')!=='1')self::markTestSkipped('Fresh owned contention clone required.');
  parent::setUp();self::assertSame(0,DB::transactionLevel());foreach(['branches','patients','visits','treatments','command_keys']as$table)self::assertSame(0,DB::table($table)->count());
  $this->setUpSchedulingWorld();$this->travelBack();$this->b['b1']->update(['open_time'=>'00:00','close_time'=>'23:59']);
 }
 private function visit(string $label,string $dentist):Visit{
  [,$p]=$this->patient('PAT-'.$label);$this->actingAsUser('staffB1');
  $id=$this->postJson('/api/visits/walk-in',['patient_id'=>$p->public_id,'branch_ref'=>'b1','service_ref'=>'svc1','dentist_ref'=>$dentist],['Idempotency-Key'=>'arrive-'.$label])->assertCreated()->json('data.id');
  $v=Visit::where('public_id',$id)->sole();$this->postJson('/api/queue/'.$v->queueEntry->public_id.'/call',['expected_revision'=>1],['Idempotency-Key'=>'call-'.$label])->assertOk();return $v->fresh();
 }
 public function test_real_session_contention_recovers_or_refuses_without_duplicate_clinical_records():void{
  foreach(['same_visit_distinct_keys','same_visit_same_key','one_dentist_two_visits','two_dentists_two_visits'] as $i=>$scenario){
   [$dentist,$user]=$this->dentist('enc-'.$i,['b1'],['svc1']);$dentist->update(['shift_start'=>'00:00','shift_end'=>'23:59']);$this->u['worker-'.$i]=$user;
   $tokens=[$user->createToken('encounter-a')->plainTextToken,$user->createToken('encounter-b')->plainTextToken];
   $first=$this->visit('ENC-'.$i.'-A',$dentist->legacy_ref);$second=$first;$same=$scenario==='same_visit_same_key';
   if($scenario==='one_dentist_two_visits')$second=$this->visit('ENC-'.$i.'-B',$dentist->legacy_ref);
   if($scenario==='two_dentists_two_visits'){
    [$other,$otherUser]=$this->dentist('enc-other-'.$i,['b1'],['svc1']);$other->update(['shift_start'=>'00:00','shift_end'=>'23:59']);
    $tokens[1]=$otherUser->createToken('encounter-other')->plainTextToken;$this->u['other-'.$i]=$otherUser;$second=$this->visit('ENC-'.$i.'-B',$other->legacy_ref);
   }
   $before=[Treatment::count(),TreatmentHistory::count(),CommandKey::where('command','treatment.start')->count(),AuditLog::where('action','treatment.started')->count()];$workers=[];$names=[];
   DB::beginTransaction();
   try{
    Visit::whereIn('id',[$first->id,$second->id])->orderBy('id')->lockForUpdate()->get();
    foreach([$first,$second] as $n=>$v){
     $name='encounter_'.getmypid().'_'.$i.'_'.$n;$names[]=$name;
     $worker=new Process([PHP_BINARY,base_path('tests/Support/encounter_worker.php')],base_path(),$this->workerEnvironment(),json_encode(['worker'=>$name,'token'=>$tokens[$same?0:$n],
      'path'=>'/api/visits/'.$v->public_id.'/treatment','payload'=>['expected_revision'=>1,'queue_id'=>$v->queueEntry->public_id,'expected_queue_revision'=>2],
      'key'=>'encounter-'.$i.'-'.($same?0:$n)],JSON_THROW_ON_ERROR),30);$worker->start();$workers[]=$worker;
    }
    $deadline=microtime(true)+10;$waiting=0;
    do{DB::selectOne('select pg_stat_clear_snapshot()');$waiting=(int)DB::selectOne("select count(*) as n from pg_stat_activity where application_name in (?,?) and wait_event_type='Lock'",$names)->n;
     if($waiting===2)break;foreach($workers as$w)self::assertTrue($w->isRunning(),'Worker exited before real contention');usleep(10000);
    }while(microtime(true)<$deadline);
    self::assertSame(2,$waiting,'Both independent sessions must really wait for PostgreSQL locks');DB::commit();$results=[];
    foreach($workers as$w){self::assertSame(0,$w->wait());$results[]=json_decode($w->getOutput(),true,flags:JSON_THROW_ON_ERROR);}
   }finally{if(DB::transactionLevel()>0)DB::rollBack();foreach($workers as$w)if($w->isRunning())$w->stop();}
   $two=$scenario==='two_dentists_two_visits';$statuses=array_column($results,'status');sort($statuses);self::assertSame($same||$two?[201,201]:[201,409],$statuses);
   if($same)self::assertSame($results[0]['body'],$results[1]['body']);
   $count=$two?2:1;self::assertSame(array_map(fn($n)=>$n+$count,$before),[Treatment::count(),TreatmentHistory::count(),CommandKey::where('command','treatment.start')->count(),AuditLog::where('action','treatment.started')->count()]);
   foreach([$first,$second] as $v){$v=$v->fresh();$t=$v->treatment;self::assertSame($t?'In Treatment':'Checked In',$v->status);self::assertSame($t?'Served':'Called',$v->queueEntry->status);self::assertNull($v->appointment_id);
    if($t){self::assertNull($t->completed_at);self::assertSame($v->id,$t->visit_id);self::assertSame($v->responsible_dentist_profile_id,$t->dentist_profile_id);}
   }
  }
 }
 private function workerEnvironment():array{
  $pg=config('database.connections.pgsql');return ['APP_ENV'=>'testing','APP_KEY'=>config('app.key'),'DB_CONNECTION'=>'pgsql','DB_DATABASE'=>$pg['database'],'DB_HOST'=>$pg['host'],'DB_PORT'=>(string)$pg['port'],
   'DB_USERNAME'=>$pg['username'],'DB_PASSWORD'=>$pg['password'],'DB_URL'=>'','CACHE_STORE'=>'array','SESSION_DRIVER'=>'array','QUEUE_CONNECTION'=>'sync','MAIL_MAILER'=>'array','BROADCAST_CONNECTION'=>'null',
   'DENTALOPS_LOCAL_TARGET'=>getenv('DENTALOPS_LOCAL_TARGET')?:'','ENCOUNTER_DISPOSABLE_POSTGRES_ACCEPTANCE'=>'1'];
 }
}

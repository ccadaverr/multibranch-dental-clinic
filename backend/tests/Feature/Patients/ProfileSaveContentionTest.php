<?php
namespace Tests\Feature\Patients;
use App\Models\{Patient,CommandKey,AuditLog};
use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

final class ProfileSaveContentionTest extends TestCase
{
 use SchedulingFixture;
 protected function setUp():void{
  if(getenv('PROFILE_DISPOSABLE_POSTGRES_ACCEPTANCE')!=='1')self::markTestSkipped('Fresh owned contention clone required.');
  parent::setUp();self::assertSame(0,DB::transactionLevel());foreach(['patients','command_keys','branches']as$table)self::assertSame(0,DB::table($table)->count());$this->setUpSchedulingWorld();
 }
 public function test_concurrent_staff_changes_and_same_command_replay_preserve_one_revision_and_audit():void{
  $tokens=[$this->u['staffB1']->createToken('profile-a')->plainTextToken,$this->u['staffBoth']->createToken('profile-b')->plainTextToken];
  foreach([false,true]as$i=>$same){
   [,$this->p['A']]=$this->patient('PAT-PROFILE-'.$i);$p=$this->p['A'];$this->existing('A','d1','b1','svc1','2026-09-28',$i?'13:00':'11:00');
   $before=[CommandKey::where('command','patient.profile.update')->count(),AuditLog::where('action','patient.profile.updated')->count()];$workers=[];$names=[];
   DB::beginTransaction();
   try{
    Patient::whereKey($p->id)->lockForUpdate()->first();
    foreach([0,1]as$n){$name='profile_'.getmypid().'_'.$i.'_'.$n;$names[]=$name;
     $w=new Process([PHP_BINARY,base_path('tests/Support/profile_worker.php')],base_path(),$this->workerEnvironment(),json_encode(['worker'=>$name,'token'=>$tokens[$same?0:$n],
      'path'=>'/api/patients/'.$p->public_id,'payload'=>['expected_revision'=>1,'emergency_contact'=>'Synthetic profile contact '.($same?0:$n)],'key'=>'profile-'.$i.'-'.($same?0:$n)],JSON_THROW_ON_ERROR),30);$w->start();$workers[]=$w;
    }
    $deadline=microtime(true)+10;$waiting=0;
    do{DB::selectOne('select pg_stat_clear_snapshot()');$waiting=(int)DB::selectOne("select count(*) as n from pg_stat_activity where application_name in (?,?) and wait_event_type='Lock'",$names)->n;
     if($waiting===2)break;foreach($workers as$w)self::assertTrue($w->isRunning(),'Worker exited before real contention');usleep(10000);
    }while(microtime(true)<$deadline);
    self::assertSame(2,$waiting,'Both real Staff requests must wait on PostgreSQL locks');DB::commit();$results=[];
    foreach($workers as$w){self::assertSame(0,$w->wait());$results[]=json_decode($w->getOutput(),true,flags:JSON_THROW_ON_ERROR);}
   }finally{if(DB::transactionLevel()>0)DB::rollBack();foreach($workers as$w)if($w->isRunning())$w->stop();}
   $statuses=array_column($results,'status');sort($statuses);self::assertSame($same?[200,200]:[200,409],$statuses);
   if($same)self::assertSame($results[0]['body'],$results[1]['body']);
   self::assertSame(array_map(fn($n)=>$n+1,$before),[CommandKey::where('command','patient.profile.update')->count(),AuditLog::where('action','patient.profile.updated')->count()]);
   $p=$p->fresh();self::assertSame(2,$p->revision);$winner=current(array_filter($results,fn($r)=>$r['status']===200));self::assertSame($p->public_id,$winner['body']['data']['id']);self::assertSame($p->emergency_contact,$winner['body']['data']['emergency_contact']);
  }
 }
 private function workerEnvironment():array{
  $pg=config('database.connections.pgsql');return ['APP_ENV'=>'testing','APP_KEY'=>config('app.key'),'DB_CONNECTION'=>'pgsql','DB_DATABASE'=>$pg['database'],'DB_HOST'=>$pg['host'],'DB_PORT'=>(string)$pg['port'],
   'DB_USERNAME'=>$pg['username'],'DB_PASSWORD'=>$pg['password'],'DB_URL'=>'','CACHE_STORE'=>'array','SESSION_DRIVER'=>'array','QUEUE_CONNECTION'=>'sync','MAIL_MAILER'=>'array','BROADCAST_CONNECTION'=>'null',
   'DENTALOPS_LOCAL_TARGET'=>getenv('DENTALOPS_LOCAL_TARGET')?:'','PROFILE_DISPOSABLE_POSTGRES_ACCEPTANCE'=>'1'];
 }
}

<?php
namespace Tests\Feature\Intake;
use App\Models\{Patient,PatientGuardian,CommandKey,AuditLog};
use App\Services\Intake\Guardianship;
use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;
final class DependentCreationContentionTest extends TestCase {
 use SchedulingFixture;
 protected function setUp():void{if(getenv('DEPENDENT_DISPOSABLE_POSTGRES_ACCEPTANCE')!=='1')self::markTestSkipped('Fresh owned clone required.');parent::setUp();self::assertSame(0,DB::transactionLevel());self::assertSame(0,Patient::count());$this->setUpSchedulingWorld();}
 public function test_real_creation_races_preserve_original_key_and_existing_guardian_limit():void{
  foreach(['same_command','independent_commands','tenth_dependent']as$i=>$scenario){
   [$actor,$guardian]=$this->patient('PAT-DEP-'.$i);$actor->person->update(['date_of_birth'=>'1985-01-01']);$token=$actor->createToken('dependent-race')->plainTextToken;
   if($scenario==='tenth_dependent')DB::transaction(function()use($guardian,$actor){for($n=0;$n<9;$n++)Guardianship::addDependent($guardian,['first_name'=>'Existing'.$n,'last_name'=>'Synthetic','date_of_birth'=>'2016-02-02','relationship'=>'Child'],$actor);});
   $before=[Patient::count(),PatientGuardian::count(),CommandKey::where('command','patient.dependent.create')->count(),AuditLog::where('action','patient.guardian_linked')->count()];$workers=[];$names=[];DB::beginTransaction();
   try{
    DB::statement('LOCK TABLE patients IN SHARE ROW EXCLUSIVE MODE');
    foreach([0,1]as$n){$name='dependent_'.getmypid().'_'.$i.'_'.$n;$names[]=$name;$same=$scenario==='same_command';$worker=new Process([PHP_BINARY,base_path('tests/Support/dependent_worker.php')],base_path(),$this->workerEnvironment(),json_encode(['worker'=>$name,'token'=>$token,'key'=>'dependent-'.$i.'-'.($same?0:$n),'payload'=>['first_name'=>'Synthetic'.($same?0:$n),'last_name'=>'Dependent','date_of_birth'=>'2016-02-02','relationship'=>'Other','relationship_other'=>'Niece','consent'=>true]],JSON_THROW_ON_ERROR),30);$worker->start();$workers[]=$worker;}
    $deadline=microtime(true)+10;do{DB::selectOne('select pg_stat_clear_snapshot()');$waiting=(int)DB::selectOne("select count(*) as n from pg_stat_activity where application_name in (?,?) and wait_event_type='Lock'",$names)->n;if($waiting===2)break;foreach($workers as$w)self::assertTrue($w->isRunning(),'Worker ended before actual contention');usleep(10000);}while(microtime(true)<$deadline);
    self::assertSame(2,$waiting);DB::commit();$results=[];foreach($workers as$w){self::assertSame(0,$w->wait());$results[]=json_decode($w->getOutput(),true,flags:JSON_THROW_ON_ERROR);}
   }finally{if(DB::transactionLevel()>0)DB::rollBack();foreach($workers as$w)if($w->isRunning())$w->stop();}
   $status=array_column($results,'status');sort($status);self::assertSame($scenario==='tenth_dependent'?[201,422]:[201,201],$status);$count=$scenario==='independent_commands'?2:1;
   self::assertSame(array_map(fn($n)=>$n+$count,$before),[Patient::count(),PatientGuardian::count(),CommandKey::where('command','patient.dependent.create')->count(),AuditLog::where('action','patient.guardian_linked')->count()]);
   if($scenario==='same_command')self::assertSame($results[0]['body'],$results[1]['body']);if($scenario==='tenth_dependent')self::assertSame(10,Guardianship::dependentsOf($guardian)->count());
   foreach($results as$r)if($r['status']===201)self::assertSame($guardian->public_id,$r['body']['meta']['dependent_receipt']['guardian_id']);
  }
 }
 private function workerEnvironment():array{$p=config('database.connections.pgsql');return ['APP_ENV'=>'testing','APP_KEY'=>config('app.key'),'DB_CONNECTION'=>'pgsql','DB_HOST'=>$p['host'],'DB_PORT'=>(string)$p['port'],'DB_DATABASE'=>$p['database'],'DB_USERNAME'=>$p['username'],'DB_PASSWORD'=>$p['password'],'DB_URL'=>'','CACHE_STORE'=>'array','SESSION_DRIVER'=>'array','QUEUE_CONNECTION'=>'sync','MAIL_MAILER'=>'array','BROADCAST_CONNECTION'=>'null','DENTALOPS_LOCAL_TARGET'=>getenv('DENTALOPS_LOCAL_TARGET')?:'','DEPENDENT_DISPOSABLE_POSTGRES_ACCEPTANCE'=>'1'];}
}

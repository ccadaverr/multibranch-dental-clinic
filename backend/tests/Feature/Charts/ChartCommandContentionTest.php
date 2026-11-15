<?php
namespace Tests\Feature\Charts;
use App\Models\{ToothChartEntry,CommandKey,AuditLog};
use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;
final class ChartCommandContentionTest extends TestCase
{
 use SchedulingFixture;
 protected function setUp():void{
  if(getenv('CHART_DISPOSABLE_POSTGRES_ACCEPTANCE')!=='1')self::markTestSkipped('Fresh owned contention clone required.');parent::setUp();
  self::assertSame(0,DB::transactionLevel());foreach(['patients','branches','tooth_chart_entries','command_keys']as$table)self::assertSame(0,DB::table($table)->count());$this->setUpSchedulingWorld();
 }
 public function test_real_chart_contention_preserves_one_observed_revision_and_exact_replay():void{
  $tokens=[$this->u['dentist1']->createToken('chart-one')->plainTextToken,$this->u['dentist2']->createToken('chart-two')->plainTextToken];
  foreach(['same_tooth_distinct_dentists','same_command','different_teeth']as$i=>$scenario){
   [,$this->p['A']]=$this->patient('PAT-CHART-'.$i);$p=$this->p['A'];
   $this->existing('A','d1','b1','svc1','2026-09-29',sprintf('%02d:00',9+$i*2));$this->existing('A','d2','b1','svc1','2026-09-29',sprintf('%02d:00',10+$i*2));
   $same=$scenario==='same_command';$two=$scenario==='different_teeth';$before=[ToothChartEntry::count(),CommandKey::where('command','chart.record')->count(),AuditLog::where('action','chart.recorded')->count()];$workers=[];$names=[];
   DB::beginTransaction();
   try{
    foreach($two?[36,37]:[36]as$tooth)DB::select('select pg_advisory_xact_lock(hashtext(?), ?)', ['dental-chart:'.$p->id,$tooth]);
    foreach([0,1]as$n){$name='chart_'.getmypid().'_'.$i.'_'.$n;$names[]=$name;
     $w=new Process([PHP_BINARY,base_path('tests/Support/chart_worker.php')],base_path(),$this->workerEnvironment(),json_encode(['worker'=>$name,'token'=>$tokens[$same?0:$n],'path'=>'/api/patients/'.$p->public_id.'/chart',
      'payload'=>['tooth'=>$two&&$n?'37':'36','status'=>'Caries','surfaces'=>['O'],'note'=>'Synthetic chart '.($same?0:$n),'branch_ref'=>'b1','expected_revision'=>0],
      'key'=>'chart-'.$i.'-'.($same?0:$n)],JSON_THROW_ON_ERROR),30);$w->start();$workers[]=$w;
    }
    $deadline=microtime(true)+10;$waiting=0;
    do{DB::selectOne('select pg_stat_clear_snapshot()');$waiting=(int)DB::selectOne("select count(*) as n from pg_stat_activity where application_name in (?,?) and wait_event_type='Lock'",$names)->n;
     if($waiting===2)break;foreach($workers as$w)self::assertTrue($w->isRunning(),'Worker exited before real contention');usleep(10000);
    }while(microtime(true)<$deadline);
    self::assertSame(2,$waiting);DB::commit();$results=[];foreach($workers as$w){self::assertSame(0,$w->wait());$results[]=json_decode($w->getOutput(),true,flags:JSON_THROW_ON_ERROR);}
   }finally{if(DB::transactionLevel()>0)DB::rollBack();foreach($workers as$w)if($w->isRunning())$w->stop();}
   $statuses=array_column($results,'status');sort($statuses);self::assertSame($same||$two?[201,201]:[201,409],$statuses);
   if($same)self::assertSame($results[0]['body'],$results[1]['body']);$count=$two?2:1;
   self::assertSame(array_map(fn($n)=>$n+$count,$before),[ToothChartEntry::count(),CommandKey::where('command','chart.record')->count(),AuditLog::where('action','chart.recorded')->count()]);
   foreach($results as$r)if($r['status']===201){$proof=$r['body']['meta']['chart_receipt'];$e=ToothChartEntry::where('public_id',$proof['entry_id'])->sole();self::assertSame($p->id,$e->patient_id);self::assertSame($this->b['b1']->id,$e->branch_id);self::assertSame(1,$proof['revision']);self::assertSame($e->tooth,$proof['tooth']);}
  }
 }
 private function workerEnvironment():array{$p=config('database.connections.pgsql');return ['APP_ENV'=>'testing','APP_KEY'=>config('app.key'),'DB_CONNECTION'=>'pgsql','DB_HOST'=>$p['host'],'DB_PORT'=>(string)$p['port'],'DB_DATABASE'=>$p['database'],'DB_USERNAME'=>$p['username'],'DB_PASSWORD'=>$p['password'],'DB_URL'=>'','CACHE_STORE'=>'array','SESSION_DRIVER'=>'array','QUEUE_CONNECTION'=>'sync','MAIL_MAILER'=>'array','BROADCAST_CONNECTION'=>'null','DENTALOPS_LOCAL_TARGET'=>getenv('DENTALOPS_LOCAL_TARGET')?:'','CHART_DISPOSABLE_POSTGRES_ACCEPTANCE'=>'1'];}
}

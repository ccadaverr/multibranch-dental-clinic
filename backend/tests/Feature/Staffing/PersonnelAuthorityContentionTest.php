<?php
namespace Tests\Feature\Staffing;

use App\Enums\Role;
use App\Models\{AuditLog,DentistProfile,User};
use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Committed worker fixtures: refuse regular targets and require a fresh guarded test clone. */
class PersonnelAuthorityContentionTest extends TestCase
{
    use SchedulingFixture;
    protected function setUp(): void
    {
        $manifest=getenv('DENTALOPS_LOCAL_TARGET');
        if(!$manifest||!str_starts_with(basename(json_decode(file_get_contents($manifest),true)['runtime']),'contention-'))self::markTestSkipped('Use a fresh owned clone, not the regular workforce test database.');
        parent::setUp();self::assertSame(0,DB::table('users')->count(),'Fresh clone only');$this->setUpSchedulingWorld();
        $this->d['d1']->update(['legacy_ref'=>'ops-personnel']);
    }
    public function test_revoked_owner_cannot_change_personnel_after_a_real_database_wait(): void
    {
        foreach(['inactive','role','auth_version'] as $index=>$scenario){
            $this->u['owner']->forceFill(['role'=>Role::Owner,'account_status'=>'Active'])->save();
            $token=$this->u['owner']->createToken('personnel-a')->plainTextToken;
            $before=$this->d['d1']->fresh()->getAttributes();$branches=$this->d['d1']->branches()->pluck('branches.id')->all();$audit=AuditLog::count();
            DB::beginTransaction();$worker=null;
            try{
                User::whereKey($this->u['owner']->id)->lockForUpdate()->first();
                DentistProfile::whereKey($this->d['d1']->id)->lockForUpdate()->first();
                $name='personnel_a_'.getmypid().'_'.$index;
                $worker=new Process([PHP_BINARY,base_path('tests/Support/personnel_authority_worker.php')],base_path(),getenv(),json_encode(['worker'=>$name,'token'=>$token,'body'=>['specialty'=>'Synthetic refused change','branch_ids'=>['b2']]]),30);$worker->start();
                $deadline=microtime(true)+12;
                do{DB::selectOne('select pg_stat_clear_snapshot()');$waiting=(int)DB::selectOne("select count(*) as n from pg_stat_activity where application_name=? and wait_event_type='Lock'",[$name])->n;if($waiting)break;self::assertTrue($worker->isRunning());usleep(10000);}while(microtime(true)<$deadline);
                self::assertSame(1,$waiting,'Request reached a real PostgreSQL lock wait');
                match($scenario){'inactive'=>$this->u['owner']->update(['account_status'=>'Inactive']),'role'=>$this->u['owner']->update(['role'=>Role::Staff]),default=>$this->u['owner']->forceFill(['auth_version'=>$this->u['owner']->auth_version+1])->save()};
                DB::commit();self::assertSame(0,$worker->wait());$result=json_decode($worker->getOutput(),true,flags:JSON_THROW_ON_ERROR);
            }finally{if(DB::transactionLevel())DB::rollBack();if($worker?->isRunning())$worker->stop();}
            self::assertSame(403,$result['status'],$scenario);
            self::assertSame($before,$this->d['d1']->fresh()->getAttributes());self::assertSame($branches,$this->d['d1']->branches()->pluck('branches.id')->all());self::assertSame($audit,AuditLog::count());
        }
    }
}

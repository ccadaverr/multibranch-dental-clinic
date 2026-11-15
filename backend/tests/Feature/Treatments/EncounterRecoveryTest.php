<?php
namespace Tests\Feature\Treatments;

use App\Models\{Visit,Treatment,TreatmentHistory,QueueEntry,CommandKey,AuditLog};
use App\Services\Audit\AuditService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

final class EncounterRecoveryTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;
    protected function setUp(): void { parent::setUp();$this->setUpSchedulingWorld(); }
    private function arrive(bool $scheduled = false, string $patient = 'A'): Visit {
        $this->actingAsUser('staffB1');
        if($scheduled){$a=$this->existing($patient,'d1','b1','svc1','2026-09-28','11:00');$path='/api/visits/check-in';$body=['appointment_id'=>$a->public_id,'expected_revision'=>1];}
        else {$path='/api/visits/walk-in';$body=['patient_id'=>$this->p[$patient]->public_id,'branch_ref'=>'b1','service_ref'=>'svc1','dentist_ref'=>'d1'];}
        $id=$this->postJson($path,$body,['Idempotency-Key'=>'arrive-'.$patient])->assertCreated()->json('data.id');
        $v=Visit::where('public_id',$id)->sole();$q=$v->queueEntry;
        $this->postJson('/api/queue/'.$q->public_id.'/call',['expected_revision'=>1],['Idempotency-Key'=>'call-'.$patient])->assertOk();
        $this->actingAsUser('dentist1');return $v->fresh();
    }
    private function start(Visit $v,array $extra=[],string $key='observed-start') {
        return $this->postJson('/api/visits/'.$v->public_id.'/treatment',$extra+['expected_revision'=>1,'queue_id'=>$v->queueEntry->public_id,'expected_queue_revision'=>2],['Idempotency-Key'=>$key]);
    }
    public function test_scheduled_start_and_new_session_readback_preserve_every_identity_and_history(): void {
        $v=$this->arrive(true);$first=$this->start($v)->assertCreated()->assertJsonPath('data.status','In Treatment')->assertJsonPath('data.completed_at',null)->json('data');
        $this->app['auth']->forgetGuards();$this->actingAsUser('dentist1');
        $r=$this->getJson('/api/visits/'.$v->public_id.'/treatment')->assertOk()->assertJsonPath('meta.encounter_readback',true);
        foreach(['id','patient','branch','dentist','appointment','visit'] as $field)self::assertSame($first[$field],$r->json('data.'.$field));
        self::assertStringContainsString('no-store',$r->headers->get('Cache-Control'));
        $this->start($v)->assertCreated()->assertHeader('Idempotent-Replayed','true')->assertJsonPath('data.id',$first['id']);
        self::assertSame(1,Treatment::count());self::assertSame(1,TreatmentHistory::count());
        self::assertSame(1,AuditLog::where('action','treatment.started')->count());self::assertSame('In Treatment',$v->fresh()->status);self::assertSame('Served',$v->queueEntry()->sole()->status);
    }
    public function test_walkin_has_no_fabricated_appointment_and_recovery_never_creates_an_encounter(): void {
        $v=$this->arrive();$this->getJson('/api/visits/'.$v->public_id.'/treatment')->assertNotFound();self::assertSame(0,Treatment::count());
        $id=$this->start($v)->assertCreated()->assertJsonPath('data.appointment',null)->json('data.id');
        $this->getJson('/api/visits/'.$v->public_id.'/treatment')->assertOk()->assertJsonPath('data.id',$id)->assertJsonPath('data.appointment',null);
        $this->start($v,[],'another-command')->assertConflict()->assertJsonPath('code','treatment_exists');self::assertSame(1,Treatment::count());
    }
    public function test_original_queue_revision_and_identity_are_never_rebased(): void {
        $v=$this->arrive();
        $this->start($v,['expected_queue_revision'=>1])->assertConflict()->assertJsonPath('code','queue_context_changed');
        $this->start($v,['queue_id'=>$this->p['B']->public_id])->assertConflict();
        $this->start($v,['patient_id'=>$this->p['B']->public_id])->assertUnprocessable();
        $this->start($v,['queue_id'=>null])->assertUnprocessable();
        self::assertSame(0,Treatment::count());self::assertSame(0,CommandKey::where('command','treatment.start')->count());
        self::assertSame('Checked In',$v->fresh()->status);self::assertSame('Called',$v->queueEntry()->sole()->status);
        $this->start($v)->assertCreated();
        $this->start($v,['expected_queue_revision'=>3])->assertUnprocessable()->assertJsonPath('code','idempotency_key_reused');
    }
    public function test_foreign_dentist_and_nonclinical_roles_cannot_start_or_read_this_encounter(): void {
        $v=$this->arrive();$id=$this->start($v)->assertCreated()->json('data.id');
        foreach(['dentist2','dentist3','staffB1','owner','patientA','patientB'] as $actor){
            $this->actingAsUser($actor);$this->getJson('/api/visits/'.$v->public_id.'/treatment')->assertForbidden();
            $this->start($v,[],'foreign-'.$actor)->assertForbidden();
        }
        self::assertSame($id,Treatment::sole()->public_id);
    }
    public function test_reassignment_denies_old_dentist_even_for_same_key_replay_and_readback(): void {
        $v=$this->arrive();$this->start($v)->assertCreated();
        $v->update(['responsible_dentist_profile_id'=>$this->d['d2']->id]);
        $this->start($v)->assertForbidden();$this->getJson('/api/visits/'.$v->public_id.'/treatment')->assertForbidden();self::assertSame(1,Treatment::count());
    }
    public function test_account_revocation_between_controller_and_transaction_leaves_no_partial_start(): void {
        $v=$this->arrive();$actor=$this->u['dentist1'];$fired=false;
        DB::connection()->beforeExecuting(function($sql)use(&$fired,$actor){if(!$fired&&str_starts_with(strtolower(ltrim($sql)),'insert into "command_keys"')){$fired=true;$actor->increment('auth_version');}});
        $this->start($v)->assertForbidden();self::assertTrue($fired);self::assertSame(0,Treatment::count());self::assertSame('Called',$v->queueEntry()->sole()->status);
    }
    public function test_audit_failure_rolls_back_the_whole_reviewed_start(): void {
        $v=$this->arrive();$this->mock(AuditService::class,fn($m)=>$m->shouldReceive('record')->andThrow(new \RuntimeException('Synthetic audit refusal')));
        $this->withoutExceptionHandling();try{$this->start($v);self::fail('Audit refusal must propagate');}catch(\RuntimeException $e){self::assertSame('Synthetic audit refusal',$e->getMessage());}
        self::assertSame(0,Treatment::count());self::assertSame(0,TreatmentHistory::count());self::assertSame('Checked In',$v->fresh()->status);self::assertSame('Called',$v->queueEntry()->sole()->status);
    }
}

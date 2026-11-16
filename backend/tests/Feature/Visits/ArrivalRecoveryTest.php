<?php
namespace Tests\Feature\Visits;

use App\Models\Appointment;
use App\Models\AuditLog;
use App\Models\CommandKey;
use App\Models\Patient;
use App\Models\QueueEntry;
use App\Models\UserBranchScope;
use App\Models\Visit;
use App\Services\Audit\AuditService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

final class ArrivalRecoveryTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;
    protected function setUp(): void { parent::setUp();$this->setUpSchedulingWorld();$this->actingAsUser('staffB1'); }
    private function appointment(): Appointment { return $this->existing('A','d1','b1','svc1','2026-09-28','11:00'); }
    private function arrive(Appointment $a,array $extra=[]) { return $this->postJson('/api/visits/check-in',$extra+['appointment_id'=>$a->public_id,'expected_revision'=>1,'id_confirmed'=>true],['Idempotency-Key'=>'arrival-observed-1']); }
    private function walk(array $extra=[]) { return $this->postJson('/api/visits/walk-in',$extra+['patient_id'=>$this->p['A']->public_id,'branch_ref'=>'b1','service_ref'=>'svc1','dentist_ref'=>'d1'],['Idempotency-Key'=>'walk-observed-1']); }
    public function test_scheduled_receipt_recovers_exact_visit_and_queue_after_new_authentication(): void {
        $a=$this->appointment();$original=$this->arrive($a)->assertCreated()->json();$id=$original['data']['id'];
        $this->app['auth']->forgetGuards();$this->actingAsUser('staffB1');
        $read=$this->getJson('/api/visits/'.$id.'/arrival-receipt')->assertOk()->assertJsonPath('meta.historical_receipt',true);
        self::assertSame($original,$read->json('data'));self::assertStringContainsString('no-store',$read->headers->get('Cache-Control'));
        $this->arrive($a)->assertCreated()->assertHeader('Idempotent-Replayed','true')->assertJsonPath('data.id',$id);
        self::assertSame(1,Visit::count());self::assertSame(1,QueueEntry::count());self::assertSame(1,CommandKey::count());
        self::assertSame('Checked In',$a->fresh()->status);self::assertSame('Waiting',QueueEntry::sole()->status);
        self::assertSame(1,AuditLog::where('action','visit.id_presented_confirmed')->count());
    }
    public function test_walkin_receipt_preserves_unbooked_encounter_context(): void {
        $original=$this->walk()->assertCreated()->assertJsonPath('data.appointment',null)->json();
        $this->getJson('/api/visits/'.$original['data']['id'].'/arrival-receipt')->assertOk()->assertJsonPath('data',$original);
        self::assertSame(0,Appointment::count());self::assertSame(Visit::sole()->id,QueueEntry::sole()->visit_id);
        $this->walk()->assertCreated()->assertHeader('Idempotent-Replayed','true');self::assertSame(1,Visit::count());
    }
    public function test_receipt_is_not_disclosed_to_another_staff_account_or_clinical_patient_roles(): void {
        $id=$this->arrive($this->appointment())->assertCreated()->json('data.id');
        foreach(['staffBoth','staffB2','patientA','patientB','dentist1','owner'] as $who){
            $this->actingAsUser($who);$r=$this->getJson('/api/visits/'.$id.'/arrival-receipt');
            if(in_array($who,['patientA','patientB','dentist1']))$r->assertForbidden();else $r->assertNotFound();
            self::assertStringNotContainsString($this->p['A']->public_id,$r->getContent());
        }
    }
    public function test_scope_revocation_denies_replay_and_receipt_without_another_mutation(): void {
        $a=$this->appointment();$id=$this->arrive($a)->assertCreated()->json('data.id');
        UserBranchScope::where('user_id',$this->u['staffB1']->id)->update(['branch_id'=>$this->b['b2']->id]);
        $this->arrive($a)->assertForbidden();$this->getJson('/api/visits/'.$id.'/arrival-receipt')->assertNotFound();
        self::assertSame(1,Visit::count());self::assertSame(1,CommandKey::count());
    }
    public function test_wrong_patient_and_branch_fields_cannot_override_a_scheduled_context(): void {
        $a=$this->appointment();$this->arrive($a,['patient_id'=>$this->p['B']->public_id])->assertUnprocessable();
        $this->arrive($a,['branch_ref'=>'b2'])->assertUnprocessable();self::assertSame(0,Visit::count());
        $this->walk(['branch_ref'=>'b2','dentist_ref'=>'d3'])->assertForbidden();
    }
    public function test_explicit_false_id_confirmation_refuses_and_old_contract_remains_compatible(): void {
        $a=$this->appointment();$this->arrive($a,['id_confirmed'=>false])->assertUnprocessable();self::assertSame(0,Visit::count());
        // This sprint does not invent a global ID-type/minor/HMO policy or break approved older callers.
        $this->postJson('/api/visits/check-in',['appointment_id'=>$a->public_id,'expected_revision'=>1],['Idempotency-Key'=>'older-compatible-client'])->assertCreated();
    }
    public function test_changed_patient_in_a_receipt_cannot_be_adopted(): void {
        $id=$this->walk()->assertCreated()->json('data.id');
        $v=Visit::where('public_id',$id)->firstOrFail();$v->update(['patient_id'=>$this->p['B']->id]);
        $this->getJson('/api/visits/'.$id.'/arrival-receipt')->assertNotFound();
    }
    public function test_current_authority_is_rechecked_inside_the_arrival_transaction(): void {
        $a=$this->appointment();$user=$this->u['staffB1'];
        // Scope changes after the controller authorized, before the journal callback locks the appointment.
        $fired=false;DB::connection()->beforeExecuting(function($sql)use(&$fired,$user){
            if(!$fired&&str_starts_with(strtolower(ltrim($sql)),'insert into "command_keys"')){$fired=true;UserBranchScope::where('user_id',$user->id)->update(['branch_id'=>$this->b['b2']->id]);}
        });
        $this->arrive($a)->assertForbidden();self::assertTrue($fired);self::assertSame(0,Visit::count());self::assertSame(0,CommandKey::count());
        self::assertSame('Confirmed',$a->fresh()->status);
    }
}

<?php
namespace Tests\Feature\Charts;
use App\Models\{ToothChartEntry,CommandKey,AuditLog,Treatment,Visit};
use App\Services\Audit\AuditService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;
final class ChartCommandRecoveryTest extends TestCase
{
 use DatabaseTransactions,SchedulingFixture;
 protected function setUp():void{parent::setUp();$this->setUpSchedulingWorld();$this->existing('A','d1','b1','svc1','2026-09-29','10:00');$this->actingAsUser('dentist1');}
 private function record(array $extra=[],string $key='chart-observed'){
  return $this->postJson('/api/patients/'.$this->p['A']->public_id.'/chart',$extra+['tooth'=>'36','status'=>'Caries','surfaces'=>['O'],'note'=>'Synthetic private finding','recorded_on'=>'2026-09-28','branch_ref'=>'b1','expected_revision'=>0],['Idempotency-Key'=>$key]);
 }
 private function treatment():array{
  $this->actingAsUser('staffB1');$v=$this->postJson('/api/visits/walk-in',['patient_id'=>$this->p['A']->public_id,'branch_ref'=>'b1','service_ref'=>'svc1','dentist_ref'=>'d1'],['Idempotency-Key'=>'chart-arrive'])->assertCreated()->json('data');
  $this->postJson('/api/queue/'.$v['queue']['id'].'/call',['expected_revision'=>1],['Idempotency-Key'=>'chart-call'])->assertOk();$this->actingAsUser('dentist1');
  return $this->postJson('/api/visits/'.$v['id'].'/treatment',['expected_revision'=>1],['Idempotency-Key'=>'chart-start'])->assertCreated()->json('data');
 }
 public function test_same_command_new_auth_recovers_exact_entry_revision_without_duplicate_history_or_audit():void{
  $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertOk()->assertJsonPath('data.write_contract.version',1);
  $first=$this->record()->assertCreated()->assertJsonPath('meta.chart_receipt.revision',1)->json();$id=$first['meta']['chart_receipt']['entry_id'];
  $this->app['auth']->forgetGuards();$this->actingAsUser('dentist1');$r=$this->record()->assertCreated()->assertHeader('Idempotent-Replayed','true');self::assertSame($first,$r->json());
  $this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertOk()->assertJsonPath('data.tooth_revisions.36',1)->assertJsonPath('data.history.0.id',$id)->assertJsonPath('data.history.0.branch.id','b1');
  self::assertSame(1,ToothChartEntry::count());self::assertSame(1,AuditLog::where('action','chart.recorded')->count());self::assertSame(1,CommandKey::where('command','chart.record')->count());
 }
 public function test_original_revision_is_not_rebased_and_original_receipt_is_distinct_from_current_chart():void{
  $first=$this->record()->assertCreated()->json();$old=ToothChartEntry::sole()->getRawOriginal();
  $this->record(['status'=>'Filled','expected_revision'=>0],'stale')->assertConflict()->assertJsonPath('code','chart_revision_changed');
  $this->record(['status'=>'Filled','expected_revision'=>1],'next')->assertCreated()->assertJsonPath('meta.chart_receipt.revision',2);
  self::assertSame($old,ToothChartEntry::orderBy('id')->first()->getRawOriginal());
  self::assertSame($first,$this->record()->assertCreated()->json());$this->getJson('/api/patients/'.$this->p['A']->public_id.'/chart')->assertOk()->assertJsonPath('data.tooth_revisions.36',2);
  $this->record(['note'=>'Changed payload'])->assertUnprocessable()->assertJsonPath('code','idempotency_key_reused');self::assertSame(2,ToothChartEntry::count());
 }
 public function test_linked_finding_keeps_exact_patient_treatment_visit_branch_without_modifying_documentation():void{
  $t=$this->treatment();$before=Treatment::sole()->getRawOriginal();$visit=Visit::sole()->getRawOriginal();
  $this->record(['treatment_id'=>$t['id'],'expected_treatment_revision'=>1])->assertCreated()->assertJsonPath('meta.chart_receipt.treatment_id',$t['id'])->assertJsonPath('meta.chart_receipt.visit_id',$t['visit']['id'])->assertJsonPath('data.history.0.treatment_id',$t['id']);
  self::assertSame($before,Treatment::sole()->getRawOriginal());self::assertSame($visit,Visit::sole()->getRawOriginal());
  $this->record(['treatment_id'=>$t['id'],'expected_treatment_revision'=>1,'branch_ref'=>'b2','tooth'=>'37'],'wrong-branch')->assertUnprocessable();
  $this->record(['treatment_id'=>$t['id'],'expected_treatment_revision'=>2,'tooth'=>'37'],'stale-treatment')->assertConflict()->assertJsonPath('code','chart_treatment_changed');self::assertSame(1,ToothChartEntry::count());
  $this->d['d1']->branches()->detach($this->b['b1']->id);$this->record(['treatment_id'=>$t['id'],'expected_treatment_revision'=>1,'tooth'=>'37'],'removed-branch')->assertUnprocessable();
 }
 public function test_chart_append_preserves_completed_encounter_and_its_procedure_history():void{
  $t=$this->treatment();$this->postJson('/api/treatments/'.$t['id'].'/document',['expected_revision'=>1,'procedure_summary'=>'Synthetic completed history','prescription_required'=>false,'followup_required'=>false,'procedures'=>[['service_ref'=>'svc1','quantity'=>1]]],['Idempotency-Key'=>'chart-historical-document'])->assertOk();
  $this->postJson('/api/treatments/'.$t['id'].'/complete',['expected_revision'=>2],['Idempotency-Key'=>'chart-historical-complete'])->assertOk();
  $before=[Treatment::sole()->getRawOriginal(),Visit::sole()->getRawOriginal(),DB::table('treatment_procedures')->get()->toArray(),DB::table('treatment_history')->get()->toArray()];
  $this->record(['treatment_id'=>$t['id'],'expected_treatment_revision'=>3])->assertCreated()->assertJsonPath('meta.chart_receipt.treatment_revision',3);
  self::assertEquals($before,[Treatment::sole()->getRawOriginal(),Visit::sole()->getRawOriginal(),DB::table('treatment_procedures')->get()->toArray(),DB::table('treatment_history')->get()->toArray()]);
  $this->postJson('/api/treatments/'.$t['id'].'/document',['expected_revision'=>3,'procedure_summary'=>'Must not overwrite history'],['Idempotency-Key'=>'chart-forbidden-historical-edit'])->assertUnprocessable();
 }
 public function test_foreign_treatment_and_patient_identity_overrides_are_refused_without_any_entry():void{
  $this->record(['treatment_id'=>$this->p['B']->public_id,'expected_treatment_revision'=>1])->assertUnprocessable();
  $this->record(['patient_id'=>$this->p['B']->public_id])->assertUnprocessable();$this->record(['visit_id'=>$this->p['B']->public_id])->assertUnprocessable();
  $this->record(['branch_ref'=>'b2'])->assertUnprocessable();self::assertSame(0,ToothChartEntry::count());
 }
 public function test_role_patient_isolation_and_current_authority_apply_before_replay():void{
  $this->record()->assertCreated();foreach(['dentist2','dentist3','staffB1','owner','patientB']as$actor){$this->actingAsUser($actor);$this->record()->assertForbidden();}
  $this->actingAsUser('patientA');$r=$this->getJson('/api/me/chart')->assertOk()->assertJsonPath('data.history',null);foreach(['note','branch','visit_id','treatment_id','created_at']as$field)self::assertArrayNotHasKey($field,$r->json('data.current.0'));
  $this->getJson('/api/me/chart?patient_id='.$this->p['B']->public_id)->assertNotFound();
  $this->actingAsUser('dentist1');DB::table('users')->where('id',$this->u['dentist1']->id)->update(['account_status'=>'Suspended']);$this->record()->assertForbidden();self::assertSame(1,ToothChartEntry::count());
 }
 public function test_audit_failure_rolls_back_entry_revision_and_receipt():void{
  $this->mock(AuditService::class,fn($m)=>$m->shouldReceive('recordAdministrative')->andThrow(new \RuntimeException('Synthetic chart audit refusal')));
  $this->withoutExceptionHandling();try{$this->record();self::fail('Audit refusal must propagate');}catch(\RuntimeException $e){self::assertSame('Synthetic chart audit refusal',$e->getMessage());}
  self::assertSame(0,ToothChartEntry::count());self::assertSame(0,CommandKey::where('command','chart.record')->count());
 }
 public function test_revision_command_requires_key_and_complete_link_pair():void{
  $this->postJson('/api/patients/'.$this->p['A']->public_id.'/chart',['tooth'=>'36','status'=>'Caries','expected_revision'=>0])->assertUnprocessable();
  $t=$this->treatment();$this->record(['treatment_id'=>$t['id']])->assertUnprocessable()->assertJsonValidationErrors('expected_treatment_revision');self::assertSame(0,ToothChartEntry::count());
 }
}

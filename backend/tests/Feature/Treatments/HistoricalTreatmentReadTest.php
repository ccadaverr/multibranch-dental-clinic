<?php
namespace Tests\Feature\Treatments;
use App\Models\{Treatment,Visit};
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;
final class HistoricalTreatmentReadTest extends TestCase {
 use DatabaseTransactions,SchedulingFixture;
 protected function setUp():void{parent::setUp();$this->setUpSchedulingWorld();}
 private function completed(string $patient='A',string $dentist='d1'):array{
  $key='history-'.$patient.'-'.Treatment::count();$this->actingAsUser('staffB1');$v=$this->postJson('/api/visits/walk-in',['patient_id'=>$this->p[$patient]->public_id,'branch_ref'=>'b1','service_ref'=>'svc1','dentist_ref'=>$dentist],['Idempotency-Key'=>$key.'-arrival'])->assertCreated()->json('data');
  $this->postJson('/api/queue/'.$v['queue']['id'].'/call',['expected_revision'=>1],['Idempotency-Key'=>$key.'-call'])->assertOk();$this->actingAsUser($dentist==='d1'?'dentist1':'dentist2');
  $t=$this->postJson('/api/visits/'.$v['id'].'/treatment',['expected_revision'=>1],['Idempotency-Key'=>$key.'-start'])->assertCreated()->json('data');
  $this->postJson('/api/treatments/'.$t['id'].'/document',['expected_revision'=>1,'procedure_summary'=>'Synthetic historical care '.$patient,'clinical_notes'=>'Synthetic private history '.$patient,'prescription_required'=>false,'followup_required'=>false,'procedures'=>[['service_ref'=>'svc1','quantity'=>1]]],['Idempotency-Key'=>$key.'-document'])->assertOk();
  return $this->postJson('/api/treatments/'.$t['id'].'/complete',['expected_revision'=>2],['Idempotency-Key'=>$key.'-complete'])->assertOk()->json('data');
 }
 public function test_exact_patient_history_crosses_default_window_and_paginates_without_mutation():void{
  $one=$this->completed();$two=$this->completed();$this->completed('B');$before=[Treatment::all()->toArray(),Visit::all()->toArray(),DB::table('treatment_history')->count()];
  $this->travelTo(CarbonImmutable::parse('2028-10-01 10:00:00','Asia/Manila'));$this->actingAsUser('dentist1');
  $this->getJson('/api/treatments')->assertOk()->assertJsonCount(0,'data');
  $path='/api/treatments?patient_id='.$this->p['A']->public_id.'&status=Completed&per_page=1';
  $this->getJson($path)->assertOk()->assertHeader('Cache-Control','no-store, private')->assertJsonCount(1,'data')->assertJsonPath('data.0.id',$two['id'])->assertJsonPath('meta.last_page',2);
  $this->getJson($path.'&page=2')->assertOk()->assertJsonPath('data.0.id',$one['id']);
  $this->getJson('/api/treatments/'.$one['id'])->assertOk()->assertHeader('Cache-Control','no-store, private')->assertJsonPath('data.history.1.snapshot.clinical_notes','Synthetic private history A');
  self::assertEquals($before,[Treatment::all()->toArray(),Visit::all()->toArray(),DB::table('treatment_history')->count()]);
 }
 public function test_history_preserves_role_branch_and_current_continuity_authority():void{
  $t=$this->completed();$path='/api/treatments?patient_id='.$this->p['A']->public_id;
  foreach(['dentist2','dentist3','staffB2']as$role){$this->actingAsUser($role);$this->getJson($path)->assertOk()->assertJsonCount(0,'data');$this->getJson('/api/treatments/'.$t['id'])->assertForbidden();}
  $this->actingAsUser('patientA');$this->getJson('/api/treatments/'.$t['id'])->assertForbidden();$this->getJson('/api/treatments/mine')->assertOk()->assertJsonMissingPath('data.0.clinical_notes');
  $this->actingAsUser('staffB1');$v=$this->postJson('/api/visits/walk-in',['patient_id'=>$this->p['A']->public_id,'branch_ref'=>'b1','service_ref'=>'svc1','dentist_ref'=>'d2'],['Idempotency-Key'=>'history-continuity'])->assertCreated()->json('data');
  $this->actingAsUser('dentist2');$this->getJson($path)->assertOk()->assertJsonPath('data.0.id',$t['id']);$this->getJson('/api/treatments/'.$t['id'])->assertOk()->assertJsonPath('data.author',false)->assertJsonMissingPath('data.history.0.snapshot');
  $this->postJson('/api/treatments/'.$t['id'].'/document',['expected_revision'=>3,'prescription_required'=>false,'followup_required'=>false,'procedures'=>[]],['Idempotency-Key'=>'forbidden-history-edit'])->assertForbidden();
  $this->actingAsUser('staffB1');$this->getJson($path)->assertOk()->assertJsonMissingPath('data.0.history');
  $this->actingAsUser('owner');$this->getJson($path)->assertOk()->assertJsonMissingPath('data.0.clinical_notes');
 }
 public function test_history_never_silently_ignores_requested_state_or_patient_filter():void{
  $this->completed();$this->actingAsUser('dentist1');$this->getJson('/api/treatments?patient_id=invalid')->assertUnprocessable();
  $this->getJson('/api/treatments?patient_id='.$this->p['A']->public_id.'&status=In%20Treatment')->assertUnprocessable();
  $this->getJson('/api/treatments?patient_id='.$this->p['B']->public_id)->assertOk()->assertJsonCount(0,'data');
 }
}

<?php
namespace Tests\Feature\Intake;
use App\Models\{Patient,Person,PatientGuardian,CommandKey,AuditLog};
use App\Services\Audit\AuditService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;
final class DependentCreationRecoveryTest extends TestCase {
 use DatabaseTransactions,SchedulingFixture;
 protected function setUp():void{parent::setUp();$this->setUpSchedulingWorld();foreach(['A','B']as$key)$this->p[$key]->person->update(['date_of_birth'=>'1985-01-01']);$this->actingAsUser('patientA');}
 private function payload(array $patch=[]):array{return $patch+['first_name'=>'Synthetic','last_name'=>'Dependent','date_of_birth'=>'2016-02-02','relationship'=>'Other','relationship_other'=>'Niece','consent'=>true];}
 private function create(array $patch=[],string $key='dependent-original'){return $this->postJson('/api/me/dependents',$this->payload($patch),['Idempotency-Key'=>$key]);}
 public function test_same_command_recovers_one_patient_and_link_after_new_authenticated_session():void{
  $before=Patient::count();$first=$this->create()->assertCreated()->json();$this->app['auth']->forgetGuards();$this->actingAsUser('patientA');
  $again=$this->create()->assertCreated()->json();self::assertSame($first['data']['id'],$again['data']['id']);self::assertSame($before+1,Patient::count());self::assertSame(1,PatientGuardian::count());
  $this->getJson('/api/me/dependents/creation-receipt',['Idempotency-Key'=>'dependent-original'])->assertOk()->assertJsonPath('data.id',$first['data']['id']);
  self::assertSame(1,AuditLog::where('action','patient.guardian_linked')->count());
 }
 public function test_original_creation_receipt_and_current_ownership_are_not_name_matching():void{
  $first=$this->create()->assertCreated()->json();$this->create(['first_name'=>'Different'])->assertUnprocessable();
  $this->actingAsUser('patientB');$this->getJson('/api/me/dependents/creation-receipt',['Idempotency-Key'=>'dependent-original'])->assertNotFound();$this->getJson('/api/me/dependents')->assertOk()->assertJsonCount(0,'data');
  $this->actingAsUser('patientA');PatientGuardian::sole()->update(['status'=>'ended','ended_at'=>now(),'ended_reason'=>'claimed_own_account']);
  $this->getJson('/api/me/dependents/creation-receipt',['Idempotency-Key'=>'dependent-original'])->assertNotFound();$this->create()->assertNotFound();self::assertSame(1,PatientGuardian::count());
 }
 public function test_a_minor_foreign_actor_is_refused_before_any_creation_receipt_can_be_disclosed():void{
  $this->create()->assertCreated();$before=[Patient::count(),PatientGuardian::count(),AuditLog::count()];
  $this->p['B']->person->update(['date_of_birth'=>'2016-01-01']);$this->actingAsUser('patientB');
  $known=$this->getJson('/api/me/dependents/creation-receipt',['Idempotency-Key'=>'dependent-original'])->assertUnprocessable()->json();
  $unknown=$this->getJson('/api/me/dependents/creation-receipt',['Idempotency-Key'=>'dependent-unknown'])->assertUnprocessable()->json();
  self::assertSame($known,$unknown);self::assertSame($before,[Patient::count(),PatientGuardian::count(),AuditLog::count()]);
 }
 public function test_other_is_required_cleared_and_persisted_and_legacy_or_identity_overrides_are_refused():void{
  $this->create(['relationship_other'=>'  '])->assertUnprocessable()->assertJsonValidationErrors('relationship_other');
  $this->create(['guardian_patient_id'=>$this->p['B']->public_id])->assertUnprocessable();$this->postJson('/api/me/dependents',$this->payload())->assertUnprocessable();
  $this->create(['relationship'=>'Child','relationship_other'=>'discarded'],'dependent-child')->assertCreated()->assertJsonPath('data.relationship_other',null);
  self::assertNull(PatientGuardian::sole()->relationship_other);$this->getJson('/api/me/dependents')->assertOk()->assertJsonPath('meta.creation_contract.version',1)->assertJsonPath('meta.me.id',$this->p['A']->public_id);
 }
 public function test_current_account_revocation_refuses_original_receipt_without_new_records():void{
  $this->create()->assertCreated();$count=Patient::count();DB::table('users')->where('id',$this->u['patientA']->id)->update(['account_status'=>'Suspended']);
  $this->create()->assertForbidden();$this->getJson('/api/me/dependents/creation-receipt',['Idempotency-Key'=>'dependent-original'])->assertForbidden();self::assertSame($count,Patient::count());
 }
 public function test_other_roles_and_signed_out_requests_cannot_create_or_read_a_patient_receipt():void{
  $this->create()->assertCreated();$count=Patient::count();
  foreach(['staffB1','dentist1','owner']as$role){$this->actingAsUser($role);$this->create()->assertForbidden();$this->getJson('/api/me/dependents/creation-receipt',['Idempotency-Key'=>'dependent-original'])->assertForbidden();}
  $this->app['auth']->forgetGuards();$this->create()->assertUnauthorized();$this->getJson('/api/me/dependents/creation-receipt',['Idempotency-Key'=>'dependent-original'])->assertUnauthorized();self::assertSame($count,Patient::count());
 }
 public function test_audit_failure_rolls_back_every_record():void{
  $before=[Patient::count(),Person::count()];$this->mock(AuditService::class,fn($m)=>$m->shouldReceive('recordAdministrative')->andThrow(new \RuntimeException('Synthetic dependent audit refusal')));
  $this->withoutExceptionHandling();try{$this->create();self::fail('Audit failure must propagate');}catch(\RuntimeException $e){self::assertSame('Synthetic dependent audit refusal',$e->getMessage());}
  self::assertSame($before,[Patient::count(),Person::count()]);self::assertSame(0,PatientGuardian::count());self::assertSame(0,CommandKey::where('command','patient.dependent.create')->count());
 }
}

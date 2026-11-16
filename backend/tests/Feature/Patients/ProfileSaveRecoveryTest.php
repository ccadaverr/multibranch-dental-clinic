<?php
namespace Tests\Feature\Patients;
use App\Models\{AuditLog,CommandKey,UserBranchScope};
use App\Services\Audit\AuditService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

final class ProfileSaveRecoveryTest extends TestCase
{
 use DatabaseTransactions,SchedulingFixture;
 protected function setUp():void{parent::setUp();$this->setUpSchedulingWorld();$this->existing('A','d1','b1','svc1','2026-09-28','11:00');$this->actingAsUser('staffB1');}
 private function save(array $extra=[],string $key='profile-observed'){return $this->patchJson('/api/patients/'.$this->p['A']->public_id,$extra+['expected_revision'=>1,'emergency_contact'=>'Synthetic contact'],['Idempotency-Key'=>$key]);}
 public function test_lost_save_recovers_original_receipt_after_new_auth_without_another_revision_or_audit():void{
  $saved=$this->save()->assertOk()->assertJsonPath('data.id',$this->p['A']->public_id)->assertJsonPath('data.revision',2)->assertJsonPath('meta.unchanged',false);self::assertStringContainsString('no-store',$saved->headers->get('Cache-Control'));$first=$saved->json();
  $this->app['auth']->forgetGuards();$this->actingAsUser('staffB1');$retry=$this->save()->assertOk()->assertHeader('Idempotent-Replayed','true')->json();self::assertSame($first,$retry);
  $this->getJson('/api/patients/'.$this->p['A']->public_id)->assertOk()->assertJsonPath('data.revision',2)->assertJsonPath('data.emergency_contact','Synthetic contact');
  self::assertSame(1,AuditLog::where('action','patient.profile.updated')->count());self::assertSame(1,CommandKey::where('command','patient.profile.update')->count());
 }
 public function test_changed_payload_and_patient_cannot_reuse_a_committed_command_identity():void{
  $this->save()->assertOk();$this->save(['emergency_contact'=>'Different'])->assertUnprocessable()->assertJsonPath('code','idempotency_key_reused');
  $this->existing('B','d1','b1','svc1','2026-09-28','13:00');
  $this->patchJson('/api/patients/'.$this->p['B']->public_id,['expected_revision'=>1,'emergency_contact'=>'Synthetic contact'],['Idempotency-Key'=>'profile-observed'])->assertUnprocessable();self::assertSame(1,$this->p['B']->fresh()->revision);
 }
 public function test_stale_revision_and_role_branch_denials_leave_no_journal_or_false_success():void{
  $this->save(['expected_revision'=>9])->assertConflict();
  foreach(['staffB2','dentist1','patientA','owner']as$actor){$this->actingAsUser($actor);$r=$this->save();$r->assertForbidden();self::assertStringNotContainsString('Synthetic contact',$r->getContent());}
  self::assertSame(1,$this->p['A']->fresh()->revision);self::assertSame(0,CommandKey::where('command','patient.profile.update')->count());
 }
 public function test_revoked_authority_cannot_read_a_previous_full_profile_save_receipt():void{
  $this->save()->assertOk();UserBranchScope::where('user_id',$this->u['staffB1']->id)->update(['branch_id'=>$this->b['b2']->id]);
  $r=$this->save()->assertForbidden();self::assertStringNotContainsString('Synthetic contact',$r->getContent());self::assertSame(2,$this->p['A']->fresh()->revision);
 }
 public function test_authority_is_rechecked_inside_the_transaction_and_audit_failure_rolls_back():void{
  $actor=$this->u['staffB1'];$fired=false;DB::connection()->beforeExecuting(function($sql)use(&$fired,$actor){if(!$fired&&str_starts_with(strtolower(ltrim($sql)),'insert into "command_keys"')){$fired=true;$actor->increment('auth_version');}});
  $this->save()->assertForbidden();self::assertTrue($fired);self::assertSame(1,$this->p['A']->fresh()->revision);self::assertSame(0,CommandKey::where('command','patient.profile.update')->count());
 }
 public function test_audit_refusal_rolls_back_profile_and_command_receipt():void{
  $this->mock(AuditService::class,fn($m)=>$m->shouldReceive('recordClinical')->andThrow(new \RuntimeException('Synthetic profile audit refusal')));
  $this->withoutExceptionHandling();try{$this->save();self::fail('Audit failure must propagate');}catch(\RuntimeException $e){self::assertSame('Synthetic profile audit refusal',$e->getMessage());}
  self::assertSame(1,$this->p['A']->fresh()->revision);self::assertNull($this->p['A']->fresh()->emergency_contact);self::assertSame(0,CommandKey::where('command','patient.profile.update')->count());
 }
 public function test_no_change_receipt_is_explicit_and_older_unkeyed_clients_remain_compatible():void{
  $name=$this->p['A']->person->first_name;
  $this->save(['emergency_contact'=>null,'first_name'=>$name])->assertOk()->assertJsonPath('data.revision',1)->assertJsonPath('meta.unchanged',true);
  $this->patchJson('/api/patients/'.$this->p['A']->public_id,['expected_revision'=>1,'emergency_contact'=>'Legacy compatible'])->assertOk()->assertJsonPath('data.revision',2);
 }
}

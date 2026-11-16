<?php
namespace Tests\Feature\Staffing;

use App\Models\AuditLog;
use App\Services\Audit\AuditService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class PersonnelUpdateReadbackTest extends TestCase
{
    use DatabaseTransactions,SchedulingFixture;
    protected function setUp(): void {parent::setUp();$this->setUpSchedulingWorld();}
    public function test_current_owner_gets_exact_persisted_personnel_and_one_audit_for_a_repeated_noop(): void
    {
        $this->actingAsUser('owner');$body=['specialty'=>'Synthetic personnel specialty','branch_ids'=>['b2']];
        $saved=$this->patchJson('/api/dentists/d1',$body)->assertOk()->assertJsonPath('data.id','d1')->assertJsonPath('data.specialty',$body['specialty'])->assertJsonPath('data.branch_ids',['b2'])->json('data');
        $this->assertSame($body['specialty'],$this->d['d1']->fresh()->specialty);
        $this->assertSame(['b2'],$this->d['d1']->branches()->pluck('legacy_ref')->all());
        $this->assertEquals($saved,collect($this->getJson('/api/dentists')->assertOk()->json('data'))->firstWhere('id','d1'));
        $this->patchJson('/api/dentists/d1',$body)->assertOk();
        $audit=AuditLog::where('action','dentist_profile.updated')->sole();
        $this->assertSame('d1',$audit->auditable_public_id);$this->assertSame($this->u['owner']->id,$audit->actor_user_id);
        $this->assertSame(['branch_ids','specialty'],$audit->payload['changed_fields']);
        $this->assertStringNotContainsString($body['specialty'],json_encode($audit->payload));
    }
    public function test_failed_audit_rolls_back_personnel_fields_and_branch_assignment(): void
    {
        $this->actingAsUser('owner');$before=$this->d['d1']->fresh()->getAttributes();$branches=$this->d['d1']->branches()->pluck('branches.id')->all();
        $this->app->bind(AuditService::class,fn()=>new class extends AuditService {public function record(array $a): AuditLog {parent::record($a);throw new \RuntimeException('Synthetic personnel audit failure');}});
        $this->withoutExceptionHandling();try{$this->patchJson('/api/dentists/d1',['specialty'=>'Refused change','branch_ids'=>['b2']]);$this->fail('Audit failure must refuse completion');}catch(\RuntimeException $e){$this->assertSame('Synthetic personnel audit failure',$e->getMessage());}
        $this->assertSame($before,$this->d['d1']->fresh()->getAttributes());$this->assertSame($branches,$this->d['d1']->branches()->pluck('branches.id')->all());$this->assertSame(0,AuditLog::where('action','dentist_profile.updated')->count());
    }
    public function test_other_roles_cannot_mutate_personnel_or_emit_success_audits(): void
    {
        foreach(['staffB1','dentist1','patientA'] as $who){$this->actingAsUser($who);$this->patchJson('/api/dentists/d1',['specialty'=>'Forbidden change'])->assertForbidden();}
        $this->assertSame(0,AuditLog::where('action','dentist_profile.updated')->count());
    }
}

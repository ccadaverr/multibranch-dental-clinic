<?php
namespace Tests\Feature\Intake;
use App\Models\AuditLog;
use App\Services\Audit\AuditService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

final class IdVerificationAtomicityTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;
    protected function setUp(): void { parent::setUp();$this->setUpSchedulingWorld();$this->actingAsUser('staffB1'); }
    private function appointment() { return $this->existing('A','d1','b1','svc1','2026-09-28','11:00'); }
    public function test_id_check_has_exact_patient_identity_and_persists_trimmed_other_details(): void {
        $this->appointment();$p=$this->p['A'];
        $this->postJson('/api/patients/'.$p->public_id.'/verify-id',['id_type'=>'other','other_details'=>'   Synthetic barangay ID   '])->assertOk()
            ->assertJsonPath('data.patient_id',$p->public_id)->assertJsonPath('data.other_details','Synthetic barangay ID');
        self::assertSame('Synthetic barangay ID',$p->fresh()->other_details);
        $this->postJson('/api/patients/'.$p->public_id.'/verify-id',['id_type'=>'other','other_details'=>'   '])->assertUnprocessable();
        self::assertSame('Synthetic barangay ID',$p->fresh()->other_details);
    }
    public function test_audit_failure_rolls_back_id_verification_and_does_not_leave_false_evidence(): void {
        $this->appointment();$p=$this->p['A'];$before=$p->fresh()->getRawOriginal();
        $this->mock(AuditService::class,function($mock){$mock->shouldReceive('recordAdministrative')->withArgs(fn($action,...$rest)=>$action==='patient.id_verified_in_person')->andThrow(new \RuntimeException('Synthetic audit failure'));});
        $this->withoutExceptionHandling();try{
            $this->postJson('/api/patients/'.$p->public_id.'/verify-id',['id_type'=>'other','other_details'=>'Synthetic ID']);self::fail('Audit failure must propagate');
        }catch(\RuntimeException $e){self::assertSame('Synthetic audit failure',$e->getMessage());}
        self::assertSame($before,$p->fresh()->getRawOriginal());
    }
    public function test_existing_intake_caller_observes_the_committed_id_check_on_its_patient_instance(): void {
        $this->appointment();$p=$this->p['A'];
        $saved=app(\App\Services\Intake\IntakeService::class)->recordIdCheck($p,$this->u['staffB1'],'other',null,'Synthetic ID');
        self::assertSame($p,$saved);self::assertNotNull($p->id_verified_at);
        self::assertTrue($p->id_verified_at->equalTo($p->fresh()->id_verified_at));
    }
    public function test_new_id_evidence_preserves_the_actual_instant_in_manila_and_utc_database_sessions(): void {
        foreach(['UTC','Asia/Manila'] as $zone){
            DB::statement("SET LOCAL TIME ZONE '".$zone."'");
            $p=$this->p['A'];app(\App\Services\Intake\IntakeService::class)->recordIdCheck($p,$this->u['staffB1'],'philid');
            $epoch=(int) DB::table('patients')->where('id',$p->id)->selectRaw('extract(epoch from id_verified_at) as instant')->value('instant');
            self::assertSame(\App\Support\ClinicClock::now()->getTimestamp(),$epoch);
        }
    }
}

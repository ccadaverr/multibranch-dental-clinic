<?php

namespace Tests\Feature\Staffing;

use App\Models\AuditLog;
use App\Models\LeaveRequest;
use App\Models\StaffProfile;
use App\Services\Audit\AuditService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class LeaveAuditAtomicityTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp(); $this->setUpSchedulingWorld(); Mail::fake();
        StaffProfile::create(['legacy_ref'=>'audit-staff','person_id'=>$this->u['staffB1']->person_id,'branch_id'=>$this->b['b1']->id,'shift_start'=>'09:00','shift_end'=>'17:00']);
    }

    private function failAudit(): void
    {
        $this->app->bind(AuditService::class,fn()=>new class extends AuditService {
            public function record(array $attributes): AuditLog {parent::record($attributes);throw new \RuntimeException('Synthetic leave audit failure');}
        });
        $this->withoutExceptionHandling();
    }

    private function expectRollback(callable $request): void
    {
        try {$request();$this->fail('Mutation must fail with its audit');}
        catch(\RuntimeException $e){$this->assertSame('Synthetic leave audit failure',$e->getMessage());}
    }

    public function test_request_and_partial_day_are_atomic_with_audit_and_emit_no_false_completion(): void
    {
        $this->actingAsUser('staffB1');$this->failAudit();
        $this->expectRollback(fn()=>$this->postJson('/api/leave',['type'=>'vacation','start_date'=>'2026-09-30','end_date'=>'2026-09-30','start_time'=>'13:00','end_time'=>'15:00']));
        $this->assertSame(0,LeaveRequest::count());$this->assertSame(0,AuditLog::where('action','leave.requested')->count());
        Mail::assertNothingSent();
    }

    public function test_approval_decline_and_cancellation_roll_back_all_decision_metadata_on_audit_failure(): void
    {
        $this->actingAsUser('staffB1');
        $id=$this->postJson('/api/leave',['type'=>'vacation','start_date'=>'2026-09-30','end_date'=>'2026-09-30','start_time'=>'13:00','end_time'=>'15:00'])->assertCreated()->json('data.id');
        $leave=LeaveRequest::where('public_id',$id)->sole();$before=$leave->getAttributes();
        $this->actingAsUser('owner');$this->failAudit();
        foreach(['approve','decline'] as $decision){
            $this->expectRollback(fn()=>$this->postJson('/api/leave/'.$id.'/decide',['decision'=>$decision]));
            $this->assertSame($before,$leave->fresh()->getAttributes());
        }
        $this->actingAsUser('staffB1');
        $this->expectRollback(fn()=>$this->postJson('/api/leave/'.$id.'/cancel'));
        $this->assertSame($before,$leave->fresh()->getAttributes());
        $this->assertSame(0,AuditLog::whereIn('action',['leave.approved','leave.declined','leave.cancelled'])->count());
    }
}

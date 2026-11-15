<?php
namespace Tests\Feature\Staffing;

use App\Models\AuditLog;
use App\Models\AutomationSetting;
use App\Models\LeaveCommandReceipt;
use App\Models\LeaveRequest;
use App\Models\StaffProfile;
use App\Models\UserNotification;
use App\Services\Notifications\NotificationCenter;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class LeaveRecoveryTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;
    protected function setUp(): void
    {
        parent::setUp();$this->setUpSchedulingWorld();
        StaffProfile::create(['legacy_ref'=>'recovery-staff','person_id'=>$this->u['staffB1']->person_id,'branch_id'=>$this->b['b1']->id,'shift_start'=>'09:00','shift_end'=>'17:00']);
        $this->actingAsUser('staffB1');
    }
    private function command(int $revision=0): array { return ['expected_revision'=>$revision,'operation_id'=>(string)Str::uuid()]; }
    private function body(): array { return ['type'=>'other','start_date'=>'2026-09-30','end_date'=>'2026-09-30','start_time'=>'13:00','end_time'=>'15:00','private_note'=>'Synthetic private recovery reason']; }

    public function test_create_decide_cancel_recover_exact_original_receipts_after_later_transitions(): void
    {
        $body=$this->body()+$this->command();
        $created=$this->postJson('/api/leave',$body)->assertCreated()->assertJsonPath('data.revision',1)->json('data');$id=$created['id'];
        $this->actingAsUser('owner');$approve=['decision'=>'approve']+$this->command(1);
        $approved=$this->postJson('/api/leave/'.$id.'/decide',$approve)->assertOk()->assertJsonPath('data.revision',2)->json('data');
        $cancel=$this->command(2);
        $cancelled=$this->postJson('/api/leave/'.$id.'/cancel',$cancel)->assertOk()->assertJsonPath('data.status','Cancelled')->assertJsonPath('data.revision',3)->json('data');
        $this->postJson('/api/leave/'.$id.'/cancel',$cancel)->assertOk()->assertJsonPath('meta.replayed',true)->assertExactJson(['data'=>$cancelled,'meta'=>['operation_id'=>$cancel['operation_id'],'replayed'=>true]]);
        $this->postJson('/api/leave/'.$id.'/decide',$approve)->assertOk()->assertExactJson(['data'=>$approved,'meta'=>['operation_id'=>$approve['operation_id'],'replayed'=>true]]);
        $this->actingAsUser('staffB1');$this->travel(10)->days(); // a past creation date must still replay its original receipt.
        $this->postJson('/api/leave',$body)->assertCreated()->assertExactJson(['data'=>$created,'meta'=>['operation_id'=>$body['operation_id'],'replayed'=>true]]);
        $this->getJson('/api/leave/'.$id)->assertOk()->assertJsonPath('data.revision',3)->assertJsonPath('data.status','Cancelled');
        $this->assertSame(1,LeaveRequest::count());$this->assertSame(3,LeaveCommandReceipt::count());
        $this->assertSame(3,AuditLog::where('action','like','leave.%')->count());
        $this->assertSame(3,UserNotification::count());
    }

    public function test_stale_or_contradictory_commands_never_replace_a_completed_decision(): void
    {
        $create=$this->body()+$this->command();$id=$this->postJson('/api/leave',$create)->assertCreated()->json('data.id');
        $this->postJson('/api/leave',array_replace($create,['end_time'=>'16:00']))->assertConflict()->assertJsonPath('code','leave_operation_conflict');
        $this->actingAsUser('owner');$decision=['decision'=>'decline']+$this->command(1);
        $this->postJson('/api/leave/'.$id.'/decide',$decision)->assertOk()->assertJsonPath('data.status','Declined');
        $this->postJson('/api/leave/'.$id.'/decide',['decision'=>'approve']+$this->command(1))->assertConflict()->assertJsonPath('code','leave_revision_conflict');
        $this->postJson('/api/leave/'.$id.'/decide',array_replace($decision,['decision'=>'approve']))->assertConflict()->assertJsonPath('code','leave_operation_conflict');
        $this->postJson('/api/leave/'.$id.'/cancel',$this->command(1))->assertConflict();
        $this->postJson('/api/leave/'.$id.'/decide',$decision)->assertOk()->assertJsonPath('meta.replayed',true)->assertJsonPath('data.status','Declined');
        $this->assertSame(2,LeaveCommandReceipt::count());
    }

    public function test_unguarded_clients_and_invalid_preconditions_are_rejected_without_writes(): void
    {
        $this->postJson('/api/leave',$this->body())->assertConflict()->assertJsonPath('code','leave_precondition_required');
        foreach([['expected_revision'=>0],['operation_id'=>'bad'],['expected_revision'=>1,'operation_id'=>(string)Str::uuid()]] as $bad) $this->postJson('/api/leave',$this->body()+$bad)->assertUnprocessable();
        $id=$this->postJson('/api/leave',$this->body()+$this->command())->assertCreated()->json('data.id');
        $this->actingAsUser('owner');
        $this->postJson('/api/leave/'.$id.'/decide',['decision'=>'approve'])->assertConflict();
        $this->postJson('/api/leave/'.$id.'/cancel')->assertConflict();
        $this->assertSame(1,LeaveCommandReceipt::count());
    }

    public function test_receipt_and_read_access_still_require_current_recipient_or_approver_authority(): void
    {
        $id=$this->postJson('/api/leave',$this->body()+$this->command())->assertCreated()->json('data.id');
        foreach(['staffB2','dentist1','patientA'] as $actor){$this->actingAsUser($actor);$this->getJson('/api/leave/'.$id)->assertForbidden();$this->postJson('/api/leave/'.$id.'/cancel',$this->command(1))->assertForbidden();}
        AutomationSetting::whereKey('staffing')->update(['settings'=>['leave_approver'=>'owner_or_front_desk']]);
        $this->actingAsUser('staffBoth');$approve=['decision'=>'approve']+$this->command(1);
        $this->postJson('/api/leave/'.$id.'/decide',$approve)->assertOk();
        AutomationSetting::whereKey('staffing')->update(['settings'=>['leave_approver'=>'owner']]);
        $this->postJson('/api/leave/'.$id.'/decide',$approve)->assertForbidden();
        $this->actingAsUser('owner');$this->getJson('/api/leave/'.$id)->assertOk()->assertJsonPath('data.status','Approved');
    }

    public function test_receipts_are_encrypted_append_only_and_link_the_exact_safe_audit(): void
    {
        $body=$this->body()+$this->command();$this->postJson('/api/leave',$body)->assertCreated();
        $stored=LeaveCommandReceipt::sole();$audit=AuditLog::findOrFail($stored->audit_log_id);
        $this->assertSame($body['operation_id'],$audit->payload['operation_id']);
        $this->assertSame('leave.requested',$audit->action);
        $this->assertStringNotContainsString($body['private_note'],DB::table('leave_command_receipts')->value('receipt'));
        $this->assertStringNotContainsString($body['private_note'],$audit->toJson());
        foreach(['UPDATE leave_command_receipts SET http_status=200','DELETE FROM leave_command_receipts','TRUNCATE leave_command_receipts'] as $sql){
            try{DB::transaction(fn()=>DB::statement($sql));$this->fail('Must preserve receipts');}catch(\Illuminate\Database\QueryException $e){$this->assertTrue(str_contains($e->getMessage(),'append-only')||str_contains($e->getMessage(),'permission denied'));}
        }
    }

    public function test_notice_failure_rolls_back_leave_audit_and_replay_journal(): void
    {
        $this->app->bind(NotificationCenter::class,fn()=>new class extends NotificationCenter {
            public function staffNoticeOrFail(\App\Models\User $user,string $kind,string $title,?string $body,string $page,?string $targetId,string $dedupe): void {parent::staffNoticeOrFail($user,$kind,$title,$body,$page,$targetId,$dedupe);throw new \RuntimeException('Synthetic notice failure');}
        });
        $this->withoutExceptionHandling();
        try{$this->postJson('/api/leave',$this->body()+$this->command());$this->fail('Must roll back');}catch(\RuntimeException $e){$this->assertSame('Synthetic notice failure',$e->getMessage());}
        foreach(['leave_requests','leave_command_receipts','user_notifications','audit_logs'] as $table)$this->assertSame(0,DB::table($table)->count());
    }
}

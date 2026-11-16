<?php

namespace Tests\Feature\Staffing;

use App\Models\{StaffProfile, UserBranchScope};
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Str;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Exact self-request access must follow its resource branch, not flat profile assignment. */
class WorkforceSelfAccessTest extends TestCase
{
    use DatabaseTransactions,SchedulingFixture;
    protected function setUp(): void
    {
        parent::setUp();$this->setUpSchedulingWorld();
        StaffProfile::create(['legacy_ref'=>'workforce-self','person_id'=>$this->u['staffB1']->person_id,'branch_id'=>$this->b['b1']->id,'shift_start'=>'09:00','shift_end'=>'18:00']);
        $this->actingAsUser('owner');
        $this->putJson('/api/users/'.$this->u['staffB1']->public_id.'/branch-scopes',['branch_refs'=>['b2']])->assertOk();
    }
    private function body(string $date='2026-09-28',string $branch='b2'): array
    {
        return ['date'=>$date,'branch_ref'=>$branch,'kind'=>'weekly','weekdays'=>[1,2,3,4,5],'effective_from'=>$date,'effective_until'=>'2026-10-09','start_time'=>'09:00','end_time'=>'17:00','exceptions'=>[],'expected_revision'=>0,'operation_id'=>(string)Str::uuid()];
    }
    public function test_self_can_submit_read_and_review_authorized_request_outside_flat_assignment(): void
    {
        $before=StaffProfile::where('legacy_ref','workforce-self')->sole()->getAttributes();
        $this->actingAsUser('staffB1');
        $saved=$this->putJson('/api/staff/workforce-self/roster',$this->body())->assertOk()->assertJsonPath('data.status','Pending')->json('data');
        $this->getJson('/api/staff/workforce-self/roster?date=2026-09-28')->assertOk()->assertJsonPath('data.id',$saved['id']);
        $this->getJson('/api/staff/workforce-self/roster/history?date=2026-09-28')->assertOk()->assertJsonCount(1,'data')->assertJsonPath('data.0.draft.branch_ref','b2');
        $this->getJson('/api/staff/workforce-self/roster?date=2026-09-29')->assertOk()->assertJsonPath('data',null)->assertJsonPath('meta.revision',0);
        $this->actingAsUser('owner');
        foreach(['approve'=>1,'publish'=>2] as $action=>$revision)$this->postJson('/api/staff/workforce-self/roster/'.$action,['date'=>'2026-09-28','expected_revision'=>$revision,'operation_id'=>(string)Str::uuid()])->assertOk();
        $this->actingAsUser('staffB1');
        $this->getJson('/api/staff/workforce-self/roster?date=2026-09-28')->assertOk()->assertJsonPath('data.status','Published');
        $this->getJson('/api/staff/workforce-self/duty?date=2026-09-28&branch_ref=b2')->assertOk()->assertJsonPath('data.available',true);
        $this->assertSame($before,StaffProfile::where('legacy_ref','workforce-self')->sole()->getAttributes());
        $this->assertSame([$this->b['b2']->id],UserBranchScope::where('user_id',$this->u['staffB1']->id)->pluck('branch_id')->all());
    }
    public function test_work_schedule_self_entry_does_not_widen_the_branch_scoped_directory(): void
    {
        $this->actingAsUser('staffB1');
        $this->getJson('/api/work-schedules')->assertOk()->assertJsonCount(0,'data.staff')->assertJsonPath('data.self_staff.id','workforce-self')->assertJsonPath('data.self_staff.can_request_roster',true);
        $this->getJson('/api/staff')->assertOk()->assertJsonCount(0,'data')->assertJsonPath('meta.self_staff.id','workforce-self')->assertJsonPath('meta.self_staff.branchId','b1');
        $this->actingAsUser('staffB2');
        $this->getJson('/api/work-schedules')->assertOk()->assertJsonCount(0,'data.staff')->assertJsonPath('data.self_staff',null);
        $this->getJson('/api/staff')->assertOk()->assertJsonCount(0,'data')->assertJsonPath('meta.self_staff',null);
        $this->actingAsUser('owner');$this->getJson('/api/work-schedules')->assertOk()->assertJsonPath('data.self_staff',null);
    }
    public function test_self_identity_does_not_grant_foreign_or_revoked_resource_branches(): void
    {
        $this->putJson('/api/staff/workforce-self/roster',$this->body('2026-09-28','b1'))->assertOk();
        $this->actingAsUser('staffB1');
        $this->getJson('/api/staff/workforce-self/roster?date=2026-09-28')->assertForbidden();
        $this->getJson('/api/staff/workforce-self/roster/history?date=2026-09-28')->assertForbidden();
        $this->putJson('/api/staff/workforce-self/roster',$this->body('2026-09-29','b1'))->assertForbidden();
        $this->actingAsUser('staffB2');$this->getJson('/api/staff/workforce-self/roster?date=2026-09-29')->assertForbidden();
        $this->actingAsUser('owner');$this->putJson('/api/users/'.$this->u['staffB1']->public_id.'/branch-scopes',['branch_refs'=>[]])->assertOk();
        $this->actingAsUser('staffB1');$this->getJson('/api/work-schedules')->assertOk()->assertJsonPath('data.self_staff',null);
        $this->getJson('/api/staff')->assertOk()->assertJsonCount(0,'data')->assertJsonPath('meta.self_staff',null);
        $this->getJson('/api/staff/workforce-self/roster?date=2026-09-29')->assertForbidden();
    }
}

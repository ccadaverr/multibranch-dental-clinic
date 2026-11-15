<?php
namespace Tests\Feature\Staffing;

use App\Models\AutomationSetting;
use App\Models\LeaveRequest;
use App\Models\StaffProfile;
use App\Models\UserBranchScope;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class LeaveCollectionScopeTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;
    protected function setUp(): void
    {
        parent::setUp();$this->setUpSchedulingWorld();
        AutomationSetting::whereKey('staffing')->update(['settings'=>['leave_approver'=>'owner_or_front_desk']]);
    }
    private function leave(string $who,string $day,array $extra=[]): LeaveRequest
    {
        return LeaveRequest::create($extra+['requester_user_id'=>$this->u[$who]->id,'type'=>'vacation','starts_at'=>$day.' 13:00:00+08:00','ends_at'=>$day.' 15:00:00+08:00','status'=>'Pending']);
    }
    public function test_foreign_branch_rows_cannot_crowd_authorized_or_branch_filtered_requests_out_of_the_bound(): void
    {
        $day=new \DateTimeImmutable('2027-01-01');
        for($n=0;$n<301;$n++)$this->leave('dentist3',$day->modify('+'.$n.' days')->format('Y-m-d'),['dentist_profile_id'=>$this->d['d3']->id]);
        $own=$this->leave('dentist1','2028-01-02',['dentist_profile_id'=>$this->d['d1']->id]);
        $this->actingAsUser('staffB1');
        $this->getJson('/api/leave')->assertOk()->assertJsonCount(1,'data')->assertJsonPath('data.0.id',$own->public_id)->assertJsonPath('meta.has_more',false);
        $this->getJson('/api/leave?branch_ref=b1')->assertOk()->assertJsonCount(1,'data')->assertJsonPath('data.0.id',$own->public_id);
        $this->getJson('/api/leave?branch_ref=b2')->assertOk()->assertJsonCount(0,'data');
        $this->actingAsUser('owner');
        $this->getJson('/api/leave')->assertOk()->assertJsonCount(300,'data')->assertJsonPath('meta.has_more',true)->assertJsonPath('meta.limit',300);
        $this->getJson('/api/leave?branch_ref=b1')->assertOk()->assertJsonCount(1,'data')->assertJsonPath('data.0.id',$own->public_id);
    }
    public function test_staff_assignment_precedes_fallback_account_scopes_and_archived_requester_history_is_retained(): void
    {
        $profile=StaffProfile::create(['legacy_ref'=>'scope-requester','person_id'=>$this->u['staffBoth']->person_id,'branch_id'=>$this->b['b2']->id,'shift_start'=>'09:00','shift_end'=>'17:00']);
        $assigned=$this->leave('staffBoth','2027-01-10',['staff_profile_id'=>$profile->id]);
        $unassigned=StaffProfile::create(['legacy_ref'=>'scope-fallback','person_id'=>$this->u['staffB2']->person_id,'branch_id'=>null,'shift_start'=>'09:00','shift_end'=>'17:00']);
        UserBranchScope::create(['user_id'=>$this->u['staffB2']->id,'branch_id'=>$this->b['b1']->id]);
        UserBranchScope::create(['user_id'=>$this->u['staffNone']->id,'branch_id'=>$this->b['b2']->id]);
        $fallback=$this->leave('staffB2','2027-01-11',['staff_profile_id'=>$unassigned->id]);
        $this->actingAsUser('staffB1');
        $this->getJson('/api/leave')->assertOk()->assertJsonCount(1,'data')->assertJsonPath('data.0.id',$fallback->public_id);
        $this->actingAsUser('staffNone');
        $this->getJson('/api/leave')->assertOk()->assertJsonCount(2,'data');
        $this->u['staffB2']->delete(); // synthetic requester soft archive; permissions still derive from retained scopes.
        $this->actingAsUser('staffB1');
        $this->getJson('/api/leave')->assertOk()->assertJsonCount(1,'data')->assertJsonPath('data.0.id',$fallback->public_id);
        $this->assertNotNull($assigned->fresh());
    }
    public function test_invalid_filters_and_unauthorized_actors_are_truthfully_rejected(): void
    {
        $this->actingAsUser('owner');
        foreach(['branch_ref=missing','branch_ref='.$this->b['b1']->id,'from=2027-01-02&to=2027-01-01'] as $query)$this->getJson('/api/leave?'.$query)->assertUnprocessable();
        $this->getJson('/api/leave?to=2027-01-01')->assertOk();
        foreach(['patientA','dentist1'] as $actor){$this->actingAsUser($actor);$this->getJson('/api/leave')->assertForbidden();}
        AutomationSetting::whereKey('staffing')->update(['settings'=>['leave_approver'=>'owner']]);
        $this->actingAsUser('staffB1');$this->getJson('/api/leave')->assertForbidden();
    }
}

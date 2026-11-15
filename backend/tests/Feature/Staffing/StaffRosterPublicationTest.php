<?php

namespace Tests\Feature\Staffing;

use App\Models\{AuditLog, LeaveRequest, StaffProfile, StaffRosterDraft};
use App\Services\Audit\AuditService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class StaffRosterPublicationTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;
    protected function setUp(): void
    {
        parent::setUp();$this->setUpSchedulingWorld();
        StaffProfile::create(['legacy_ref'=>'ops-contention','person_id'=>$this->u['staffB1']->person_id,'branch_id'=>$this->b['b1']->id,'shift_start'=>'09:00','shift_end'=>'18:00']);
        $this->actingAsUser('owner');
    }
    private function body(array $more=[]): array {return $more+['date'=>'2026-09-28','branch_ref'=>'b1','kind'=>'weekly','weekdays'=>[1,2,3,4,5], 'effective_from'=>'2026-09-28','effective_until'=>'2026-10-09','start_time'=>'09:00','end_time'=>'17:00','exceptions'=>[],'expected_revision'=>0,'operation_id'=>(string)Str::uuid()];}
    private function command(string $action,int $revision,string $date='2026-09-28',?string $op=null){return $this->postJson('/api/staff/ops-contention/roster/'.$action,['date'=>$date,'expected_revision'=>$revision,'operation_id'=>$op??(string)Str::uuid()]);}
    private function duty(string $date='2026-09-28',string $branch='b1'){return $this->getJson('/api/staff/ops-contention/duty?date='.$date.'&branch_ref='.$branch);}
    private function publish(array $more=[]): array
    {
        $b=$this->body($more);$this->putJson('/api/staff/ops-contention/roster',$b)->assertOk();
        $this->command('approve',1,$b['date'])->assertOk()->assertJsonPath('data.status','Approved');
        return $this->command('publish',2,$b['date'])->assertOk()->assertJsonPath('data.status','Published')->json('data');
    }
    public function test_recurrence_boundaries_no_fallback_and_approval_is_separate(): void
    {
        $doctor=$this->getJson('/api/work-schedules')->assertOk()->json('data.duty');
        $this->duty()->assertOk()->assertJsonPath('data.available',false)->assertJsonCount(0,'data.windows');
        $this->putJson('/api/staff/ops-contention/roster',$this->body())->assertOk()->assertJsonPath('data.status','Draft');
        $this->duty()->assertJsonPath('data.available',false);
        $this->command('approve',1)->assertOk()->assertJsonPath('data.published',false);
        $this->duty()->assertJsonPath('data.available',false);
        $receipt=$this->command('publish',2)->assertOk()->assertJsonPath('data.revision',3)->json('data');
        $this->duty()->assertJsonPath('data.available',true)->assertJsonPath('data.windows.0.start_time','09:00')->assertJsonPath('data.windows.0.publication_id',$receipt['publication_id']);
        foreach(['2026-09-27','2026-10-10','2026-10-12','2026-10-03'] as $date)$this->duty($date)->assertOk()->assertJsonPath('data.available',false);
        $this->duty('2026-10-09')->assertJsonPath('data.available',true);
        $this->getJson('/api/work-schedules')->assertOk()->assertJsonPath('data.duty',$doctor);
    }
    public function test_published_date_exceptions_override_weekly_and_approved_leave_is_last(): void
    {
        $this->publish(['exceptions'=>[['date'=>'2026-09-29','kind'=>'day_off','start_time'=>null,'end_time'=>null],['date'=>'2026-09-30','kind'=>'custom_hours','start_time'=>'10:00','end_time'=>'16:00']]]);
        $this->duty('2026-09-29')->assertJsonPath('data.available',false);
        $this->duty('2026-09-30')->assertJsonPath('data.windows.0.start_time','10:00');
        $l=LeaveRequest::create(['requester_user_id'=>$this->u['staffB1']->id,'staff_profile_id'=>StaffProfile::where('legacy_ref','ops-contention')->value('id'),'type'=>'vacation','status'=>'Pending','starts_at'=>'2026-09-30T11:00:00+08:00','ends_at'=>'2026-09-30T13:00:00+08:00']);
        $this->duty('2026-09-30')->assertJsonCount(1,'data.windows');
        $l->update(['status'=>'Approved','decided_at'=>now(),'decided_by_user_id'=>$this->u['owner']->id]);
        $this->duty('2026-09-30')->assertJsonCount(2,'data.windows')->assertJsonPath('data.windows.0.end_time','11:00')->assertJsonPath('data.windows.1.start_time','13:00')->assertJsonCount(1,'data.approved_leave');
        $this->getJson('/api/staff/ops-contention/duty?branch_ref=b1&date=2026-09-30&from=11:30&until=12:30')->assertJsonPath('data.available',false);
        $l->update(['status'=>'Cancelled']);$this->duty('2026-09-30')->assertJsonCount(1,'data.windows');
    }
    public function test_exact_replay_stale_conflict_and_new_version_preserve_published_history(): void
    {
        $first=$this->publish();$op=(string)Str::uuid();
        $this->putJson('/api/staff/ops-contention/roster',$this->body(['expected_revision'=>3,'end_time'=>'16:00']))->assertOk()->assertJsonPath('data.status','Draft')->assertJsonPath('data.published_revision',3);
        $this->duty()->assertJsonPath('data.windows.0.end_time','17:00');
        $this->command('approve',3)->assertConflict()->assertJsonPath('code','staff_roster_revision_conflict');
        $this->command('publish',4)->assertUnprocessable();
        $this->command('approve',4)->assertOk();
        $second=$this->command('publish',5,'2026-09-28',$op)->assertOk()->json('data');
        $replayed=$this->command('publish',5,'2026-09-28',$op)->assertOk()->assertJsonPath('meta.replayed',true)->json('data');
        $this->assertEquals($second,$replayed);
        $this->command('approve',5,'2026-09-28',$op)->assertConflict()->assertJsonPath('code','staff_roster_operation_conflict');
        $this->duty()->assertJsonPath('data.windows.0.end_time','16:00');
        $this->assertSame(2,DB::table('staff_roster_publications')->count());
        $old=json_decode(DB::table('staff_roster_publications')->where('public_id',$first['publication_id'])->value('snapshot'),true);
        $this->assertSame('17:00',$old['end_time']);$this->assertSame(3,$old['revision']);
        $this->getJson('/api/staff/ops-contention/roster/history?date=2026-09-28')->assertOk()->assertJsonCount(6,'data')->assertJsonPath('data.0.draft.publication_id',$second['publication_id']);
        $this->actingAsUser('staffB1');$this->getJson('/api/staff/ops-contention/roster?date=2026-09-28')->assertOk()->assertJsonPath('data.status','Published');
    }
    public function test_cross_branch_overlapping_assignments_rejected_but_adjacent_and_disjoint_periods_allowed(): void
    {
        $this->publish();
        $date='2026-09-29';$this->putJson('/api/staff/ops-contention/roster',$this->body(['date'=>$date,'branch_ref'=>'b2']))->assertOk();$this->command('approve',1,$date)->assertOk();
        $this->command('publish',2,$date)->assertUnprocessable();$this->assertSame(1,DB::table('staff_roster_publications')->count());
        $this->putJson('/api/staff/ops-contention/roster',$this->body(['date'=>$date,'branch_ref'=>'b2','expected_revision'=>2,'start_time'=>'17:00','end_time'=>'18:00']))->assertOk();
        $this->command('approve',3,$date)->assertOk();$this->command('publish',4,$date)->assertOk();
        $this->duty('2026-09-28','b2')->assertJsonPath('data.windows.0.start_time','17:00');
        $this->publish(['date'=>'2026-10-12','effective_from'=>'2026-10-12','effective_until'=>'2026-10-16']);
        $this->duty('2026-10-12')->assertJsonPath('data.available',true);
    }
    public function test_staff_requests_require_owner_approval_and_current_resource_scope(): void
    {
        $this->actingAsUser('staffB1');$this->putJson('/api/staff/ops-contention/roster',$this->body())->assertOk()->assertJsonPath('data.status','Pending');
        $this->command('approve',1)->assertForbidden();$this->command('publish',1)->assertForbidden();
        $this->duty()->assertJsonPath('data.available',false);
        $this->putJson('/api/staff/ops-contention/roster',$this->body(['expected_revision'=>1,'branch_ref'=>'b2']))->assertForbidden();
        $this->actingAsUser('staffB2');$this->getJson('/api/staff/ops-contention/roster?date=2026-09-28')->assertForbidden();$this->duty()->assertForbidden();
        foreach(['dentist1','patientA'] as $who){$this->actingAsUser($who);$this->duty()->assertForbidden();}
        $this->actingAsUser('owner');$this->command('approve',1)->assertOk();$this->command('publish',2)->assertOk();
    }
    public function test_invalid_identity_content_and_ambiguous_overnight_inputs_are_refused(): void
    {
        foreach([['date'=>'2026-02-30'],['branch_ref'=>'missing'],['branch_ref'=>(string)$this->b['b1']->id],['weekdays'=>[]],['effective_until'=>'2026-09-27'],['end_time'=>'08:00'],['weekdays'=>[1,1]],['published'=>true],['exceptions'=>[['date'=>'2027-01-01','kind'=>'day_off']]]] as $bad)$this->putJson('/api/staff/ops-contention/roster',$this->body($bad))->assertUnprocessable();
        $this->putJson('/api/staff/missing/roster',$this->body())->assertNotFound();
        $this->assertSame(0,StaffRosterDraft::count());
    }
    public function test_request_collection_scopes_before_limit_and_cursor_and_routes_notices_once(): void
    {
        $this->actingAsUser('staffB1');$body=$this->body();
        $own=$this->putJson('/api/staff/ops-contention/roster',$body)->assertOk()->assertJsonPath('data.status','Pending')->json('data');
        $notes=\App\Models\UserNotification::where('kind','staff_roster')->count();$this->assertSame(1,$notes);
        $this->putJson('/api/staff/ops-contention/roster',$body)->assertOk()->assertJsonPath('meta.replayed',true);
        $this->assertSame($notes,\App\Models\UserNotification::where('kind','staff_roster')->count());
        $peer=StaffProfile::create(['legacy_ref'=>'peer-staff','person_id'=>$this->u['staffBoth']->person_id,'branch_id'=>$this->b['b1']->id,'shift_start'=>'09:00','shift_end'=>'18:00']);
        for($i=0;$i<51;$i++)$foreign=StaffRosterDraft::create(['staff_profile_id'=>$peer->id,'branch_id'=>$this->b['b1']->id,'on_date'=>\Carbon\CarbonImmutable::parse('2027-01-01')->addDays($i)->toDateString(),'start_time'=>'10:00','end_time'=>'11:00','revision'=>1,'status'=>'Pending','kind'=>'weekly','weekdays'=>[1],'effective_from'=>'2026-09-28','effective_until'=>'2026-10-09','updated_by_user_id'=>$this->u['owner']->id]);
        $this->getJson('/api/staff-rosters?branch_ref=b1&date=2026-09-28')->assertOk()->assertJsonCount(1,'data')->assertJsonPath('data.0.id',$own['id'])->assertJsonPath('meta.next_before',null);
        $this->getJson('/api/staff-rosters?branch_ref=b1&date=2026-09-28&before='.$foreign->public_id)->assertNotFound();
        $this->getJson('/api/staff-rosters?branch_ref=b2&date=2026-09-28')->assertForbidden();
        $this->actingAsUser('owner');$page=$this->getJson('/api/staff-rosters?branch_ref=b1&date=2026-09-28')->assertOk()->assertJsonCount(50,'data')->json();
        $this->getJson('/api/staff-rosters?branch_ref=b1&date=2026-09-28&before='.$page['meta']['next_before'])->assertOk()->assertJsonCount(2,'data');
    }
    public function test_published_versions_are_immutable_and_the_legacy_writer_cannot_reset_approval(): void
    {
        $this->publish();
        foreach(['UPDATE staff_roster_publications SET revision=revision+1','DELETE FROM staff_roster_publications'] as $sql){
            try{DB::transaction(fn()=>DB::statement($sql));$this->fail('Publication evidence must be immutable');}catch(\Illuminate\Database\QueryException $e){$this->assertStringContainsString('append-only',$e->getMessage());}
        }
        $this->putJson('/api/staff/ops-contention/roster-draft',['date'=>'2026-09-28','branch_ref'=>'b1','start_time'=>'10:00','end_time'=>'16:00','expected_revision'=>3,'operation_id'=>(string)Str::uuid()])->assertConflict()->assertJsonPath('code','staff_roster_workflow_required');
        $this->duty()->assertJsonPath('data.windows.0.start_time','09:00');
    }
    public function test_staff_history_filters_revoked_branch_versions_before_pagination(): void
    {
        $this->publish();
        $this->putJson('/api/staff/ops-contention/roster',$this->body(['branch_ref'=>'b2','expected_revision'=>3]))->assertOk();
        $this->putJson('/api/staff/ops-contention/roster',$this->body(['branch_ref'=>'b1','expected_revision'=>4]))->assertOk();
        $this->actingAsUser('staffB1');
        $history=$this->getJson('/api/staff/ops-contention/roster/history?date=2026-09-28')->assertOk()->assertJsonCount(4,'data')->json('data');
        $this->assertSame([5,3,2,1],array_column($history,'revision'));
        foreach($history as $h)$this->assertSame('b1',$h['draft']['branch_ref']);
    }
    public function test_separately_approved_date_day_off_overrides_a_published_week_and_legacy_read_stays_truthful(): void
    {
        $this->publish();
        $this->publish(['date'=>'2026-09-29','kind'=>'day_off','weekdays'=>[],'effective_from'=>'2026-09-29','effective_until'=>'2026-09-29','start_time'=>null,'end_time'=>null]);
        $this->duty('2026-09-29')->assertJsonPath('data.available',false)->assertJsonCount(0,'data.windows');
        $this->duty('2026-09-28')->assertJsonPath('data.available',true);
        $this->getJson('/api/staff/ops-contention/roster-draft?date=2026-09-29')->assertOk()->assertJsonPath('data.status','Published')->assertJsonPath('data.start_time',null);
    }
    public function test_failed_audit_rolls_back_publication_and_keeps_the_approved_revision(): void
    {
        $this->putJson('/api/staff/ops-contention/roster',$this->body())->assertOk();$this->command('approve',1)->assertOk();
        $this->app->bind(AuditService::class,fn()=>new class extends AuditService {public function record(array $a): AuditLog {parent::record($a);throw new \RuntimeException('Synthetic publication audit failure');}});
        $this->withoutExceptionHandling();try{$this->command('publish',2);$this->fail('Expected rollback');}catch(\RuntimeException $e){$this->assertSame('Synthetic publication audit failure',$e->getMessage());}
        $this->assertSame(0,DB::table('staff_roster_publications')->count());$this->assertSame('Approved',StaffRosterDraft::sole()->status);$this->assertSame(2,StaffRosterDraft::sole()->revision);
    }
    public function test_maximum_exception_content_replays_exactly_without_overflowing_audit_metadata(): void
    {
        $exceptions=[];
        for($i=0;$i<100;$i++)$exceptions[]=['date'=>\Carbon\CarbonImmutable::parse('2026-01-01')->addDays($i)->toDateString(),'kind'=>'custom_hours','start_time'=>'10:00','end_time'=>'16:00'];
        $body=$this->body(['effective_from'=>'2026-01-01','effective_until'=>'2026-12-31','exceptions'=>$exceptions]);
        $first=$this->putJson('/api/staff/ops-contention/roster',$body)->assertOk()->assertJsonCount(100,'data.exceptions')->json('data');
        $this->command('approve',1)->assertOk();
        $op=(string)Str::uuid();$published=$this->command('publish',2,'2026-09-28',$op)->assertOk()->assertJsonCount(100,'data.exceptions')->json('data');
        $this->assertEquals($published,$this->command('publish',2,'2026-09-28',$op)->assertOk()->assertJsonPath('meta.replayed',true)->json('data'));
        $this->assertEquals($first,$this->putJson('/api/staff/ops-contention/roster',$body)->assertOk()->assertJsonPath('meta.replayed',true)->json('data'));
        foreach(AuditLog::whereIn('action',['staff_roster.saved','staff_roster.approved','staff_roster.published'])->get() as $audit){$this->assertLessThan(8192,strlen(json_encode($audit->payload)));$this->assertArrayHasKey('receipt_ref',$audit->payload);}
    }
}

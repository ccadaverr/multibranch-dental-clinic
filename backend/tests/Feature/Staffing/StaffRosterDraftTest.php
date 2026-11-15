<?php

namespace Tests\Feature\Staffing;

use App\Models\AuditLog;
use App\Models\StaffProfile;
use App\Models\StaffRosterDraft;
use App\Models\UserBranchScope;
use App\Services\Audit\AuditService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class StaffRosterDraftTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp(); $this->setUpSchedulingWorld(); $this->b['b1']->update(['operating_days'=>[1,2,3,4,5,6]]);
        StaffProfile::create(['legacy_ref'=>'draft-staff','person_id'=>$this->u['staffB1']->person_id,'branch_id'=>$this->b['b1']->id,'shift_start'=>'09:00','shift_end'=>'17:00','available'=>true]);
        $this->actingAsUser('owner');
    }

    private function body(array $overrides=[]): array
    {
        return $overrides+['date'=>'2026-09-28','branch_ref'=>'b1','start_time'=>'10:00','end_time'=>'16:00','expected_revision'=>0,'operation_id'=>(string) Str::uuid()];
    }

    public function test_dated_preparation_has_exact_receipts_history_and_no_effect_on_assignment_or_duty(): void
    {
        $profile=StaffProfile::where('legacy_ref','draft-staff')->sole(); $before=$profile->getAttributes();
        $scopes=UserBranchScope::where('user_id',$this->u['staffB1']->id)->get()->toArray();
        $this->getJson('/api/staff/draft-staff/roster-draft?date=2026-09-28')->assertOk()->assertJsonPath('data',null)->assertJsonPath('meta.revision',0)->assertJsonPath('meta.publication_available',false);
        $body=$this->body();
        $first=$this->putJson('/api/staff/draft-staff/roster-draft',$body)->assertOk()->assertJsonPath('data.status','Draft')->assertJsonPath('data.published',false)->assertJsonPath('data.revision',1)->json('data');
        $second=$this->putJson('/api/staff/draft-staff/roster-draft',$this->body(['expected_revision'=>1,'end_time'=>'17:00']))->assertOk()->assertJsonPath('data.revision',2)->json('data');
        $this->putJson('/api/staff/draft-staff/roster-draft',$body)->assertOk()->assertJsonPath('meta.replayed',true)->assertJsonPath('data.revision',1)->assertJsonPath('data.end_time','16:00');
        $this->getJson('/api/staff/draft-staff/roster-draft?date=2026-09-28')->assertOk()->assertJsonPath('data.revision',2)->assertJsonPath('data.id',$first['id']);
        $history=$this->getJson('/api/staff/draft-staff/roster-draft/history?date=2026-09-28')->assertOk()->assertJsonCount(2,'data')->assertJsonPath('data.0.draft.end_time','17:00')->json('data');
        $this->assertStringEndsWith('+08:00',$history[0]['saved_at']);
        $this->assertSame($before,$profile->fresh()->getAttributes());
        $this->assertSame($scopes,UserBranchScope::where('user_id',$this->u['staffB1']->id)->get()->toArray());
        $this->assertSame(1,StaffRosterDraft::count()); $this->assertSame(2,AuditLog::where('action','staff_roster.draft_saved')->count());
        $this->assertSame($second['id'],$history[0]['draft']['id']);
    }

    public function test_stale_and_contradictory_operations_cannot_overwrite_or_duplicate(): void
    {
        $body=$this->body(); $this->putJson('/api/staff/draft-staff/roster-draft',$body)->assertOk();
        $this->putJson('/api/staff/draft-staff/roster-draft',array_replace($body,['end_time'=>'18:00']))->assertConflict()->assertJsonPath('code','staff_roster_operation_conflict');
        $this->putJson('/api/staff/draft-staff/roster-draft',$this->body())->assertConflict()->assertJsonPath('code','staff_roster_revision_conflict');
        $this->putJson('/api/staff/draft-staff/roster-draft',array_replace($body,['date'=>'2026-09-29']))->assertConflict()->assertJsonPath('code','staff_roster_operation_conflict');
        $this->assertSame(1,DB::table('staff_roster_draft_revisions')->count());
    }

    public function test_identity_date_interval_and_branch_calendar_validation_are_strict(): void
    {
        foreach ([['date'=>'2026-02-30'],['date'=>'2026-9-28'],['date'=>''],['end_time'=>'09:00'],['start_time'=>'25:00'],['branch_ref'=>'missing'],['branch_ref'=>(string)$this->b['b1']->id],['start_time'=>'07:00'],['date'=>'2026-10-04'],['published'=>true],['weekdays'=>[1,2]],['effective_until'=>'2026-10-31']] as $bad) {
            $this->putJson('/api/staff/draft-staff/roster-draft',$this->body($bad))->assertUnprocessable();
        }
        $this->putJson('/api/staff/not-a-staff/roster-draft',$this->body())->assertNotFound();
        $this->assertSame(0,StaffRosterDraft::count());
        $this->putJson('/api/staff/draft-staff/roster-draft',$this->body(['date'=>'2028-02-29']))->assertOk()->assertJsonPath('data.date','2028-02-29');
        $this->getJson('/api/staff/draft-staff/roster-draft?date=2028-03-01')->assertOk()->assertJsonPath('data',null);
    }

    public function test_other_roles_cannot_read_write_or_inspect_unpublished_drafts(): void
    {
        $this->putJson('/api/staff/draft-staff/roster-draft',$this->body())->assertOk();
        foreach(['staffB1','staffB2','dentist1','patientA'] as $who){
            $this->actingAsUser($who);
            $this->getJson('/api/staff/draft-staff/roster-draft?date=2026-09-28')->assertForbidden();
            $this->putJson('/api/staff/draft-staff/roster-draft',$this->body())->assertForbidden();
            $this->getJson('/api/staff/draft-staff/roster-draft/history?date=2026-09-28')->assertForbidden();
        }
    }

    public function test_history_cursor_is_bound_to_exact_staff_date_and_stable_during_newer_saves(): void
    {
        for($revision=0;$revision<51;$revision++) $this->putJson('/api/staff/draft-staff/roster-draft',$this->body(['expected_revision'=>$revision]))->assertOk();
        $first=$this->getJson('/api/staff/draft-staff/roster-draft/history?date=2026-09-28')->assertOk()->assertJsonCount(50,'data');
        $cursor=$first->json('meta.next_before'); $this->assertNotNull($cursor);
        $this->putJson('/api/staff/draft-staff/roster-draft',$this->body(['expected_revision'=>51]))->assertOk();
        $this->getJson('/api/staff/draft-staff/roster-draft/history?date=2026-09-28&before='.$cursor)->assertOk()->assertJsonCount(1,'data')->assertJsonPath('data.0.revision',1)->assertJsonPath('meta.next_before',null);
        $this->getJson('/api/staff/draft-staff/roster-draft/history?date=2026-09-29&before='.$cursor)->assertNotFound();
    }

    public function test_failed_audit_rolls_back_draft_and_history_and_history_rejects_rewrites(): void
    {
        $this->app->bind(AuditService::class,fn()=>new class extends AuditService {
            public function record(array $attributes): AuditLog { parent::record($attributes); throw new \RuntimeException('Synthetic draft audit failure'); }
        });
        $this->withoutExceptionHandling();
        try{$this->putJson('/api/staff/draft-staff/roster-draft',$this->body());$this->fail('Must roll back');}
        catch(\RuntimeException $e){$this->assertSame('Synthetic draft audit failure',$e->getMessage());}
        $this->assertSame(0,StaffRosterDraft::count());$this->assertSame(0,DB::table('staff_roster_draft_revisions')->count());
        $this->app->bind(AuditService::class,fn()=>new AuditService);
        $this->putJson('/api/staff/draft-staff/roster-draft',$this->body())->assertOk();
        foreach(['UPDATE staff_roster_draft_revisions SET revision=9','DELETE FROM staff_roster_draft_revisions','DELETE FROM staff_roster_drafts'] as $sql){
            try{DB::transaction(fn()=>DB::statement($sql));$this->fail('Must preserve history');}
            catch(\Illuminate\Database\QueryException $e){$this->assertStringContainsString('append-only',$e->getMessage());}
        }
    }
}

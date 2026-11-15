<?php
namespace Tests\Feature\Staffing;

use App\Models\Person;
use App\Models\StaffProfile;
use App\Models\StaffRosterDraft;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Str;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class StaffRosterDraftCollectionTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;
    protected function setUp(): void {parent::setUp();$this->setUpSchedulingWorld();$this->actingAsUser('owner');}
    private function prepare(string $ref,string $branch='b1',string $date='2026-09-28'): array
    {
        if(!StaffProfile::where('legacy_ref',$ref)->exists()){
            $person=Person::create(['first_name'=>'Synthetic '.$ref,'last_name'=>'Roster']);
            StaffProfile::create(['legacy_ref'=>$ref,'person_id'=>$person->id,'branch_id'=>$this->b['b1']->id,'shift_start'=>'09:00','shift_end'=>'17:00']);
        }
        return $this->putJson('/api/staff/'.$ref.'/roster-draft',['date'=>$date,'branch_ref'=>$branch,'start_time'=>'10:00','end_time'=>'16:00','expected_revision'=>0,'operation_id'=>(string)Str::uuid()])->assertOk()->json('data');
    }
    public function test_collection_is_exact_branch_date_unpublished_and_cursor_stable_without_assignment_changes(): void
    {
        for($n=0;$n<51;$n++)$this->prepare('collection-'.$n);
        $before=StaffProfile::where('legacy_ref','collection-0')->sole()->getAttributes();
        $other=$this->prepare('collection-0','b2','2026-09-29');
        $first=$this->getJson('/api/staff-roster-drafts?branch_ref=b1&date=2026-09-28')->assertOk()->assertJsonCount(50,'data')->assertJsonPath('meta.publication_available',false);
        $cursor=$first->json('meta.next_before');$this->assertNotNull($cursor);
        foreach($first->json('data') as $row){$this->assertSame('b1',$row['branch_ref']);$this->assertSame('2026-09-28',$row['date']);$this->assertFalse($row['published']);$this->assertSame('Draft',$row['status']);$this->assertSame(1,$row['revision']);}
        $this->prepare('collection-new');
        $this->getJson('/api/staff-roster-drafts?branch_ref=b1&date=2026-09-28&before='.$cursor)->assertOk()->assertJsonCount(1,'data')->assertJsonPath('meta.next_before',null);
        $this->getJson('/api/staff-roster-drafts?branch_ref=b2&date=2026-09-29')->assertOk()->assertJsonCount(1,'data')->assertJsonPath('data.0.id',$other['id']);
        $this->getJson('/api/staff-roster-drafts?branch_ref=b2&date=2026-09-29&before='.$cursor)->assertNotFound();
        $this->getJson('/api/staff-roster-drafts?branch_ref=b1&date=2026-09-30')->assertOk()->assertJsonCount(0,'data');
        $this->b['b1']->update(['status'=>'Closed']);
        $this->getJson('/api/staff-roster-drafts?branch_ref=b1&date=2026-09-28')->assertOk()->assertJsonCount(50,'data');
        $this->assertSame($before,StaffProfile::where('legacy_ref','collection-0')->sole()->getAttributes());
    }
    public function test_strict_filters_and_owner_only_visibility_do_not_leak_other_branches(): void
    {
        $this->prepare('collection-private');
        foreach(['branch_ref=b1','branch_ref=missing&date=2026-09-28','branch_ref='.$this->b['b1']->id.'&date=2026-09-28','branch_ref=b1&date=2026-02-30','branch_ref=b1&date=0000-01-01','branch_ref=b1&date=10000-01-01','branch_ref[]=b1&date=2026-09-28','branch_ref=b1&date=2026-09-28&before=invalid'] as $query)$this->getJson('/api/staff-roster-drafts?'.$query)->assertUnprocessable();
        foreach(['staffB1','staffB2','dentist1','patientA'] as $actor){$this->actingAsUser($actor);$this->getJson('/api/staff-roster-drafts?branch_ref=b1&date=2026-09-28')->assertForbidden();}
        $this->assertSame(1,StaffRosterDraft::count());
    }
}

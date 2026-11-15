<?php

namespace Tests\Feature\Staffing;

use App\Models\StaffProfile;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Run against the retained84-migration profile; never remove schema to simulate it. */
class StaffRosterDraftCapabilityTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;

    public function test_missing_opt_in_schema_is_explicitly_unavailable_without_profile_changes(): void
    {
        if(Schema::hasTable('staff_roster_drafts')) self::markTestSkipped('Use retained profile without draft extension.');
        $this->setUpSchedulingWorld();$this->actingAsUser('owner');
        $profile=StaffProfile::create(['legacy_ref'=>'draft-capability','person_id'=>$this->u['staffB1']->person_id,'branch_id'=>$this->b['b1']->id,'shift_start'=>'09:00','shift_end'=>'17:00']);
        $before=$profile->fresh()->getAttributes();
        foreach (['/roster-draft','/roster-draft/history'] as $path) $this->getJson('/api/staff/draft-capability'.$path.'?date=2026-09-28')->assertStatus(503)->assertJsonPath('code','staff_roster_drafts_unavailable');
        $this->putJson('/api/staff/draft-capability/roster-draft',['date'=>'2026-09-28','branch_ref'=>'b1','start_time'=>'10:00','end_time'=>'16:00','expected_revision'=>0,'operation_id'=>(string) Str::uuid()])->assertStatus(503)->assertJsonPath('code','staff_roster_drafts_unavailable');
        $this->assertSame($before,$profile->fresh()->getAttributes());
    }
}

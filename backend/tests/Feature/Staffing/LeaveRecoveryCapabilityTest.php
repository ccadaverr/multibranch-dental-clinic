<?php
namespace Tests\Feature\Staffing;

use App\Models\StaffProfile;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class LeaveRecoveryCapabilityTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;
    public function test_unmigrated_server_is_explicitly_read_only_without_fabricated_revisions(): void
    {
        if(Schema::hasTable('leave_command_receipts'))self::markTestSkipped('Use retained85 profile without leave recovery.');
        $this->setUpSchedulingWorld();$this->actingAsUser('staffB1');
        StaffProfile::create(['legacy_ref'=>'recovery-capability','person_id'=>$this->u['staffB1']->person_id,'branch_id'=>$this->b['b1']->id,'shift_start'=>'09:00','shift_end'=>'17:00']);
        $this->getJson('/api/leave/mine')->assertOk()->assertJsonPath('meta.commands_available',false);
        $this->postJson('/api/leave',['type'=>'vacation','start_date'=>'2026-09-30','end_date'=>'2026-09-30','expected_revision'=>0,'operation_id'=>(string)Str::uuid()])->assertStatus(503)->assertJsonPath('code','leave_recovery_unavailable');
        $this->assertDatabaseCount('leave_requests',0);
    }
}

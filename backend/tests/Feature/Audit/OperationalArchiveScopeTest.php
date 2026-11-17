<?php
namespace Tests\Feature\Audit;

use App\Models\UserNotification;
use App\Services\Audit\AuditService;
use App\Services\Notifications\NotificationCenter;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class OperationalArchiveScopeTest extends TestCase
{
    use DatabaseTransactions,SchedulingFixture;

    public function test_retry_reads_the_same_scoped_continuation_after_a_newer_event_is_written(): void
    {
        $this->setUpSchedulingWorld();
        $this->actingAsUser('owner');
        $target = (string) Str::ulid();
        $writeEvent = function (string $branch, string $instant) use ($target): string {
            $id = strtolower((string) Str::ulid());
            DB::table('audit_logs')->insert([
                'public_id' => $id,
                'action' => 'archive.viewed',
                'branch_id' => $this->b[$branch]->id,
                'auditable_type' => 'Invoice',
                'auditable_public_id' => $target,
                'created_at' => $instant,
            ]);
            return $id;
        };
        $older = $writeEvent('b1', '2026-11-16T00:01:00Z');
        $writeEvent('b2', '2026-11-16T00:02:00Z');
        $head = $writeEvent('b1', '2026-11-16T00:03:00Z');
        $scope = '/api/audit-logs?branch_id=b1&target_type=Invoice&target_id='.$target.'&per_page=1';
        $page = $this->getJson($scope)->assertOk()->assertJsonPath('data.0.id', $head)->json();
        $retryPath = $scope.'&cursor='.$page['meta']['next_cursor'];
        $firstRead = $this->getJson($retryPath)->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $older)->assertJsonPath('meta.next_cursor', null)->json();

        $writeEvent('b1', '2026-11-16T00:04:00Z');
        $this->getJson($retryPath)->assertOk()->assertExactJson($firstRead);
        foreach (['staffB1', 'dentist1', 'patientA'] as $actor) {
            $this->actingAsUser($actor);
            $this->getJson($retryPath)->assertForbidden();
        }
        $this->assertSame(4, DB::table('audit_logs')->where('auditable_public_id', $target)->count());
    }

    public function test_branch_and_action_filters_apply_before_pagination_and_foreign_cursor_cannot_contaminate_it(): void
    {
        $this->setUpSchedulingWorld();$this->actingAsUser('owner');$audit=app(AuditService::class);
        $first=$audit->record(['action'=>'staff_roster.published','category'=>'administrative','actor'=>$this->u['owner'],'branch_id'=>$this->b['b1']->id]);
        $foreign=$audit->record(['action'=>'staff_roster.published','category'=>'administrative','actor'=>$this->u['owner'],'branch_id'=>$this->b['b2']->id]);
        $second=$audit->record(['action'=>'staff_roster.published','category'=>'administrative','actor'=>$this->u['owner'],'branch_id'=>$this->b['b1']->id]);
        $page=$this->getJson('/api/audit-logs?branch_id=b1&action=staff_roster.published&per_page=1')->assertOk()->assertJsonCount(1,'data')->assertJsonPath('data.0.id',$second->public_id)->json();
        $this->getJson('/api/audit-logs?branch_id=b1&action=staff_roster.published&per_page=1&cursor='.$page['meta']['next_cursor'])->assertOk()->assertJsonCount(1,'data')->assertJsonPath('data.0.id',$first->public_id);
        $this->getJson('/api/audit-logs?branch_id=b1&action=staff_roster.published&cursor='.$foreign->public_id)->assertOk()->assertJsonCount(0,'data');
        $this->getJson('/api/audit-logs/export?branch_id=b1&action=staff_roster.published')->assertOk()->assertDontSee($foreign->public_id);
        foreach(['staffB1','dentist1','patientA'] as $who){$this->actingAsUser($who);$this->getJson('/api/audit-logs')->assertForbidden();$this->getJson('/api/audit-logs/'.$first->public_id)->assertForbidden();}
    }
    public function test_owner_operational_metadata_does_not_grant_private_recipient_mutation_or_restore(): void
    {
        $this->setUpSchedulingWorld();app(NotificationCenter::class)->staffNotice($this->u['staffB1'],'staff_roster','Private Staff schedule notice',null,'schedules',null,'scope-roster-notice');
        $note=UserNotification::sole();$this->actingAsUser('staffB1');$this->postJson('/api/notifications/'.$note->public_id.'/archive')->assertOk();
        $this->actingAsUser('owner');$audit=$this->getJson('/api/audit-logs?action=notification.archived')->assertOk()->assertJsonCount(1,'data')->getContent();
        $this->assertStringNotContainsString('Private Staff schedule notice',$audit);
        $this->getJson('/api/notifications?collection=archived')->assertOk()->assertJsonCount(0,'data');
        $this->postJson('/api/notifications/'.$note->public_id.'/archive')->assertNotFound();
        $this->postJson('/api/notifications/'.$note->public_id.'/read')->assertNotFound();
        $this->postJson('/api/notifications/'.$note->public_id.'/restore')->assertNotFound();
        $this->deleteJson('/api/notifications/'.$note->public_id)->assertNotFound();
        $this->actingAsUser('staffB1');$this->getJson('/api/notifications?collection=archived')->assertOk()->assertJsonPath('data.0.id',$note->public_id);
    }
    public function test_manila_history_day_bounds_include_exact_instants_at_existing_second_precision(): void
    {
        $this->setUpSchedulingWorld();$this->actingAsUser('owner');
        // The retained audit column stores whole seconds; fractional input rounds at insertion.
        foreach(['before'=>'2026-11-15T15:59:59Z','start'=>'2026-11-15T16:00:00Z','end'=>'2026-11-16T15:59:59Z','after'=>'2026-11-16T16:00:00Z'] as $label=>$instant){
            \Illuminate\Support\Facades\DB::table('audit_logs')->insert(['public_id'=>strtolower((string)\Illuminate\Support\Str::ulid()),'action'=>'scope.'.$label,'category'=>'administrative','severity'=>'info','actor_role'=>'owner','actor_name'=>'Synthetic Owner','branch_id'=>$this->b['b1']->id,'payload'=>'{}','created_at'=>$instant]);
        }
        $rows=$this->getJson('/api/audit-logs?branch_id=b1&date_from=2026-11-16&date_to=2026-11-16')->assertOk()->assertJsonCount(2,'data')->json('data');
        $this->assertSame(['scope.end','scope.start'],array_column($rows,'action'));
    }
}

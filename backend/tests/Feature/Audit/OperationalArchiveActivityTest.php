<?php

namespace Tests\Feature\Audit;

use App\Models\UserNotification;
use App\Services\Audit\AuditService;
use App\Services\Notifications\NotificationCenter;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class OperationalArchiveActivityTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;

    public function test_owner_reviews_archive_metadata_without_inheriting_recipient_content_access(): void
    {
        $this->setUpSchedulingWorld();
        app(NotificationCenter::class)->staffNotice($this->u['staffB1'],'record_shared','Synthetic private recipient title',null,'leave',null,'synthetic-archive-audit');
        $note=UserNotification::where('user_id',$this->u['staffB1']->id)->sole();
        $this->actingAsUser('staffB1');
        $this->postJson('/api/notifications/'.$note->public_id.'/archive')->assertOk();
        $this->actingAsUser('owner');
        $json=$this->getJson('/api/audit-logs?action=notification.archived')->assertOk()->assertJsonCount(1,'data')->assertJsonPath('data.0.action','notification.archived')->getContent();
        $this->assertStringNotContainsString('Synthetic private recipient title',$json);
        $this->getJson('/api/notifications?collection=archived')->assertOk()->assertJsonCount(0,'data');
        $this->postJson('/api/notifications/'.$note->public_id.'/archive')->assertNotFound();
        $this->getJson('/api/audit-logs?action=staff_roster.draft_saved')->assertOk()->assertJsonCount(0,'data');
        foreach (['staffB1','staffB2','dentist1','patientA'] as $actor) {
            $this->actingAsUser($actor);
            $this->getJson('/api/audit-logs?action=notification.archived')->assertForbidden();
            $this->getJson('/api/audit-logs/export?action=notification.archived')->assertForbidden();
        }
    }

    public function test_exact_record_history_scopes_rows_cursors_and_csv(): void
    {
        $this->setUpSchedulingWorld();
        $actor = $this->u['staffB1'];
        app(NotificationCenter::class)->staffNotice($actor, 'record_shared', 'Synthetic private title', null, 'leave', null, 'exact-record-history');
        $note = UserNotification::where('user_id', $actor->id)->sole();
        $this->actingAsUser('staffB1');
        $receipt = $this->postJson('/api/notifications/'.$note->public_id.'/archive')->assertOk()->json('meta.archive_receipt');
        $this->assertSame($note->public_id, $receipt['id']);

        $audit = app(AuditService::class);
        $sameIdOtherType = $audit->record([
            'action' => 'test.other_type', 'actor' => $actor, 'auditable_type' => 'AnotherResource',
            'auditable_public_id' => $note->public_id,
        ]);
        $audit->record([
            'action' => 'test.similar_id', 'actor' => $actor, 'auditable_type' => 'UserNotification',
            'auditable_public_id' => $note->public_id.'-suffix',
        ]);
        $this->actingAsUser('owner');
        $filter = '?target_type=UserNotification&target_id='.$note->public_id;
        $this->getJson('/api/audit-logs'.$filter.'&per_page=1')
            ->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.auditable_id', $note->public_id)
            ->assertJsonPath('data.0.action', 'notification.archived')
            ->assertJsonPath('data.0.actor.role', 'staff')
            ->assertJsonPath('data.0.created_at', $receipt['archived_at'])
            ->assertJsonPath('meta.next_cursor', null);
        $this->getJson('/api/audit-logs'.$filter.'&cursor='.$sameIdOtherType->public_id)
            ->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/audit-logs?target_type=UserNotification')
            ->assertUnprocessable()->assertJsonValidationErrors('target_id');
        $this->getJson('/api/audit-logs/export?target_id='.$note->public_id)
            ->assertUnprocessable()->assertJsonValidationErrors('target_type');

        $csv = $this->get('/api/audit-logs/export'.$filter)->assertOk()->streamedContent();
        $this->assertStringContainsString('notification.archived', $csv);
        $this->assertStringContainsString('No branch recorded', $csv);
        $this->assertStringNotContainsString('test.other_type', $csv);
        $this->assertStringNotContainsString('test.similar_id', $csv);
        $this->assertStringNotContainsString('Synthetic private title', $csv);
    }
}

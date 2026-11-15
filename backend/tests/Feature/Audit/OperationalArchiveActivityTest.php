<?php

namespace Tests\Feature\Audit;

use App\Models\UserNotification;
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
}

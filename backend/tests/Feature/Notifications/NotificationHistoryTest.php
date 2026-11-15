<?php

namespace Tests\Feature\Notifications;

use App\Models\UserNotification;
use App\Services\Notifications\NotificationCenter;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class NotificationHistoryTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $center = app(NotificationCenter::class);
        for ($i = 0; $i < 103; $i++) {
            $center->staffNotice($this->u['staffB1'], 'record_shared', 'Synthetic notice', null, 'leave', null, 'history-'.$i);
        }
        $center->staffNotice($this->u['staffB2'], 'record_shared', 'Other account', null, 'leave', null, 'history-other');
        $this->actingAsUser('staffB1');
    }

    public function test_history_pages_remain_recipient_scoped_complete_and_stable_after_new_inserts(): void
    {
        $first = $this->getJson('/api/notifications')->assertOk()->assertJsonCount(50, 'data')->assertJsonPath('meta.unread', 103)->assertJsonPath('meta.has_more', true)->json();
        app(NotificationCenter::class)->staffNotice($this->u['staffB1'], 'record_shared', 'Newer notice', null, 'leave', null, 'history-new');
        $second = $this->getJson('/api/notifications?before='.$first['meta']['next_before'])->assertOk()->assertJsonCount(50, 'data')->json();
        $third = $this->getJson('/api/notifications?before='.$second['meta']['next_before'])->assertOk()->assertJsonCount(3, 'data')
            ->assertJsonPath('meta.has_more', false)->assertJsonPath('meta.next_before', null)->json();
        $ids = array_merge(array_column($first['data'], 'id'), array_column($second['data'], 'id'), array_column($third['data'], 'id'));
        $this->assertCount(103, array_unique($ids));
        $other = UserNotification::where('user_id', $this->u['staffB2']->id)->sole();
        $this->assertNotContains($other->public_id, $ids);
        $this->getJson('/api/notifications?before='.$other->public_id)->assertNotFound();
        $this->getJson('/api/notifications?before=invalid')->assertUnprocessable();
        $this->actingAsUser('owner');
        $this->getJson('/api/notifications?before='.$first['meta']['next_before'])->assertNotFound();
    }

    public function test_older_read_receipt_identifies_the_target_and_retry_keeps_first_timestamp(): void
    {
        $oldest = UserNotification::where('user_id', $this->u['staffB1']->id)->oldest('id')->firstOrFail();
        $this->postJson('/api/notifications/'.$oldest->public_id.'/read')->assertOk()->assertJsonPath('meta.read_id', $oldest->public_id)->assertJsonPath('meta.unread', 102);
        $firstRead = $oldest->fresh()->read_at;
        $this->travel(1)->minutes();
        $this->postJson('/api/notifications/'.$oldest->public_id.'/read')->assertOk()->assertJsonPath('meta.read_id', $oldest->public_id);
        $this->assertTrue($firstRead->equalTo($oldest->fresh()->read_at));
    }
}

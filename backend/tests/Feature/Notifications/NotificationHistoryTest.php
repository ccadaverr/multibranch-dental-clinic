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

    public function test_history_pages_by_recorded_time_then_id_across_manila_midnight(): void
    {
        $recipient = $this->u['staffB1'];
        $center = app(NotificationCenter::class);
        $atMidnight = \Carbon\CarbonImmutable::parse('2026-09-28T16:00:00Z');
        $this->travelTo($atMidnight);
        $center->staffNotice($recipient, 'record_shared', 'Midnight notice', null, 'leave', null, 'history-midnight');
        $this->travelTo($atMidnight->subSecond());
        $center->staffNotice($recipient, 'record_shared', 'Previous day', null, 'leave', null, 'history-previous-day');
        $this->travelTo($atMidnight);
        $center->staffNotice($recipient, 'record_shared', 'Same instant', null, 'leave', null, 'history-same-instant');
        $this->travelTo($atMidnight->subDays(2));
        $center->staffNotice($recipient, 'record_shared', 'Old event inserted late', null, 'leave', null, 'history-old-event');

        $page = $this->getJson('/api/notifications')->assertOk()->assertJsonCount(50, 'data')
            ->assertJsonPath('data.0.title', 'Same instant')->assertJsonPath('data.1.title', 'Midnight notice')
            ->assertJsonPath('data.1.created_at', '2026-09-29T00:00:00+08:00')
            ->assertJsonPath('data.2.title', 'Previous day')->assertJsonPath('data.2.created_at', '2026-09-28T23:59:59+08:00')->json();
        $second = $this->getJson('/api/notifications?before='.$page['meta']['next_before'])
            ->assertOk()->assertJsonCount(50, 'data')->json();
        $last = $this->getJson('/api/notifications?before='.$second['meta']['next_before'])
            ->assertOk()->assertJsonCount(7, 'data')->assertJsonPath('data.6.title', 'Old event inserted late')
            ->assertJsonPath('meta.next_before', null)->json();
        $ids = array_merge(array_column($page['data'], 'id'), array_column($second['data'], 'id'), array_column($last['data'], 'id'));
        $this->assertCount(107, array_unique($ids));
        $this->assertEqualsCanonicalizing(UserNotification::where('user_id', $recipient->id)->pluck('public_id')->all(), $ids);
    }

    public function test_rejected_receipt_filters_do_not_mark_any_notification_read(): void
    {
        $mine = UserNotification::where('user_id', $this->u['staffB1']->id)->oldest('id')->firstOrFail();
        $foreign = UserNotification::where('user_id', $this->u['staffB2']->id)->sole();
        $this->postJson('/api/notifications/'.$mine->public_id.'/read?before='.$foreign->public_id)->assertNotFound();
        $this->assertNull($mine->fresh()->read_at);
        $this->postJson('/api/notifications/read-all?collection=invalid')->assertUnprocessable();
        $this->assertSame(0, UserNotification::whereNotNull('read_at')->count());
    }

    public function test_revoked_account_cannot_read_or_mutate_notification_history(): void
    {
        $mine = UserNotification::where('user_id', $this->u['staffB1']->id)->oldest('id')->firstOrFail();
        $this->u['staffB1']->forceFill(['account_status' => 'Inactive'])->save();

        $this->getJson('/api/notifications')->assertForbidden();
        $this->postJson('/api/notifications/'.$mine->public_id.'/read')->assertForbidden();
        $this->postJson('/api/notifications/read-all')->assertForbidden();
        $this->assertSame(0, UserNotification::whereNotNull('read_at')->count());
    }
}

<?php

namespace Tests\Feature\Notifications;

use App\Models\UserNotification;
use App\Services\Notifications\NotificationCenter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class NotificationIntegrationTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        Http::preventStrayRequests();
    }

    public function test_retrieval_and_read_commands_never_widen_to_role_branch_or_supplied_account(): void
    {
        $center = app(NotificationCenter::class);
        foreach (['patientA', 'patientB', 'staffB1', 'staffB2', 'dentist1', 'owner'] as $actor) {
            $center->staffNotice($this->u[$actor], 'record_shared', 'Synthetic notice', 'No clinical content', 'visits', null, 'qa-note-'.$actor);
        }
        foreach (['patientA', 'patientB', 'staffB1', 'staffB2', 'dentist1', 'owner'] as $actor) {
            $this->actingAsUser($actor);
            $own = UserNotification::where('user_id', $this->u[$actor]->id)->sole();
            $other = UserNotification::where('user_id', '!=', $this->u[$actor]->id)->first();
            $this->getJson('/api/notifications?user_id='.$other->user_id.'&branch_ref=b2')->assertOk()
                ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $own->public_id)->assertJsonPath('meta.unread', 1);
            $this->postJson("/api/notifications/{$other->public_id}/read")->assertNotFound();
            $this->postJson('/api/notifications/read-all')->assertOk()->assertJsonPath('meta.unread', 0);
            $readAt = $own->fresh()->read_at;
            $this->travel(1)->minutes();
            $this->postJson("/api/notifications/{$own->public_id}/read")->assertOk()->assertJsonPath('meta.unread', 0);
            $this->assertTrue($own->fresh()->read_at->equalTo($readAt), 'a retry preserves the first read timestamp');
        }
    }

    public function test_duplicate_events_are_once_and_dates_keep_manila_offset_across_midnight(): void
    {
        $center = app(NotificationCenter::class);
        $this->travelTo(\Carbon\CarbonImmutable::parse('2026-09-28 23:59:00', 'Asia/Manila'));
        $center->staffNotice($this->u['patientA'], 'record_shared', 'First', null, 'visits', null, 'qa-before');
        $this->travel(2)->minutes();
        $center->staffNotice($this->u['patientA'], 'record_shared', 'Second', null, 'visits', null, 'qa-after');
        $center->staffNotice($this->u['patientA'], 'record_shared', 'Duplicate', null, 'visits', null, 'qa-after');
        $this->actingAsUser('patientA');
        $this->getJson('/api/notifications')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.unread', 2)
            ->assertJsonPath('data.0.title', 'Second')->assertJsonPath('data.0.created_at', '2026-09-29T00:01:00+08:00')
            ->assertJsonPath('data.1.created_at', '2026-09-28T23:59:00+08:00');
    }

    public function test_failure_in_notification_savepoint_does_not_abort_the_surrounding_operation(): void
    {
        \Illuminate\Support\Facades\Exceptions::fake();
        \Illuminate\Support\Facades\DB::transaction(function () {
            app(NotificationCenter::class)->staffNotice($this->u['patientA'], 'not_a_valid_kind', 'Synthetic invalid event', null, 'visits', null, 'qa-invalid');
            $this->p['A']->update(['consent' => false]);
        });
        $this->assertSame(0, UserNotification::count());
        $this->assertFalse($this->p['A']->fresh()->consent);
        \Illuminate\Support\Facades\Exceptions::assertReported(\Illuminate\Database\QueryException::class);
    }
}

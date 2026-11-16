<?php

namespace Tests\Feature\Notifications;

use App\Models\AuditLog;
use App\Models\UserNotification;
use App\Services\Notifications\NotificationCenter;
use App\Services\Audit\AuditService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Requires the explicit Operations extension on a verified private test target. */
class NotificationArchiveTest extends TestCase
{
    use DatabaseTransactions, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $center = app(NotificationCenter::class);
        for ($i = 0; $i < 103; $i++) {
            $center->staffNotice($this->u['staffB1'], 'record_shared', 'Synthetic archive notice', null, 'leave', null, 'archive-'.$i);
        }
        $center->staffNotice($this->u['staffB2'], 'record_shared', 'Other account', null, 'leave', null, 'archive-other');
        $this->actingAsUser('staffB1');
    }

    public function test_archive_is_durable_recipient_only_repeat_safe_and_preserves_unread_history(): void
    {
        $note = UserNotification::where('user_id', $this->u['staffB1']->id)->oldest('id')->firstOrFail();
        $foreign = UserNotification::where('user_id', $this->u['staffB2']->id)->sole();
        $this->postJson('/api/notifications/'.$foreign->public_id.'/archive')->assertNotFound();
        $first = $this->postJson('/api/notifications/'.$note->public_id.'/archive')->assertOk()
            ->assertJsonPath('meta.archive_receipt.id', $note->public_id)->assertJsonPath('meta.archive_receipt.archived', true)
            ->assertJsonPath('meta.archive_receipt.replayed', false)->assertJsonPath('meta.unread', 102)->json('meta.archive_receipt.archived_at');
        $this->travel(2)->minutes();
        $this->postJson('/api/notifications/'.$note->public_id.'/archive')->assertOk()->assertJsonPath('meta.archive_receipt.replayed', true)
            ->assertJsonPath('meta.archive_receipt.archived_at', $first);
        $this->getJson('/api/notifications?collection=archived')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $note->public_id)->assertJsonPath('data.0.archived', true)->assertJsonPath('data.0.read', false);
        $this->assertNull($note->fresh()->read_at, 'Archive does not fabricate a read event.');
        $this->assertSame(1, DB::table('notification_archives')->count());
        $this->assertSame(1, AuditLog::where('action', 'notification.archived')->count());
        $this->actingAsUser('owner');
        $this->postJson('/api/notifications/'.$note->public_id.'/archive')->assertNotFound();
        $this->getJson('/api/notifications?collection=archived')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_cursor_remains_usable_after_its_anchor_is_archived_and_read_commutes_with_archive(): void
    {
        $first = $this->getJson('/api/notifications')->assertOk()->json();
        $anchor = $first['meta']['next_before'];
        $this->postJson('/api/notifications/'.$anchor.'/archive')->assertOk();
        $next = $this->getJson('/api/notifications?before='.$anchor)->assertOk()->assertJsonCount(50, 'data')->json('data');
        $this->assertEmpty(array_intersect(array_column($first['data'], 'id'), array_column($next, 'id')));
        $this->postJson('/api/notifications/'.$anchor.'/read?collection=archived')->assertOk()->assertJsonPath('meta.read_id', $anchor);
        $this->getJson('/api/notifications?collection=archived')->assertOk()->assertJsonPath('data.0.read', true)->assertJsonPath('data.0.archived', true);
        $this->assertSame(1, DB::table('notification_archives')->count());
    }

    public function test_audit_failure_rolls_back_archive_and_archive_history_is_append_only(): void
    {
        $note = UserNotification::where('user_id', $this->u['staffB1']->id)->firstOrFail();
        $this->app->bind(AuditService::class, fn () => new class extends AuditService {
            public function record(array $attributes): AuditLog
            {
                parent::record($attributes);
                throw new \RuntimeException('Synthetic archive audit failure');
            }
        });
        $this->withoutExceptionHandling();
        try {
            $this->postJson('/api/notifications/'.$note->public_id.'/archive');
            $this->fail('Archive/audit must commit together.');
        } catch (\RuntimeException $exception) {
            $this->assertSame('Synthetic archive audit failure', $exception->getMessage());
        }
        $this->assertSame(0, DB::table('notification_archives')->count());
        $this->app->forgetInstance(AuditService::class);
        $this->app->bind(AuditService::class, fn () => new AuditService);
        $this->postJson('/api/notifications/'.$note->public_id.'/archive')->assertOk();
        foreach (['UPDATE notification_archives SET archived_at = now()', 'DELETE FROM notification_archives', 'TRUNCATE notification_archives'] as $statement) {
            try {
                DB::transaction(fn () => DB::statement($statement));
                $this->fail('Archive history must be immutable.');
            } catch (\Illuminate\Database\QueryException $exception) {
                if (str_starts_with($statement, 'TRUNCATE')) {
                    $this->assertSame('42501', $exception->errorInfo[0], 'The application role must not have TRUNCATE permission.');
                    $this->assertTrue(DB::table('pg_trigger')->where('tgname', 'notification_archives_no_truncate')->exists());
                } else {
                    $this->assertStringContainsString('append-only', $exception->getMessage());
                }
            }
        }
        $this->assertSame(1, DB::table('notification_archives')->count());
    }

    public function test_active_continuation_can_end_empty_after_older_notifications_are_archived(): void
    {
        $first = $this->getJson('/api/notifications')->assertOk()->assertJsonCount(50, 'data')
            ->assertJsonPath('meta.has_more', true)->json();
        $visible = array_column($first['data'], 'id');
        $older = UserNotification::where('user_id', $this->u['staffB1']->id)
            ->whereNotIn('public_id', $visible)->pluck('public_id');
        $this->assertCount(53, $older);
        foreach ($older as $id) {
            $this->postJson('/api/notifications/'.$id.'/archive')->assertOk()
                ->assertJsonPath('meta.archive_receipt.id', $id);
        }

        $this->getJson('/api/notifications?before='.$first['meta']['next_before'])->assertOk()
            ->assertJsonCount(0, 'data')->assertJsonPath('meta.has_more', false)
            ->assertJsonPath('meta.next_before', null)->assertJsonPath('meta.unread', 50);
        $this->assertSame(53, DB::table('notification_archives')->count());
        $this->assertSame(53, AuditLog::where('action', 'notification.archived')->count());
        $this->assertSame(103, UserNotification::where('user_id', $this->u['staffB1']->id)->whereNull('read_at')->count());
    }

    public function test_history_page_and_unread_total_share_a_snapshot_when_state_changes_mid_response(): void
    {
        $recipient = $this->u['staffB1'];
        [$archived, $read] = UserNotification::where('user_id', $recipient->id)->latest('id')->limit(2)->get()->all();
        $interleaved = false;
        DB::listen(function (\Illuminate\Database\Events\QueryExecuted $event) use ($recipient, $archived, $read, &$interleaved) {
            if ($interleaved || ! str_contains($event->sql, 'from "user_notifications"') ||
                ! str_contains($event->sql, '"created_at" desc') || ! str_contains($event->sql, 'limit 51')) {
                return;
            }
            $interleaved = true;
            // Exactly after the page SELECT, before any follow-up SELECT can see the new state.
            DB::table('notification_archives')->insert(['notification_id' => $archived->id, 'archived_by_user_id' => $recipient->id]);
            DB::table('user_notifications')->where('id', $read->id)->update(['read_at' => '2026-09-28T10:00:00+08:00']);
        });

        $this->getJson('/api/notifications')->assertOk()->assertJsonPath('meta.unread', 103)
            ->assertJsonPath('data.0.id', $archived->public_id)->assertJsonPath('data.0.archived', false)
            ->assertJsonPath('data.1.id', $read->public_id)->assertJsonPath('data.1.read', false);
        $this->assertTrue($interleaved, 'The query barrier must run before the response returns.');

        $this->getJson('/api/notifications')->assertOk()->assertJsonPath('meta.unread', 101)
            ->assertJsonPath('data.0.id', $read->public_id)->assertJsonPath('data.0.read', true)
            ->assertJsonMissing(['id' => $archived->public_id]);
        $this->getJson('/api/notifications?collection=archived')->assertOk()->assertJsonPath('meta.unread', 101)
            ->assertJsonPath('data.0.id', $archived->public_id)->assertJsonPath('data.0.archived', true)
            ->assertJsonPath('data.0.read', false);
    }

    public function test_each_role_reads_back_only_its_own_archived_notice_and_cannot_enumerate_foreign_ids(): void
    {
        $roles = ['staffB1', 'dentist1', 'owner', 'patientA'];
        $notes = [];
        foreach ($roles as $role) {
            $key = 'cross-role-archive-'.$role;
            app(NotificationCenter::class)->staffNotice($this->u[$role], 'record_shared', 'Synthetic recipient notice', null, 'visits', null, $key);
            $notes[$role] = UserNotification::where('dedupe_key', $key)->sole()->public_id;
        }

        foreach ($roles as $role) {
            $this->actingAsUser($role);
            $this->postJson('/api/notifications/'.$notes[$role].'/archive')->assertOk()
                ->assertJsonPath('meta.archive_receipt.id', $notes[$role]);
        }

        $missing = strtolower((string) \Illuminate\Support\Str::ulid());
        foreach ($roles as $role) {
            $this->actingAsUser($role);
            $this->getJson('/api/notifications?collection=archived')->assertOk()->assertJsonCount(1, 'data')
                ->assertJsonPath('data.0.id', $notes[$role])->assertJsonPath('data.0.read', false);
            $foreign = $role === 'staffB1' ? $notes['patientA'] : $notes['staffB1'];
            $history = '/api/notifications?collection=archived&before=';
            $unknown = $this->getJson($history.$missing)->assertNotFound()->json('message');
            $this->getJson($history.$foreign)->assertNotFound()->assertJsonPath('message', $unknown);
            foreach (['read', 'archive'] as $command) {
                $unknown = $this->postJson('/api/notifications/'.$missing.'/'.$command)->assertNotFound()->json('message');
                $this->postJson('/api/notifications/'.$foreign.'/'.$command)->assertNotFound()->assertJsonPath('message', $unknown);
            }
        }
        $this->assertSame(4, DB::table('notification_archives')->count());
        $this->assertSame(4, AuditLog::where('action', 'notification.archived')->count());
        $this->assertSame(4, UserNotification::whereIn('public_id', $notes)->whereNull('read_at')->count());
    }
}

<?php

namespace Tests\Support;

use App\Models\Conversation;
use App\Models\ConversationDentistGrant;
use App\Models\ConversationMessage;
use App\Models\UserNotification;
use App\Services\Audit\AuditService;
use App\Services\Messaging\ConversationDentistAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Reviewed proposal schema only; intentionally outside normal feature discovery. */
final class ConversationGrantLabTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;
    private Conversation $conversation;

    protected function setUp(): void
    {
        parent::setUp();
        IsolatedDatabaseGuard::assertSafe($this->app);
        $target = IsolatedDatabaseGuard::manifest();
        if (getenv('DENTALOPS_GRANT_LAB') !== $target['cluster_id'] || ! str_starts_with(basename($target['runtime']), 'contention-')
            || ! app(ConversationDentistAccess::class)->available()) throw new \RuntimeException('Use the separately approved disposable grant lab.');
        $this->setUpSchedulingWorld();
        config(['queue.default' => 'database', 'mail.default' => 'array', 'broadcasting.default' => 'log']);
        $this->actingAsUser('patientA');
        $id = $this->postJson('/api/conversations', ['branch_id' => $this->b['b1']->public_id, 'body' => 'Synthetic immutable conversation history'], ['Idempotency-Key' => 'grant-conversation-start'])
            ->assertCreated()->json('data.conversation.id');
        $this->conversation = Conversation::where('public_id', $id)->sole();
    }

    private function assign(string $dentist, int $revision, string $key, string $reason = 'Synthetic authorized reassignment')
    {
        $this->actingAsUser('staffB1');
        return $this->postJson('/api/conversations/'.$this->conversation->public_id.'/participants',
            ['dentist_id' => $this->u[$dentist]->public_id, 'expected_revision' => $revision, 'reason' => $reason], ['Idempotency-Key' => $key]);
    }

    public function test_full_grant_switch_readback_revocation_notifications_and_original_key_recovery(): void
    {
        $oldMessages = ConversationMessage::all()->map->getAttributes()->all();
        $first = $this->assign('dentist1', 1, 'grant-first')->assertCreated()->json('data');
        $audit = \App\Models\AuditLog::where('action', 'conversation.dentist_reassigned')->sole();
        $this->assertSame($this->b['b1']->id, $audit->branch_id);
        $this->assertSame($this->u['staffB1']->id, $audit->actor_user_id);
        $this->assertNotNull($audit->created_at);
        $this->actingAsUser('dentist1');
        $this->getJson('/api/conversations/'.$this->conversation->public_id.'/messages')->assertOk()->assertJsonPath('data.0.body', 'Synthetic immutable conversation history');
        $sent = $this->postJson('/api/conversations/'.$this->conversation->public_id.'/messages', ['body' => 'Synthetic first Dentist reply'], ['Idempotency-Key' => 'former-dentist-send'])->assertCreated()->json('data.id');
        $this->actingAsUser('patientA');
        $this->postJson('/api/conversations/'.$this->conversation->public_id.'/messages', ['body' => 'Synthetic earlier Patient reply'], ['Idempotency-Key' => 'before-switch-message'])->assertCreated();
        $historicalNotice = UserNotification::where('user_id', $this->u['dentist1']->id)->where('kind', 'message_received')->sole();
        $delayedSignal = new \App\Events\Messaging\MessagePosted($this->conversation->public_id, $sent, 'Patient', $this->b['b1']->public_id,
            [$this->u['dentist1']->public_id, $this->u['dentist2']->public_id, $this->u['patientA']->public_id]);
        $second = $this->assign('dentist2', $first['revision'], 'grant-switch')->assertCreated()->json('data');
        $this->assertSame(2, ConversationDentistGrant::count());
        $this->assign('dentist2', $first['revision'], 'grant-switch')->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.grant_id', $second['grant_id']);
        $this->assign('dentist1', $second['revision'], 'grant-switch')->assertUnprocessable()->assertJsonPath('code', 'idempotency_key_reused');
        $this->assertSame(2, ConversationDentistGrant::count());
        $this->assertFalse(app(ConversationDentistAccess::class)->permits($this->u['dentist1'], $this->conversation));
        $this->assertTrue(app(ConversationDentistAccess::class)->permits($this->u['dentist2'], $this->conversation));
        $this->actingAsUser('dentist1');
        foreach (['', '/messages'] as $suffix) $this->getJson('/api/conversations/'.$this->conversation->public_id.$suffix)->assertForbidden();
        $this->postJson('/api/conversations/'.$this->conversation->public_id.'/messages', ['body' => 'Synthetic first Dentist reply'], ['Idempotency-Key' => 'former-dentist-send'])->assertForbidden();
        $this->postJson('/api/conversations/'.$this->conversation->public_id.'/read', ['up_to' => $sent])->assertForbidden();
        $this->assertSame([], $this->getJson('/api/conversations')->assertOk()->json('data'));
        $oldNotices = $this->getJson('/api/notifications')->assertOk()->json('data');
        $this->assertContains($historicalNotice->public_id, array_column($oldNotices, 'id'), 'Historical notification audit evidence is retained.');
        $this->getJson('/api/conversations/'.$historicalNotice->target_id.'/messages')->assertForbidden();
        $channels = array_map(fn ($channel) => $channel->name, $delayedSignal->broadcastOn());
        $this->assertNotContains('private-user.'.strtolower($this->u['dentist1']->public_id), $channels);
        $this->assertNotContains('private-conversation.'.strtolower($this->conversation->public_id), $channels, 'A previously subscribed channel must not leak future message signals.');
        $this->assertContains('private-user.'.strtolower($this->u['dentist2']->public_id), $channels);
        $this->actingAsUser('dentist2');
        $history = $this->getJson('/api/conversations/'.$this->conversation->public_id.'/messages')->assertOk();
        $this->assertCount(3, $history->json('data'));
        $this->assertSame($oldMessages[0], ConversationMessage::first()->getAttributes());
        $beforeFormer = UserNotification::where('user_id', $this->u['dentist1']->id)->count();
        $this->actingAsUser('patientA');
        $this->postJson('/api/conversations/'.$this->conversation->public_id.'/messages', ['body' => 'Synthetic post-switch Patient reply'], ['Idempotency-Key' => 'after-switch-message'])->assertCreated();
        $this->assertSame($beforeFormer, UserNotification::where('user_id', $this->u['dentist1']->id)->count());
        $this->assertSame(1, UserNotification::where('user_id', $this->u['dentist2']->id)->where('kind', 'message_received')->count());
        $this->actingAsUser('dentist2');
        $this->assertContains($this->conversation->public_id, array_map(fn ($row) => $row['target']['id'] ?? null, $this->getJson('/api/notifications')->assertOk()->json('data')));
        $this->assign('dentist1', $second['revision'], 'grant-switch-back')->assertCreated();
        $this->assertTrue(app(ConversationDentistAccess::class)->permits($this->u['dentist1'], $this->conversation));
        $this->assertFalse(app(ConversationDentistAccess::class)->permits($this->u['dentist2'], $this->conversation));
        $this->assertSame(3, ConversationDentistGrant::count());
        $this->assertSame(0, DB::table('visits')->count(), 'Conversation grants never admit or modify clinical care.');
    }

    public function test_scope_role_validation_and_stale_revision_fail_without_a_grant(): void
    {
        $this->assign('dentist3', 1, 'foreign-dentist')->assertUnprocessable();
        $this->assign('patientB', 1, 'foreign-role')->assertUnprocessable();
        $this->assign('dentist1', 99, 'stale-grant')->assertConflict()->assertJsonPath('code', 'stale_revision');
        $this->assign('dentist1', 1, 'blank-grant', '  ')->assertUnprocessable();
        foreach (['staffB2', 'owner', 'patientB', 'dentist1'] as $who) {
            $this->actingAsUser($who);
            $this->postJson('/api/conversations/'.$this->conversation->public_id.'/participants',
                ['dentist_id' => $this->u['dentist1']->public_id, 'expected_revision' => 1, 'reason' => 'Synthetic'], ['Idempotency-Key' => 'unauthorized-'.$who])->assertForbidden();
        }
        $this->assertSame(0, ConversationDentistGrant::count());
        $this->assertSame(1, $this->conversation->fresh()->revision);
    }

    public function test_audit_failure_rolls_back_grant_revision_participant_and_notification(): void
    {
        $this->app->bind(AuditService::class, fn () => new class extends AuditService {
            public function record(array $attributes): \App\Models\AuditLog
            { throw new \RuntimeException('Synthetic audit unavailable'); }
        });
        $this->assign('dentist1', 1, 'failed-audit')->assertServerError();
        $this->assertSame(0, ConversationDentistGrant::count());
        $this->assertSame(0, UserNotification::count());
        $this->assertNull($this->conversation->fresh()->active_dentist_grant_id);
        $this->assertSame(1, $this->conversation->fresh()->revision);
        $this->assertFalse($this->conversation->participants()->where('user_id', $this->u['dentist1']->id)->exists());
    }

    public function test_branch_revocation_applies_to_delayed_read_and_replay_authority(): void
    {
        $this->assign('dentist1', 1, 'revoked-staff-retry')->assertCreated();
        DB::table('dentist_branches')->where('dentist_profile_id', $this->d['d1']->id)->update(['branch_id' => $this->b['b2']->id]);
        $this->assertFalse(app(ConversationDentistAccess::class)->permits($this->u['dentist1'], $this->conversation));
        $this->actingAsUser('dentist1');
        $this->getJson('/api/conversations/'.$this->conversation->public_id.'/messages')->assertForbidden();
        DB::table('user_branch_scopes')->where('user_id', $this->u['staffB1']->id)->update(['branch_id' => $this->b['b2']->id]);
        $this->assign('dentist1', 1, 'revoked-staff-retry')->assertForbidden();
    }

    public function test_grants_are_encrypted_and_database_immutable(): void
    {
        $this->assign('dentist1', 1, 'immutable-grant')->assertCreated();
        $grant = ConversationDentistGrant::sole();
        $this->assertSame('Synthetic authorized reassignment', $grant->reason);
        $this->assertNotSame($grant->reason, DB::table('conversation_dentist_grants')->value('reason'));
        $this->assertSame([$this->conversation->id, $this->p['A']->id, $this->b['b1']->id, $this->u['staffB1']->id],
            [$grant->conversation_id, $grant->patient_id, $grant->branch_id, $grant->authorized_by_user_id]);
        $this->assertNotNull($grant->created_at);
        $this->expectException(\Illuminate\Database\QueryException::class);
        DB::table('conversation_dentist_grants')->where('id', $grant->id)->update(['reason' => 'must fail']);
    }

    public function test_database_refuses_an_active_grant_from_another_patient_branch_and_conversation(): void
    {
        $this->assign('dentist1', 1, 'scope-fk-grant')->assertCreated();
        $other = Conversation::create(['patient_id' => $this->p['B']->id, 'branch_id' => $this->b['b2']->id,
            'context' => 'Synthetic foreign scope', 'status' => 'Open', 'revision' => 1]);
        $this->expectException(\Illuminate\Database\QueryException::class);
        $this->expectExceptionMessage('conversation_active_grant_scope_fk');
        DB::table('conversations')->where('id', $other->id)->update(['active_dentist_grant_id' => ConversationDentistGrant::sole()->id]);
    }

    public function test_disabling_new_grants_never_reactivates_former_dentist_access(): void
    {
        $this->assign('dentist1', 1, 'cutover-first')->assertCreated();
        $this->assign('dentist2', 2, 'cutover-second')->assertCreated();
        config(['messaging.conversation_grants_enabled' => false]);
        $this->actingAsUser('dentist1');
        $this->getJson('/api/conversations/'.$this->conversation->public_id.'/messages')->assertForbidden();
        $this->actingAsUser('dentist2');
        $this->getJson('/api/conversations/'.$this->conversation->public_id.'/messages')->assertOk();
        $this->assign('dentist1', 3, 'disabled-new-grant')->assertConflict()->assertJsonPath('code', 'conversation_grants_unavailable');
        $this->assertSame(2, ConversationDentistGrant::count());
    }

    public function test_conversation_grant_never_grants_private_document_or_visit_responsibility(): void
    {
        $this->actingAsUser('staffB1');
        $visit = $this->postJson('/api/visits/walk-in', ['patient_id' => $this->p['A']->public_id, 'branch_ref' => 'b1', 'service_ref' => 'svc1', 'dentist_ref' => 'd1'],
            ['Idempotency-Key' => 'grant-boundary-visit'])->assertCreated()->json('data.id');
        $document = $this->postJson('/api/documents', ['patient_id' => $this->p['A']->public_id, 'branch_id' => 'b1', 'visit_id' => $visit,
            'category' => 'other', 'file' => \Illuminate\Http\UploadedFile::fake()->createWithContent('synthetic.pdf', "%PDF-1.4\n1 0 obj\n<< >>\nstream\nBT (Synthetic grant boundary) Tj ET\nendstream\nendobj\n%%EOF")],
            ['Idempotency-Key' => 'grant-boundary-document'])->assertCreated()->json('data.id');
        $state = \App\Models\Visit::where('public_id', $visit)->sole()->getAttributes();
        $this->assign('dentist2', 1, 'document-boundary-grant')->assertCreated();
        $this->actingAsUser('dentist2');
        $this->getJson('/api/conversations/'.$this->conversation->public_id.'/messages')->assertOk();
        $this->getJson('/api/documents/'.$document.'/download')->assertForbidden();
        $this->assertSame($state, \App\Models\Visit::where('public_id', $visit)->sole()->getAttributes());
    }

    public function test_legacy_shared_add_command_cannot_bypass_grants_after_cutover(): void
    {
        $this->expectException(\App\Services\Visits\VisitCommandException::class);
        $this->expectExceptionMessage('Use an authorized reassignment');
        app(\App\Services\Messaging\MessagingService::class)->addDentist($this->u['staffB1'], $this->conversation, $this->u['dentist1']->public_id);
    }

    public function test_revoked_shared_sender_cannot_recover_old_receipt_text_even_without_controller_guard(): void
    {
        $this->assign('dentist1', 1, 'shared-first')->assertCreated()->assertHeader('Cache-Control', 'no-store, private');
        $messaging = app(\App\Services\Messaging\MessagingService::class);
        $messaging->send($this->u['dentist1'], $this->conversation, 'Synthetic pre-revocation message', 'old-shared-send');
        $this->assign('dentist2', 2, 'shared-second')->assertCreated();
        $this->expectException(\App\Services\Visits\VisitCommandException::class);
        $messaging->send($this->u['dentist1'], $this->conversation, 'Synthetic pre-revocation message', 'old-shared-send');
    }
}

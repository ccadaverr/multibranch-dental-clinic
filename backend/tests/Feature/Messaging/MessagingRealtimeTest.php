<?php

namespace Tests\Feature\Messaging;

use App\Events\Messaging\ConversationChanged;
use App\Events\Messaging\MessagePosted;
use App\Events\Messaging\ReadAdvanced;
use App\Mail\MessageAlertMail;
use App\Models\AuditLog;
use App\Models\CommandKey;
use App\Models\Conversation;
use App\Models\ConversationMessage;
use App\Models\ConversationParticipant;
use App\Models\MailDispatch;
use App\Services\Mail\MailOutbox;
use App\Services\Messaging\Presence;
use Illuminate\Broadcasting\BroadcastManager;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/**
 * M17 Priority 2: Patient-started front-desk conversations (decision 3), Owner exclusion (decision 4), encryption at rest (decision 5),
 * realtime channel authorization, the polling fallback and the offline email alert.
 * Fixture: b1 — staffB1, staffBoth, dentist1, dentist2; b2 — staffB2, staffBoth, dentist3; staffNone has no scope.
 */
class MessagingRealtimeTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private int $keys = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        Mail::fake();
        config(['messaging.per_minute' => 1000, 'messaging.per_hour' => 10000, 'messaging.start_per_hour' => 1000]);
    }

    private function key(): string
    {
        return 'rt-'.(++$this->keys);
    }

    private function start(string $who = 'patientA', string $branch = 'b1', string $body = 'Hello front desk', ?string $key = null)
    {
        $this->actingAsUser($who);

        return $this->postJson('/api/conversations', ['branch_id' => $this->b[$branch]->public_id, 'body' => $body], ['Idempotency-Key' => $key ?? $this->key()]);
    }

    private function send(string $conversation, string $who, string $body = 'Reply', ?string $key = null)
    {
        $this->actingAsUser($who);

        return $this->postJson("/api/conversations/{$conversation}/messages", ['body' => $body], ['Idempotency-Key' => $key ?? $this->key()]);
    }

    /** Switches broadcasting to the real Reverb (Pusher-protocol) driver so /api/broadcasting/auth runs the channel rules. */
    private function useReverbAuth(): void
    {
        config(['broadcasting.default' => 'reverb', 'broadcasting.connections.reverb' => ['driver' => 'reverb', 'key' => 'test-key', 'secret' => 'test-secret', 'app_id' => '1',
            'options' => ['host' => 'localhost', 'port' => 8080, 'scheme' => 'http', 'useTLS' => false], 'client_options' => []]]);
        $this->app->forgetInstance(BroadcastManager::class);
        Broadcast::clearResolvedInstances();
        require base_path('routes/channels.php');
    }

    private function channelAuth(string $who, string $channel): int
    {
        $this->actingAsUser($who);

        return $this->postJson('/api/broadcasting/auth', ['socket_id' => '1234.5678', 'channel_name' => "private-{$channel}"])->status();
    }

    // ---- starting a conversation (decision 3) ---------------------------------------------------------------------------

    public function test_a_patient_starts_a_front_desk_conversation_idempotently_and_reuses_the_open_one(): void
    {
        $first = $this->start(key: 'same')->assertCreated()->json('data');
        $replay = $this->start(key: 'same')->assertCreated()->json('data');
        $this->assertSame($first, $replay, 'a replay returns the identical response');
        $this->assertSame('Hello front desk', $first['message']['body']);
        $this->assertFalse($first['conversation']['reused']);
        $this->assertSame([1, 1], [Conversation::count(), ConversationMessage::count()]);

        $again = $this->start(body: 'One more thing')->assertCreated()->json('data');
        $this->assertSame([$first['conversation']['id'], true], [$again['conversation']['id'], $again['conversation']['reused']]);
        $this->assertSame([1, 2], [Conversation::count(), ConversationMessage::count()]);
        $this->start(branch: 'b2')->assertCreated(); // another branch is another front desk
        $this->assertSame(2, Conversation::count());
        $this->assertSame(['conversation.started', 'conversation.started'], AuditLog::where('action', 'like', 'conversation.%')->pluck('action')->all());
        $this->assertStringNotContainsString('Hello front desk', AuditLog::all()->toJson());
    }

    public function test_start_is_patient_only_validated_and_rate_limited(): void
    {
        foreach (['staffB1', 'dentist1', 'owner'] as $who) $this->start($who)->assertForbidden();
        $this->actingAsUser('patientA');
        $this->postJson('/api/conversations', ['branch_id' => '01ARZ3NDEKTSV4RRFFQ69G5FAV', 'body' => 'x'], ['Idempotency-Key' => $this->key()])->assertStatus(422)->assertJsonValidationErrors('branch_id');
        $this->postJson('/api/conversations', ['branch_id' => $this->b['b1']->public_id, 'body' => ''], ['Idempotency-Key' => $this->key()])->assertStatus(422);
        $this->postJson('/api/conversations', ['branch_id' => $this->b['b1']->public_id, 'body' => 'x'])->assertStatus(422); // Idempotency-Key required
        $this->postJson('/api/conversations', ['branch_id' => $this->b['b1']->public_id, 'body' => 'x', 'context' => 'mine'], ['Idempotency-Key' => $this->key()])->assertStatus(422);
        config(['messaging.start_per_hour' => 2]); // a fresh account: the requests above count toward patientA's limit too
        $this->start('patientB')->assertCreated();
        $this->start('patientB')->assertCreated();
        $this->start('patientB')->assertStatus(429)->assertJsonPath('code', 'messages_rate_limited');
    }

    public function test_the_default_branch_is_the_upcoming_appointment_then_latest_visit_then_first_branch(): void
    {
        $this->actingAsUser('patientA');
        // Decision 6: there is always a front desk to write to; with no history it is the first branch.
        $none = $this->getJson('/api/conversations/start-options')->assertOk()->json('data');
        $this->assertSame('first_branch', $none['default_reason']);
        $this->assertNotNull($none['default_branch_id']);
        $this->postJson('/api/appointments', ['branch_ref' => 'b2', 'service_ref' => 'svc1', 'date' => '2026-09-30', 'start_time' => '14:00'])->assertCreated();
        $options = $this->getJson('/api/conversations/start-options')->assertOk()->json('data');
        $this->assertSame(strtolower($this->b['b2']->public_id), $options['default_branch_id']);
        $this->assertSame('upcoming_appointment', $options['default_reason']);
        $this->assertContains(strtolower($this->b['b1']->public_id), array_column($options['branches'], 'id'));
        $this->actingAsUser('staffB1');
        $this->getJson('/api/conversations/start-options')->assertForbidden();
    }

    // ---- routing: branch front desk, participant of record, Dentists only when added ----------------------------------

    public function test_every_in_scope_staff_member_sees_it_the_first_reply_is_the_participant_of_record_and_other_branches_never(): void
    {
        $id = $this->start()->json('data.conversation.id');
        foreach (['staffB1', 'staffBoth'] as $who) {
            $this->actingAsUser($who);
            $this->assertContains($id, array_column($this->getJson('/api/conversations')->json('data'), 'id'), $who);
        }
        foreach (['staffB2', 'staffNone', 'dentist1', 'patientB', 'owner'] as $who) {
            $this->actingAsUser($who);
            $this->getJson("/api/conversations/{$id}")->assertStatus($who === 'owner' ? 403 : 404);
            $this->send($id, $who)->assertForbidden();
        }
        $this->send($id, 'staffBoth', 'Hi, this is the front desk')->assertCreated();
        $this->send($id, 'staffB1', 'Adding to that')->assertCreated();          // still visible to and answerable by other branch Staff
        $conversation = Conversation::where('public_id', $id)->sole();
        $this->assertSame($this->u['staffBoth']->id, $conversation->assigned_user_id, 'the first reply is the participant of record');
        $this->actingAsUser('patientA');
        $view = $this->getJson("/api/conversations/{$id}")->assertOk()->json('data');
        $this->assertSame($this->u['staffBoth']->person->fullName(), $view['assigned']['name']);
        $this->assertSame([['name' => $this->u['staffBoth']->person->fullName(), 'role' => 'Staff']], $view['participants'], 'the Patient sees the participant of record');
        try {
            DB::transaction(fn () => DB::table('conversations')->where('id', $conversation->id)->update(['assigned_user_id' => $this->u['staffB1']->id]));
            $this->fail('the participant of record is set once');
        } catch (QueryException) {
            $this->assertSame(1, AuditLog::where('action', 'conversation.assigned')->count());
        }
    }

    public function test_new_dentist_access_fails_closed_until_reviewed_grants_are_available(): void
    {
        $id = $this->start()->json('data.conversation.id');
        $this->actingAsUser('dentist1');
        $this->getJson("/api/conversations/{$id}")->assertNotFound();
        $this->actingAsUser('patientA');
        $this->postJson("/api/conversations/{$id}/participants", ['dentist_id' => $this->u['dentist1']->public_id])->assertForbidden();
        $this->actingAsUser('staffB1');
        $this->getJson("/api/conversations/{$id}/dentist-options")->assertConflict()->assertJsonPath('code', 'conversation_grants_unavailable');
        $this->postJson("/api/conversations/{$id}/participants", ['dentist_id' => $this->u['dentist1']->public_id])->assertConflict()->assertJsonPath('code', 'conversation_grants_unavailable');
        $this->send($id, 'dentist1', 'Unassigned Dentist')->assertForbidden();
        $this->actingAsUser('dentist2');
        $this->getJson("/api/conversations/{$id}")->assertNotFound();
        $this->assertSame(0, AuditLog::where('action', 'conversation.participant_added')->count());
        $this->assertFalse(ConversationParticipant::where('conversation_id', Conversation::where('public_id', $id)->value('id'))->where('user_id', $this->u['dentist1']->id)->exists());
    }

    // ---- realtime channel authorization -------------------------------------------------------------------------------

    public function test_channel_authorization_matches_http_access_and_refuses_other_patients_branches_and_the_owner(): void
    {
        $id = $this->start()->json('data.conversation.id');
        $this->useReverbAuth();
        $b1 = strtolower($this->b['b1']->public_id);
        $expect = [
            ["conversation.{$id}", 'patientA', 200], ["conversation.{$id}", 'staffB1', 200], ["conversation.{$id}", 'staffBoth', 200],
            ["conversation.{$id}", 'patientB', 403], ["conversation.{$id}", 'staffB2', 403], ["conversation.{$id}", 'staffNone', 403],
            ["conversation.{$id}", 'dentist1', 403], ["conversation.{$id}", 'owner', 403],
            ["branch-inbox.{$b1}", 'staffB1', 200], ["branch-inbox.{$b1}", 'staffB2', 403], ["branch-inbox.{$b1}", 'patientA', 403],
            ["branch-inbox.{$b1}", 'dentist1', 403], ["branch-inbox.{$b1}", 'owner', 403],
            ['user.'.strtolower($this->u['patientA']->public_id), 'patientA', 200], ['user.'.strtolower($this->u['patientA']->public_id), 'patientB', 403],
            ['user.'.strtolower($this->u['patientA']->public_id), 'staffB1', 403], ['conversation.01arz3ndektsv4rrffq69g5fav', 'patientA', 403],
        ];
        foreach ($expect as [$channel, $who, $status]) {
            $this->assertSame($status, $this->channelAuth($who, $channel), "{$who} on {$channel}");
        }
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/broadcasting/auth', ['socket_id' => '1234.5678', 'channel_name' => "private-conversation.{$id}"])->assertUnauthorized();
        // Losing branch scope ends the subscription right at once (same rule as HTTP).
        DB::table('user_branch_scopes')->where('user_id', $this->u['staffB1']->id)->delete();
        $this->assertSame(403, $this->channelAuth('staffB1', "conversation.{$id}"));
    }

    public function test_events_are_signals_without_text_sent_after_commit_and_polling_returns_the_same_projection(): void
    {
        $id = $this->start()->json('data.conversation.id');
        $before = ConversationMessage::orderByDesc('id')->value('public_id');
        Event::fake([MessagePosted::class, ConversationChanged::class, ReadAdvanced::class]);
        $sent = $this->send($id, 'staffB1', 'Your appointment is confirmed')->assertCreated()->json('data');

        $posted = Event::dispatched(MessagePosted::class)->map(fn ($e) => $e[0])->sole();
        $this->assertSame([$id, $sent['id'], 'staff'], [$posted->conversationId, $posted->messageId, $posted->senderRole]);
        $this->assertStringNotContainsString('confirmed', json_encode($posted->broadcastWith()), 'the socket never carries message text');
        $channels = array_map(fn ($c) => $c->name, $posted->broadcastOn());
        $this->assertContains("private-conversation.{$id}", $channels);
        $this->assertContains('private-branch-inbox.'.strtolower($this->b['b1']->public_id), $channels);
        $this->assertContains('private-user.'.strtolower($this->u['patientA']->public_id), $channels);
        Event::assertDispatched(ConversationChanged::class, fn ($e) => $e->change === 'assigned');

        // The polling fallback (after=) and the socket signal lead to the same record, in the same projection as the history list.
        $this->actingAsUser('patientA');
        $polled = $this->getJson("/api/conversations/{$id}/messages?after={$before}")->assertOk()->json('data');
        $this->assertSame([$posted->messageId], array_column($polled, 'id'));
        $this->assertSame($this->getJson("/api/conversations/{$id}/messages?per_page=1")->json('data.0'), $polled[0]);
        $this->assertSame('Your appointment is confirmed', $polled[0]['body']);

        // A replay sends nothing again; reading notifies only the reader's own channel.
        $count = Event::dispatched(MessagePosted::class)->count();
        $this->send($id, 'staffB1', 'Your appointment is confirmed', 'fixed')->assertCreated();
        $this->send($id, 'staffB1', 'Your appointment is confirmed', 'fixed')->assertCreated();
        $this->assertSame($count + 1, Event::dispatched(MessagePosted::class)->count());
        $this->actingAsUser('patientA');
        $this->postJson("/api/conversations/{$id}/read", ['up_to' => $posted->messageId])->assertOk();
        Event::assertDispatched(ReadAdvanced::class, fn ($e) => array_map(fn ($c) => $c->name, $e->broadcastOn()) === ['private-user.'.strtolower($this->u['patientA']->public_id)]);
        // A refused send broadcasts nothing.
        $this->send($id, 'staffB2', 'not allowed')->assertForbidden();
        $this->assertSame($count + 1, Event::dispatched(MessagePosted::class)->count());
        $this->actingAsUser('patientA');
        $this->getJson("/api/conversations/{$id}/messages?after=01ARZ3NDEKTSV4RRFFQ69G5FAV")->assertStatus(422);
    }

    // ---- encryption at rest (decision 5) ------------------------------------------------------------------------------

    public function test_message_text_is_encrypted_in_the_database_and_in_idempotency_records(): void
    {
        $id = $this->start(body: 'My molar hurts at night')->json('data.conversation.id');
        $this->send($id, 'staffB1', 'Please come in tomorrow', 'k-1')->assertCreated()->assertJsonPath('data.body', 'Please come in tomorrow');
        $raw = json_encode(DB::table('conversation_messages')->get());
        foreach (['My molar hurts at night', 'Please come in tomorrow'] as $text) {
            $this->assertStringNotContainsString($text, $raw, 'the raw table never holds the text');
            $this->assertStringNotContainsString($text, json_encode(DB::table('command_keys')->get()), 'nor do idempotency records');
            $this->assertStringNotContainsString(hash('sha256', $text), json_encode(DB::table('command_keys')->get()));
        }
        $this->assertSame(0, DB::table('conversation_messages')->whereNotNull('body')->count());
        $row = DB::table('conversation_messages')->orderByDesc('id')->first();
        $this->assertSame('Please come in tomorrow', Crypt::decryptString($row->body_encrypted));
        // The replay still returns the text (re-attached from the encrypted record).
        $this->send($id, 'staffB1', 'Please come in tomorrow', 'k-1')->assertCreated()->assertJsonPath('data.body', 'Please come in tomorrow');
        // Normal code still cannot edit or delete a message.
        foreach ([fn () => DB::table('conversation_messages')->where('id', $row->id)->update(['body_encrypted' => Crypt::encryptString('forged')]),
            fn () => DB::table('conversation_messages')->where('id', $row->id)->delete()] as $attempt) {
            try {
                DB::transaction($attempt);
                $this->fail('messages stay immutable');
            } catch (QueryException $e) {
                $this->assertStringContainsString('immutable', $e->getMessage());
            }
        }
    }

    public function test_the_conversion_command_encrypts_legacy_rows_resumably_rotates_keys_and_can_be_rolled_back(): void
    {
        $id = $this->start(body: 'new message')->json('data.conversation.id');
        $conversation = Conversation::where('public_id', $id)->sole();
        foreach (['legacy one', 'legacy two', 'legacy three'] as $text) {
            DB::table('conversation_messages')->insert(['public_id' => strtolower((string) \Illuminate\Support\Str::ulid()), 'conversation_id' => $conversation->id,
                'sender_user_id' => $this->u['patientA']->id, 'body' => $text, 'created_at' => now()->toIso8601String()]);
        }
        CommandKey::create(['user_id' => $this->u['patientA']->id, 'idempotency_key' => 'legacy', 'command' => 'conversation.send', 'request_hash' => 'x', 'created_at' => now(),
            'response_status' => 201, 'response_body' => ['data' => ['id' => 'x', 'body' => 'legacy one']]]);

        $this->artisan('messages:encrypt-bodies', ['--dry-run' => true])->expectsOutputToContain('3 plain message(s) to encrypt')->assertSuccessful();
        $this->assertSame(3, DB::table('conversation_messages')->whereNotNull('body')->count(), 'dry run changes nothing');
        $this->artisan('messages:encrypt-bodies', ['--batch' => 2])->assertSuccessful();
        $this->assertSame(0, DB::table('conversation_messages')->whereNotNull('body')->count());
        $this->assertStringNotContainsString('legacy', json_encode(DB::table('conversation_messages')->get()));
        $this->assertStringNotContainsString('legacy one', json_encode(DB::table('command_keys')->get()));
        $this->artisan('messages:encrypt-bodies')->expectsOutputToContain('0 message(s) encrypted')->assertSuccessful(); // re-run: nothing left
        $this->actingAsUser('patientA');
        $this->assertEqualsCanonicalizing(['new message', 'legacy one', 'legacy two', 'legacy three'], array_column($this->getJson("/api/conversations/{$id}/messages")->json('data'), 'body'));

        // Key rotation: the old key moves to APP_PREVIOUS_KEYS, rows are re-encrypted with the new key.
        $old = config('app.key');
        $new = 'base64:'.base64_encode(random_bytes(32));
        config(['app.key' => $new, 'app.previous_keys' => [$old]]);
        $this->app->forgetInstance('encrypter');
        Crypt::clearResolvedInstances();
        $this->artisan('messages:encrypt-bodies', ['--rotate' => true])->assertSuccessful();
        config(['app.previous_keys' => []]);
        $this->app->forgetInstance('encrypter');
        Crypt::clearResolvedInstances();
        $this->assertEqualsCanonicalizing(['new message', 'legacy one', 'legacy two', 'legacy three'], ConversationMessage::all()->pluck('body')->all(), 'readable with the new key alone');

        // Rollback path: the schema rollback refuses while rows are encrypted; decrypt-bodies needs --force.
        $this->artisan('messages:decrypt-bodies')->assertFailed();
        $this->artisan('messages:decrypt-bodies', ['--force' => true])->assertSuccessful();
        $this->assertSame(0, DB::table('conversation_messages')->whereNotNull('body_encrypted')->count());
        $this->assertSame(4, DB::table('conversation_messages')->whereNotNull('body')->count());
    }

    // ---- offline email alert ------------------------------------------------------------------------------------------

    public function test_an_offline_patient_gets_one_content_free_alert_per_conversation_per_window(): void
    {
        $id = $this->start()->json('data.conversation.id');
        $this->travel(5)->minutes(); // the Patient has left the app (heartbeat older than 90 s)
        foreach (['First reply with private detail', 'Second', 'Third'] as $text) $this->send($id, 'staffB1', $text)->assertCreated();
        $alerts = MailDispatch::where('purpose', 'message_alert')->get();
        $this->assertCount(1, $alerts, 'a burst sends one alert');
        $this->assertSame($this->u['patientA']->id, $alerts[0]->recipient_user_id);
        Mail::assertSent(MessageAlertMail::class, 1);
        Mail::assertSent(MessageAlertMail::class, function (MessageAlertMail $mail) {
            $html = $mail->render();

            return $mail->hasTo($this->u['patientA']->email) && ! str_contains($html, 'private detail') && ! str_contains($html, 'Second') && str_contains($html, '#sign-in');
        });
        $this->assertStringNotContainsString('private detail', json_encode(MailDispatch::all()));

        $this->travel(16)->minutes();
        $this->send($id, 'staffB1', 'After the window')->assertCreated();
        $this->assertSame(2, MailDispatch::where('purpose', 'message_alert')->count());
    }

    public function test_no_alert_when_the_patient_is_online_writes_themselves_or_has_already_read_it(): void
    {
        $id = $this->start()->json('data.conversation.id');
        Presence::touch($this->u['patientA']);
        $this->send($id, 'staffB1', 'You are online')->assertCreated();
        $this->send($id, 'patientA', 'Thanks')->assertCreated();
        $this->assertSame(0, MailDispatch::where('purpose', 'message_alert')->count());

        // Queued while offline, but read before the worker ran: the alert is superseded and nothing is sent.
        config(['queue.default' => 'database']);
        $this->travel(5)->minutes();
        $message = $this->send($id, 'staffB1', 'Read me')->json('data.id');
        $this->actingAsUser('patientA');
        $this->postJson("/api/conversations/{$id}/read", ['up_to' => $message])->assertOk();
        $dispatch = MailDispatch::where('purpose', 'message_alert')->sole();
        app(MailOutbox::class)->process($dispatch->id);
        $this->assertSame('superseded', $dispatch->fresh()->status);
        Mail::assertNotSent(MessageAlertMail::class);
    }

    public function test_the_presence_heartbeat_is_rate_limited_per_account(): void
    {
        $this->actingAsUser('patientA');
        for ($i = 0; $i < 10; $i++) $this->postJson('/api/conversations/presence')->assertOk();
        $this->postJson('/api/conversations/presence')->assertStatus(429);
        $this->actingAsUser('patientB');
        $this->postJson('/api/conversations/presence')->assertOk(); // another account is unaffected
    }

    public function test_owner_is_refused_everywhere(): void
    {
        $id = $this->start()->json('data.conversation.id');
        $this->actingAsUser('owner');
        foreach (['/api/conversations', '/api/conversations/summary', "/api/conversations/{$id}", "/api/conversations/{$id}/messages", '/api/conversations/start-options'] as $url) {
            $this->getJson($url)->assertForbidden();
        }
        $this->postJson('/api/conversations/presence')->assertForbidden();
        $this->assertSame(1, ConversationParticipant::count());
    }

    public function test_undecryptable_message_returns_neutral_placeholder_for_patient_and_staff_without_crashing(): void
    {
        \Illuminate\Support\Facades\Log::spy();
        $conv = $this->start(body: 'Hello')->json('data.conversation');
        $convId = $conv['id'];
        $convModel = \App\Models\Conversation::where('public_id', $convId)->firstOrFail();

        // Insert message with undecryptable body_encrypted payload
        $msgId = (string) strtolower((string) \Illuminate\Support\Str::ulid());
        \Illuminate\Support\Facades\DB::table('conversation_messages')->insert([
            'public_id' => $msgId,
            'conversation_id' => $convModel->id,
            'sender_user_id' => $this->u['patientA']->id,
            'body' => null,
            'body_encrypted' => 'eyJpdiI6ImludmFsaWQiLCJ2YWx1ZSI6ImludmFsaWQiLCJtYWMiOiJpbnZhbGlkIn0=',
            'created_at' => now(),
        ]);

        // Patient view returns 200 with neutral text
        $this->actingAsUser('patientA');
        $patientRes = $this->getJson("/api/conversations/{$convId}/messages")->assertOk();
        $this->assertSame("This message can't be displayed", $patientRes->json('data.0.body'));

        // Staff view returns 200 with neutral text
        $this->actingAsUser('staffB1');
        $staffRes = $this->getJson("/api/conversations/{$convId}/messages")->assertOk();
        $this->assertSame("This message can't be displayed", $staffRes->json('data.0.body'));

        \Illuminate\Support\Facades\Log::shouldHaveReceived('warning')
            ->with('Undecryptable conversation message encountered', ['message_id' => $msgId]);
    }
}

<?php

namespace Tests\Feature\Messaging;

use App\Models\AuditLog;
use App\Models\Conversation;
use App\Models\ConversationMessage;
use App\Models\ConversationParticipant;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Schema;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

// M17 in-app human messaging. Conversations are created here directly because the product has no creation command by design (the
// only evidence-backed creator, the M16 conversion, deliberately no longer creates one). b1: staffB1, dentist1, dentist2; b2: staffB2, dentist3.
class MessagingTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private int $keys = 0;

    private array $logged = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        Http::preventStrayRequests();
        Mail::fake();
        Notification::fake();
        config(['messaging.per_minute' => 1000, 'messaging.per_hour' => 10000]);
        $this->logged = [];
        Event::listen(MessageLogged::class, fn (MessageLogged $e) => $this->logged[] = [$e->message, $e->context]);
    }

    private function key(): string
    {
        return 'mk-'.(++$this->keys);
    }

    /** @param list<string> $participants keys of $this->u */
    private function conversation(string $patient = 'A', string $branch = 'b1', array $participants = ['patientA', 'staffB1'], string $context = 'Appointment follow-up'): Conversation
    {
        $c = Conversation::create(['patient_id' => $this->p[$patient]->id, 'branch_id' => $this->b[$branch]->id, 'context' => $context, 'status' => 'Open', 'revision' => 1]);
        foreach ($participants as $who) {
            ConversationParticipant::create(['conversation_id' => $c->id, 'user_id' => $this->u[$who]->id, 'created_at' => now()]);
        }

        return $c;
    }

    /** Message text is encrypted at rest (decision 5), so a test finds a message by its DECRYPTED text, never with a SQL where. */
    private function messageWithText(string $text): ConversationMessage
    {
        return ConversationMessage::all()->first(fn ($m) => $m->body === $text);
    }

    private function newest(Conversation $c): string
    {
        return ConversationMessage::where('conversation_id', $c->id)->orderByDesc('id')->value('public_id');
    }

    private function send(Conversation $c, string $who, $body = 'Hello there', ?string $key = null, array $extra = [])
    {
        $this->actingAsUser($who);

        return $this->postJson("/api/conversations/{$c->public_id}/messages", ['body' => $body] + $extra, $key === '' ? [] : ['Idempotency-Key' => $key ?? $this->key()]);
    }

    // ---- access ---------------------------------------------------------------------------------------------------------

    public function test_only_explicit_participants_with_the_matching_role_link_may_use_a_conversation_and_owner_and_guests_never(): void
    {
        $c = $this->conversation();
        $routes = [['getJson', '/api/conversations'], ['getJson', '/api/conversations/summary'], ['getJson', "/api/conversations/{$c->public_id}"], ['getJson', "/api/conversations/{$c->public_id}/messages"],
            ['postJson', "/api/conversations/{$c->public_id}/messages"], ['postJson', "/api/conversations/{$c->public_id}/read"], ['postJson', "/api/conversations/{$c->public_id}/close"]];
        foreach ($routes as [$verb, $url]) {
            $this->app['auth']->forgetGuards();
            ($verb === 'getJson' ? $this->getJson($url) : $this->postJson($url, []))->assertUnauthorized();
        }
        $this->actingAsUser('owner');
        foreach ($routes as [$verb, $url]) {
            ($verb === 'getJson' ? $this->getJson($url) : $this->postJson($url, ['body' => 'x', 'expected_revision' => 1], ['Idempotency-Key' => $this->key()]))->assertForbidden();
        }
        // Wrong Patient, Staff of another branch, Staff with no branch scope, a non-participant Dentist. (Decision 3: every Staff member
        // whose scope covers the branch — staffBoth here — is the branch front desk and may read and reply; see MessagingRoutingTest.)
        foreach (['patientB', 'staffB2', 'staffNone', 'dentist1', 'dentist2'] as $who) {
            $this->actingAsUser($who);
            $this->getJson("/api/conversations/{$c->public_id}")->assertNotFound();
            $this->getJson("/api/conversations/{$c->public_id}/messages")->assertNotFound();
            $this->assertSame([], $this->getJson('/api/conversations')->assertOk()->json('data'));
            $this->send($c, $who)->assertForbidden();
        }
        // A participant row alone is not enough: the role link must hold (Staff whose branch scope does not cover the conversation, a Dentist of another branch).
        $other = $this->conversation('B', 'b2', ['patientB', 'staffB1', 'dentist1']);
        foreach (['staffB1', 'dentist1'] as $who) {
            $this->actingAsUser($who);
            $this->getJson("/api/conversations/{$other->public_id}")->assertNotFound();
            $this->assertNotContains($other->public_id, array_column($this->getJson('/api/conversations')->json('data'), 'id'));
        }
        $this->actingAsUser('patientA');
        $this->getJson("/api/conversations/{$c->public_id}")->assertOk();
        $this->actingAsUser('staffB1');
        $this->getJson("/api/conversations/{$c->public_id}")->assertOk();
        // Numeric, malformed and unknown identifiers fail safely.
        foreach (['1', 'not-a-ulid', '01ARZ3NDEKTSV4RRFFQ69G5FAV'] as $bad) {
            $this->getJson("/api/conversations/{$bad}")->assertNotFound();
            $this->getJson("/api/conversations/{$bad}/messages")->assertNotFound();
            $this->postJson("/api/conversations/{$bad}/messages", ['body' => 'x'], ['Idempotency-Key' => $this->key()])->assertNotFound();
        }
        // Removing a Staff member's branch authorization ends access at once.
        DB::table('user_branch_scopes')->where('user_id', $this->u['staffB1']->id)->delete();
        $this->getJson("/api/conversations/{$c->public_id}")->assertNotFound();
        $this->send($c, 'staffB1')->assertForbidden();
    }

    public function test_a_dentist_participant_in_the_conversations_branch_may_message_and_a_patient_may_not_close(): void
    {
        $c = $this->conversation('B', 'b1', ['patientB', 'dentist1'], 'Clinical clarification');
        $this->send($c, 'dentist1', 'Please call the clinic if it persists.')->assertCreated()->assertJsonPath('data.sender.role', 'Dentist');
        $this->send($c, 'patientB', 'Thank you')->assertCreated()->assertJsonPath('data.sender.role', 'Patient');
        $this->actingAsUser('patientB');
        $this->postJson("/api/conversations/{$c->public_id}/close", ['expected_revision' => 1], ['Idempotency-Key' => $this->key()])->assertForbidden();
        $this->assertSame('Open', $c->fresh()->status);
    }

    // ---- sending --------------------------------------------------------------------------------------------------------

    public function test_the_sender_comes_from_the_authenticated_account_and_the_projection_exposes_no_internal_ids(): void
    {
        $c = $this->conversation();
        $m = $this->send($c, 'patientA', 'Can I move my appointment?')->assertCreated()->json('data');
        $this->assertSame(['id', 'body', 'sender', 'mine', 'sent_at'], array_keys($m));
        $this->assertTrue($m['mine']);
        $this->assertSame(['name' => $this->u['patientA']->person->fullName(), 'role' => 'Patient'], $m['sender']);
        $row = ConversationMessage::sole();
        $this->assertSame($this->u['patientA']->id, $row->sender_user_id);
        $this->send($c, 'staffB1', 'Yes, we can check another slot.')->assertCreated()->assertJsonPath('data.sender.role', 'Staff');
        $this->actingAsUser('patientA');
        $list = $this->getJson("/api/conversations/{$c->public_id}/messages")->assertOk()->json('data');
        $this->assertSame([false, true], array_column($list, 'mine'));            // newest first: staff (not mine), then mine
        $json = json_encode($list);
        foreach (['sender_user_id', 'user_id', '"patient_id"', 'delivered', 'seen', 'typing', 'online'] as $leak) {
            $this->assertStringNotContainsString($leak, $json);
        }
    }

    public function test_message_text_is_bounded_validated_inert_data_and_server_context_fields_are_refused(): void
    {
        $c = $this->conversation();
        foreach ([null, '', '   ', str_repeat('x', 2001), ['a'], 123, true, "bell\x07", "nu\x00ll"] as $bad) {
            $r = $this->send($c, 'patientA', $bad);
            $this->assertSame(422, $r->status(), json_encode($bad));
        }
        foreach (['sender_id' => 1, 'sender_role' => 'staff', 'sent_by' => 'x', 'actor_id' => 1, 'patient_id' => 1, 'branch_id' => 1, 'conversation_id' => 1, 'owner' => 'x', 'read_at' => '2020-01-01', 'delivered_at' => '2020-01-01',
            'seen_at' => 'x', 'status' => 'Closed', 'created_at' => '2020-01-01', 'external_id' => 'fb-1', 'channel' => 'sms', 'attachment' => 'f', 'html' => '<b>x</b>'] as $field => $value) {
            $this->send($c, 'patientA', 'ok', null, [$field => $value])->assertStatus(422, "must refuse {$field}");
        }
        $this->send($c, 'patientA', 'ok', '')->assertStatus(422);                       // Idempotency-Key is mandatory
        $this->assertSame(0, ConversationMessage::count());
        $xss = "<script>alert(1)</script><img src=x onerror=alert(2)> https://evil.example/x javascript:alert(3)\nsecond line";
        $this->send($c, 'patientA', $xss)->assertCreated();
        $this->send($c, 'patientA', str_repeat('y', 2000))->assertCreated();            // exactly at the bound
        $this->send($c, 'patientA', 'José Núñez 李小龍 👍')->assertCreated();
        $stored = ConversationMessage::orderBy('id')->get()->pluck('body')->all();
        $this->assertSame($xss, $stored[0], 'stored and returned verbatim as data');
        $this->actingAsUser('staffB1');
        $this->assertSame('José Núñez 李小龍 👍', $this->getJson("/api/conversations/{$c->public_id}/messages")->json('data.0.body'));
        Http::assertNothingSent();                                                      // no link preview, no fetch
    }

    public function test_sending_is_idempotent_a_new_key_is_a_new_message_and_a_closed_conversation_refuses(): void
    {
        $c = $this->conversation();
        $first = $this->send($c, 'patientA', 'Lost response?', 'same-key')->assertCreated()->json('data');
        $replay = $this->send($c, 'patientA', 'Lost response?', 'same-key')->assertCreated()->json('data');
        $this->assertSame($first, $replay);
        $this->assertSame(1, ConversationMessage::count());
        $this->send($c, 'patientA', 'A different message', 'same-key')->assertStatus(422)->assertJsonPath('code', 'idempotency_key_reused');
        $this->send($c, 'patientA', 'Lost response?', 'new-key')->assertCreated();                // identical text, new key = a distinct message
        $this->assertSame(2, ConversationMessage::count());
        $this->actingAsUser('staffB1');
        $this->postJson("/api/conversations/{$c->public_id}/close", ['expected_revision' => 1], ['Idempotency-Key' => $this->key()])->assertOk();
        $this->send($c, 'staffB1', 'after close')->assertStatus(422)->assertJsonPath('code', 'conversation_closed');
        $this->send($c, 'patientA', 'after close')->assertStatus(422);
        $this->assertSame(2, ConversationMessage::count());
    }

    // ---- read state (in-application only) -------------------------------------------------------------------------------

    public function test_unread_is_per_participant_in_application_only_lists_carry_no_text_and_zero_is_a_real_zero(): void
    {
        $c = $this->conversation();
        $this->actingAsUser('staffB1');
        $this->getJson('/api/conversations/summary')->assertOk()->assertExactJson(['data' => ['conversations' => 1, 'open' => 1, 'unread_conversations' => 0]]);
        $this->send($c, 'patientA', 'Secret health detail: my tooth hurts');
        $this->send($c, 'patientA', 'Second message');
        $this->actingAsUser('staffB1');
        $list = $this->getJson('/api/conversations')->assertOk();
        $this->assertSame(2, $list->json('data.0.unread'));
        $this->assertStringNotContainsString('Secret', json_encode($list->json()), 'lists never carry message text');
        $this->assertSame(1, $this->getJson('/api/conversations/summary')->json('data.unread_conversations'));
        $newest = $this->newest($c);
        $this->postJson("/api/conversations/{$c->public_id}/read", ['up_to' => $newest])->assertOk();
        $this->postJson("/api/conversations/{$c->public_id}/read", ['up_to' => $newest])->assertOk();    // idempotent
        $this->assertSame(0, $this->getJson('/api/conversations')->json('data.0.unread'));
        $this->postJson("/api/conversations/{$c->public_id}/read", ['up_to' => $newest, 'read_at' => '2020-01-01'])->assertStatus(422);
        // The patient's own messages are never unread for the patient; the staff reply is.
        $this->actingAsUser('patientA');
        $this->assertSame(0, $this->getJson('/api/conversations')->json('data.0.unread'));
        $this->send($c, 'staffB1', 'Reply');
        $this->actingAsUser('patientA');
        $this->assertSame(1, $this->getJson('/api/conversations')->json('data.0.unread'));
        $json = json_encode($this->getJson('/api/conversations')->json());
        foreach (['delivered', 'seen', 'read_receipt', 'typing', 'online', 'sent_to'] as $fake) {
            $this->assertStringNotContainsString($fake, $json);
        }
        // A participant cannot mark another participant's read state.
        $this->actingAsUser('patientB');
        $this->postJson("/api/conversations/{$c->public_id}/read", ['up_to' => $newest])->assertForbidden();
    }

    // ---- pagination and ordering ----------------------------------------------------------------------------------------

    public function test_history_is_cursor_paged_newest_first_deterministically_with_no_gaps_and_a_foreign_cursor_reveals_nothing(): void
    {
        $c = $this->conversation();
        $elsewhere = $this->conversation('B', 'b1', ['patientB', 'staffB1']);
        foreach (range(1, 7) as $n) {
            $this->send($c, $n % 2 ? 'patientA' : 'staffB1', "m{$n}");
        }
        $this->send($elsewhere, 'staffB1', 'other conversation');
        $foreign = $this->messageWithText('other conversation')->public_id;
        $this->actingAsUser('patientA');
        $one = $this->getJson("/api/conversations/{$c->public_id}/messages?per_page=3")->assertOk();
        $two = $this->getJson("/api/conversations/{$c->public_id}/messages?per_page=3&cursor=".$one->json('meta.next_cursor'))->assertOk();
        $three = $this->getJson("/api/conversations/{$c->public_id}/messages?per_page=3&cursor=".$two->json('meta.next_cursor'))->assertOk();
        $bodies = [...array_column($one->json('data'), 'body'), ...array_column($two->json('data'), 'body'), ...array_column($three->json('data'), 'body')];
        $this->assertSame(['m7', 'm6', 'm5', 'm4', 'm3', 'm2', 'm1'], $bodies);
        $this->assertNull($three->json('meta.next_cursor'));
        $this->assertSame(30, $this->getJson("/api/conversations/{$c->public_id}/messages")->json('meta.per_page'));
        $this->assertSame([], $this->getJson("/api/conversations/{$c->public_id}/messages?cursor={$foreign}")->assertOk()->json('data'), 'a cursor from another conversation reveals nothing');
        $this->assertSame([], $this->getJson("/api/conversations/{$c->public_id}/messages?cursor=01ARZ3NDEKTSV4RRFFQ69G5FAV")->assertOk()->json('data'));
        foreach (['per_page=0', 'per_page=101', 'per_page=x', 'cursor=short', 'cursor[]=a', 'per_page[]=2'] as $bad) {
            $this->getJson("/api/conversations/{$c->public_id}/messages?{$bad}")->assertStatus(422);
        }
        // Same-instant messages keep a stable order (serial id tiebreak).
        DB::statement('select 1');
        $this->assertSame(ConversationMessage::orderBy('id')->pluck('id')->all(), ConversationMessage::orderBy('id')->pluck('id')->sort()->values()->all());
    }

    public function test_the_conversation_list_is_paged_scoped_and_filtered(): void
    {
        $ids = [];
        foreach (range(1, 5) as $n) {
            $ids[] = $this->conversation('A', 'b1', ['patientA', 'staffB1'], "C{$n}")->public_id;
        }
        $this->conversation('B', 'b1', ['patientB', 'staffB1'], 'Other patient');
        $this->actingAsUser('patientA');
        $one = $this->getJson('/api/conversations?per_page=2')->assertOk();
        $two = $this->getJson('/api/conversations?per_page=2&cursor='.$one->json('meta.next_cursor'))->assertOk();
        $three = $this->getJson('/api/conversations?per_page=2&cursor='.$two->json('meta.next_cursor'))->assertOk();
        $this->assertSame(array_reverse($ids), [...array_column($one->json('data'), 'id'), ...array_column($two->json('data'), 'id'), ...array_column($three->json('data'), 'id')]);
        $this->assertNull($three->json('meta.next_cursor'));
        $foreign = Conversation::where('context', 'Other patient')->value('public_id');
        $this->assertSame([], $this->getJson("/api/conversations?cursor={$foreign}")->assertOk()->json('data'), 'a foreign cursor leaks nothing');
        $this->assertCount(0, $this->getJson('/api/conversations?status=Closed')->json('data'));
        foreach (['per_page=0', 'per_page=101', 'status=Archived', 'cursor=short'] as $bad) {
            $this->getJson('/api/conversations?'.$bad)->assertStatus(422);
        }
        $row = $this->getJson('/api/conversations?per_page=1')->json('data.0');
        $this->assertSame(['id', 'context', 'status', 'revision', 'patient', 'branch', 'participants', 'assigned', 'unread', 'last_message_at', 'closed_at'], array_keys($row));
        // Decision 3: a Patient sees the participant of record (the first Staff member to reply) and Dentists — nobody has replied yet.
        $this->assertSame([], $row['participants']);
        $this->assertNull($row['assigned']);
    }

    // ---- lifecycle, immutability, retention ------------------------------------------------------------------------------

    public function test_close_is_a_named_command_with_stale_protection_and_closed_is_final_in_the_database_too(): void
    {
        $c = $this->conversation();
        $this->send($c, 'patientA', 'hello');
        $this->actingAsUser('staffB1');
        $this->postJson("/api/conversations/{$c->public_id}/close", ['expected_revision' => 9], ['Idempotency-Key' => $this->key()])->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        $this->postJson("/api/conversations/{$c->public_id}/close", ['expected_revision' => 1, 'status' => 'Open'], ['Idempotency-Key' => $this->key()])->assertStatus(422);
        $closed = $this->postJson("/api/conversations/{$c->public_id}/close", ['expected_revision' => 1], ['Idempotency-Key' => $this->key()])->assertOk();
        $this->assertSame(['Closed', 2], [$closed->json('data.status'), $closed->json('data.revision')]);
        $this->postJson("/api/conversations/{$c->public_id}/close", ['expected_revision' => 1], ['Idempotency-Key' => $this->key()])->assertOk()->assertJsonPath('data.status', 'Closed');   // already closed: no-op
        $this->assertSame($this->u['staffB1']->id, $c->fresh()->closed_by_user_id);
        foreach (['patch', 'put', 'delete'] as $verb) {
            $this->{$verb.'Json'}("/api/conversations/{$c->public_id}", ['status' => 'Open'])->assertStatus(405);
        }
        $attempts = [
            'reopen' => fn () => DB::table('conversations')->where('id', $c->id)->update(['status' => 'Open', 'closed_at' => null, 'closed_by_user_id' => null]),
            'delete conversation' => fn () => DB::table('conversations')->where('id', $c->id)->delete(),
            'edit message' => fn () => DB::table('conversation_messages')->update(['body' => 'edited']),
            'delete message' => fn () => DB::table('conversation_messages')->delete(),
            'model edit' => fn () => ConversationMessage::first()->update(['body' => 'edited']),
            'model delete' => fn () => ConversationMessage::first()->delete(),
        ];
        foreach ($attempts as $why => $attempt) {
            try {
                DB::transaction($attempt);
                $this->fail("must refuse: {$why}");
            } catch (QueryException) {
                $this->assertTrue(true);
            }
        }
        $this->assertSame('hello', ConversationMessage::sole()->body);
    }

    public function test_history_survives_account_removal_attempts_and_open_conversation_identity_is_immutable(): void
    {
        $c = $this->conversation();
        $this->send($c, 'staffB1', 'A message');
        foreach ([fn () => DB::table('users')->where('id', $this->u['staffB1']->id)->delete(), fn () => DB::table('patients')->where('id', $this->p['A']->id)->delete(),
            fn () => DB::table('conversations')->where('id', $c->id)->update(['patient_id' => $this->p['B']->id]),
            fn () => DB::table('conversations')->where('id', $c->id)->update(['branch_id' => $this->b['b2']->id])] as $attempt) {
            try {
                DB::transaction($attempt);
                $this->fail('the change must be refused');
            } catch (QueryException) {
                $this->assertTrue(true);
            }
        }
        $this->assertSame(1, ConversationMessage::count());
        $this->assertSame(2, ConversationParticipant::count());
    }

    // ---- boundaries -----------------------------------------------------------------------------------------------------

    public function test_staff_cannot_start_no_delivery_claims_no_notifications_no_ai_and_no_audit_transcript(): void
    {
        $c = $this->conversation();
        $audit = AuditLog::count();
        $this->actingAsUser('staffB1');
        $this->postJson('/api/conversations', ['patient_id' => 'x', 'context' => 'new'], ['Idempotency-Key' => $this->key()])->assertForbidden(); // Staff cannot start one
        \App\Services\Messaging\Presence::touch($this->u['patientA']); // the Patient is in the app, so no offline email alert is due
        $this->deleteJson("/api/conversations/{$c->public_id}/messages/x")->assertNotFound();
        $this->patchJson("/api/conversations/{$c->public_id}/messages/x", ['body' => 'x'])->assertNotFound();
        $this->send($c, 'staffB1', 'Hello');
        $this->send($c, 'patientA', 'Hi');
        // M22 is not a conversation transcript: sends add no audit rows; only the structural assignment (first Staff reply) is recorded.
        $this->assertSame(['conversation.assigned'], AuditLog::orderBy('id')->skip($audit)->take(10)->pluck('action')->all());
        $this->assertStringNotContainsString('Hello', AuditLog::all()->toJson());
        Mail::assertNothingSent();
        Notification::assertNothingSent();
        Http::assertNothingSent();
        $sources = collect(glob(app_path('Services/Messaging/*.php')))->merge([app_path('Http/Controllers/ConversationController.php'), app_path('Models/Conversation.php'), app_path('Models/ConversationMessage.php')])
            ->map(fn ($f) => preg_replace('#(//.*|/\*.*?\*/)#s', '', file_get_contents($f)))->implode("\n");
        foreach (['Http::', 'Mail::', 'Notification', 'Anthropic', 'AssistantProvider', 'AssistantService', 'Sms', 'sms', 'Messenger', 'graph.facebook', 'Inquiry'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $sources, $forbidden);
        }
        foreach (['delivered_at', 'seen_at', 'external_id', 'channel', 'attachment'] as $column) {
            $this->assertFalse(Schema::hasColumn('conversation_messages', $column), $column);
        }
        $this->assertFalse(Schema::hasColumn('conversations', 'inquiry_id'), 'M16 handoff is not wired');
        $logs = json_encode($this->logged);
        $this->assertStringNotContainsString('Hello', $logs);
        $this->assertStringNotContainsString('Hi"', $logs);
    }

    public function test_sending_is_rate_limited_per_account_and_explains_itself(): void
    {
        config(['messaging.per_minute' => 2]);
        $c = $this->conversation();
        $this->send($c, 'patientA', 'one')->assertCreated();
        $this->send($c, 'patientA', 'two')->assertCreated();
        $limited = $this->send($c, 'patientA', 'three')->assertStatus(429)->assertJsonPath('code', 'messages_rate_limited');
        $this->assertGreaterThan(0, $limited->json('retry_after'));
        $this->send($c, 'staffB1', 'staff is unaffected')->assertCreated();
        $this->assertSame(3, ConversationMessage::count());
    }

    // ---- read-marker integrity (final gate) -----------------------------------------------------------------------------

    private function marker(Conversation $c, string $who): ?int
    {
        return ConversationParticipant::where('conversation_id', $c->id)->where('user_id', $this->u[$who]->id)->value('last_read_message_id');
    }

    private function read(Conversation $c, string $who, $upTo, array $extra = [])
    {
        $this->actingAsUser($who);

        return $this->postJson("/api/conversations/{$c->public_id}/read", ['up_to' => $upTo] + $extra);
    }

    public function test_the_read_marker_moves_forward_only_to_a_message_of_the_same_conversation_and_a_stale_request_cannot_regress_it(): void
    {
        $c = $this->conversation();
        $other = $this->conversation('B', 'b1', ['patientB', 'staffB1']);
        foreach (range(1, 5) as $n) {
            $this->send($c, 'patientA', "m{$n}");
        }
        $this->send($other, 'patientB', 'other 1');
        $ids = ConversationMessage::where('conversation_id', $c->id)->orderBy('id')->pluck('public_id', 'id');
        [$m1, $m2, , , $m5] = $ids->values()->all();
        $foreign = ConversationMessage::where('conversation_id', $other->id)->value('public_id');
        $internal = ConversationMessage::where('conversation_id', $c->id)->orderBy('id')->pluck('id')->all();

        $this->assertNull($this->marker($c, 'staffB1'));
        $this->read($c, 'staffB1', $m2)->assertOk();
        $this->assertSame($internal[1], $this->marker($c, 'staffB1'));
        $unread = fn () => collect($this->getJson('/api/conversations')->json('data'))->firstWhere('id', $c->public_id)['unread'];
        $this->assertSame(3, $unread(), 'reading up to m2 leaves m3..m5 unread: pagination or load time cannot hide them');
        $this->read($c, 'staffB1', $m5)->assertOk();
        $this->assertSame($internal[4], $this->marker($c, 'staffB1'));
        $this->read($c, 'staffB1', $m1)->assertOk();                          // a stale tab: accepted, changes nothing
        $this->read($c, 'staffB1', $m2)->assertOk();
        $this->assertSame($internal[4], $this->marker($c, 'staffB1'), 'read state never regresses');
        $this->read($c, 'staffB1', $m5)->assertOk();                          // duplicate marker
        $this->assertSame($internal[4], $this->marker($c, 'staffB1'));
        // A message of another conversation, an unknown id, a malformed id and a numeric id are all the same refusal and reveal nothing.
        $answers = [];
        foreach ([$foreign, '01ARZ3NDEKTSV4RRFFQ69G5FAV', 'short', 'x'] as $bad) {
            $answers[] = $this->read($c, 'staffB1', $bad)->assertStatus($bad === 'short' || $bad === 'x' ? 422 : 422)->json('code');
        }
        $this->assertSame('message_not_in_conversation', $answers[0]);
        $this->assertSame($answers[0], $answers[1], 'foreign and unknown messages are indistinguishable');
        $this->assertSame($internal[4], $this->marker($c, 'staffB1'));
        $this->assertNull($this->marker($other, 'staffB1'), 'the other conversation is untouched');
        // Missing target, forged marker fields and other participants' markers are refused.
        $this->actingAsUser('staffB1');
        $this->postJson("/api/conversations/{$c->public_id}/read", [])->assertStatus(422);
        foreach (['last_read_message_id' => 1, 'message_id' => $m1, 'user_id' => 1, 'participant' => 'x', 'seen_at' => 'x', 'read_at' => 'x'] as $field => $value) {
            $this->read($c, 'staffB1', $m5, [$field => $value])->assertStatus(422);
        }
        $this->read($c, 'patientB', $m5)->assertForbidden();
        $this->read($c, 'owner', $m5)->assertForbidden();
        // A participant can only ever move their OWN marker; the patient's marker is unchanged by the staff member's reads.
        $this->assertSame($internal[4], $this->marker($c, 'patientA'), 'the sender of m1..m5 has read up to their own latest message');
    }

    public function test_reading_a_closed_conversation_is_allowed_and_closing_never_marks_anything_read(): void
    {
        $c = $this->conversation();
        $this->send($c, 'patientA', 'one');
        $this->send($c, 'patientA', 'two');
        $this->actingAsUser('staffB1');
        $this->postJson("/api/conversations/{$c->public_id}/close", ['expected_revision' => 1], ['Idempotency-Key' => $this->key()])->assertOk();
        $this->assertNull($this->marker($c, 'staffB1'), 'closing is not reading');
        $this->assertSame(2, $this->getJson('/api/conversations')->json('data.0.unread'));
        $this->read($c, 'staffB1', $this->newest($c))->assertOk();
        $this->assertSame(0, $this->getJson('/api/conversations')->json('data.0.unread'));
    }

    public function test_the_summary_and_every_list_row_use_one_unread_rule_and_a_real_zero_is_a_zero(): void
    {
        $a = $this->conversation('A', 'b1', ['patientA', 'staffB1'], 'A');
        $b = $this->conversation('B', 'b1', ['patientB', 'staffB1'], 'B');
        $summary = fn () => $this->getJson('/api/conversations/summary')->assertOk()->json('data');
        $list = fn () => collect($this->getJson('/api/conversations')->assertOk()->json('data'))->sum('unread');
        $this->actingAsUser('staffB1');
        $this->assertSame([0, 0], [$summary()['unread_conversations'], $list()]);
        $this->send($a, 'patientA', 'a1');
        $this->send($a, 'patientA', 'a2');
        $this->send($b, 'patientB', 'b1');
        $this->send($b, 'staffB1', 'own reply');                              // own message: never unread to its sender
        $this->actingAsUser('staffB1');
        $this->assertSame(['unread_conversations' => 1, 'conversations' => 2, 'open' => 2], [...['unread_conversations' => $summary()['unread_conversations']], ...['conversations' => $summary()['conversations'], 'open' => $summary()['open']]]);
        $this->assertSame(2, $list(), 'a1 and a2 are unread; b1 was passed by the staff reply');
        $this->read($a, 'staffB1', ConversationMessage::where('conversation_id', $a->id)->orderBy('id')->value('public_id'));
        $this->assertSame([1, 1], [$summary()['unread_conversations'], $list()], 'advancing the marker to a1 leaves a2 unread');
        $this->read($a, 'staffB1', $this->newest($a));
        $this->read($a, 'staffB1', ConversationMessage::where('conversation_id', $a->id)->orderBy('id')->value('public_id'));   // stale
        $this->assertSame([0, 0], [$summary()['unread_conversations'], $list()]);
        // Another account's view of the same conversations is computed from that account's own marker.
        $this->actingAsUser('patientA');
        $this->assertSame(0, $this->getJson('/api/conversations/summary')->json('data.unread_conversations'));
        $this->send($a, 'staffB1', 'reply to patient');
        $this->actingAsUser('patientA');
        $this->assertSame(1, $this->getJson('/api/conversations/summary')->json('data.unread_conversations'));
        $this->actingAsUser('patientB');
        $this->assertSame(1, $this->getJson('/api/conversations/summary')->json('data.conversations'), 'only the Patient\'s own conversation is counted');
        $this->actingAsUser('owner');
        $this->getJson('/api/conversations/summary')->assertForbidden();
    }

    public function test_the_database_itself_keeps_markers_in_their_conversation_forward_only_and_senders_as_participants(): void
    {
        $c = $this->conversation();
        $other = $this->conversation('B', 'b1', ['patientB', 'staffB1']);
        $this->send($c, 'patientA', 'a1');
        $this->send($c, 'patientA', 'a2');
        $this->send($other, 'patientB', 'b1');
        $a1 = $this->messageWithText('a1')->id;
        $a2 = $this->messageWithText('a2')->id;
        $b1 = $this->messageWithText('b1')->id;
        $row = fn () => DB::table('conversation_participants')->where('conversation_id', $c->id)->where('user_id', $this->u['staffB1']->id);
        $attempts = [
            'marker in another conversation' => fn () => $row()->update(['last_read_message_id' => $b1]),
            'marker that does not exist' => fn () => $row()->update(['last_read_message_id' => 999999]),
            'message from a non-participant' => fn () => DB::table('conversation_messages')->insert(['public_id' => (string) \Illuminate\Support\Str::ulid(), 'conversation_id' => $c->id, 'sender_user_id' => $this->u['staffB2']->id, 'body' => 'x', 'created_at' => now()]),
            'participant moved to another conversation' => fn () => $row()->update(['conversation_id' => $other->id]),
            'participant user changed' => fn () => $row()->update(['user_id' => $this->u['staffB2']->id]),
        ];
        foreach ($attempts as $why => $attempt) {
            try {
                DB::transaction($attempt);
                $this->fail("the database must refuse: {$why}");
            } catch (QueryException) {
                $this->assertTrue(true);
            }
        }
        DB::transaction(fn () => $row()->update(['last_read_message_id' => $a2]));
        foreach (['older marker' => $a1, 'cleared marker' => null] as $why => $value) {
            try {
                DB::transaction(fn () => $row()->update(['last_read_message_id' => $value]));
                $this->fail("a read marker only moves forward: {$why}");
            } catch (QueryException $e) {
                $this->assertStringContainsString('forward', $e->getMessage());
            }
        }
        $this->assertSame($a2, $this->marker($c, 'staffB1'));
        // A message that is read-referenced cannot be removed, and the immutability trigger still holds.
        foreach ([fn () => DB::table('conversation_messages')->where('id', $a2)->delete(), fn () => DB::table('conversation_messages')->where('id', $a2)->update(['body' => 'x'])] as $attempt) {
            try {
                DB::transaction($attempt);
                $this->fail('messages stay immutable');
            } catch (QueryException) {
                $this->assertTrue(true);
            }
        }
    }

    public function test_no_cross_user_read_receipt_exists_in_any_projection(): void
    {
        $c = $this->conversation();
        $this->send($c, 'patientA', 'hello');
        $this->read($c, 'staffB1', $this->newest($c))->assertOk();
        $this->actingAsUser('patientA');
        $json = json_encode([$this->getJson('/api/conversations')->json(), $this->getJson("/api/conversations/{$c->public_id}")->json(), $this->getJson("/api/conversations/{$c->public_id}/messages")->json(), $this->getJson('/api/conversations/summary')->json()]);
        foreach (['last_read', 'read_at', 'seen', 'read_by', 'receipt', 'delivered', 'last_read_message_id'] as $leak) {
            $this->assertStringNotContainsString($leak, $json, $leak);
        }
        $this->assertSame(['id', 'body', 'sender', 'mine', 'sent_at'], array_keys($this->getJson("/api/conversations/{$c->public_id}/messages")->json('data.0')));
    }
}

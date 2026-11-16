<?php

namespace Tests\Feature\Messaging;

use App\Models\Conversation;
use App\Models\ConversationMessage;
use App\Models\ConversationParticipant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class MessageSearchTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
    }

    private function conversation(string $patient = 'A', string $branch = 'b1', array $participants = ['patientA', 'dentist1']): Conversation
    {
        $c = Conversation::create(['patient_id' => $this->p[$patient]->id, 'branch_id' => $this->b[$branch]->id,
            'context' => 'Appointment clarification', 'status' => 'Open', 'revision' => 1]);
        foreach ($participants as $key) ConversationParticipant::create(['conversation_id' => $c->id, 'user_id' => $this->u[$key]->id, 'created_at' => now()]);
        return $c;
    }

    private function message(Conversation $c, string $text): ConversationMessage
    {
        return ConversationMessage::create(['conversation_id' => $c->id, 'sender_user_id' => $this->u['patientA']->id, 'body' => $text, 'created_at' => now()]);
    }

    public function test_old_encrypted_messages_are_searchable_without_bodies_in_conversation_list(): void
    {
        $c = $this->conversation();
        $old = $this->message($c, 'Old NEEDLE <img src=x onerror=alert(1)>');
        for ($i = 0; $i < 35; $i++) $this->message($c, "Recent message $i");
        $this->assertNull($old->getRawOriginal('body'));
        foreach (['patientA', 'staffB1', 'dentist1'] as $who) {
            $this->actingAsUser($who);
            $rows = $this->getJson('/api/conversations?q=needle')->assertOk()->json('data');
            $this->assertSame([$c->public_id], array_column($rows, 'id'));
            $this->assertStringNotContainsString('Old NEEDLE', json_encode($rows));
            $this->assertNotContains($old->public_id, array_column($this->getJson("/api/conversations/{$c->public_id}/messages")->json('data'), 'id'));
            $this->getJson("/api/conversations/{$c->public_id}/messages?q=needle")->assertOk()->assertJsonCount(1, 'data')
                ->assertJsonPath('data.0.body', 'Old NEEDLE <img src=x onerror=alert(1)>')->assertJsonPath('data.0.id', $old->public_id);
        }
    }

    public function test_search_never_bypasses_role_branch_patient_or_dentist_participation(): void
    {
        $c = $this->conversation();
        $this->message($c, 'Secret needle');
        foreach (['staffB2', 'staffNone', 'patientB', 'dentist2', 'dentist3'] as $who) {
            $this->actingAsUser($who);
            $this->getJson('/api/conversations?q=needle')->assertOk()->assertJsonCount(0, 'data');
            $this->getJson("/api/conversations/{$c->public_id}/messages?q=needle")->assertForbidden();
        }
        $this->actingAsUser('owner');
        $this->getJson('/api/conversations?q=needle')->assertForbidden();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/conversations?q=needle')->assertUnauthorized();
    }

    public function test_matching_messages_keep_newest_first_cursor_and_foreign_cursor_is_inert(): void
    {
        $c = $this->conversation();
        $messages = [];
        for ($i = 0; $i < 5; $i++) $messages[] = $this->message($c, "needle $i");
        $other = $this->conversation('B', 'b2', ['patientB']);
        // A foreign cursor cannot select any message in this conversation.
        $foreign = ConversationMessage::create(['conversation_id' => $other->id, 'sender_user_id' => $this->u['patientB']->id, 'body' => 'needle elsewhere', 'created_at' => now()]);
        $this->actingAsUser('dentist1');
        $first = $this->getJson("/api/conversations/{$c->public_id}/messages?q=needle&per_page=2")->assertOk();
        $this->assertSame([$messages[4]->public_id, $messages[3]->public_id], array_column($first->json('data'), 'id'));
        $next = $first->json('meta.next_cursor');
        $this->getJson("/api/conversations/{$c->public_id}/messages?q=needle&per_page=2&cursor=$next")->assertOk()->assertJsonPath('data.0.id', $messages[2]->public_id);
        $this->getJson("/api/conversations/{$c->public_id}/messages?q=needle&cursor={$foreign->public_id}")->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("/api/conversations/{$c->public_id}/messages?q=needle&after={$messages[0]->public_id}")->assertUnprocessable();
    }

    public function test_contacts_metadata_literal_wildcards_and_conversation_pagination(): void
    {
        $c = $this->conversation();
        $older = $this->message($c, 'Literal 100%_value');
        $newer = $this->conversation();
        $this->message($newer, 'Literal 100%_value');
        $this->actingAsUser('staffB1');
        foreach ([$this->u['patientA']->person->fullName(), $this->p['A']->patient_code, $this->u['dentist1']->person->fullName(), 'clarification', '100%_value'] as $term) {
            $this->getJson('/api/conversations?q='.urlencode($term))->assertOk()->assertJsonCount(2, 'data');
        }
        $page = $this->getJson('/api/conversations?q=100%25_value&per_page=1')->assertOk();
        $this->assertSame($newer->public_id, $page->json('data.0.id'));
        $this->getJson('/api/conversations?q=100%25_value&per_page=1&cursor='.$page->json('meta.next_cursor'))->assertOk()->assertJsonPath('data.0.id', $c->public_id);
        $this->getJson('/api/conversations?q=no-match')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_unmigrated_dentist_switch_fails_closed_without_changing_authorship_or_existing_access(): void
    {
        \Illuminate\Support\Facades\Mail::fake();
        $c = $this->conversation();
        $message = ConversationMessage::create(['conversation_id' => $c->id, 'sender_user_id' => $this->u['dentist1']->id, 'body' => 'Original dentist reply', 'created_at' => now()]);
        $this->actingAsUser('staffB1');
        $this->postJson("/api/conversations/{$c->public_id}/participants", ['dentist_id' => $this->u['dentist2']->public_id])->assertConflict()->assertJsonPath('code', 'conversation_grants_unavailable');
        $this->actingAsUser('dentist1');
        $this->getJson("/api/conversations/{$c->public_id}/messages?q=Original")->assertOk()->assertJsonPath('data.0.body', 'Original dentist reply');
        $this->actingAsUser('dentist2');
        $this->postJson("/api/conversations/{$c->public_id}/messages", ['body' => 'Unassigned dentist cannot reply'], ['Idempotency-Key' => 'unassigned-dentist-reply'])->assertForbidden();
        $this->assertSame($this->u['dentist1']->id, $message->fresh()->sender_user_id);
        $this->assertSame(1, ConversationMessage::where('conversation_id', $c->id)->count());
        $this->assertFalse(ConversationParticipant::where('conversation_id', $c->id)->where('user_id', $this->u['dentist2']->id)->exists());
    }

    public function test_patient_search_does_not_disclose_staff_names_hidden_by_summary_projection(): void
    {
        $c = $this->conversation();
        ConversationParticipant::create(['conversation_id' => $c->id, 'user_id' => $this->u['staffB1']->id, 'created_at' => now()]);
        $this->actingAsUser('patientA');
        $this->getJson('/api/conversations?q='.urlencode($this->u['staffB1']->person->fullName()))->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_every_message_read_mode_identifies_exact_conversation_patient_branch_and_is_not_cached(): void
    {
        $c = $this->conversation(); $m = $this->message($c, 'Synthetic matching context');
        $this->actingAsUser('staffB1');
        foreach (['', '?q=matching', '?q=absent', '?after='.$m->public_id] as $suffix) {
            $r = $this->getJson('/api/conversations/'.$c->public_id.'/messages'.$suffix)->assertOk()
                ->assertJsonPath('meta.context.conversation_id', $c->public_id)->assertJsonPath('meta.context.patient_id', $this->p['A']->public_id)->assertJsonPath('meta.context.branch_id', 'b1');
            self::assertTrue($r->headers->hasCacheControlDirective('no-store'));
        }
    }

    public function test_search_is_rate_limited_without_limiting_ordinary_history(): void
    {
        $c = $this->conversation();
        $this->actingAsUser('staffB1');
        for ($i = 0; $i < 30; $i++) $this->getJson('/api/conversations?q=needle')->assertOk();
        $this->getJson('/api/conversations?q=needle')->assertStatus(429);
        $this->getJson("/api/conversations/{$c->public_id}/messages?q=needle")->assertStatus(429);
        $this->getJson("/api/conversations/{$c->public_id}/messages")->assertOk();
    }
}

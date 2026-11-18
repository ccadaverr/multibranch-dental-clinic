<?php

namespace Tests\Feature\Assistant;

use App\Http\Controllers\GeminiChatController;
use App\Models\Branch;
use App\Models\Service;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Auth;
use Tests\TestCase;
use Tests\Feature\Appointments\SchedulingFixture;

class GeminiChatTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private const FAKE_KEY = 'test-gemini-api-key-12345';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->actingAsUser('patientA');
        Config::set('assistant.mode', 'auto');
        Config::set('services.gemini.api_key', self::FAKE_KEY);
        Config::set('services.gemini.model', 'gemini-1.5-flash');
        Http::preventStrayRequests();
    }

    public function test_gemini_chat_returns_generated_response(): void
    {
        Http::fake([
            'https://generativelanguage.googleapis.com/*' => Http::response([
                'candidates' => [
                    [
                        'content' => [
                            'parts' => [
                                ['text' => 'Hello! We offer general cleaning, tooth extraction, and orthodontic braces at Dr. Dana E. Roxas Dental Clinic.'],
                            ],
                            'role' => 'model',
                        ],
                        'finishReason' => 'STOP',
                    ],
                ],
            ], 200),
        ]);

        $response = $this->postJson('/api/gemini/chat', [
            'message' => 'What services do you offer?',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.outcome', 'answered')
            ->assertJsonPath('data.mode', 'gemini')
            ->assertJsonPath('data.answer', 'Hello! We offer general cleaning, tooth extraction, and orthodontic braces at Dr. Dana E. Roxas Dental Clinic.');
    }

    public function test_gemini_chat_refuses_medical_diagnosis_with_disclaimer(): void
    {
        $response = $this->postJson('/api/gemini/chat', [
            'message' => 'Do I have a cavity or infection? What antibiotic medicine dosage should I take?',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.outcome', 'refused_medical')
            ->assertJsonPath('data.mode', 'guard');

        $this->assertStringContainsString('Medical Disclaimer', $response->json('data.answer'));
        $this->assertStringContainsString('cannot provide dental or medical diagnosis', $response->json('data.answer'));
    }

    public function test_gemini_chat_screens_emergency_symptoms(): void
    {
        $response = $this->postJson('/api/gemini/chat', [
            'message' => 'I have severe unbearable pain and heavy bleeding that will not stop!',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.outcome', 'emergency')
            ->assertJsonPath('data.mode', 'guard');

        $this->assertStringContainsString('urgent dental condition', $response->json('data.answer'));
        $this->assertStringContainsString('emergency', $response->json('data.answer'));
    }

    public function test_gemini_chat_rate_limit_backoff_and_fallback(): void
    {
        // Simulate Gemini API HTTP 429 Rate Limit
        Http::fake([
            'https://generativelanguage.googleapis.com/*' => Http::response(['error' => 'Resource Exhausted / Rate limit'], 429),
        ]);

        // Seed a clinic knowledge answer
        DB::table('assistant_answers')->insert([
            'public_id' => '01JBKQ1234567890ABCDEFGH11',
            'question' => 'What are your clinic hours?',
            'keywords' => json_encode(['hours', 'open']),
            'category' => 'hours',
            'answer' => 'Our branches are open Monday to Saturday from 9:00 AM to 5:00 PM.',
            'active' => true,
            'draft' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->postJson('/api/gemini/chat', [
            'message' => 'What are your clinic hours?',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.mode', 'knowledge_fallback');

        $this->assertStringContainsString('Our AI assistant is currently experiencing high demand', $response->json('data.answer'));
        $this->assertStringContainsString('Our branches are open Monday to Saturday', $response->json('data.answer'));
    }

    public function test_gemini_chat_missing_api_key_falls_back(): void
    {
        Config::set('services.gemini.api_key', '');

        $response = $this->postJson('/api/gemini/chat', [
            'message' => 'Hello, can you help me?',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.mode', 'knowledge_fallback');

        $this->assertStringContainsString('Dr. Dana E. Roxas Dental Clinic', $response->json('data.answer'));
    }

    public function test_knowledge_fallback_only_returns_active_approved_answers(): void
    {
        Config::set('services.gemini.api_key', '');
        foreach ([[true, true, 'Unapproved fixture'], [false, false, 'Inactive fixture'], [true, false, 'Approved fixture']] as [$active, $draft, $answer]) {
            \App\Models\AssistantAnswer::create(['question' => 'Synthetic verification topic', 'answer' => $answer,
                'keywords' => ['cerulean-check'], 'category' => 'other', 'active' => $active, 'draft' => $draft, 'source' => 'owner']);
        }
        $result = $this->postJson('/api/gemini/chat', ['message' => 'cerulean-check'])->assertOk();
        $this->assertStringContainsString('Approved fixture', $result->json('data.answer'));
        $this->assertStringNotContainsString('Unapproved fixture', $result->getContent());
        $this->assertStringNotContainsString('Inactive fixture', $result->getContent());
    }

    public function test_knowledge_mode_and_stream_share_the_patient_daily_cap(): void
    {
        Config::set('assistant.mode', 'knowledge');
        Config::set('assistant.daily_cap', 1);
        $body = ['message' => 'Synthetic request content'];
        $this->postJson('/api/gemini/chat', $body)->assertOk()->assertJsonPath('data.mode', 'knowledge_fallback');
        $this->postJson('/api/gemini/stream', $body)->assertTooManyRequests()->assertJsonPath('code', 'assistant_daily_cap');
        $this->postJson('/api/assistant/messages', $body)->assertTooManyRequests()->assertJsonPath('code', 'assistant_daily_cap');
        $usage = DB::table('assistant_usage')->where('user_id', $this->u['patientA']->id)->sole();
        $this->assertStringNotContainsString($body['message'], json_encode($usage));
        Http::assertNothingSent();
    }

    public function test_gemini_stream_returns_sse_stream(): void
    {
        Http::fake([
            'https://generativelanguage.googleapis.com/*' => Http::response(
                "data: {\"candidates\": [{\"content\": {\"parts\": [{\"text\": \"Welcome to \"}]}}]}\n\n" .
                "data: {\"candidates\": [{\"content\": {\"parts\": [{\"text\": \"our clinic!\"}]}}]}\n\n",
                200,
                ['Content-Type' => 'text/event-stream']
            ),
        ]);

        $response = $this->post('/api/gemini/stream', [
            'message' => 'Tell me about the clinic',
        ]);

        $response->assertOk();
        $this->assertStringContainsString('text/event-stream', $response->headers->get('Content-Type'));
        $content = $response->streamedContent();
        $this->assertStringContainsString('event: delta', $content);
        $this->assertStringContainsString('event: done', $content);
        $this->assertStringContainsString('our clinic!', $content);
        Http::assertSentCount(1);
    }

    private function loginPersisted(string $key): void
    {
        Auth::forgetGuards();
        $this->postJson('/api/login', ['email' => $this->u[$key]->email, 'password' => 'Passw0rd!'])->assertOk();
        Auth::forgetGuards();
    }

    public function test_real_patient_login_can_use_json_and_sse(): void
    {
        $this->loginPersisted('patientA');
        Http::fake(['*' => Http::response(['candidates' => [['content' => ['parts' => [['text' => 'Welcome!']]]]]])]);
        $this->postJson('/api/gemini/chat', ['message' => 'Hello clinic'])->assertOk()
            ->assertJsonPath('data.answer', 'Welcome!')->assertJsonPath('data.mode', 'gemini');
        Http::assertSentCount(1);
        Auth::forgetGuards();
        Http::swap(new \Illuminate\Http\Client\Factory());
        Http::preventStrayRequests();
        Http::fake(['*' => Http::response('data: '.json_encode(['candidates' => [['content' => ['parts' => [['text' => 'Welcome!']]]]]])."\n\n")]);
        $response = $this->postJson('/api/gemini/stream', ['message' => 'Hello clinic'])->assertOk();
        $this->assertStringContainsString('text/event-stream', $response->headers->get('Content-Type'));
        $content = $response->streamedContent();
        $this->assertStringContainsString('event: delta', $content);
        $this->assertStringContainsString('event: done', $content);
        $this->assertStringContainsString('Welcome!', $content);
        Http::assertSentCount(1);
    }

    public function test_persisted_roles_are_denied_on_both_routes(): void
    {
        Http::fake();
        foreach (['staffB1', 'dentist1', 'owner'] as $key) {
            $this->loginPersisted($key);
            foreach (['chat', 'stream'] as $action) {
                $this->postJson("/api/gemini/$action", ['message' => 'Hello clinic'])->assertForbidden();
                Auth::forgetGuards();
            }
        }
        Http::assertNothingSent();
    }

    public function test_persisted_patient_role_without_profile_is_denied(): void
    {
        Http::fake();
        // Create a Patient-role account with no Patient entity; do not delete patient data.
        $this->u['noProfile'] = $this->account(\App\Enums\Role::Patient, null);
        $this->loginPersisted('noProfile');
        foreach (['chat', 'stream'] as $action) {
            $this->postJson("/api/gemini/$action", ['message' => 'Hello clinic'])->assertForbidden();
            Auth::forgetGuards();
        }
        Http::assertNothingSent();
    }

    public function test_suspension_revokes_persisted_patient_access_on_both_routes(): void
    {
        Http::fake();
        foreach (['chat' => 'patientA', 'stream' => 'patientB'] as $action => $key) {
            $this->loginPersisted($key);
            $this->u[$key]->update(['account_status' => 'Suspended']);
            Auth::forgetGuards();
            $this->postJson("/api/gemini/$action", ['message' => 'Hello clinic'])->assertForbidden()
                ->assertJsonPath('code', 'session_revoked');
            Auth::forgetGuards();
            $this->postJson("/api/gemini/$action", ['message' => 'Hello clinic'])->assertUnauthorized();
        }
        Http::assertNothingSent();
    }

    public function test_restored_account_cannot_reuse_stale_session_on_both_routes(): void
    {
        Http::fake();
        foreach (['chat' => 'patientA', 'stream' => 'patientB'] as $action => $key) {
            $this->loginPersisted($key);
            $oldVersion = (int) $this->u[$key]->auth_version;
            $this->u[$key]->update(['account_status' => 'Suspended']);
            $this->u[$key]->update(['account_status' => 'Active']);
            // Model an old in-flight session write surviving deletion, as in M1 regression coverage.
            $this->withSession(['auth_version' => $oldVersion]);
            $this->postJson("/api/gemini/$action", ['message' => 'Hello clinic'])->assertForbidden()
                ->assertJsonPath('code', 'session_revoked');
        }
        Http::assertNothingSent();
    }

    public function test_gemini_system_prompt_grounded_in_clinic_facts(): void
    {
        $this->b['b2']->update(['status' => 'Closed', 'name' => 'Synthetic closed branch']);
        $this->svc['svc2']->update(['status' => 'Inactive', 'name' => 'Synthetic inactive service']);
        $controller = new GeminiChatController();
        $prompt = $controller->buildSystemPrompt();

        $this->assertStringContainsString('Dr. Dana E. Roxas Dental Clinic', $prompt);
        $this->assertStringContainsString('Full refund if cancelled 24+ hours before', $prompt);
        $this->assertStringContainsString('PayMongo', $prompt);
        $this->assertStringContainsString('NEVER PROVIDE MEDICAL OR DENTAL DIAGNOSES', $prompt);
        $this->assertStringContainsString('Medical Disclaimer', $prompt);
        $this->assertStringNotContainsString('Synthetic closed branch', $prompt);
        $this->assertStringNotContainsString('Synthetic inactive service', $prompt);
    }
}

<?php

namespace Tests\Feature\Assistant;

use App\Enums\Role;
use App\Http\Controllers\GeminiChatController;
use App\Models\Patient;
use App\Models\Person;
use App\Models\User;
use Illuminate\Foundation\Testing\TestCase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Mockery;

/** Real routes/middleware with in-memory identities; no database connection is permitted. */
class GeminiAuthorizationTest extends TestCase
{
    public function createApplication()
    {
        $app = parent::createApplication();
        // Deliberately independent of the database-writing test base and scratch guard.
        // Every configured connection is replaced before any request or fixture runs.
        foreach (array_keys($app['config']->get('database.connections')) as $name) {
            $app['config']->set("database.connections.$name", ['driver' => 'gemini-no-database']);
        }
        $app['db']->extend('gemini-no-database', function () {
            throw new \LogicException('Database access prohibited in Gemini authorization tests.');
        });
        $app['config']->set('session.driver', 'array');
        $app['config']->set('cache.default', 'array');
        // AppServiceProvider already resolved the limiter while bootstrapping. Changing cache.default
        // cannot replace its captured DatabaseStore: that reused account42 quotas across these tests.
        $original = $app->make(\Illuminate\Cache\RateLimiter::class);
        $isolated = new \Illuminate\Cache\RateLimiter($app['cache']->store('array'));
        $isolated->for('m7-assistant', $original->limiter('m7-assistant'));
        $app->instance(\Illuminate\Cache\RateLimiter::class, $isolated);
        \Illuminate\Support\Facades\RateLimiter::clearResolvedInstance(\Illuminate\Cache\RateLimiter::class);
        return $app;
    }

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.gemini.api_key' => 'fake-gemini-test-key', 'services.gemini.model' => 'test-model', 'assistant.rate_per_minute' => 1000,
            'assistant.rate_per_hour' => 10000]);
        Http::preventStrayRequests();
        $this->fake();
        // Public clinic context is independent of authorization, tested in GeminiChatTest.
        $controller = Mockery::mock(GeminiChatController::class)->makePartial();
        $controller->shouldReceive('buildSystemPrompt')->andReturn('Test clinic public information only.');
        $controller->shouldReceive('fallbackAnswer')->andReturn([
            'answer' => 'Please contact the clinic.', 'outcome' => 'fallback_standard', 'mode' => 'knowledge_fallback',
        ]);
        $this->app->instance(GeminiChatController::class, $controller);
    }

    public function test_limiter_uses_the_isolated_array_cache_and_cannot_reuse_database_quota(): void
    {
        $limiter = app(\Illuminate\Cache\RateLimiter::class);
        $cache = (new \ReflectionProperty($limiter, 'cache'))->getValue($limiter);
        $this->assertInstanceOf(\Illuminate\Cache\ArrayStore::class, $cache->getStore());
    }

    private function login(Role $role = Role::Patient, bool $profile = true, string $status = 'Active'): void
    {
        $user = Mockery::mock(User::class)->makePartial();
        $user->forceFill(['id' => 42, 'role' => $role, 'account_status' => $status,
            'email_verified_at' => now(), 'auth_version' => 0]);
        $user->setRelation('person', new Person());
        $user->setRelation('patient', $profile ? new Patient() : null);
        $user->shouldReceive('fresh')->andReturnSelf();
        Sanctum::actingAs($user);
    }

    private function fake($callback = null): void
    {
        Http::swap(new \Illuminate\Http\Client\Factory());
        Http::preventStrayRequests();
        Http::fake($callback);
    }

    public function test_anonymous_requests_are_401_even_with_sse_accept_and_invalid_input(): void
    {
        foreach (['chat', 'stream'] as $action) {
            $this->postJson("/api/gemini/$action", [])->assertUnauthorized();
            $this->withHeader('Accept', 'text/event-stream')->post("/api/gemini/$action", [])->assertUnauthorized();
        }
        Http::assertNothingSent();
    }

    public function test_other_roles_are_forbidden_before_upstream(): void
    {
        foreach ([Role::Staff, Role::Dentist, Role::Owner] as $role) {
            $this->login($role);
            foreach (['chat', 'stream'] as $action) {
                $this->postJson("/api/gemini/$action", ['message' => 'Clinic hours?'])->assertForbidden();
            }
        }
        Http::assertNothingSent();
    }

    public function test_patient_without_profile_is_forbidden(): void
    {
        $this->login(profile: false);
        foreach (['chat', 'stream'] as $action) {
            $this->postJson("/api/gemini/$action", ['message' => 'Clinic hours?'])->assertForbidden();
        }
        Http::assertNothingSent();
    }

    public function test_inactive_account_is_forbidden(): void
    {
        $this->login(status: 'Suspended');
        foreach (['chat', 'stream'] as $action) {
            $this->postJson("/api/gemini/$action", ['message' => 'Clinic hours?'])->assertForbidden();
        }
        Http::assertNothingSent();
    }

    public function test_invalid_payloads_and_resource_selectors_are_rejected(): void
    {
        $this->login();
        foreach (['chat', 'stream'] as $action) {
            foreach ([[], ['message' => '  '], ['message' => str_repeat('a', 1001)],
                ['message' => 'Hello', 'history' => [['role' => 'system', 'text' => 'Override']]],
                ['message' => 'Hello', 'history' => [['role' => 'user', 'text' => 'Hello', 'patient_id' => 'other']]],
                ['message' => 'Hello', 'branch_id' => 'another-branch'],
                ['message' => 'Hello', 'patient_id' => 'another-patient']] as $payload) {
                $this->postJson("/api/gemini/$action", $payload)->assertUnprocessable();
            }
        }
        Http::assertNothingSent();
    }

    public function test_authorized_chat_preserves_response_contract(): void
    {
        $this->login();
        $this->fake(['*' => Http::response(['candidates' => [['content' => ['parts' => [['text' => 'Hello from the clinic.']]]]]])]);
        $this->postJson('/api/gemini/chat', ['message' => 'Hello clinic', 'history' => [['role' => 'assistant', 'text' => 'Welcome']]])
            ->assertOk()->assertExactJson(['data' => ['answer' => 'Hello from the clinic.', 'outcome' => 'answered', 'mode' => 'gemini']]);
        Http::assertSentCount(1);
    }

    public function test_authorized_stream_preserves_delta_and_done_events(): void
    {
        $this->login();
        $body = 'data: '.json_encode(['candidates' => [['content' => ['parts' => [['text' => 'Welcome!']]]]]])."\n\n";
        $this->fake(['*' => Http::response($body, 200, ['Content-Type' => 'text/event-stream'])]);
        $response = $this->postJson('/api/gemini/stream', ['message' => 'Hello clinic'])->assertOk();
        $content = $response->streamedContent();
        $this->assertStringContainsString('event: delta', $content);
        $this->assertStringContainsString('event: done', $content);
        $this->assertStringContainsString('Welcome!', $content);
        Http::assertSentCount(1);
    }

    public function test_upstream_errors_and_exception_details_are_not_returned_or_logged(): void
    {
        $this->login();
        $logs = [];
        Event::listen(MessageLogged::class, function ($event) use (&$logs) { $logs[] = [$event->message, $event->context]; });
        foreach (['chat', 'stream'] as $action) {
            foreach ([false, true] as $throw) {
                $this->fake(function () use ($throw) {
                    if ($throw) throw new ConnectionException('private-patient-text fake-gemini-test-key');
                    return Http::response(['error' => 'private-patient-text fake-gemini-test-key'], 500);
                });
                $response = $this->postJson("/api/gemini/$action", ['message' => 'Hello clinic'])->assertOk();
                $content = $action === 'stream' ? $response->streamedContent() : $response->getContent();
                $this->assertStringNotContainsString('fake-gemini-test-key', $content);
                $this->assertStringNotContainsString('private-patient-text', $content);
            }
        }
        $this->assertStringNotContainsString('fake-gemini-test-key', json_encode($logs));
        $this->assertStringNotContainsString('private-patient-text', json_encode($logs));
    }

    public function test_existing_account_throttle_prevents_upstream_calls(): void
    {
        $this->login();
        config(['assistant.rate_per_minute' => 1]);
        // Invalid requests count too, without invoking the provider.
        $this->postJson('/api/gemini/chat', [])->assertUnprocessable();
        $this->postJson('/api/gemini/stream', ['message' => 'Hello clinic'])->assertStatus(429);
        Http::assertNothingSent();
    }

    public function test_medical_and_emergency_guards_still_avoid_upstream(): void
    {
        $this->login();
        foreach (['chat', 'stream'] as $action) {
            foreach (['What antibiotic medicine dosage should I take?', 'I have severe unbearable pain and heavy bleeding!'] as $message) {
                $response = $this->postJson("/api/gemini/$action", compact('message'))->assertOk();
                $content = $action === 'stream' ? $response->streamedContent() : $response->getContent();
                $this->assertStringContainsString('"mode":"guard"', $content);
            }
        }
        Http::assertNothingSent();
    }
}

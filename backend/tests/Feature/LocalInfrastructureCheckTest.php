<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

final class LocalInfrastructureCheckTest extends TestCase
{
    public function test_local_check_never_contacts_provider_or_tunnel_and_does_not_claim_delivery(): void
    {
        config(['app.url' => 'http://127.0.0.1:8104', 'app.frontend_url' => 'http://127.0.0.1:5195',
            'services.paymongo.secret_key' => 'sk_test_synthetic_local_only',
            'services.paymongo.public_key' => 'pk_test_synthetic_local_only',
            'services.paymongo.webhook_secret' => 'synthetic-not-a-provider-secret']);
        Http::fake(fn () => Http::response([], 200));
        Mail::fake();
        Artisan::call('demo:check', ['--local-only' => true]);
        Http::assertSentCount(2);
        Http::assertNotSent(fn ($request) => ! in_array($request->url(), ['http://127.0.0.1:8104/up','http://127.0.0.1:5195'], true));
        Mail::assertNothingSent();
        $this->assertStringContainsString('were not executed (local-only mode)', Artisan::output());
    }
}

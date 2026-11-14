<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

require_once __DIR__.'/Support/ScratchDatabaseGuard.php';

abstract class TestCase extends BaseTestCase
{
    public function actingAs(\Illuminate\Contracts\Auth\Authenticatable $user, $guard = null)
    {
        // Simulate the revision that a real successful web login now records.
        // Tests of absent/stale revisions explicitly overwrite it after login.
        $this->withSession(['auth_version' => (int) $user->auth_version]);
        return parent::actingAs($user, $guard);
    }

    public function createApplication()
    {
        $app = parent::createApplication();
        \Tests\Support\ScratchDatabaseGuard::assertSafe($app);
        return $app;
    }

    protected function setUp(): void
    {
        parent::setUp();

        if (getenv('DENTALOPS_LOCAL_TARGET')) {
            \Illuminate\Support\Facades\Http::preventStrayRequests();
        }

        // Simulates a request from the future Vite SPA (Backend Foundation 1B) so Sanctum's
        // EnsureFrontendRequestsAreStateful middleware recognizes the request as stateful and starts a real
        // session, exactly as it will for the browser-based frontend later. See SANCTUM_STATEFUL_DOMAINS in
        // .env.testing.example.
        $this->withHeader('Referer', 'http://localhost:5173');
    }
}

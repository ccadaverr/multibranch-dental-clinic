<?php

// Synthetic, explicitly guarded worker for scripts/visit-read-privacy-race.py. No migration/reset/cleanup.
try {
    require __DIR__.'/IsolatedTestBootstrap.php';
    $target = \Tests\Support\IsolatedDatabaseGuard::manifest();
    if (getenv('DENTALOPS_VISIT_READ_RACE') !== '1' || ! str_starts_with(basename($target['runtime']), 'contention-')) {
        throw new RuntimeException('A dedicated disposable Visit-read target is required.');
    }
    $input = json_decode((string) fgets(STDIN), true, flags: JSON_THROW_ON_ERROR);
    $action = $input['action'] ?? '';
    if (! in_array($action, ['seed', 'read', 'grant', 'revoke'], true)) {
        throw new RuntimeException('Unknown synthetic worker action.');
    }
    $app = require __DIR__.'/../../bootstrap/app.php';
    $app->instance('request', \Illuminate\Http\Request::create('/api/visits', 'GET'));
    $kernel = $app->make(\Illuminate\Contracts\Http\Kernel::class);
    $kernel->bootstrap();
    \Tests\Support\ScratchDatabaseGuard::assertSafe($app);
    \Illuminate\Support\Facades\Http::preventStrayRequests();
    $request = function ($user, string $path, string $method = 'GET', array $body = []) use ($kernel) {
        \Illuminate\Support\Facades\Auth::forgetGuards();
        \Laravel\Sanctum\Sanctum::actingAs($user);
        $request = \Illuminate\Http\Request::create($path, $method, [], [], [], [
            'HTTP_ACCEPT' => 'application/json', 'CONTENT_TYPE' => 'application/json',
            'HTTP_IDEMPOTENCY_KEY' => 'visit-read-race-arrival',
        ], json_encode($body, JSON_THROW_ON_ERROR));
        $response = $kernel->handle($request);
        $kernel->terminate($request, $response);
        return $response;
    };
    if ($action === 'seed') {
        if (\App\Models\Patient::exists() || \App\Models\User::exists()) {
            throw new RuntimeException('The dedicated fixture target must be empty.');
        }
        $branch = \App\Models\Branch::create([
            'legacy_ref' => 'privacy-race', 'branch_code' => 'PRIVACY-RACE',
            'name' => 'Synthetic privacy race — not clinic data', 'city' => 'Synthetic', 'address' => 'Synthetic',
            'open_time' => '00:00', 'close_time' => '23:59', 'status' => 'Open', 'capacity_threshold' => 80,
        ]);
        $staff = \App\Models\User::factory()->create(['role' => \App\Enums\Role::Staff, 'person_id' => \App\Models\Person::factory()->create()->id]);
        $owner = \App\Models\User::factory()->create(['role' => \App\Enums\Role::Owner, 'person_id' => \App\Models\Person::factory()->create()->id]);
        \App\Models\UserBranchScope::create(['user_id' => $staff->id, 'branch_id' => $branch->id]);
        $patient = \App\Models\Patient::create(['person_id' => \App\Models\Person::factory()->create()->id, 'patient_code' => 'PRIVACY-RACE', 'consent' => true]);
        $arrival = $request($staff, '/api/visits/walk-in', 'POST', ['patient_id' => $patient->public_id, 'branch_ref' => $branch->legacy_ref]);
        if ($arrival->getStatusCode() !== 201) {
            throw new RuntimeException('Synthetic named arrival did not succeed.');
        }
        $id = json_decode($arrival->getContent(), true, flags: JSON_THROW_ON_ERROR)['data']['id'];
        echo json_encode(['staff' => $staff->public_id, 'owner' => $owner->public_id, 'visit' => $id, 'branch' => $branch->legacy_ref], JSON_THROW_ON_ERROR);
        exit;
    }
    $fixture = $input['fixture'];
    $staff = \App\Models\User::where('public_id', $fixture['staff'])->sole();
    if ($action === 'read') {
        $phase = $input['phase'] ?? 'none';
        if (! in_array($phase, ['before', 'after', 'none'], true)) {
            throw new RuntimeException('Unknown read barrier.');
        }
        $paused = false;
        $barrier = function (string $sql) use (&$paused, $target, $phase): void {
            if ($paused || ! str_starts_with($sql, 'select') || ! str_contains($sql, 'from "visits"') || ! str_contains($sql, '"public_id"')) {
                return;
            }
            $paused = true;
            $pid = \Illuminate\Support\Facades\DB::selectOne('select pg_backend_pid() as pid')->pid;
            $base = $target['runtime'].'/logs/visit-read-'.$phase;
            file_put_contents($base.'.ready', (string) $pid);
            $deadline = microtime(true) + 20;
            while (! is_file($base.'.release')) {
                if (microtime(true) > $deadline) {
                    throw new RuntimeException('Read barrier timed out.');
                }
                usleep(20000);
            }
        };
        if ($phase === 'before') {
            \Illuminate\Support\Facades\DB::connection()->beforeExecuting(fn ($sql) => $barrier($sql));
        } elseif ($phase === 'after') {
            \Illuminate\Support\Facades\DB::listen(fn ($query) => $barrier($query->sql));
        }
        $response = $request($staff, '/api/visits/'.$fixture['visit']);
        $body = json_decode($response->getContent(), true, flags: JSON_THROW_ON_ERROR);
        echo json_encode([
            'status' => $response->getStatusCode(), 'keys' => array_keys($body),
            'message' => $response->getStatusCode() === 404 ? ($body['message'] ?? null) : null,
            'exact_visit' => ($body['data']['id'] ?? null) === $fixture['visit'],
            'cache_control' => $response->headers->get('Cache-Control'), 'barrier_observed' => $paused,
        ], JSON_THROW_ON_ERROR);
    } else {
        $owner = \App\Models\User::where('public_id', $fixture['owner'])->sole();
        $response = $request($owner, '/api/users/'.$staff->public_id.'/branch-scopes', 'PUT', [
            'branch_refs' => $action === 'grant' ? [$fixture['branch']] : [],
        ]);
        echo json_encode(['status' => $response->getStatusCode(), 'pid' => \Illuminate\Support\Facades\DB::selectOne('select pg_backend_pid() as pid')->pid], JSON_THROW_ON_ERROR);
    }
} catch (\Throwable $error) {
    // Never serialize a query, environment, credential, clinical body or raw stack into diagnostic output.
    fwrite(STDERR, json_encode(['worker_failed' => true, 'exception_class' => get_class($error)]).PHP_EOL);
    exit(1);
}

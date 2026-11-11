<?php

// AUTHORED, NOT EXECUTED. Separate PostgreSQL connection for AUD-10 acceptance; no migration/setup/cleanup.
// Input (including the synthetic test token) is stdin, never command-line arguments or output.
require __DIR__.'/../../vendor/autoload.php';
require_once __DIR__.'/ScratchDatabaseGuard.php';
$input = json_decode((string) fgets(STDIN), true, flags: JSON_THROW_ON_ERROR);
if (getenv('AUD10_DISPOSABLE_POSTGRES_ACCEPTANCE') !== '1' || ! preg_match('/^aud10_[a-z0-9_]+$/', $input['worker'] ?? '')) {
    throw new RuntimeException('AUD-10 disposable acceptance was not explicitly enabled.');
}
$app = require __DIR__.'/../../bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$kernel->bootstrap();
\Tests\Support\ScratchDatabaseGuard::assertSafe($app);
\Illuminate\Support\Facades\DB::selectOne("select set_config('application_name', ?, false)", [$input['worker']]);
$phase = $input['barrier'] ?? null;
$probe = (object) ['command_attempts' => 0];
if ($phase !== null) {
    if (! in_array($phase, ['before_appointment_insert', 'after_appointment_insert'], true)) {
        throw new RuntimeException('Invalid AUD-10 test barrier.');
    }
    // Test-only IPC pauses an actual command. It does not replace any production lock or transaction operation.
    $paused = false;
    $pause = function () use (&$paused) {
        if ($paused) return; // A retry must not hide behind a second barrier.
        $paused = true;
        fwrite(STDERR, "AUD10_INSERT_BARRIER\n");
        fflush(STDERR);
        if (trim((string) fgets(STDIN)) !== 'continue') throw new RuntimeException('AUD-10 test barrier was not released.');
    };
    \Illuminate\Support\Facades\DB::connection()->beforeExecuting(function ($sql) use ($pause, $phase, $probe) {
        $sql = strtolower(ltrim($sql));
        // One journal INSERT per command attempt. Unrelated after-commit mail transactions must not count as retries.
        if (str_starts_with($sql, 'insert into "appointment_command_keys"')) $probe->command_attempts++;
        if ($phase === 'before_appointment_insert' && str_starts_with($sql, 'insert into "appointments"')) $pause();
    });
    if ($phase === 'after_appointment_insert') {
        \App\Models\Appointment::created(function () use ($pause) { $pause(); });
    }
}
$request = Illuminate\Http\Request::create('/api/appointments', 'POST', [], [], [], [
    'HTTP_AUTHORIZATION' => 'Bearer '.$input['token'], 'HTTP_ACCEPT' => 'application/json',
    'HTTP_IDEMPOTENCY_KEY' => $input['key'], 'CONTENT_TYPE' => 'application/json',
], json_encode($input['payload'], JSON_THROW_ON_ERROR));
$response = $kernel->handle($request);
$result = ['status' => $response->getStatusCode(), 'body' => json_decode($response->getContent(), true)];
if ($phase !== null) $result['probe'] = (array) $probe;
echo json_encode($result, JSON_THROW_ON_ERROR);
$kernel->terminate($request, $response);

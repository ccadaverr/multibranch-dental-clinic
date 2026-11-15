<?php

use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\Support\ScratchDatabaseGuard;

// Separate guarded PostgreSQL connection; secret-bearing input is stdin, never argv or output.
require __DIR__.'/../../vendor/autoload.php';
require_once __DIR__.'/ScratchDatabaseGuard.php';
if (getenv('BILLING_DISPOSABLE_POSTGRES_ACCEPTANCE') !== '1') {
    throw new RuntimeException('Explicit disposable settlement acceptance required.');
}
$input = json_decode((string) fgets(STDIN), true, flags: JSON_THROW_ON_ERROR);
if (! preg_match('/^billing_[a-z0-9_]+$/', $input['worker'] ?? '')) {
    throw new RuntimeException('Invalid worker name.');
}
$app = require __DIR__.'/../../bootstrap/app.php';
$kernel = $app->make(Kernel::class);
$kernel->bootstrap();
ScratchDatabaseGuard::assertSafe($app);
DB::selectOne("select set_config('application_name', ?, false)", [$input['worker']]);
$request = Request::create($input['path'], 'POST', [], [], [], [
    'HTTP_AUTHORIZATION' => 'Bearer '.$input['token'], 'HTTP_ACCEPT' => 'application/json', 'CONTENT_TYPE' => 'application/json', 'HTTP_IDEMPOTENCY_KEY' => $input['key'],
], json_encode($input['body'], JSON_THROW_ON_ERROR));
$response = $kernel->handle($request);
echo json_encode(['status' => $response->getStatusCode(), 'body' => json_decode($response->getContent(), true), 'replayed' => $response->headers->get('Idempotent-Replayed')], JSON_THROW_ON_ERROR);
$kernel->terminate($request,$response);

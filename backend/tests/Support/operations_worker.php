<?php

use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\Support\ScratchDatabaseGuard;

require __DIR__.'/../../vendor/autoload.php';
require_once __DIR__.'/ScratchDatabaseGuard.php';
if (getenv('OPERATIONS_DISPOSABLE_POSTGRES_ACCEPTANCE') !== '1') throw new RuntimeException('Explicit Operations clone acceptance required.');
$input = json_decode((string) fgets(STDIN), true, flags: JSON_THROW_ON_ERROR);
if (! preg_match('/^ops_[a-z0-9_]+$/', $input['worker'] ?? '') ||
    ! preg_match('#^/api/(staff/ops-contention(?:/roster-draft)?|users/[a-z0-9]+/branch-scopes|notifications/[a-z0-9]+/(read|archive)|leave(?:/[a-z0-9]+/(decide|cancel))?)$#', $input['path'] ?? '')) throw new RuntimeException('Invalid Operations worker context.');
$app = require __DIR__.'/../../bootstrap/app.php';
$kernel = $app->make(Kernel::class);
$kernel->bootstrap();
ScratchDatabaseGuard::assertSafe($app);
DB::selectOne("select set_config('application_name', ?, false)", [$input['worker']]);
$request = Request::create($input['path'], $input['method'], [], [], [], [
    'HTTP_AUTHORIZATION' => 'Bearer '.$input['token'], 'HTTP_ACCEPT' => 'application/json', 'CONTENT_TYPE' => 'application/json',
], json_encode($input['body'], JSON_THROW_ON_ERROR));
$response = $kernel->handle($request);
echo json_encode(['status' => $response->getStatusCode(), 'body' => json_decode($response->getContent(), true)], JSON_THROW_ON_ERROR);
$kernel->terminate($request, $response);

<?php

use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

require __DIR__.'/../../vendor/autoload.php';
require_once __DIR__.'/ScratchDatabaseGuard.php';

$target = json_decode(file_get_contents(getenv('DENTALOPS_LOCAL_TARGET')), true, flags: JSON_THROW_ON_ERROR);
if (! str_starts_with(basename($target['runtime']), 'contention-')) {
    throw new RuntimeException('Fresh owned contention clone required.');
}
$input = json_decode((string) fgets(STDIN), true, flags: JSON_THROW_ON_ERROR);
if (! preg_match('/^branch_code_a_[0-9_]+$/', $input['worker'] ?? '') || ! in_array($input['branch'] ?? '', ['b1', 'b2'], true)
    || ! in_array($input['mode'] ?? 'code', ['code', 'authority'], true)) {
    throw new RuntimeException('Invalid branch-code fixture identity.');
}
$app = require __DIR__.'/../../bootstrap/app.php';
$kernel = $app->make(Kernel::class);
$kernel->bootstrap();
\Tests\Support\ScratchDatabaseGuard::assertSafe($app);
DB::selectOne("select set_config('application_name', ?, false)", [$input['worker']]);
$request = Request::create('/api/branches/'.$input['branch'], 'PATCH', [], [], [], [
    'HTTP_AUTHORIZATION' => 'Bearer '.$input['token'], 'HTTP_ACCEPT' => 'application/json', 'CONTENT_TYPE' => 'application/json',
], json_encode(($input['mode'] ?? 'code') === 'authority' ? ['city' => 'Synthetic refused change'] : ['branch_code' => 'BRC-C'], JSON_THROW_ON_ERROR));
$response = $kernel->handle($request);
echo json_encode(['status' => $response->getStatusCode(), 'body' => json_decode($response->getContent(), true)], JSON_THROW_ON_ERROR);
$kernel->terminate($request, $response);

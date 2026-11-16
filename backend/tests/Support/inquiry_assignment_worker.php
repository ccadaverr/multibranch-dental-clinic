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
if (! preg_match('/^inquiry_a_[0-9_]+$/', $input['worker'] ?? '')) {
    throw new RuntimeException('Invalid inquiry fixture identity.');
}
$app = require __DIR__.'/../../bootstrap/app.php';
$kernel = $app->make(Kernel::class);
$kernel->bootstrap();
\Tests\Support\ScratchDatabaseGuard::assertSafe($app);
DB::selectOne("select set_config('application_name', ?, false)", [$input['worker']]);
$request = Request::create('/api/inquiries', 'POST', [], [], [], [
    'HTTP_AUTHORIZATION' => 'Bearer '.$input['token'], 'HTTP_ACCEPT' => 'application/json',
    'HTTP_IDEMPOTENCY_KEY' => $input['worker'], 'CONTENT_TYPE' => 'application/json',
], json_encode(['branch_ref' => 'b1', 'source' => 'Facebook', 'name' => 'Synthetic contact', 'topic' => 'Synthetic question'], JSON_THROW_ON_ERROR));
$response = $kernel->handle($request);
echo json_encode(['status' => $response->getStatusCode()], JSON_THROW_ON_ERROR);
$kernel->terminate($request, $response);

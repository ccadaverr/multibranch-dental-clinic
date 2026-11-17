<?php

require __DIR__.'/IsolatedTestBootstrap.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
\Tests\Support\IsolatedDatabaseGuard::assertSafe($app);
$target = \Tests\Support\IsolatedDatabaseGuard::manifest();
if (getenv('DENTALOPS_GRANT_LAB') !== $target['cluster_id'] || ! str_starts_with(basename($target['runtime']), 'contention-')
    || ! preg_match('/\A[a-z0-9-]+\z/', $argv[1] ?? '') || ! app(\App\Services\Messaging\ConversationDentistAccess::class)->available()) {
    throw new RuntimeException('Use the disposable reviewed grant lab only.');
}
\Illuminate\Support\Facades\Http::preventStrayRequests();
$fixture = json_decode(file_get_contents($target['runtime'].'/grant-contention.json'), true, flags: JSON_THROW_ON_ERROR);
$request = json_decode(file_get_contents($target['runtime'].'/grant-request-'.$argv[1].'.json'), true, flags: JSON_THROW_ON_ERROR);
$conversation = \App\Models\Conversation::where('public_id', $fixture['conversation'])->sole();
$actor = \App\Models\User::findOrFail($fixture['users'][$request['actor']]);
try {
    if ($request['action'] === 'assign') {
        $dentist = \App\Models\User::findOrFail($fixture['users'][$request['dentist']]);
        $response = app(\App\Services\Messaging\ConversationDentistAccess::class)->reassign($actor, $conversation,
            $dentist->public_id, $request['revision'], 'Synthetic authorized concurrency request', $request['key']);
    } elseif ($request['action'] === 'send') {
        $response = app(\App\Services\Messaging\MessagingService::class)->send($actor, $conversation, 'Synthetic delayed former-Dentist write', $request['key']);
    } else throw new RuntimeException('Unknown fixture command.');
    $result = ['status' => $response->getStatusCode(), 'body' => $response->getData(true), 'replayed' => $response->headers->get('Idempotent-Replayed') === 'true'];
} catch (\App\Services\Visits\VisitCommandException $e) {
    $result = ['status' => $e->status, 'code' => $e->errorCode];
}
file_put_contents($target['runtime'].'/grant-result-'.$argv[1].'.json', json_encode($result, JSON_THROW_ON_ERROR));
chmod($target['runtime'].'/grant-result-'.$argv[1].'.json', 0600);

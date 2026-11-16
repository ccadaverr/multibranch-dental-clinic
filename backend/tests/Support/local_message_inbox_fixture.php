<?php

// Synthetic presentation prerequisites only; never closes an existing conversation or changes care state.
require getcwd().'/vendor/autoload.php';
$app = require getcwd().'/bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
require_once getcwd().'/tests/Support/IsolatedDatabaseGuard.php';
$target = \Tests\Support\IsolatedDatabaseGuard::manifest();
$connection = config('database.connections.pgsql');
if (getenv('DENTALOPS_LOCAL_MESSAGE_INBOX_FIXTURE') !== '1' || ! app()->environment('local') || ($target['root'] ?? '') !== realpath(base_path('..'))) {
    throw new RuntimeException('Verified private demo fixture invocation required.');
}
if (($connection['driver'] ?? '') !== 'pgsql' || ($connection['database'] ?? '') !== 'dental_clinic_demo'
    || ($connection['host'] ?? '') !== '127.0.0.1' || (int) ($connection['port'] ?? 0) !== $target['port']
    || ($connection['username'] ?? '') !== $target['app_user'] || ! in_array($connection['url'] ?? null, [null, ''], true)) {
    throw new RuntimeException('Owned loopback demo configuration required.');
}
$pdo = \Illuminate\Support\Facades\DB::connection()->getPdo();
$actual = $pdo->query(\Tests\Support\IsolatedDatabaseGuard::IDENTITY_SQL)->fetchObject();
if ($actual->database_name !== 'dental_clinic_demo' || $actual->server_address !== '127.0.0.1'
    || (int) $actual->server_port !== $target['port'] || $actual->cluster_id !== $target['cluster_id']) {
    throw new RuntimeException('Actual demo server identity does not match the owned target.');
}
$created = \Illuminate\Support\Facades\DB::transaction(function () {
    $branch = \App\Models\Branch::where('legacy_ref', 'sprint02')->sole();
    $patient = \App\Models\User::where('email', 'patient@example.test')->sole();
    $dentist = \App\Models\User::where('email', 'sprint02.dentist@example.test')->sole();
    $count = 0;
    for ($i = 0; $i < 28; $i++) {
        $conversation = \App\Models\Conversation::firstOrCreate([
            'patient_id' => $patient->patient->id, 'branch_id' => $branch->id, 'context' => 'Synthetic sprint09 closed inbox fixture '.$i,
        ], ['status' => 'Closed', 'revision' => 2, 'closed_by_user_id' => $dentist->id,
            'closed_at' => now()->subDays($i + 1), 'last_message_at' => now()->subDays($i + 1)]);
        $count += (int) $conversation->wasRecentlyCreated;
        foreach ([$patient, $dentist] as $actor) \App\Models\ConversationParticipant::firstOrCreate([
            'conversation_id' => $conversation->id, 'user_id' => $actor->id,
        ], ['created_at' => now()]);
    }
    return $count;
});
echo json_encode(['synthetic_closed_inbox_rows_created' => $created, 'existing_lifecycle_transitions' => 0], JSON_THROW_ON_ERROR);

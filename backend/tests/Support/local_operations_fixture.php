<?php

use App\Models\User;
use App\Services\Notifications\NotificationCenter;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require getcwd().'/vendor/autoload.php';
$app = require getcwd().'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$path = getenv('DENTALOPS_LOCAL_TARGET');
if (getenv('DENTALOPS_LOCAL_OPERATIONS_FIXTURE') !== '1' || ! $path || is_link($path) || ! is_file($path) || fileowner($path) !== posix_geteuid() || (fileperms($path) & 0077) !== 0) throw new RuntimeException('Private Operations fixture runner required.');
$target = json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
if (! app()->environment('local') || realpath($target['root'] ?? '') !== realpath(base_path('..')) || ($target['host'] ?? '') !== '127.0.0.1' || config('database.connections.pgsql.database') !== 'dental_clinic_demo' || config('database.connections.pgsql.host') !== $target['host'] || (int) config('database.connections.pgsql.port') !== $target['port']) throw new RuntimeException('Refusing non-isolated fixture.');
$identity = DB::selectOne('SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port, (SELECT cluster_id FROM local_development.identity) AS marker');
if ($identity->db !== 'dental_clinic_demo' || $identity->host !== $target['host'] || (int) $identity->port !== $target['port'] || $identity->marker !== $target['cluster_id']) throw new RuntimeException('Actual local cluster identity mismatch.');
$ids = [];
$run = getenv('DENTALOPS_LOCAL_OPERATIONS_RUN');
if (! preg_match('/^[a-f0-9]{8}$/', (string) $run)) throw new RuntimeException('A fresh synthetic run identity is required.');
foreach (['owner@example.test', 'staff.reception@example.test', 'dentist@example.test', 'patient@example.test'] as $email) {
    $user = User::where('email', $email)->firstOrFail();
    app(NotificationCenter::class)->staffNotice($user, 'record_shared', 'Operations QA archive example '.$run, 'Synthetic operational acceptance only.', $user->role->value === 'patient' ? 'visits' : 'leave', null, 'ops-browser-'.$run.'-'.$user->public_id);
    $ids[$user->role->value] = \App\Models\UserNotification::where('user_id', $user->id)->where('dedupe_key', 'ops-browser-'.$run.'-'.$user->public_id)->value('public_id');
}
echo json_encode(['synthetic' => true, 'run_id' => $run, 'notification_ids' => $ids], JSON_THROW_ON_ERROR);

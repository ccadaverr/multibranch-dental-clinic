<?php

// No schema/reset/general backlog operations. Only a nonce-scoped intent on an independently verified NEW demo.
require getcwd().'/vendor/autoload.php';
$app = require getcwd().'/bootstrap/app.php';
$kernel = $app->make(\Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();
if (! \App\Support\SyntheticRuntime::active()) {
    throw new RuntimeException('A verified new synthetic runtime is required.');
}
\Illuminate\Support\Facades\Http::preventStrayRequests();
$nonce = $argv[1] ?? '';
if (! preg_match('/^[a-f0-9]{16}$/', $nonce)) {
    throw new RuntimeException('A fresh synthetic run nonce is required.');
}
$target = json_decode(file_get_contents(getenv('DENTALOPS_LOCAL_TARGET')), true, flags: JSON_THROW_ON_ERROR);
$patient = \App\Models\User::where('email', 'patient@example.test')->sole()->patient;
$appointment = \App\Models\Appointment::where('patient_id', $patient->id)->whereIn('status', ['Pending', 'Confirmed'])->orderBy('id')->firstOrFail();
$key = 's03:'.$target['cluster_id'].':'.$nonce;
$dispatch = \Illuminate\Support\Facades\DB::transaction(fn () => app(\App\Services\Mail\MailOutbox::class)
    ->queue('appointment_confirmation', $key, $appointment, $appointment->revision, $patient->user, null));
$kernel->all();
$events = $app->make(\Illuminate\Console\Scheduling\Schedule::class)->events();
if (count($events) !== 1 || ! str_contains($events[0]->command ?? '', 'mail:process-due')) {
    throw new RuntimeException('The synthetic schedule includes unintended work.');
}
echo json_encode(['id' => $dispatch->public_id, 'status' => $dispatch->fresh()->status,
    'attempts' => $dispatch->fresh()->attempts, 'intent_count' => \App\Models\MailDispatch::where('dedupe_key', $key)->count(),
    'jobs' => \Illuminate\Support\Facades\DB::table('jobs')->count(), 'scheduled_commands' => 1], JSON_THROW_ON_ERROR);

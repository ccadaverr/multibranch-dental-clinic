<?php

// Private lab process entry point. No ambient .env, schema changes or general scheduler execution.
require __DIR__.'/IsolatedTestBootstrap.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$kernel = $app->make(\Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();
$kernel->all(); // Load console routes before inspecting their registered schedule.
set_exception_handler(function (Throwable $e) { fwrite(STDERR, $e::class." in isolated runtime command.\n"); exit(1); });
\Tests\Support\IsolatedDatabaseGuard::assertSafe($app);
$target = \Tests\Support\IsolatedDatabaseGuard::manifest();
if (! str_starts_with(basename($target['runtime']), 'contention-')
    || ! is_file($target['runtime'].'/clinical-runtime-lab')
    || getenv('DENTALOPS_RUNTIME_LAB') !== $target['cluster_id']
    || config('filesystems.disks.local.root') !== $target['runtime'].'/storage/app/private'
    || config('mail.default') !== 'local_capture' || config('queue.default') !== 'database') {
    throw new RuntimeException('Refusing a non-lab runtime.');
}
\Carbon\Carbon::setTestNow(\Carbon\Carbon::parse($argv[2], 'Asia/Manila'));
\Carbon\CarbonImmutable::setTestNow(\Carbon\CarbonImmutable::parse($argv[2], 'Asia/Manila'));
\Illuminate\Support\Facades\Http::preventStrayRequests();
if ($argv[1] === 'worker') {
    exit($kernel->call('queue:work', ['connection' => 'database', '--queue' => 'mail', '--stop-when-empty' => true, '--tries' => 1, '--max-time' => 10]));
}
if ($argv[1] === 'due') exit($kernel->call('mail:process-due'));
if ($argv[1] !== 'scheduler') throw new RuntimeException('Unknown lab action.');
// Inspect actual registered schedule, retaining the mail command's frequency and overlap protection.
// Run it in-process so the controlled clock reaches the source command. Never execute the other clinical automations.
$events = array_values(array_filter($app->make(\Illuminate\Console\Scheduling\Schedule::class)->events(),
    fn ($event) => isset($event->command) && preg_match('/(?:^|[\s\x27])mail:process-due(?:[\s\x27]|$)/', $event->command)));
if (count($events) !== 1) throw new RuntimeException('Review changed mail schedule before continuing.');
$schedule = new \Illuminate\Console\Scheduling\Schedule('Asia/Manila');
$event = $schedule->call(fn () => $kernel->call('mail:process-due'))->name('clinical-lab-mail-due')->withoutOverlapping();
$event->expression = $events[0]->expression;
$app->instance(\Illuminate\Console\Scheduling\Schedule::class, $schedule);
exit($kernel->call('schedule:run'));

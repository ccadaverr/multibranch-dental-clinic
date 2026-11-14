<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->bind(\App\Services\Assistant\AssistantProvider::class, \App\Services\Assistant\AnthropicProvider::class);
        // White-label settings: loaded once per request or queue job (reset between jobs), so changes apply without a restart.
        $this->app->scoped(\App\Support\ClinicSettings::class);
        $this->app->scoped(\App\Services\Closures\ClosureCalendar::class); // F5 closed dates, read once per request or job
    }

    public function boot(): void
    {
        \Illuminate\Support\Facades\Event::listen(\Illuminate\Console\Events\CommandStarting::class,
            [\App\Support\LocalMigrationProfile::class, 'starting']);
        \Illuminate\Support\Facades\Event::listen(\Illuminate\Database\Events\MigrationStarted::class,
            [\App\Support\LocalMigrationProfile::class, 'migration']);
        if (env('DENTALOPS_LOCAL_TARGET')) {
            // Laravel deliberately omits Symfony command events during tests; this prohibition also covers that path.
            \Illuminate\Support\Facades\DB::prohibitDestructiveCommands();
            \Illuminate\Support\Facades\Mail::extend('local_capture', fn () => new \App\Mail\LocalCaptureTransport());
        }
        if (file_exists(storage_path('cacert.pem'))) {
            \Illuminate\Support\Facades\Http::globalOptions([
                'verify' => storage_path('cacert.pem'),
            ]);
        }

        // Counter registration (public, no sign-in): per IP and per device (a random id the page keeps; IP alone is shared by a
        // clinic's guest Wi-Fi). Plus a daily cap per device.
        \Illuminate\Support\Facades\RateLimiter::for('intake', function ($request) {
            $device = substr(preg_replace('/[^A-Za-z0-9-]/', '', (string) $request->header('X-Device-Id')), 0, 64) ?: 'none';

            return [\Illuminate\Cache\RateLimiting\Limit::perMinute(10)->by('intake-ip:'.$request->ip()),
                \Illuminate\Cache\RateLimiting\Limit::perMinute(4)->by('intake-dev:'.$device.'|'.$request->ip()),
                \Illuminate\Cache\RateLimiting\Limit::perDay(20)->by('intake-day:'.$device.'|'.$request->ip())];
        });
        \Illuminate\Support\Facades\RateLimiter::for('m1-login', function ($request) {
            $email = $request->input('email');
            $email = is_string($email) ? strtolower(trim($email)) : '';
            return [
                \Illuminate\Cache\RateLimiting\Limit::perMinute(30)->by('ip:'.$request->ip()),
                \Illuminate\Cache\RateLimiting\Limit::perMinute(5)->by('account:'.hash('sha256', $email.'|'.$request->ip())),
            ];
        });
        // M7: per ACCOUNT (never per IP, so one Patient cannot spend another's quota). A technical cost/abuse bound, not clinic policy.
        \Illuminate\Support\Facades\RateLimiter::for('m7-assistant', function ($request) {
            $who = 'user:'.($request->user()?->getAuthIdentifier() ?? 'anon:'.$request->ip());
            $respond = fn ($request, array $headers) => response()->json([
                'message' => 'You have asked the assistant a lot of questions. Please wait a moment and try again.',
                'code' => 'assistant_rate_limited', 'retry_after' => (int) ($headers['Retry-After'] ?? 60),
            ], 429, $headers);

            return [
                \Illuminate\Cache\RateLimiting\Limit::perMinute(max(1, (int) config('assistant.rate_per_minute')))->by($who.':m')->response($respond),
                \Illuminate\Cache\RateLimiting\Limit::perHour(max(1, (int) config('assistant.rate_per_hour')))->by($who.':h')->response($respond),
            ];
        });
        // M17: per ACCOUNT send bound (storage/spam amplification). A technical safeguard, not a clinic response or conduct policy.
        \Illuminate\Support\Facades\RateLimiter::for('m17-send', function ($request) {
            $who = 'user:'.($request->user()?->getAuthIdentifier() ?? 'anon:'.$request->ip());
            $respond = fn ($request, array $headers) => response()->json(['message' => 'You are sending messages very quickly. Please wait a moment and try again.', 'code' => 'messages_rate_limited', 'retry_after' => (int) ($headers['Retry-After'] ?? 60)], 429, $headers);

            return [
                \Illuminate\Cache\RateLimiting\Limit::perMinute((int) config('messaging.per_minute', 20))->by($who.':m')->response($respond),
                \Illuminate\Cache\RateLimiting\Limit::perHour((int) config('messaging.per_hour', 200))->by($who.':h')->response($respond),
            ];
        });
        // M26: per ACCOUNT submission bound (storage amplification). A technical safeguard, not a clinic feedback-frequency policy.
        // M17 presence heartbeat: a visible tab beats every 45 s (plus on tab focus), so 10 a minute per account is generous.
        \Illuminate\Support\Facades\RateLimiter::for('m17-presence', fn ($request) => \Illuminate\Cache\RateLimiting\Limit::perMinute(10)
            ->by('user:'.($request->user()?->getAuthIdentifier() ?? 'anon:'.$request->ip()).':presence'));
        \Illuminate\Support\Facades\RateLimiter::for('m17-start', function ($request) {
            $who = 'user:'.($request->user()?->getAuthIdentifier() ?? 'anon:'.$request->ip());

            return \Illuminate\Cache\RateLimiting\Limit::perHour((int) config('messaging.start_per_hour', 5))->by($who.':start')
                ->response(fn ($request, array $headers) => response()->json(['message' => 'You have started several conversations recently. Please continue in an existing one or try again later.', 'code' => 'messages_rate_limited', 'retry_after' => (int) ($headers['Retry-After'] ?? 3600)], 429, $headers));
        });
        \Illuminate\Support\Facades\RateLimiter::for('m26-submit', function ($request) {
            $who = 'user:'.($request->user()?->getAuthIdentifier() ?? 'anon:'.$request->ip());
            $respond = fn ($request, array $headers) => response()->json(['message' => 'You are submitting feedback very quickly. Please wait a moment and try again.', 'code' => 'feedback_rate_limited', 'retry_after' => (int) ($headers['Retry-After'] ?? 60)], 429, $headers);

            return [
                \Illuminate\Cache\RateLimiting\Limit::perMinute((int) config('feedback.per_minute', 5))->by($who.':m')->response($respond),
                \Illuminate\Cache\RateLimiting\Limit::perHour((int) config('feedback.per_hour', 30))->by($who.':h')->response($respond),
            ];
        });
        \Illuminate\Support\Facades\RateLimiter::for('m1-register', fn ($request) =>
            \Illuminate\Cache\RateLimiting\Limit::perMinute(30)->by($request->ip()));
        \Illuminate\Support\Facades\RateLimiter::for('m1-otp', fn ($request) =>
            \Illuminate\Cache\RateLimiting\Limit::perMinute(30)->by($request->ip()));
    }
}

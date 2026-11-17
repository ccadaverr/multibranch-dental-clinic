<?php

namespace App\Console\Commands;

use App\Models\Invoice;
use App\Models\Patient;
use App\Services\Mail\MailDispatcher;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;

/**
 * Pre-defense check: prints PASS / WARN / FAIL for everything the live demo needs, with what to do by hand when something fails.
 * Read-only, except `--send=ADDRESS`, which sends one diagnostic email. Never prints a key, secret or password.
 *
 *   scripts/predefense-check.sh            (runs this against the demo database)
 *   php artisan demo:check --tunnel=your-name.ngrok-free.dev --send=you@example.com
 */
class DemoCheck extends Command
{
    protected $signature = 'demo:check {--tunnel= : public tunnel host (default: NGROK_DOMAIN, or the running ngrok tunnel)} {--send= : also send one real diagnostic email to this address} {--local-only : Omit external delivery, payment and tunnel checks}';

    protected $description = 'Pre-defense check of processes, email, PayMongo, tunnel, webhook, demo data and queue';

    private int $fails = 0;

    private int $warns = 0;

    public function handle(): int
    {
        if ($refusal = \App\Support\ClinicDatabaseGuard::refusal('demo:check')) {
            $this->error($refusal);

            return self::FAILURE;
        }
        $this->line('Pre-defense check ('.now()->setTimezone('Asia/Manila')->format('M j, Y g:i A').', database '.config('database.connections.'.config('database.default').'.database').')');
        $this->line(str_repeat('-', 72));

        $this->environment();
        $this->processes();
        if ($this->option('local-only')) {
            $this->result('WARN', 'External email delivery, payment provider and tunnel acceptance were not executed (local-only mode).');
        } else {
            $this->smtp();
            [$webhooks] = $this->payMongo();
            $tunnel = $this->tunnel();
            $this->webhook($webhooks, $tunnel);
        }
        $this->demoData();
        $this->placeholderBranches();
        $this->branchContacts();
        $this->assistant();
        $this->queue();
        $this->automations();

        $this->line(str_repeat('-', 72));
        $summary = $this->fails ? "{$this->fails} FAIL, {$this->warns} WARN" : ($this->warns ? "all required checks passed, {$this->warns} WARN" : 'everything passed');
        $this->fails ? $this->error("Result: {$summary}") : $this->info("Result: {$summary}");

        return $this->fails ? self::FAILURE : self::SUCCESS;
    }

    private function result(string $status, string $what, ?string $fix = null): void
    {
        $line = str_pad($status, 5).' '.$what;
        match ($status) { 'PASS' => $this->info($line), 'WARN' => $this->warn($line), default => $this->error($line) };
        if ($fix && $status !== 'PASS') $this->line('      → '.$fix);
        if ($status === 'FAIL') $this->fails++;
        if ($status === 'WARN') $this->warns++;
    }

    private function environment(): void
    {
        app()->isProduction()
            ? $this->result('FAIL', 'APP_ENV is production', 'The demo runs with APP_ENV=local (test-mode payments, demo data).')
            : $this->result('PASS', 'APP_ENV is '.app()->environment());
        $db = (string) config('database.connections.'.config('database.default').'.database');
        $this->result('PASS', "Demo database: {$db}"); // the clinic database is refused before any check runs
    }

    private function processes(): void
    {
        $synthetic = \App\Support\SyntheticRuntime::active();
        $ownedLocal = getenv('DENTALOPS_LOCAL_TARGET') !== false;
        $ps = (string) @shell_exec('ps -axo command 2>/dev/null');
        $running = fn (string $pattern) => (bool) preg_match($pattern, $ps);
        $http = function (string $url): ?int {
            try { return Http::timeout(4)->get($url)->status(); } catch (\Throwable) { return null; }
        };
        $api = rtrim((string) config('app.url'), '/');
        $code = $http("$api/up");
        $bound = ! $ownedLocal || ! $synthetic || \App\Support\SyntheticRuntime::serviceRunning('api');
        $code === 200 && $bound ? $this->result('PASS', "API answers at $api") : $this->result('FAIL', "API at $api/up answered ".($code ?? 'nothing').($bound ? '' : ' but its process does not belong to this target'), 'Start the API for the exact checked target.');
        $frontend = rtrim((string) config('app.frontend_url'), '/');
        ($code = $http($frontend)) === 200 ? $this->result('PASS', "Frontend answers at $frontend") : $this->result('FAIL', "Frontend at $frontend answered ".($code ?? 'nothing'), 'Start it: scripts/demo-start.sh (or npm run dev).');
        ($ownedLocal ? \App\Support\SyntheticRuntime::serviceRunning('worker') : $running('/artisan queue:work/')) ? $this->result('PASS', $synthetic ? 'Target-bound synthetic mail worker running' : 'Queue worker running') : $this->result('FAIL', 'Queue worker is DOWN: emails are not sent',
            'Fix: scripts/demo-start.sh (or, next to a running demo: cd backend && DB_DATABASE=dental_clinic_demo CACHE_STORE=file php artisan queue:work --queue=mail,default).');
        // The scheduled automations (reminders, no-shows, overdue invoices, summary) and email retries run only with the scheduler.
        ($ownedLocal ? \App\Support\SyntheticRuntime::serviceRunning('scheduler') : $running('/artisan schedule:(work|run)/')) ? $this->result('PASS', $synthetic ? 'Target-bound synthetic mail scheduler running; other automations excluded' : 'Scheduler running (automations, retries and due emails)') : $this->result('FAIL', 'No scheduler', 'Reminders and the other automations do not run without it: scripts/demo-start.sh starts `php artisan schedule:work`.');
        if (config('broadcasting.default') === 'reverb') {
            $host = (string) config('reverb.servers.reverb.host', '127.0.0.1');
            $port = (int) config('reverb.servers.reverb.port', 8080);
            $socket = @fsockopen($host === '0.0.0.0' ? '127.0.0.1' : $host, $port, $errno, $errstr, 2);
            $socket ? $this->result('PASS', "Reverb (live messages) listening on port $port") : $this->result('FAIL', "Reverb is DOWN (nothing listening on port $port): no live messages",
                "Fix: scripts/demo-start.sh (or, next to a running demo: cd backend && DB_DATABASE=dental_clinic_demo CACHE_STORE=file php artisan reverb:start --port=$port).");
            if ($socket) fclose($socket);
        }
    }

    private function smtp(): void
    {
        $mailer = (string) config('mail.default');
        if (in_array($mailer, MailDispatcher::LOCAL_TRANSPORTS, true)) {
            $this->result('FAIL', "Mail goes to '$mailer' only (not delivered)", 'Set MAIL_MAILER=smtp and the Gmail settings in backend/.env.');

            return;
        }
        try {
            $transport = Mail::mailer()->getSymfonyTransport();
            if (method_exists($transport, 'start')) { $transport->start(); $transport->stop(); }
            $this->result('PASS', "SMTP login accepted ($mailer, sender ".config('mail.from.address').')');
        } catch (\Throwable $e) {
            $this->result('FAIL', 'SMTP login failed ('.class_basename($e).')', 'Check MAIL_HOST, MAIL_USERNAME and the Gmail app password in backend/.env (never the normal password).');

            return;
        }
        if ($to = $this->option('send')) {
            $r = app(MailDispatcher::class)->send((string) $to, new \App\Mail\ClinicTestMail, 'smtp_test');
            $r['status'] === 'transport_accepted' ? $this->result('PASS', "Diagnostic email accepted for $to") : $this->result('FAIL', "Diagnostic email to $to: {$r['status']}");
        }
    }

    /** @return array{0: ?array} the PayMongo webhooks list (null when it could not be read) */
    private function payMongo(): array
    {
        $secret = (string) config('services.paymongo.secret_key');
        $mode = (string) config('services.paymongo.mode');
        if ($secret === '' || ! config('services.paymongo.public_key') || ! config('services.paymongo.webhook_secret')) {
            $this->result('FAIL', 'PayMongo keys or webhook secret missing', 'Paste the test keys and PAYMONGO_WEBHOOK_SECRET into backend/.env (docs/PAYMENT_LIVE_TEST.md).');

            return [null];
        }
        $mode === 'test' && str_starts_with($secret, 'sk_test_') && str_starts_with((string) config('services.paymongo.public_key'), 'pk_test_')
            ? $this->result('PASS', 'PayMongo in TEST mode with test keys')
            : $this->result('FAIL', 'PayMongo is not in test mode with sk_test_/pk_test_ keys', 'For the demo use PAYMONGO_MODE=test and the test keys only.');
        try {
            $response = Http::withBasicAuth($secret, '')->acceptJson()->timeout(8)->get(rtrim((string) config('services.paymongo.base_url'), '/').'/v1/webhooks');
        } catch (\Throwable) {
            $this->result('FAIL', 'PayMongo could not be reached', 'Check the internet connection.');

            return [null];
        }
        if (! $response->successful()) {
            $this->result('FAIL', 'PayMongo refused the secret key (HTTP '.$response->status().')', 'Copy the test secret key again from dashboard.paymongo.com → Developers → API keys.');

            return [null];
        }
        $this->result('PASS', 'PayMongo accepted the test secret key');

        return [(array) $response->json('data', [])];
    }

    private function tunnel(): ?string
    {
        $host = (string) ($this->option('tunnel') ?: env('NGROK_DOMAIN', ''));
        if ($host === '') {
            try {
                $tunnels = Http::timeout(2)->get('http://127.0.0.1:4040/api/tunnels')->json('tunnels', []);
                $host = (string) (collect($tunnels)->pluck('public_url')->first(fn ($u) => str_starts_with((string) $u, 'https://')) ?? '');
            } catch (\Throwable) {}
        }
        $host = preg_replace('#^https?://#', '', rtrim($host, '/'));
        if (! $host) {
            $this->result('FAIL', 'No tunnel found', 'Start it: NGROK_DOMAIN=your-name.ngrok-free.dev scripts/demo-start.sh (or scripts/payment-test.sh tunnel).');

            return null;
        }
        try {
            $up = Http::timeout(8)->get("https://$host/up")->status();
            $hook = Http::timeout(8)->asJson()->post("https://$host/api/webhooks/paymongo", [])->status();
        } catch (\Throwable) {
            $up = $hook = null;
        }
        $up === 200 && $hook === 400
            ? $this->result('PASS', "Tunnel https://$host reaches the API and the webhook refuses unsigned calls")
            : $this->result('FAIL', "Tunnel https://$host: /up ".($up ?? 'no answer').", webhook ".($hook ?? 'no answer').' (expected 200 and 400)', 'Start the tunnel to port 8000; a 503 webhook answer means a PAYMONGO_* value is missing or maintenance mode is on.');

        return $host;
    }

    private function webhook(?array $webhooks, ?string $tunnel): void
    {
        if ($webhooks === null || ! $tunnel) {
            $this->result('WARN', 'Webhook registration not checked (needs PayMongo and the tunnel)');

            return;
        }
        $expected = "https://$tunnel/api/webhooks/paymongo";
        $paid = collect($webhooks)->filter(fn ($w) => in_array('checkout_session.payment.paid', (array) ($w['attributes']['events'] ?? []), true));
        $match = $paid->first(fn ($w) => rtrim((string) ($w['attributes']['url'] ?? ''), '/') === $expected);
        if ($match && ($match['attributes']['status'] ?? 'enabled') === 'enabled') {
            $this->result('PASS', "PayMongo webhook registered for $expected");

            return;
        }
        $registered = $paid->map(fn ($w) => ($w['attributes']['url'] ?? '?').' ('.($w['attributes']['status'] ?? '?').')')->implode(', ') ?: 'none';
        $this->result('FAIL', "No enabled PayMongo webhook for $expected (registered: $registered)",
            'By hand: dashboard.paymongo.com (Test mode) → Developers → Webhooks → edit the endpoint (or add one) with URL '.$expected
            .' and event checkout_session.payment.paid; if PayMongo shows a new secret, put it in PAYMONGO_WEBHOOK_SECRET in backend/.env and restart the API.');
    }

    /**
     * No placeholder branch name ("Branch A/B/C") may remain in the demo data or in what the system shows (screens, emails, PDFs,
     * the assistant). Checks the database and the shipped source; RealBranchSeeder (which maps the placeholders) and tests are skipped.
     */
    private function placeholderBranches(): void
    {
        $found = [];
        try {
            foreach (DB::table('branches')->pluck('name') as $name) if (preg_match('/^Branch [ABC]$/', (string) $name)) $found[] = "branch \"$name\"";
            if (DB::table('persons')->where(fn ($q) => $q->where('first_name', '~', 'Branch [ABC]\\M')->orWhere('last_name', '~', 'Branch [ABC]\\M'))->exists()) $found[] = 'a person named after a placeholder branch';
        } catch (\Throwable) {
            $found[] = 'the database could not be read';
        }
        $root = dirname(base_path());
        foreach (['src', 'backend/app', 'backend/resources', 'backend/database', 'public'] as $dir) {
            if (! is_dir("$root/$dir")) continue;
            $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator("$root/$dir", \FilesystemIterator::SKIP_DOTS));
            foreach ($files as $file) {
                $path = $file->getPathname();
                if (! preg_match('/\\.(php|js|jsx|mjs|html|json|css)$/', $path) || str_ends_with($path, 'RealBranchSeeder.php') || str_ends_with($path, 'DemoCheck.php')) continue;
                if (preg_match('/\\bBranch [ABC]\\b/', (string) file_get_contents($path))) $found[] = substr($path, strlen($root) + 1);
            }
        }
        $found
            ? $this->result('FAIL', 'Placeholder branch names remain', implode(', ', array_slice($found, 0, 6)).'. Replace them with the real branch names (RealBranchSeeder::REAL).')
            : $this->result('PASS', 'Real branch names everywhere (no "Branch A/B/C")');
    }

    /** Every open branch needs a real phone and per-day hours (FAIL); a missing email or a ZIP-less address is a WARN (open items). */
    private function branchContacts(): void
    {
        try {
            $branches = \App\Models\Branch::where('status', 'Open')->orderBy('legacy_ref')->get();
        } catch (\Throwable) {
            $this->result('FAIL', 'Branches could not be read');

            return;
        }
        $missing = $branches->filter(fn ($b) => ! $b->phone || in_array($b->phone, \Database\Seeders\RealBranchSeeder::PLACEHOLDER_PHONES, true) || ! is_array($b->weekly_hours) || ! $b->weekly_hours);
        $missing->isNotEmpty()
            ? $this->result('FAIL', 'Branch phone or opening hours missing or placeholder: '.$missing->pluck('name')->implode(', '), 'Enter the clinic\'s phone and hours in Administration → Branches, or run the RealBranchSeeder on the demo database.')
            : $this->result('PASS', 'Every branch has a real phone and opening hours ('.$branches->count().')');
        foreach ($branches->filter(fn ($b) => ! $b->email) as $b) $this->result('WARN', "{$b->name}: no email on file", 'Open item: ask the clinic for this branch\'s email (it is hidden wherever an email would show).');
    }

    private function demoData(): void
    {
        try {
            $patients = Patient::count();
            $ready = Invoice::where('status', 'Issued')->whereRaw('patient_responsibility_amount > paid_amount')->with('patient.user')->orderByDesc('id')->first();
            $settings = DB::table('clinic_settings')->count();
        } catch (\Throwable) {
            $this->result('FAIL', 'Demo database not ready (tables missing)', 'Run scripts/demo-start.sh once (it migrates and seeds the demo database).');

            return;
        }
        $patients >= 5 ? $this->result('PASS', "Demo data: $patients patients") : $this->result('FAIL', "Only $patients patient(s)", 'Seed the demo: (cd backend && DB_DATABASE=dental_clinic_demo php artisan db:seed --class=DemoClinicSeeder).');
        $ready ? $this->result('PASS', "Unpaid invoice ready to pay: {$ready->invoice_number} (PHP {$ready->patient_responsibility_amount}) for ".($ready->patient?->user?->email ?? 'the demo patient'))
            : $this->result('FAIL', 'No unpaid invoice to pay', 'Issue one: scripts/payment-test.sh invoice <demo patient email>.');
        $settings ? $this->result('PASS', "Clinic branding settings stored ($settings)") : $this->result('WARN', 'No clinic settings stored (defaults are used)', 'Run: php artisan db:seed --class=ClinicSettingsSeeder.');
    }

    private function assistant(): void
    {
        $setting = (string) config('assistant.mode');
        if (app(\App\Services\Assistant\AssistantService::class)->mode() === 'ai') {
            $this->result('PASS', 'Assistant: AI mode (model '.config('assistant.model').'; key present, value not shown; ASSISTANT_MODE='.$setting.')');
        } elseif ($setting === 'ai') {
            $this->result('WARN', 'Assistant: knowledge mode, although ASSISTANT_MODE=ai', 'No ANTHROPIC_API_KEY is set, so it answers from the clinic\'s answers and records. Add the key, or set ASSISTANT_MODE=knowledge.');
        } else {
            $this->result('PASS', 'Assistant: knowledge mode (answers from the clinic\'s own answers and records; nothing leaves the server)');
        }
        try {
            $active = \App\Models\AssistantAnswer::where('active', true)->count();
            $drafts = \App\Models\AssistantAnswer::where('active', true)->where('draft', true)->count();
            $active === 0 ? $this->result('WARN', 'Assistant answers: none active', 'Seed them: php artisan db:seed --class=AssistantAnswerSeeder (demo database).')
                : ($drafts ? $this->result('WARN', "Assistant answers: {$active} active, {$drafts} draft(s) still to be confirmed by the clinic", 'Administration → Assistant answers.')
                    : $this->result('PASS', "Assistant answers: {$active} active, all confirmed"));
        } catch (\Throwable) {
            $this->result('FAIL', 'Assistant answers table missing', 'Run the migrations on the demo database.');
        }
    }

    private function queue(): void
    {
        $jobs = DB::table('jobs')->count();
        $failed = DB::table('failed_jobs')->count();
        $due = DB::table('mail_dispatches')->whereIn('status', ['pending', 'retry_scheduled'])->count();
        $jobs === 0 ? $this->result('PASS', 'Queue empty') : $this->result('WARN', "$jobs job(s) waiting in the queue", 'They run as soon as the queue worker is up.');
        $failed === 0 ? $this->result('PASS', 'No failed jobs') : $this->result('WARN', "$failed failed job(s)", 'Inspect with: php artisan queue:failed');
        $due === 0 ? $this->result('PASS', 'No email waiting to be sent') : $this->result('WARN', "$due email(s) waiting to be sent", 'The scheduler sends them within a minute (php artisan schedule:work).');
    }

    /** Every automation has its settings row; the enabled ones ran recently (the scheduler really runs them); no email is stuck. */
    private function automations(): void
    {
        try {
            $rows = DB::table('automation_settings')->get()->keyBy('key');
        } catch (\Throwable $e) {
            $this->result('FAIL', 'Automation settings could not be read', 'Run the migrations on the demo database: DB_DATABASE=dental_clinic_demo php artisan migrate.');

            return;
        }
        $missing = array_diff(\App\Services\Automations\AutomationCatalog::KEYS, $rows->keys()->all());
        $missing ? $this->result('FAIL', 'Automation setting rows missing: '.implode(', ', $missing), 'Run the migrations (2026_10_27_000100_create_automation_settings_and_deliveries inserts them).')
            : $this->result('PASS', 'Every automation has a setting row ('.$rows->where('enabled', true)->count().' of '.$rows->count().' on)');
        // Interview round 2: nothing may send unapproved wording, and no unverified HMO is shown to patients.
        $unapproved = $rows->filter(fn ($r) => $r->enabled && \App\Services\Automations\MessageTemplates::unapprovedFor($r->key))->keys();
        $unapproved->isEmpty() ? $this->result('PASS', 'Automations with unapproved wording are off')
            : $this->result('FAIL', 'On with unapproved wording: '.$unapproved->implode(', '), 'Approve the wording in Administration → Automations, or switch these off.');
        $leak = collect(\App\Http\Controllers\AcceptedHmoController::publicList())->pluck('name')
            ->diff(DB::table('accepted_hmos')->where('verified_by_clinic', true)->where('active', true)->pluck('name'));
        $unverified = DB::table('accepted_hmos')->where('verified_by_clinic', false)->count();
        $leak->isEmpty() ? $this->result('PASS', "No unverified HMO shown publicly ($unverified waiting for the Owner to verify)")
            : $this->result('FAIL', 'Unverified HMO shown publicly: '.$leak->implode(', '), 'Only verified HMOs may appear on the website, FAQ and assistant.');
        $stale = $rows->filter(fn ($r) => ! \App\Services\Automations\AutomationCatalog::isPolicy($r->key) && $r->enabled && (! $r->last_run_at || \Carbon\CarbonImmutable::parse($r->last_run_at)->lt(now()->subMinutes(3))))->keys();
        if (\App\Support\SyntheticRuntime::active()) {
            $this->result('WARN', 'Synthetic schedule runs mail only; clinical and financial automations are not accepted by this check.');
        } else {
            $stale->isEmpty() ? $this->result('PASS', 'Automations ran in the last 3 minutes')
                : $this->result('FAIL', 'Automations not run recently: '.$stale->implode(', '), 'Start the scheduler (scripts/demo-start.sh), or run once: php artisan automations:run.');
        }
        $timeout = max(60, (int) config('clinic.mail_processing_timeout_seconds', 600));
        $stuck = DB::table('mail_dispatches')->where(fn ($q) => $q->where('status', 'processing')->where('locked_at', '<', now()->subSeconds($timeout)->toIso8601String()))
            ->orWhere(fn ($q) => $q->whereIn('status', ['pending', 'retry_scheduled'])->where(fn ($t) => $t->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<', now()->subMinutes(10)->toIso8601String()))
                ->where('created_at', '<', now()->subMinutes(10)->toIso8601String()))->count();
        $stuck === 0 ? $this->result('PASS', 'No stuck email in the outbox')
            : $this->result('FAIL', "$stuck email(s) stuck in the outbox for more than 10 minutes", 'Check the queue worker and scheduler; then php artisan mail:process-due.');
    }
}

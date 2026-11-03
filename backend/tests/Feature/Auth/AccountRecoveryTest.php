<?php

namespace Tests\Feature\Auth;

use App\Enums\Role;
use App\Mail\OneTimeCodeMail;
use App\Mail\SecurityNoticeMail;
use App\Models\AuditLog;
use App\Models\EmailVerificationOtp;
use App\Models\MailDispatch;
use App\Models\Person;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** M1 Priority 1: registration anti-enumeration, send caps, queued once-only codes, password reset and email change. */
class AccountRecoveryTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
    }

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'first_name' => 'Jamie', 'last_name' => 'Cruz', 'email' => 'jamie@example.com', 'phone' => '+14155550123',
            'date_of_birth' => '1995-04-12', 'password' => 'Passw0rd!', 'password_confirmation' => 'Passw0rd!',
        ], $overrides);
    }

    private function account(Role $role = Role::Patient, array $attributes = []): User
    {
        $user = User::factory()->role($role)->create($attributes + ['password' => Hash::make('Passw0rd!')]);

        return $user->fresh();
    }

    /** The code of the newest OneTimeCodeMail sent to $to (Mail::fake keeps it; the database never does). */
    private function codeSentTo(string $to): string
    {
        return Mail::sent(OneTimeCodeMail::class, fn ($m) => $m->hasTo($to))->last()->code;
    }

    private function clearLimits(string $email): void
    {
        RateLimiter::clear('otp-send:day:account:'.sha1($email));
        RateLimiter::clear('otp-send:day:reset:'.sha1($email));
        RateLimiter::clear('otp-send:hour:'.sha1($email.'|127.0.0.1'));
    }

    // ---- registration enumeration ---------------------------------------------------------------------------

    public function test_an_existing_email_gets_the_identical_answer_and_its_owner_gets_a_notice_instead(): void
    {
        $existing = $this->account();
        $new = $this->postJson('/api/register', $this->payload(['email' => 'brand.new@example.com', 'phone' => '+639171234567']))->assertCreated();
        $dup = $this->postJson('/api/register', $this->payload(['email' => strtoupper($existing->email), 'password' => 'Other1234', 'password_confirmation' => 'Other1234']))->assertCreated();

        $shape = fn ($r) => [$r->status(), array_keys($r->json()), array_keys($r->json('data')), $r->json('data.verification_required')];
        $this->assertSame($shape($new), $shape($dup));
        $this->assertSame(1, User::where('email', $existing->email)->count(), 'no second account');
        $this->assertTrue(Hash::check('Passw0rd!', $existing->fresh()->password), 'the submitted password is discarded');
        Mail::assertSent(SecurityNoticeMail::class, fn ($m) => $m->hasTo($existing->email) && $m->kind === 'registration_attempt');
        Mail::assertNotSent(OneTimeCodeMail::class, fn ($m) => $m->hasTo($existing->email));
        $audit = AuditLog::where('action', 'account.registration_attempt_existing')->sole();
        $this->assertSame(['has_usable_account' => true], $audit->payload);
        $this->assertStringNotContainsString($existing->email, json_encode($audit->payload));
    }

    public function test_an_email_on_file_without_a_usable_account_gets_the_contact_the_clinic_notice(): void
    {
        Person::create(['first_name' => 'Walk', 'last_name' => 'In', 'email' => 'walkin@example.com', 'phone' => '+639170000001']);
        $suspended = $this->account(Role::Patient, ['account_status' => 'Suspended']);
        foreach (['walkin@example.com', $suspended->email] as $email) {
            $this->postJson('/api/register', $this->payload(['email' => $email]))->assertCreated();
            Mail::assertSent(SecurityNoticeMail::class, fn ($m) => $m->hasTo($email) && $m->kind === 'registration_attempt_record');
        }
        $this->assertSame(0, User::where('email', 'walkin@example.com')->count());
    }

    // ---- caps -------------------------------------------------------------------------------------------------

    public function test_daily_cap_of_ten_per_email_counts_reset_and_account_sends_separately(): void
    {
        $user = $this->account();
        config(['clinic.otp_hourly_per_email_ip' => 100]);
        // An attacker floods registration attempts for the address from many IPs: the account bucket fills…
        for ($i = 0; $i < 10; $i++) {
            $this->withServerVariables(['REMOTE_ADDR' => "10.1.0.$i"])->postJson('/api/register', $this->payload(['email' => $user->email]))->assertCreated();
        }
        $this->withServerVariables(['REMOTE_ADDR' => '10.1.0.99'])->postJson('/api/register', $this->payload(['email' => $user->email]))
            ->assertStatus(429)->assertJsonPath('code', 'otp_rate_limited');
        // …but the owner can still reset the password (separate bucket).
        $this->withServerVariables(['REMOTE_ADDR' => '10.9.0.1'])->postJson('/api/password/forgot', ['email' => $user->email])->assertOk();
        Mail::assertSent(OneTimeCodeMail::class, fn ($m) => $m->hasTo($user->email) && $m->purpose === 'password_reset');

        // The reverse: a flooded reset bucket does not block registration or email-change sends for another address.
        for ($i = 0; $i < 9; $i++) {
            $this->travel(61)->seconds();
            $this->withServerVariables(['REMOTE_ADDR' => "10.2.0.$i"])->postJson('/api/password/forgot', ['email' => $user->email])->assertOk();
        }
        $this->travel(61)->seconds();
        $this->withServerVariables(['REMOTE_ADDR' => '10.2.0.99'])->postJson('/api/password/forgot', ['email' => $user->email])->assertStatus(429);
        $this->postJson('/api/register', $this->payload(['email' => 'someone.new@example.com', 'phone' => '+639171234567']))->assertCreated();
        // An address with no account is limited the same way, so the limit reveals nothing either.
        for ($i = 0; $i < 11; $i++) $last = $this->postJson('/api/password/forgot', ['email' => 'nobody@example.com']);
        $last->assertStatus(429);
        $this->travel(1)->days();
        $this->postJson('/api/password/forgot', ['email' => $user->email])->assertOk();
    }

    public function test_hourly_cap_per_email_and_ip(): void
    {
        $user = $this->account();
        for ($i = 0; $i < 5; $i++) {
            $this->travel(61)->seconds();
            $this->postJson('/api/password/forgot', ['email' => $user->email])->assertOk();
        }
        $this->postJson('/api/password/forgot', ['email' => $user->email])->assertStatus(429);
        $this->withServerVariables(['REMOTE_ADDR' => '10.9.9.9'])->postJson('/api/password/forgot', ['email' => $user->email])->assertOk();
    }

    // ---- queued, once, after commit -----------------------------------------------------------------------------

    public function test_codes_are_queued_encrypted_after_commit_and_sent_once(): void
    {
        config(['queue.default' => 'database']);
        $this->postJson('/api/register', $this->payload())->assertCreated();
        Mail::assertNothingSent();
        $job = DB::table('jobs')->where('queue', 'mail')->sole();
        $otp = EmailVerificationOtp::sole();
        $this->assertStringNotContainsString('jamie@example.com', $job->payload, 'the queued payload is encrypted');
        $dispatch = MailDispatch::where('purpose', 'patient_email_verification')->sole();
        $this->assertSame(['pending', false, 1], [$dispatch->status, $dispatch->retryable, $dispatch->max_attempts]);

        $this->artisan('queue:work', ['connection' => 'database', '--queue' => 'mail', '--once' => true, '--stop-when-empty' => true]);
        Mail::assertSent(OneTimeCodeMail::class, fn ($m) => $m->hasTo('jamie@example.com') && Hash::check($m->code, $otp->digest));
        $this->assertSame('logged_only', $dispatch->fresh()->status);
        $this->assertSame(0, DB::table('jobs')->count());
        $this->assertSame(0, DB::table('failed_jobs')->count());
        $this->assertSame([], app(\App\Services\Mail\MailOutbox::class)->processDue(), 'the sweeper never retries a code');
    }

    public function test_a_failed_send_is_recorded_once_and_never_copied_to_failed_jobs(): void
    {
        config(['queue.default' => 'database']);
        $this->postJson('/api/register', $this->payload())->assertCreated();
        Mail::shouldReceive('to')->andThrow(new \RuntimeException('smtp down'));
        $this->artisan('queue:work', ['connection' => 'database', '--queue' => 'mail', '--once' => true, '--stop-when-empty' => true]);
        $dispatch = MailDispatch::sole();
        $this->assertSame(['failed', 1, 'not_retryable'], [$dispatch->status, $dispatch->attempts, $dispatch->failure_reason]);
        $this->assertSame(0, DB::table('failed_jobs')->count());
        $this->assertSame(0, DB::table('jobs')->count());
    }

    public function test_a_code_replaced_before_its_job_ran_is_not_sent(): void
    {
        config(['queue.default' => 'database']);
        $this->postJson('/api/register', $this->payload())->assertCreated();
        $this->travel(61)->seconds();
        $this->postJson('/api/register/resend', ['email' => 'jamie@example.com'])->assertOk();
        // The worker shares PHPUnit's process: its default 128 MB budget can stop it
        // after the first job in the full suite. Match phpunit.xml's process budget.
        $this->artisan('queue:work', ['connection' => 'database', '--queue' => 'mail', '--stop-when-empty' => true, '--memory' => 1024])->assertSuccessful();
        $this->assertSame(['superseded', 'logged_only'], MailDispatch::orderBy('id')->pluck('status')->all());
        Mail::assertSent(OneTimeCodeMail::class, 1);
        $this->assertSame(0, DB::table('jobs')->count());
        $this->assertSame(0, DB::table('failed_jobs')->count());
    }

    public function test_a_rolled_back_registration_queues_nothing(): void
    {
        config(['queue.default' => 'database']);
        $this->postJson('/api/register', $this->payload())->assertCreated();
        // A second person whose phone matches is refused inside the transaction: no account, no intent, no job.
        $this->postJson('/api/register', $this->payload(['email' => 'other@example.com']))->assertStatus(422);
        $this->assertSame(1, MailDispatch::count());
        $this->assertSame(1, DB::table('jobs')->count());
    }

    public function test_production_without_a_real_transport_refuses_before_writing_anything(): void
    {
        $this->withoutMiddleware(\Illuminate\Foundation\Http\Middleware\ValidateCsrfToken::class); // CSRF is only skipped automatically under 'testing'
        $this->app->instance('env', 'production');
        config(['mail.default' => 'log']);
        try {
            $this->postJson('/api/register', $this->payload())->assertStatus(503)->assertJsonPath('code', 'email_delivery_failed');
        } finally {
            $this->app->instance('env', 'testing');
        }
        $this->assertSame([0, 0, 0], [User::count(), Person::count(), MailDispatch::count()]);
    }

    // ---- password reset ---------------------------------------------------------------------------------------

    public function test_forgot_gives_one_answer_for_known_and_unknown_emails(): void
    {
        $user = $this->account();
        $known = $this->postJson('/api/password/forgot', ['email' => $user->email])->assertOk();
        $unknown = $this->postJson('/api/password/forgot', ['email' => 'nobody@example.com'])->assertOk();
        $this->assertSame($known->json('message'), $unknown->json('message'));
        $this->assertSame(array_keys($known->json('data')), array_keys($unknown->json('data')));
        Mail::assertSent(OneTimeCodeMail::class, 1);
        Mail::assertSent(OneTimeCodeMail::class, fn ($m) => $m->hasTo($user->email) && $m->purpose === 'password_reset');
    }

    public function test_reset_with_the_code_changes_the_password_signs_out_and_sends_a_notice(): void
    {
        $user = $this->account();
        DB::table('sessions')->insert(['id' => 'old-session', 'user_id' => $user->id, 'payload' => '', 'last_activity' => time()]);
        $version = $user->auth_version;
        $this->postJson('/api/password/forgot', ['email' => $user->email])->assertOk();
        $code = $this->codeSentTo($user->email);

        $this->postJson('/api/password/reset', ['email' => $user->email, 'otp' => $code, 'password' => 'NewPassw0rd', 'password_confirmation' => 'NewPassw0rd'])->assertOk();
        $fresh = $user->fresh();
        $this->assertTrue(Hash::check('NewPassw0rd', $fresh->password));
        $this->assertGreaterThan($version, $fresh->auth_version);
        $this->assertSame(0, DB::table('sessions')->where('user_id', $user->id)->count());
        Mail::assertSent(SecurityNoticeMail::class, fn ($m) => $m->hasTo($user->email) && $m->kind === 'password_changed');
        $this->postJson('/api/password/reset', ['email' => $user->email, 'otp' => $code, 'password' => 'Again1234x', 'password_confirmation' => 'Again1234x'])
            ->assertStatus(422)->assertJsonPath('code', 'invalid_otp'); // single use (one generic answer)
        $this->postJson('/api/login', ['email' => $user->email, 'password' => 'NewPassw0rd'])->assertOk();
        $this->assertSame(['auth.password_reset_requested', 'auth.password_reset_completed'],
            AuditLog::whereIn('action', ['auth.password_reset_requested', 'auth.password_reset_completed'])->orderBy('id')->pluck('action')->all());
        $this->assertStringNotContainsString($code, AuditLog::all()->toJson());
    }

    public function test_reset_rejects_wrong_expired_and_exhausted_codes_and_unknown_accounts(): void
    {
        $user = $this->account();
        $this->postJson('/api/password/forgot', ['email' => $user->email]);
        $code = $this->codeSentTo($user->email);
        $wrong = $code === '000000' ? '111111' : '000000';
        $body = fn ($otp, $email = null) => ['email' => $email ?? $user->email, 'otp' => $otp, 'password' => 'NewPassw0rd', 'password_confirmation' => 'NewPassw0rd'];
        // Unknown email, wrong code, exhausted code and expired code all get the identical answer (no account enumeration).
        $unknown = $this->postJson('/api/password/reset', $body($code, 'nobody@example.com'))->assertStatus(422)->json();
        for ($i = 0; $i < 5; $i++) $this->assertSame($unknown, $this->postJson('/api/password/reset', $body($wrong))->assertStatus(422)->json());
        $this->assertSame($unknown, $this->postJson('/api/password/reset', $body($code))->assertStatus(422)->json(), 'the 5 wrong tries used the code up');
        $this->assertNotNull(EmailVerificationOtp::where('purpose', 'password_reset')->sole()->consumed_at);
        $this->assertTrue(Hash::check('Passw0rd!', $user->fresh()->password));

        $this->travel(61)->seconds();
        $this->postJson('/api/password/forgot', ['email' => $user->email]);
        $code = $this->codeSentTo($user->email);
        $this->travel(11)->minutes();
        $this->assertSame($unknown, $this->postJson('/api/password/reset', $body($code))->assertStatus(422)->json());
    }

    public function test_a_new_code_invalidates_the_previous_one(): void
    {
        $user = $this->account();
        $this->postJson('/api/password/forgot', ['email' => $user->email]);
        $first = $this->codeSentTo($user->email);
        $this->postJson('/api/password/forgot', ['email' => $user->email])->assertOk(); // inside the 60 s wait: no new code
        $this->assertSame(1, EmailVerificationOtp::count());
        $this->travel(61)->seconds();
        $this->postJson('/api/password/forgot', ['email' => $user->email]);
        $second = $this->codeSentTo($user->email);
        if ($first !== $second) {
            $this->postJson('/api/password/reset', ['email' => $user->email, 'otp' => $first, 'password' => 'NewPassw0rd', 'password_confirmation' => 'NewPassw0rd'])->assertStatus(422);
        }
        $this->postJson('/api/password/reset', ['email' => $user->email, 'otp' => $second, 'password' => 'NewPassw0rd', 'password_confirmation' => 'NewPassw0rd'])->assertOk();
    }

    public function test_employees_can_reset_but_invited_and_suspended_accounts_get_no_code(): void
    {
        $staff = $this->account(Role::Staff);
        $invited = $this->account(Role::Dentist, ['account_status' => 'Invited']);
        $suspended = $this->account(Role::Patient, ['account_status' => 'Suspended']);
        foreach ([$staff, $invited, $suspended] as $user) $this->postJson('/api/password/forgot', ['email' => $user->email])->assertOk();
        Mail::assertSent(OneTimeCodeMail::class, 1);
        $this->postJson('/api/password/reset', ['email' => $staff->email, 'otp' => $this->codeSentTo($staff->email), 'password' => 'NewPassw0rd', 'password_confirmation' => 'NewPassw0rd'])->assertOk();
        $this->postJson('/api/login', ['email' => $staff->email, 'password' => 'NewPassw0rd'])->assertOk();
    }

    public function test_reset_verifies_an_unverified_patient_because_the_code_proves_the_inbox(): void
    {
        $user = $this->account(Role::Patient, ['email_verified_at' => null]);
        $this->postJson('/api/password/forgot', ['email' => $user->email]);
        $this->postJson('/api/password/reset', ['email' => $user->email, 'otp' => $this->codeSentTo($user->email), 'password' => 'NewPassw0rd', 'password_confirmation' => 'NewPassw0rd'])->assertOk();
        $this->assertNotNull($user->fresh()->email_verified_at);
    }

    // ---- email change -----------------------------------------------------------------------------------------

    public function test_email_change_needs_the_password_then_a_code_sent_to_the_new_address(): void
    {
        $user = $this->account();
        $old = $user->email;
        Sanctum::actingAs($user);
        $this->postJson('/api/account/email', ['new_email' => 'moved@example.com', 'current_password' => 'wrong'])->assertStatus(422)->assertJsonPath('code', 'invalid_password');
        $this->postJson('/api/account/email', ['new_email' => $old, 'current_password' => 'Passw0rd!'])->assertStatus(422)->assertJsonPath('code', 'same_email');
        Mail::assertNothingSent();

        $this->postJson('/api/account/email', ['new_email' => 'Moved@Example.com', 'current_password' => 'Passw0rd!'])->assertOk();
        $code = $this->codeSentTo('moved@example.com');
        Mail::assertNotSent(OneTimeCodeMail::class, fn ($m) => $m->hasTo($old));
        $this->assertSame($old, $user->fresh()->email, 'nothing changes before the code is confirmed');

        $this->postJson('/api/account/email/confirm', ['otp' => $code])->assertOk()->assertJsonPath('data.email', 'moved@example.com');
        $fresh = $user->fresh();
        $this->assertSame(['moved@example.com', 'moved@example.com'], [$fresh->email, $fresh->person->email]);
        $this->assertNotNull($fresh->email_verified_at);
        $this->assertGreaterThan($user->auth_version, $fresh->auth_version, 'every session is signed out');
        Mail::assertSent(SecurityNoticeMail::class, fn ($m) => $m->hasTo($old) && $m->kind === 'email_changed' && ! str_contains($m->render(), 'moved@example.com'));
        $this->assertSame(['account.email_change_requested', 'account.email_changed'], AuditLog::whereIn('action', ['account.email_change_requested', 'account.email_changed'])->orderBy('id')->pluck('action')->all());
    }

    public function test_wrong_current_passwords_are_limited_per_account(): void
    {
        $user = $this->account();
        Sanctum::actingAs($user);
        for ($i = 0; $i < 5; $i++) {
            $this->withServerVariables(['REMOTE_ADDR' => "10.3.0.$i"])->postJson('/api/account/email', ['new_email' => 'x@example.com', 'current_password' => "wrong$i"])->assertStatus(422);
        }
        $this->postJson('/api/account/email', ['new_email' => 'x@example.com', 'current_password' => 'Passw0rd!'])->assertStatus(429);
        Mail::assertNothingSent();
    }

    public function test_an_address_in_use_gets_the_same_answer_but_no_code(): void
    {
        $user = $this->account();
        $other = $this->account();
        Sanctum::actingAs($user);
        $taken = $this->postJson('/api/account/email', ['new_email' => $other->email, 'current_password' => 'Passw0rd!'])->assertOk();
        $this->travel(61)->seconds();
        $free = $this->postJson('/api/account/email', ['new_email' => 'free@example.com', 'current_password' => 'Passw0rd!'])->assertOk();
        $this->assertSame($taken->json('message'), $free->json('message'));
        Mail::assertNotSent(OneTimeCodeMail::class, fn ($m) => $m->hasTo($other->email));
        Mail::assertSent(OneTimeCodeMail::class, 1);
        $this->assertSame(1, EmailVerificationOtp::where('purpose', 'email_change')->count());
    }

    public function test_a_reset_code_sent_to_the_old_address_dies_when_the_email_changes(): void
    {
        $user = $this->account();
        $this->postJson('/api/password/forgot', ['email' => $user->email])->assertOk();
        $resetCode = $this->codeSentTo($user->email);
        Sanctum::actingAs($user);
        $this->postJson('/api/account/email', ['new_email' => 'moved@example.com', 'current_password' => 'Passw0rd!'])->assertOk();
        $this->postJson('/api/account/email/confirm', ['otp' => $this->codeSentTo('moved@example.com')])->assertOk();
        $this->postJson('/api/password/reset', ['email' => 'moved@example.com', 'otp' => $resetCode, 'password' => 'Hijack1234', 'password_confirmation' => 'Hijack1234'])
            ->assertStatus(422);
        $this->assertTrue(Hash::check('Passw0rd!', $user->fresh()->password));
        $this->assertSame(0, EmailVerificationOtp::where('user_id', $user->id)->whereNull('consumed_at')->count());
    }

    public function test_an_email_change_code_cannot_reset_a_password_or_verify_registration(): void
    {
        $user = $this->account();
        Sanctum::actingAs($user);
        $this->postJson('/api/account/email', ['new_email' => 'moved@example.com', 'current_password' => 'Passw0rd!'])->assertOk();
        $code = $this->codeSentTo('moved@example.com');
        $this->postJson('/api/password/reset', ['email' => $user->email, 'otp' => $code, 'password' => 'NewPassw0rd', 'password_confirmation' => 'NewPassw0rd'])->assertStatus(422);
        $this->assertTrue(Hash::check('Passw0rd!', $user->fresh()->password));
    }

    public function test_three_step_password_reset_flow_with_ticket_otp_verification_and_signed_reset_token(): void
    {
        $user = $this->account();
        $this->clearLimits($user->email);

        // Step 1: POST /api/password/forgot receives session verification ticket
        $res1 = $this->postJson('/api/password/forgot', ['email' => $user->email])->assertOk();
        $ticket = $res1->json('data.ticket');
        $this->assertNotEmpty($ticket);
        $code = $this->codeSentTo($user->email);

        // Step 2: POST /api/password/verify-otp with wrong OTP fails
        $this->postJson('/api/password/verify-otp', ['ticket' => $ticket, 'otp' => '000000'])
            ->assertStatus(422)
            ->assertJsonPath('code', 'invalid_otp');

        // Step 2: POST /api/password/verify-otp with correct OTP returns signed reset token
        $res2 = $this->postJson('/api/password/verify-otp', ['ticket' => $ticket, 'otp' => $code])->assertOk();
        $resetToken = $res2->json('data.reset_token');
        $this->assertNotEmpty($resetToken);

        // Step 3: POST /api/password/reset with signed reset token sets new password
        $this->postJson('/api/password/reset', [
            'reset_token' => $resetToken,
            'password' => 'FreshPass123',
            'password_confirmation' => 'FreshPass123',
        ])->assertOk();

        $this->assertTrue(Hash::check('FreshPass123', $user->fresh()->password));
        $this->postJson('/api/login', ['email' => $user->email, 'password' => 'FreshPass123'])->assertOk();
    }

    // ---- dev preview ------------------------------------------------------------------------------------------

    public function test_every_account_email_has_a_text_part_and_stays_small(): void
    {
        $mails = [
            new OneTimeCodeMail('482913', 'email_verification', 'Maria'), new OneTimeCodeMail('482913', 'password_reset'), new OneTimeCodeMail('482913', 'email_change'),
            new SecurityNoticeMail('registration_attempt'), new SecurityNoticeMail('registration_attempt_record'),
            new SecurityNoticeMail('password_changed', 'Maria', 'October 13, 2026 2:05 PM'), new SecurityNoticeMail('email_changed', null, null, 'mo•••@example.com'),
        ];
        foreach ($mails as $mail) {
            $html = $mail->render();
            $this->assertLessThan(100 * 1024, strlen($html));
            $this->assertStringContainsString('width="600"', $html);
            $this->assertStringNotContainsString('Quezon City', $html, 'no invented branch list');
            $this->assertNotNull($mail->content()->text);
        }
        // One unbroken string (spacing is CSS letter-spacing), so copying the code gives exactly the six digits.
        $this->assertStringContainsString('>482913</div>', $mails[0]->render());
        $this->assertStringNotContainsString('482913', $mails[0]->envelope()->subject, 'the code is never in the subject line');
    }

    public function test_the_preview_route_is_not_available_outside_local(): void
    {
        $this->get('/dev/mail')->assertNotFound(); // routes are registered only when APP_ENV=local
    }
}

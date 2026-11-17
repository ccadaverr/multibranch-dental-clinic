<?php

namespace Tests\Feature\Mail;

use App\Models\Appointment;
use App\Models\MailDispatch;
use App\Models\MailDispatchAttempt;
use App\Models\Patient;
use App\Models\Person;
use App\Models\User;
use App\Services\Mail\MailOutbox;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\Support\IsolatedDatabaseGuard;
use Tests\TestCase;

/** Actual PostgreSQL queue and loopback SMTP capture; no external provider or clinical automation. */
final class QueuedLocalCaptureTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    public function test_claim_code_is_pending_until_worker_capture_and_only_the_received_single_use_code_activates_exact_patient(): void
    {
        $target = IsolatedDatabaseGuard::manifest();
        $this->setUpSchedulingWorld();
        config(['queue.default' => 'database', 'mail.default' => 'local_capture']);
        $recipient = 'claim-'.bin2hex(random_bytes(8)).'@example.test';
        $person = Person::create(['first_name' => 'Synthetic', 'last_name' => 'Queued claim', 'email' => $recipient, 'date_of_birth' => '1980-02-02']);
        $patient = Patient::create(['person_id' => $person->id, 'patient_code' => 'PAT-0099', 'consent' => true]);
        $this->postJson('/api/account/claim', ['email' => $recipient, 'date_of_birth' => '1980-02-02'])->assertCreated();
        $actor = User::where('person_id', $person->id)->sole();
        $this->assertTrue($actor->pending_claim);
        $this->assertNull($actor->email_verified_at);
        $intent = MailDispatch::sole();
        $this->assertSame(['pending', false, 0], [$intent->status, $intent->retryable, $intent->attempts]);
        $captured = fn () => array_filter(glob($target['runtime'].'/mailbox/*.eml') ?: [], fn ($file) => str_contains(file_get_contents($file), $recipient));
        $this->assertCount(0, $captured());
        $this->postJson('/api/login', ['email' => $recipient, 'password' => 'Synthetic123!'])->assertUnprocessable();

        Artisan::call('queue:work', ['connection' => 'database', '--queue' => 'mail', '--once' => true, '--stop-when-empty' => true]);
        $files = $captured();
        $this->assertCount(1, $files);
        $this->assertSame(['logged_only', 'local', 1], [$intent->fresh()->status, $intent->fresh()->transport_kind, $intent->fresh()->attempts]);
        $this->assertNull($intent->fresh()->delivery_confirmed_at);
        preg_match('/Your verification code:\s*(\d{6})/', quoted_printable_decode(file_get_contents(reset($files))), $match);
        $this->assertTrue(isset($match[1]), 'The private synthetic MIME text must contain a verification code.');
        $code = $match[1];
        $verify = ['email' => $recipient, 'otp' => $code, 'password' => 'Synthetic123!', 'password_confirmation' => 'Synthetic123!'];
        $this->postJson('/api/account/claim/verify', [...$verify, 'otp' => $code === '000000' ? '111111' : '000000'])->assertUnprocessable();
        $this->assertTrue($actor->fresh()->pending_claim);
        $this->postJson('/api/account/claim/verify', $verify)->assertOk()->assertJsonPath('data.verified', true);
        $this->assertFalse($actor->fresh()->pending_claim);
        $this->assertSame($patient->id, $actor->fresh()->patient->id);
        $this->postJson('/api/account/claim/verify', $verify)->assertUnprocessable();
        $this->postJson('/api/login', ['email' => $recipient, 'password' => 'Synthetic123!'])->assertOk();
        $this->assertCount(1, $captured());
        $this->assertTrue(!str_contains(json_encode(MailDispatchAttempt::all()->toArray()), $code), 'General attempt history must not store the code.');
    }

    public function test_pending_worker_failure_backoff_and_capture_never_claim_inbox_delivery_or_change_appointment(): void
    {
        $target = IsolatedDatabaseGuard::manifest();
        $this->setUpSchedulingWorld();
        config(['queue.default' => 'database', 'mail.default' => 'local_capture']);
        $recipient = 'queue-'.bin2hex(random_bytes(8)).'@example.test';
        $this->u['patientA']->forceFill(['email' => $recipient])->save();
        $this->p['A']->person->update(['email' => $recipient]);
        $this->actingAsUser('patientA');
        $id = $this->postJson('/api/appointments', ['branch_ref' => 'b1', 'service_ref' => 'svc1', 'date' => '2026-09-30', 'start_time' => '14:00'])
            ->assertCreated()->json('data.id');
        $appointment = Appointment::where('public_id', $id)->sole();
        $original = $appointment->getAttributes();
        $intent = MailDispatch::where('purpose', 'appointment_confirmation')->sole();
        $captured = fn () => array_filter(glob($target['runtime'].'/mailbox/*.eml') ?: [], fn ($file) => str_contains(file_get_contents($file), $recipient));
        $this->assertSame('pending', $intent->status);
        $this->assertSame(0, $intent->attempts);
        $this->assertSame(1, DB::table('jobs')->where('queue', 'mail')->count());
        $this->assertCount(0, $captured());

        $realMailer = $this->app->make('mail.manager');
        Mail::shouldReceive('to')->once()->andThrow(new \RuntimeException('Synthetic capture unavailable; private text must not persist'));
        $work = fn () => Artisan::call('queue:work', ['connection' => 'database', '--queue' => 'mail', '--once' => true, '--stop-when-empty' => true]);
        $work();
        $this->assertSame(['retry_scheduled', 1], [$intent->fresh()->status, $intent->fresh()->attempts]);
        $this->assertSame(['failed'], MailDispatchAttempt::pluck('outcome')->all());
        $this->assertCount(0, $captured());
        $this->assertNull($intent->fresh()->delivery_confirmed_at);
        $this->assertStringNotContainsString('private text', json_encode(MailDispatchAttempt::all()->toArray()));

        Mail::swap($realMailer);
        $this->assertSame([], app(MailOutbox::class)->processDue(), 'Backoff is enforced before another attempt.');
        $this->travel(61)->seconds();
        $work();
        $this->assertSame(['logged_only', 'local', 2], [$intent->fresh()->status, $intent->fresh()->transport_kind, $intent->fresh()->attempts]);
        $this->assertSame(['failed', 'logged_only'], MailDispatchAttempt::orderBy('attempt_no')->pluck('outcome')->all());
        $this->assertCount(1, $captured(), 'One synthetic MIME message reached the real loopback capture.');
        $this->assertNull($intent->fresh()->delivery_confirmed_at, 'Local capture is never third-party or inbox delivery.');
        $this->assertNull(app(MailOutbox::class)->process($intent->id), 'A completed intent cannot be sent again.');
        $this->assertCount(1, $captured());
        $this->assertSame($original, $appointment->fresh()->getAttributes());
        $this->assertSame(0, DB::table('jobs')->where('queue', 'mail')->count());
    }
}

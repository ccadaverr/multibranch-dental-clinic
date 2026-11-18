<?php

namespace Tests\Feature\Mail;

use App\Mail\AppointmentChangedMail;
use App\Mail\AppointmentConfirmationMail;
use App\Models\Appointment;
use App\Models\MailDispatch;
use App\Models\MailDispatchAttempt;
use App\Services\Mail\MailOutbox;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** M18 durable email dispatch: intent in the domain transaction, worker execution, bounded retry, duplicate protection. */
class MailOutboxTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->setUpSchedulingWorld();
    }

    private function book(): Appointment
    {
        $this->actingAsUser('patientA');
        $id = $this->postJson('/api/appointments', ['branch_ref' => 'b1', 'service_ref' => 'svc1', 'date' => '2026-09-30', 'start_time' => '14:00'])->assertCreated()->json('data.id');

        return Appointment::where('public_id', $id)->firstOrFail();
    }

    private function useDatabaseQueue(): void
    {
        config(['queue.default' => 'database']);
    }

    private function work(): void
    {
        Artisan::call('queue:work', ['connection' => 'database', '--queue' => 'mail', '--once' => true, '--stop-when-empty' => true]);
    }

    private function failingMailer(): void
    {
        Mail::shouldReceive('to')->andThrow(new \RuntimeException('smtp down: SECRET'));
    }

    public function test_the_intent_is_durable_minimal_and_recorded_with_every_attempt(): void
    {
        $appointment = $this->book();
        $dispatch = MailDispatch::where('purpose', 'appointment_confirmation')->sole();
        $this->assertSame(['appointment', $appointment->public_id, 1, 'logged_only', 1, true], [$dispatch->subject_type, $dispatch->subject_public_id, $dispatch->subject_revision, $dispatch->status, $dispatch->attempts, $dispatch->retryable]);
        $this->assertSame("appointment_confirmation:{$appointment->public_id}:r1", $dispatch->dedupe_key);
        $this->assertNull($dispatch->delivery_confirmed_at, 'a log mailer never counts as delivery');
        $attempt = MailDispatchAttempt::where('mail_dispatch_id', $dispatch->id)->sole();
        $this->assertSame(['logged_only', 'array', 'local', null], [$attempt->outcome, $attempt->mailer, $attempt->transport_kind, $attempt->error_class]);
        $stored = json_encode([$dispatch->getAttributes(), $attempt->getAttributes()]);
        $this->assertStringNotContainsString($this->u['patientA']->email, $stored, 'no address is stored');
    }

    public function test_the_worker_sends_only_after_commit_from_the_database_queue(): void
    {
        $this->useDatabaseQueue();
        $this->book();
        $dispatch = MailDispatch::sole();
        $this->assertSame('pending', $dispatch->status);
        $this->assertSame(1, DB::table('jobs')->where('queue', 'mail')->count());
        Mail::assertNothingSent();
        $this->work();
        Mail::assertSent(AppointmentConfirmationMail::class, 1);
        $this->assertSame('logged_only', $dispatch->fresh()->status);
        $this->assertSame(0, DB::table('jobs')->count());
    }

    public function test_a_rolled_back_or_refused_change_leaves_no_intent(): void
    {
        $appointment = $this->book();
        $this->actingAsUser('staffB1');
        $this->postJson("/api/appointments/{$appointment->public_id}/cancel", ['expected_revision' => 7])->assertStatus(409);
        try {
            DB::transaction(function () use ($appointment) {
                app(MailOutbox::class)->queue('appointment_cancelled', 'appointment_cancelled:test', $appointment, $appointment->revision, null, null);
                throw new \RuntimeException('domain failure after the intent was written');
            });
        } catch (\RuntimeException) {
        }
        $this->assertSame(['appointment_confirmation'], MailDispatch::pluck('purpose')->all());
        Mail::assertNotSent(AppointmentChangedMail::class);
    }

    public function test_a_transient_failure_is_retried_after_the_backoff_and_then_succeeds(): void
    {
        $this->failingMailer();
        $appointment = $this->book(); // sync queue: the first try runs right after commit and fails
        $dispatch = MailDispatch::sole();
        $this->assertSame(['retry_scheduled', 1], [$dispatch->status, $dispatch->attempts]);
        $this->assertEquals(now()->addSeconds(60)->getTimestamp(), $dispatch->next_attempt_at->getTimestamp());
        $this->assertSame(\RuntimeException::class, MailDispatchAttempt::sole()->error_class, 'class only, never the message');
        $this->assertStringNotContainsString('SECRET', json_encode(MailDispatchAttempt::all()->toArray()));

        // the transport recovers: drop the failing mock and go back to a recording fake
        $this->app->forgetInstance('mail.manager');
        Mail::clearResolvedInstances();
        Mail::fake();
        Artisan::call('mail:process-due');
        $this->assertSame('retry_scheduled', $dispatch->fresh()->status, 'not retried before its time');
        $this->travel(61)->seconds();
        Artisan::call('mail:process-due');
        $fresh = $dispatch->fresh();
        $this->assertSame(['logged_only', 2], [$fresh->status, $fresh->attempts]);
        $this->assertSame(['failed', 'logged_only'], MailDispatchAttempt::orderBy('attempt_no')->pluck('outcome')->all());
        Mail::assertSent(AppointmentConfirmationMail::class, 1);
        $this->assertSame('Confirmed', $appointment->fresh()->status, 'the appointment was never affected');
    }

    public function test_retries_stop_at_the_limit_and_the_message_is_marked_failed(): void
    {
        config(['clinic.mail_max_attempts' => 3]);
        $this->failingMailer();
        $this->book();
        $dispatch = MailDispatch::sole();
        foreach ([61, 301, 901] as $wait) {
            $this->travel($wait)->seconds();
            Artisan::call('mail:process-due');
        }
        $fresh = $dispatch->fresh();
        $this->assertSame(['failed', 3, 'retries_exhausted', null], [$fresh->status, $fresh->attempts, $fresh->failure_reason, $fresh->next_attempt_at]);
        $this->assertSame(3, MailDispatchAttempt::count());
        $this->travel(1)->hours();
        $this->assertSame([], app(MailOutbox::class)->processDue(), 'nothing left to retry');
    }

    public function test_duplicate_jobs_and_duplicate_intents_send_once(): void
    {
        $this->useDatabaseQueue();
        $appointment = $this->book();
        $dispatch = MailDispatch::sole();
        $again = app(MailOutbox::class)->queue('appointment_confirmation', $dispatch->dedupe_key, $appointment, 1, null, null);
        $this->assertSame($dispatch->id, $again->id);
        $this->assertSame(1, DB::table('jobs')->count(), 'a repeated intent dispatches no second job');
        \App\Jobs\SendMailDispatch::dispatch($dispatch->id); // a duplicate job
        $this->assertSame('logged_only', app(MailOutbox::class)->process($dispatch->id));
        $this->assertNull(app(MailOutbox::class)->process($dispatch->id), 'a finished intent cannot be claimed again');
        $this->work(); $this->work();
        Mail::assertSent(AppointmentConfirmationMail::class, 1);
        $this->assertSame(1, MailDispatchAttempt::count());
    }

    public function test_a_claim_held_by_another_worker_is_respected_until_it_goes_stale(): void
    {
        $this->useDatabaseQueue();
        $this->book();
        $dispatch = MailDispatch::sole();
        DB::table('mail_dispatches')->where('id', $dispatch->id)->update(['status' => 'processing', 'locked_at' => now()->toIso8601String()]);
        $this->assertNull(app(MailOutbox::class)->process($dispatch->id));
        $this->travel(601)->seconds(); // the other worker died
        $this->assertSame('logged_only', app(MailOutbox::class)->process($dispatch->id));
    }

    public function test_an_older_message_superseded_by_a_newer_change_is_not_sent(): void
    {
        $this->useDatabaseQueue();
        $appointment = $this->book();
        $this->actingAsUser('staffB1');
        $this->postJson("/api/appointments/{$appointment->public_id}/cancel", ['expected_revision' => 1, 'reason' => 'Synthetic cancellation'])->assertOk();
        $this->work(); $this->work();
        $this->assertSame(['appointment_confirmation' => 'superseded', 'appointment_cancelled' => 'logged_only'], MailDispatch::orderBy('id')->pluck('status', 'purpose')->all());
        Mail::assertNotSent(AppointmentConfirmationMail::class);
        Mail::assertSent(AppointmentChangedMail::class, fn ($m) => $m->change === 'cancelled');
    }

    public function test_attempts_are_append_only_and_delivery_needs_transport_acceptance(): void
    {
        $this->book();
        $cases = [
            'mail_dispatches_delivery_check' => fn () => MailDispatch::sole()->forceFill(['delivery_confirmed_at' => now()])->save(), // logged_only cannot be "delivered"
            'append-only' => fn () => DB::table('mail_dispatch_attempts')->update(['outcome' => 'transport_accepted']),
            'append-only ' => fn () => DB::table('mail_dispatch_attempts')->delete(),
        ];
        foreach ($cases as $expected => $operation) {
            try {
                DB::transaction($operation); // its own savepoint, so each refusal is observed separately
                $this->fail("Expected the database to refuse: $expected");
            } catch (QueryException $e) {
                $this->assertStringContainsString(trim($expected), $e->getMessage());
            }
        }
        $this->assertSame('logged_only', MailDispatchAttempt::sole()->outcome);
    }

    public function test_secret_bearing_mail_is_recorded_but_never_queued_or_retried(): void
    {
        $owner = $this->u['owner'];
        $this->actingAsUser('owner');
        $this->failingMailer();
        $this->postJson('/api/mail/test', ['recipient_email' => 'diag@example.test'])->assertStatus(502);
        $dispatch = MailDispatch::where('purpose', 'mail_diagnostic')->sole();
        $this->assertSame([false, 'failed', 'not_retryable', 1], [$dispatch->retryable, $dispatch->status, $dispatch->failure_reason, $dispatch->max_attempts]);
        $this->travel(1)->hours();
        $this->assertSame([], app(MailOutbox::class)->processDue());
        $this->assertSame($owner->id, $dispatch->created_by_user_id);
    }
}

<?php

namespace Tests\Feature\Appointments;

use App\Mail\AppointmentChangedMail;
use App\Mail\AppointmentConfirmationMail;
use App\Models\Appointment;
use App\Models\AuditLog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/** M18 / PI-29: Patients are emailed when an appointment is booked or changed — after commit, with truthful evidence. */
class AppointmentEmailTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->setUpSchedulingWorld();
    }

    private function bookedByPatient(): Appointment
    {
        $this->actingAsUser('patientA');
        $id = $this->book(['date' => '2026-09-30', 'start_time' => '14:00'])->assertCreated()->json('data.id');

        return Appointment::where('public_id', $id)->firstOrFail();
    }

    public function test_booking_emails_the_slot_time_not_the_render_time(): void
    {
        $appointment = $this->bookedByPatient();
        Mail::assertSent(AppointmentConfirmationMail::class, function (AppointmentConfirmationMail $mail) use ($appointment) {
            $html = $mail->render();
            return $mail->hasTo($this->u['patientA']->email) && $mail->appointment->is($appointment)
                && str_contains($html, 'September 30, 2026') && str_contains($html, '2:00 PM')
                && ! str_contains($html, 'arrive 10') ; // no unapproved arrival-time instruction
        });
        $evidence = AuditLog::where('action', 'mail.dispatched')->where('auditable_public_id', $appointment->public_id)->firstOrFail();
        $this->assertSame('appointment_confirmation', $evidence->payload['purpose']);
        $this->assertSame('logged_only', $evidence->payload['status']);
    }

    public function test_reschedule_and_cancel_email_the_patient_once_each(): void
    {
        $appointment = $this->bookedByPatient();
        $this->actingAsUser('staffB1');
        $this->postJson("/api/appointments/{$appointment->public_id}/reschedule", ['expected_revision' => 1, 'date' => '2026-10-01', 'start_time' => '10:00'], ['Idempotency-Key' => 'r-1'])->assertOk();
        // an idempotent replay returns the stored result and sends nothing again
        $this->postJson("/api/appointments/{$appointment->public_id}/reschedule", ['expected_revision' => 1, 'date' => '2026-10-01', 'start_time' => '10:00'], ['Idempotency-Key' => 'r-1'])->assertOk();
        Mail::assertSent(AppointmentChangedMail::class, fn ($m) => $m->change === 'rescheduled' && str_contains($m->render(), 'October 1, 2026') && str_contains($m->render(), '10:00 AM'));
        Mail::assertSent(AppointmentChangedMail::class, 1);

        $this->postJson("/api/appointments/{$appointment->public_id}/cancel", ['expected_revision' => 2, 'reason' => 'Synthetic cancellation'])->assertOk();
        $this->postJson("/api/appointments/{$appointment->public_id}/cancel", ['expected_revision' => 2, 'reason' => 'Synthetic cancellation'])->assertOk(); // no-op repeat
        Mail::assertSent(AppointmentChangedMail::class, fn ($m) => $m->change === 'cancelled' && $m->hasTo($this->u['patientA']->email));
        Mail::assertSent(AppointmentChangedMail::class, 2);
        $purposes = AuditLog::where('action', 'mail.dispatched')->where('auditable_public_id', $appointment->public_id)->get()->pluck('payload.purpose')->all();
        $this->assertSame(['appointment_confirmation', 'appointment_rescheduled', 'appointment_cancelled'], $purposes);
    }

    public function test_refused_commands_send_nothing(): void
    {
        $appointment = $this->bookedByPatient();
        $this->actingAsUser('staffB1');
        $this->postJson("/api/appointments/{$appointment->public_id}/cancel", ['expected_revision' => 9])->assertStatus(409); // stale revision
        $this->postJson("/api/appointments/{$appointment->public_id}/reschedule", ['expected_revision' => 1, 'date' => '2026-09-29', 'start_time' => '03:00'])->assertStatus(422);
        Mail::assertNotSent(AppointmentChangedMail::class);
    }

    public function test_a_mail_failure_never_fails_the_appointment_command(): void
    {
        $appointment = $this->bookedByPatient();
        Mail::shouldReceive('to')->andThrow(new \RuntimeException('smtp down'));
        $this->actingAsUser('staffB1');
        $this->postJson("/api/appointments/{$appointment->public_id}/cancel", ['expected_revision' => 1, 'reason' => 'Synthetic cancellation'])->assertOk()->assertJsonPath('data.status', 'Cancelled');
        $this->assertSame('failed', AuditLog::where('action', 'mail.dispatched')->latest('id')->first()->payload['status']);
    }
}

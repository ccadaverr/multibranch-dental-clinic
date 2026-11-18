<?php

namespace Tests\Feature\Appointments;

use App\Mail\AppointmentReminderMail;
use App\Models\Appointment;
use App\Models\AppointmentResponse;
use App\Models\AuditLog;
use App\Services\Intake\Guardianship;
use App\Support\ActionLink;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class CancellationRefundSafetyTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->travelTo(CarbonImmutable::parse('2026-09-28 10:00:00', 'Asia/Manila'));
        Mail::fake();
        Http::preventStrayRequests();
        config([
            'services.paymongo.secret_key' => 'sk'.'_test_fixture',
            'services.paymongo.base_url' => 'https://refund.example.test',
            'services.paymongo.mode' => 'test',
        ]);
    }

    private function paidBooking(): Appointment
    {
        $appointment = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-30', '10:00');
        $appointment->update([
            'booking_payment_status' => 'paid', 'booking_payment_ref' => 'pay_fixture',
            'booking_paid_at' => now(), 'booking_fee_php' => '600.00',
        ]);

        return $appointment;
    }

    private function cancelRequest(Appointment $appointment, string $key = 'refund-safety-cancellation')
    {
        return $this->postJson("/api/appointments/{$appointment->public_id}/cancel", [
            'expected_revision' => 1, 'reason' => 'Schedule conflict',
        ], ['Idempotency-Key' => $key]);
    }

    public function test_failed_refund_returns_cancelled_with_unconfirmed_refund_and_no_repeat_post(): void
    {
        $booking = $this->paidBooking();
        Http::fake(['https://refund.example.test/v1/refunds' => Http::response([], 503)]);
        $this->actingAsUser('patientA');

        $this->cancelRequest($booking)->assertOk()->assertJsonPath('data.status', 'Cancelled')
            ->assertJsonPath('data.cancellation_refund.status', 'unconfirmed');
        $this->cancelRequest($booking)->assertOk()->assertHeader('Idempotent-Replayed', 'true')
            ->assertJsonPath('data.cancellation_refund.status', 'unconfirmed');
        $this->cancelRequest($booking, 'different-key')->assertOk();
        Http::assertSentCount(1);
        $booking->refresh();
        $this->assertSame('paid', $booking->booking_payment_status);
        $this->assertNull($booking->booking_refunded_at);
        $this->assertSame(1, AuditLog::where('action', 'billing.booking_refund_unconfirmed')->count());
    }

    public function test_known_pending_refund_uses_authoritative_get_on_retry_and_never_posts_again(): void
    {
        $booking = $this->paidBooking();
        Http::fake([
            'https://refund.example.test/v1/refunds' => Http::response(['data' => ['id' => 'ref_fixture', 'attributes' => ['status' => 'pending', 'amount' => 60000]]]),
            'https://refund.example.test/v1/refunds/ref_fixture' => Http::response(['data' => ['id' => 'ref_fixture', 'attributes' => ['status' => 'succeeded', 'amount' => 60000]]]),
        ]);
        $this->actingAsUser('patientA');
        $this->cancelRequest($booking)->assertOk()->assertJsonPath('data.cancellation_refund.status', 'unconfirmed');
        $this->cancelRequest($booking)->assertOk()->assertJsonPath('data.cancellation_refund.status', 'refunded');
        $this->cancelRequest($booking)->assertOk()->assertJsonPath('data.cancellation_refund.status', 'refunded');
        Http::assertSentCount(2);
        $requests = Http::recorded();
        $this->assertSame('POST', $requests[0][0]->method());
        $this->assertSame('GET', $requests[1][0]->method());
        $this->assertNotNull($booking->fresh()->booking_refunded_at);
    }

    public function test_lost_provider_creation_response_leaves_refund_unconfirmed_without_a_second_creation(): void
    {
        $booking = $this->paidBooking();
        Http::fake(['https://refund.example.test/v1/refunds' => Http::failedConnection()]);
        $this->actingAsUser('patientA');

        $this->cancelRequest($booking)->assertOk()->assertJsonPath('data.cancellation_refund.status', 'unconfirmed');
        $this->cancelRequest($booking, 'repeat-after-provider-loss')->assertOk()
            ->assertJsonPath('data.cancellation_refund.status', 'unconfirmed');
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'billing.booking_refund_attempt_started', 'auditable_public_id' => $booking->public_id,
        ]);
        $this->assertSame(1, AuditLog::where('action', 'billing.booking_refund_unconfirmed')->count());
        $this->assertNull($booking->fresh()->booking_refund_ref);
        $this->assertNull($booking->fresh()->booking_refunded_at);
    }

    public function test_provider_failed_status_never_becomes_refunded(): void
    {
        $booking = $this->paidBooking();
        $failed = ['data' => ['id' => 'ref_failed', 'attributes' => ['status' => 'failed', 'amount' => 60000]]];
        Http::fake([
            'https://refund.example.test/v1/refunds' => Http::response($failed),
            'https://refund.example.test/v1/refunds/ref_failed' => Http::response($failed),
        ]);
        $this->actingAsUser('patientA');
        $this->cancelRequest($booking)->assertOk()->assertJsonPath('data.cancellation_refund.status', 'unconfirmed');
        $this->cancelRequest($booking)->assertOk()->assertJsonPath('data.cancellation_refund.status', 'unconfirmed');
        $this->assertSame('ref_failed', $booking->fresh()->booking_refund_ref);
        $this->assertNull($booking->fresh()->booking_refunded_at);
        Http::assertSentCount(2);
        $this->assertSame('GET', Http::recorded()[1][0]->method());
        $this->assertTrue(AuditLog::where('action', 'billing.booking_refund_failed')->exists());
    }

    public function test_legacy_expired_mismatched_and_revoked_recipient_proofs_cannot_cancel(): void
    {
        $booking = $this->paidBooking();
        $other = $this->existing('B', 'd1', 'b1', 'svc1', '2026-09-30', '11:00');
        $recipient = $this->u['patientA']->fresh();
        $until = CarbonImmutable::instance($booking->starts_at);
        foreach ([
            [ActionLink::make('cant_make_it', $booking->public_id, 1, $until), 'link_invalid'],
            [ActionLink::make('cant_make_it', $booking->public_id, 1, $until->subDays(5), recipient: $recipient), 'link_expired'],
            [ActionLink::make('cant_make_it', $other->public_id, 1, $until, recipient: $recipient), 'link_invalid'],
        ] as [$token, $code]) {
            $this->postJson('/api/public/respond', ['token' => $token, 'confirm' => true])
                ->assertUnprocessable()->assertJsonPath('code', $code)->assertJsonMissingPath('data.appointment');
        }
        $token = ActionLink::make('cant_make_it', $booking->public_id, 1, $until, recipient: $recipient);
        $recipient->update(['account_status' => 'Inactive']);
        $this->postJson('/api/public/respond', ['token' => $token, 'confirm' => true])
            ->assertUnprocessable()->assertJsonPath('code', 'link_invalid');
        $this->assertSame('Confirmed', $booking->fresh()->status);
        $this->assertSame('Confirmed', $other->fresh()->status);
        $this->assertSame(0, AppointmentResponse::count());
        Http::assertNothingSent();
    }

    public function test_dependent_cancellation_uses_the_exact_authorized_reminder_recipient(): void
    {
        $guardian = $this->u['patientA']->fresh();
        $dependent = Guardianship::addDependent($this->p['A'], [
            'first_name' => 'Synthetic', 'last_name' => 'Dependent', 'date_of_birth' => '2014-04-17', 'relationship' => 'Parent',
        ], $guardian);
        $this->assertNull($dependent->user);
        $booking = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-30', '10:00');
        $booking->update(['patient_id' => $dependent->id]);
        $booking->refresh();
        $url = (new AppointmentReminderMail($booking))->content()->with['cantUrl'];
        $token = substr($url, strpos($url, '#respond/') + 9);
        $this->postJson('/api/public/respond', ['token' => $token.'x', 'confirm' => true])->assertNotFound();
        $this->postJson('/api/public/respond', ['token' => $token])->assertUnprocessable()->assertJsonPath('code', 'confirmation_required');
        $this->postJson('/api/public/respond', ['token' => $token, 'confirm' => true])
            ->assertOk()->assertJsonPath('data.state', 'done');
        $this->postJson('/api/public/respond', ['token' => $token, 'confirm' => true])
            ->assertOk()->assertJsonPath('data.state', 'done');
        $this->assertSame('Cancelled', $booking->fresh()->status);
        $this->assertSame($guardian->id, $booking->fresh()->updated_by_user_id);
        $this->assertSame(1, AppointmentResponse::where('appointment_id', $booking->id)->count());
        Http::assertNothingSent();
    }
}

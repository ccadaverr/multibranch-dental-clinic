<?php

namespace Tests\Feature\Payment;

use App\Models\Appointment;
use App\Models\AuditLog;
use App\Models\Visit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Synthetic-only R23A: no real provider transactions or hosted database writes. */
class R23ManualBookingRefundTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        Http::preventStrayRequests();
        config([
            'services.paymongo.secret_key' => 'sk_test_r23_fixture',
            'services.paymongo.mode' => 'test',
            'services.paymongo.base_url' => 'https://refund.r23.test',
        ]);
    }

    private function paid(string $branch = 'b1'): Appointment
    {
        $a = $this->existing('A', $branch === 'b1' ? 'd1' : 'd3', $branch, 'svc1', '2026-10-01', '10:00');
        $a->update([
            'booking_payment_status' => 'paid', 'booking_payment_ref' => 'pay_r23',
            'booking_paid_at' => now(), 'booking_fee_php' => '600.00',
        ]);
        return $a;
    }

    private function requestRefund(Appointment $a, string $key = 'r23-one', array $changes = [])
    {
        return $this->postJson('/api/appointments/'.$a->public_id.'/booking-refund',
            array_replace(['expected_revision' => 1, 'reason' => 'requested_by_customer'], $changes),
            ['Idempotency-Key' => $key]);
    }

    public function test_only_in_scope_staff_and_owner_can_initiate_a_refund(): void
    {
        $a = $this->paid();
        foreach (['patientA', 'dentist1'] as $key) {
            $this->actingAsUser($key);
            $this->requestRefund($a, 'r23-refused-'.$key)->assertForbidden();
        }
        foreach (['staffB2', 'staffNone'] as $key) {
            $this->actingAsUser($key);
            $this->requestRefund($a, 'r23-refused-'.$key)->assertNotFound();
        }
        $this->actingAsUser('staffB1');
        $this->requestRefund($a, 'r23-stale', ['expected_revision' => 99])
            ->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        Http::assertNothingSent();
        $this->assertSame('paid', $a->fresh()->booking_payment_status);
        $this->assertSame(0, AuditLog::where('action', 'billing.booking_refund_attempt_started')->count());
    }

    public function test_verified_refund_and_repeat_do_not_create_a_second_provider_request(): void
    {
        $a = $this->paid();
        Http::fake(['https://refund.r23.test/v1/refunds' => Http::response([
            'data' => ['id' => 'ref_r23', 'attributes' => ['status' => 'succeeded', 'amount' => 60000]],
        ])]);
        $this->actingAsUser('staffB1');
        $this->requestRefund($a)->assertOk()->assertJsonPath('data.refund_status', 'refunded')
            ->assertJsonPath('data.booking_payment_status', 'refunded');
        $this->requestRefund($a)->assertOk()->assertJsonPath('data.refund_status', 'refunded');
        Http::assertSentCount(1);
        $this->assertSame(1, AuditLog::where('action', 'billing.booking_refund_attempt_started')->count());
        $this->assertNotNull($a->fresh()->booking_refunded_at);
    }

    public function test_provider_timeout_keeps_a_durable_unknown_marker_and_refuses_second_post(): void
    {
        $a = $this->paid();
        Http::fake(['https://refund.r23.test/v1/refunds' => Http::failedConnection()]);
        $this->actingAsUser('owner');
        $this->requestRefund($a)->assertStatus(202)->assertJsonPath('data.refund_status', 'unconfirmed')
            ->assertJsonPath('data.booking_payment_status', 'paid');
        $this->requestRefund($a, 'r23-another-attempt')->assertUnprocessable()
            ->assertJsonPath('code', 'refund_reconciliation_required');
        Http::assertSentCount(1);
        $this->assertSame('paid', $a->fresh()->booking_payment_status);
        $this->assertNull($a->fresh()->booking_refunded_at);
        $this->assertSame(1, AuditLog::where('action', 'billing.booking_refund_attempt_started')->count());
    }

    public function test_known_pending_refund_is_reconciled_by_get_only(): void
    {
        $a = $this->paid();
        Http::fake([
            'https://refund.r23.test/v1/refunds' => Http::response([
                'data' => ['id' => 'ref_r23', 'attributes' => ['status' => 'processing', 'amount' => 60000]],
            ]),
            'https://refund.r23.test/v1/refunds/ref_r23' => Http::response([
                'data' => ['id' => 'ref_r23', 'attributes' => ['status' => 'succeeded', 'amount' => 60000]],
            ]),
        ]);
        $this->actingAsUser('owner');
        $this->requestRefund($a)->assertOk()->assertJsonPath('data.refund_status', 'processing');
        $this->requestRefund($a)->assertOk()->assertJsonPath('data.refund_status', 'refunded');
        $this->requestRefund($a)->assertOk()->assertJsonPath('data.refund_status', 'refunded');
        Http::assertSentCount(2);
        $recorded = Http::recorded();
        $this->assertSame('POST', $recorded[0][0]->method());
        $this->assertSame('GET', $recorded[1][0]->method());
    }

    public function test_provider_payload_cannot_override_money_or_refund_target(): void
    {
        $a = $this->paid();
        $this->actingAsUser('owner');
        $this->requestRefund($a, 'r23-untrusted-money', ['amount' => '1.00', 'payment_id' => 'other'])
            ->assertUnprocessable()->assertJsonValidationErrors(['amount', 'payment_id']);
        $this->requestRefund($a, 'r23-required-note', ['reason' => 'others'])
            ->assertUnprocessable()->assertJsonValidationErrors(['note']);
        Http::assertNothingSent();
    }

    public function test_existing_visit_fails_closed_before_external_refund(): void
    {
        $a = $this->paid();
        // Synthetic Visit; a pre-credit refund is no longer a safe decision even before invoice issuance.
        Visit::create([
            'appointment_id' => $a->id, 'patient_id' => $a->patient_id, 'branch_id' => $a->branch_id,
            'responsible_dentist_profile_id' => $a->dentist_profile_id, 'requested_service_id' => $a->service_id,
            'status' => 'Checked In', 'source' => 'appointment', 'clinic_date' => '2026-10-01',
            'arrived_at' => now(), 'revision' => 1,
        ]);
        $this->actingAsUser('owner');
        $this->requestRefund($a)->assertUnprocessable()
            ->assertJsonPath('code', 'refund_requires_financial_review');
        Http::assertNothingSent();
        $this->assertNull($a->fresh()->booking_refund_ref);
    }

    public function test_cancellation_reconciles_known_refund_without_creating_second_refund(): void
    {
        $a = $this->paid();
        Http::fake([
            'https://refund.r23.test/v1/refunds' => Http::response([
                'data' => ['id' => 'ref_r23', 'attributes' => ['status' => 'pending', 'amount' => 60000]],
            ]),
            'https://refund.r23.test/v1/refunds/ref_r23' => Http::response([
                'data' => ['id' => 'ref_r23', 'attributes' => ['status' => 'processing', 'amount' => 60000]],
            ]),
        ]);
        $this->actingAsUser('staffB1');
        $this->requestRefund($a)->assertOk()->assertJsonPath('data.refund_status', 'pending');
        $this->postJson('/api/appointments/'.$a->public_id.'/cancel',
            ['expected_revision' => 1, 'reason' => 'Synthetic schedule conflict'],
            ['Idempotency-Key' => 'r23-cancel-after-manual'])->assertOk()
            ->assertJsonPath('data.status', 'Cancelled');
        $this->assertSame(1, collect(Http::recorded())->filter(fn ($r) => $r[0]->method() === 'POST')->count());
        $this->assertSame('ref_r23', $a->fresh()->booking_refund_ref);
        $this->assertNull($a->fresh()->booking_refunded_at);
    }

    public function test_cancellation_after_lost_refund_reply_never_posts_again(): void
    {
        $a = $this->paid();
        Http::fake(['https://refund.r23.test/v1/refunds' => Http::failedConnection()]);
        $this->actingAsUser('staffB1');
        $this->requestRefund($a)->assertStatus(202)->assertJsonPath('data.refund_status', 'unconfirmed');
        $this->postJson('/api/appointments/'.$a->public_id.'/cancel',
            ['expected_revision' => 1, 'reason' => 'Synthetic cancellation'],
            ['Idempotency-Key' => 'r23-cancel-after-unknown'])->assertOk()
            ->assertJsonPath('data.cancellation_refund.status', 'unconfirmed');
        Http::assertSentCount(1);
    }

}

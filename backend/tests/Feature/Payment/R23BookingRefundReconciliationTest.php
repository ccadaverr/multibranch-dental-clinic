<?php

namespace Tests\Feature\Payment;

use App\Models\Appointment;
use App\Models\AuditLog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Synthetic-only R23B: asserts reconciliation never creates a new provider refund. */
class R23BookingRefundReconciliationTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        Http::preventStrayRequests();
        config([
            'services.paymongo.secret_key' => 'sk_test_r23b_fixture',
            'services.paymongo.mode' => 'test',
            'services.paymongo.base_url' => 'https://refund.r23b.test',
        ]);
    }

    private function paid(): Appointment
    {
        $appointment = $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-01', '10:00');
        $appointment->update([
            'booking_payment_status' => 'paid',
            'booking_payment_ref' => 'pay_r23b',
            'booking_paid_at' => now(),
            'booking_fee_php' => '600.00',
        ]);
        return $appointment;
    }

    private function reconcile(Appointment $appointment, array $overrides = [])
    {
        return $this->postJson('/api/appointments/'.$appointment->public_id.'/booking-refund/reconcile',
            array_replace(['expected_revision' => 1], $overrides), ['Idempotency-Key' => 'r23b-readback']);
    }

    public function test_no_refund_attempt_returns_validation_without_provider_request(): void
    {
        $a = $this->paid();
        $this->actingAsUser('staffB1');
        $this->reconcile($a)->assertUnprocessable()->assertJsonPath('code', 'no_refund_to_reconcile');
        Http::assertNothingSent();
    }

    public function test_unknown_original_refund_outcome_never_creates_second_refund(): void
    {
        $a = $this->paid();
        Http::fake(['https://refund.r23b.test/v1/refunds' => Http::failedConnection()]);
        $this->actingAsUser('staffB1');
        $this->postJson('/api/appointments/'.$a->public_id.'/booking-refund',
            ['expected_revision' => 1, 'reason' => 'requested_by_customer'],
            ['Idempotency-Key' => 'r23b-original'])->assertStatus(202);
        $this->reconcile($a)->assertStatus(202)
            ->assertJsonPath('data.refund_status', 'unconfirmed')
            ->assertJsonPath('data.provider_ref_known', false);
        $this->assertSame(1, AuditLog::where('action', 'billing.booking_refund_attempt_started')->count());
        Http::assertSentCount(1);
        $this->assertNull($a->fresh()->booking_refund_ref);
    }

    public function test_known_refund_is_reconciled_by_get_only_and_succeeds(): void
    {
        $a = $this->paid();
        Http::fake([
            'https://refund.r23b.test/v1/refunds' => Http::response([
                'data' => ['id' => 'ref_r23b', 'attributes' => ['status' => 'pending', 'amount' => 60000]],
            ]),
            'https://refund.r23b.test/v1/refunds/ref_r23b' => Http::response([
                'data' => ['id' => 'ref_r23b', 'attributes' => ['status' => 'succeeded', 'amount' => 60000]],
            ]),
        ]);
        $this->actingAsUser('owner');
        $this->postJson('/api/appointments/'.$a->public_id.'/booking-refund',
            ['expected_revision' => 1, 'reason' => 'requested_by_customer'],
            ['Idempotency-Key' => 'r23b-original'])->assertOk()->assertJsonPath('data.refund_status', 'pending');
        $this->reconcile($a)->assertOk()->assertJsonPath('data.refund_status', 'refunded')
            ->assertJsonPath('data.provider_ref_known', true)
            ->assertJsonPath('data.booking_payment_status', 'refunded');
        $this->reconcile($a)->assertOk()->assertJsonPath('data.refund_status', 'refunded');
        Http::assertSentCount(2);
        $requests = Http::recorded();
        $this->assertSame('POST', $requests[0][0]->method());
        $this->assertSame('GET', $requests[1][0]->method());
        $this->assertNotNull($a->fresh()->booking_refunded_at);
    }

    public function test_provider_failed_status_never_claims_refund_completed(): void
    {
        $a = $this->paid();
        $a->update(['booking_refund_ref' => 'ref_failed_r23b']);
        Http::fake(['https://refund.r23b.test/v1/refunds/ref_failed_r23b' => Http::response([
            'data' => ['id' => 'ref_failed_r23b', 'attributes' => ['status' => 'failed', 'amount' => 60000]],
        ])]);
        $this->actingAsUser('owner');
        $this->reconcile($a)->assertOk()->assertJsonPath('data.refund_status', 'failed')
            ->assertJsonPath('data.booking_payment_status', 'paid');
        $this->assertNull($a->fresh()->booking_refunded_at);
        Http::assertSentCount(1);
        $requests = Http::recorded();
        $this->assertSame('GET', $requests[0][0]->method());
    }

    public function test_provider_read_timeout_is_unconfirmed_and_preserves_reference(): void
    {
        $a = $this->paid();
        $a->update(['booking_refund_ref' => 'ref_unknown_r23b']);
        Http::fake(['https://refund.r23b.test/v1/refunds/ref_unknown_r23b' => Http::failedConnection()]);
        $this->actingAsUser('owner');
        $this->reconcile($a)->assertStatus(202)
            ->assertJsonPath('data.refund_status', 'unconfirmed')
            ->assertJsonPath('data.provider_ref_known', true);
        $this->assertSame('ref_unknown_r23b', $a->fresh()->booking_refund_ref);
        $this->assertSame('paid', $a->fresh()->booking_payment_status);
        Http::assertSentCount(1);
    }

    public function test_roles_branch_privacy_revision_and_untrusted_money_fields_fail_closed(): void
    {
        $a = $this->paid();
        $a->update(['booking_refund_ref' => 'ref_r23b']);
        foreach (['patientA', 'dentist1'] as $role) {
            $this->actingAsUser($role);
            $this->reconcile($a)->assertForbidden();
        }
        foreach (['staffB2', 'staffNone'] as $role) {
            $this->actingAsUser($role);
            $this->reconcile($a)->assertNotFound();
        }
        $this->actingAsUser('staffB1');
        $this->reconcile($a, ['expected_revision' => 123])->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        $this->reconcile($a, ['payment_id' => 'other', 'amount' => 1])->assertUnprocessable()
            ->assertJsonValidationErrors(['payment_id', 'amount']);
        Http::assertNothingSent();
    }
}

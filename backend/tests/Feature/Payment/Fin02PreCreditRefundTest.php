<?php

namespace Tests\Feature\Payment;

use App\Models\AppointmentHistory;
use App\Models\AuditLog;
use App\Services\Appointments\AppointmentCommandException;
use App\Services\Appointments\AppointmentService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

// Pre-credit contract only. Post-credit reversal policy remains unresolved.
class Fin02PreCreditRefundTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        config(['services.paymongo.secret_key' => 'sk_test_fixture', 'services.paymongo.mode' => 'test']);
        Http::preventStrayRequests();
    }

    public static function refundableStates(): array
    {
        return [['paid'], ['forfeited']];
    }

    #[DataProvider('refundableStates')]
    public function test_pre_credit_refund_completes_once_and_replay_does_not_contact_provider(string $paymentState): void
    {
        $appointment = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-30', '09:00');
        $appointment->update(['booking_payment_status' => $paymentState,
            'booking_payment_ref' => 'pay_fin02', 'booking_fee_php' => '600.00']);
        $this->assertNull($appointment->visit);
        Http::fake(['*' => Http::response(['data' => ['id' => 'ref_fin02',
            'attributes' => ['status' => 'succeeded', 'amount' => 60000]]])]);
        $service = app(AppointmentService::class);

        $result = $service->refundBookingPayment($this->u['owner'], $appointment, 'requested_by_customer');

        $this->assertSame(['refund_id' => 'ref_fin02', 'status' => 'refunded'], $result);
        $fresh = $appointment->fresh();
        $this->assertSame('refunded', $fresh->booking_payment_status);
        $this->assertSame('ref_fin02', $fresh->booking_refund_ref);
        $this->assertNotNull($fresh->booking_refunded_at);
        $this->assertSame(['Confirmed', 1], [$fresh->status, $fresh->revision]);
        try {
            $service->refundBookingPayment($this->u['owner'], $fresh, 'requested_by_customer');
            $this->fail('A completed refund must not be submitted again.');
        } catch (AppointmentCommandException $exception) {
            $this->assertSame('not_refundable', $exception->errorCode);
        }
        Http::assertSentCount(1);
        $this->assertSame(1, AppointmentHistory::where('appointment_id', $appointment->id)->where('event', 'appointment.booking_refunded')->count());
        $this->assertSame(1, AuditLog::where('action', 'billing.booking_payment_refunded')->count());
        $this->assertDatabaseCount('invoices', 0);
        $this->assertDatabaseCount('payments', 0);
        $this->assertDatabaseCount('receipts', 0);
    }

    public static function nonfinalStates(): array
    {
        return [['pending'], ['processing'], ['failed']];
    }

    #[DataProvider('nonfinalStates')]
    public function test_pre_credit_nonfinal_refund_reconciles_without_false_reversal(string $providerState): void
    {
        $appointment = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-30', '09:00');
        $appointment->update(['booking_payment_status' => 'paid',
            'booking_payment_ref' => 'pay_fin02', 'booking_fee_php' => '600.00']);
        Http::fake(['*' => Http::response(['data' => ['id' => 'ref_fin02',
            'attributes' => ['status' => $providerState, 'amount' => 60000]]])]);
        $service = app(AppointmentService::class);

        $this->assertSame($providerState, $service->refundBookingPayment($this->u['owner'], $appointment, 'requested_by_customer')['status']);
        $this->assertSame($providerState, $service->refundBookingPayment($this->u['owner'], $appointment->fresh(), 'requested_by_customer')['status']);

        $fresh = $appointment->fresh();
        $this->assertSame('paid', $fresh->booking_payment_status);
        $this->assertSame('ref_fin02', $fresh->booking_refund_ref);
        $this->assertNull($fresh->booking_refunded_at);
        $this->assertSame(0, AppointmentHistory::where('appointment_id', $appointment->id)->where('event', 'appointment.booking_refunded')->count());
        $this->assertSame(0, AuditLog::where('action', 'billing.booking_payment_refunded')->count());
        Http::assertSentCount(2);
        Http::assertSent(fn ($request) => $request->method() === 'POST' && $request->hasHeader('Idempotency-Key'));
        Http::assertSent(fn ($request) => $request->method() === 'GET' && str_ends_with($request->url(), '/ref_fin02'));
        $this->assertDatabaseCount('invoices', 0);
        $this->assertDatabaseCount('payments', 0);
        $this->assertDatabaseCount('receipts', 0);
    }
}

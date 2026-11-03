<?php

namespace Tests\Feature\Payment;

use App\Models\AuditLog;
use App\Services\Billing\BillingException;
use App\Services\Payment\PayMongoService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

class RefundIntegrationAcceptanceTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        config(['services.paymongo.secret_key' => 'sk_test_fixture', 'services.paymongo.mode' => 'test']);
        Http::preventStrayRequests();
    }

    public static function nonfinalRefunds(): array
    {
        return [['pending'], ['processing'], ['failed']];
    }

    #[DataProvider('nonfinalRefunds')]
    public function test_nonfinal_refund_never_claims_money_returned_and_retry_uses_the_same_reference(string $state): void
    {
        $appointment = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-30', '09:00');
        $appointment->update(['booking_payment_status' => 'paid', 'booking_payment_ref' => 'pay_qa_refund', 'booking_fee_php' => '600.00']);
        Http::fake(['*' => Http::response(['data' => ['id' => 'ref_qa', 'attributes' => ['status' => $state, 'amount' => 60000]]])]);
        $service = app(PayMongoService::class);
        $this->assertSame($state, $service->refundAppointment($appointment)['status']);
        $this->assertSame($state, $service->refundAppointment($appointment->fresh())['status']);
        $this->assertSame('paid', $appointment->fresh()->booking_payment_status);
        $this->assertNull($appointment->fresh()->booking_refunded_at);
        $this->assertSame(['Confirmed', 1], [$appointment->fresh()->status, $appointment->fresh()->revision]);
        $this->assertSame(0, AuditLog::where('action', 'billing.booking_payment_refunded')->count());
        Http::assertSentCount(2);
        Http::assertSent(fn ($r) => $r->method() === 'POST' && $r['data']['attributes']['payment_id'] === 'pay_qa_refund'
            && $r['data']['attributes']['amount'] === 60000 && $r->hasHeader('Idempotency-Key'));
        Http::assertSent(fn ($r) => $r->method() === 'GET' && str_ends_with($r->url(), '/ref_qa'));
    }

    public static function unverifiableRefunds(): array
    {
        return [
            [['id' => 'ref_other', 'attributes' => ['status' => 'succeeded', 'amount' => 60000]]],
            [['id' => 'ref_qa', 'attributes' => ['status' => 'succeeded', 'amount' => 59999]]],
            [['id' => 'ref_qa', 'attributes' => ['status' => 'unknown', 'amount' => 60000]]],
        ];
    }

    #[DataProvider('unverifiableRefunds')]
    public function test_unverifiable_refund_response_cannot_mutate_financial_or_clinical_state(array $response): void
    {
        $appointment = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-30', '09:00');
        $appointment->update(['booking_payment_status' => 'paid', 'booking_payment_ref' => 'pay_qa_refund',
            'booking_refund_ref' => 'ref_qa', 'booking_fee_php' => '600.00']);
        $before = $appointment->fresh()->getAttributes();
        Http::fake(['*' => Http::response(['data' => $response])]);
        try {
            app(PayMongoService::class)->refundAppointment($appointment);
            $this->fail('Unverifiable refund must be refused.');
        } catch (BillingException $exception) {
            $this->assertSame('payment_gateway_invalid_response', $exception->responseBody()['code']);
        }
        $this->assertSame($before, $appointment->fresh()->getAttributes());
        $this->assertSame(0, AuditLog::where('action', 'billing.booking_payment_refunded')->count());
    }
}

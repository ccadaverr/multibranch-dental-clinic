<?php

namespace Tests\Feature\Billing;

use App\Models\Appointment;
use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\Receipt;
use App\Models\ServicePrice;
use App\Models\Visit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Real named HTTP transitions; no completed-treatment or financial-result fixtures. */
class VisitSettlementJourneyTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    public function test_scheduled_visit_to_cash_receipt_with_role_isolation_replay_and_durable_readback(): void
    {
        $this->setUpSchedulingWorld();
        Http::preventStrayRequests();
        DB::table('m11_billing_cutovers')->where('id', 1)->update(['established_at' => '2026-09-01 00:00:00+08']);
        ServicePrice::create(['service_id' => $this->svc['svc1']->id, 'branch_id' => $this->b['b1']->id, 'kind' => 'priced', 'amount' => '125.50', 'effective_from' => '2026-09-01', 'source' => 'owner_confirmed', 'created_by_user_id' => $this->u['owner']->id, 'created_at' => now()]);
        $this->actingAsUser('staffB1');
        $appointment = $this->staffBook(['date' => '2026-09-28', 'start_time' => '11:00', 'dentist_ref' => 'd1'], ['Idempotency-Key' => 'journey-book'])->assertCreated()->json('data');
        $arrival = ['appointment_id' => $appointment['id'], 'expected_revision' => 1];
        $this->postJson('/api/visits/check-in', $arrival + ['branch_ref' => 'b2'], ['Idempotency-Key' => 'journey-forged'])->assertUnprocessable();
        $visit = $this->postJson('/api/visits/check-in', $arrival, ['Idempotency-Key' => 'journey-arrive'])->assertCreated()->json('data');
        $this->postJson('/api/visits/check-in', $arrival, ['Idempotency-Key' => 'journey-arrive'])->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $visit['id']);
        $this->postJson('/api/visits/check-in', $arrival, ['Idempotency-Key' => 'journey-other-arrive'])->assertConflict();
        foreach (['staffB2', 'dentist2', 'patientB'] as $actor) {
            $this->actingAsUser($actor);
            $this->getJson('/api/visits/'.$visit['id'])->assertForbidden();
        }
        $this->actingAsUser('dentist1');
        $this->postJson('/api/queue/'.$visit['queue']['id'].'/call', ['expected_revision' => 1], ['Idempotency-Key' => 'journey-call'])->assertOk();
        $t = $this->postJson('/api/visits/'.$visit['id'].'/treatment', ['expected_revision' => 1], ['Idempotency-Key' => 'journey-start'])->assertCreated()->json('data');
        $this->postJson('/api/treatments/'.$t['id'].'/document', ['expected_revision' => 1, 'chief_complaint' => 'Synthetic routine examination', 'procedure_summary' => 'Synthetic performed procedure', 'prescription_required' => false, 'followup_required' => false, 'procedures' => [['service_ref' => 'svc1', 'quantity' => 2]]], ['Idempotency-Key' => 'journey-document'])->assertOk();
        $this->postJson('/api/treatments/'.$t['id'].'/complete', ['expected_revision' => 2], ['Idempotency-Key' => 'journey-complete'])->assertOk()->assertJsonPath('data.status', 'Completed');
        $this->getJson('/api/treatments/'.$t['id'])->assertOk()->assertJsonPath('data.status', 'Completed');
        $this->actingAsUser('staffB1');
        $i = $this->postJson('/api/invoices/from-treatment/'.$t['id'], [], ['Idempotency-Key' => 'journey-draft'])->assertCreated()->assertJsonPath('data.gross_amount', '251.00')->json('data');
        $this->assertSame($visit['id'], $i['visit_id']);
        $this->assertSame($appointment['patient']['id'], $i['patient']['id']);
        $this->postJson('/api/invoices/'.$i['id'].'/review', ['expected_revision' => 1], ['Idempotency-Key' => 'journey-review'])->assertOk();
        $this->postJson('/api/invoices/'.$i['id'].'/issue', ['expected_revision' => 2], ['Idempotency-Key' => 'journey-issue'])->assertOk();
        $path = '/api/invoices/'.$i['id'].'/payment';
        $body = ['expected_revision' => 3, 'method' => 'Cash', 'amount' => '251.00'];
        $this->postJson($path, array_replace($body, ['amount' => '250.99']), ['Idempotency-Key' => 'journey-wrong-amount'])->assertUnprocessable()->assertJsonPath('code', 'invalid_payment_amount');
        $this->assertSame(0, Payment::count());
        $this->assertSame(0, Receipt::count());
        $paid = $this->postJson($path, $body, ['Idempotency-Key' => 'journey-pay'])->assertOk()->assertJsonPath('data.status', 'Paid')->assertJsonPath('data.balance', '0.00')->json('data');
        $this->postJson($path, $body, ['Idempotency-Key' => 'journey-pay'])->assertOk()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.receipt.id', $paid['receipt']['id']);
        $this->postJson($path, array_replace($body, ['method' => 'E-Wallet', 'external_reference' => 'different']), ['Idempotency-Key' => 'journey-pay'])->assertConflict();
        $this->postJson($path, $body, ['Idempotency-Key' => 'journey-pay-again'])->assertConflict();
        $this->assertSame(1, Invoice::count());
        $this->assertSame(1, Payment::count());
        $this->assertSame(1, Receipt::count());
        $this->assertSame('Completed', Visit::where('public_id', $visit['id'])->sole()->status);
        $this->assertSame('Completed', Appointment::where('public_id', $appointment['id'])->sole()->status);
        $this->assertSame(['queue.entered', 'queue.called', 'queue.served'], Visit::where('public_id', $visit['id'])->sole()->queueEntry->history()->orderBy('id')->pluck('event')->all());
        $this->assertSame(['invoice.created', 'invoice.reviewed', 'invoice.issued', 'invoice.paid'], Invoice::sole()->histories()->orderBy('id')->pluck('event')->all());
        $this->assertTrue(AuditLog::where('action', 'billing.payment_recorded')->exists());
        $this->actingAsUser('patientA');
        $this->getJson('/api/invoices/mine')->assertOk()->assertJsonPath('data.0.receipt.id', $paid['receipt']['id']);
        $this->getJson('/api/receipts/mine')->assertOk()->assertJsonPath('data.0.number', $paid['receipt']['number']);
        $pdf = $this->get('/api/invoices/'.$i['id'].'/receipt-pdf')->assertOk()->assertHeader('Content-Type', 'application/pdf');
        $this->assertStringStartsWith('%PDF-', $pdf->getContent());
        foreach (['patientB', 'staffB2', 'dentist2', 'dentist1'] as $actor) {
            $this->actingAsUser($actor);
            $this->getJson('/api/invoices/'.$i['id'])->assertForbidden();
            $this->get('/api/invoices/'.$i['id'].'/receipt-pdf')->assertStatus($actor === 'dentist1' || $actor === 'dentist2' ? 403 : 404);
        }
    }
}

<?php

namespace Tests\Feature\Billing;

use App\Models\Appointment;
use App\Models\AuditLog;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\Receipt;
use App\Models\ServicePrice;
use App\Models\Visit;
use Carbon\CarbonImmutable;
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
        $this->verifyCashJourney(false);
    }

    public function test_patient_booking_reaches_staff_check_in_prescription_cash_and_owner_reporting(): void
    {
        $this->verifyCashJourney(true);
    }

    private function verifyCashJourney(bool $patientBooking): void
    {
        $this->setUpSchedulingWorld();
        Http::preventStrayRequests();
        DB::table('m11_billing_cutovers')->where('id', 1)->update(['established_at' => '2026-09-01 00:00:00+08']);
        ServicePrice::create(['service_id' => $this->svc['svc1']->id, 'branch_id' => $this->b['b1']->id, 'kind' => 'priced', 'amount' => '125.50', 'effective_from' => '2026-09-01', 'source' => 'owner_confirmed', 'created_by_user_id' => $this->u['owner']->id, 'created_at' => now()]);
        $date = $patientBooking ? '2026-09-29' : '2026-09-28';
        $slot = ['date' => $date, 'start_time' => '11:00', 'dentist_ref' => 'd1'];
        $bookingKey = ['Idempotency-Key' => 'journey-book'];
        if ($patientBooking) {
            $this->actingAsUser('patientA');
            $appointment = $this->book($slot + ['pay_at_clinic' => true], $bookingKey)->assertCreated()
                ->assertJsonPath('data.source', 'patient_portal')->assertJsonPath('data.status', 'Confirmed')->json('data');
        } else {
            $this->actingAsUser('staffB1');
            $appointment = $this->staffBook($slot, $bookingKey)->assertCreated()->json('data');
        }
        $this->actingAsUser('staffB1');
        $this->getJson('/api/appointments/'.$appointment['id'])->assertOk()
            ->assertJsonPath('data.patient.id', $appointment['patient']['id'])
            ->assertJsonPath('data.branch.id', $appointment['branch']['id']);
        $arrival = ['appointment_id' => $appointment['id'], 'expected_revision' => 1];
        if ($patientBooking) {
            $this->postJson('/api/visits/check-in', $arrival, ['Idempotency-Key' => 'journey-early'])->assertUnprocessable()->assertJsonPath('code', 'not_today');
            $this->assertSame(0, Visit::count());
        }
        $this->travelTo(CarbonImmutable::parse($date.' 11:00:00', 'Asia/Manila'));
        $this->postJson('/api/visits/check-in', $arrival + ['branch_ref' => 'b2'], ['Idempotency-Key' => 'journey-forged'])->assertUnprocessable();
        $visit = $this->postJson('/api/visits/check-in', $arrival, ['Idempotency-Key' => 'journey-arrive'])->assertCreated()->json('data');
        $this->postJson('/api/visits/check-in', $arrival, ['Idempotency-Key' => 'journey-arrive'])->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $visit['id']);
        $this->postJson('/api/visits/check-in', $arrival, ['Idempotency-Key' => 'journey-other-arrive'])->assertConflict();
        foreach (['staffB2', 'dentist2', 'patientB'] as $actor) {
            $this->actingAsUser($actor);
            $this->getJson('/api/visits/'.$visit['id'])->assertNotFound();
        }
        $this->actingAsUser($patientBooking ? 'staffB1' : 'dentist1');
        $this->postJson('/api/queue/'.$visit['queue']['id'].'/call', ['expected_revision' => 1], ['Idempotency-Key' => 'journey-call'])->assertOk();
        $this->actingAsUser('dentist1');
        $t = $this->postJson('/api/visits/'.$visit['id'].'/treatment', ['expected_revision' => 1], ['Idempotency-Key' => 'journey-start'])->assertCreated()->json('data');
        $this->assertSame('Served', Visit::where('public_id', $visit['id'])->sole()->queueEntry->status);
        $this->postJson('/api/treatments/'.$t['id'].'/document', ['expected_revision' => 1, 'chief_complaint' => 'Synthetic routine examination', 'procedure_summary' => 'Synthetic performed procedure', 'prescription_required' => false, 'followup_required' => false, 'procedures' => [['service_ref' => 'svc1', 'quantity' => 2]]], ['Idempotency-Key' => 'journey-document'])->assertOk();
        $this->postJson('/api/treatments/'.$t['id'].'/complete', ['expected_revision' => 2], ['Idempotency-Key' => 'journey-complete'])->assertOk()->assertJsonPath('data.status', 'Completed');
        $this->getJson('/api/treatments/'.$t['id'])->assertOk()->assertJsonPath('data.status', 'Completed');
        if ($patientBooking) {
            $draft = $this->postJson('/api/prescriptions', ['visit_id' => $visit['id'], 'lines' => [['medicine' => 'Synthetic demonstration entry']]], ['Idempotency-Key' => 'journey-rx'])->assertCreated()->json('data');
            $this->actingAsUser('patientA');
            $this->getJson('/api/prescriptions/'.$draft['id'])->assertNotFound();
            $this->actingAsUser('dentist1');
            $issuePath = '/api/prescriptions/'.$draft['id'].'/issue';
            $issueBody = ['expected_revision' => $draft['revision']];
            $issueKey = ['Idempotency-Key' => 'journey-rx-issue'];
            $issued = $this->postJson($issuePath, $issueBody, $issueKey)->assertOk()->assertJsonPath('data.status', 'Issued')->json('data');
            $this->postJson($issuePath, $issueBody, $issueKey)->assertOk()->assertJsonPath('data.number', $issued['number']);
            $this->actingAsUser('patientA');
            $this->getJson('/api/prescriptions/'.$draft['id'])->assertOk()->assertJsonPath('data.visit', $visit['id']);
        }
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
        if ($patientBooking) {
            $this->actingAsUser('owner');
            $this->getJson('/api/analytics/daily-revenue?'.http_build_query(['branch_id' => $this->b['b1']->public_id, 'date_from' => $date, 'date_to' => $date]))
                ->assertOk()->assertJsonPath('data.totals.gross_collected_php', '251.00');
        }
        foreach (['patientB', 'staffB2', 'dentist2', 'dentist1'] as $actor) {
            $this->actingAsUser($actor);
            $this->getJson('/api/invoices/'.$i['id'])->assertForbidden();
            $this->get('/api/invoices/'.$i['id'].'/receipt-pdf')->assertStatus($actor === 'dentist1' || $actor === 'dentist2' ? 403 : 404);
        }
    }
}

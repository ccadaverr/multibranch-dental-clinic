<?php

namespace Tests\Feature\Appointments;

use App\Models\Appointment;
use App\Models\PatientGuardian;
use App\Models\ServicePrice;
use App\Services\Intake\Guardianship;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class BookingIntegrationContractTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->p['A']->person->update(['date_of_birth' => '1990-01-01']);
        Http::preventStrayRequests();
    }

    private function configurePayment(): void
    {
        config(['services.paymongo.secret_key' => 'sk_test_fixture', 'services.paymongo.mode' => 'test',
            'services.paymongo.webhook_secret' => 'fictional_webhook_secret', 'services.paymongo.payment_method_types' => 'gcash,card']);
        ServicePrice::create(['service_id' => $this->svc['svc1']->id, 'kind' => 'priced', 'amount' => '600.00',
            'effective_from' => '2026-09-28', 'source' => 'owner_confirmed', 'created_by_user_id' => $this->u['owner']->id]);
    }

    public function test_quote_is_read_only_and_unconfigured_online_selection_never_silently_books_unpaid(): void
    {
        $this->actingAsUser('patientA');
        config(['services.paymongo.secret_key' => '']);
        $this->getJson('/api/appointments/booking-options?branch_ref=b1&service_ref=svc1&date=2026-09-29')
            ->assertOk()->assertJsonPath('data.online_payment_available', false)
            ->assertJsonPath('data.online_payment_unavailable_reason', 'payment_not_configured')
            ->assertJsonPath('data.booking_fee_php', null)->assertJsonPath('data.pay_at_clinic_available', true);
        $this->book(['pay_at_clinic' => false])->assertStatus(422)->assertJsonPath('code', 'payment_not_configured');
        $this->assertSame(0, Appointment::count());
        $this->book(['pay_at_clinic' => true])->assertCreated()->assertJsonPath('data.booking_payment_status', 'unpaid');
        Http::assertNothingSent();
    }

    public function test_quote_uses_confirmed_price_and_requires_webhook_configuration_without_provider_calls(): void
    {
        $this->configurePayment();
        $this->actingAsUser('patientA');
        $url = '/api/appointments/booking-options?branch_ref=b1&service_ref=svc1&date=2026-09-29';
        $this->getJson($url)->assertOk()->assertJsonPath('data.booking_fee_php', '600.00')
            ->assertJsonPath('data.online_payment_available', true)->assertJsonPath('data.reserves_slot', false);
        config(['services.paymongo.webhook_secret' => '']);
        $this->getJson($url)->assertOk()->assertJsonPath('data.online_payment_available', false);
        $this->book(['pay_at_clinic' => false])->assertStatus(422)->assertJsonPath('code', 'payment_not_configured');
        $this->assertSame(0, Appointment::count());
        Http::assertNothingSent();
    }

    public function test_checkout_failure_rolls_back_and_can_be_retried_with_same_idempotency_key(): void
    {
        $this->configurePayment();
        $this->actingAsUser('patientA');
        Http::fake(['*' => Http::sequence()->push([], 503)->push(['data' => ['id' => 'cs_retry_fixture',
            'attributes' => ['checkout_url' => 'https://checkout.paymongo.com/cs_retry_fixture', 'livemode' => false]]])]);
        $payload = ['branch_ref' => 'b1', 'service_ref' => 'svc1', 'date' => '2026-09-29', 'start_time' => '09:00', 'pay_at_clinic' => false];
        $this->postJson('/api/appointments', $payload, ['Idempotency-Key' => 'fictional-retry'])->assertStatus(502);
        $this->assertSame(0, Appointment::count());
        $this->postJson('/api/appointments', $payload, ['Idempotency-Key' => 'fictional-retry'])->assertCreated()
            ->assertJsonPath('data.status', 'Pending')->assertJsonPath('data.booking_payment_status', 'held');
        $this->assertSame(1, Appointment::count());
    }

    public function test_search_and_creation_use_dependents_conflicts_instead_of_guardians(): void
    {
        $dependent = Guardianship::addDependent($this->p['A'], ['first_name' => 'Fictional', 'last_name' => 'Dependent',
            'date_of_birth' => '2016-01-01', 'relationship' => 'Parent'], $this->u['patientA']);
        $this->p['D'] = $dependent;
        $this->existing('D', 'd3', 'b2', 'svc1', '2026-09-29', '09:00');
        $this->existing('A', 'd3', 'b2', 'svc1', '2026-09-29', '10:00');
        $this->actingAsUser('patientA');
        $url = '/api/appointments/availability?branch_ref=b1&service_ref=svc1&date=2026-09-29';
        $own = $this->getJson($url)->assertOk()->json('data.slots');
        $child = $this->getJson($url.'&for_patient_id='.$dependent->public_id)->assertOk()->json('data.slots');
        $this->assertContains('09:00', array_column($own, 'start_time'));
        $this->assertNotContains('10:00', array_column($own, 'start_time'));
        $this->assertNotContains('09:00', array_column($child, 'start_time'));
        $this->assertContains('10:00', array_column($child, 'start_time'));
        $this->book(['for_patient_id' => $dependent->public_id])->assertStatus(422);
        $this->book(['for_patient_id' => $dependent->public_id, 'start_time' => '10:00', 'pay_at_clinic' => true])->assertCreated();
        $this->getJson('/api/appointments/recommendation?service_ref=svc1&branch_ref=b1&for_patient_id='.$dependent->public_id)
            ->assertOk()->assertJsonPath('data.recommendation.start_time', '11:00');
        $this->getJson('/api/appointments/calendar?branch_ref=b1&service_ref=svc1&month=2026-09&for_patient_id='.$dependent->public_id)->assertOk();
    }

    public function test_unknown_foreign_and_revoked_dependents_are_forbidden_without_enumeration(): void
    {
        $this->actingAsUser('patientA');
        foreach ([$this->p['B']->public_id, 'unknown-fictional-id'] as $id) {
            foreach (['availability?branch_ref=b1&service_ref=svc1&date=2026-09-29', 'recommendation?service_ref=svc1',
                'calendar?branch_ref=b1&service_ref=svc1&month=2026-09', 'branch-options?service_ref=svc1',
                'booking-options?branch_ref=b1&service_ref=svc1&date=2026-09-29'] as $route) {
                $this->getJson('/api/appointments/'.$route.'&for_patient_id='.$id)->assertForbidden();
            }
        }
        $dependent = Guardianship::addDependent($this->p['A'], ['first_name' => 'Fictional', 'last_name' => 'Dependent',
            'date_of_birth' => '2016-01-01', 'relationship' => 'Parent'], $this->u['patientA']);
        PatientGuardian::where('dependent_patient_id', $dependent->id)->update(['status' => 'ended', 'ended_at' => now(), 'ended_reason' => 'Fictional revocation']);
        $this->getJson('/api/appointments/availability?branch_ref=b1&service_ref=svc1&date=2026-09-29&for_patient_id='.$dependent->public_id)->assertForbidden();
        $this->book(['for_patient_id' => $dependent->public_id])->assertForbidden();
    }
}

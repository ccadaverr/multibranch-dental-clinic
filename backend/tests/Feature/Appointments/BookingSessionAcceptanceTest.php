<?php

namespace Tests\Feature\Appointments;

use App\Enums\Role;
use App\Models\Appointment;
use App\Models\PatientGuardian;
use App\Services\Intake\Guardianship;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class BookingSessionAcceptanceTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private const OPTIONS = '/api/appointments/booking-options?branch_ref=b1&service_ref=svc1&date=2026-09-29';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->p['A']->person->update(['date_of_birth' => '1990-01-01']);
        Http::preventStrayRequests();
    }

    private function loginPatient(): void
    {
        $this->postJson('/api/login', ['email' => $this->u['patientA']->email, 'password' => 'Passw0rd!'])->assertOk();
        Auth::forgetGuards();
    }

    public function test_real_session_booking_then_suspension_revokes_quote_and_create_access(): void
    {
        $this->getJson(self::OPTIONS)->assertUnauthorized();
        $this->loginPatient();
        $this->getJson(self::OPTIONS)->assertOk()->assertJsonPath('data.reserves_slot', false);
        Auth::forgetGuards();
        $this->book(['pay_at_clinic' => true], ['Idempotency-Key' => 'qa-session-book'])->assertCreated()
            ->assertJsonPath('data.patient.id', $this->p['A']->public_id)->assertJsonPath('data.status', 'Confirmed');
        $this->u['patientA']->update(['account_status' => 'Suspended']);
        Auth::forgetGuards();
        $this->getJson(self::OPTIONS)->assertForbidden()->assertJsonPath('code', 'session_revoked');
        Auth::forgetGuards();
        $this->book(['pay_at_clinic' => true, 'start_time' => '10:00'])->assertUnauthorized();
        $this->assertSame(1, Appointment::count());
        Http::assertNothingSent();
    }

    public function test_revoked_guardianship_after_search_prevents_booking_and_access_to_existing_dependent_records(): void
    {
        $dependent = Guardianship::addDependent($this->p['A'], ['first_name' => 'Synthetic', 'last_name' => 'Dependent',
            'date_of_birth' => '2016-01-01', 'relationship' => 'Parent'], $this->u['patientA']);
        $this->loginPatient();
        $this->getJson(self::OPTIONS.'&for_patient_id='.$dependent->public_id)->assertOk();
        Auth::forgetGuards();
        $id = $this->book(['for_patient_id' => $dependent->public_id, 'pay_at_clinic' => true], ['Idempotency-Key' => 'qa-dependent'])
            ->assertCreated()->assertJsonPath('data.patient.id', $dependent->public_id)->json('data.id');
        PatientGuardian::where('dependent_patient_id', $dependent->id)->update(['status' => 'ended', 'ended_at' => now(), 'ended_reason' => 'Synthetic revocation']);
        Auth::forgetGuards();
        $this->getJson('/api/appointments/'.$id)->assertForbidden();
        Auth::forgetGuards();
        $this->getJson(self::OPTIONS.'&for_patient_id='.$dependent->public_id)->assertForbidden();
        Auth::forgetGuards();
        $this->book(['for_patient_id' => $dependent->public_id, 'pay_at_clinic' => true, 'start_time' => '10:00'])->assertForbidden();
        $this->assertSame(1, Appointment::count());
    }

    public function test_patient_role_without_profile_and_other_roles_cannot_quote(): void
    {
        $this->u['unlinked'] = $this->account(Role::Patient, null);
        foreach (['unlinked', 'staffB1', 'dentist1', 'owner'] as $who) {
            $this->actingAsUser($who);
            $this->getJson(self::OPTIONS)->assertForbidden();
        }
        $this->assertSame(0, Appointment::count());
        Http::assertNothingSent();
    }
}

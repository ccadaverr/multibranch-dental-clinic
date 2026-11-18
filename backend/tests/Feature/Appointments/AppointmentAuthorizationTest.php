<?php

namespace Tests\Feature\Appointments;

use App\Models\Appointment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// M6 authorization matrix: Guest, Patient own/other, Staff with one/several/no/wrong scopes (user_branch_scopes),
// operational assignment, Dentist, Owner, inactive account, and public-identifier handling. UI visibility is never relied on.
class AppointmentAuthorizationTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private Appointment $a1;   // Patient A, b1, d1

    private Appointment $b2;   // Patient B, b2, d3

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        $this->a1 = $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-01', '09:00');
        $this->b2 = $this->existing('B', 'd3', 'b2', 'svc1', '2026-10-01', '09:00');
    }

    private function ids($response): array
    {
        return collect($response->json('data'))->pluck('id')->sort()->values()->all();
    }

    public function test_guest_is_unauthenticated_everywhere(): void
    {
        $this->getJson('/api/appointments')->assertUnauthorized();
        $this->getJson('/api/appointments/'.$this->a1->public_id)->assertUnauthorized();
        $this->book()->assertUnauthorized();
        $this->postJson('/api/appointments/'.$this->a1->public_id.'/cancel', ['expected_revision' => 1])->assertUnauthorized();
        $this->getJson('/api/appointments/availability?branch_ref=b1&service_ref=svc1&date=2026-09-29')->assertUnauthorized();
    }

    public function test_patient_reads_and_mutates_only_their_own_appointments(): void
    {
        $this->actingAsUser('patientA');
        $this->assertSame([$this->a1->public_id], $this->ids($this->getJson('/api/appointments')->assertOk()));
        $this->getJson('/api/appointments/'.$this->a1->public_id)->assertOk()->assertJsonPath('data.patient.code', 'PAT-0001');

        $this->getJson('/api/appointments/'.$this->b2->public_id)->assertNotFound();
        $this->postJson('/api/appointments/'.$this->b2->public_id.'/cancel', ['expected_revision' => 1])->assertForbidden();
        $this->postJson('/api/appointments/'.$this->b2->public_id.'/reschedule', ['expected_revision' => 1, 'date' => '2026-10-02', 'start_time' => '10:00'])->assertForbidden();
        $this->getJson('/api/appointments/availability?branch_ref=b2&service_ref=svc1&date=2026-10-02&appointment_id='.$this->b2->public_id)->assertUnprocessable();
        $this->assertSame('Confirmed', $this->b2->fresh()->status);
    }

    public function test_patient_without_a_patient_record_cannot_book(): void
    {
        $this->u['noRecord'] = $this->account(\App\Enums\Role::Patient, null);
        $this->actingAsUser('noRecord');
        $this->book()->assertForbidden();
        $this->getJson('/api/appointments/recommendation?service_ref=svc1')->assertForbidden();
        $this->getJson('/api/appointments')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_staff_in_scope_can_list_read_book_and_cancel_at_their_branch(): void
    {
        $this->actingAsUser('staffB1');
        $this->assertSame([$this->a1->public_id], $this->ids($this->getJson('/api/appointments')->assertOk()));
        $this->getJson('/api/appointments/'.$this->a1->public_id)->assertOk();
        $this->staffBook(['patient_id' => $this->p['B']->public_id])->assertCreated();
        $cancel = '/api/appointments/'.$this->a1->public_id.'/cancel';
        $this->postJson($cancel, ['expected_revision' => 1])->assertUnprocessable()->assertJsonPath('code', 'cancellation_reason_required');
        $this->assertSame(1, $this->a1->fresh()->revision);
        $body = ['expected_revision' => 1, 'reason' => 'Synthetic cancellation'];
        $headers = ['Idempotency-Key' => 'staff-cancel-readback'];
        $this->postJson($cancel, $body, $headers)->assertOk()->assertJsonPath('data.status', 'Cancelled');
        $this->postJson($cancel, $body, $headers)->assertOk()->assertJsonPath('data.revision', 2);
    }

    public function test_staff_out_of_scope_is_forbidden(): void
    {
        $this->actingAsUser('staffB1');
        $this->getJson('/api/appointments/'.$this->b2->public_id)->assertNotFound();
        $this->postJson('/api/appointments/'.$this->b2->public_id.'/cancel', ['expected_revision' => 1])->assertForbidden();
        $this->staffBook(['branch_ref' => 'b2'])->assertForbidden();
        $this->getJson('/api/appointments/availability?branch_ref=b2&service_ref=svc1&date=2026-10-02')->assertForbidden();
        $this->assertSame(2, Appointment::count());
    }

    public function test_staff_without_authorization_scope_is_denied_branch_data(): void
    {
        $this->actingAsUser('staffNone');
        $this->getJson('/api/appointments')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/appointments/'.$this->a1->public_id)->assertNotFound();
        $this->staffBook()->assertForbidden();
    }

    public function test_operational_assignment_never_grants_scope(): void
    {
        // staffNone is operationally assigned to b1 but has no authorization scope.
        \App\Models\StaffProfile::create(['person_id' => $this->u['staffNone']->person_id, 'branch_id' => $this->b['b1']->id,
            'shift_start' => '09:00', 'shift_end' => '18:00', 'available' => true]);
        $this->actingAsUser('staffNone');
        $this->getJson('/api/appointments/'.$this->a1->public_id)->assertNotFound();
        $this->staffBook()->assertForbidden();

        // staffB1 works at b2 operationally, but is only authorized for b1.
        \App\Models\StaffProfile::create(['person_id' => $this->u['staffB1']->person_id, 'branch_id' => $this->b['b2']->id,
            'shift_start' => '09:00', 'shift_end' => '18:00', 'available' => true]);
        $this->actingAsUser('staffB1');
        $this->getJson('/api/appointments/'.$this->b2->public_id)->assertNotFound();
        $this->staffBook(['branch_ref' => 'b2'])->assertForbidden();
    }

    public function test_staff_with_multiple_scopes_is_authorized_for_each_branch(): void
    {
        $this->actingAsUser('staffBoth');
        $this->assertSame(collect([$this->a1->public_id, $this->b2->public_id])->sort()->values()->all(), $this->ids($this->getJson('/api/appointments')->assertOk()));
        $this->getJson('/api/appointments/'.$this->a1->public_id)->assertOk();
        $this->getJson('/api/appointments/'.$this->b2->public_id)->assertOk();
        $this->staffBook(['date' => '2026-10-05'])->assertCreated();
        $this->staffBook(['branch_ref' => 'b2', 'date' => '2026-10-06'])->assertCreated();

        // A third branch outside both scopes stays denied.
        $this->b['b3'] = $this->branch('b3');
        $this->getJson('/api/appointments/availability?branch_ref=b3&service_ref=svc1&date=2026-10-02')->assertForbidden();
    }

    public function test_a_branch_scope_is_unique_per_account(): void
    {
        $this->expectException(\Illuminate\Database\UniqueConstraintViolationException::class);
        \App\Models\UserBranchScope::create(['user_id' => $this->u['staffB1']->id, 'branch_id' => $this->b['b1']->id]);
    }

    public function test_dentist_portal_still_requires_an_active_login(): void
    {
        // Deactivating d1's login blocks d1's own portal access but never d1's schedulability for Staff.
        $this->u['dentist1']->forceFill(['account_status' => 'Inactive'])->save();
        $this->actingAsUser('dentist1');
        $this->getJson('/api/appointments')->assertForbidden();
        $this->getJson('/api/appointments/'.$this->a1->public_id)->assertForbidden();

        $this->actingAsUser('staffB1');
        $this->staffBook(['dentist_ref' => 'd1', 'patient_id' => $this->p['B']->public_id, 'date' => '2026-10-02'])->assertCreated()
            ->assertJsonPath('data.dentist.id', 'd1');
    }

    public function test_dentist_reads_only_their_own_appointments_and_cannot_mutate(): void
    {
        $this->actingAsUser('dentist1');
        $this->assertSame([$this->a1->public_id], $this->ids($this->getJson('/api/appointments')->assertOk()));
        $this->getJson('/api/appointments/'.$this->a1->public_id)->assertOk();
        $this->getJson('/api/appointments/'.$this->b2->public_id)->assertNotFound();
        $this->book(['patient_id' => $this->p['A']->public_id])->assertForbidden();
        $this->postJson('/api/appointments/'.$this->a1->public_id.'/cancel', ['expected_revision' => 1])->assertForbidden();
        $this->postJson('/api/appointments/'.$this->a1->public_id.'/reschedule', ['expected_revision' => 1, 'date' => '2026-10-02', 'start_time' => '10:00'])->assertForbidden();
    }

    public function test_owner_has_all_branch_authority(): void
    {
        $this->actingAsUser('owner');
        $this->assertCount(2, $this->getJson('/api/appointments')->assertOk()->json('data'));
        $this->getJson('/api/appointments/'.$this->b2->public_id)->assertOk();
        $this->staffBook(['branch_ref' => 'b2', 'date' => '2026-10-05'])->assertCreated();
        $this->postJson('/api/appointments/'.$this->b2->public_id.'/cancel', ['expected_revision' => 1, 'reason' => 'Synthetic cancellation'])->assertOk();
    }

    public function test_inactive_account_is_forbidden_and_recommendation_is_patient_only(): void
    {
        $this->u['patientA']->forceFill(['account_status' => 'Inactive'])->save();
        $this->actingAsUser('patientA');
        $this->getJson('/api/appointments')->assertForbidden();

        $this->actingAsUser('staffB1');
        $this->getJson('/api/appointments/recommendation?service_ref=svc1')->assertForbidden();
    }

    public function test_unknown_or_bigint_ids_do_not_resolve(): void
    {
        $this->actingAsUser('owner');
        $this->getJson('/api/appointments/'.$this->a1->id)->assertNotFound();
        $this->getJson('/api/appointments/01J00000000000000000000000')->assertNotFound();
        $data = $this->getJson('/api/appointments/'.$this->a1->public_id)->json('data');
        $this->assertSame($this->a1->public_id, $data['id']);
        $this->assertArrayNotHasKey('patient_id', $data);
        $this->assertSame(['id', 'code', 'name'], array_keys($data['patient']));
        $this->assertSame($this->p['A']->public_id, $data['patient']['id']);
        foreach ([$data['id'], $data['patient']['id']] as $id) {
            $this->assertMatchesRegularExpression('/^[0-9a-hjkmnp-tv-z]{26}$/', $id);
        }
        // Neither the Patient bigint nor patient_code is accepted as the Staff booking identifier.
        $this->staffBook(['patient_id' => (string) $this->p['A']->id, 'date' => '2026-10-07'])->assertStatus(422)->assertJsonValidationErrors('patient_id');
        $this->staffBook(['patient_id' => 'PAT-0001', 'date' => '2026-10-07'])->assertStatus(422)->assertJsonValidationErrors('patient_id');
        $this->staffBook(['patient_code' => 'PAT-0001', 'date' => '2026-10-07'])->assertStatus(422)->assertJsonValidationErrors('patient_code');
    }

    public function test_patient_self_booking_derives_the_patient_from_authentication(): void
    {
        $this->actingAsUser('patientA');
        // A Patient cannot name another Patient: spoofed ownership is refused, not silently ignored.
        $this->book(['patient_id' => $this->p['B']->public_id, 'date' => '2026-10-07'])->assertStatus(422)->assertJsonValidationErrors('patient_id');
        $this->book(['date' => '2026-10-07'])->assertCreated()->assertJsonPath('data.patient.id', $this->p['A']->public_id);
        $this->assertSame(1, Appointment::where('patient_id', $this->p['B']->id)->count(), 'Patient B still has only the fixture appointment');
    }
}

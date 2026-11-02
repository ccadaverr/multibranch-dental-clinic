<?php

namespace Tests\Feature\Appointments;

use App\Models\Appointment;
use App\Models\Visit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PatientBookingContractTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
    }

    public function test_omitted_and_null_dentist_use_the_same_assignment_rules_as_availability(): void
    {
        $this->actingAsUser('patientA');
        foreach (['2026-09-29' => [], '2026-09-30' => ['dentist_ref' => null]] as $date => $extra) {
            $slots = $this->getJson("/api/appointments/availability?branch_ref=b1&service_ref=svc1&date={$date}")
                ->assertOk()->json('data.slots');
            $this->book($extra + ['date' => $date])->assertCreated()
                ->assertJsonPath('data.assignment_method', 'auto')
                ->assertJsonPath('data.dentist.id', $slots[0]['dentist']['id']);
        }
    }

    public function test_patient_auto_assignment_revalidates_approved_leave_and_work_hours_at_submission(): void
    {
        $this->actingAsUser('dentist1');
        $leave = $this->postJson('/api/leave', ['type' => 'vacation', 'start_date' => '2026-09-30', 'end_date' => '2026-09-30'])
            ->assertCreated()->json('data.id');
        $this->actingAsUser('owner');
        $this->postJson("/api/leave/{$leave}/decide", ['decision' => 'approve'])->assertOk();
        $this->putJson('/api/work-schedules/d2/weekly', ['branch_ref' => 'b1', 'weekday' => 3, 'start_time' => '13:00', 'end_time' => '17:00'])->assertOk();

        $this->actingAsUser('patientA');
        $slots = $this->getJson('/api/appointments/availability?branch_ref=b1&service_ref=svc1&date=2026-09-30')->assertOk()->json('data.slots');
        $this->assertNotContains('09:00', array_column($slots, 'start_time'));
        $this->book(['date' => '2026-09-30'])->assertStatus(422)->assertJsonPath('code', 'schedule_invalid');
        $this->book(['date' => '2026-09-30', 'start_time' => '13:00'])->assertCreated()->assertJsonPath('data.dentist.id', 'd2');
    }

    public function test_availability_is_a_snapshot_and_an_unavailable_dentist_cannot_be_forced_at_creation(): void
    {
        $this->actingAsUser('patientA');
        $this->getJson('/api/appointments/availability?branch_ref=b1&service_ref=svc2&date=2026-09-29')
            ->assertOk()->assertJsonPath('data.slots.0.dentist.id', 'd1');
        $this->d['d1']->update(['available' => false]);
        $this->book(['service_ref' => 'svc2'])->assertStatus(422)->assertJsonPath('code', 'schedule_invalid');
        $this->book(['service_ref' => 'svc2', 'dentist_ref' => 'd1'])->assertStatus(422)->assertJsonPath('code', 'schedule_invalid');
        $this->assertSame(0, Appointment::count());
    }

    public function test_patient_listing_keeps_future_active_cancelled_and_no_show_states_without_creating_visits(): void
    {
        $this->actingAsUser('patientA');
        $id = $this->book()->assertCreated()->json('data.id');
        $cancelled = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-30', '09:00', 30, 'Cancelled');
        $missed = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-27', '09:00', 30, 'No-show');
        $other = $this->existing('B', 'd2', 'b1', 'svc1', '2026-09-29', '10:00');
        $rows = collect($this->getJson('/api/appointments')->assertOk()->json('data'))->keyBy('id');
        $this->assertSame('Confirmed', $rows[$id]['status']);
        $this->assertSame('Cancelled', $rows[$cancelled->public_id]['status']);
        $this->assertSame('No-show', $rows[$missed->public_id]['status']);
        $this->assertFalse($rows->has($other->public_id));
        $this->getJson("/api/appointments/{$other->public_id}")->assertForbidden();
        $this->assertSame(0, Visit::count());
        $this->getJson('/api/treatments/mine')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_hidden_and_consultation_first_services_do_not_advertise_direct_patient_slots(): void
    {
        foreach (['hidden', 'consultation_first'] as $mode) {
            $this->svc['svc2']->forceFill([
                'online_booking' => $mode,
                'consultation_service_id' => $mode === 'consultation_first' ? $this->svc['svc1']->id : null,
            ])->save();
            $this->assertSame($mode, $this->svc['svc2']->fresh()->online_booking);
            $this->actingAsUser('patientA');
            $this->getJson('/api/appointments/availability?branch_ref=b1&service_ref=svc2&date=2026-09-29')
                ->assertOk()->assertJsonCount(0, 'data.slots');
            $this->getJson('/api/appointments/recommendation?branch_ref=b1&service_ref=svc2')
                ->assertOk()->assertJsonPath('data.recommendation', null);
            $this->book(['service_ref' => 'svc2'])->assertStatus(422)->assertJsonPath('code', 'service_not_bookable_online');
            // Catalog publication changes do not invent a new restriction on an existing appointment's reschedule.
            $date = $mode === 'hidden' ? '2026-09-30' : '2026-10-01';
            $existing = $this->existing('A', 'd1', 'b1', 'svc2', $date, '09:00', 60);
            $existingSlots = $this->getJson("/api/appointments/availability?branch_ref=b1&service_ref=svc2&date={$date}&appointment_id={$existing->public_id}")
                ->assertOk()->json('data.slots');
            $this->assertNotEmpty($existingSlots);
            $this->postJson("/api/appointments/{$existing->public_id}/reschedule", [
                'expected_revision' => 1, 'date' => $date, 'start_time' => '10:00',
            ])->assertOk()->assertJsonPath('data.status', 'Confirmed');
            $this->actingAsUser('staffB1');
            $slots = $this->getJson('/api/appointments/availability?branch_ref=b1&service_ref=svc2&date=2026-09-29')->assertOk()->json('data.slots');
            $this->assertNotEmpty($slots, 'authorized Staff retain the operational scheduling path');
        }
    }
}

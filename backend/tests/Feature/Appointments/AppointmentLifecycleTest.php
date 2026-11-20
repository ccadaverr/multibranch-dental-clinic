<?php

namespace Tests\Feature\Appointments;

use App\Models\Appointment;
use App\Models\AppointmentCommandKey;
use App\Models\AppointmentHistory;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

// Named commands, allowed transitions, append-only history, stale revisions (409), idempotency and the database
// guarantees behind concurrent bookings.
class AppointmentLifecycleTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
    }

    private function url(Appointment $a, string $command): string
    {
        return "/api/appointments/{$a->public_id}/{$command}";
    }

    // ---- STATE ----------------------------------------------------------------------------------------------

    public function test_valid_cancellation_appends_history_and_frees_the_slot(): void
    {
        $this->actingAsUser('patientA');
        $id = $this->book()->assertCreated()->json('data.id');
        $appointment = Appointment::where('public_id', $id)->first();

        $this->postJson($this->url($appointment, 'cancel'), ['expected_revision' => 1])->assertOk()
            ->assertJsonPath('data.status', 'Cancelled')->assertJsonPath('data.revision', 2);
        $this->assertNotNull($appointment->fresh()->cancelled_at);

        $history = $appointment->history()->get();
        $this->assertSame(['appointment.created', 'appointment.cancelled'], $history->pluck('event')->all());
        $this->assertSame(['Confirmed', 'Cancelled'], [$history[1]->from_status, $history[1]->to_status]);
        $this->assertSame('patient', $history[1]->actor_role);

        // Cancelling again is a no-op, not a second transition.
        $this->postJson($this->url($appointment, 'cancel'), ['expected_revision' => 1])->assertOk()->assertJsonPath('data.revision', 2);
        $this->assertSame(2, $appointment->history()->count());

        // The freed slot can be booked again.
        $this->book()->assertCreated();
    }

    public function test_invalid_transitions_are_rejected(): void
    {
        $done = $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-01', '09:00', 30, 'Completed');
        $inTreatment = $this->existing('A', 'd2', 'b1', 'svc1', '2026-10-02', '09:00', 30, 'In Treatment');
        $this->actingAsUser('staffB1');

        $this->postJson($this->url($done, 'cancel'), ['expected_revision' => 1])->assertStatus(422)->assertJsonPath('code', 'appointment_not_cancellable');
        $this->postJson($this->url($inTreatment, 'cancel'), ['expected_revision' => 1])->assertStatus(422)->assertJsonPath('code', 'appointment_not_cancellable');
        $this->postJson($this->url($done, 'reschedule'), ['expected_revision' => 1, 'date' => '2026-10-05', 'start_time' => '10:00'])
            ->assertStatus(422)->assertJsonPath('code', 'appointment_not_reschedulable');
        $this->assertSame(['Completed', 'In Treatment'], [$done->fresh()->status, $inTreatment->fresh()->status]);
    }

    public function test_no_generic_status_mutation_endpoint_exists(): void
    {
        $a = $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-01', '09:00');
        $this->actingAsUser('owner');
        $this->patchJson('/api/appointments/'.$a->public_id, ['status' => 'Completed'])->assertStatus(405);
        $this->putJson('/api/appointments/'.$a->public_id, ['status' => 'Completed'])->assertStatus(405);
        $this->postJson($this->url($a, 'cancel'), ['expected_revision' => 1, 'status' => 'Completed'])->assertStatus(422)->assertJsonValidationErrors('status');
        $this->assertSame('Confirmed', $a->fresh()->status);
    }

    public function test_patient_cannot_cancel_online_after_the_start_time(): void
    {
        $a = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '09:30');
        $this->actingAsUser('patientA');
        $this->postJson($this->url($a, 'cancel'), ['expected_revision' => 1])->assertStatus(422)->assertJsonPath('code', 'appointment_started');

        $this->actingAsUser('staffB1');
        $this->postJson($this->url($a, 'cancel'), ['expected_revision' => 1, 'reason' => 'Patient contacted the front desk'])->assertOk();
    }

    public function test_valid_reschedule_preserves_history(): void
    {
        $this->actingAsUser('patientA');
        $id = $this->book()->assertCreated()->json('data.id');
        $appointment = Appointment::where('public_id', $id)->first();

        $this->postJson($this->url($appointment, 'reschedule'), ['expected_revision' => 1, 'date' => '2026-10-05', 'start_time' => '13:00'])->assertOk()
            ->assertJsonPath('data.status', 'Confirmed')
            ->assertJsonPath('data.revision', 2)
            ->assertJsonPath('data.starts_at', '2026-10-05T13:00:00+08:00')
            ->assertJsonPath('data.dentist.id', 'd1');

        $history = $this->getJson('/api/appointments/'.$id)->assertOk()->json('data.history');
        $this->assertSame(['appointment.created', 'appointment.rescheduled'], array_column($history, 'event'));
        $this->assertSame('2026-09-29T09:00:00+08:00', $history[0]['starts_at'], 'the original schedule is still recorded');
        $this->assertSame('2026-10-05T13:00:00+08:00', $history[1]['starts_at']);
        $opening = \App\Models\SlotOpening::where('appointment_id', $appointment->id)->where('appointment_revision', 1)->sole();
        $this->assertSame('2026-09-29', $opening->dateString());
        $this->assertSame($appointment->dentist_profile_id, $opening->dentist_profile_id);
    }

    public function test_patient_reschedule_changes_only_date_time_within_the_window(): void
    {
        $this->actingAsUser('patientA');
        $appointment = Appointment::where('public_id', $this->book()->json('data.id'))->first();
        $url = $this->url($appointment, 'reschedule');

        $this->postJson($url, ['expected_revision' => 1, 'date' => '2026-10-05', 'start_time' => '13:00', 'dentist_ref' => 'd2'])->assertStatus(422)->assertJsonValidationErrors('dentist_ref');
        $this->postJson($url, ['expected_revision' => 1, 'date' => '2026-10-05', 'start_time' => '13:00', 'branch_ref' => 'b2'])->assertStatus(422)->assertJsonValidationErrors('branch_ref');
        $this->postJson($url, ['expected_revision' => 1, 'date' => '2026-10-30', 'start_time' => '13:00'])->assertStatus(422)->assertJsonPath('failed_checks.0', 'date-window');
        $this->postJson($url, ['expected_revision' => 1, 'date' => '2026-10-05', 'start_time' => '13:30'])->assertStatus(422)->assertJsonPath('failed_checks.0', 'grid');
        $this->assertSame(1, $appointment->fresh()->revision);
    }

    public function test_staff_reschedule_can_move_to_another_eligible_dentist_and_ignores_its_own_slot(): void
    {
        $a = $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-01', '09:00');
        $this->actingAsUser('staffB1');
        // Overlapping its own current slot is not a conflict.
        $this->postJson($this->url($a, 'reschedule'), ['expected_revision' => 1, 'date' => '2026-10-01', 'start_time' => '09:00', 'dentist_ref' => 'd2'])->assertOk()
            ->assertJsonPath('data.dentist.id', 'd2')->assertJsonPath('data.revision', 2);
    }

    public function test_history_is_append_only_in_the_database(): void
    {
        $this->actingAsUser('patientA');
        $this->book()->assertCreated();
        $row = AppointmentHistory::first();

        $this->expectException(QueryException::class);
        DB::table('appointment_history')->where('id', $row->id)->update(['to_status' => 'Completed']);
    }

    public function test_history_rows_cannot_be_deleted(): void
    {
        $this->actingAsUser('patientA');
        $this->book()->assertCreated();

        $this->expectException(QueryException::class);
        DB::table('appointment_history')->delete();
    }

    // ---- REVISION ---------------------------------------------------------------------------------------------

    public function test_stale_reschedule_and_cancel_return_409(): void
    {
        $a = $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-01', '09:00');
        $this->actingAsUser('staffB1');
        $this->postJson($this->url($a, 'reschedule'), ['expected_revision' => 1, 'date' => '2026-10-01', 'start_time' => '10:00'])->assertOk();

        // A second form opened at revision 1 is now stale.
        $this->postJson($this->url($a, 'reschedule'), ['expected_revision' => 1, 'date' => '2026-10-01', 'start_time' => '11:00'])
            ->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        $this->postJson($this->url($a, 'cancel'), ['expected_revision' => 1])->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        $this->assertSame(['10:00', 2, 'Confirmed'], [CarbonImmutable::instance($a->fresh()->starts_at)->setTimezone('Asia/Manila')->format('H:i'), $a->fresh()->revision, $a->fresh()->status]);

        $this->postJson($this->url($a, 'reschedule'), ['date' => '2026-10-01', 'start_time' => '11:00'])->assertStatus(422)->assertJsonValidationErrors('expected_revision');
    }

    // ---- IDEMPOTENCY ------------------------------------------------------------------------------------------

    public function test_duplicate_create_with_the_same_key_and_payload_returns_the_original_result(): void
    {
        $this->actingAsUser('patientA');
        $first = $this->book([], ['Idempotency-Key' => 'book-123'])->assertCreated();
        $second = $this->book([], ['Idempotency-Key' => 'book-123'])->assertCreated()->assertHeader('Idempotent-Replayed', 'true');

        $this->assertSame($first->json('data'), $second->json('data'));
        $this->assertSame(1, Appointment::count());
        $this->assertSame(1, AppointmentHistory::count());
    }

    public function test_reusing_a_key_for_a_different_request_is_rejected(): void
    {
        $this->actingAsUser('patientA');
        $this->book([], ['Idempotency-Key' => 'book-123'])->assertCreated();
        $this->book(['start_time' => '11:00'], ['Idempotency-Key' => 'book-123'])->assertStatus(422)->assertJsonPath('code', 'idempotency_key_reused');
        $this->assertSame(1, Appointment::count());
    }

    public function test_failed_commands_store_no_key_and_keys_are_per_account(): void
    {
        $this->actingAsUser('patientA');
        $this->book(['start_time' => '11:30'], ['Idempotency-Key' => 'k1'])->assertStatus(422);
        $this->assertSame(0, AppointmentCommandKey::count());
        $this->book([], ['Idempotency-Key' => 'k1'])->assertCreated();

        // Another account's identical key is unrelated.
        $this->actingAsUser('patientB');
        $this->book(['start_time' => '10:00'], ['Idempotency-Key' => 'k1'])->assertCreated();
        $this->assertSame(2, Appointment::count());

        $this->book([], ['Idempotency-Key' => str_repeat('x', 256)])->assertStatus(422)->assertJsonValidationErrors('idempotency_key');
    }

    public function test_cancel_and_reschedule_replays_are_idempotent(): void
    {
        $a = $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-01', '09:00');
        $this->actingAsUser('staffB1');
        $body = ['expected_revision' => 1, 'date' => '2026-10-01', 'start_time' => '10:00'];
        $this->withHeaders(['Idempotency-Key' => 'r1'])->postJson($this->url($a, 'reschedule'), $body)->assertOk()->assertJsonPath('data.revision', 2);
        // A network retry of the same reschedule is not a stale-revision error and does not act twice.
        $this->withHeaders(['Idempotency-Key' => 'r1'])->postJson($this->url($a, 'reschedule'), $body)->assertOk()
            ->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.revision', 2);
        // The fixture row was inserted directly (no created event), so only the one reschedule is recorded.
        $this->assertSame(['appointment.rescheduled'], $a->history()->pluck('event')->all());
    }

    // ---- CONCURRENCY (database guarantees) --------------------------------------------------------------------

    public function test_database_rejects_overlapping_active_appointments_for_one_dentist(): void
    {
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-01', '09:00');
        $this->expectException(QueryException::class);
        $this->expectExceptionMessage('appointments_no_dentist_overlap');
        $this->existing('B', 'd1', 'b1', 'svc1', '2026-10-01', '09:15');
    }

    public function test_database_rejects_overlapping_active_appointments_for_one_patient(): void
    {
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-01', '09:00');
        $this->expectException(QueryException::class);
        $this->expectExceptionMessage('appointments_no_patient_overlap');
        $this->existing('A', 'd2', 'b1', 'svc1', '2026-10-01', '09:00');
    }

    public function test_back_to_back_and_terminal_appointments_do_not_conflict_in_the_database(): void
    {
        $this->existing('A', 'd1', 'b1', 'svc1', '2026-10-01', '09:00');
        $this->existing('B', 'd1', 'b1', 'svc1', '2026-10-01', '09:30');
        $this->existing('B', 'd1', 'b1', 'svc1', '2026-10-01', '09:00', 30, 'Cancelled');
        $this->assertSame(3, Appointment::count());
    }

    public function test_a_booking_that_loses_a_race_after_validation_returns_409_and_nothing_is_double_booked(): void
    {
        // Simulates a competing booking of the same Dentist/time landing between this request's validation and its
        // insert (the window an application-only check cannot close). The competitor is written inside the
        // command's own transaction here, so it rolls back with the loser; ConcurrentBookingTest covers two real
        // processes with committed data.
        $competitor = null;
        Appointment::creating(function (Appointment $incoming) use (&$competitor) {
            if ($competitor === null && $incoming->patient_id === $this->p['A']->id) {
                $competitor = $this->existing('B', 'd1', 'b1', 'svc1', '2026-09-29', '09:00');
            }
        });

        $this->actingAsUser('patientA');
        $this->book([], ['Idempotency-Key' => 'race-1'])->assertStatus(409)->assertJsonPath('code', 'schedule_conflict');

        $this->assertNotNull($competitor, 'the competing booking was inserted after validation passed');
        $this->assertSame(0, Appointment::where('patient_id', $this->p['A']->id)->count(), 'the loser was not booked');
        $this->assertSame(0, AppointmentCommandKey::count(), 'the losing command stored no idempotency result');
        $this->assertSame(0, AppointmentHistory::count());
    }
}

<?php

namespace Tests\Feature\Visits;

use App\Models\Appointment;
use App\Models\AppointmentHistory;
use App\Models\Patient;
use App\Models\Person;
use App\Models\User;
use App\Models\Visit;
use App\Models\VisitHistory;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

// M8 Patient Check-In and the shared Visit / Clinical Encounter (CONTRACTS.md §3). The clinic clock is frozen at
// 2026-09-28 10:00 Asia/Manila (SchedulingFixture).
class VisitTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private int $keys = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
    }

    private function key(): string
    {
        return 'key-'.(++$this->keys);
    }

    private function checkIn(Appointment $a, ?int $revision = null, ?string $key = null)
    {
        return $this->postJson('/api/visits/check-in', ['appointment_id' => $a->public_id, 'expected_revision' => $revision ?? $a->fresh()->revision], ['Idempotency-Key' => $key ?? $this->key()]);
    }

    private function walkIn(array $overrides = [], ?string $key = null)
    {
        return $this->postJson('/api/visits/walk-in', $overrides + [
            'patient_id' => $this->p['A']->public_id, 'branch_ref' => 'b1', 'service_ref' => 'svc1', 'dentist_ref' => 'd1',
        ], ['Idempotency-Key' => $key ?? $this->key()]);
    }

    private function step(Visit $v, string $command, ?int $revision = null, array $headers = [])
    {
        return $this->postJson("/api/visits/{$v->public_id}/{$command}", ['expected_revision' => $revision ?? $v->fresh()->revision], $headers);
    }

    /** M5: the Visit's clinical progression runs only through the Treatment commands (start, document, complete). */
    private function treatAndComplete(Visit $v): void
    {
        $this->postJson("/api/visits/{$v->public_id}/treatment", ['expected_revision' => $v->fresh()->revision], ['Idempotency-Key' => $this->key()])->assertCreated();
        $t = $v->fresh()->treatment;
        $this->postJson("/api/treatments/{$t->public_id}/document", ['expected_revision' => 1, 'procedure_summary' => 'Consultation', 'prescription_required' => false,
            'followup_required' => false, 'procedures' => [['service_ref' => 'svc1', 'quantity' => 1]]], ['Idempotency-Key' => $this->key()])->assertOk();
        $this->postJson("/api/treatments/{$t->public_id}/complete", ['expected_revision' => 2], ['Idempotency-Key' => $this->key()])->assertOk();
    }

    /** M9: treatment starts only from a Called queue entry — the current actor calls the Visit's entry. */
    private function callQueue(Visit $v): void
    {
        $entry = $v->fresh()->queueEntry;
        $this->postJson("/api/queue/{$entry->public_id}/call", ['expected_revision' => $entry->revision], ['Idempotency-Key' => $this->key()])->assertOk();
    }

    private function today(string $patient = 'A', string $dentist = 'd1', string $branch = 'b1', string $time = '11:00'): Appointment
    {
        return $this->existing($patient, $dentist, $branch, 'svc1', '2026-09-28', $time);
    }

    // ---- SCHEDULED CHECK-IN -------------------------------------------------------------------------------------

    public function test_scheduled_check_in_moves_the_appointment_and_opens_a_visit_atomically(): void
    {
        $a = $this->today();
        $this->actingAsUser('staffB1');
        $response = $this->checkIn($a)->assertCreated()
            ->assertJsonPath('data.source', 'appointment')->assertJsonPath('data.status', 'Checked In')->assertJsonPath('data.revision', 1)
            ->assertJsonPath('data.clinic_date', '2026-09-28')->assertJsonPath('data.arrived_at', '2026-09-28T10:00:00+08:00')
            ->assertJsonPath('data.patient.id', $this->p['A']->public_id)->assertJsonPath('data.branch.id', 'b1')
            ->assertJsonPath('data.dentist.id', 'd1')->assertJsonPath('data.service.id', 'svc1')
            ->assertJsonPath('data.appointment.id', $a->public_id)->assertJsonPath('data.appointment.status', 'Checked In')
            ->assertJsonPath('data.appointment.revision', 2);

        $visit = Visit::sole();
        $this->assertSame($visit->public_id, $response->json('data.id'));
        $this->assertSame($a->id, $visit->appointment_id);
        $this->assertSame('Checked In', $a->fresh()->status);
        $this->assertSame(['appointment.checked_in'], AppointmentHistory::where('appointment_id', $a->id)->pluck('event')->all());
        $this->assertSame(['visit.checked_in'], VisitHistory::where('visit_id', $visit->id)->pluck('event')->all());
    }

    public function test_check_in_refuses_wrong_date_state_and_stale_revision(): void
    {
        $this->actingAsUser('staffB1');
        $tomorrow = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-29', '11:00');
        $this->checkIn($tomorrow)->assertStatus(422)->assertJsonPath('code', 'not_today');

        $cancelled = $this->existing('B', 'd2', 'b1', 'svc1', '2026-09-28', '12:00', 30, 'Cancelled');
        $this->checkIn($cancelled)->assertStatus(422)->assertJsonPath('code', 'invalid_transition');

        $a = $this->today();
        $this->checkIn($a, 5)->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        $this->assertSame(0, Visit::count());
        $this->assertSame('Confirmed', $a->fresh()->status);
    }

    public function test_ops02_payment_holds_block_pending_and_confirmed_admission_without_writes(): void
    {
        $this->actingAsUser('staffB1');
        foreach (['A' => 'Pending', 'B' => 'Confirmed'] as $patient => $status) {
            $appointment = $this->today($patient, $patient === 'A' ? 'd1' : 'd2');
            $appointment->update(['status' => $status, 'booking_payment_status' => 'held']);
            $before = $appointment->fresh()->getAttributes();
            $this->checkIn($appointment, 1, 'ops02-held-'.$patient)->assertStatus(422)->assertJsonPath('code', 'booking_payment_pending')
                ->assertJsonValidationErrors('booking_payment_status');
            $this->assertSame($before, $appointment->fresh()->getAttributes());
        }
        $this->assertSame(0, Visit::count());
        $this->assertSame(0, VisitHistory::count());
        $this->assertSame(0, AppointmentHistory::count());
        $this->assertSame(0, DB::table('queue_entries')->count());
        $this->assertSame(0, DB::table('queue_entry_history')->count());
        $this->assertSame(0, DB::table('command_keys')->where('command', 'visit.check_in')->count());
    }

    public function test_ops02_unpaid_pay_at_clinic_admission_is_preserved(): void
    {
        $this->actingAsUser('staffB1');
        foreach (['A' => 'Pending', 'B' => 'Confirmed'] as $patient => $status) {
            $appointment = $this->today($patient, $patient === 'A' ? 'd1' : 'd2');
            $appointment->update(['status' => $status, 'booking_payment_status' => 'unpaid']);
            $this->checkIn($appointment)->assertCreated()->assertJsonPath('data.status', 'Checked In');
            $this->assertSame('unpaid', $appointment->fresh()->booking_payment_status);
        }
        $this->assertSame(2, Visit::count());
        $this->assertSame(2, DB::table('queue_entries')->count());
    }

    public function test_ops02_refused_hold_can_retry_after_persisted_payment_confirmation_and_replays_once(): void
    {
        $this->actingAsUser('staffB1');
        $appointment = $this->today();
        $appointment->update(['status' => 'Pending', 'booking_payment_status' => 'held']);
        $key = 'ops02-retry-after-confirmation';
        $this->checkIn($appointment, 1, $key)->assertStatus(422)->assertJsonPath('code', 'booking_payment_pending');
        // Fixture for an independently verified provider confirmation; this test makes no provider call.
        $appointment->update(['status' => 'Confirmed', 'booking_payment_status' => 'paid', 'revision' => 2]);
        $first = $this->checkIn($appointment, 2, $key)->assertCreated();
        $this->checkIn($appointment, 2, $key)->assertCreated()->assertHeader('Idempotent-Replayed', 'true')
            ->assertJsonPath('data.id', $first->json('data.id'));
        $this->assertSame(1, Visit::count());
        $this->assertSame(1, DB::table('queue_entries')->count());
        $this->assertSame(1, AppointmentHistory::where('event', 'appointment.checked_in')->count());
    }

    public function test_duplicate_check_in_replays_with_the_same_key_and_conflicts_with_another(): void
    {
        $a = $this->today();
        $this->actingAsUser('staffB1');
        $first = $this->checkIn($a, 1, 'same')->assertCreated();
        $this->checkIn($a, 1, 'same')->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $first->json('data.id'));
        // A second Staff member (or a new attempt) with the revision they saw: the Visit already exists.
        $this->actingAsUser('staffBoth');
        $this->checkIn($a, 1)->assertStatus(409)->assertJsonPath('code', 'visit_exists');
        $this->checkIn($a, 2)->assertStatus(409)->assertJsonPath('code', 'visit_exists');
        $this->assertSame(1, Visit::count());
        $this->assertSame(1, AppointmentHistory::where('appointment_id', $a->id)->count());
    }

    public function test_check_in_requires_an_idempotency_key(): void
    {
        $a = $this->today();
        $this->actingAsUser('staffB1');
        $this->postJson('/api/visits/check-in', ['appointment_id' => $a->public_id, 'expected_revision' => 1])
            ->assertStatus(422)->assertJsonValidationErrors('idempotency_key');
        $this->assertSame(0, Visit::count());
    }

    public function test_a_failed_visit_insert_rolls_back_the_appointment_check_in(): void
    {
        $a = $this->today();
        $this->actingAsUser('staffB1');
        Visit::creating(fn () => throw new RuntimeException('simulated failure'));
        $this->withoutExceptionHandling();
        try {
            $this->checkIn($a);
            $this->fail('expected the simulated failure');
        } catch (RuntimeException $e) {
            $this->assertSame('simulated failure', $e->getMessage());
        }
        $this->assertSame('Confirmed', $a->fresh()->status);
        $this->assertSame(1, $a->fresh()->revision);
        $this->assertSame(0, AppointmentHistory::count());
        $this->assertSame(0, DB::table('command_keys')->count(), 'a failed command stores no idempotency key');
    }

    public function test_a_failed_appointment_update_creates_no_visit(): void
    {
        $a = $this->today();
        $this->actingAsUser('staffB1');
        Appointment::updating(fn () => throw new RuntimeException('simulated failure'));
        $this->withoutExceptionHandling();
        try {
            $this->checkIn($a);
            $this->fail('expected the simulated failure');
        } catch (RuntimeException) {
        }
        $this->assertSame(0, Visit::count());
        $this->assertSame(0, VisitHistory::count());
    }

    public function test_check_in_authorization(): void
    {
        $a = $this->today();
        $b = $this->today('B', 'd3', 'b2');
        $this->postJson('/api/visits/check-in', ['appointment_id' => $a->public_id, 'expected_revision' => 1], ['Idempotency-Key' => 'x'])->assertUnauthorized();
        $this->actingAsUser('patientA');
        $this->checkIn($a)->assertForbidden();
        $this->actingAsUser('dentist1');
        $this->checkIn($a)->assertForbidden();
        $this->actingAsUser('staffNone');
        $this->checkIn($a)->assertForbidden();
        $this->actingAsUser('staffB1');
        $this->checkIn($b)->assertForbidden();                       // out of scope
        $this->actingAsUser('owner');
        $this->checkIn($b)->assertCreated();                         // documented Owner administrative exception
        $this->assertSame(1, Visit::count());
    }

    // ---- WALK-IN --------------------------------------------------------------------------------------------------

    public function test_walk_in_opens_a_visit_without_any_appointment(): void
    {
        $this->actingAsUser('staffB1');
        $this->walkIn()->assertCreated()->assertJsonPath('data.source', 'walk_in')->assertJsonPath('data.appointment', null)
            ->assertJsonPath('data.status', 'Checked In')->assertJsonPath('data.dentist.id', 'd1')->assertJsonPath('data.service.id', 'svc1')
            ->assertJsonPath('data.patient.id', $this->p['A']->public_id);
        $this->assertSame(0, Appointment::count(), 'a walk-in never creates a fake appointment');
        $this->assertNull(Visit::sole()->appointment_id);
    }

    public function test_walk_in_may_leave_the_dentist_unresolved_and_the_service_optional(): void
    {
        $this->actingAsUser('staffB1');
        $this->walkIn(['dentist_ref' => null])->assertCreated()->assertJsonPath('data.dentist', null)->assertJsonPath('data.service.id', 'svc1');
        $this->walkIn(['patient_id' => $this->p['B']->public_id, 'dentist_ref' => null, 'service_ref' => null])->assertCreated()->assertJsonPath('data.service', null);
        $this->assertSame(2, Visit::whereNull('responsible_dentist_profile_id')->count());
    }

    public function test_walk_in_checks_branch_service_and_dentist_eligibility(): void
    {
        $this->actingAsUser('staffBoth');
        $this->walkIn(['branch_ref' => 'b2', 'service_ref' => 'svc2', 'dentist_ref' => null])
            ->assertStatus(422)->assertJsonPath('code', 'walk_in_invalid')->assertJsonPath('failed_checks', ['branch-service']);
        $this->walkIn(['branch_ref' => 'b2', 'dentist_ref' => 'd1'])->assertStatus(422)->assertJsonPath('failed_checks', ['dentist-eligible']);
        $this->walkIn(['service_ref' => 'svc2', 'dentist_ref' => 'd2'])->assertStatus(422)->assertJsonPath('failed_checks', ['dentist-eligible']);
        $this->walkIn(['service_ref' => null])->assertStatus(422)->assertJsonPath('failed_checks', ['dentist-service']);

        $this->d['d2']->update(['available' => false]);
        $this->walkIn(['dentist_ref' => 'd2'])->assertStatus(422)->assertJsonPath('failed_checks', ['dentist-eligible']);
        $this->d['d1']->update(['shift_start' => '13:00']);
        $this->walkIn()->assertStatus(422)->assertJsonPath('failed_checks', ['dentist-shift']);
        $this->svc['svc1']->update(['status' => 'Inactive']);
        $this->walkIn(['dentist_ref' => null])->assertStatus(422)->assertJsonPath('failed_checks', ['service-active']);
        $this->b['b1']->update(['status' => 'Closed']);
        $this->walkIn(['dentist_ref' => null, 'service_ref' => null])->assertStatus(422)->assertJsonPath('failed_checks', ['branch-open']);
        $this->assertSame(0, Visit::count());
    }

    public function test_walk_in_outside_branch_hours_is_refused(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-09-28 18:30:00', 'Asia/Manila'));
        $this->actingAsUser('staffB1');
        $this->walkIn(['dentist_ref' => null])->assertStatus(422)->assertJsonPath('failed_checks', ['branch-hours']);
    }

    public function test_walk_in_identifies_the_patient_by_public_id_only_and_respects_scope(): void
    {
        $this->actingAsUser('staffB1');
        $this->walkIn(['patient_id' => (string) $this->p['A']->id])->assertNotFound();
        $this->walkIn(['patient_id' => $this->p['A']->patient_code])->assertNotFound();
        $this->walkIn(['appointment_id' => 'x'])->assertStatus(422)->assertJsonValidationErrors('appointment_id');
        $this->walkIn(['branch_ref' => 'b2', 'dentist_ref' => 'd3'])->assertForbidden();
        $this->actingAsUser('dentist1');
        $this->walkIn()->assertForbidden();
        $this->actingAsUser('patientA');
        $this->walkIn()->assertForbidden();
        $this->assertSame(0, Visit::count());
    }

    public function test_duplicate_walk_in_submission_replays_and_a_second_active_visit_is_refused(): void
    {
        $this->actingAsUser('staffB1');
        $first = $this->walkIn([], 'walk-1')->assertCreated();
        $this->walkIn([], 'walk-1')->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $first->json('data.id'));
        $this->walkIn([], 'walk-2')->assertStatus(409)->assertJsonPath('code', 'active_visit_exists');
        $this->walkIn(['dentist_ref' => 'd2'], 'walk-1')->assertStatus(422)->assertJsonPath('code', 'idempotency_key_reused');
        $this->assertSame(1, Visit::count());
    }

    // ---- ACTIVE VISIT UNIQUENESS -----------------------------------------------------------------------------------

    public function test_a_patient_cannot_have_two_active_visits_across_branches(): void
    {
        $this->actingAsUser('staffBoth');
        $this->walkIn(['branch_ref' => 'b1'])->assertCreated();
        $this->walkIn(['branch_ref' => 'b2', 'dentist_ref' => 'd3'])->assertStatus(409)->assertJsonPath('code', 'active_visit_exists');
        // A scheduled Check-In for the same Patient is refused too, and leaves the appointment untouched.
        $a = $this->today('A', 'd3', 'b2');
        $this->checkIn($a)->assertStatus(409)->assertJsonPath('code', 'active_visit_exists');
        $this->assertSame('Confirmed', $a->fresh()->status);
    }

    public function test_after_a_visit_completes_the_patient_may_start_another_the_same_day(): void
    {
        $this->actingAsUser('staffB1');
        $visit = Visit::where('public_id', $this->walkIn()->json('data.id'))->sole();
        $this->actingAsUser('dentist1');
        $this->callQueue($visit);
        $this->treatAndComplete($visit);
        $this->assertSame('Completed', $visit->fresh()->status);
        $this->actingAsUser('staffB1');
        $this->walkIn(['dentist_ref' => 'd2'])->assertCreated()->assertJsonPath('data.clinic_date', '2026-09-28');
        $this->assertSame(2, Visit::where('clinic_date', '2026-09-28')->count());
    }

    public function test_the_database_enforces_visit_integrity(): void
    {
        $a = $this->today();
        $base = ['patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id, 'status' => 'Checked In', 'arrived_at' => now(), 'clinic_date' => '2026-09-28'];
        $attempt = function (array $row) {
            try {
                DB::transaction(fn () => Visit::create($row));
                $this->fail('expected the database to reject '.json_encode(array_keys($row)));
            } catch (QueryException) {
                $this->assertTrue(true);
            }
        };
        $attempt($base + ['source' => 'walk_in', 'appointment_id' => $a->id]);        // walk-in with an appointment
        $attempt($base + ['source' => 'appointment', 'appointment_id' => null]);       // scheduled without one
        $attempt(['status' => 'No-show', 'source' => 'walk_in'] + $base);             // not a Visit state
        $attempt(['status' => 'Completed', 'source' => 'walk_in'] + $base);           // Completed needs closed_at

        Visit::create($base + ['source' => 'appointment', 'appointment_id' => $a->id]);
        $attempt(['patient_id' => $this->p['B']->id, 'source' => 'appointment', 'appointment_id' => $a->id] + $base); // one per appointment
        $attempt($base + ['source' => 'walk_in']);                                     // second active Visit
    }

    // ---- CLINICAL LIFECYCLE -----------------------------------------------------------------------------------------
    // The Visit's clinical progression is covered by tests/Feature/Treatments (M5 owns start / complete atomically).

    public function test_the_standalone_visit_start_and_complete_commands_are_retired(): void
    {
        $this->actingAsUser('staffB1');
        $visit = Visit::where('public_id', $this->walkIn()->json('data.id'))->sole();
        $this->actingAsUser('dentist1');
        $this->callQueue($visit);
        foreach (['start-treatment', 'complete', 'no-show', 'cancel'] as $retired) {
            $this->step($visit, $retired, null, ['Idempotency-Key' => $this->key()])->assertNotFound();
        }
        $this->assertSame('Checked In', $visit->fresh()->status);
        $this->assertSame(1, VisitHistory::where('visit_id', $visit->id)->count());
    }

    // ---- READ ACCESS / SHAPE ----------------------------------------------------------------------------------------

    public function test_visit_reads_are_scoped_and_expose_public_ids_only(): void
    {
        $this->getJson('/api/visits')->assertUnauthorized();
        $this->actingAsUser('staffB1');
        $mine = $this->walkIn()->json('data.id');
        $this->actingAsUser('staffB2');
        $theirs = $this->walkIn(['patient_id' => $this->p['B']->public_id, 'branch_ref' => 'b2', 'dentist_ref' => 'd3'])->json('data.id');

        $this->actingAsUser('staffB1');
        $this->getJson('/api/visits')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $mine);
        $this->getJson("/api/visits/{$theirs}")->assertForbidden();
        $this->actingAsUser('dentist1');
        $this->getJson('/api/visits')->assertOk()->assertJsonCount(1, 'data');
        $this->actingAsUser('dentist3');
        $this->getJson("/api/visits/{$mine}")->assertForbidden();
        $this->actingAsUser('owner');
        $body = $this->getJson('/api/visits?date=2026-09-28')->assertOk()->assertJsonCount(2, 'data')->json();
        $this->getJson("/api/visits/{$mine}")->assertOk()->assertJsonPath('data.history.0.event', 'visit.checked_in');
        $this->getJson('/api/visits?date=2026-09-27')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/visits?from=2026-01-01&to=2026-12-31')->assertStatus(422)->assertJsonValidationErrors('to');
        $this->actingAsUser('patientA');
        $this->getJson('/api/visits')->assertForbidden();
        $this->getJson("/api/visits/{$mine}")->assertForbidden();

        $json = json_encode($body);
        foreach (['patient_id', 'branch_id', 'appointment_id', 'responsible_dentist_profile_id', 'person_id', 'created_by_user_id'] as $internal) {
            $this->assertStringNotContainsString("\"{$internal}\"", $json);
        }
        $this->assertMatchesRegularExpression('/^[0-9a-hjkmnp-tv-z]{26}$/', $mine);
    }

    public function test_visit_history_is_append_only(): void
    {
        $this->actingAsUser('staffB1');
        $this->walkIn()->assertCreated();
        $this->expectException(QueryException::class);
        DB::table('visit_history')->update(['event' => 'tampered']);
    }

    // ---- MINIMAL FRONT-DESK PATIENT REGISTRATION ----------------------------------------------------------------------

    private function register(array $overrides = [], ?string $key = null)
    {
        return $this->postJson('/api/patients', $overrides + [
            'first_name' => 'Walk', 'last_name' => 'In', 'phone' => '+639171234567', 'date_of_birth' => '1990-05-01',
        ], ['Idempotency-Key' => $key ?? $this->key()]);
    }

    public function test_front_desk_registration_creates_a_person_and_patient_without_a_login(): void
    {
        $this->actingAsUser('staffB1');
        $users = User::count();
        $response = $this->register(['email' => 'Walk.In@Example.test'], 'reg-1')->assertCreated()
            ->assertJsonPath('data.name', 'Walk In')->assertJsonPath('data.phone', '+639171234567')->assertJsonPath('data.date_of_birth', '1990-05-01');
        $patient = Patient::where('public_id', $response->json('data.id'))->sole();
        $this->assertSame('walk.in@example.test', $patient->person->email);
        $this->assertSame($users, User::count(), 'no User/login account is created');
        $this->assertSame(0, User::where('person_id', $patient->person_id)->count());
        // Replay returns the same Patient; the new Patient is immediately usable for a walk-in.
        $this->register(['email' => 'Walk.In@Example.test'], 'reg-1')->assertCreated()->assertJsonPath('data.id', $patient->public_id);
        $this->walkIn(['patient_id' => $patient->public_id])->assertCreated();
        $this->assertSame(1, Patient::where('person_id', $patient->person_id)->count());
    }

    public function test_registration_refuses_an_existing_email_without_matching_or_merging(): void
    {
        Person::factory()->create(['email' => 'taken@example.test']);
        $this->actingAsUser('owner');
        $before = Patient::count();
        $this->register(['email' => 'TAKEN@example.test'])->assertStatus(422)->assertJsonPath('code', 'patient_email_exists');
        // Same name/phone/date of birth as an existing Patient is NOT fuzzy-matched: a new record is created.
        $this->register(['first_name' => $this->p['A']->person->first_name, 'last_name' => $this->p['A']->person->last_name])->assertCreated();
        $this->assertSame($before + 1, Patient::count());
    }

    public function test_registration_authorization_and_privileged_fields(): void
    {
        $this->postJson('/api/patients', ['first_name' => 'A', 'last_name' => 'B'], ['Idempotency-Key' => 'x'])->assertUnauthorized();
        foreach (['patientA', 'dentist1', 'staffNone'] as $who) {
            $this->actingAsUser($who);
            $this->register()->assertForbidden();
        }
        $this->actingAsUser('staffB1');
        $this->register(['password' => 'secret123'])->assertStatus(422)->assertJsonValidationErrors('password');
        $this->register(['patient_code' => 'PAT-9999'])->assertStatus(422)->assertJsonValidationErrors('patient_code');
        $this->postJson('/api/patients', ['first_name' => 'A', 'last_name' => 'B'])->assertStatus(422)->assertJsonValidationErrors('idempotency_key');
    }
}

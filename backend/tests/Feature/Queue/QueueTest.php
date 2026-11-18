<?php

namespace Tests\Feature\Queue;

use App\Models\Appointment;
use App\Models\AppointmentHistory;
use App\Models\QueueEntry;
use App\Models\QueueEntryHistory;
use App\Models\Visit;
use App\Services\Queue\QueueBackfill;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

// M9 Patient Queue Management, anchored to the Visit. Clock frozen at 2026-09-28 10:00 Asia/Manila (SchedulingFixture).
class QueueTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private int $keys = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
        [, $this->p['C']] = $this->patient('PAT-0003');
        [, $this->p['D']] = $this->patient('PAT-0004');
    }

    private function key(): string
    {
        return 'q-'.(++$this->keys);
    }

    private function walkIn(string $patient, string $dentist = 'd1', string $branch = 'b1', ?string $key = null)
    {
        return $this->postJson('/api/visits/walk-in', ['patient_id' => $this->p[$patient]->public_id, 'branch_ref' => $branch, 'service_ref' => 'svc1', 'dentist_ref' => $dentist],
            ['Idempotency-Key' => $key ?? $this->key()]);
    }

    private function entryFor(string $patient): QueueEntry
    {
        return QueueEntry::whereHas('visit', fn ($q) => $q->where('patient_id', $this->p[$patient]->id))->sole();
    }

    private function command(QueueEntry $e, string $command, ?int $revision = null, ?string $key = null, array $extra = [])
    {
        return $this->postJson("/api/queue/{$e->public_id}/{$command}", ['expected_revision' => $revision ?? $e->fresh()->revision] + $extra, ['Idempotency-Key' => $key ?? $this->key()]);
    }

    private function start(Visit $v)
    {
        // M5: the atomic Treatment start command Serves the queue entry.
        return $this->postJson("/api/visits/{$v->public_id}/treatment", ['expected_revision' => $v->fresh()->revision], ['Idempotency-Key' => $this->key()]);
    }

    /** @return array<string,int> Patient key => position */
    private function positions(): array
    {
        $rows = $this->getJson('/api/queue')->assertOk()->json('data');
        $byPatient = array_flip(array_map(fn ($p) => $p->public_id, $this->p));

        return collect($rows)->mapWithKeys(fn ($r) => [$byPatient[$r['patient']['id']] => $r['position']])->all();
    }

    // ---- CREATION ------------------------------------------------------------------------------------------------

    public function test_scheduled_arrival_creates_visit_and_queue_entry_atomically(): void
    {
        $a = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '11:00');
        $this->actingAsUser('staffB1');
        $response = $this->postJson('/api/visits/check-in', ['appointment_id' => $a->public_id, 'expected_revision' => 1], ['Idempotency-Key' => 'arrive'])
            ->assertCreated()->assertJsonPath('data.queue.status', 'Waiting')->assertJsonPath('data.queue.queue_number', 1);
        $entry = QueueEntry::sole();
        $this->assertSame($response->json('data.queue.id'), $entry->public_id);
        $this->assertSame(Visit::sole()->id, $entry->visit_id);
        $this->assertSame(['Waiting', 'Normal', 1], [$entry->status, $entry->priority, $entry->revision]);
        $this->assertSame(['queue.entered'], QueueEntryHistory::pluck('event')->all());
    }

    public function test_walk_in_with_dentist_is_queued_and_without_dentist_is_not(): void
    {
        $this->actingAsUser('staffB1');
        $this->walkIn('A')->assertCreated()->assertJsonPath('data.queue.status', 'Waiting');
        $this->postJson('/api/visits/walk-in', ['patient_id' => $this->p['B']->public_id, 'branch_ref' => 'b1', 'service_ref' => 'svc1'], ['Idempotency-Key' => 'nod'])
            ->assertCreated()->assertJsonPath('data.dentist', null)->assertJsonPath('data.queue', null);
        $this->assertSame(1, QueueEntry::count());
        $this->assertSame(2, Visit::count());
    }

    public function test_a_failed_queue_insert_rolls_back_the_whole_arrival(): void
    {
        $a = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '11:00');
        $this->actingAsUser('staffB1');
        QueueEntry::creating(fn () => throw new RuntimeException('queue insert failed'));
        $this->withoutExceptionHandling();
        try {
            $this->postJson('/api/visits/check-in', ['appointment_id' => $a->public_id, 'expected_revision' => 1], ['Idempotency-Key' => 'x']);
            $this->fail('expected the simulated failure');
        } catch (RuntimeException) {
        }
        $this->assertSame(['Confirmed', 1], [$a->fresh()->status, $a->fresh()->revision]);
        $this->assertSame(0, Visit::count());
        $this->assertSame(0, AppointmentHistory::count());
        $this->assertSame(0, DB::table('dentist_queues')->count(), 'the counter upsert rolled back too');
        $this->assertSame(0, DB::table('command_keys')->count());
    }

    public function test_the_database_enforces_one_entry_per_visit_and_valid_values(): void
    {
        $this->actingAsUser('staffB1');
        $this->walkIn('A')->assertCreated();
        $entry = QueueEntry::sole();
        $attempt = function (array $changes) use ($entry) {
            try {
                DB::transaction(fn () => QueueEntry::create(array_merge($entry->only(['visit_id', 'dentist_queue_id', 'status', 'priority']), ['queue_number' => 99], $changes)));
                $this->fail('expected the database to reject '.json_encode($changes));
            } catch (QueryException) {
                $this->assertTrue(true);
            }
        };
        $attempt([]);                                                          // second entry for the same Visit
        $visitB = Visit::create(['patient_id' => $this->p['B']->id, 'branch_id' => $this->b['b1']->id, 'source' => 'walk_in', 'status' => 'Checked In', 'arrived_at' => now(), 'clinic_date' => '2026-09-28']);
        $attempt(['visit_id' => $visitB->id, 'queue_number' => 1]);           // number already used in this queue
        $attempt(['visit_id' => $visitB->id, 'queue_number' => 0]);           // numbers start at 1
        foreach (['Unknown', 'Completed', 'Booked'] as $status) {
            $attempt(['visit_id' => $visitB->id, 'status' => $status]);       // not queue states
        }
        $attempt(['visit_id' => $visitB->id, 'status' => 'Served']);          // Served needs closed_at
        $attempt(['visit_id' => $visitB->id, 'priority' => 'Emergency']);
    }

    // ---- NUMBERING -------------------------------------------------------------------------------------------------

    public function test_numbers_start_at_one_per_branch_dentist_and_clinic_day(): void
    {
        $this->actingAsUser('staffB1');
        $this->walkIn('A', 'd1')->assertJsonPath('data.queue.queue_number', 1);
        $this->walkIn('B', 'd1')->assertJsonPath('data.queue.queue_number', 2);
        $this->walkIn('C', 'd2')->assertJsonPath('data.queue.queue_number', 1);   // another Dentist: its own sequence
        $this->travelTo(CarbonImmutable::parse('2026-09-29 10:00:00', 'Asia/Manila'));
        $this->walkIn('D', 'd1')->assertJsonPath('data.queue.queue_number', 1)->assertJsonPath('data.clinic_date', '2026-09-29');
        $this->assertSame(3, DB::table('dentist_queues')->count());
        $this->assertSame(0, QueueEntry::where('queue_number', '<', 1)->count());
    }

    // ---- ORDERING / PRIORITY ---------------------------------------------------------------------------------------

    public function test_order_is_exact_arrival_then_queue_number_even_when_priority_changes(): void
    {
        $this->actingAsUser('staffB1');
        foreach (['A', 'B', 'C', 'D'] as $i => $patient) {
            $this->travelTo(CarbonImmutable::parse('2026-09-28 10:00:00', 'Asia/Manila')->addSeconds($i));
            $this->walkIn($patient)->assertCreated();
        }
        $this->assertEquals(['A' => 1, 'B' => 2, 'C' => 3, 'D' => 4], $this->positions());

        // Exact arrival ties fall back to the unique queue number.
        Visit::query()->update(['arrived_at' => CarbonImmutable::parse('2026-09-28 10:00:00', 'Asia/Manila')]);
        $this->assertEquals(['A' => 1, 'B' => 2, 'C' => 3, 'D' => 4], $this->positions());

        $this->command($this->entryFor('C'), 'priority', null, null, ['priority' => 'Priority', 'reason' => 'Front desk: accessibility need'])->assertOk()->assertJsonPath('data.position', 3);
        $this->command($this->entryFor('D'), 'priority', null, null, ['priority' => 'Priority', 'reason' => 'Front desk: elderly patient'])->assertOk();
        $this->assertEquals(['A' => 1, 'B' => 2, 'C' => 3, 'D' => 4], $this->positions());

        // Temporarily Away has no position; returning keeps the original arrival order.
        $this->command($this->entryFor('A'), 'away')->assertOk()->assertJsonPath('data.position', null);
        $this->assertEquals(['A' => null, 'B' => 1, 'C' => 2, 'D' => 3], $this->positions());
        $this->command($this->entryFor('A'), 'return')->assertOk()->assertJsonPath('data.status', 'Waiting');
        $this->assertEquals(['A' => 1, 'B' => 2, 'C' => 3, 'D' => 4], $this->positions());
    }

    public function test_call_respects_fifo_within_the_exact_dentist_queue(): void
    {
        $this->actingAsUser('staffB1');
        $this->walkIn('A')->assertCreated();
        $this->walkIn('B')->assertCreated();
        $this->walkIn('C', 'd2')->assertCreated();
        $next = $this->entryFor('B');
        $this->command($next, 'call')->assertStatus(422)->assertJsonPath('code', 'queue_out_of_order');
        $this->assertSame(['Waiting', 1], [$next->fresh()->status, $next->fresh()->revision]);
        $this->command($this->entryFor('C'), 'call')->assertOk();
        $this->command($this->entryFor('A'), 'call')->assertOk();
        $this->command($next, 'call')->assertOk()->assertJsonPath('data.status', 'Called');
    }

    public function test_priority_is_staff_or_owner_only_needs_a_reason_and_is_recorded(): void
    {
        $this->actingAsUser('staffB1');
        $this->walkIn('A')->assertCreated();
        $entry = $this->entryFor('A');
        $this->command($entry, 'priority', null, null, ['priority' => 'Priority', 'reason' => '   '])->assertStatus(422)->assertJsonValidationErrors('reason');
        $this->command($entry, 'priority', null, null, ['priority' => 'Emergency', 'reason' => 'x'])->assertStatus(422)->assertJsonValidationErrors('priority');
        $this->command($entry, 'priority', null, null, ['priority' => 'Urgent', 'reason' => 'x'])->assertStatus(422)->assertJsonValidationErrors('priority');
        $this->actingAsUser('dentist1');
        $this->command($entry, 'priority', null, null, ['priority' => 'Priority', 'reason' => 'x'])->assertForbidden();
        $this->actingAsUser('owner');
        $this->command($entry, 'priority', null, null, ['priority' => 'Priority', 'reason' => 'Front desk request'])->assertOk()
            ->assertJsonPath('data.priority', 'Priority')->assertJsonPath('data.status', 'Waiting');
        $history = QueueEntryHistory::where('event', 'queue.priority_changed')->sole();
        $this->assertSame(['Normal', 'Priority', 'Front desk request', 'Waiting', 'Waiting'], [$history->from_priority, $history->to_priority, $history->priority_reason, $history->from_status, $history->to_status]);
    }

    public function test_priority_does_not_reorder_patients_already_called_or_treatment_ready(): void
    {
        $this->actingAsUser('staffB1');
        foreach (['A', 'B', 'C'] as $i => $patient) {
            $this->travelTo(CarbonImmutable::parse('2026-09-28 10:00:00', 'Asia/Manila')->addSeconds($i));
            $this->walkIn($patient)->assertCreated();
        }
        $entryA = $this->entryFor('A');
        $entryC = $this->entryFor('C');

        // Call patient A: A is now Called at position 1.
        $this->command($entryA, 'call')->assertOk()->assertJsonPath('data.status', 'Called');

        // STF-15: a supported priority label never moves C ahead of earlier arrivals A or B.
        $this->command($entryC, 'priority', null, null, [
            'priority' => 'Priority',
            'reason' => 'Senior citizen priority [Senior Citizen · ID/eligibility verified]',
        ])->assertOk()->assertJsonPath('data.position', 3);
        $this->assertEquals(['A' => 1, 'B' => 2, 'C' => 3], $this->positions());

        // Attempting to change priority on a patient already Called or Treatment Ready is rejected.
        $this->command($entryA, 'priority', null, null, [
            'priority' => 'Priority',
            'reason' => 'Late priority attempt',
        ])->assertStatus(422)->assertJsonPath('code', 'already_called');

        $this->command($entryA, 'ready')->assertOk()->assertJsonPath('data.status', 'Treatment Ready');
        $this->assertEquals(['A' => 1, 'B' => 2, 'C' => 3], $this->positions());
        $this->command($entryA, 'priority', null, null, [
            'priority' => 'Priority',
            'reason' => 'Late priority attempt',
        ])->assertStatus(422)->assertJsonPath('code', 'already_called');
    }

    // ---- STATE -----------------------------------------------------------------------------------------------------

    public function test_transition_table(): void
    {
        $this->actingAsUser('staffB1');
        $this->walkIn('A')->assertCreated();
        $e = $this->entryFor('A');
        $this->command($e, 'ready')->assertStatus(422)->assertJsonPath('code', 'invalid_transition');
        // Asking for the state the entry is already in is a safe no-op (as for M6/M8 commands): no change, no history.
        $this->command($e, 'return')->assertOk()->assertJsonPath('data.status', 'Waiting')->assertJsonPath('data.revision', 1);
        $this->command($e, 'call')->assertOk()->assertJsonPath('data.status', 'Called');
        $this->command($e, 'ready')->assertOk()->assertJsonPath('data.status', 'Treatment Ready');
        $this->command($e, 'away')->assertOk()->assertJsonPath('data.status', 'Temporarily Away');
        $this->command($e, 'call')->assertStatus(422)->assertJsonPath('code', 'invalid_transition');
        $this->command($e, 'return')->assertOk()->assertJsonPath('data.status', 'Waiting');
        foreach (['serve', 'no-show', 'complete', 'in-treatment', 'cancel'] as $retired) {
            $this->command($e, $retired)->assertNotFound();
        }
        $this->assertSame(['queue.entered', 'queue.called', 'queue.ready', 'queue.away', 'queue.returned'], QueueEntryHistory::orderBy('id')->pluck('event')->all());
    }

    public function test_only_todays_queue_can_be_operated(): void
    {
        $this->actingAsUser('staffB1');
        $this->walkIn('A')->assertCreated();
        $entry = $this->entryFor('A');
        $this->travelTo(CarbonImmutable::parse('2026-09-29 10:00:00', 'Asia/Manila'));
        $this->command($entry, 'call')->assertStatus(422)->assertJsonPath('code', 'not_today');
        $this->command($entry, 'priority', null, null, ['priority' => 'Priority', 'reason' => 'x'])->assertStatus(422)->assertJsonPath('code', 'not_today');
        $this->getJson('/api/queue')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/queue?date=2026-09-28')->assertOk()->assertJsonCount(1, 'data')
            // M9: the bounded list states whether it was cut off, so clients never treat a cut-off day as complete.
            ->assertJsonPath('meta.limit', 500)->assertJsonPath('meta.returned', 1)->assertJsonPath('meta.truncated', false);
    }

    // ---- TREATMENT HANDOFF -----------------------------------------------------------------------------------------

    public function test_start_treatment_serves_the_entry_and_moves_visit_and_appointment_together(): void
    {
        $a = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '11:00');
        $this->actingAsUser('staffB1');
        $this->postJson('/api/visits/check-in', ['appointment_id' => $a->public_id, 'expected_revision' => 1], ['Idempotency-Key' => 'arrive'])->assertCreated();
        $visit = Visit::sole();
        $entry = $this->entryFor('A');

        $this->actingAsUser('dentist1');
        $this->start($visit)->assertStatus(422)->assertJsonPath('code', 'queue_not_ready');   // still Waiting
        $this->command($entry, 'call')->assertOk();                                              // the queue's own Dentist may Call
        $this->start($visit)->assertCreated()->assertJsonPath('data.status', 'In Treatment')->assertJsonPath('data.visit.status', 'In Treatment')
            ->assertJsonPath('data.visit.queue.status', 'Served')->assertJsonPath('data.appointment.status', 'In Treatment');
        $this->assertSame(['Served', 'In Treatment', 'In Treatment'], [$entry->fresh()->status, $visit->fresh()->status, $a->fresh()->status]);
        $this->assertNotNull($entry->fresh()->closed_at);
        $this->assertSame(1, QueueEntryHistory::where('event', 'queue.served')->count());

        // Completion moves Visit and appointment; the queue stays terminal Served.
        $treatment = $visit->fresh()->treatment;
        $this->postJson("/api/treatments/{$treatment->public_id}/document", ['expected_revision' => 1, 'procedure_summary' => 'Consultation', 'prescription_required' => false,
            'followup_required' => false, 'procedures' => [['service_ref' => 'svc1', 'quantity' => 1]]], ['Idempotency-Key' => 'doc'])->assertOk();
        $this->postJson("/api/treatments/{$treatment->public_id}/complete", ['expected_revision' => 2], ['Idempotency-Key' => 'done'])->assertOk()
            ->assertJsonPath('data.status', 'Completed')->assertJsonPath('data.visit.status', 'Completed');
        $this->assertSame(['Served', 3], [$entry->fresh()->status, $entry->fresh()->revision]);
        $this->actingAsUser('staffB1');
        $this->command($entry, 'away')->assertStatus(422)->assertJsonPath('code', 'queue_closed');
    }

    public function test_a_failure_while_serving_rolls_back_visit_and_appointment(): void
    {
        $a = $this->existing('A', 'd1', 'b1', 'svc1', '2026-09-28', '11:00');
        $this->actingAsUser('staffB1');
        $this->postJson('/api/visits/check-in', ['appointment_id' => $a->public_id, 'expected_revision' => 1], ['Idempotency-Key' => 'arrive'])->assertCreated();
        $this->command($this->entryFor('A'), 'call')->assertOk();
        $this->actingAsUser('dentist1');
        QueueEntryHistory::creating(fn (QueueEntryHistory $h) => $h->event === 'queue.served' ? throw new RuntimeException('history failed') : null);
        $this->withoutExceptionHandling();
        try {
            $this->start(Visit::sole());
            $this->fail('expected the simulated failure');
        } catch (RuntimeException) {
        }
        $this->assertSame(['Checked In', 'Checked In', 'Called'], [Visit::sole()->status, $a->fresh()->status, $this->entryFor('A')->status]);
    }

    public function test_staff_changing_the_entry_races_the_dentist_start_safely(): void
    {
        $this->actingAsUser('staffB1');
        $this->walkIn('A')->assertCreated();
        $entry = $this->entryFor('A');
        $this->command($entry, 'call')->assertOk();
        // The Dentist opened the encounter at revision 2 (Called); Staff mark the Patient away first.
        $this->command($entry, 'away', 2)->assertOk();
        $this->actingAsUser('dentist1');
        $this->start(Visit::sole())->assertStatus(422)->assertJsonPath('code', 'queue_not_ready');
        $this->assertSame(['Checked In', 'Temporarily Away'], [Visit::sole()->status, $entry->fresh()->status]);
    }

    // ---- CONCURRENCY / IDEMPOTENCY ---------------------------------------------------------------------------------

    public function test_stale_revisions_replays_key_reuse_and_missing_keys(): void
    {
        $this->actingAsUser('staffB1');
        $this->walkIn('A')->assertCreated();
        $e = $this->entryFor('A');
        $this->command($e, 'call', 5)->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        $this->command($e, 'call', 1, 'same')->assertOk()->assertJsonPath('data.revision', 2);
        $this->command($e, 'call', 1, 'same')->assertOk()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.revision', 2);
        $this->assertSame(1, QueueEntryHistory::where('event', 'queue.called')->count(), 'a replay never duplicates history');
        $this->command($e, 'away', 2, 'same')->assertStatus(422)->assertJsonPath('code', 'idempotency_key_reused');
        // A second Staff member acting on the revision they saw loses cleanly.
        $this->actingAsUser('staffBoth');
        $this->command($e, 'ready', 2)->assertOk();
        $this->actingAsUser('staffB1');
        $this->command($e, 'away', 2)->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        $this->postJson("/api/queue/{$e->public_id}/away", ['expected_revision' => 3])->assertStatus(422)->assertJsonValidationErrors('idempotency_key');
    }

    public function test_a_duplicate_arrival_creates_no_second_entry(): void
    {
        $this->actingAsUser('staffB1');
        $this->walkIn('A', 'd1', 'b1', 'same-arrival')->assertCreated();
        $this->walkIn('A', 'd1', 'b1', 'same-arrival')->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
        $this->walkIn('A', 'd2')->assertStatus(409)->assertJsonPath('code', 'active_visit_exists');
        $this->assertSame([1, 1], [Visit::count(), QueueEntry::count()]);
    }

    // ---- AUTHORIZATION / READ SHAPE ---------------------------------------------------------------------------------

    public function test_queue_authorization(): void
    {
        $this->getJson('/api/queue')->assertUnauthorized();
        $this->actingAsUser('staffB1');
        $this->walkIn('A', 'd1')->assertCreated();
        $this->actingAsUser('staffB2');
        $this->walkIn('B', 'd3', 'b2')->assertCreated();
        $a = $this->entryFor('A');
        $b = $this->entryFor('B');

        $this->actingAsUser('staffB1');
        $this->getJson('/api/queue')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $a->public_id);
        $this->getJson("/api/queue/{$b->public_id}")->assertForbidden();
        $this->command($b, 'call')->assertForbidden();
        $this->actingAsUser('dentist1');
        $this->getJson('/api/queue')->assertOk()->assertJsonCount(1, 'data');
        $this->command($a, 'ready')->assertForbidden();
        $this->command($a, 'away')->assertForbidden();
        $this->actingAsUser('dentist2');
        $this->command($a, 'call')->assertForbidden();
        $this->getJson("/api/queue/{$a->public_id}")->assertForbidden();
        $this->actingAsUser('patientA');
        $this->getJson('/api/queue')->assertForbidden();
        $this->getJson("/api/queue/{$a->public_id}")->assertForbidden();
        $this->command($a, 'call')->assertForbidden();
        $this->actingAsUser('owner');
        $body = $this->getJson('/api/queue')->assertOk()->assertJsonCount(2, 'data')->json();
        $this->command($b, 'call')->assertOk();
        $this->start(Visit::where('patient_id', $this->p['B']->id)->sole())->assertForbidden();   // Owner: no clinical start

        $json = json_encode($body);
        foreach (['visit_id', 'dentist_queue_id', 'patient_id', 'branch_id', 'person_id'] as $internal) {
            $this->assertStringNotContainsString("\"{$internal}\"", $json);
        }
        $this->assertMatchesRegularExpression('/^[0-9a-hjkmnp-tv-z]{26}$/', $a->public_id);
    }

    // ---- PATIENT OWN QUEUE -------------------------------------------------------------------------------------------

    public function test_patient_sees_only_their_own_current_queue_state(): void
    {
        $this->actingAsUser('patientA');
        $this->getJson('/api/queue/mine')->assertOk()->assertJsonPath('data', null);

        $this->actingAsUser('staffB1');
        $this->walkIn('B')->assertCreated();
        $this->travelTo(CarbonImmutable::parse('2026-09-28 10:05:00', 'Asia/Manila'));
        $this->walkIn('A')->assertCreated();

        $this->actingAsUser('patientA');
        $mine = $this->getJson('/api/queue/mine?patient_id='.$this->p['B']->public_id)->assertOk()
            ->assertJsonPath('data.phase', 'waiting')->assertJsonPath('data.queue_number', 2)->assertJsonPath('data.position', 2)->json('data');
        $this->assertSame(['phase', 'queue_status', 'queue_number', 'position', 'clinic_date', 'arrived_at', 'branch', 'dentist', 'service', 'appointment'], array_keys($mine));
        $json = json_encode($mine);
        $this->assertStringNotContainsString($this->p['B']->public_id, $json);
        $this->assertStringNotContainsString((string) $this->p['B']->person->last_name, $json);
        $this->assertStringNotContainsString('wait', strtolower(implode(',', array_keys($mine))), 'no backend wait estimate');

        $this->actingAsUser('dentist1');
        $this->command($this->entryFor('B'), 'call')->assertOk();
        $this->command($this->entryFor('A'), 'call')->assertOk();
        $this->start(Visit::where('patient_id', $this->p['A']->id)->sole())->assertCreated();
        $this->actingAsUser('patientA');
        $this->getJson('/api/queue/mine')->assertOk()->assertJsonPath('data.phase', 'in-treatment')->assertJsonPath('data.queue_status', 'Served')->assertJsonPath('data.position', null);

        $this->actingAsUser('staffB1');
        $this->getJson('/api/queue/mine')->assertForbidden();
    }

    // ---- BACKFILL ----------------------------------------------------------------------------------------------------

    public function test_backfill_uses_server_visits_only_is_idempotent_and_cannot_erase_history(): void
    {
        $visit = fn (string $patient, string $dentist, string $status, string $at) => Visit::create([
            'patient_id' => $this->p[$patient]->id, 'branch_id' => $this->b['b1']->id, 'source' => 'walk_in', 'status' => $status,
            'responsible_dentist_profile_id' => $dentist ? $this->d[$dentist]->id : null, 'arrived_at' => CarbonImmutable::parse("2026-09-28 {$at}", 'Asia/Manila'),
            'clinic_date' => '2026-09-28', 'closed_at' => $status === 'Completed' ? now() : null,
        ]);
        $late = $visit('A', 'd1', 'Checked In', '09:40');
        $early = $visit('B', 'd1', 'Checked In', '09:10');
        $treating = $visit('C', 'd2', 'In Treatment', '09:00');
        DB::table('visit_history')->insert(['visit_id' => $treating->id, 'event' => 'visit.treatment_started', 'from_status' => 'Checked In', 'to_status' => 'In Treatment',
            // Query Builder bypasses VisitHistory's offset-aware model dateFormat.
            'revision' => 2, 'occurred_at' => CarbonImmutable::parse('2026-09-28 09:20', 'Asia/Manila')->toIso8601String()]);
        $missing = $visit('D', 'd2', 'In Treatment', '09:05');
        $visit('A', 'd1', 'Completed', '08:00');
        [, $this->p['E']] = $this->patient('PAT-0005');
        $visit('E', '', 'Checked In', '09:30');

        $report = app(QueueBackfill::class)->run();
        $this->assertSame(3, $report['created']);
        $this->assertSame([[$missing->public_id, 'missing_treatment_started_event']], array_map(fn ($r) => [$r['visit'], $r['reason']], $report['anomalies']));
        $this->assertSame([1, 'Waiting'], [$early->queueEntry->queue_number, $early->queueEntry->status], 'numbered by exact arrival order');
        $this->assertSame([2, 'Normal'], [$late->queueEntry->queue_number, $late->queueEntry->priority]);
        $this->assertSame('Served', $treating->queueEntry->status);
        $this->assertSame('2026-09-28T09:20:00+08:00', $treating->queueEntry->closed_at->setTimezone('Asia/Manila')->toIso8601String());
        $this->assertSame(0, app(QueueBackfill::class)->run()['created'], 'idempotent');

        $before = [QueueEntry::orderBy('id')->get()->toJson(), QueueEntryHistory::orderBy('id')->get()->toJson()];
        try {
            app(QueueBackfill::class)->rollback();
            $this->fail('Backfill rollback must not erase append-only history.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('cannot be rolled back by deleting append-only history', $error->getMessage());
        }
        $this->assertSame($before, [QueueEntry::orderBy('id')->get()->toJson(), QueueEntryHistory::orderBy('id')->get()->toJson()]);
        $this->assertSame(3, QueueEntry::count());
    }

    public function test_queue_history_is_append_only(): void
    {
        $this->actingAsUser('staffB1');
        $this->walkIn('A')->assertCreated();
        $this->expectException(QueryException::class);
        DB::table('queue_entry_history')->delete();
    }

    public function test_priority_validates_and_persists_category_and_verification_status_server_side(): void
    {
        $this->actingAsUser('staffB1');
        $this->walkIn('A')->assertCreated();
        $entry = $this->entryFor('A');

        // Reject invalid verification_status or missing verification_status when category is sent
        $this->postJson(
            "/api/queue/{$entry->public_id}/priority",
            [
                'expected_revision' => 1,
                'priority' => 'Priority',
                'reason' => 'Senior citizen priority',
                'category' => 'Senior Citizen',
                'verification_status' => 'unverified-bogus',
            ],
            ['Idempotency-Key' => 'prio-invalid-verif']
        )->assertStatus(422)->assertJsonValidationErrors(['verification_status']);

        $this->postJson(
            "/api/queue/{$entry->public_id}/priority",
            [
                'expected_revision' => 1,
                'priority' => 'Priority',
                'reason' => 'Senior citizen priority',
                'category' => 'Senior Citizen',
            ],
            ['Idempotency-Key' => 'prio-missing-verif']
        )->assertStatus(422)->assertJsonValidationErrors(['verification_status']);

        // Reject unapproved 'Other' category
        $this->postJson(
            "/api/queue/{$entry->public_id}/priority",
            [
                'expected_revision' => 1,
                'priority' => 'Priority',
                'reason' => 'Other priority',
                'category' => 'Other',
                'verification_status' => 'verified',
            ],
            ['Idempotency-Key' => 'prio-unapproved-other']
        )->assertStatus(422)->assertJsonValidationErrors(['category']);

        // Valid category + verification_status ('verified') persists canonical tag and logs administrative audit metadata
        $this->postJson(
            "/api/queue/{$entry->public_id}/priority",
            [
                'expected_revision' => 1,
                'priority' => 'Priority',
                'reason' => 'Senior citizen accommodation',
                'category' => 'Senior Citizen',
                'verification_status' => 'verified',
            ],
            ['Idempotency-Key' => 'prio-valid-verif']
        )->assertOk()
            ->assertJsonPath('data.priority', 'Priority')
            ->assertJsonPath('data.priority_reason', 'Senior citizen accommodation [Senior Citizen · ID/eligibility verified]');

        $audit = DB::table('audit_logs')
            ->where('action', 'queue.priority_changed')
            ->where('auditable_public_id', $entry->public_id)
            ->orderByDesc('id')
            ->first();
        $this->assertNotNull($audit);
        $meta = json_decode($audit->payload, true);
        $this->assertSame('Senior Citizen', $meta['category'] ?? null);
        $this->assertSame('verified', $meta['verification_status'] ?? null);
    }
}

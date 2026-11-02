<?php

namespace Tests\Feature\Treatments;

use App\Models\AppointmentHistory;
use App\Models\Person;
use App\Models\QueueEntry;
use App\Models\Service;
use App\Models\StaffProfile;
use App\Models\Treatment;
use App\Models\TreatmentHistory;
use App\Models\TreatmentProcedure;
use App\Models\Visit;
use App\Models\VisitHistory;
use App\Services\Treatments\TreatmentCutover;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

// M5 Treatment & Clinical Workflow (CONTRACTS.md §3; decisions Q-T1..Q-T11). The clinic clock is frozen at 2026-09-28
// 10:00 Asia/Manila (SchedulingFixture): b1 offers svc1+svc2 (d1: svc1+svc2, d2: svc1); b2 offers svc1 (d3).
class TreatmentTest extends TestCase
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
        return 'tk-'.(++$this->keys);
    }

    /** A scheduled arrival (appointment today) checked in by Staff and called; returns the Visit. */
    private function scheduled(string $patient = 'A', string $dentist = 'd1', string $time = '11:00', bool $call = true): Visit
    {
        $a = $this->existing($patient, $dentist, 'b1', 'svc1', '2026-09-28', $time);
        $this->actingAsUser('staffB1');
        $id = $this->postJson('/api/visits/check-in', ['appointment_id' => $a->public_id, 'expected_revision' => 1], ['Idempotency-Key' => $this->key()])->assertCreated()->json('data.id');
        $visit = Visit::where('public_id', $id)->sole();
        if ($call) {
            $this->callQueue($visit);
        }

        return $visit;
    }

    private function walkIn(string $patient = 'A', ?string $dentist = 'd1', string $branch = 'b1', string $staff = 'staffB1', bool $call = true): Visit
    {
        $this->actingAsUser($staff);
        $id = $this->postJson('/api/visits/walk-in', ['patient_id' => $this->p[$patient]->public_id, 'branch_ref' => $branch, 'service_ref' => 'svc1', 'dentist_ref' => $dentist],
            ['Idempotency-Key' => $this->key()])->assertCreated()->json('data.id');
        $visit = Visit::where('public_id', $id)->sole();
        if ($call && $dentist) {
            $this->callQueue($visit);
        }

        return $visit;
    }

    private function callQueue(Visit $visit): void
    {
        $entry = $visit->fresh()->queueEntry;
        $this->postJson("/api/queue/{$entry->public_id}/call", ['expected_revision' => $entry->revision], ['Idempotency-Key' => $this->key()])->assertOk();
    }

    private function start(Visit $visit, ?int $revision = null, ?string $key = null)
    {
        $headers = $key === '' ? [] : ['Idempotency-Key' => $key ?? $this->key()];

        return $this->postJson("/api/visits/{$visit->public_id}/treatment", ['expected_revision' => $revision ?? $visit->fresh()->revision], $headers);
    }

    private function doc(Treatment $t, array $overrides = [], ?int $revision = null, ?string $key = null)
    {
        return $this->postJson("/api/treatments/{$t->public_id}/document", $overrides + [
            'expected_revision' => $revision ?? $t->fresh()->revision,
            'chief_complaint' => 'Tooth sensitivity',
            'treatment_plan' => 'Clean and review',
            'procedure_summary' => 'Oral prophylaxis',
            'clinical_notes' => 'Tolerated well.',
            'prescription_required' => false,
            'followup_required' => false,
            'procedures' => [['service_ref' => 'svc1', 'quantity' => 1, 'notes' => 'Full mouth']],
        ], ['Idempotency-Key' => $key ?? $this->key()]);
    }

    private function complete(Treatment $t, ?int $revision = null, ?string $key = null)
    {
        return $this->postJson("/api/treatments/{$t->public_id}/complete", ['expected_revision' => $revision ?? $t->fresh()->revision], ['Idempotency-Key' => $key ?? $this->key()]);
    }

    private function started(Visit $visit): Treatment
    {
        $this->actingAsUser('dentist1');
        $this->start($visit)->assertCreated();

        return $visit->fresh()->treatment;
    }

    // ---- START -------------------------------------------------------------------------------------------------------

    public function test_start_serves_the_queue_and_moves_visit_appointment_and_treatment_atomically(): void
    {
        $assistant = StaffProfile::create(['legacy_ref' => 'st1', 'person_id' => Person::factory()->create()->id, 'branch_id' => $this->b['b1']->id, 'shift_start' => '09:00', 'shift_end' => '18:00']);
        $this->d['d1']->update(['assistant_staff_id' => $assistant->id]);
        $visit = $this->scheduled();

        $this->actingAsUser('dentist1');
        $body = $this->start($visit)->assertCreated()
            ->assertJsonPath('data.status', 'In Treatment')->assertJsonPath('data.revision', 1)->assertJsonPath('data.author', true)
            ->assertJsonPath('data.visit.status', 'In Treatment')->assertJsonPath('data.visit.queue.status', 'Served')
            ->assertJsonPath('data.appointment.status', 'In Treatment')->assertJsonPath('data.dentist.id', 'd1')
            ->assertJsonPath('data.assistant.id', 'st1')->assertJsonPath('data.procedures', [])
            ->assertJsonPath('data.started_at', '2026-09-28T10:00:00+08:00')->assertJsonPath('data.completed_at', null)->json('data');

        $t = Treatment::sole();
        $this->assertSame($body['id'], $t->public_id);
        $this->assertSame([$visit->id, $this->d['d1']->id, $assistant->id], [$t->visit_id, $t->dentist_profile_id, $t->assistant_staff_profile_id]);
        $this->assertSame(['Served', 'In Treatment', 'In Treatment'], [QueueEntry::sole()->status, $visit->fresh()->status, $visit->appointment->fresh()->status]);
        $this->assertSame(['treatment.started'], TreatmentHistory::pluck('event')->all());
        $this->assertSame(['visit.checked_in', 'visit.treatment_started'], VisitHistory::where('visit_id', $visit->id)->orderBy('id')->pluck('event')->all());
        $this->assertSame(['appointment.checked_in', 'appointment.treatment_started'], AppointmentHistory::orderBy('id')->pluck('event')->all());
    }

    public function test_start_refusals_leave_everything_unchanged(): void
    {
        $waiting = $this->walkIn('A', 'd1', call: false);
        $this->actingAsUser('dentist1');
        $this->start($waiting)->assertStatus(422)->assertJsonPath('code', 'queue_not_ready');
        $this->start($waiting, 9)->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        $this->start($waiting, null, '')->assertStatus(422)->assertJsonValidationErrors('idempotency_key');

        foreach (['dentist2', 'dentist3', 'staffB1', 'owner', 'patientA'] as $who) {
            $this->actingAsUser($who);
            $this->start($waiting)->assertForbidden();
        }
        $this->assertSame(['Checked In', 'Waiting', 0], [$waiting->fresh()->status, QueueEntry::sole()->status, Treatment::count()]);

        // A Visit without a responsible Dentist is never queued and never treated.
        $unresolved = $this->walkIn('B', null);
        $this->actingAsUser('dentist1');
        $this->start($unresolved)->assertStatus(422)->assertJsonPath('code', 'dentist_unresolved');
        $this->assertSame(0, Treatment::count());
    }

    public function test_duplicate_start_replays_or_conflicts_and_never_creates_a_second_treatment(): void
    {
        $visit = $this->walkIn();
        $this->actingAsUser('dentist1');
        $first = $this->start($visit, 1, 'same')->assertCreated()->json('data.id');
        $this->start($visit, 1, 'same')->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $first);
        $this->start($visit, 1)->assertStatus(409)->assertJsonPath('code', 'treatment_exists');
        $this->start($visit, 2, 'same')->assertStatus(422)->assertJsonPath('code', 'idempotency_key_reused');
        $this->assertSame(1, Treatment::count());
        $this->assertSame(1, TreatmentHistory::count());
    }

    public function test_a_failure_while_starting_rolls_back_queue_visit_appointment_and_treatment(): void
    {
        $visit = $this->scheduled();
        $this->actingAsUser('dentist1');
        TreatmentHistory::creating(fn () => throw new RuntimeException('simulated failure'));
        $this->withoutExceptionHandling();
        try {
            $this->start($visit);
            $this->fail('expected the simulated failure');
        } catch (RuntimeException) {
        }
        $this->assertSame(['Checked In', 'Checked In', 'Called', 0], [$visit->fresh()->status, $visit->appointment->fresh()->status, QueueEntry::sole()->status, Treatment::count()]);
        $this->assertSame(0, DB::table('command_keys')->where('command', 'treatment.start')->count());
    }

    public function test_the_database_keeps_visit_and_treatment_consistent(): void
    {
        $visit = $this->walkIn();
        $attempt = function (callable $write, string $why) {
            try {
                DB::transaction(function () use ($write) {
                    $write();
                    DB::statement('SET CONSTRAINTS ALL IMMEDIATE');
                });
                $this->fail("expected the database to reject: {$why}");
            } catch (QueryException) {
                $this->assertTrue(true);
            } finally {
                DB::statement('SET CONSTRAINTS ALL DEFERRED');
            }
        };
        // No path may put a Visit In Treatment without its Treatment.
        $attempt(fn () => Visit::whereKey($visit->id)->update(['status' => 'In Treatment', 'revision' => 2]), 'Visit In Treatment without Treatment');

        $t = $this->started($visit);
        // Nor complete the Visit while its Treatment is active, nor let the Treatment's status diverge from its Visit.
        $attempt(fn () => Visit::whereKey($visit->id)->update(['status' => 'Completed', 'closed_at' => now()]), 'Visit Completed with an active Treatment');
        $attempt(fn () => Treatment::whereKey($t->id)->update(['status' => 'Completed', 'completed_at' => now()]), 'Treatment Completed while its Visit is In Treatment');
        $attempt(fn () => Treatment::whereKey($t->id)->update(['completed_at' => now()]), 'completed_at without Completed');
        $attempt(fn () => Treatment::whereKey($t->id)->update(['followup_reason' => 'x']), 'follow-up fields without follow-up');
        $attempt(fn () => Treatment::create(['visit_id' => $visit->id, 'dentist_profile_id' => $this->d['d1']->id, 'status' => 'In Treatment', 'started_at' => now()]), 'second Treatment for a Visit');
        $attempt(fn () => $t->delete(), 'deleting a Treatment');
    }

    // ---- ACTIVE-DENTIST RULE (Q-T11) -----------------------------------------------------------------------------------

    public function test_a_dentist_has_one_in_treatment_treatment_at_a_time_but_not_one_per_day(): void
    {
        $a = $this->walkIn('A');
        $b = $this->walkIn('B');
        $first = $this->started($a);
        $this->start($b)->assertStatus(409)->assertJsonPath('code', 'dentist_busy');
        $this->assertSame(['Checked In', 'Called'], [$b->fresh()->status, $b->fresh()->queueEntry->status]);

        // The partial unique index is the final guard (bypassing the service).
        try {
            DB::transaction(fn () => Treatment::create(['visit_id' => $b->id, 'dentist_profile_id' => $this->d['d1']->id, 'status' => 'In Treatment', 'started_at' => now()]));
            $this->fail('expected treatments_one_active_per_dentist to reject a second active Treatment');
        } catch (QueryException $e) {
            $this->assertStringContainsString('treatments_one_active_per_dentist', $e->getMessage());
        }

        $this->doc($first)->assertOk();
        $this->complete($first)->assertOk();
        $this->start($b)->assertCreated()->assertJsonPath('data.clinic_date', '2026-09-28');   // same clinic day
        $this->assertSame(2, Treatment::count());
    }

    // ---- DOCUMENT ------------------------------------------------------------------------------------------------------

    public function test_documentation_saves_fields_and_lines_with_snapshots_and_history(): void
    {
        $t = $this->started($this->walkIn());
        $this->doc($t, ['prescription_required' => true, 'followup_required' => true, 'followup_recommended_date' => '2026-10-05',
            'followup_reason' => 'Review', 'followup_interval' => '1 week',
            'procedures' => [['service_ref' => 'svc1', 'quantity' => 1, 'notes' => 'Upper'], ['service_ref' => 'svc2', 'quantity' => 2]]])
            ->assertOk()->assertJsonPath('data.revision', 2)->assertJsonPath('data.chief_complaint', 'Tooth sensitivity')
            ->assertJsonPath('data.procedure_summary', 'Oral prophylaxis')->assertJsonPath('data.prescription_required', true)
            ->assertJsonPath('data.followup_recommended_date', '2026-10-05')->assertJsonPath('data.procedures.1.service.name', 'Service svc2')
            ->assertJsonPath('data.procedures.1.quantity', 2)->assertJsonPath('data.procedures.0.notes', 'Upper');

        $lines = TreatmentProcedure::orderBy('line_no')->get();
        $this->assertSame([['SVC1', 'Service svc1', 1], ['SVC2', 'Service svc2', 2]], $lines->map(fn ($l) => [$l->service_code, $l->service_name, $l->line_no])->all());
        // M5 stores no money at all (Q-T5).
        foreach (['treatments', 'treatment_procedures'] as $table) {
            foreach (Schema::getColumnListing($table) as $column) {
                $this->assertDoesNotMatchRegularExpression('/fee|price|amount|subtotal|total|payment/', $column, "{$table}.{$column}");
            }
        }
        $history = TreatmentHistory::orderBy('id')->get();
        $this->assertSame(['treatment.started', 'treatment.documented'], $history->pluck('event')->all());
        $this->assertSame('Review', $history[1]->snapshot['followup_reason']);
        $this->assertSame(['Service svc1', 'Service svc2'], array_column($history[1]->snapshot['procedures'], 'service_name'));
        $this->assertSame([], $history[0]->snapshot['procedures']);
    }

    public function test_retained_lines_keep_their_ids_and_removed_lines_stay_in_history(): void
    {
        $t = $this->started($this->walkIn());
        $ids = array_column($this->doc($t, ['procedures' => [['service_ref' => 'svc1', 'quantity' => 1], ['service_ref' => 'svc2', 'quantity' => 1]]])
            ->assertOk()->json('data.procedures'), 'id');

        // Reorder, keep line 2 (same service), drop line 1, change nothing else; add a new line.
        $body = $this->doc($t, ['procedures' => [['id' => $ids[1], 'service_ref' => 'svc2', 'quantity' => 3], ['service_ref' => 'svc1', 'quantity' => 1]]])->assertOk()->json('data');
        $this->assertSame($ids[1], $body['procedures'][0]['id']);
        $this->assertSame(3, $body['procedures'][0]['quantity']);
        $this->assertNotContains($body['procedures'][1]['id'], $ids, 'a new line gets a new id');
        $this->assertSame(2, TreatmentProcedure::count());
        $this->assertContains($ids[0], array_column(TreatmentHistory::where('revision', 2)->sole()->snapshot['procedures'], 'id'), 'removed line reconstructable');

        // A retained id with a different service becomes a new line; an id from nowhere is refused.
        $changed = $this->doc($t, ['procedures' => [['id' => $ids[1], 'service_ref' => 'svc1', 'quantity' => 1]]])->assertOk()->json('data.procedures.0.id');
        $this->assertNotSame($ids[1], $changed);
        $this->doc($t, ['procedures' => [['id' => $ids[0], 'service_ref' => 'svc1', 'quantity' => 1]]])->assertStatus(422)->assertJsonPath('code', 'procedure_invalid');

        // The database keeps a line's identity and service snapshot immutable.
        $this->expectException(QueryException::class);
        TreatmentProcedure::sole()->update(['service_name' => 'Renamed']);
    }

    public function test_documentation_is_validated_on_the_server(): void
    {
        Service::create(['legacy_ref' => 'svc9', 'code' => 'SVC9', 'name' => 'Not offered', 'duration_minutes' => 30, 'reference_fee_php' => 100, 'category' => 'X', 'status' => 'Active']);
        $this->svc['svc2']->update(['status' => 'Inactive']);
        $t = $this->started($this->walkIn());
        $refuse = fn (array $procedures) => $this->doc($t, ['procedures' => $procedures])->assertStatus(422)->assertJsonPath('code', 'procedure_invalid');
        $refuse([['service_ref' => 'svc2', 'quantity' => 1]]);          // inactive
        $refuse([['service_ref' => 'svc9', 'quantity' => 1]]);          // not offered at the branch
        $refuse([['service_ref' => 'nope', 'quantity' => 1]]);          // unknown
        $this->doc($t, ['procedures' => [['service_ref' => 'svc1', 'quantity' => 0]]])->assertStatus(422)->assertJsonValidationErrors('procedures.0.quantity');
        foreach ([true, '1', [1], 1.5] as $coerced) {
            $this->doc($t, ['procedures' => [['service_ref' => 'svc1', 'quantity' => $coerced]]])->assertStatus(422)->assertJsonValidationErrors('procedures.0.quantity');
        }
        $this->doc($t, ['procedures' => [['service_ref' => 'svc1', 'quantity' => 1, 'unit_fee' => 500]]])->assertStatus(422)->assertJsonValidationErrors('procedures.0');
        $this->doc($t, ['followup_reason' => 'no follow-up requested'])->assertStatus(422)->assertJsonValidationErrors('followup_reason');
        $this->doc($t, ['followup_required' => true, 'followup_recommended_date' => '2026-09-01'])->assertStatus(422)->assertJsonPath('code', 'followup_date_invalid');
        $this->doc($t, ['status' => 'Completed'])->assertStatus(422)->assertJsonValidationErrors('status');
        $this->doc($t, ['prescription_required' => 'maybe'])->assertStatus(422)->assertJsonValidationErrors('prescription_required');
        $this->assertSame(1, $t->fresh()->revision);

        // A Dentist authorized at the branch but not for the service is refused too (d2 has svc1 only).
        $this->svc['svc2']->update(['status' => 'Active']);
        $other = $this->walkIn('B', 'd2');
        $this->actingAsUser('dentist2');
        $this->start($other)->assertCreated();
        $this->doc($other->fresh()->treatment, ['procedures' => [['service_ref' => 'svc2', 'quantity' => 1]]])->assertStatus(422)->assertJsonPath('code', 'procedure_invalid');
    }

    public function test_stale_and_repeated_documentation(): void
    {
        $t = $this->started($this->walkIn());
        $line = $this->doc($t, [], 1, 'save-1')->assertOk()->assertJsonPath('data.revision', 2)->json('data.procedures.0.id');
        $this->doc($t, [], 1, 'save-1')->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->doc($t, ['clinical_notes' => 'Another tab'], 1)->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        // Unchanged content (the same retained line id) records no new revision.
        $this->doc($t, ['procedures' => [['id' => $line, 'service_ref' => 'svc1', 'quantity' => 1, 'notes' => 'Full mouth']]], 2)->assertOk()->assertJsonPath('data.revision', 2);
        $this->doc($t, ['clinical_notes' => 'x'], 1, 'save-1')->assertStatus(422)->assertJsonPath('code', 'idempotency_key_reused');
        $this->assertSame(2, TreatmentHistory::count());
    }

    // ---- COMPLETE ------------------------------------------------------------------------------------------------------

    public function test_completion_requires_summary_and_a_line_then_completes_visit_and_appointment(): void
    {
        $visit = $this->scheduled();
        $t = $this->started($visit);
        $this->complete($t)->assertStatus(422)->assertJsonPath('code', 'procedure_summary_required');
        $this->doc($t, ['procedures' => []])->assertOk();
        $this->complete($t)->assertStatus(422)->assertJsonPath('code', 'procedures_required');
        $this->doc($t)->assertOk();
        $this->complete($t, 1)->assertStatus(409)->assertJsonPath('code', 'stale_revision');

        $this->complete($t, 3, 'finish')->assertOk()->assertJsonPath('data.status', 'Completed')->assertJsonPath('data.revision', 4)
            ->assertJsonPath('data.completed_at', '2026-09-28T10:00:00+08:00')->assertJsonPath('data.visit.status', 'Completed')
            ->assertJsonPath('data.appointment.status', 'Completed')->assertJsonPath('data.visit.queue.status', 'Served');
        $this->complete($t, 3, 'finish')->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->complete($t, 3)->assertOk()->assertJsonPath('data.revision', 4);            // already Completed: no-op

        $this->assertSame(['Completed', 'Completed', 'Served'], [$visit->fresh()->status, $visit->appointment->fresh()->status, QueueEntry::sole()->status]);
        $this->assertNotNull($visit->fresh()->closed_at);
        $this->assertSame('appointment.completed', AppointmentHistory::orderByDesc('id')->value('event'));
        $this->assertSame('treatment.completed', TreatmentHistory::orderByDesc('id')->value('event'));

        // Completed is read-only (amendments are unresolved policy P6), in the API and in the database.
        $this->doc($t, [], 4)->assertStatus(422)->assertJsonPath('code', 'treatment_completed');
        try {
            DB::transaction(fn () => Treatment::whereKey($t->id)->update(['clinical_notes' => 'rewritten']));
            $this->fail('expected the Completed treatment to be read-only');
        } catch (QueryException) {
        }
        $this->expectException(QueryException::class);
        TreatmentProcedure::sole()->update(['quantity' => 5]);
    }

    public function test_a_walk_in_completes_without_an_appointment_and_completion_creates_or_sends_nothing_downstream(): void
    {
        $visit = $this->walkIn();
        $t = $this->started($visit);
        $this->doc($t, ['prescription_required' => true, 'followup_required' => true, 'followup_reason' => 'Review'])->assertOk();
        // M18 boundary: M5 sends and schedules nothing — no mail, notification, queued job or event-driven delivery.
        Mail::fake();
        Notification::fake();
        Queue::fake();
        Event::fake();
        $this->complete($t)->assertOk()->assertJsonPath('data.appointment', null)->assertJsonPath('data.visit.status', 'Completed');
        Mail::assertNothingSent();
        Mail::assertNothingQueued();
        Notification::assertNothingSent();
        Queue::assertNothingPushed();
        Event::assertNotDispatched(\Illuminate\Notifications\Events\NotificationSending::class);
        $this->assertSame(0, AppointmentHistory::count());
        $this->assertSame(0, DB::table('invoices')->count(), 'M5 completion creates no invoice');
        // M19 and M20 are their own server modules now: completing a treatment issues no prescription by itself (the dentist writes
        // it), and the follow-up the dentist asked for becomes one Open task for the front desk; nothing is sent to the patient.
        $this->assertSame(0, DB::table('prescriptions')->count(), 'M5 completion issues no prescription');
        $this->assertSame([['source' => 'treatment', 'status' => 'Open']], DB::table('followup_tasks')->get(['source', 'status'])->map(fn ($r) => (array) $r)->all());
        foreach (['followups', 'notifications', 'notification_deliveries'] as $table) {
            $this->assertFalse(Schema::hasTable($table), "M5 must not create an authoritative {$table} table");
        }
        // M12 exists since its own checkpoint: completing a treatment still opens no HMO case (Staff open it explicitly).
        $this->assertSame(0, DB::table('hmo_cases')->count(), 'M5 completion creates no HMO case');
    }

    // ---- AUTHORIZATION / READ PROJECTIONS ------------------------------------------------------------------------------

    public function test_only_the_author_documents_and_completes(): void
    {
        $t = $this->started($this->walkIn());
        foreach (['dentist2', 'staffB1', 'owner', 'patientA'] as $who) {
            $this->actingAsUser($who);
            $this->doc($t)->assertForbidden();
            $this->complete($t)->assertForbidden();
        }
        $this->assertSame(1, $t->fresh()->revision);
    }

    public function test_reads_are_scoped_and_projected_per_role(): void
    {
        $this->getJson('/api/treatments')->assertUnauthorized();
        $this->getJson('/api/treatments/mine')->assertUnauthorized();
        $t = $this->started($this->walkIn());
        $this->doc($t)->assertOk();
        $this->complete($t)->assertOk();

        // Staff (branch scope): full clinical record, read-only.
        $this->actingAsUser('staffB1');
        $this->getJson('/api/treatments?date=2026-09-28')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.clinical_notes', 'Tolerated well.')->assertJsonPath('data.0.chief_complaint', 'Tooth sensitivity');
        $this->getJson("/api/treatments/{$t->public_id}")->assertOk()->assertJsonPath('data.history.0.event', 'treatment.started')
            ->assertJsonMissingPath('data.history.0.snapshot');
        $this->actingAsUser('staffB2');
        $this->getJson('/api/treatments')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("/api/treatments/{$t->public_id}")->assertForbidden();

        // Owner: operational summary only.
        $this->actingAsUser('owner');
        $summary = $this->getJson("/api/treatments/{$t->public_id}")->assertOk()->json('data');
        foreach (['chief_complaint', 'treatment_plan', 'procedure_summary', 'clinical_notes', 'followup_reason', 'followup_recommended_date', 'assistant'] as $hidden) {
            $this->assertArrayNotHasKey($hidden, $summary);
        }
        $this->assertArrayNotHasKey('notes', $summary['procedures'][0]);
        $this->assertStringNotContainsString('Tolerated well', json_encode($this->getJson('/api/treatments')->json()));

        // The author: full record with the documentation snapshot per revision.
        $this->actingAsUser('dentist1');
        $this->getJson("/api/treatments/{$t->public_id}")->assertOk()->assertJsonPath('data.author', true)
            ->assertJsonPath('data.history.1.snapshot.procedure_summary', 'Oral prophylaxis');

        // Another Dentist with no current responsibility for this Patient sees nothing.
        $this->actingAsUser('dentist2');
        $this->getJson("/api/treatments/{$t->public_id}")->assertForbidden();
        $this->getJson('/api/treatments?date=2026-09-28')->assertOk()->assertJsonCount(0, 'data');

        // Patients: no clinical list/detail API; /mine only.
        $this->actingAsUser('patientA');
        $this->getJson('/api/treatments')->assertForbidden();
        $this->getJson("/api/treatments/{$t->public_id}")->assertForbidden();

        // Public ids only; the bounded window applies.
        $this->actingAsUser('owner');
        $json = json_encode($this->getJson('/api/treatments?from=2026-09-01&to=2026-09-30')->assertOk()->json());
        foreach (['visit_id', 'dentist_profile_id', 'person_id', 'patient_id', 'service_id', 'created_by_user_id'] as $internal) {
            $this->assertStringNotContainsString("\"{$internal}\"", $json);
        }
        $this->getJson('/api/treatments?from=2026-01-01&to=2026-12-31')->assertStatus(422)->assertJsonValidationErrors('to');
    }

    public function test_a_treating_dentist_reads_prior_completed_history_but_never_edits_it(): void
    {
        $prior = $this->started($this->walkIn('A', 'd1'));
        $this->doc($prior)->assertOk();
        $this->complete($prior)->assertOk();
        $inProgress = $this->started($this->walkIn('B', 'd1'));

        // d2 is now responsible for Patient A on an active Visit.
        $current = $this->walkIn('A', 'd2');
        $this->actingAsUser('dentist2');
        $this->getJson("/api/treatments/{$prior->public_id}")->assertOk()->assertJsonPath('data.author', false)
            ->assertJsonPath('data.clinical_notes', 'Tolerated well.')->assertJsonMissingPath('data.history.0.snapshot');
        $this->getJson('/api/treatments?date=2026-09-28')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $prior->public_id);
        $this->getJson("/api/treatments/{$inProgress->public_id}")->assertForbidden();   // another Patient, and not completed
        $this->doc($prior, [], 3)->assertForbidden();
        $this->complete($prior)->assertForbidden();

        // Once that Visit ends, the continuity read ends with it.
        $this->start($current)->assertCreated();
        $mine = $current->fresh()->treatment;
        $this->doc($mine, ['procedures' => [['service_ref' => 'svc1', 'quantity' => 1]]])->assertOk();
        $this->complete($mine)->assertOk();
        $this->getJson("/api/treatments/{$prior->public_id}")->assertForbidden();
    }

    public function test_the_patient_reads_only_their_own_completed_safe_subset(): void
    {
        $t = $this->started($this->scheduled());
        $this->doc($t, ['procedures' => [['service_ref' => 'svc1', 'quantity' => 1, 'notes' => 'internal line note']]])->assertOk();

        $this->actingAsUser('patientA');
        $this->getJson('/api/treatments/mine')->assertOk()->assertJsonCount(0, 'data');   // not completed yet

        $this->actingAsUser('dentist1');
        $this->complete($t)->assertOk();
        $this->actingAsUser('patientA');
        $row = $this->getJson('/api/treatments/mine')->assertOk()->assertJsonCount(1, 'data')->json('data.0');
        // Exactly the approved subset: the Treatment's own public id (keying), date, procedure summary, service display
        // names and the Dentist's display name — nothing else.
        $this->assertSame(['id', 'date', 'procedure_summary', 'services', 'dentist'], array_keys($row));
        $this->assertSame($t->public_id, $row['id']);
        $this->assertSame(['2026-09-28', 'Oral prophylaxis', [['name' => 'Service svc1']], ['name' => $this->u['dentist1']->person->fullName()]],
            [$row['date'], $row['procedure_summary'], $row['services'], $row['dentist']]);
        $json = json_encode($row);
        foreach (['Tooth sensitivity', 'Clean and review', 'Tolerated well', 'internal line note', 'history', 'followup', 'prescription',
            '"b1"', '"svc1"', '"d1"', 'branch', 'appointment', 'visit', $t->visit->public_id, $t->visit->appointment->public_id, 'chief_complaint', 'treatment_plan', 'clinical_notes'] as $secret) {
            $this->assertStringNotContainsString($secret, $json);
        }
        foreach (['patient_id', 'visit_id', 'dentist_profile_id', 'service_id', 'treatment_id'] as $internal) {
            $this->assertStringNotContainsString("\"{$internal}\"", $json);
        }
        $this->getJson('/api/treatments/mine?patient_public_id='.$this->p['B']->public_id)->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $t->public_id);   // unknown input can never select another Patient
        $this->getJson('/api/treatments/mine?patient_id='.$this->p['B']->public_id)->assertStatus(422);

        $this->actingAsUser('patientB');
        $this->getJson('/api/treatments/mine')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAsUser('staffB1');
        $this->getJson('/api/treatments/mine')->assertForbidden();
    }

    public function test_treatment_history_is_append_only(): void
    {
        $this->started($this->walkIn());
        $this->expectException(QueryException::class);
        DB::table('treatment_history')->update(['event' => 'tampered']);
    }

    // ---- CUTOVER (Q-T8) ------------------------------------------------------------------------------------------------

    public function test_the_cutover_check_blocks_while_a_visit_is_in_treatment_without_a_treatment(): void
    {
        $this->artisan('treatments:cutover-check')->assertSuccessful();
        $visit = $this->walkIn();
        // Simulate a pre-M5 Visit already In Treatment (deferred consistency trigger never reaches commit here).
        Visit::whereKey($visit->id)->update(['status' => 'In Treatment', 'revision' => 3]);
        $this->assertSame([$visit->public_id], array_column(TreatmentCutover::blockers(), 'visit'));
        $this->artisan('treatments:cutover-check')->assertFailed()->expectsOutputToContain($visit->public_id);
        try {
            TreatmentCutover::assertReady();
            $this->fail('expected the cutover to be blocked');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('No Treatment is fabricated', $e->getMessage());
        }
        $this->assertSame(0, Treatment::count(), 'no Treatment shell is created');
    }

    // ---- M5 production hardening ---------------------------------------------------------------------------------------

    private function completedTreatment(string $patient = 'A'): Treatment
    {
        $t = $this->started($this->walkIn($patient));
        $this->doc($t)->assertOk();
        $this->complete($t)->assertOk();

        return $t->fresh();
    }

    public function test_a_patient_pages_their_completed_treatments_newest_first_without_gaps_repeats_or_leaks(): void
    {
        $made = [];
        for ($i = 0; $i < 5; $i++) {
            $this->travel(5)->minutes(); // distinct completion instants; ties would still be ordered by id
            $made[] = $this->completedTreatment('A')->public_id;
        }
        $other = $this->completedTreatment('B')->public_id;
        $newest = array_reverse($made);

        $this->actingAsUser('patientA');
        $one = $this->getJson('/api/treatments/mine?per_page=2')->assertOk();
        $two = $this->getJson('/api/treatments/mine?per_page=2&cursor='.$one->json('meta.next_cursor'))->assertOk();
        $three = $this->getJson('/api/treatments/mine?per_page=2&cursor='.$two->json('meta.next_cursor'))->assertOk();
        $this->assertSame($newest, [...array_column($one->json('data'), 'id'), ...array_column($two->json('data'), 'id'), ...array_column($three->json('data'), 'id')]);
        $this->assertSame($newest[1], $one->json('meta.next_cursor'));
        $this->assertNull($three->json('meta.next_cursor'));
        $this->assertNotContains($other, array_column($one->json('data'), 'id'));
        $this->assertSame(50, $this->getJson('/api/treatments/mine')->json('meta.per_page'));
        foreach (['per_page=0', 'per_page=101', 'per_page=x', 'cursor=short', 'cursor[]=a'] as $bad) {
            $this->getJson('/api/treatments/mine?'.$bad)->assertStatus(422);
        }
        // Patient B's cursor into Patient A's list (and an unknown cursor) behave identically: an empty page.
        $this->actingAsUser('patientB');
        $foreign = $this->getJson('/api/treatments/mine?cursor='.$one->json('meta.next_cursor'))->assertOk();
        $unknown = $this->getJson('/api/treatments/mine?cursor=01ARZ3NDEKTSV4RRFFQ69G5FAV')->assertOk();
        $this->assertSame($unknown->json(), $foreign->json());
        $this->assertSame([], $foreign->json('data'));
        $this->assertSame([$other], array_column($this->getJson('/api/treatments/mine')->json('data'), 'id'));
    }

    public function test_same_day_treatments_with_equal_completion_times_keep_distinct_public_ids_across_pages(): void
    {
        $first = $this->completedTreatment('A');
        $second = $this->completedTreatment('A');
        $this->assertSame($first->completed_at->toIso8601String(), $second->completed_at->toIso8601String());
        $this->assertSame($first->visit->clinic_date->format('Y-m-d'), $second->visit->clinic_date->format('Y-m-d'));
        $this->actingAsUser('patientA');
        $one = $this->getJson('/api/treatments/mine?per_page=1')->assertOk();
        $two = $this->getJson('/api/treatments/mine?per_page=1&cursor='.$one->json('meta.next_cursor'))->assertOk();
        $this->assertSame([$second->public_id, $first->public_id], [$one->json('data.0.id'), $two->json('data.0.id')]);
        $this->assertNull($two->json('meta.next_cursor'));
        foreach ([$one, $two] as $response) {
            $this->assertSame(['id', 'date', 'procedure_summary', 'services', 'dentist'], array_keys($response->json('data.0')));
        }
    }

    public function test_only_the_responsible_dentist_starts_and_other_roles_and_identifiers_are_refused(): void
    {
        $visit = $this->scheduled();
        foreach (['dentist2', 'staffB1', 'owner', 'patientA'] as $who) {
            $this->actingAsUser($who);
            $this->start($visit)->assertForbidden();
        }
        $this->actingAsUser('dentist1');
        foreach (['999999', 'not-a-ulid', '01ARZ3NDEKTSV4RRFFQ69G5FAV'] as $bad) {
            $this->postJson("/api/visits/{$bad}/treatment", ['expected_revision' => 1], ['Idempotency-Key' => $this->key()])->assertNotFound();
            $this->getJson("/api/treatments/{$bad}")->assertNotFound();
            $this->postJson("/api/treatments/{$bad}/complete", ['expected_revision' => 1], ['Idempotency-Key' => $this->key()])->assertNotFound();
        }
        $this->start($visit, null, '')->assertStatus(422); // Idempotency-Key is mandatory
        $this->assertSame(0, Treatment::count());
        $this->assertSame('Checked In', $visit->fresh()->status);
    }

    public function test_forged_identity_state_clock_and_money_fields_are_refused_on_every_command(): void
    {
        $visit = $this->scheduled();
        $this->actingAsUser('dentist1');
        $forged = ['patient_id' => 1, 'branch_id' => 'b2', 'dentist_id' => 'd2', 'status' => 'Completed', 'started_at' => '2020-01-01T00:00:00Z', 'completed_at' => '2020-01-01T00:00:00Z',
            'created_by_user_id' => 1, 'invoice_id' => 1, 'billing_status' => 'Paid', 'price' => '1.00', 'amount' => '1.00', 'revision' => 9, 'history' => ['x'], 'audit' => ['x']];
        foreach ($forged as $field => $value) {
            $this->postJson("/api/visits/{$visit->public_id}/treatment", ['expected_revision' => $visit->fresh()->revision, $field => $value], ['Idempotency-Key' => $this->key()])->assertStatus(422, "start must refuse {$field}");
        }
        $this->assertSame(0, Treatment::count());
        $t = $this->started($visit);
        foreach ($forged as $field => $value) {
            $this->doc($t, [$field => $value])->assertStatus(422, "document must refuse {$field}");
            $this->postJson("/api/treatments/{$t->public_id}/complete", ['expected_revision' => 1, $field => $value], ['Idempotency-Key' => $this->key()])->assertStatus(422, "complete must refuse {$field}");
        }
        // A price or an unknown key inside a procedure line is refused too.
        $this->doc($t, ['procedures' => [['service_ref' => 'svc1', 'quantity' => 1, 'price' => '1.00']]])->assertStatus(422);
        $this->doc($t, ['procedures' => [['service_ref' => 'svc1', 'quantity' => 1, 'service_id' => 1]]])->assertStatus(422);
        $fresh = $t->fresh();
        $this->assertSame(['In Treatment', 1], [$fresh->status, $fresh->revision]);
    }

    public function test_a_completed_treatment_is_closed_to_every_command_and_the_database_agrees(): void
    {
        $t = $this->completedTreatment();
        $this->actingAsUser('dentist1');
        $this->doc($t, ['clinical_notes' => 'rewritten'], $t->revision)->assertStatus(422)->assertJsonPath('code', 'treatment_completed');
        $this->postJson("/api/treatments/{$t->public_id}/start", [], ['Idempotency-Key' => $this->key()])->assertStatus(404);
        $this->start($t->visit, null)->assertStatus(409); // treatment_exists
        foreach (['patch', 'put', 'delete'] as $verb) {
            $this->{$verb.'Json'}("/api/treatments/{$t->public_id}", ['clinical_notes' => 'x'])->assertStatus(405);
        }
        $this->assertSame('Tolerated well.', $t->fresh()->clinical_notes);
        foreach ([fn () => DB::table('treatments')->where('id', $t->id)->update(['clinical_notes' => 'x']),
            fn () => DB::table('treatments')->where('id', $t->id)->delete(),
            fn () => DB::table('treatment_procedures')->where('treatment_id', $t->id)->update(['quantity' => 5]),
            fn () => DB::table('treatment_procedures')->where('treatment_id', $t->id)->delete(),
            fn () => DB::table('treatment_history')->where('treatment_id', $t->id)->delete()] as $attempt) {
            try {
                DB::transaction($attempt);
                $this->fail('the database must refuse changing a Completed treatment');
            } catch (QueryException) {
                $this->assertTrue(true);
            }
        }
    }

    public function test_a_failure_while_completing_rolls_everything_back(): void
    {
        $t = $this->started($this->scheduled());
        $this->doc($t)->assertOk();
        $revision = $t->fresh()->revision;
        TreatmentHistory::creating(fn ($h) => $h->event === 'treatment.completed' ? throw new RuntimeException('simulated failure') : null);
        $this->withoutExceptionHandling();
        try {
            $this->complete($t, $revision);
            $this->fail('expected the simulated failure');
        } catch (RuntimeException) {
        }
        $fresh = $t->fresh();
        $this->assertSame(['In Treatment', $revision, null, 'In Treatment', 'In Treatment'], [$fresh->status, $fresh->revision, $fresh->completed_at, $fresh->visit->status, $fresh->visit->appointment->status]);
        $this->assertSame(0, \App\Models\AuditLog::where('action', 'treatment.completed')->count());
        $this->assertSame(0, DB::table('command_keys')->where('command', 'treatment.complete')->count());
    }

    public function test_start_and_completion_emit_minimal_m22_events_without_clinical_text(): void
    {
        $t = $this->completedTreatment();
        $events = \App\Models\AuditLog::whereIn('action', ['treatment.started', 'treatment.completed'])->orderBy('id')->get();
        $this->assertSame(['treatment.started', 'treatment.completed'], $events->pluck('action')->all());
        foreach ($events as $event) {
            $this->assertSame(['clinical', 'dentist', $t->public_id, $t->visit->branch_id], [$event->category, $event->actor_role, $event->auditable_public_id, $event->branch_id]);
        }
        $json = json_encode($events->pluck('payload'));
        foreach (['Tooth sensitivity', 'Clean and review', 'Oral prophylaxis', 'Tolerated well', 'Full mouth', 'service_name', 'notes'] as $text) {
            $this->assertStringNotContainsString($text, $json);
        }
        $this->assertSame(1, $events->last()->payload['procedure_lines']);
        // A replay of the same command key neither repeats the transition nor the event.
        $this->actingAsUser('dentist1');
        $this->postJson("/api/treatments/{$t->public_id}/complete", ['expected_revision' => $t->revision - 1], ['Idempotency-Key' => 'replay-1'])->assertOk();
        $this->postJson("/api/treatments/{$t->public_id}/complete", ['expected_revision' => $t->revision - 1], ['Idempotency-Key' => 'replay-1'])->assertOk();
        $this->assertSame(1, \App\Models\AuditLog::where('action', 'treatment.completed')->count());
    }
}

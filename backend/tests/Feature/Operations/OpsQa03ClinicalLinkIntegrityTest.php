<?php

namespace Tests\Feature\Operations;

use App\Models\Appointment;
use App\Models\AuditLog;
use App\Models\FollowupTask;
use App\Models\QueueEntry;
use App\Models\Treatment;
use App\Models\TreatmentHistory;
use App\Models\Visit;
use App\Services\Audit\AuditService;
use App\Services\Queue\QueueService;
use App\Services\Treatments\TreatmentService;
use App\Services\Visits\VisitCommandException;
use App\Support\ClinicClock;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\Feature\Appointments\SchedulingFixture;
use Tests\TestCase;

/** Authored for OPS-QA-03; execution is deferred. Malformed fixtures never disable database safeguards. */
class OpsQa03ClinicalLinkIntegrityTest extends TestCase
{
    use RefreshDatabase, SchedulingFixture;

    private int $sequence = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSchedulingWorld();
    }

    private function command(string $path, array $payload, ?string $key = null)
    {
        return $this->postJson($path, $payload, ['Idempotency-Key' => $key ?? 'ops03-'.(++$this->sequence)]);
    }

    private function calledVisit(): Visit
    {
        $appointment = $this->existing('A', 'd1', 'b1', 'svc1', ClinicClock::today(), '11:00');
        $this->actingAsUser('staffB1');
        $this->command('/api/visits/check-in', ['appointment_id' => $appointment->public_id, 'expected_revision' => 1])->assertCreated();
        $visit = Visit::where('appointment_id', $appointment->id)->sole();
        $entry = $visit->queueEntry;
        $this->command("/api/queue/{$entry->public_id}/call", ['expected_revision' => 1])->assertOk();

        return $visit->fresh();
    }

    private function start(Visit $visit, int $revision = 1, ?string $key = null)
    {
        return $this->command("/api/visits/{$visit->public_id}/treatment", ['expected_revision' => $revision], $key);
    }

    private function active(): Treatment
    {
        $visit = $this->calledVisit();
        $this->actingAsUser('dentist1');
        $this->start($visit)->assertCreated();

        return Treatment::where('visit_id', $visit->id)->sole();
    }

    private function documentation(Treatment $treatment, array $extra = []): array
    {
        return $extra + [
            'expected_revision' => $treatment->fresh()->revision,
            'procedure_summary' => 'OPS03 synthetic completed procedure',
            'clinical_notes' => 'OPS03 private fixture',
            'prescription_required' => false, 'followup_required' => false,
            'procedures' => [['service_ref' => 'svc1', 'quantity' => 1]],
        ];
    }

    private function document(Treatment $treatment, array $extra = [], ?string $key = null)
    {
        return $this->command("/api/treatments/{$treatment->public_id}/document", $this->documentation($treatment, $extra), $key);
    }

    private function complete(Treatment $treatment, ?int $revision = null, ?string $key = null)
    {
        return $this->command("/api/treatments/{$treatment->public_id}/complete", ['expected_revision' => $revision ?? $treatment->fresh()->revision], $key);
    }

    private function state(): array
    {
        $state = [];
        foreach (['appointments', 'visits', 'queue_entries', 'dentist_queues', 'treatments', 'treatment_procedures',
            'appointment_history', 'visit_history', 'queue_entry_history', 'treatment_history', 'audit_logs', 'followup_tasks', 'command_keys'] as $table) {
            $state[$table] = DB::table($table)->orderBy('id')->get()->map(fn ($row) => (array) $row)->all();
        }

        return $state;
    }

    public function test_progression_preserves_served_queue_line_identity_history_and_single_followup(): void
    {
        $treatment = $this->active();
        $this->assertSame('Served', $treatment->visit->queueEntry->status);
        $extra = ['followup_required' => true, 'followup_recommended_date' => '2026-10-05', 'followup_reason' => 'Synthetic review'];
        $line = $this->document($treatment, $extra)->assertOk()->json('data.procedures.0.id');
        $extra['procedures'] = [['id' => $line, 'service_ref' => 'svc1', 'quantity' => 1]];
        $before = $this->state();
        $this->document($treatment, $extra)->assertOk()->assertJsonPath('data.revision', 2)->assertJsonPath('data.procedures.0.id', $line);
        // Unchanged documentation stores only the new command result; it adds no clinical revision/history.
        $after = $this->state();
        unset($before['command_keys'], $after['command_keys']);
        $this->assertSame($before, $after);
        $this->complete($treatment, 2, 'finish')->assertOk()->assertJsonPath('data.status', 'Completed');
        $completed = $this->state();
        $this->complete($treatment, 2, 'finish')->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->assertSame($completed, $this->state());
        $this->complete($treatment, 1, 'finish-again')->assertOk()->assertJsonPath('data.revision', 3);
        $this->assertSame(['Completed', 'Completed', 'Served'], [$treatment->visit->fresh()->status, $treatment->visit->appointment->fresh()->status, $treatment->visit->queueEntry->fresh()->status]);
        $this->assertSame(['treatment.started', 'treatment.documented', 'treatment.completed'], TreatmentHistory::orderBy('id')->pluck('event')->all());
        $this->assertSame($line, TreatmentHistory::where('event', 'treatment.completed')->sole()->snapshot['procedures'][0]['id']);
        $this->assertSame(1, FollowupTask::where('treatment_id', $treatment->id)->count());
        $audits = AuditLog::whereIn('action', ['treatment.started', 'treatment.completed'])->get();
        $this->assertCount(2, $audits);
        $this->assertStringNotContainsString('OPS03 private fixture', $audits->toJson());
    }

    public static function malformedLinks(): array
    {
        return [
            'wrong queue dentist' => ['queue-dentist', 'queue_visit_mismatch'],
            'wrong queue branch' => ['queue-branch', 'queue_visit_mismatch'],
            'wrong queue date' => ['queue-date', 'queue_visit_mismatch'],
            'queue belongs to another visit' => ['queue-visit', 'not_in_queue'],
            'wrong appointment patient' => ['appointment-patient', 'appointment_mismatch'],
            'wrong appointment branch' => ['appointment-branch', 'appointment_mismatch'],
            'wrong appointment dentist' => ['appointment-dentist', 'appointment_mismatch'],
            'wrong appointment day' => ['appointment-date', 'appointment_mismatch'],
            'wrong arrival day' => ['arrival-date', 'appointment_mismatch'],
        ];
    }

    private function corrupt(Visit $visit, string $kind): void
    {
        $queue = app(QueueService::class);
        if (str_starts_with($kind, 'queue-') && $kind !== 'queue-visit') {
            [$id] = $queue->allocate($this->b[$kind === 'queue-branch' ? 'b2' : 'b1']->id,
                $this->d[$kind === 'queue-dentist' ? 'd2' : 'd1']->id,
                $kind === 'queue-date' ? '2026-09-29' : ClinicClock::today());
            $visit->queueEntry->update(['dentist_queue_id' => $id]);
        } elseif ($kind === 'queue-visit') {
            $other = Visit::create(['patient_id' => $this->p['B']->id, 'branch_id' => $this->b['b1']->id,
                'source' => 'walk_in', 'status' => 'Checked In', 'responsible_dentist_profile_id' => $this->d['d1']->id,
                'clinic_date' => ClinicClock::today(), 'arrived_at' => ClinicClock::now(), 'revision' => 1]);
            $visit->queueEntry->update(['visit_id' => $other->id]);
        } elseif ($kind === 'arrival-date') {
            $visit->update(['arrived_at' => ClinicClock::now()->subDay()]);
        } else {
            $change = match ($kind) {
                'appointment-patient' => ['patient_id' => $this->p['B']->id],
                'appointment-branch' => ['branch_id' => $this->b['b2']->id],
                'appointment-dentist' => ['dentist_profile_id' => $this->d['d2']->id],
                'appointment-date' => ['starts_at' => ClinicClock::at('2026-09-29', '11:00'), 'ends_at' => ClinicClock::at('2026-09-29', '11:30')],
            };
            $visit->appointment->update($change);
        }
    }

    #[DataProvider('malformedLinks')]
    public function test_start_refuses_malformed_links_without_partial_mutation(string $kind, string $code): void
    {
        $visit = $this->calledVisit();
        $this->corrupt($visit, $kind);
        $before = $this->state();
        $this->actingAsUser('dentist1');
        $this->start($visit)->assertStatus(422)->assertJsonPath('code', $code);
        $this->assertSame($before, $this->state());
    }

    #[DataProvider('malformedLinks')]
    public function test_document_and_complete_refuse_malformed_links_without_partial_mutation(string $kind, string $code): void
    {
        $treatment = $this->active();
        $this->document($treatment)->assertOk();
        $this->corrupt($treatment->visit, $kind);
        $before = $this->state();
        $this->document($treatment)->assertStatus(422)->assertJsonPath('code', $code);
        $this->complete($treatment)->assertStatus(422)->assertJsonPath('code', $code);
        $this->assertSame($before, $this->state());
    }

    public function test_document_and_complete_require_in_treatment_appointment_and_served_queue(): void
    {
        $treatment = $this->active();
        $this->document($treatment)->assertOk();
        $appointment = $treatment->visit->appointment;
        $appointment->update(['status' => 'Checked In']);
        $before = $this->state();
        $this->document($treatment)->assertStatus(422)->assertJsonPath('code', 'encounter_mismatch');
        $this->complete($treatment)->assertStatus(422)->assertJsonPath('code', 'encounter_mismatch');
        $this->assertSame($before, $this->state());
        $appointment->update(['status' => 'In Treatment']);
        $treatment->visit->queueEntry->update(['status' => 'Called', 'closed_at' => null]);
        $before = $this->state();
        $this->document($treatment)->assertStatus(422)->assertJsonPath('code', 'encounter_mismatch');
        $this->complete($treatment)->assertStatus(422)->assertJsonPath('code', 'encounter_mismatch');
        $this->assertSame($before, $this->state());
    }

    public function test_start_and_document_replays_stale_revisions_and_changed_payloads(): void
    {
        $visit = $this->calledVisit();
        $this->actingAsUser('dentist1');
        $this->start($visit, 9)->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        $id = $this->start($visit, 1, 'start')->assertCreated()->json('data.id');
        $this->start($visit, 1, 'start')->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $id);
        $this->start($visit)->assertStatus(409)->assertJsonPath('code', 'treatment_exists');
        $this->start($visit, 2, 'start')->assertStatus(422)->assertJsonPath('code', 'idempotency_key_reused');
        $treatment = Treatment::sole();
        $payload = $this->documentation($treatment);
        $path = "/api/treatments/{$treatment->public_id}/document";
        $first = $this->command($path, $payload, 'document')->assertOk()->json();
        $this->assertSame($first, $this->command($path, $payload, 'document')->assertOk()->assertHeader('Idempotent-Replayed', 'true')->json());
        $before = $this->state();
        $this->command($path, $payload)->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        $this->command($path, array_replace($payload, ['procedure_summary' => 'Different']), 'document')->assertStatus(422)->assertJsonPath('code', 'idempotency_key_reused');
        $this->complete($treatment, 1)->assertStatus(409)->assertJsonPath('code', 'stale_revision');
        $this->assertSame($before, $this->state());
    }

    public function test_missing_and_withdrawn_services_are_refused_without_new_history(): void
    {
        $treatment = $this->active();
        $before = $this->state();
        $this->document($treatment, ['procedures' => [['service_ref' => 'missing', 'quantity' => 1]]])->assertStatus(422)->assertJsonPath('code', 'procedure_invalid');
        $this->assertSame($before, $this->state());
        $this->document($treatment)->assertOk();
        $this->svc['svc1']->update(['status' => 'Inactive']);
        $before = $this->state();
        $this->document($treatment)->assertStatus(422)->assertJsonPath('code', 'procedure_invalid');
        $this->complete($treatment)->assertStatus(422)->assertJsonPath('code', 'procedure_invalid');
        $this->assertSame($before, $this->state());
    }

    public function test_completed_legacy_treatment_without_queue_accepts_retry_but_is_not_documentable(): void
    {
        $visit = Visit::create(['patient_id' => $this->p['A']->id, 'branch_id' => $this->b['b1']->id,
            'source' => 'walk_in', 'status' => 'Completed', 'responsible_dentist_profile_id' => $this->d['d1']->id,
            'arrived_at' => ClinicClock::now()->subDay(), 'clinic_date' => '2026-09-27', 'closed_at' => ClinicClock::now()->subDay(), 'revision' => 3]);
        $treatment = Treatment::create(['visit_id' => $visit->id, 'dentist_profile_id' => $this->d['d1']->id,
            'status' => 'Completed', 'started_at' => ClinicClock::now()->subDay(), 'completed_at' => ClinicClock::now()->subDay(), 'revision' => 7]);
        $this->actingAsUser('dentist1');
        $before = $this->state();
        $this->complete($treatment, 1)->assertOk()->assertJsonPath('data.revision', 7);
        $after = $this->state();
        unset($before['command_keys'], $after['command_keys']);
        $this->assertSame($before, $after);
        $this->document($treatment)->assertStatus(422)->assertJsonPath('code', 'treatment_completed');
        $this->assertSame(0, FollowupTask::count());
        $this->assertSame(0, TreatmentHistory::count());
    }

    public function test_changed_treatment_visit_link_is_detected_for_a_stale_command_model(): void
    {
        $treatment = $this->active();
        $other = Visit::create(['patient_id' => $this->p['B']->id, 'branch_id' => $this->b['b1']->id,
            'source' => 'walk_in', 'status' => 'Checked In', 'responsible_dentist_profile_id' => $this->d['d1']->id,
            'arrived_at' => ClinicClock::now(), 'clinic_date' => ClinicClock::today(), 'revision' => 1]);
        // Deliberately malformed transient fixture inside RefreshDatabase's rollback-only transaction.
        // Do not disable deferred consistency triggers or claim this state can commit.
        Treatment::whereKey($treatment->id)->update(['visit_id' => $other->id]);
        $before = $this->state();
        try {
            app(TreatmentService::class)->complete($this->u['dentist1'], $treatment, 1, 'changed-visit', fn () => []);
            $this->fail('The command must not follow a changed encounter link.');
        } catch (VisitCommandException $e) {
            $this->assertSame(409, $e->status);
        }
        $this->assertSame($before, $this->state());
    }

    public function test_unauthorized_authors_and_branch_staff_cannot_mutate_the_encounter(): void
    {
        $visit = $this->calledVisit();
        foreach (['dentist2', 'dentist3', 'staffB1', 'staffB2', 'owner', 'patientA'] as $who) {
            $this->actingAsUser($who);
            $this->start($visit)->assertForbidden();
        }
        $this->actingAsUser('dentist1');
        $this->start($visit)->assertCreated();
        $treatment = Treatment::sole();
        $before = $this->state();
        foreach (['dentist2', 'dentist3', 'staffB1', 'staffB2', 'owner', 'patientA'] as $who) {
            $this->actingAsUser($who);
            $this->document($treatment)->assertForbidden();
            $this->complete($treatment)->assertForbidden();
        }
        $this->assertSame($before, $this->state());
    }

    public function test_served_or_closed_encounters_refuse_queue_changes_including_same_target_noops(): void
    {
        $treatment = $this->active();
        $this->actingAsUser('staffB1');
        $entry = $treatment->visit->queueEntry;
        $before = $this->state();
        foreach (['call', 'ready', 'away', 'return'] as $command) {
            $this->command("/api/queue/{$entry->public_id}/{$command}", ['expected_revision' => $entry->revision])->assertStatus(422)->assertJsonPath('code', 'queue_closed');
        }
        $this->assertSame($before, $this->state());
        // Existing raw/corrupt Called row on an In Treatment encounter must not become a same-target success.
        $entry->update(['status' => 'Called', 'closed_at' => null]);
        $before = $this->state();
        $this->command("/api/queue/{$entry->public_id}/call", ['expected_revision' => $entry->revision])->assertStatus(422)->assertJsonPath('code', 'queue_closed');
        $this->assertSame($before, $this->state());
    }

    public function test_start_audit_failure_rolls_back_queue_encounter_history_and_command_key(): void
    {
        $visit = $this->calledVisit();
        $this->actingAsUser('dentist1');
        $before = $this->state();
        $this->failAudit('treatment.started');
        $this->withoutExceptionHandling();
        try {
            $this->start($visit);
            $this->fail('Expected the synthetic audit failure.');
        } catch (RuntimeException $e) {
            $this->assertSame('OPS03 audit failure', $e->getMessage());
        }
        $this->assertSame($before, $this->state());
    }

    public function test_followup_audit_failure_rolls_back_completion_and_a_retry_creates_one_task(): void
    {
        $treatment = $this->active();
        $this->document($treatment, ['followup_required' => true, 'followup_reason' => 'Synthetic review'])->assertOk();
        $before = $this->state();
        $this->failAudit('followup.created');
        $this->withoutExceptionHandling();
        try {
            $this->complete($treatment, 2, 'retry-completion');
            $this->fail('Expected the synthetic audit failure.');
        } catch (RuntimeException $e) {
            $this->assertSame('OPS03 audit failure', $e->getMessage());
        }
        $this->assertSame($before, $this->state());
        $this->app->bind(AuditService::class, fn () => new AuditService);
        $this->complete($treatment, 2, 'retry-completion')->assertOk();
        $this->complete($treatment, 2, 'another-completion')->assertOk();
        $this->assertSame(1, FollowupTask::where('treatment_id', $treatment->id)->count());
        $this->assertSame(1, AuditLog::where('action', 'treatment.completed')->count());
        $this->assertSame(1, TreatmentHistory::where('event', 'treatment.completed')->count());
    }

    private function failAudit(string $action): void
    {
        $this->app->bind(AuditService::class, fn () => new class($action) extends AuditService {
            public function __construct(private readonly string $failAction) {}

            public function record(array $attributes): AuditLog
            {
                $audit = parent::record($attributes);
                if ($attributes['action'] === $this->failAction) {
                    throw new RuntimeException('OPS03 audit failure');
                }

                return $audit;
            }
        });
    }
}

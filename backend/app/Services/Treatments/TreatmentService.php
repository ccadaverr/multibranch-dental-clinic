<?php

namespace App\Services\Treatments;

use App\Models\Appointment;
use App\Models\BranchService;
use App\Models\CommandKey;
use App\Models\DentistServiceAssignment;
use App\Models\QueueEntry;
use App\Models\Service;
use App\Models\Treatment;
use App\Models\TreatmentHistory;
use App\Models\TreatmentProcedure;
use App\Models\User;
use App\Models\Visit;
use App\Services\Audit\AuditService;
use App\Services\Queue\QueueService;
use App\Services\Visits\VisitCommandException;
use App\Services\Visits\VisitService;
use App\Support\ClinicClock;
use App\Support\IdempotentCommand;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;

// M5 Treatment & Clinical Workflow — the ONLY authority for the clinical Treatment record (CONTRACTS.md §3). Three named
// commands, each one transaction through the shared idempotency mechanism (Idempotency-Key required) and each writing an
// immutable history snapshot:
//   - start:    QueueEntry -> Served, Visit -> In Treatment, appointment -> In Treatment (scheduled Visits) and the
//               Treatment created In Treatment — atomically (decision Q-T2);
//   - document: the responsible Dentist saves the whole editable documentation and procedure-line set (expected_revision);
//   - complete: Treatment -> Completed, Visit -> Completed, appointment -> Completed; the queue entry stays Served.
// Completion creates no invoice, prescription, follow-up or HMO case: M11/M19/M20/M12 consume the completed Treatment.
// Lock order is the global one: appointment -> Visit -> queue entry -> Treatment, so M5 cannot deadlock with M6/M8/M9.
final class TreatmentService
{
    public const RELATIONS = [
        'visit.patient.person', 'visit.branch', 'visit.appointment', 'visit.queueEntry', 'visit.appointment.service', 'visit.requestedService',
        'dentist.person', 'assistant.person', 'procedures.service',
    ];

    private const ATTEMPTS = 3;

    public function __construct(
        private readonly VisitService $visits,
        private readonly QueueService $queue,
    ) {}

    public function start(User $actor, Visit $visit, int $expectedRevision, string $key, Closure $present): JsonResponse
    {
        $payload = ['visit' => $visit->id, 'expected_revision' => $expectedRevision];

        return $this->idempotent($actor, $key, 'treatment.start', $payload, $present, function () use ($actor, $visit, $expectedRevision) {
            // Resolve persisted context, then preserve appointment -> Visit lock order and detect a changed link.
            $snapshot = Visit::whereKey($visit->id)->firstOrFail();
            $appointment = $snapshot->appointment_id ? Appointment::whereKey($snapshot->appointment_id)->lockForUpdate()->firstOrFail() : null;
            $current = Visit::whereKey($visit->id)->lockForUpdate()->firstOrFail();
            $this->assertAppointmentLink($current, $appointment);
            if (Treatment::where('visit_id', $current->id)->exists()) {
                throw self::treatmentExists();
            }
            if ($current->revision !== $expectedRevision) {
                throw VisitCommandException::staleVisit();
            }
            if ($current->status !== 'Checked In') {
                throw VisitCommandException::rule('invalid_transition', "A visit that is {$current->status} cannot start treatment.", 'status');
            }
            if ($current->responsible_dentist_profile_id === null) {
                throw VisitCommandException::rule('dentist_unresolved', 'Assign a responsible Dentist to this visit before clinical work starts.', 'dentist');
            }
            $dentist = $current->dentist()->with('person')->firstOrFail();
            if ($actor->role->value !== 'dentist' || $dentist->person_id !== $actor->person_id) {
                throw new VisitCommandException(403, 'forbidden', 'Only the responsible Dentist may start this treatment.');
            }
            // The linked appointment mirrors the Visit's clinical progression; a mismatch is refused, never repaired.
            if ($appointment && $appointment->status !== 'Checked In') {
                throw VisitCommandException::rule('appointment_mismatch', "The linked appointment is {$appointment->status}; this visit needs clinic review.", 'appointment');
            }
            // Q-T11: one In Treatment Treatment per Dentist at a time (the partial unique index is the final guard).
            if (Treatment::where('dentist_profile_id', $dentist->id)->where('status', 'In Treatment')->exists()) {
                throw self::dentistBusy();
            }
            // M9: only from a Called / Treatment Ready queue entry, which becomes Served here.
            $this->queue->serve($actor, $current);
            $this->visits->applyClinical($actor, $current, $appointment, 'In Treatment');

            $treatment = Treatment::create([
                'visit_id' => $current->id,
                'dentist_profile_id' => $dentist->id,
                'status' => 'In Treatment',
                'assistant_staff_profile_id' => $dentist->assistant_staff_id,
                'prescription_required' => false,
                'followup_required' => false,
                'started_at' => ClinicClock::now(),
                'revision' => 1,
                'created_by_user_id' => $actor->id,
                'updated_by_user_id' => $actor->id,
            ]);
            $this->history($treatment, $actor, 'treatment.started', null);
            $this->audit($actor, 'treatment.started', $treatment, $current->branch_id, ['visit' => $current->public_id, 'from_status' => null, 'to_status' => 'In Treatment', 'revision' => 1]);

            return [$treatment, 201];
        });
    }

    /**
     * Saves the complete editable documentation and procedure-line set. A submitted line with the `id` of an existing line
     * for the same service keeps that line (and its public id); any other line is new; lines not submitted are removed
     * from the current record and remain in the history snapshots.
     *
     * @param  array{fields: array<string,mixed>, procedures: list<array{id:?string,service_ref:string,quantity:int,notes:?string}>}  $data
     */
    public function document(User $actor, Treatment $treatment, int $expectedRevision, array $data, string $key, Closure $present): JsonResponse
    {
        $payload = ['treatment' => $treatment->id, 'expected_revision' => $expectedRevision, 'data' => $data];

        return $this->idempotent($actor, $key, 'treatment.document', $payload, $present, function () use ($actor, $treatment, $expectedRevision, $data) {
            [$current, $visit, $appointment, $queueEntry] = $this->lockClinicalEncounter($actor, $treatment);
            if ($current->revision !== $expectedRevision) {
                throw self::stale();
            }
            if ($current->status !== 'In Treatment') {
                throw self::readOnly();
            }
            $this->assertActiveEncounter($current, $visit, $appointment, $queueEntry);
            $lines = $this->resolveLines($current, $visit, $data['procedures']);
            $fields = $data['fields'];
            if (! empty($fields['followup_recommended_date']) && $fields['followup_recommended_date'] < $visit->clinic_date->format('Y-m-d')) {
                throw VisitCommandException::rule('followup_date_invalid', 'Choose a recommended follow-up date on or after the visit date.', 'followup_recommended_date');
            }

            $existing = $current->procedures()->get();
            if ($this->unchanged($current, $existing, $fields, $lines)) {
                return [$current, 200];
            }
            $keep = collect($lines)->pluck('existing')->filter()->map->id->all();
            $existing->reject(fn ($line) => in_array($line->id, $keep, true))->each->delete();
            foreach ($lines as $index => $line) {
                $values = ['line_no' => $index + 1, 'quantity' => $line['quantity'], 'notes' => $line['notes']];
                if ($line['existing']) {
                    $line['existing']->update($values);
                } else {
                    TreatmentProcedure::create($values + [
                        'treatment_id' => $current->id, 'service_id' => $line['service']->id,
                        'service_code' => $line['service']->code, 'service_name' => $line['service']->name,
                    ]);
                }
            }
            $current->update($fields + ['revision' => $current->revision + 1, 'updated_by_user_id' => $actor->id]);
            $this->history($current, $actor, 'treatment.documented', 'In Treatment');

            return [$current, 200];
        });
    }

    public function complete(User $actor, Treatment $treatment, int $expectedRevision, string $key, Closure $present): JsonResponse
    {
        $payload = ['treatment' => $treatment->id, 'expected_revision' => $expectedRevision];

        return $this->idempotent($actor, $key, 'treatment.complete', $payload, $present, function () use ($actor, $treatment, $expectedRevision) {
            [$current, $visit, $appointment, $queueEntry] = $this->lockClinicalEncounter($actor, $treatment);
            if ($current->status === 'Completed') {
                return [$current, 200];
            }
            if ($current->revision !== $expectedRevision) {
                throw self::stale();
            }
            $this->assertActiveEncounter($current, $visit, $appointment, $queueEntry);
            if (trim((string) $current->procedure_summary) === '') {
                throw VisitCommandException::rule('procedure_summary_required', 'Document the performed procedure before completing treatment.', 'procedure_summary');
            }
            $lines = $current->procedures()->with('service')->get();
            if ($lines->isEmpty()) {
                throw VisitCommandException::rule('procedures_required', 'Confirm at least one performed procedure before completing treatment.', 'procedures');
            }
            // Re-check every line against the current catalog: a service withdrawn since it was documented must be reviewed.
            $failures = [];
            foreach ($lines as $line) {
                if ($reason = $this->serviceFailure($line->service, $visit, $current)) {
                    $failures["procedures.".($line->line_no - 1)] = [$reason];
                }
            }
            if ($failures) {
                throw new VisitCommandException(422, 'procedure_invalid', 'A performed procedure is no longer valid for this branch or Dentist.', ['errors' => $failures]);
            }

            $current->update(['status' => 'Completed', 'completed_at' => ClinicClock::now(), 'revision' => $current->revision + 1, 'updated_by_user_id' => $actor->id]);
            $this->history($current, $actor, 'treatment.completed', 'In Treatment');
            $this->audit($actor, 'treatment.completed', $current, $visit->branch_id, ['visit' => $visit->public_id, 'from_status' => 'In Treatment', 'to_status' => 'Completed', 'revision' => $current->revision, 'procedure_lines' => $lines->count()]);
            $this->visits->applyClinical($actor, $visit, $appointment, 'Completed');
            // M20: a follow-up asked for in the treatment becomes a task for the branch front desk (once per treatment).
            \App\Services\Followups\Followups::fromTreatment($current);

            return [$current, 200];
        });
    }

    /**
     * Serialize documentation with start/completion in appointment -> Visit -> queue/container -> Treatment order.
     * Completed Treatments are immutable in PostgreSQL. Once the Visit is locked, an observed Completed result can
     * skip active-encounter prerequisites (including a missing legacy queue), but must still pass locked author checks.
     * Every runtime clinical writer holds the Visit before changing Treatment state.
     *
     * @return array{Treatment,Visit,?Appointment,?QueueEntry}
     */
    private function lockClinicalEncounter(User $actor, Treatment $treatment): array
    {
        $visitRow = Visit::whereKey($treatment->visit_id)->firstOrFail();
        $appointment = $visitRow->appointment_id ? Appointment::whereKey($visitRow->appointment_id)->lockForUpdate()->firstOrFail() : null;
        $visit = Visit::whereKey($treatment->visit_id)->lockForUpdate()->firstOrFail();
        $snapshot = Treatment::whereKey($treatment->id)->firstOrFail();
        if ($snapshot->visit_id !== $visit->id) {
            throw new VisitCommandException(409, 'conflict', 'The treatment encounter changed. Reload before trying again.');
        }
        $entry = null;
        if ($snapshot->status !== 'Completed') {
            $this->assertAppointmentLink($visit, $appointment);
            $entry = $this->queue->forClinicalVisit($visit);
        }
        $current = $this->lockForAuthor($actor, $treatment);
        $current->setRelation('visit', $visit);

        return [$current, $visit, $appointment, $entry];
    }

    private function assertActiveEncounter(Treatment $treatment, Visit $visit, ?Appointment $appointment, ?QueueEntry $entry): void
    {
        if ($treatment->status !== 'In Treatment' || $visit->status !== 'In Treatment' || ($appointment && $appointment->status !== 'In Treatment')) {
            throw VisitCommandException::rule('encounter_mismatch', 'The visit or its appointment is not In Treatment; this encounter needs clinic review.', 'visit');
        }
        if ($entry?->status !== 'Served') {
            throw VisitCommandException::rule('encounter_mismatch', 'The treatment queue entry is not Served; this encounter needs clinic review.', 'queue');
        }
    }

    /** Locks the Treatment and re-checks, under the lock, that the actor is its author and the Visit's responsible Dentist. */
    private function lockForAuthor(User $actor, Treatment $treatment): Treatment
    {
        $current = Treatment::whereKey($treatment->id)->lockForUpdate()->with(['dentist', 'visit.dentist'])->firstOrFail();
        if ($current->visit_id !== $treatment->visit_id) {
            throw new VisitCommandException(409, 'conflict', 'The treatment encounter changed. Reload before trying again.');
        }
        if ($actor->role->value !== 'dentist' || $current->dentist->person_id !== $actor->person_id || $current->visit->responsible_dentist_profile_id !== $current->dentist_profile_id) {
            throw new VisitCommandException(403, 'forbidden', 'Only the Dentist responsible for this treatment may change it.');
        }

        return $current;
    }

    /** Appointment and Visit are already locked. Status is checked separately; identities are never silently repaired. */
    private function assertAppointmentLink(Visit $visit, ?Appointment $appointment): void
    {
        $date = $visit->clinic_date->format('Y-m-d');
        if ($visit->appointment_id !== $appointment?->id
            || ($visit->source === 'appointment') !== ($appointment !== null)
            || ClinicClock::local($visit->arrived_at)->toDateString() !== $date
            || ($appointment && ($appointment->patient_id !== $visit->patient_id || $appointment->branch_id !== $visit->branch_id
                || $appointment->dentist_profile_id !== $visit->responsible_dentist_profile_id
                || ClinicClock::local($appointment->starts_at)->toDateString() !== $date))) {
            throw VisitCommandException::rule('appointment_mismatch', 'The appointment and visit identities do not agree. Clinic review is required.', 'appointment');
        }
    }

    /**
     * @param  list<array{id:?string,service_ref:string,quantity:int,notes:?string}>  $submitted
     * @return list<array{existing:?TreatmentProcedure,service:Service,quantity:int,notes:?string}>
     */
    private function resolveLines(Treatment $treatment, Visit $visit, array $submitted): array
    {
        $existing = $treatment->procedures()->get()->keyBy('public_id');
        $services = Service::whereIn('legacy_ref', array_column($submitted, 'service_ref'))->get()->keyBy('legacy_ref');
        $seen = [];
        $failures = [];
        $lines = [];
        foreach ($submitted as $index => $row) {
            $service = $services[$row['service_ref']] ?? null;
            if (! $service) {
                $failures["procedures.{$index}.service_ref"] = ['This service does not exist.'];

                continue;
            }
            if ($reason = $this->serviceFailure($service, $visit, $treatment)) {
                $failures["procedures.{$index}.service_ref"] = [$reason];

                continue;
            }
            $line = null;
            if (($row['id'] ?? null) !== null) {
                $line = $existing[$row['id']] ?? null;
                if (! $line || isset($seen[$row['id']])) {
                    $failures["procedures.{$index}.id"] = ['This procedure line does not belong to this treatment.'];

                    continue;
                }
                $seen[$row['id']] = true;
                // A line keeps its identity only for the same service; a changed service is recorded as a new line.
                if ($line->service_id !== $service->id) {
                    $line = null;
                }
            }
            $notes = isset($row['notes']) ? trim((string) $row['notes']) : null;
            $lines[] = ['existing' => $line, 'service' => $service, 'quantity' => (int) $row['quantity'], 'notes' => $notes === '' ? null : $notes];
        }
        if ($failures) {
            throw new VisitCommandException(422, 'procedure_invalid', 'Review the performed procedures.', ['errors' => $failures]);
        }

        return $lines;
    }

    /** The performed service must be Active, offered at the Visit's branch and authorized for the treating Dentist. */
    private function serviceFailure(?Service $service, Visit $visit, Treatment $treatment): ?string
    {
        if (! $service) {
            return 'This service does not exist.';
        }
        if ($service->status !== 'Active') {
            return 'This service is not active.';
        }
        if (! BranchService::where('branch_id', $visit->branch_id)->where('service_id', $service->id)->where('active', true)->exists()) {
            return 'This branch does not offer this service.';
        }
        if (! DentistServiceAssignment::where('dentist_profile_id', $treatment->dentist_profile_id)->where('service_id', $service->id)->where('is_authorized', true)->exists()) {
            return 'The Dentist is not authorized for this service.';
        }

        return null;
    }

    private function unchanged(Treatment $current, $existing, array $fields, array $lines): bool
    {
        foreach ($fields as $field => $value) {
            $stored = $field === 'followup_recommended_date' ? $current->followup_recommended_date?->format('Y-m-d') : $current->{$field};
            if ($stored !== $value) {
                return false;
            }
        }
        if (count($lines) !== $existing->count()) {
            return false;
        }
        foreach (array_values($lines) as $index => $line) {
            $old = $existing[$index] ?? null;
            if (! $line['existing'] || ! $old || $line['existing']->id !== $old->id || $old->quantity !== $line['quantity'] || $old->notes !== $line['notes']) {
                return false;
            }
        }

        return true;
    }

    /**
     * Minimal M22 event for the two clinically significant transitions. Public identifiers, the state change and a count only:
     * never the complaint, plan, notes, summary or procedure detail (that clinical text stays in M5's own history). It is written
     * in the command's transaction, so a failed audit write rolls the clinical transition back with it.
     */
    private function audit(User $actor, string $action, Treatment $treatment, int $branchId, array $payload): void
    {
        app(AuditService::class)->record([
            'action' => $action, 'category' => 'clinical', 'severity' => 'info', 'actor' => $actor, 'target' => $treatment,
            'branch_id' => $branchId, 'payload' => $payload,
        ]);
    }

    /** Appends the immutable history row with a snapshot of this revision's documentation and procedure lines. */
    private function history(Treatment $treatment, User $actor, string $event, ?string $from): void
    {
        $snapshot = collect(Treatment::EDITABLE)->mapWithKeys(fn ($field) => [
            $field => $field === 'followup_recommended_date' ? $treatment->followup_recommended_date?->format('Y-m-d') : $treatment->{$field},
        ])->all();
        $snapshot['procedures'] = $treatment->procedures()->get()->map(fn (TreatmentProcedure $line) => [
            'id' => $line->public_id, 'line_no' => $line->line_no, 'service_code' => $line->service_code,
            'service_name' => $line->service_name, 'quantity' => $line->quantity, 'notes' => $line->notes,
        ])->all();

        TreatmentHistory::create([
            'treatment_id' => $treatment->id,
            'event' => $event,
            'from_status' => $from,
            'to_status' => $treatment->status,
            'revision' => $treatment->revision,
            'snapshot' => $snapshot,
            'actor_user_id' => $actor->id,
            'actor_role' => $actor->role->value,
            'occurred_at' => ClinicClock::now(),
        ]);
    }

    public static function treatmentExists(): VisitCommandException
    {
        return new VisitCommandException(409, 'treatment_exists', 'Treatment has already started for this visit. Reload it to continue.');
    }

    public static function dentistBusy(): VisitCommandException
    {
        return new VisitCommandException(409, 'dentist_busy', 'Complete your current treatment before starting another.');
    }

    private static function stale(): VisitCommandException
    {
        return new VisitCommandException(409, 'stale_revision', 'This treatment changed after it was opened. Reload it before trying again.');
    }

    private static function readOnly(): VisitCommandException
    {
        return VisitCommandException::rule('treatment_completed', 'This treatment is completed and read-only. Amendments are not available.', 'status');
    }

    /** @param  Closure(Treatment): array  $present  renders the response body for the acting Dentist */
    private function idempotent(User $actor, string $key, string $command, array $payload, Closure $present, Closure $work): JsonResponse
    {
        return IdempotentCommand::run(
            CommandKey::class, $actor, $key, $command, $payload,
            function () use ($work, $present) {
                [$treatment, $status] = $work();

                return [$present($treatment->fresh(self::RELATIONS)), $status];
            },
            fn () => VisitCommandException::rule('idempotency_key_reused', 'This Idempotency-Key was already used for a different request.', 'idempotency_key'),
            function (QueryException $e) {
                // The database constraints are the final guard against concurrent duplicates.
                $message = $e->getMessage();
                if (str_contains($message, 'treatments_visit_id_unique')) {
                    throw self::treatmentExists();
                }
                if (str_contains($message, 'treatments_one_active_per_dentist')) {
                    throw self::dentistBusy();
                }
                if (in_array($e->getCode(), ['40P01', '40001'], true)) {
                    throw new VisitCommandException(409, 'conflict', 'Another request changed this treatment at the same time. Reload and try again.');
                }
            },
            self::ATTEMPTS,
        );
    }
}

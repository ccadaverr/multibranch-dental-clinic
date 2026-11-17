<?php

namespace App\Services\Queue;

use App\Http\Resources\QueueEntryResource;
use App\Models\CommandKey;
use App\Models\Patient;
use App\Models\QueueEntry;
use App\Models\QueueEntryHistory;
use App\Models\User;
use App\Models\Visit;
use App\Services\Visits\VisitCommandException;
use App\Support\ClinicClock;
use App\Support\IdempotentCommand;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

// M9 Patient Queue Management. The queue is anchored to the Visit and owns only queue state, number, order and position
// (M10 owns wait estimates and capacity). QueueService never calls VisitService: M8 arrival and the M5 Treatment start
// command call INTO it (enqueue / serve) inside their own transactions, so there is no circular dependency. The global
// lock order is appointment → Visit → queue entry → dentist queue counter (via its upsert), matching M6/M8.
final class QueueService
{
    public const RELATIONS = ['visit.patient.person', 'visit.appointment.service', 'visit.requestedService', 'dentistQueue.branch', 'dentistQueue.dentist.person'];

    private const ATTEMPTS = 3;

    /** command => [allowed source statuses, target status, history event] */
    public const TRANSITIONS = [
        'call' => [['Waiting'], 'Called', 'queue.called'],
        'ready' => [['Called'], 'Treatment Ready', 'queue.ready'],
        'away' => [['Waiting', 'Called', 'Treatment Ready'], 'Temporarily Away', 'queue.away'],
        'return' => [['Temporarily Away'], 'Waiting', 'queue.returned'],
    ];

    /**
     * Called by M8 inside its arrival transaction. A Visit with a responsible Dentist gets exactly one Waiting / Normal
     * entry numbered in its branch + Dentist + clinic-day queue; a Visit without one gets none (decision Q4). Any failure
     * propagates, so the whole arrival (appointment + Visit + queue entry) rolls back together.
     */
    public function enqueue(User $actor, Visit $visit, bool $late = false): ?QueueEntry
    {
        if ($visit->responsible_dentist_profile_id === null) {
            return null;
        }
        app(QueueOrder::class)->lock($visit->branch_id, $visit->clinic_date->format('Y-m-d'));
        [$queueId, $number] = $this->allocate($visit->branch_id, $visit->responsible_dentist_profile_id, $visit->clinic_date->format('Y-m-d'));
        $entry = QueueEntry::create([
            'visit_id' => $visit->id, 'dentist_queue_id' => $queueId, 'queue_number' => $number, 'status' => 'Waiting', 'priority' => 'Normal', 'late_arrival' => $late,
            'revision' => 1, 'created_by_user_id' => $actor->id, 'updated_by_user_id' => $actor->id,
        ]);
        $this->history($entry, $actor, $late ? 'queue.entered_late' : 'queue.entered', null, null);

        return $entry;
    }

    /**
     * Atomic per-queue number allocation: the first entry of a new Dentist/day queue gets 1, then 2, 3, … Concurrent
     * arrivals serialize on the dentist_queues row; UNIQUE (dentist_queue_id, queue_number) is the final guard.
     *
     * @return array{0:int,1:int} [dentist_queue_id, queue_number]
     */
    public function allocate(int $branchId, int $dentistId, string $clinicDate): array
    {
        $row = DB::selectOne(
            'INSERT INTO dentist_queues (branch_id, dentist_profile_id, clinic_date, next_number, created_at, updated_at)
             VALUES (?, ?, ?, 1, now(), now())
             ON CONFLICT (branch_id, dentist_profile_id, clinic_date)
             DO UPDATE SET next_number = dentist_queues.next_number + 1, updated_at = now()
             RETURNING id, next_number',
            [$branchId, $dentistId, $clinicDate]
        );

        return [(int) $row->id, (int) $row->next_number];
    }

    /**
     * Called by the M5 Treatment start command inside its transaction (after it locked the appointment and Visit):
     * the entry must be Called or Treatment Ready, and becomes Served — the Patient leaves the waiting queue because
     * treatment started. It is never Served any other way.
     */
    public function serve(User $actor, Visit $visit): QueueEntry
    {
        $entry = $this->forClinicalVisit($visit, true);
        if (! in_array($entry->status, ['Called', 'Treatment Ready'], true)) {
            throw VisitCommandException::rule('queue_not_ready', 'Call this patient before starting treatment.', 'queue');
        }
        $from = $entry->status;
        $entry->update(['status' => 'Served', 'closed_at' => ClinicClock::now(), 'revision' => $entry->revision + 1, 'updated_by_user_id' => $actor->id]);
        $this->history($entry, $actor, 'queue.served', $from, null);

        return $entry;
    }

    /** Caller holds the Visit lock; take the queue lock before any Treatment lock. Never repair persisted links. */
    public function forClinicalVisit(Visit $visit, bool $requireToday = false): QueueEntry
    {
        $entry = QueueEntry::where('visit_id', $visit->id)->lockForUpdate()->first();
        if (! $entry) {
            throw VisitCommandException::rule('not_in_queue', 'This visit has no queue entry. Clinic review is required.', 'queue');
        }
        app(QueueOrder::class)->lock($visit->branch_id, $visit->clinic_date->format('Y-m-d'));
        $this->assertVisitLink($entry, $visit, $requireToday);

        return $entry;
    }

    /** Named queue transitions: call, ready, away, return (Idempotency-Key + expected_revision). */
    public function transition(User $actor, QueueEntry $entry, string $command, int $expectedRevision, string $key): JsonResponse
    {
        [$from, $to, $event] = self::TRANSITIONS[$command];
        $payload = ['entry' => $entry->id, 'expected_revision' => $expectedRevision];

        return $this->idempotent($actor, $key, 'queue.'.$command, $payload, function () use ($actor, $entry, $command, $expectedRevision, $from, $to, $event) {
            [$visit, $current] = $this->lock($entry);
            $this->assertCurrent($current, $visit, $expectedRevision);
            if ($current->status === $to) {
                return $current;
            }
            if (! in_array($current->status, $from, true)) {
                throw VisitCommandException::rule('invalid_transition', "A queue entry that is {$current->status} cannot move to {$to}.", 'status');
            }
            if ($command === 'call' && $current->dentistQueue->dentist?->available === false) {
                throw VisitCommandException::rule('dentist_unavailable', 'This Dentist is marked unavailable. Ask Staff to review the queue.', 'dentist');
            }
            $previous = $current->status;
            $current->update(['status' => $to, 'revision' => $current->revision + 1, 'updated_by_user_id' => $actor->id]);
            $this->history($current, $actor, $event, $previous, null);

            return $current;
        });
    }

    /** Operational priority (not clinical triage): Normal / Priority / Urgent with a required reason; the state never changes. */
    public function priority(
        User $actor,
        QueueEntry $entry,
        string $priority,
        string $reason,
        int $expectedRevision,
        string $key,
        ?string $category = null,
        ?string $verificationStatus = null,
    ): JsonResponse {
        $persistedReason = $reason;
        if ($category !== null && $verificationStatus !== null) {
            $verificationLabel = $verificationStatus === 'verified' ? 'ID/eligibility verified' : 'Pending verification';
            if (! str_contains($persistedReason, $verificationLabel)) {
                $persistedReason = "{$persistedReason} [{$category} · {$verificationLabel}]";
            }
        }
        $payload = [
            'entry' => $entry->id,
            'expected_revision' => $expectedRevision,
            'priority' => $priority,
            'reason' => $persistedReason,
            'category' => $category,
            'verification_status' => $verificationStatus,
        ];

        return $this->idempotent($actor, $key, 'queue.priority', $payload, function () use ($actor, $entry, $priority, $persistedReason, $expectedRevision, $category, $verificationStatus) {
            [$visit, $current] = $this->lock($entry);
            $this->assertCurrent($current, $visit, $expectedRevision);
            if ($current->priority === $priority && $current->priority_reason === $persistedReason) {
                return $current;
            }
            if (in_array($current->status, ['Called', 'Treatment Ready'], true)) {
                throw VisitCommandException::rule('already_called', 'This patient has already been called and cannot be reordered by priority.', 'status');
            }
            $previous = $current->priority;
            $current->update(['priority' => $priority, 'priority_reason' => $persistedReason, 'revision' => $current->revision + 1, 'updated_by_user_id' => $actor->id]);
            $this->history($current, $actor, 'queue.priority_changed', $current->status, $previous);
            app(\App\Services\Audit\AuditService::class)->recordAdministrative('queue.priority_changed', $actor, $current, array_filter([
                'from_priority' => $previous,
                'to_priority' => $priority,
                'reason' => $persistedReason,
                'category' => $category,
                'verification_status' => $verificationStatus,
            ], fn ($v) => $v !== null));

            return $current;
        });
    }

    /**
     * Clear the late-arrival flag with a reason. This compatibility command never changes arrival order.
     */
    public function restoreOrder(User $actor, QueueEntry $entry, string $reason, int $expectedRevision, string $key): JsonResponse
    {
        $payload = ['entry' => $entry->id, 'expected_revision' => $expectedRevision, 'reason' => $reason];

        return $this->idempotent($actor, $key, 'queue.late_order', $payload, function () use ($actor, $entry, $reason, $expectedRevision) {
            [$visit, $current] = $this->lock($entry);
            $this->assertCurrent($current, $visit, $expectedRevision);
            if (! $current->late_arrival) {
                return $current;
            }
            $current->update(['late_arrival' => false, 'revision' => $current->revision + 1, 'updated_by_user_id' => $actor->id]);
            $this->history($current, $actor, 'queue.late_order_restored', $current->status, $current->priority, $reason);
            app(\App\Services\Audit\AuditService::class)->recordAdministrative('queue.late_order_restored', $actor, $current, ['reason' => $reason]);

            return $current;
        });
    }

    public function reorder(User $actor, QueueEntry $entry, ?string $beforeId, string $reason, string $orderRevision, int $expectedRevision, string $key): JsonResponse
    {
        $payload = ['entry' => $entry->id, 'before_entry_id' => $beforeId, 'reason' => $reason, 'order_revision' => $orderRevision, 'expected_revision' => $expectedRevision];

        return $this->idempotent($actor, $key, 'queue.reorder', $payload, function () use ($actor, $entry, $beforeId, $reason, $orderRevision, $expectedRevision) {
            [$visit, $current] = $this->lock($entry);
            $this->assertCurrent($current, $visit, $expectedRevision);
            $order = app(QueueOrder::class);
            $date = $visit->clinic_date->format('Y-m-d');
            $snapshot = $order->snapshot($visit->branch_id, $date);
            if (! hash_equals($snapshot['revision'], $orderRevision)) {
                throw VisitCommandException::staleQueueEntry();
            }
            $rows = $snapshot['rows'];
            if ($rows->count() > 500) {
                throw VisitCommandException::rule('queue_too_large', 'This queue needs clinic review before reordering.', 'queue');
            }
            $before = $beforeId === null ? null : $rows->firstWhere('public_id', $beforeId);
            if ($current->status !== 'Waiting' && $current->status !== 'In Queue') {
                throw VisitCommandException::rule('already_called', 'Only waiting Patients can be moved.', 'status');
            }
            if ($beforeId !== null && (! $before || $before->id === $current->id || ! in_array($before->status, ['Waiting', 'In Queue'], true))) {
                throw VisitCommandException::rule('invalid_queue_anchor', 'Choose another waiting Patient in this branch and day.', 'before_entry_id');
            }
            $ids = $rows->pluck('public_id')->all();
            $from = array_search($current->public_id, $ids, true);
            $ids = array_values(array_filter($ids, fn ($id) => $id !== $current->public_id));
            $to = $beforeId === null ? count($ids) : array_search($beforeId, $ids, true);
            array_splice($ids, $to, 0, [$current->public_id]);
            // A waiting move must never push a Called/Ready Patient backward.
            foreach ($rows as $index => $row) {
                if (in_array($row->status, ['Called', 'Treatment Ready'], true) && array_search($row->public_id, $ids, true) > $index) {
                    throw VisitCommandException::rule('already_called', 'Patients already called cannot be displaced.', 'before_entry_id');
                }
            }
            if ($from === $to) {
                return ['entry' => $current, 'receipt' => ['from_position' => $from + 1, 'to_position' => $to + 1, 'revision' => $snapshot['revision']]];
            }
            $current->update(['revision' => $current->revision + 1, 'updated_by_user_id' => $actor->id]);
            $this->history($current, $actor, 'queue.reordered', $current->status, $current->priority, $reason);
            app(\App\Services\Audit\AuditService::class)->record([
                'action' => 'queue.reordered', 'category' => 'administrative', 'actor' => $actor,
                'target' => $current, 'branch_id' => $visit->branch_id,
                'payload' => ['version' => 1, 'clinic_date' => $date, 'before_entry_id' => $beforeId,
                    'from_position' => $from + 1, 'to_position' => $to + 1, 'reason' => $reason,
                    'entry_revision' => $current->revision, 'previous_order_revision' => $orderRevision],
            ]);

            return ['entry' => $current, 'receipt' => ['from_position' => $from + 1, 'to_position' => $to + 1,
                'revision' => $order->snapshot($visit->branch_id, $date)['revision']]];
        });
    }

    /**
     * Server-computed arrival FIFO positions within each Dentist queue at its branch, with explicit audited moves.
     * In Queue / Waiting / Called / Treatment Ready retain a waiting position; exact Visit arrival time is first,
     * with the Visit's immutable id as the stable equal-time tie-breaker. Scheduled classification, priority
     * and late flags do not automatically move an arrival ahead. Served leaves this projection at treatment START.
     * The additive branch_position is exposed only to operational Staff/Owner; position retains Dentist scope.
     *
     * @param  list<int>  $dentistQueueIds
     * @return array<int,int> queue_entries.id => position
     */
    public function positions(array $dentistQueueIds): array
    {
        if (! $dentistQueueIds) {
            return [];
        }
        $positions = [];
        $contexts = DB::table('dentist_queues')->whereIn('id', $dentistQueueIds)->select('branch_id', 'clinic_date')->distinct()->get();
        foreach ($contexts as $context) {
            $counts = [];
            foreach (app(QueueOrder::class)->eligible($context->branch_id, $context->clinic_date) as $entry) {
                $counts[$entry->dentist_queue_id] = ($counts[$entry->dentist_queue_id] ?? 0) + 1;
                if (in_array($entry->dentist_queue_id, $dentistQueueIds, true)) {
                    $positions[$entry->id] = $counts[$entry->dentist_queue_id];
                }
            }
        }

        return $positions;
    }

    /** Attaches the server position to each entry (null for Temporarily Away / Served). */
    public function withPositions(iterable $entries): iterable
    {
        $entries = collect($entries);
        $positions = $this->positions($entries->pluck('dentist_queue_id')->unique()->values()->all());
        foreach ($entries as $entry) {
            $entry->setAttribute('position', $positions[$entry->id] ?? null);
        }
        foreach ($entries->groupBy(fn ($e) => $e->dentistQueue->branch_id.':'.$e->dentistQueue->clinic_date->format('Y-m-d')) as $group) {
            $queue = $group->first()->dentistQueue;
            $branchPositions = app(QueueOrder::class)->eligible($queue->branch_id, $queue->clinic_date->format('Y-m-d'))->pluck('id')->flip();
            foreach ($group as $entry) {
                $entry->setAttribute('branch_position', $branchPositions->has($entry->id) ? $branchPositions[$entry->id] + 1 : null);
            }
        }

        return $entries;
    }

    /**
     * The authenticated Patient's own current queue experience (decision Q5): their single active Visit and its entry.
     * Only this Patient's own number/position and display context they can already see — never other Patients, internal
     * ids or wait estimates. Null when there is no active encounter.
     */
    public function patientCurrent(Patient $patient): ?array
    {
        $visit = Visit::where('patient_id', $patient->id)->whereIn('status', Visit::ACTIVE_STATUSES)
            ->with(['branch', 'dentist.person', 'appointment.service', 'requestedService', 'queueEntry'])->orderByDesc('id')->first();
        if (! $visit) {
            return null;
        }
        $entry = $visit->queueEntry;
        $phase = match (true) {
            $visit->status === 'In Treatment' => 'in-treatment',
            $entry === null => 'checked-in',
            default => ['In Queue' => 'waiting', 'Waiting' => 'waiting', 'Called' => 'called', 'Treatment Ready' => 'ready', 'Temporarily Away' => 'away'][$entry->status] ?? 'checked-in',
        };
        $position = $entry && in_array($entry->status, QueueEntry::POSITIONAL, true) ? ($this->positions([$entry->dentist_queue_id])[$entry->id] ?? null) : null;
        $service = $visit->appointment?->service ?? $visit->requestedService;

        return [
            'phase' => $phase,
            'queue_status' => $entry?->status,
            'queue_number' => $entry?->queue_number,
            'position' => $position,
            'clinic_date' => $visit->clinic_date->format('Y-m-d'),
            'arrived_at' => ClinicClock::local($visit->arrived_at)->toIso8601String(),
            'branch' => ['name' => $visit->branch->name],
            'dentist' => $visit->dentist ? ['name' => $visit->dentist->person?->fullName()] : null,
            'service' => $service ? ['name' => $service->name] : null,
            'appointment' => $visit->appointment ? ['start_time' => ClinicClock::local($visit->appointment->starts_at)->format('H:i')] : null,
        ];
    }

    /** @return array{0:Visit,1:QueueEntry} locked in the global order (Visit, then queue entry). */
    private function lock(QueueEntry $entry): array
    {
        $visit = Visit::whereKey($entry->visit_id)->lockForUpdate()->firstOrFail();
        $current = QueueEntry::whereKey($entry->id)->lockForUpdate()->firstOrFail();
        if ($current->visit_id !== $visit->id || $current->dentist_queue_id !== $entry->dentist_queue_id) {
            throw new VisitCommandException(409, 'conflict', 'The queue encounter changed. Reload before trying again.');
        }
        // Validate even same-target no-ops; a malformed or historical encounter is not a current success.
        app(QueueOrder::class)->lock($visit->branch_id, $visit->clinic_date->format('Y-m-d'));
        $this->assertVisitLink($current, $visit, true);
        if ($visit->status !== 'Checked In' || $current->closed_at !== null
            || in_array($current->status, ['Served', 'Done', 'Cancelled', 'No-show'], true)) {
            throw VisitCommandException::rule('queue_closed', 'This patient has left the waiting queue.', 'status');
        }

        return [$visit, $current];
    }

    private function assertVisitLink(QueueEntry $entry, Visit $visit, bool $requireToday): void
    {
        $queue = $entry->dentistQueue()->lockForUpdate()->first();
        $date = $visit->clinic_date->format('Y-m-d');
        if (! $queue || $entry->visit_id !== $visit->id || $queue->branch_id !== $visit->branch_id
            || $visit->responsible_dentist_profile_id === null || $queue->dentist_profile_id !== $visit->responsible_dentist_profile_id
            || $queue->clinic_date->format('Y-m-d') !== $date || ClinicClock::local($visit->arrived_at)->toDateString() !== $date) {
            throw VisitCommandException::rule('queue_visit_mismatch', 'The queue and visit identities do not agree. Clinic review is required.', 'queue');
        }
        if ($requireToday && $date !== ClinicClock::today()) {
            throw VisitCommandException::rule('not_today', 'This queue entry belongs to another clinic day.', 'status');
        }
        $entry->setRelation('dentistQueue', $queue);
    }

    private function assertCurrent(QueueEntry $current, Visit $visit, int $expectedRevision): void
    {
        if ($current->revision !== $expectedRevision) {
            throw VisitCommandException::staleQueueEntry();
        }
        if ($current->status === 'Served' || $visit->status !== 'Checked In') {
            throw VisitCommandException::rule('queue_closed', 'This patient has left the waiting queue.', 'status');
        }
        // Existing rule (the prototype's "current day" check): only today's queue (Asia/Manila) can be operated.
        if ($current->dentistQueue->clinic_date->format('Y-m-d') !== ClinicClock::today()) {
            throw VisitCommandException::rule('not_today', 'This queue entry belongs to another clinic day.', 'status');
        }
    }

    private function history(QueueEntry $entry, User $actor, string $event, ?string $from, ?string $fromPriority, ?string $reason = null): void
    {
        QueueEntryHistory::create([
            'queue_entry_id' => $entry->id,
            'event' => $event,
            'from_status' => $from,
            'to_status' => $entry->status,
            'from_priority' => $fromPriority,
            'to_priority' => $entry->priority,
            'priority_reason' => $reason ?? ($event === 'queue.priority_changed' ? $entry->priority_reason : null),
            'revision' => $entry->revision,
            'actor_user_id' => $actor->id,
            'actor_role' => $actor->role->value,
            'occurred_at' => ClinicClock::now(),
        ]);
    }

    private function idempotent(User $actor, string $key, string $command, array $payload, Closure $work): JsonResponse
    {
        return DB::transaction(function () use ($actor, $key, $command, $payload, $work) {
            // Authority precedes receipt replay, including service calls that bypass HTTP middleware.
            $currentActor = User::whereKey($actor->id)->lock('FOR NO KEY UPDATE')->first();
            abort_unless($currentActor && $currentActor->person && $currentActor->account_status === 'Active'
                && $currentActor->auth_version === $actor->auth_version && $currentActor->role === $actor->role, 403);
            $currentEntry = QueueEntry::findOrFail($payload['entry']);
            Gate::forUser($currentActor)->authorize($command === 'queue.call' ? 'call' : 'operate', $currentEntry);

            return IdempotentCommand::run(
            CommandKey::class, $actor, $key, $command, $payload,
            function () use ($work) {
                $result = $work();
                $entry = ($result instanceof QueueEntry ? $result : $result['entry'])->fresh(self::RELATIONS);
                $this->withPositions([$entry]);
                $body = (new QueueEntryResource($entry))->response()->getData(true);
                if (is_array($result)) {
                    $body['meta']['queue_order'] = $result['receipt'];
                }

                return [$body, 200];
            },
            fn () => VisitCommandException::rule('idempotency_key_reused', 'This Idempotency-Key was already used for a different request.', 'idempotency_key'),
            function (QueryException $e) {
                if (in_array($e->getCode(), ['40P01', '40001'], true)) {
                    throw new VisitCommandException(409, 'conflict', 'Another request changed this queue at the same time. Reload and try again.');
                }
            },
            self::ATTEMPTS,
        );
        }, self::ATTEMPTS);
    }
}

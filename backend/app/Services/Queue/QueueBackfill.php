<?php

namespace App\Services\Queue;

use App\Models\QueueEntry;
use App\Models\QueueEntryHistory;
use App\Models\Visit;
use App\Models\VisitHistory;
use App\Support\ClinicClock;
use Illuminate\Support\Facades\DB;

// Server-data-only cutover backfill for M9 (decision Q9). Browser queue records are never uploaded; only Visits and their
// append-only history are used:
//   - Checked In Visit with a responsible Dentist  → Waiting / Normal entry, numbered per branch + Dentist + clinic day
//     in exact arrived_at order (Visit id as the stable tie-breaker);
//   - In Treatment Visit with a Dentist             → Served entry, closed at the exact `visit.treatment_started` time
//     (missing → reported and skipped, never guessed);
//   - Completed Visit, or a Visit without a Dentist → no entry.
// Called / Treatment Ready / Temporarily Away / priority existed only in browsers and cannot be reconstructed, so every
// backfilled active entry starts Waiting / Normal; cut over while the operational queue is empty.
// Deterministic, idempotent (Visits that already have an entry are skipped) and reversible (a `queue.backfilled` marker).
final class QueueBackfill
{
    public const MARKER = 'queue.backfilled';

    public function __construct(private readonly QueueService $queue) {}

    /** @return array{created:int, anomalies:list<array{visit:string, status:string, reason:string}>} */
    public function run(): array
    {
        $created = 0;
        $anomalies = [];
        $visits = Visit::query()->whereDoesntHave('queueEntry')
            ->whereIn('status', ['Checked In', 'In Treatment'])
            ->whereNotNull('responsible_dentist_profile_id')
            ->orderBy('clinic_date')->orderBy('arrived_at')->orderBy('id')
            ->get();

        foreach ($visits as $visit) {
            $started = $visit->status === 'In Treatment'
                ? VisitHistory::where('visit_id', $visit->id)->where('event', 'visit.treatment_started')->orderBy('id')->first()
                : null;
            if ($visit->status === 'In Treatment' && ! $started) {
                $anomalies[] = ['visit' => $visit->public_id, 'status' => $visit->status, 'reason' => 'missing_treatment_started_event'];

                continue;
            }
            DB::transaction(function () use ($visit, $started) {
                [$queueId, $number] = $this->queue->allocate($visit->branch_id, $visit->responsible_dentist_profile_id, $visit->clinic_date->format('Y-m-d'));
                $served = $started !== null;
                $entry = QueueEntry::create([
                    'visit_id' => $visit->id, 'dentist_queue_id' => $queueId, 'queue_number' => $number,
                    'status' => $served ? 'Served' : 'Waiting', 'priority' => 'Normal', 'revision' => 1,
                    'closed_at' => $served ? $started->occurred_at : null,
                ]);
                QueueEntryHistory::create([
                    'queue_entry_id' => $entry->id, 'event' => self::MARKER, 'from_status' => null, 'to_status' => $entry->status,
                    'from_priority' => null, 'to_priority' => 'Normal', 'priority_reason' => null, 'revision' => 1,
                    'actor_user_id' => null, 'actor_role' => 'system', 'occurred_at' => ClinicClock::now(),
                ]);
            });
            $created++;
        }

        return ['created' => $created, 'anomalies' => $anomalies];
    }

    /** Removes exactly the backfilled entries (identified by their marker), their history and emptied counters. */
    public function rollback(): int
    {
        $ids = QueueEntryHistory::where('event', self::MARKER)->pluck('queue_entry_id')->unique()->values()->all();
        if (! $ids) {
            return 0;
        }
        throw new \RuntimeException('Queue backfill cannot be rolled back by deleting append-only history. Restore a verified snapshot instead.');
    }
}

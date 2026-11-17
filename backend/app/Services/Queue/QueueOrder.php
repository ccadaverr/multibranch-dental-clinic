<?php

namespace App\Services\Queue;

use App\Models\AuditLog;
use App\Models\QueueEntry;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/** Arrival facts stay immutable. Explicit moves are replayed from append-only operational audit events. */
final class QueueOrder
{
    public function lock(int $branchId, string $date): void
    {
        // Always before the dentist counter lock. Every live queue writer participates in this branch/day lock.
        DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ["queue-order:{$branchId}:{$date}"]);
    }

    /** Includes terminal/away entries during replay so leaving anchors never undo earlier movements. */
    public function ordered(int $branchId, string $date): Collection
    {
        $entries = QueueEntry::query()->select('queue_entries.*')
            ->join('visits', 'visits.id', '=', 'queue_entries.visit_id')
            ->join('dentist_queues', 'dentist_queues.id', '=', 'queue_entries.dentist_queue_id')
            ->whereColumn('dentist_queues.branch_id', 'visits.branch_id')
            ->whereColumn('dentist_queues.clinic_date', 'visits.clinic_date')
            ->whereColumn('dentist_queues.dentist_profile_id', 'visits.responsible_dentist_profile_id')
            ->where('visits.branch_id', $branchId)->where('visits.clinic_date', $date)
            ->orderBy('visits.arrived_at')->orderBy('visits.id')->get();
        $byId = $entries->keyBy('public_id');
        $ids = $entries->pluck('public_id')->all();
        $moves = AuditLog::where('action', 'queue.reordered')->where('branch_id', $branchId)
            ->where('payload->clinic_date', $date)->orderBy('id')->get();
        foreach ($moves as $move) {
            $target = $move->auditable_public_id;
            $before = $move->payload['before_entry_id'] ?? null;
            if (! $byId->has($target) || ($before !== null && ! $byId->has($before)) || $target === $before) {
                continue;
            }
            $ids = array_values(array_filter($ids, fn ($id) => $id !== $target));
            $index = $before === null ? count($ids) : array_search($before, $ids, true);
            array_splice($ids, $index, 0, [$target]);
        }

        return collect($ids)->map(fn ($id) => $byId[$id]);
    }

    public function eligible(int $branchId, string $date): Collection
    {
        return $this->ordered($branchId, $date)->filter(fn ($e) => in_array($e->status, QueueEntry::POSITIONAL, true))->values();
    }

    public function snapshot(int $branchId, string $date): array
    {
        $rows = $this->eligible($branchId, $date);

        return [
            'revision' => hash('sha256', json_encode([$branchId, $date, $rows->map(fn ($e) => [$e->public_id, $e->revision, $e->status])->all()])),
            'rows' => $rows,
        ];
    }
}

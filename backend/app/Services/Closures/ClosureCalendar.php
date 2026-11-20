<?php

namespace App\Services\Closures;

use App\Models\BranchClosure;

/**
 * F5: the active closed dates, read once per request, job or command (a scoped instance) and consulted by Branch::hoursOnDate —
 * the one place every booking rule, calendar, reminder and email reads branch hours from. A branch's own closure wins over an
 * all-branches closure on the same date. Suggested (unconfirmed) holidays are ignored.
 */
final class ClosureCalendar
{
    /** @var array<string, array<int, BranchClosure>>|null date => [branch_id or 0 => closure] */
    private ?array $byDate = null;

    /** @var array{from:string,to:string,branches:array<int,true>,days:array<string,array<int,BranchClosure>>}|null */
    private ?array $range = null;

    /**
     * Read-only month view: fetch only relevant branch and global closures.
     * Other dates/branches still fall back to the authoritative full lookup.
     * Never use this snapshot to authorize a write or a booking command.
     *
     * @param list<int> $branchIds
     */
    public function primeRange(array $branchIds, string $from, string $to): void
    {
        if (! $branchIds || $from > $to) return;
        $ids = array_values(array_unique(array_map('intval', $branchIds)));
        $days = [];
        $rows = BranchClosure::query()->where('status', 'active')->whereBetween('closed_on', [$from, $to])
            ->where(fn ($q) => $q->whereNull('branch_id')->orWhereIn('branch_id', $ids))
            ->get();
        foreach ($rows as $row) {
            $days[$row->dateString()][$row->branch_id ?? 0] = $row;
        }
        $this->range = ['from' => $from, 'to' => $to,
            'branches' => array_fill_keys($ids, true), 'days' => $days];
    }

    public function forDate(int $branchId, string $date): ?BranchClosure
    {
        if ($this->range !== null && $date >= $this->range['from'] && $date <= $this->range['to']
            && isset($this->range['branches'][$branchId])) {
            $day = $this->range['days'][$date] ?? [];
            return $day[$branchId] ?? $day[0] ?? null;
        }
        $this->byDate ??= $this->load();
        $day = $this->byDate[$date] ?? [];

        return $day[$branchId] ?? $day[0] ?? null;
    }

    public function flush(): void
    {
        $this->byDate = null;
        $this->range = null;
    }

    private function load(): array
    {
        $out = [];
        foreach (BranchClosure::where('status', 'active')->where('closed_on', '>=', now()->subYear()->toDateString())->get() as $c) $out[$c->dateString()][$c->branch_id ?? 0] = $c;

        return $out;
    }
}

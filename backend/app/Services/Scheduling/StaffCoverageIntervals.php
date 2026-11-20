<?php

namespace App\Services\Scheduling;

/** Pure half-open minute interval calculations, with no scheduling or authorization policy. */
final class StaffCoverageIntervals
{
    /** @param array<int,array{0:int,1:int}> $intervals @return array<int,array{0:int,1:int}> */
    public static function merge(array $intervals): array
    {
        $intervals = array_values(array_filter($intervals, fn (array $range) => $range[0] < $range[1]));
        usort($intervals, fn (array $a, array $b) => $a[0] <=> $b[0] ?: $a[1] <=> $b[1]);
        $merged = [];
        foreach ($intervals as $range) {
            $last = count($merged) - 1;
            if ($last >= 0 && $range[0] <= $merged[$last][1]) {
                $merged[$last][1] = max($merged[$last][1], $range[1]);
            } else {
                $merged[] = $range;
            }
        }
        return $merged;
    }

    /** Return the uncovered portions of a requested interval. Endpoints touching are not overlaps. */
    public static function gaps(int $start, int $end, array $covered): array
    {
        if ($end <= $start) return [];
        $gaps = [];
        $cursor = $start;
        foreach (self::merge($covered) as [$from, $to]) {
            if ($to <= $cursor || $from >= $end) continue;
            if ($from > $cursor) $gaps[] = [$cursor, min($from, $end)];
            $cursor = max($cursor, min($end, $to));
            if ($cursor >= $end) break;
        }
        if ($cursor < $end) $gaps[] = [$cursor, $end];
        return $gaps;
    }

    /** Remove approved leave intervals from one Staff member's published duty. */
    public static function subtract(array $scheduled, array $leave): array
    {
        $available = [];
        foreach ($scheduled as [$from, $to]) {
            $available = array_merge($available, self::gaps($from, $to, $leave));
        }
        return self::merge($available);
    }
}

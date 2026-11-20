<?php

namespace App\Services\Scheduling;

use App\Models\Appointment;
use App\Models\Branch;
use App\Models\DentistProfile;
use App\Models\DentistSchedule;
use App\Models\DentistScheduleException;
use App\Models\LeaveRequest;
use App\Support\ClinicClock;
use Illuminate\Support\Collection;

/**
 * M3 Work Schedules: the minutes a dentist can see patients at a branch on a clinic date.
 *
 *   branch hours ∩ (that date's exception, else the weekly schedule for that weekday and branch) − break − approved leave (M15)
 *
 * A dentist with no weekly schedule rows at all still uses the hours on their profile (data the Owner entered, not a value
 * invented here); the calendar then says its capacity is estimated. A day off covers every branch; custom hours at one branch
 * mean the dentist works only there that day. Appointments are never cancelled here: affected() only lists them.
 * The memo lives for one instance (one request or one search).
 */
final class WorkSchedules
{
    /** @var array<int, Collection> */
    private array $weekly = [];

    /** @var array<string, Collection> */
    private array $exceptions = [];

    /** @var array<string, Collection> */
    private array $leave = [];

    public function flush(): void
    {
        $this->weekly = $this->exceptions = $this->leave = [];
    }

    /** Prime the calendar's read-only date range. Booking commands still acquire fresh scheduling data. */
    public function preloadCalendar(Collection $pool, string $first, string $last): void
    {
        if ($pool->isEmpty() || $first > $last) return;
        $ids = $pool->pluck('id')->unique()->values();
        // These weekly rows are reused for every date/branch below. Without a
        // prefill, usesProfileHours() issues a remote query for each dentist.
        $weekly = DentistSchedule::whereIn('dentist_profile_id', $ids)
            ->where('status', 'active')->get()->groupBy('dentist_profile_id');
        foreach ($ids as $id) {
            $this->weekly[$id] = $weekly->get($id, collect());
        }
        $exceptions = DentistScheduleException::whereIn('dentist_profile_id', $ids)->where('status', 'active')
            ->whereBetween('on_date', [$first, $last])->get()->groupBy(fn ($row) => $row->dentist_profile_id.':'.substr($row->getRawOriginal('on_date'), 0, 10));
        $leaves = LeaveRequest::whereIn('dentist_profile_id', $ids)->where('status', 'Approved')
            ->where('starts_at', '<', SchedulingService::ts(ClinicClock::at($last, '00:00')->addDay()))
            ->where('ends_at', '>', SchedulingService::ts(ClinicClock::at($first, '00:00')))->get()->groupBy('dentist_profile_id');
        for ($date = $first; $date <= $last; $date = ClinicClock::addDays($date, 1)) {
            $start = ClinicClock::at($date, '00:00');
            $end = $start->addDay();
            foreach ($ids as $id) {
                $key = $id.':'.$date;
                $this->exceptions[$key] = $exceptions->get($key, collect());
                $this->leave[$key] = $leaves->get($id, collect())->filter(fn ($row) => $row->starts_at < $end && $row->ends_at > $start);
            }
        }
    }

    /** True when this dentist has no weekly schedule yet and booking uses the hours on their profile. */
    public function usesProfileHours(DentistProfile $d): bool
    {
        return $this->weeklyRows($d)->isEmpty();
    }

    /** @return list<array{0:int,1:int}> working minutes before leave (schedule ∩ branch hours, break removed) */
    public function workWindows(DentistProfile $d, Branch $b, string $date): array
    {
        $hours = $b->hoursOnDate($date);
        if ($hours === null) return [];
        $open = ClinicClock::minutes($hours['open']);
        $close = ClinicClock::minutes($hours['close']);

        $exceptions = $this->exceptionRows($d, $date);
        if ($exceptions->contains('kind', 'day_off')) return [];
        $custom = $exceptions->where('kind', 'custom_hours');
        if ($custom->isNotEmpty()) {
            $here = $custom->firstWhere('branch_id', $b->id);
            if (! $here) return []; // working somewhere else that day

            return self::clip([[self::m($here->start_time), self::m($here->end_time)]], $open, $close);
        }

        if ($this->usesProfileHours($d)) {
            if (! $d->shift_start || ! $d->shift_end) return [];

            return self::clip([[self::m($d->shift_start), self::m($d->shift_end)]], $open, $close);
        }
        $weekday = \Carbon\CarbonImmutable::createFromFormat('!Y-m-d', $date, ClinicClock::TIMEZONE)->isoWeekday();
        $row = $this->weeklyRows($d)->first(fn (DentistSchedule $s) => $s->weekday === $weekday && $s->branch_id === $b->id);
        if (! $row) return [];
        $windows = $row->break_start && $row->break_end
            ? [[self::m($row->start_time), self::m($row->break_start)], [self::m($row->break_end), self::m($row->end_time)]]
            : [[self::m($row->start_time), self::m($row->end_time)]];

        return self::clip($windows, $open, $close);
    }

    /** @return list<array{0:int,1:int}> bookable minutes: the working windows minus approved leave */
    public function windows(DentistProfile $d, Branch $b, string $date): array
    {
        $windows = $this->workWindows($d, $b, $date);
        foreach ($this->leaveRows($d, $date) as $leave) {
            [$from, $to] = self::leaveMinutes($leave, $date);
            $windows = self::subtract($windows, $from, $to);
        }

        return $windows;
    }

    public function fits(DentistProfile $d, Branch $b, string $date, int $start, int $end, bool $withLeave = true): bool
    {
        foreach ($withLeave ? $this->windows($d, $b, $date) : $this->workWindows($d, $b, $date) as [$from, $to]) {
            if ($start >= $from && $end <= $to) return true;
        }

        return false;
    }

    public function onLeave(DentistProfile $d, string $date, int $start, int $end): bool
    {
        foreach ($this->leaveRows($d, $date) as $leave) {
            [$from, $to] = self::leaveMinutes($leave, $date);
            if ($start < $to && $end > $from) return true;
        }

        return false;
    }

    public function minutes(DentistProfile $d, Branch $b, string $date): int
    {
        return array_sum(array_map(fn ($w) => $w[1] - $w[0], $this->windows($d, $b, $date)));
    }

    /** True when the dentist can start seeing a walk-in at this branch now (inside a bookable window). */
    public function workingNow(DentistProfile $d, Branch $b): bool
    {
        $now = ClinicClock::now();
        $m = $now->hour * 60 + $now->minute;
        foreach ($this->windows($d, $b, $now->toDateString()) as [$from, $to]) {
            if ($m >= $from && $m < $to) return true;
        }

        return false;
    }

    /**
     * Upcoming Pending/Confirmed appointments of this dentist (optionally one branch) from $fromDate to $toDate (inclusive) that no
     * longer fit the schedule and leave. Only listed: never cancelled or moved here.
     */
    public function affected(DentistProfile $d, string $fromDate, string $toDate, ?int $branchId = null): Collection
    {
        $this->flush();
        $from = ClinicClock::at($fromDate, '00:00');
        $now = ClinicClock::now();
        if ($from->lessThan($now)) $from = $now;

        return Appointment::whereIn('status', ['Pending', 'Confirmed'])->where('dentist_profile_id', $d->id)
            ->where('starts_at', '>=', SchedulingService::ts($from))->where('starts_at', '<', SchedulingService::ts(ClinicClock::at($toDate, '00:00')->addDay()))
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->with(['branch', 'service', 'patient.person'])->orderBy('starts_at')->get()
            ->filter(function (Appointment $a) use ($d) {
                $local = ClinicClock::local($a->starts_at);
                $start = $local->hour * 60 + $local->minute;

                return ! $this->fits($d, $a->branch, $local->toDateString(), $start, $start + (int) $a->duration_minutes);
            })->values();
    }

    private function weeklyRows(DentistProfile $d): Collection
    {
        return $this->weekly[$d->id] ??= DentistSchedule::where('dentist_profile_id', $d->id)->where('status', 'active')->get();
    }

    private function exceptionRows(DentistProfile $d, string $date): Collection
    {
        return $this->exceptions[$d->id.':'.$date] ??= DentistScheduleException::where('dentist_profile_id', $d->id)->where('status', 'active')->where('on_date', $date)->get();
    }

    private function leaveRows(DentistProfile $d, string $date): Collection
    {
        $dayStart = ClinicClock::at($date, '00:00');

        return $this->leave[$d->id.':'.$date] ??= LeaveRequest::where('dentist_profile_id', $d->id)->where('status', 'Approved')
            ->where('starts_at', '<', SchedulingService::ts($dayStart->addDay()))->where('ends_at', '>', SchedulingService::ts($dayStart))->get();
    }

    /** @return array{0:int,1:int} the leave's part of this clinic date in minutes (0 to 1440) */
    private static function leaveMinutes(LeaveRequest $leave, string $date): array
    {
        $dayStart = ClinicClock::at($date, '00:00');
        $from = max(0, (int) floor(($leave->starts_at->getTimestamp() - $dayStart->getTimestamp()) / 60));
        $to = min(1440, (int) ceil(($leave->ends_at->getTimestamp() - $dayStart->getTimestamp()) / 60));

        return [$from, $to];
    }

    private static function m($time): int
    {
        return ClinicClock::minutes(substr((string) $time, 0, 5));
    }

    /** @param list<array{0:int,1:int}> $windows */
    private static function clip(array $windows, int $open, int $close): array
    {
        $out = [];
        foreach ($windows as [$a, $b]) {
            $a = max($a, $open);
            $b = min($b, $close);
            if ($a < $b) $out[] = [$a, $b];
        }

        return $out;
    }

    /** @param list<array{0:int,1:int}> $windows */
    private static function subtract(array $windows, int $from, int $to): array
    {
        $out = [];
        foreach ($windows as [$a, $b]) {
            if ($to <= $a || $from >= $b) { $out[] = [$a, $b]; continue; }
            if ($from > $a) $out[] = [$a, $from];
            if ($to < $b) $out[] = [$to, $b];
        }

        return $out;
    }
}

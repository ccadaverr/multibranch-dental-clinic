<?php

namespace App\Services\Scheduling;

use App\Models\Appointment;
use App\Models\Branch;
use App\Models\BranchService;
use App\Models\DentistProfile;
use App\Models\Service;
use App\Support\ClinicClock;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

// M6 scheduling authority — the backend port of src/logic.js validateAppointment and src/scheduling.js
// (dentistsFor / assignDentist / findOpenTimes). Deterministic, no AI, no randomness. Every command, availability
// search and recommendation goes through evaluate(); controllers never re-implement a rule. The frontend copy stays
// a UX pre-check only (CONTRACTS.md §6).
//
// Production rules applied here on top of the ported checks:
// - Patient online scheduling: dates tomorrow .. one calendar month after tomorrow (inclusive, Asia/Manila) and
//   start times on the hour. Duration stays service-specific.
// - Staff/Owner: no Patient window; not in the past; start times on a 30-minute boundary (the step the current
//   Staff slot picker offers — src/logic.js availableSlots).
// - Dentist time: M3 work schedules and M15 approved leave (WorkSchedules); no shift is hard-coded.
// - Branch opening days: branches.operating_days (ISO weekdays) set by the Owner; NULL = every day (the interview, Q10, says
//   weekends are busier, so no weekday is closed by default). Holiday/one-off closures: none exist yet, none are invented.
final class SchedulingService
{
    public const RULE_VERSION = 'dentist-assignment-v1';

    public const PATIENT_GRID_MINUTES = 60;

    public const STAFF_GRID_MINUTES = 30;

    // Memo for one search only: cleared at every entry point that does not receive a preloaded `$busy` set, so a
    // long-lived instance never serves a stale branch-service assignment.
    /** @var array<string, BranchService|null> */
    private array $branchServices = [];

    private ?WorkSchedules $work = null;

    /** M3: the work-schedule source every check, search and capacity count uses (memo per search). */
    public function work(): WorkSchedules
    {
        return $this->work ??= new WorkSchedules;
    }

    /** @return array{0:string,1:string} first and last Patient-bookable dates, inclusive */
    public function patientWindow(?CarbonImmutable $now = null): array
    {
        $today = ($now ?? ClinicClock::now())->toDateString();
        $first = CarbonImmutable::createFromFormat('!Y-m-d', $today, ClinicClock::TIMEZONE)->addDay()->toDateString();

        return [$first, ClinicClock::addCalendarMonths($first, 1)];
    }

    public function branchService(Branch $branch, Service $service): ?BranchService
    {
        $key = $branch->id.':'.$service->id;

        return $this->branchServices[$key] ??= BranchService::where('branch_id', $branch->id)
            ->where('service_id', $service->id)->where('active', true)->first();
    }

    public function duration(Branch $branch, Service $service): ?int
    {
        $assignment = $this->branchService($branch, $service);

        return $assignment ? (int) ($assignment->duration_override_minutes ?? $service->duration_minutes) : null;
    }

    /** Open branches that actively offer an Active service (the only branches Smart Scheduling may rank). */
    public function branchesOffering(Service $service): Collection
    {
        if ($service->status !== 'Active') {
            return collect();
        }

        return Branch::where('status', 'Open')
            ->whereHas('branchServices', fn (Builder $q) => $q->where('service_id', $service->id)->where('active', true))
            ->orderBy('id')->get();
    }

    /**
     * src/scheduling.js dentistsFor, from M3 Dentist data only: branch assignment + authorized service + available.
     * A login account is authentication identity, not scheduling identity, so it never affects eligibility — a
     * Dentist with no User (or an inactive one) is still bookable when the profile permits it.
     */
    public function eligibleDentists(Branch $branch, Service $service): Collection
    {
        return DentistProfile::query()
            ->where('available', true)
            ->whereHas('branches', fn (Builder $q) => $q->where('branches.id', $branch->id))
            ->whereHas('services', fn (Builder $q) => $q->where('services.id', $service->id)->where('dentist_service_assignments.is_authorized', true))
            ->with(['person', 'branches', 'services'])
            ->orderBy('id')
            ->get();
    }

    /** Active appointments that could conflict with anything in [from, to) for these Dentists or this Patient. */
    public function busyBetween(CarbonImmutable $from, CarbonImmutable $to, array $dentistIds, ?int $patientId, ?int $ignoreId = null): Collection
    {
        return Appointment::active()
            ->where('starts_at', '<', self::ts($to))
            ->where('ends_at', '>', self::ts($from))
            ->where(fn (Builder $q) => $q->whereIn('dentist_profile_id', $dentistIds ?: [0])->orWhere('patient_id', $patientId ?? 0))
            ->when($ignoreId, fn (Builder $q) => $q->whereKeyNot($ignoreId))
            ->get(['id', 'patient_id', 'dentist_profile_id', 'starts_at', 'ends_at', 'duration_minutes', 'status']);
    }

    /**
     * The single validator (src/logic.js validateAppointment). `$busy` is an optional preloaded set of active
     * appointments covering the slot (used by searches); without it the database is queried directly.
     */
    public function evaluate(SlotRequest $r, ?Collection $busy = null, ?CarbonImmutable $now = null): ScheduleResult
    {
        $this->freshSearch($busy);
        $now ??= ClinicClock::now();
        $today = $now->toDateString();
        $checks = [];
        $check = function (string $key, string $label, mixed $ok) use (&$checks) {
            $checks[] = ['key' => $key, 'label' => $label, 'ok' => (bool) $ok];
        };

        $branch = $r->branch;
        $service = $r->service;
        $dentist = $r->dentist;
        $assignment = $branch && $service ? $this->branchService($branch, $service) : null;
        $duration = $assignment ? (int) ($assignment->duration_override_minutes ?? $service->duration_minutes) : null;
        $dentist?->loadMissing(['branches', 'services', 'person']);

        if ($r->patient || $r->requirePatient) {
            $check('patient', 'Patient exists', $r->patient);
        }
        $check('branch-status', 'Branch is open', $branch?->status === 'Open');
        $check('branch-day', 'Branch is open on this day', $branch && ClinicClock::validDate($r->date) && self::openOn($branch, $r->date));
        $check('service-exists', 'Service is active', $service?->status === 'Active');
        if ($r->patientRules && $r->ignoreAppointmentId === null) {
            $check('service-online', 'Service can be booked online', ($service?->online_booking ?? 'bookable') === 'bookable');
        }
        $check('service', 'Service available at branch', $assignment);
        $check('dentist', 'Dentist exists', $dentist);
        $check('dentist-branch', 'Dentist assigned to branch', $dentist && $branch && $dentist->branches->contains('id', $branch->id));
        $check('dentist-service', 'Dentist can perform selected service', $dentist && $service
            && $dentist->services->contains(fn (Service $s) => $s->id === $service->id && $s->pivot->is_authorized));
        // Operational availability from the M3 profile only; login/account state is deliberately not consulted.
        $check('dentist-active', 'Dentist currently available', $dentist?->available);

        $validDate = ClinicClock::validDate($r->date);
        $validTime = ClinicClock::validTime($r->startTime);
        if ($r->patientRules) {
            [$first, $last] = $this->patientWindow($now);
            $check('date-window', "Date is within the online booking window ({$first} to {$last})", $validDate && $r->date >= $first && $r->date <= $last);
            $check('time', 'Valid start time', $validTime);
            $check('grid', 'Start time is on the hour', $validTime && ClinicClock::minutes($r->startTime) % self::PATIENT_GRID_MINUTES === 0);
        } else {
            $check('date', 'Date is not in the past', $validDate && $r->date >= $today);
            $check('time', 'Valid future start time', $validTime && ($r->date !== $today || $r->startTime > $now->format('H:i')));
            $check('grid', 'Start time is on a 30-minute boundary', $validTime && ClinicClock::minutes($r->startTime) % self::STAFF_GRID_MINUTES === 0);
        }
        $check('duration', 'Valid service duration', $duration > 0);

        $start = $validTime ? ClinicClock::minutes($r->startTime) : null;
        $end = $start !== null && $duration > 0 ? $start + $duration : null;
        // That day's own opening hours (weekday, Saturday and Sunday hours differ; a closed day has none).
        $dayHours = $branch && $validDate ? $branch->hoursOnDate($r->date) : null;
        $check('branch-hours', 'Within branch operating hours', $dayHours !== null && $end !== null
            && $start >= ClinicClock::minutes($dayHours['open']) && $end <= ClinicClock::minutes($dayHours['close']));
        // M3/M15: branch hours ∩ the dentist's schedule (weekly, or that date's exception) − break, then approved leave.
        $scheduled = $dentist && $branch && $validDate && $end !== null && $this->work()->fits($dentist, $branch, $r->date, $start, $end, false);
        $check('dentist-shift', 'Within the dentist\'s work schedule', $scheduled);
        $check('dentist-leave', 'Dentist is not on leave', ! ($dentist && $validDate && $end !== null && $this->work()->onLeave($dentist, $r->date, $start, $end)));

        $startsAt = $endsAt = null;
        $dentistConflict = $patientConflict = false;
        if ($validDate && $validTime && $duration > 0) {
            $startsAt = ClinicClock::at($r->date, $r->startTime);
            $endsAt = $startsAt->addMinutes($duration);
            $overlapping = ($busy ?? $this->busyBetween($startsAt, $endsAt, $dentist ? [$dentist->id] : [], $r->patient?->id, $r->ignoreAppointmentId))
                ->filter(fn (Appointment $a) => $a->id !== $r->ignoreAppointmentId && $a->starts_at < $endsAt && $a->ends_at > $startsAt);
            $dentistConflict = $dentist && $overlapping->contains('dentist_profile_id', $dentist->id);
            $patientConflict = $r->patient && $overlapping->contains('patient_id', $r->patient->id);
        }
        $check('overlap', 'No overlapping dentist appointment', ! $dentistConflict);
        $check('patient-overlap', 'No overlapping patient appointment', ! $patientConflict);

        $valid = collect($checks)->every(fn (array $c) => $c['ok']);

        return new ScheduleResult($valid, $checks, $duration, $startsAt, $endsAt);
    }

    /**
     * src/scheduling.js assignDentist: every eligible Dentist that passes evaluate() is ranked by fewest booked
     * minutes on that clinic date (active appointments only), tied by ascending Dentist profile id. Returns null when
     * no Dentist is eligible — never a fallback Dentist.
     */
    public function assignDentist(SlotRequest $r, ?Collection $pool = null, ?Collection $busy = null, ?CarbonImmutable $now = null): ?array
    {
        $this->freshSearch($busy);
        if (! $r->branch || ! $r->service || ! ClinicClock::validDate($r->date) || ! ClinicClock::validTime($r->startTime)) {
            return null;
        }
        $pool ??= $this->eligibleDentists($r->branch, $r->service);
        if ($pool->isEmpty()) {
            return null;
        }
        if ($busy === null) {
            $dayStart = ClinicClock::at($r->date, '00:00');
            $busy = $this->busyBetween($dayStart, $dayStart->addDay(), $pool->pluck('id')->all(), $r->patient?->id, $r->ignoreAppointmentId);
        }

        $ranked = $pool
            ->map(fn (DentistProfile $d) => ['dentist' => $d, 'result' => $this->evaluate($r->withDentist($d), $busy, $now), 'minutes' => $this->bookedMinutes($busy, $d->id, $r->date, $r->ignoreAppointmentId)])
            ->filter(fn (array $c) => $c['result']->valid)
            ->sort(fn (array $a, array $b) => [$a['minutes'], $a['dentist']->id] <=> [$b['minutes'], $b['dentist']->id])
            ->values();

        return $ranked->first();
    }

    /** Valid start times on one date, each with the Dentist that would be assigned right now (reserves nothing). */
    public function slotsOn(SlotRequest $base, string $date, ?Collection $pool = null, ?Collection $busy = null, ?CarbonImmutable $now = null, int $limit = PHP_INT_MAX): array
    {
        $this->freshSearch($busy);
        $branch = $base->branch;
        $service = $base->service;
        $duration = $branch && $service ? $this->duration($branch, $service) : null;
        if (! $duration || ! ClinicClock::validDate($date) || ! self::openOn($branch, $date)) {
            return [];
        }
        $pool ??= $this->eligibleDentists($branch, $service);
        if ($pool->isEmpty()) {
            return [];
        }
        if ($busy === null) {
            $dayStart = ClinicClock::at($date, '00:00');
            $busy = $this->busyBetween($dayStart, $dayStart->addDay(), $pool->pluck('id')->all(), $base->patient?->id, $base->ignoreAppointmentId);
        }
        $grid = $base->patientRules ? self::PATIENT_GRID_MINUTES : self::STAFF_GRID_MINUTES;
        $hours = $branch->hoursOnDate($date);
        $open = ClinicClock::minutes($hours['open']);
        $close = ClinicClock::minutes($hours['close']);
        $firstStart = (int) (ceil($open / $grid) * $grid);
        $slots = [];
        for ($m = $firstStart; $m + $duration <= $close && count($slots) < $limit; $m += $grid) {
            $time = ClinicClock::time($m);
            $choice = $this->assignDentist($base->at($date, $time), $pool, $busy, $now);
            if ($choice) {
                $slots[] = ['date' => $date, 'start_time' => $time, 'result' => $choice['result'], 'dentist' => $choice['dentist']];
            }
        }

        return $slots;
    }

    /**
     * Smart Scheduling (Patient): rank only Open branches offering the service — by distance when both the Patient's
     * location and authoritative branch coordinates exist, otherwise the Patient must choose a branch (no invented
     * coordinates, no guessed branch) — then return the earliest valid slot within the Patient window.
     *
     * @return array{location_ranking:string, eligible_branches:Collection, recommendation:?array}
     */
    public function recommend(SlotRequest $base, ?float $latitude, ?float $longitude, ?CarbonImmutable $now = null): array
    {
        $this->freshSearch(null);
        $now ??= ClinicClock::now();
        $eligible = $this->branchesOffering($base->service);

        if ($base->branch) {
            $candidates = $eligible->where('id', $base->branch->id)->values();
            $ranking = 'branch_selected';
        } else {
            $located = $eligible->filter(fn (Branch $b) => $b->latitude !== null && $b->longitude !== null);
            if ($latitude === null || $longitude === null || $located->isEmpty()) {
                return ['location_ranking' => 'unavailable', 'eligible_branches' => $eligible, 'recommendation' => null];
            }
            $candidates = $located
                ->sortBy(fn (Branch $b) => [self::haversineKm($latitude, $longitude, (float) $b->latitude, (float) $b->longitude), $b->id])
                ->values();
            $ranking = 'distance';
        }

        [$first, $last] = $this->patientWindow($now);
        foreach ($candidates as $branch) {
            $request = new SlotRequest($base->patient, $branch, $base->service, null, null, null, true);
            $pool = $this->eligibleDentists($branch, $base->service);
            if ($pool->isEmpty()) {
                continue;
            }
            $busy = $this->busyBetween(ClinicClock::at($first, '00:00'), ClinicClock::at($last, '00:00')->addDay(), $pool->pluck('id')->all(), $base->patient?->id);
            for ($date = $first; $date <= $last; $date = CarbonImmutable::createFromFormat('!Y-m-d', $date, ClinicClock::TIMEZONE)->addDay()->toDateString()) {
                $slots = $this->slotsOn($request, $date, $pool, $busy, $now, 1);
                if ($slots) {
                    return ['location_ranking' => $ranking, 'eligible_branches' => $eligible, 'recommendation' => $slots[0] + ['branch' => $branch]];
                }
            }
        }

        return ['location_ranking' => $ranking, 'eligible_branches' => $eligible, 'recommendation' => null];
    }

    private function freshSearch(?Collection $busy): void
    {
        if ($busy === null) {
            $this->branchServices = [];
            $this->work?->flush();
        }
    }

    private function bookedMinutes(Collection $busy, int $dentistId, string $date, ?int $ignoreId): int
    {
        return (int) $busy
            ->filter(fn (Appointment $a) => $a->dentist_profile_id === $dentistId && $a->id !== $ignoreId
                && ClinicClock::local($a->starts_at)->toDateString() === $date)
            ->sum('duration_minutes');
    }

    /** True when the branch takes appointments on this clinic date (its opening days; NULL = every day). */
    public static function openOn(Branch $branch, string $date): bool
    {
        return $branch->hoursOnDate($date) !== null;
    }

    public static function haversineKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return 2 * 6371 * asin(min(1, sqrt($a)));
    }

    /** timestamptz query binding with an explicit offset (the query grammar would otherwise drop it). */
    public static function ts(CarbonImmutable $instant): string
    {
        return $instant->format('Y-m-d H:i:sP');
    }
}

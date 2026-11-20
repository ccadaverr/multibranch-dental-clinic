<?php

namespace App\Http\Controllers;

use App\Models\Appointment;
use App\Models\Branch;
use App\Models\UserBranchScope;
use App\Services\Automations\AutomationCatalog;
use App\Services\Closures\ClosureCalendar;
use App\Services\Scheduling\WorkSchedules;
use App\Support\ClinicClock;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * F6 calendar load (R2-02: the clinic likes a calendar that shows in advance which days are crowded). For each day of a range
 * and branch: booked minutes (appointments not cancelled and not no-show) against available minutes (each available Dentist
 * assigned to the branch: their M3 work schedule inside that day's branch hours, minus breaks and approved M15 leave), as a
 * percentage, plus closed days with the reason. A day above the Owner's threshold is "crowded". Staff see their branches; the
 * Owner one branch or all of them. A Dentist with a weekly schedule is counted with their real hours at each branch (schedules
 * never overlap). A Dentist with no weekly schedule yet uses their profile hours, counted once a day (their longest window),
 * and only then is capacity marked as estimated.
 */
class CalendarLoadController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $started = hrtime(true);
        $data = $request->validate(['branch_ref' => ['nullable', 'string', 'max:50'], 'from' => ['required', 'date_format:Y-m-d'], 'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from']]);
        $from = CarbonImmutable::createFromFormat('!Y-m-d', $data['from'], ClinicClock::TIMEZONE);
        $to = CarbonImmutable::createFromFormat('!Y-m-d', $data['to'], ClinicClock::TIMEZONE);
        if ($from->diffInDays($to) > 42) throw ValidationException::withMessages(['to' => ['Choose at most six weeks.']]);
        $user = $request->user();
        $branches = Branch::query()->where('status', 'Open')->whereNull('archived_at')->orderBy('id')
            ->when(! empty($data['branch_ref']), fn ($q) => $q->where('legacy_ref', $data['branch_ref']))
            ->when($user->role->value === 'staff', fn ($q) => $q->whereIn('id', UserBranchScope::select('branch_id')->where('user_id', $user->id)))
            ->with(['dentistBranches.dentistProfile'])->get();
        abort_if($branches->isEmpty(), 403, 'Forbidden.');
        // A range is at most six weeks. Avoid downloading a year of clinic closures
        // when rendering this month; Branch::hoursOnDate() remains the authority.
        app(ClosureCalendar::class)->primeRange($branches->pluck('id')->all(), $from->toDateString(), $to->toDateString());
        $threshold = (int) (AutomationCatalog::setting('calendar_load')?->settings['crowded_percent'] ?? 80);
        $booked = Appointment::whereIn('branch_id', $branches->pluck('id'))->whereNotIn('status', ['Cancelled', 'No-show'])
            ->where('starts_at', '>=', $from->toIso8601String())->where('starts_at', '<', $to->addDay()->toIso8601String())
            ->get(['branch_id', 'starts_at', 'duration_minutes'])
            ->groupBy(fn ($a) => $a->branch_id.':'.ClinicClock::local($a->starts_at)->toDateString());

        // A month contains up to 42 dates. Without preloading, each dentist/day
        // individually queries schedule exceptions and leave over the remote DB.
        // Prime the exact authorized dentist/date pool once for this read-only report.
        $dentistPool = $branches->flatMap(fn (Branch $b) => $b->dentistBranches->pluck('dentistProfile'))
            ->filter()->unique('id')->values();
        $this->work = new WorkSchedules();
        $this->work->preloadCalendar($dentistPool, $from->toDateString(), $to->toDateString());

        $days = [];
        for ($day = $from; $day->lessThanOrEqualTo($to); $day = $day->addDay()) {
            $date = $day->toDateString();
            $row = ['date' => $date, 'branches' => []];
            $sumBooked = $count = 0;
            $allClosed = true;
            $perDentist = []; // dentist id => minutes, counted once per day across branches (the longest window)
            foreach ($branches as $branch) {
                $hours = $branch->hoursOnDate($date);
                $closure = $branch->closureOn($date);
                $list = $booked->get($branch->id.':'.$date, collect());
                $minutesByDentist = $hours ? $this->capacity($branch, $date) : [];
                foreach ($minutesByDentist as $id => $m) $perDentist[$id] = isset($this->profileHours[$id]) ? max($perDentist[$id] ?? 0, $m) : ($perDentist[$id] ?? 0) + $m;
                $capacity = array_sum($minutesByDentist);
                $minutes = (int) $list->sum('duration_minutes');
                $allClosed = $allClosed && $hours === null;
                $sumBooked += $minutes; $count += $list->count();
                $row['branches'][] = ['id' => $branch->legacy_ref, 'name' => $branch->name, 'closed' => $hours === null, 'reason' => $hours === null ? ($closure?->reason ?? ($closure ? 'Closed' : 'Closed this weekday')) : null,
                    'partial_hours' => $closure?->partialHours(), 'appointments' => $list->count(), 'booked_minutes' => $minutes, 'capacity_minutes' => $capacity,
                    'percent' => $capacity > 0 ? (int) round(100 * $minutes / $capacity) : null];
            }
            $sumCapacity = array_sum($perDentist);
            $percent = $sumCapacity > 0 ? (int) round(100 * $sumBooked / $sumCapacity) : null;
            $days[] = $row + ['closed' => $allClosed, 'appointments' => $count, 'booked_minutes' => $sumBooked, 'capacity_minutes' => $sumCapacity,
                'percent' => $percent, 'crowded' => $percent !== null && $percent >= $threshold];
        }

        $estimated = $this->profileHours !== [];

        return response()->json(['data' => ['days' => $days, 'crowded_percent' => $threshold, 'capacity_estimated' => $estimated,
            'capacity_note' => $estimated ? 'Capacity is estimated for '.count($this->profileHours).' dentist(s) without a weekly work schedule yet (their profile hours are used).' : null, 'branches' => $branches->map(fn ($b) => ['id' => $b->legacy_ref, 'name' => $b->name])->values()]])
            ->header('Cache-Control', 'private, no-store')
            ->header('Server-Timing', 'app;dur='.round((hrtime(true) - $started) / 1_000_000, 1));
    }

    /** @var array<int,true> dentists counted with their profile hours (no weekly schedule yet) */
    private array $profileHours = [];

    private ?WorkSchedules $work = null;

    /** @return array<int,int> dentist id => minutes they can see patients there that day (M3 schedule ∩ branch hours − leave) */
    private function capacity(Branch $branch, string $date): array
    {
        $this->work ??= new WorkSchedules;
        $out = [];
        foreach ($branch->dentistBranches as $link) {
            $d = $link->dentistProfile;
            if (! $d?->available) continue;
            if ($this->work->usesProfileHours($d)) $this->profileHours[$d->id] = true;
            $out[$d->id] = $this->work->minutes($d, $branch, $date);
        }

        return $out;
    }
}

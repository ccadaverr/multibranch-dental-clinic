<?php

namespace App\Http\Controllers;

use App\Models\Appointment;
use App\Models\Branch;
use App\Models\DentistProfile;
use App\Models\DentistSchedule;
use App\Models\DentistScheduleException;
use App\Models\User;
use App\Models\UserBranchScope;
use App\Services\Audit\AuditService;
use App\Services\Automations\AutomationCatalog;
use App\Services\Automations\MessageTemplates;
use App\Services\Scheduling\ScheduleNotices;
use App\Services\Scheduling\WorkSchedules;
use App\Support\ClinicClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * M3 Work Schedules. Each dentist's weekly hours per branch and weekday (with an optional break) and dated exceptions (a day off,
 * or custom hours at one branch). Hours must fall inside the branch's opening hours for that day. The Owner edits every branch;
 * the front desk edits the dentists of their own branches when the Owner allows it (Automations → Work schedules and leave);
 * a dentist sees their own schedule. Every change is audited with the old and new hours (no patient data). A change never
 * cancels anything: the appointments it leaves without their dentist are listed, with suggested cover and one action to email
 * those patients a reschedule link.
 */
class WorkScheduleController extends Controller
{
    private const WEEKDAYS = [1 => 'Monday', 2 => 'Tuesday', 3 => 'Wednesday', 4 => 'Thursday', 5 => 'Friday', 6 => 'Saturday', 7 => 'Sunday'];

    private const AFFECTED_DAYS = 90;

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $visibleBranchIds = $user->role->value === 'staff'
            ? UserBranchScope::where('user_id', $user->id)->pluck('branch_id')->all()
            : null;
        $dentistQuery = DentistProfile::with(['person', 'branches']);
        if ($visibleBranchIds !== null) {
            $dentistQuery->whereHas('branches', fn ($q) => $q->whereIn('branches.id', $visibleBranchIds));
        } elseif ($user->role->value === 'dentist') {
            $dentistQuery->where('person_id', $user->person_id);
        } elseif ($user->role->value !== 'owner') {
            $dentistQuery->whereRaw('1 = 0');
        }
        $dentists = $dentistQuery->orderBy('id')->get();
        $work = new WorkSchedules;
        $weekly = DentistSchedule::whereIn('dentist_profile_id', $dentists->pluck('id'))->where('status', 'active')
            ->when($visibleBranchIds !== null, fn ($q) => $q->whereIn('branch_id', $visibleBranchIds))
            ->with('branch')->orderBy('weekday')->orderBy('start_time')->get()->groupBy('dentist_profile_id');
        $exceptions = DentistScheduleException::whereIn('dentist_profile_id', $dentists->pluck('id'))->where('status', 'active')->where('on_date', '>=', ClinicClock::today())
            // Unassigned day-off exceptions affect every branch; keep their existing projection pending privacy policy.
            ->when($visibleBranchIds !== null, fn ($q) => $q->where(fn ($scope) => $scope->whereIn('branch_id', $visibleBranchIds)->orWhereNull('branch_id')))
            ->with(['branch', 'dentist.person'])->orderBy('on_date')->get();
        $editable = $this->editableBranchIds($user);
        $branches = Branch::where('status', 'Open')->orderBy('id')->get();
        $staffProfiles = \App\Models\StaffProfile::with(['person', 'branch'])
            ->when($user->role->value === 'staff', fn ($q) => $q->whereIn('branch_id', UserBranchScope::select('branch_id')->where('user_id', $user->id)))
            ->orderBy('id')->get();

        $now = ClinicClock::now();
        $todayDate = $now->toDateString();
        // Staff Operations reads only this branch-scoped projection. WorkSchedules is also the booking authority;
        // no schedule, closure, break, or leave decision is copied into the browser.
        $duty = $dentists->flatMap(function (DentistProfile $d) use ($todayDate, $visibleBranchIds, $work) {
            return $d->branches->filter(fn (Branch $b) => $visibleBranchIds === null || in_array($b->id, $visibleBranchIds, true))
                ->map(function (Branch $b) use ($d, $todayDate, $work) {
                    $minutes = $d->available && $b->status === 'Open' ? $work->minutes($d, $b, $todayDate) : 0;

                    return [
                        'dentist_id' => $d->legacy_ref,
                        'dentist_name' => $this->name($d),
                        'branch_id' => $b->legacy_ref,
                        'branch_name' => $b->name,
                        'on_duty_today' => $minutes > 0,
                        'working_now' => $minutes > 0 && $work->workingNow($d, $b),
                        'working_minutes' => $minutes,
                        'estimated' => $work->usesProfileHours($d),
                    ];
                });
        })->values();
        $dutyByDentist = $duty->groupBy('dentist_id');

        return response()->json(['data' => [
            'dentists' => $dentists->map(function (DentistProfile $d) use ($dutyByDentist, $weekly, $work, $editable, $visibleBranchIds) {
                return [
                    'id' => $d->legacy_ref,
                    'name' => $this->name($d),
                    'available' => (bool) $d->available,
                    'on_duty_today' => ($dutyByDentist->get($d->legacy_ref) ?? collect())->contains('on_duty_today', true),
                    'profile_hours' => $work->usesProfileHours($d) ? ['start' => substr((string) $d->shift_start, 0, 5), 'end' => substr((string) $d->shift_end, 0, 5)] : null,
                    'branches' => $d->branches->filter(fn (Branch $b) => $visibleBranchIds === null || in_array($b->id, $visibleBranchIds, true))
                        ->map(fn (Branch $b) => ['id' => $b->legacy_ref, 'name' => $b->name, 'editable' => in_array($b->id, $editable, true)])->values(),
                    'weekly' => ($weekly[$d->id] ?? collect())->map(fn (DentistSchedule $s) => $this->rowView($s))->values(),
                    'demo' => ($weekly[$d->id] ?? collect())->contains('demo', true),
                ];
            })->values(),
            'duty' => ['date' => $todayDate, 'as_of' => $now->toIso8601String(), 'rows' => $duty],
            'staff' => $staffProfiles->map(fn (\App\Models\StaffProfile $s) => [
                'id' => $s->legacy_ref,
                'name' => $s->person ? $s->person->fullName() : $s->legacy_ref,
                'title' => $s->title,
                'branch' => $s->branch ? ['id' => $s->branch->legacy_ref, 'name' => $s->branch->name] : null,
                'shift_start' => $s->shift_start ? substr((string) $s->shift_start, 0, 5) : '09:00',
                'shift_end' => $s->shift_end ? substr((string) $s->shift_end, 0, 5) : '18:00',
                'available' => (bool) $s->available,
            ])->values(),
            'exceptions' => $exceptions->map(fn (DentistScheduleException $e) => $this->exceptionView($e, $editable))->values(),
            'branches' => $branches->map(fn (Branch $b) => ['id' => $b->legacy_ref, 'name' => $b->name, 'hours' => collect(self::WEEKDAYS)->mapWithKeys(fn ($n, $i) => [$i => $b->hoursOnDay($i)])])->values(),
            'weekdays' => self::WEEKDAYS,
            'wording_approved' => MessageTemplates::approved(ScheduleNotices::TEMPLATE),
        ]]);
    }

    /** Set (or remove) one weekly row: a dentist's hours at a branch on a weekday. */
    public function weekly(Request $request, DentistProfile $dentistProfile): JsonResponse
    {
        $data = $request->validate(['branch_ref' => ['required', 'string', 'max:50'], 'weekday' => ['required', 'integer', 'between:1,7'], 'remove' => ['sometimes', 'boolean'],
            'start_time' => ['exclude_if:remove,true', 'required', 'date_format:H:i'], 'end_time' => ['exclude_if:remove,true', 'required', 'date_format:H:i', 'after:start_time'],
            'break_start' => ['exclude_if:remove,true', 'nullable', 'date_format:H:i', 'required_with:break_end'], 'break_end' => ['exclude_if:remove,true', 'nullable', 'date_format:H:i', 'required_with:break_start', 'after:break_start']]);
        $branch = $this->editableBranch($request->user(), $data['branch_ref'], $dentistProfile);
        $weekday = (int) $data['weekday'];
        $day = self::WEEKDAYS[$weekday];

        $row = DB::transaction(function () use ($data, $dentistProfile, $branch, $weekday, $day, $request) {
            $current = DentistSchedule::where('dentist_profile_id', $dentistProfile->id)->where('branch_id', $branch->id)->where('weekday', $weekday)->where('status', 'active')->lockForUpdate()->first();
            $old = $current?->hours();
            if (! empty($data['remove'])) {
                if (! $current) throw ValidationException::withMessages(['weekday' => ["There are no hours on {$day} to remove."]]);
                $current->update(['status' => 'removed', 'updated_by_user_id' => $request->user()->id]);
                $this->audit($request->user(), 'work_schedule.removed', $branch, $dentistProfile, ['weekday' => $weekday, 'old' => $old, 'new' => null]);

                return null;
            }
            $hours = $branch->hoursOnDay($weekday);
            if (! $hours) throw ValidationException::withMessages(['weekday' => ["{$branch->name} is closed on {$day}s."]]);
            $start = $data['start_time']; $end = $data['end_time'];
            if ($start < $hours['open'] || $end > $hours['close']) {
                throw ValidationException::withMessages(['start_time' => ["The hours must fall inside {$branch->name}'s opening hours on {$day} (".self::t($hours['open']).'–'.self::t($hours['close']).').']]);
            }
            $bs = $data['break_start'] ?? null; $be = $data['break_end'] ?? null;
            if ($bs && ($bs <= $start || $be >= $end)) throw ValidationException::withMessages(['break_start' => ['The break must be inside the working hours.']]);
            $clash = DentistSchedule::where('dentist_profile_id', $dentistProfile->id)->where('weekday', $weekday)->where('status', 'active')->where('branch_id', '<>', $branch->id)
                ->where('start_time', '<', $end)->where('end_time', '>', $start)->with('branch')->first();
            if ($clash) throw ValidationException::withMessages(['start_time' => ["{$this->name($dentistProfile)} already works at {$clash->branch->name} on {$day} from ".self::t($clash->start_time).' to '.self::t($clash->end_time).'.']]);
            $values = ['start_time' => $start, 'end_time' => $end, 'break_start' => $bs, 'break_end' => $be, 'demo' => false, 'updated_by_user_id' => $request->user()->id];
            $row = $current ? tap($current)->update($values) : DentistSchedule::create($values + ['dentist_profile_id' => $dentistProfile->id, 'branch_id' => $branch->id, 'weekday' => $weekday]);
            $this->audit($request->user(), $current ? 'work_schedule.updated' : 'work_schedule.created', $branch, $dentistProfile, ['weekday' => $weekday, 'old' => $old, 'new' => $row->hours()]);

            return $row;
        });

        return response()->json(['data' => ['row' => $row ? $this->rowView($row->fresh('branch')) : null] + $this->affectedPayload($dentistProfile)]);
    }

    /** Copy the hours on the dentist's profile to every open day of one branch (a starting point; edit afterwards). */
    public function fromProfile(Request $request, DentistProfile $dentistProfile): JsonResponse
    {
        $data = $request->validate(['branch_ref' => ['required', 'string', 'max:50']]);
        $branch = $this->editableBranch($request->user(), $data['branch_ref'], $dentistProfile);
        if (! $dentistProfile->shift_start || ! $dentistProfile->shift_end) throw ValidationException::withMessages(['branch_ref' => ['This dentist has no hours on their profile to copy.']]);
        $created = 0;
        DB::transaction(function () use ($dentistProfile, $branch, $request, &$created) {
            foreach (self::WEEKDAYS as $weekday => $day) {
                $hours = $branch->hoursOnDay($weekday);
                if (! $hours) continue;
                $start = max(substr((string) $dentistProfile->shift_start, 0, 5), $hours['open']);
                $end = min(substr((string) $dentistProfile->shift_end, 0, 5), $hours['close']);
                if ($start >= $end) continue;
                $taken = DentistSchedule::where('dentist_profile_id', $dentistProfile->id)->where('weekday', $weekday)->where('status', 'active')->exists();
                if ($taken) continue;
                $row = DentistSchedule::create(['dentist_profile_id' => $dentistProfile->id, 'branch_id' => $branch->id, 'weekday' => $weekday, 'start_time' => $start, 'end_time' => $end, 'updated_by_user_id' => $request->user()->id]);
                $this->audit($request->user(), 'work_schedule.created', $branch, $dentistProfile, ['weekday' => $weekday, 'old' => null, 'new' => $row->hours(), 'from_profile' => true]);
                $created++;
            }
        });

        return response()->json(['data' => ['created' => $created] + $this->affectedPayload($dentistProfile)]);
    }

    /** A dated exception: a day off (every branch) or custom hours at one branch. */
    public function addException(Request $request, DentistProfile $dentistProfile): JsonResponse
    {
        $data = $request->validate(['date' => ['required', 'date_format:Y-m-d'], 'kind' => ['required', 'in:day_off,custom_hours'], 'reason' => ['nullable', 'string', 'max:120'],
            'branch_ref' => ['required_if:kind,custom_hours', 'nullable', 'string', 'max:50'],
            'start_time' => ['required_if:kind,custom_hours', 'nullable', 'date_format:H:i'], 'end_time' => ['required_if:kind,custom_hours', 'nullable', 'date_format:H:i', 'after:start_time']]);
        if ($data['date'] < ClinicClock::today()) throw ValidationException::withMessages(['date' => ['Choose today or a later date.']]);
        $user = $request->user();
        $branch = null;
        if ($data['kind'] === 'custom_hours') {
            $branch = $this->editableBranch($user, $data['branch_ref'], $dentistProfile);
            $hours = $branch->hoursOnDate($data['date']);
            if (! $hours) throw ValidationException::withMessages(['date' => ["{$branch->name} is closed that day."]]);
            if ($data['start_time'] < $hours['open'] || $data['end_time'] > $hours['close']) {
                throw ValidationException::withMessages(['start_time' => ["The hours must fall inside {$branch->name}'s opening hours that day (".self::t($hours['open']).'–'.self::t($hours['close']).').']]);
            }
        } elseif (! $this->canEditDentist($user, $dentistProfile)) {
            abort(403, 'You can change the schedules of the dentists at your branch only.');
        }
        $exception = DB::transaction(function () use ($data, $dentistProfile, $branch, $user) {
            $same = DentistScheduleException::where('dentist_profile_id', $dentistProfile->id)->where('on_date', $data['date'])->where('status', 'active')->lockForUpdate()->get();
            if ($same->contains('kind', 'day_off') || ($data['kind'] === 'day_off' && $same->isNotEmpty()) || $same->contains('branch_id', $branch?->id)) {
                throw ValidationException::withMessages(['date' => ['This dentist already has an exception that day. Remove it first.']]);
            }
            $e = DentistScheduleException::create(['dentist_profile_id' => $dentistProfile->id, 'branch_id' => $branch?->id, 'on_date' => $data['date'], 'kind' => $data['kind'],
                'start_time' => $branch ? $data['start_time'] : null, 'end_time' => $branch ? $data['end_time'] : null, 'reason' => $data['reason'] ?? null,
                'created_by_user_id' => $user->id, 'updated_by_user_id' => $user->id]);
            $this->audit($user, 'work_schedule.exception_added', $branch, $dentistProfile, ['date' => $data['date'], 'kind' => $data['kind'],
                'new' => $branch ? ['start' => $data['start_time'], 'end' => $data['end_time']] : null]);

            return $e;
        });

        return response()->json(['data' => ['exception' => $this->exceptionView($exception->fresh(['branch', 'dentist.person']), $this->editableBranchIds($user))] + $this->affectedPayload($dentistProfile)], 201);
    }

    public function changeException(Request $request, DentistScheduleException $dentistScheduleException): JsonResponse
    {
        $request->validate(['action' => ['required', 'in:remove']]);
        $e = $dentistScheduleException->load('dentist');
        $user = $request->user();
        abort_unless($e->branch_id ? in_array($e->branch_id, $this->editableBranchIds($user), true) : $this->canEditDentist($user, $e->dentist), 403, 'You can change the schedules of the dentists at your branch only.');
        if ($e->status !== 'active') throw ValidationException::withMessages(['action' => ['This exception was already removed.']]);
        $e->update(['status' => 'removed', 'updated_by_user_id' => $user->id]);
        $this->audit($user, 'work_schedule.exception_removed', $e->branch, $e->dentist, ['date' => $e->dateString(), 'kind' => $e->kind]);

        return response()->json(['data' => ['removed' => true] + $this->affectedPayload($e->dentist)]);
    }

    /** Upcoming appointments of this dentist that no longer fit their schedule or leave (never cancelled). */
    public function affected(Request $request, DentistProfile $dentistProfile): JsonResponse
    {
        abort_unless($this->canView($request->user(), $dentistProfile), 403);

        return response()->json(['data' => $this->affectedPayload($dentistProfile, $request->user())]);
    }

    /** One action: email the patients of this dentist's affected appointments a reschedule link (approved wording only). */
    public function notify(Request $request, DentistProfile $dentistProfile): JsonResponse
    {
        abort_unless($this->canEditDentist($request->user(), $dentistProfile) || $request->user()->role->value === 'staff' && $this->canView($request->user(), $dentistProfile), 403);
        $rows = $this->affectedFor($dentistProfile, $request->user());
        $counts = ScheduleNotices::notify($rows, $request->user());
        if ($counts === null) {
            return response()->json(['message' => 'The Owner must approve the “Dentist unavailable” email wording first (Administration → Automations).', 'code' => 'wording_not_approved'], 422);
        }
        app(AuditService::class)->recordAdministrative('work_schedule.patients_notified', $request->user(), null, ['dentist' => $dentistProfile->legacy_ref] + $counts);

        return response()->json(['data' => $counts]);
    }

    // ---- helpers ------------------------------------------------------------------------------------------------------

    private function affectedFor(DentistProfile $d, ?User $viewer = null): \Illuminate\Support\Collection
    {
        $rows = (new WorkSchedules)->affected($d, ClinicClock::today(), ClinicClock::addDays(ClinicClock::today(), self::AFFECTED_DAYS));
        if ($viewer?->role->value === 'staff') {
            $scope = UserBranchScope::where('user_id', $viewer->id)->pluck('branch_id')->all();
            $rows = $rows->filter(fn (Appointment $a) => in_array($a->branch_id, $scope, true))->values();
        }

        return $rows;
    }

    private function affectedPayload(DentistProfile $d, ?User $viewer = null): array
    {
        $viewer ??= request()->user();

        return ['affected' => $this->affectedFor($d, $viewer)->map(fn (Appointment $a) => ScheduleNotices::view($a))->values(),
            'wording_approved' => MessageTemplates::approved(ScheduleNotices::TEMPLATE)];
    }

    private function canView(User $user, DentistProfile $d): bool
    {
        return match ($user->role->value) {
            'owner' => true,
            'staff' => $d->branches()->whereIn('branches.id', UserBranchScope::select('branch_id')->where('user_id', $user->id))->exists(),
            'dentist' => $user->person_id === $d->person_id,
            default => false,
        };
    }

    /** @return int[] branch ids this user may edit schedules for */
    private function editableBranchIds(User $user): array
    {
        if ($user->role->value === 'owner') return Branch::pluck('id')->all();
        if ($user->role->value !== 'staff') return [];
        if (! (AutomationCatalog::setting('staffing')?->settings['front_desk_edits_schedules'] ?? true)) return [];

        return UserBranchScope::where('user_id', $user->id)->pluck('branch_id')->all();
    }

    /** A day off covers every branch: the front desk may set one only for a dentist who works at one of their branches. */
    private function canEditDentist(User $user, ?DentistProfile $d): bool
    {
        if (! $d) return false;
        $ids = $this->editableBranchIds($user);

        return $ids !== [] && $d->branches()->whereIn('branches.id', $ids)->exists();
    }

    private function editableBranch(User $user, string $ref, DentistProfile $d): Branch
    {
        $branch = Branch::where('legacy_ref', $ref)->firstOrFail();
        abort_unless(in_array($branch->id, $this->editableBranchIds($user), true), 403, 'You can change the schedules of the dentists at your branch only.');
        if (! $d->branches()->where('branches.id', $branch->id)->exists()) throw ValidationException::withMessages(['branch_ref' => ["{$this->name($d)} is not assigned to {$branch->name}."]]);

        return $branch;
    }

    /** Old and new hours only: no patient data in schedule audit entries. */
    private function audit(User $actor, string $action, ?Branch $branch, DentistProfile $d, array $payload): void
    {
        app(AuditService::class)->recordAdministrative($action, $actor, $branch, ['dentist' => $d->legacy_ref] + $payload);
    }

    private function rowView(DentistSchedule $s): array
    {
        return ['id' => $s->public_id, 'branch' => ['id' => $s->branch?->legacy_ref, 'name' => $s->branch?->name], 'weekday' => $s->weekday] + $s->hours() + ['demo' => $s->demo];
    }

    private function exceptionView(DentistScheduleException $e, array $editable): array
    {
        return ['id' => $e->public_id, 'dentist' => ['id' => $e->dentist?->legacy_ref, 'name' => $e->dentist ? $this->name($e->dentist) : null], 'date' => $e->dateString(), 'kind' => $e->kind,
            'branch' => $e->branch ? ['id' => $e->branch->legacy_ref, 'name' => $e->branch->name] : null, 'start' => $e->start_time ? self::t($e->start_time) : null,
            'end' => $e->end_time ? self::t($e->end_time) : null, 'reason' => $e->reason,
            'editable' => $e->branch_id ? in_array($e->branch_id, $editable, true) : ($e->dentist ? $e->dentist->branches()->whereIn('branches.id', $editable)->exists() : false)];
    }

    private function name(DentistProfile $d): string
    {
        return 'Dr. '.trim(($d->person?->first_name ?? '').' '.($d->person?->last_name ?? ''));
    }

    private static function t($time): string
    {
        return \Carbon\CarbonImmutable::createFromFormat('H:i', substr((string) $time, 0, 5))->format('g:i A');
    }
}

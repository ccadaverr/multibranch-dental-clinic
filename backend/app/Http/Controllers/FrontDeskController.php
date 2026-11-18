<?php

namespace App\Http\Controllers;

use App\Models\Appointment;
use App\Models\AppointmentResponse;
use App\Models\AutomationDelivery;
use App\Models\NoShowFlag;
use App\Models\Patient;
use App\Models\SlotOpening;
use App\Models\User;
use App\Models\UserBranchScope;
use App\Services\Appointments\AppointmentService;
use App\Services\Automations\AttendancePolicy;
use App\Services\Automations\FillFreedSlots;
use App\Services\Automations\NoShowDetection;
use App\Support\ClinicClock;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * The Check-In page's "today" panel (F2–F4), for Staff in their branches and the Owner everywhere:
 *   late          booked, not checked in, past the late limit (R2-07), with "Are you on your way?" sent and the patient's reply;
 *   replies       "I'll be there" / "On my way" / "I can't make it" answers for today's visits;
 *   released      appointments released after the release limit today, with a same-day Undo;
 *   free_times    today's freed times not taken yet (for walk-ins), and whether move-up offers are out;
 *   confirmations online bookings waiting for front-desk confirmation (cancellation policy) and the patients' counts.
 * Names are shown here because this is the front desk's own work list (as on the existing Check-In page).
 */
class FrontDeskController extends Controller
{
    public function today(Request $request): JsonResponse
    {
        $user = $request->user();
        $scope = fn (Builder $q, string $column = 'branch_id') => $user->role->value === 'staff'
            ? $q->whereIn($column, UserBranchScope::select('branch_id')->where('user_id', $user->id)) : $q;
        $now = ClinicClock::now();
        $dayStart = ClinicClock::local($now)->startOfDay();
        $settings = NoShowDetection::settings();
        $relations = ['patient.person', 'branch', 'service', 'dentist.person'];

        $todays = $scope(Appointment::query())->whereIn('status', ['Pending', 'Confirmed'])->whereDoesntHave('visit')
            ->where('starts_at', '>=', $dayStart->toIso8601String())->where('starts_at', '<', $dayStart->addDay()->toIso8601String())->with($relations)->orderBy('starts_at')->get();
        $responses = AppointmentResponse::whereIn('appointment_id', $todays->pluck('id'))->orderBy('created_at')->get()->groupBy('appointment_id');
        $reply = fn (Appointment $a) => $responses->get($a->id)?->where('appointment_revision', $a->revision)->last()?->response;
        $late = $settings === null ? collect() : $todays->filter(fn (Appointment $a) => $a->starts_at->addMinutes((int) $settings['late_minutes'])->lessThanOrEqualTo($now));

        $released = $scope(NoShowFlag::query())->where('status', 'released')->where('flagged_at', '>=', $dayStart->toIso8601String())
            ->whereHas('appointment', fn ($q) => $q->where('status', 'No-show'))->with(array_map(fn ($r) => "appointment.$r", $relations))->orderBy('flagged_at')->get();

        $free = $scope(SlotOpening::query())->where('status', 'open')->where('clinic_date', ClinicClock::today())->where('ends_at', '>', $now->toIso8601String())
            ->withCount(['offers as offers_out' => fn ($q) => $q->where('status', 'offered')])->with(['dentist.person', 'branch'])->orderBy('starts_at')->get();

        $pending = $scope(Appointment::query())->where('status', 'Pending')->where('starts_at', '>=', $dayStart->toIso8601String())->with($relations)->orderBy('starts_at')->limit(50)->get();

        return response()->json(['data' => [
            'settings' => $settings ? ['late_minutes' => $settings['late_minutes'], 'release_minutes' => $settings['release_minutes'], 'release_mode' => $settings['release_mode']] : null,
            'late' => $late->map(fn (Appointment $a) => $this->row($a) + ['minutes_late' => (int) $a->starts_at->diffInMinutes($now, true), 'reply' => $reply($a),
                'asked' => AutomationDelivery::where('dedupe_key', NoShowDetection::lateKey($a))->orWhere('dedupe_key', 'like', 'skip:%:'.NoShowDetection::lateKey($a))->exists()])->values(),
            'replies' => $todays->filter(fn (Appointment $a) => $reply($a) !== null)->map(fn (Appointment $a) => $this->row($a) + ['reply' => $reply($a)])->values(),
            'released' => $released->map(fn (NoShowFlag $f) => $this->row($f->appointment) + ['released_at' => ClinicClock::local($f->flagged_at)->format('g:i A')])->values(),
            'free_times' => $free->map(fn (SlotOpening $o) => ['id' => $o->public_id, 'branch' => $o->branch?->name, 'dentist' => $o->dentist?->person?->fullName(),
                'from' => ClinicClock::local($o->starts_at)->format('g:i A'), 'to' => ClinicClock::local($o->ends_at)->format('g:i A'), 'minutes' => $o->minutes(),
                'stage' => $o->offers_out > 0 && ($o->waitlist_at === null || $o->waitlist_at->greaterThan($now)) ? 'offered' : 'walk_in', 'offers_out' => $o->offers_out])->values(),
            'confirmations' => $pending->map(fn (Appointment $a) => $this->row($a) + ['date' => ClinicClock::local($a->starts_at)->format('D, M j'),
                'strikes' => AttendancePolicy::strikes($a->patient), 'patient_id' => $a->patient?->public_id])->values(),
        ]]);
    }

    public function undoNoShow(Request $request, Appointment $appointment): JsonResponse
    {
        Gate::authorize('transition', [$appointment, 'no-show']);
        $data = $request->validate(['expected_revision' => ['required', 'integer']]);
        $response = app(AppointmentService::class)->undoNoShow($request->user(), $appointment, (int) $data['expected_revision']);
        app(\App\Services\Audit\AuditService::class)->recordAdministrative('appointment.no_show_undone', $request->user(), $appointment, []);

        return $response;
    }

    public function walkIn(Request $request, SlotOpening $slotOpening): JsonResponse
    {
        $this->assertBranch($request->user(), $slotOpening->branch_id);
        $opening = FillFreedSlots::usedForWalkIn($slotOpening, $request->user());

        return response()->json(['data' => ['id' => $opening->public_id, 'status' => $opening->status, 'filled_via' => $opening->filled_via]]);
    }

    public function clearAttendance(Request $request, Patient $patient): JsonResponse
    {
        Gate::authorize('update', $patient);
        $data = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:300']]);
        AttendancePolicy::clear($patient, $request->user(), trim($data['reason']));

        return response()->json(['data' => ['patient_id' => $patient->public_id, 'confirmation_required' => false]]);
    }

    private function row(?Appointment $a): array
    {
        if (! $a) return [];
        $p = $a->patient?->person;

        return ['appointment_id' => $a->public_id, 'code' => $a->appointment_code, 'revision' => $a->revision, 'status' => $a->status,
            'time' => ClinicClock::local($a->starts_at)->format('g:i A'), 'patient' => $p ? trim($p->first_name.' '.$p->last_name) : null,
            'branch' => $a->branch?->name, 'service' => $a->service?->name, 'dentist' => $a->dentist?->person?->fullName()];
    }

    private function assertBranch(User $user, int $branchId): void
    {
        abort_if($user->role->value === 'staff' && ! UserBranchScope::where('user_id', $user->id)->where('branch_id', $branchId)->exists(), 403, 'Forbidden.');
    }
}

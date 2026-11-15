<?php

namespace App\Http\Controllers;

use App\Models\Appointment;
use App\Models\DentistProfile;
use App\Models\LeaveRequest;
use App\Models\StaffProfile;
use App\Models\User;
use App\Models\UserBranchScope;
use App\Services\Audit\AuditService;
use App\Services\Automations\AutomationCatalog;
use App\Services\Automations\MessageTemplates;
use App\Services\Mail\MailOutbox;
use App\Services\Notifications\NotificationCenter;
use App\Services\Scheduling\ScheduleNotices;
use App\Services\Scheduling\SchedulingService;
use App\Services\Scheduling\LeaveCommands;
use App\Support\ClinicClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * M15 Leave Management. A dentist or staff member asks for leave (vacation, sick, other; full or partial days; an optional private
 * note). The approver (the Owner, or also the front desk of the requester's branch when the Owner allows it) approves or declines;
 * the requester may cancel. Both sides get an in-app notice and an email in the Owner-approved wording (never the note or the
 * type). Approved dentist leave blocks that dentist's booking time through M3; approving shows the appointments it leaves without
 * their dentist first, with suggested cover and one action to email those patients a reschedule link, and never cancels anything.
 * Cancelling approved leave frees the time again. The private note is shown only to the requester and the approvers. No balances.
 */
class LeaveController extends Controller
{
    /** The requester's own requests. */
    public function mine(Request $request): JsonResponse
    {
        $user = $request->user();
        [$dentist, $staff] = $this->profiles($user);
        abort_unless($dentist || $staff, 403, 'Only dentists and staff members request leave.');
        $rows = LeaveRequest::where('requester_user_id', $user->id)->with(['requester.person', 'decider.person', 'dentist.person'])->orderByDesc('starts_at')->limit(100)->get();

        return response()->json(['data' => $rows->map(fn (LeaveRequest $l) => $this->view($l, $user))->values(), 'meta' => ['types' => LeaveRequest::TYPES, 'commands_available'=>LeaveCommands::available()]]);
    }

    public function show(Request $request, LeaveRequest $leaveRequest): JsonResponse
    {
        $user=$request->user();
        abort_unless($leaveRequest->requester_user_id===$user->id || $this->canDecide($user,$leaveRequest),403);
        return response()->json(['data'=>$this->view($leaveRequest->load(['requester.person','decider.person','dentist.person']),$user),'meta'=>['commands_available'=>LeaveCommands::available()]]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        [$dentist, $staff] = $this->profiles($user);
        abort_unless($dentist || $staff, 403, 'Only dentists and staff members request leave.');
        $data = $request->validate(['type' => ['required', 'in:vacation,sick,other'], 'start_date' => ['required', 'date_format:Y-m-d'], 'end_date' => ['required', 'date_format:Y-m-d', 'after_or_equal:start_date'],
            'start_time' => ['nullable', 'date_format:H:i', 'required_with:end_time'], 'end_time' => ['nullable', 'date_format:H:i', 'required_with:start_time'],
            'private_note' => ['nullable', 'required_if:type,other', 'string', 'max:500']]);
        $command=LeaveCommands::input($request,true);
        $data=array_replace(['private_note'=>null,'start_time'=>null,'end_time'=>null],$data);
        if (ClinicClock::addDays($data['start_date'], 366) < $data['end_date']) throw ValidationException::withMessages(['end_date' => ['Choose at most one year.']]);
        // Partial: single-day leave from start_time to end_time on start_date. Full days: midnight to midnight (Asia/Manila).
        $partial = ! empty($data['start_time']);
        if ($partial && $data['end_date'] !== $data['start_date']) {
            throw ValidationException::withMessages(['end_date' => ['Partial-day leave must be on a single date.']]);
        }
        $starts = ClinicClock::at($data['start_date'], $partial ? $data['start_time'] : '00:00');
        $ends = $partial ? ClinicClock::at($data['end_date'], $data['end_time']) : ClinicClock::at($data['end_date'], '00:00')->addDay();
        if ($ends->lessThanOrEqualTo($starts)) throw ValidationException::withMessages(['end_time' => ['The end must be after the start.']]);

        return DB::transaction(function () use ($user, $data, $starts, $ends, $command) {
            $user = $this->lockedActor($user);
            [$dentist, $staff] = $this->profiles($user);
            abort_unless($dentist || $staff, 403, 'Only dentists and staff members request leave.');
            $fingerprint=LeaveCommands::fingerprint('create',null,$data+$command);
            if ($prior=LeaveCommands::replay($user,$command['operation_id'],$fingerprint)) return $prior;
            if ($data['start_date'] < ClinicClock::today()) throw ValidationException::withMessages(['start_date' => ['Choose today or a later date.']]);
            $overlap = LeaveRequest::where('requester_user_id', $user->id)->whereIn('status', ['Pending', 'Approved'])
                ->where('starts_at', '<', SchedulingService::ts($ends))->where('ends_at', '>', SchedulingService::ts($starts))->exists();
            if ($overlap) throw ValidationException::withMessages(['start_date' => ['You already have leave requested or approved in this period.']]);

            $leave = LeaveRequest::create(['requester_user_id' => $user->id, 'dentist_profile_id' => $dentist?->id, 'staff_profile_id' => $staff?->id, 'type' => $data['type'],
                'starts_at' => $starts, 'ends_at' => $ends, 'private_note' => $data['private_note'] ?? null, 'status' => 'Pending', 'revision'=>1]);
            $audit=$this->audit($user, 'leave.requested', $leave, ['operation_id'=>$command['operation_id']]);
            foreach ($this->approvers($leave) as $approver) $this->tell($approver, $leave, 'leave_requested', 'Leave request', ($user->person?->fullName() ?? 'A team member').' asked for leave: '.$this->range($leave).'.', 'leave', $user);
            return LeaveCommands::save($user,$leave,'create',$command,$fingerprint,$this->view($leave->fresh(['requester.person','dentist.person']),$user),$audit,201);
        });
    }

    /** Approvers: requests they may decide, with filters (status, branch, from/to). */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['status' => ['nullable', 'in:Pending,Approved,Declined,Cancelled'], 'branch_ref' => ['nullable', 'string', 'max:50'],
            'from' => ['nullable', 'date_format:Y-m-d'], 'to' => ['nullable', 'date_format:Y-m-d']]);
        abort_unless($this->isApproverRole($user), 403, 'Only the leave approvers see this list.');
        if(!empty($data['from'])&&!empty($data['to'])&&$data['from']>$data['to']) throw ValidationException::withMessages(['to'=>['The end date must not be before the start date.']]);
        $q = LeaveRequest::with(['requester.person', 'decider.person', 'dentist.person', 'dentist.branches', 'staffProfile.branch'])->orderBy('starts_at')
            ->when($data['status'] ?? null, fn ($q, $s) => $q->where('status', $s))
            ->when($data['from'] ?? null, fn ($q, $d) => $q->where('ends_at', '>', SchedulingService::ts(ClinicClock::at($d, '00:00'))))
            ->when($data['to'] ?? null, fn ($q, $d) => $q->where('starts_at', '<', SchedulingService::ts(ClinicClock::at($d, '00:00')->addDay())));
        // Scope BEFORE bounding rows: another branch's early requests cannot crowd this actor's work out.
        $q->where('requester_user_id','!=',$user->id);
        if($user->role->value==='staff') $this->scopeBranches($q,UserBranchScope::where('user_id',$user->id)->pluck('branch_id')->all());
        if(!empty($data['branch_ref'])){
            $branchId=\App\Models\Branch::where('legacy_ref',$data['branch_ref'])->value('id');
            if(!$branchId)throw ValidationException::withMessages(['branch_ref'=>['Choose an existing branch.']]);
            $this->scopeBranches($q,[$branchId]);
        }
        $page=$q->orderBy('id')->limit(301)->get();
        $rows=$page->take(300)->filter(fn(LeaveRequest $l)=>$this->canDecide($user,$l))->values();

        return response()->json(['data' => $rows->map(fn (LeaveRequest $l) => $this->view($l, $user))->values(), 'meta' => ['types' => LeaveRequest::TYPES,
            'approver' => AutomationCatalog::setting('staffing')?->settings['leave_approver'] ?? 'owner', 'wording_approved' => MessageTemplates::approved(ScheduleNotices::TEMPLATE), 'commands_available'=>LeaveCommands::available(), 'has_more'=>$page->count()>300, 'limit'=>300]]);
    }

    /** Team calendar strip: who is away (approved) or asked to be (pending) in a date range. Names and dates only. */
    public function calendar(Request $request): JsonResponse
    {
        $data = $request->validate(['from' => ['required', 'date_format:Y-m-d'], 'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from']]);
        $user = $request->user();
        abort_unless(in_array($user->role->value, ['owner', 'staff', 'dentist'], true), 403);
        $rows = LeaveRequest::whereIn('status', ['Pending', 'Approved'])->with(['requester.person', 'dentist.branches', 'staffProfile.branch'])
            ->where('starts_at', '<', SchedulingService::ts(ClinicClock::at($data['to'], '00:00')->addDay()))->where('ends_at', '>', SchedulingService::ts(ClinicClock::at($data['from'], '00:00')))
            ->orderBy('starts_at')->get()->filter(fn (LeaveRequest $l) => $this->sharesBranch($user, $l))->values();

        return response()->json(['data' => $rows->map(fn (LeaveRequest $l) => ['id' => $l->public_id, 'name' => $l->requester?->person?->fullName(), 'role' => $l->dentist_profile_id ? 'Dentist' : 'Staff',
            'status' => $l->status, 'starts_at' => ClinicClock::local($l->starts_at)->toIso8601String(), 'ends_at' => ClinicClock::local($l->ends_at)->toIso8601String(), 'label' => $this->range($l)])->values()]);
    }

    /** Appointments this leave leaves (or would leave) without their dentist, with suggested cover. */
    public function conflicts(Request $request, LeaveRequest $leaveRequest): JsonResponse
    {
        $user = $request->user();
        abort_unless($this->canDecide($user, $leaveRequest) || $leaveRequest->requester_user_id === $user->id, 403);

        return response()->json(['data' => ['appointments' => $this->conflicting($leaveRequest, $user)->map(fn (Appointment $a) => ScheduleNotices::view($a))->values(),
            'wording_approved' => MessageTemplates::approved(ScheduleNotices::TEMPLATE)]]);
    }

    public function decide(Request $request, LeaveRequest $leaveRequest): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['decision' => ['required', 'in:approve,decline']]);
        abort_unless($this->canDecide($user, $leaveRequest), 403, 'You cannot decide this request.');
        $command=LeaveCommands::input($request);
        $to = $data['decision'] === 'approve' ? 'Approved' : 'Declined';
        return DB::transaction(function () use ($leaveRequest, $user, $to, $data, $command) {
            $user = $this->lockedActor($user);
            $current = LeaveRequest::whereKey($leaveRequest->id)->lockForUpdate()->first();
            abort_unless($current && $this->canDecide($user, $current), 403, 'You cannot decide this request.');
            $fingerprint=LeaveCommands::fingerprint($data['decision'],$current->public_id,$data+$command);
            if ($prior=LeaveCommands::replay($user,$command['operation_id'],$fingerprint)) return $prior;
            if ($current->revision !== (int)$command['expected_revision']) return LeaveCommands::conflict('leave_revision_conflict','This leave changed. Your decision was not applied. Reload and review before deciding again.');
            if ($current->status !== 'Pending') throw ValidationException::withMessages(['decision' => ["This request is already {$current->status}. Reload the list."]]);
            $current->update(['status' => $to, 'decided_by_user_id' => $user->id, 'decided_at' => now(), 'revision'=>$current->revision+1]);
            $audit=$this->audit($user, $to === 'Approved' ? 'leave.approved' : 'leave.declined', $current, ['operation_id'=>$command['operation_id']]);
            $leave=$current->fresh(['requester.person','decider.person','dentist.person']);
            $this->tell($leave->requester, $leave, 'leave_decided', 'Leave '.strtolower($to), 'Your leave '.$this->range($leave).' was '.strtolower($to).'.', 'leave', $user);
            $receipt=$this->view($leave,$user)+['appointments'=>$to==='Approved'?$this->conflicting($leave,$user)->map(fn(Appointment $a)=>ScheduleNotices::view($a))->values()->all():[]];
            return LeaveCommands::save($user,$leave,$data['decision'],$command,$fingerprint,$receipt,$audit);
        });
    }

    /** The requester (or an approver) cancels a pending or approved request; approved leave frees the dentist's time again. */
    public function cancel(Request $request, LeaveRequest $leaveRequest): JsonResponse
    {
        $user = $request->user();
        abort_unless($leaveRequest->requester_user_id === $user->id || $this->canDecide($user, $leaveRequest), 403);
        $command=LeaveCommands::input($request);
        return DB::transaction(function () use ($leaveRequest, $user, $command) {
            $user = $this->lockedActor($user);
            $current = LeaveRequest::whereKey($leaveRequest->id)->lockForUpdate()->first();
            abort_unless($current && ($current->requester_user_id === $user->id || $this->canDecide($user, $current)), 403);
            $fingerprint=LeaveCommands::fingerprint('cancel',$current->public_id,$command);
            if ($prior=LeaveCommands::replay($user,$command['operation_id'],$fingerprint)) return $prior;
            if ($current->revision !== (int)$command['expected_revision']) return LeaveCommands::conflict('leave_revision_conflict','This leave changed. Your cancellation was not applied. Reload and review before cancelling again.');
            if (! in_array($current->status, ['Pending', 'Approved'], true)) throw ValidationException::withMessages(['status' => ["This request is already {$current->status}."]]);
            if ($current->ends_at->lessThanOrEqualTo(now())) throw ValidationException::withMessages(['status' => ['This leave has already ended.']]);
            $current->update(['status' => 'Cancelled', 'cancelled_by_user_id' => $user->id, 'cancelled_at' => now(), 'revision'=>$current->revision+1]);
            $audit=$this->audit($user, 'leave.cancelled', $current, ['operation_id'=>$command['operation_id']]);
            $leave=$current->fresh(['requester.person','decider.person','dentist.person']);
            if ($leave->requester_user_id !== $user->id) $this->tell($leave->requester, $leave, null, 'Leave cancelled', 'Your leave '.$this->range($leave).' was cancelled by '.($user->person?->fullName() ?? 'an approver').'.', 'leave', $user);
            return LeaveCommands::save($user,$leave,'cancel',$command,$fingerprint,$this->view($leave,$user),$audit);
        });
    }

    /** One action: email the patients of the appointments this approved leave affects a reschedule link. */
    public function notify(Request $request, LeaveRequest $leaveRequest): JsonResponse
    {
        $user = $request->user();
        abort_unless($this->canDecide($user, $leaveRequest), 403);
        abort_unless($leaveRequest->status === 'Approved', 422, 'Only approved leave affects bookings.');
        $counts = ScheduleNotices::notify($this->conflicting($leaveRequest, $user), $user);
        if ($counts === null) {
            return response()->json(['message' => 'The Owner must approve the “Dentist unavailable” email wording first (Administration → Automations).', 'code' => 'wording_not_approved'], 422);
        }
        $leaveRequest->update(['patients_notified_at' => now()]);
        $this->audit($user, 'leave.patients_notified', $leaveRequest, $counts);

        return response()->json(['data' => $counts]);
    }

    // ---- rules --------------------------------------------------------------------------------------------------------

    /** Match the authenticated authority again after any lock wait, before mutating leave. */
    private function lockedActor(User $observed): User
    {
        // Serialize account changes without blocking FK key-share locks for notices to another actor.
        $current = User::whereKey($observed->id)->lock('FOR NO KEY UPDATE')->first();
        abort_unless($current && $current->account_status === 'Active' && $current->auth_version === $observed->auth_version
            && $current->role === $observed->role && $current->person_id === $observed->person_id, 403, 'Your access changed. Sign in again before changing leave.');

        return $current;
    }

    /** @return array{0:?DentistProfile,1:?StaffProfile} */
    private function profiles(User $user): array
    {
        return match ($user->role->value) {
            'dentist' => [DentistProfile::where('person_id', $user->person_id)->first(), null],
            'staff' => [null, StaffProfile::where('person_id', $user->person_id)->first()],
            default => [null, null],
        };
    }

    private function frontDeskApproves(): bool
    {
        return (AutomationCatalog::setting('staffing')?->settings['leave_approver'] ?? 'owner') === 'owner_or_front_desk';
    }

    private function isApproverRole(User $user): bool
    {
        return $user->role->value === 'owner' || ($user->role->value === 'staff' && $this->frontDeskApproves());
    }

    /** @return int[] the requester's branches (a dentist's assigned branches, or the staff member's branch) */
    private function branchIds(LeaveRequest $l): array
    {
        $l->loadMissing(['dentist.branches', 'staffProfile']);
        if ($l->dentist) return $l->dentist->branches->pluck('id')->all();
        if ($l->staffProfile?->branch_id) return [$l->staffProfile->branch_id];

        return UserBranchScope::where('user_id', $l->requester_user_id)->pluck('branch_id')->all();
    }

    private function branchRefs(LeaveRequest $l): array
    {
        return \App\Models\Branch::whereIn('id', $this->branchIds($l))->pluck('legacy_ref')->all();
    }

    /** SQL equivalent of branchIds priority: Dentist assignments, else Staff assignment, else account scopes. */
    private function scopeBranches(\Illuminate\Database\Eloquent\Builder $query,array $ids): void
    {
        $query->where(function($q)use($ids){
            $q->whereHas('dentist.branches',fn($branches)=>$branches->whereIn('branches.id',$ids))
              ->orWhere(function($fallback)use($ids){
                  $fallback->whereDoesntHave('dentist')->where(function($staff)use($ids){
                      $staff->whereHas('staffProfile',fn($profile)=>$profile->whereIn('branch_id',$ids))
                        ->orWhere(function($unassigned)use($ids){
                            $unassigned->where(fn($none)=>$none->whereDoesntHave('staffProfile')->orWhereHas('staffProfile',fn($profile)=>$profile->whereNull('branch_id')))
                              ->whereIn('requester_user_id',UserBranchScope::select('user_id')->whereIn('branch_id',$ids));
                        });
                  });
              });
        });
    }

    private function canDecide(User $user, LeaveRequest $l): bool
    {
        if ($l->requester_user_id === $user->id) return false; // nobody approves their own leave
        if ($user->role->value === 'owner') return true;
        if ($user->role->value !== 'staff' || ! $this->frontDeskApproves()) return false;

        return UserBranchScope::where('user_id', $user->id)->whereIn('branch_id', $this->branchIds($l))->exists();
    }

    private function sharesBranch(User $user, LeaveRequest $l): bool
    {
        if ($user->role->value === 'owner' || $l->requester_user_id === $user->id) return true;
        $mine = match ($user->role->value) {
            'staff' => UserBranchScope::where('user_id', $user->id)->pluck('branch_id')->all(),
            'dentist' => DentistProfile::where('person_id', $user->person_id)->first()?->branches()->pluck('branches.id')->all() ?? [],
            default => [],
        };

        return array_intersect($mine, $this->branchIds($l)) !== [];
    }

    /** @return Collection<int,User> who may decide this request */
    private function approvers(LeaveRequest $l): Collection
    {
        $owners = User::where('role', 'owner')->where('account_status', 'Active')->get();
        if (! $this->frontDeskApproves()) return $owners;
        $desk = User::where('role', 'staff')->where('account_status', 'Active')->whereIn('id', UserBranchScope::select('user_id')->whereIn('branch_id', $this->branchIds($l)))->get();

        return $owners->merge($desk)->reject(fn (User $u) => $u->id === $l->requester_user_id)->unique('id')->values();
    }

    /** Booked appointments of a dentist's leave period (pending: what approval would affect; approved: what it does affect). */
    private function conflicting(LeaveRequest $l, User $viewer): Collection
    {
        if (! $l->dentist_profile_id || in_array($l->status, ['Declined', 'Cancelled'], true)) return collect();
        $rows = Appointment::whereIn('status', ['Pending', 'Confirmed'])->where('dentist_profile_id', $l->dentist_profile_id)
            ->where('starts_at', '<', SchedulingService::ts($l->ends_at))->where('ends_at', '>', SchedulingService::ts($l->starts_at->greaterThan(now()) ? $l->starts_at : now()))
            ->with(['branch', 'service', 'patient.person'])->orderBy('starts_at')->get();
        if ($viewer->role->value === 'staff') {
            $scope = UserBranchScope::where('user_id', $viewer->id)->pluck('branch_id')->all();
            $rows = $rows->filter(fn (Appointment $a) => in_array($a->branch_id, $scope, true))->values();
        }

        return $rows;
    }

    // ---- output -------------------------------------------------------------------------------------------------------

    private function view(LeaveRequest $l, User $viewer): array
    {
        $mayReadNote = $l->requester_user_id === $viewer->id || $this->canDecide($viewer, $l);

        return ['id' => $l->public_id, 'revision'=>$l->revision, 'type' => $l->type, 'type_label' => LeaveRequest::TYPES[$l->type] ?? $l->type, 'status' => $l->status,
            'starts_at' => ClinicClock::local($l->starts_at)->toIso8601String(), 'ends_at' => ClinicClock::local($l->ends_at)->toIso8601String(), 'label' => $this->range($l),
            'requester' => ['name' => $l->requester?->person?->fullName(), 'role' => $l->dentist_profile_id ? 'Dentist' : 'Staff', 'dentist_id' => $l->dentist?->legacy_ref],
            'branches' => $this->branchRefs($l), 'private_note' => $mayReadNote ? $l->private_note : null, 'has_note' => (bool) $l->private_note,
            'decided_by' => $l->decider?->person?->fullName(), 'decided_at' => $l->decided_at?->toIso8601String(), 'patients_notified_at' => $l->patients_notified_at?->toIso8601String(),
            'can_decide' => $l->status === 'Pending' && $this->canDecide($viewer, $l),
            'can_cancel' => in_array($l->status, ['Pending', 'Approved'], true) && $l->ends_at->greaterThan(now()) && ($l->requester_user_id === $viewer->id || $this->canDecide($viewer, $l))];
    }

    private function range(LeaveRequest $l): string
    {
        $from = ClinicClock::local($l->starts_at);
        $to = ClinicClock::local($l->ends_at);
        $fullDays = $from->format('H:i') === '00:00' && $to->format('H:i') === '00:00';
        if ($fullDays) {
            $last = $to->subDay();

            return $from->isSameDay($last) ? $from->format('D, M j') : $from->format('D, M j').' to '.$last->format('D, M j');
        }

        return $from->isSameDay($to) ? $from->format('D, M j, g:i A').' to '.$to->format('g:i A') : $from->format('D, M j, g:i A').' to '.$to->format('D, M j, g:i A');
    }

    /** In-app notice always; an email through the outbox when the Owner approved the wording (never the note or the type). */
    private function tell(?User $to, LeaveRequest $l, ?string $template, string $title, string $body, string $page, User $actor): void
    {
        if (! $to) return;
        $kind = $template === 'leave_requested' ? 'leave_requested' : 'leave_decided';
        app(NotificationCenter::class)->staffNoticeOrFail($to, $kind, $title, $body, $page, $l->public_id, "leave:{$l->public_id}:{$l->status}:{$to->id}");
        if ($template && MessageTemplates::approved($template)) {
            app(MailOutbox::class)->queue($template, "{$template}:{$l->public_id}:{$l->status}:{$to->id}", $l, null, $to, $actor);
        }
    }

    /** Who, what and when only: never the private note. */
    private function audit(User $actor, string $action, LeaveRequest $l, array $extra = []): \App\Models\AuditLog
    {
        return app(AuditService::class)->recordAdministrative($action, $actor, $l->dentist, ['leave' => $l->public_id, 'requester' => $l->requester?->public_id ?? $l->requester_user_id,
            'type' => $l->type, 'from' => ClinicClock::local($l->starts_at)->toIso8601String(), 'to' => ClinicClock::local($l->ends_at)->toIso8601String(), 'status' => $l->status] + $extra);
    }
}

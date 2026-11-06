<?php

namespace App\Http\Controllers;

use App\Models\Branch;
use App\Models\DentistProfile;
use App\Models\FollowupTask;
use App\Models\Patient;
use App\Models\Service;
use App\Models\User;
use App\Models\UserBranchScope;
use App\Services\Audit\AuditService;
use App\Support\ClinicClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * M20 Patient Follow-Up. Tasks come from a completed treatment's follow-up fields (automatically, once) or are added by a Dentist or
 * the front desk: patient, reason, due date, branch, the service to book and an assignee (the branch front desk unless one person
 * is named). Open → Contacted → Booked (set by the system when the patient's next appointment is booked) → Closed (a note is
 * required when closed without a booking). The front desk and Dentists of the branch see and work the list; the Owner sees counts
 * and dates only (no reason). Audited without the reason or the note.
 */
class FollowupController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['branch_ref' => ['nullable', 'string', 'max:50'], 'status' => ['nullable', 'in:active,Open,Contacted,Booked,Closed'], 'due' => ['nullable', 'in:overdue,today,week,all']]);
        $today = ClinicClock::today();
        $q = FollowupTask::with(['patient.person', 'branch', 'service', 'assignee.person', 'appointment'])->orderBy('due_on')->orderBy('id')->limit(300)
            ->whereIn('branch_id', $this->branchIds($user))
            ->when(! empty($data['branch_ref']), fn ($q) => $q->whereIn('branch_id', Branch::select('id')->where('legacy_ref', $data['branch_ref'])))
            ->when(($data['status'] ?? 'active') === 'active', fn ($q) => $q->whereIn('status', FollowupTask::OPEN), fn ($q) => $q->where('status', $data['status']))
            ->when(($data['due'] ?? 'all') === 'overdue', fn ($q) => $q->where('due_on', '<', $today))
            ->when(($data['due'] ?? 'all') === 'today', fn ($q) => $q->where('due_on', $today))
            ->when(($data['due'] ?? 'all') === 'week', fn ($q) => $q->where('due_on', '<=', ClinicClock::addDays($today, 7)));

        return response()->json(['data' => $q->get()->map(fn (FollowupTask $t) => $this->view($t, $user))->values(),
            'meta' => ['today' => $today, 'counts' => $this->counts($user)]]);
    }

    /** The task panel on a patient record (front desk with the patient's full record, or a Dentist of the branch). */
    public function forPatient(Request $request, Patient $patient): JsonResponse
    {
        $user = $request->user();
        abort_unless($user->role->value === 'dentist' || $user->can('viewProfile', $patient), 403);
        $rows = FollowupTask::where('patient_id', $patient->id)->whereIn('branch_id', $this->branchIds($user))->with(['patient.person', 'branch', 'service', 'assignee.person', 'appointment'])
            ->orderByDesc('due_on')->limit(50)->get();

        return response()->json(['data' => $rows->map(fn (FollowupTask $t) => $this->view($t, $user))->values()]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['patient_id' => ['required', 'string', 'max:40'], 'branch_ref' => ['required', 'string', 'max:50'], 'reason' => ['required', 'string', 'max:500'],
            'due_on' => ['required', 'date_format:Y-m-d'], 'service_ref' => ['nullable', 'string', 'max:50'], 'assign_to_me' => ['sometimes', 'boolean']]);
        $task = DB::transaction(function () use ($data, $user) {
            $patient = Patient::where('public_id', $data['patient_id'])->firstOrFail();
            $branch = Branch::where('legacy_ref', $data['branch_ref'])->firstOrFail();
            abort_unless(in_array($branch->id, $this->branchIds($user), true), 403, 'You can add follow-ups for your own branches only.');
            if ($user->role->value === 'staff') abort_unless($user->can('viewProfile', $patient), 403);
            if ($data['due_on'] < ClinicClock::addDays(ClinicClock::today(), -365)) throw ValidationException::withMessages(['due_on' => ['Choose a date within the last year or later.']]);
            $task = FollowupTask::create(['patient_id' => $patient->id, 'branch_id' => $branch->id, 'reason' => $data['reason'], 'due_on' => $data['due_on'],
                'service_id' => ! empty($data['service_ref']) ? Service::where('legacy_ref', $data['service_ref'])->value('id') : null,
                'dentist_profile_id' => $user->role->value === 'dentist' ? DentistProfile::where('person_id', $user->person_id)->value('id') : null,
                'assignee_user_id' => ! empty($data['assign_to_me']) ? $user->id : null, 'source' => $user->role->value === 'dentist' ? 'dentist' : 'front_desk',
                'status' => 'Open', 'created_by_user_id' => $user->id, 'updated_by_user_id' => $user->id]);
            $this->audit($user, 'followup.created', $task);

            return $task->fresh(['patient.person', 'branch', 'service', 'assignee.person']);
        });

        return response()->json(['data' => $this->view($task, $user)], 201);
    }

    /** contacted: the patient was called or messaged. close: done (a note is required unless an appointment was booked). */
    public function update(Request $request, FollowupTask $followupTask): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['action' => ['required', 'in:contacted,close'], 'note' => ['nullable', 'string', 'max:500']]);
        $task = DB::transaction(function () use ($followupTask, $data, $user) {
            $t = FollowupTask::whereKey($followupTask->id)->lockForUpdate()->firstOrFail();
            // The route snapshot may predate a state/branch change. Authorize
            // and audit the locked row within the same transaction as its write.
            abort_unless(in_array($t->branch_id, $this->branchIds($user), true), 403);
            if ($data['action'] === 'contacted') {
                if ($t->status !== 'Open') throw ValidationException::withMessages(['action' => ["This follow-up is already {$t->status}."]]);
                $t->update(['status' => 'Contacted', 'contacted_at' => now(), 'updated_by_user_id' => $user->id, 'revision' => $t->revision + 1]);
            } else {
                if ($t->status === 'Closed') throw ValidationException::withMessages(['action' => ['This follow-up is already closed.']]);
                $note = trim((string) ($data['note'] ?? ''));
                if (! $t->appointment_id && $note === '') throw ValidationException::withMessages(['note' => ['Say why it is closed without a booking.']]);
                $t->update(['status' => 'Closed', 'close_note' => $note ?: null, 'closed_at' => now(), 'updated_by_user_id' => $user->id, 'revision' => $t->revision + 1]);
            }
            $this->audit($user, 'followup.'.($data['action'] === 'close' ? 'closed' : 'contacted'), $t);

            return $t->load(['patient.person', 'branch', 'service', 'assignee.person', 'appointment']);
        });

        return response()->json(['data' => $this->view($task, $user)]);
    }

    // ---- helpers ------------------------------------------------------------------------------------------------------

    /** @return int[] branches whose follow-ups this user works (Owner: every branch, metadata only) */
    private function branchIds(User $user): array
    {
        return match ($user->role->value) {
            'owner' => Branch::pluck('id')->all(),
            'staff' => UserBranchScope::where('user_id', $user->id)->pluck('branch_id')->all(),
            'dentist' => DentistProfile::where('person_id', $user->person_id)->first()?->branches()->pluck('branches.id')->all() ?? [],
            default => [],
        };
    }

    private function counts(User $user): array
    {
        $base = FollowupTask::whereIn('branch_id', $this->branchIds($user))->whereIn('status', FollowupTask::OPEN);

        return ['open' => (clone $base)->count(), 'overdue' => (clone $base)->where('due_on', '<', ClinicClock::today())->count(), 'due_today' => (clone $base)->where('due_on', ClinicClock::today())->count()];
    }

    /** Task, status and dates only: never the reason or the note. */
    private function audit(User $actor, string $action, FollowupTask $t): void
    {
        app(AuditService::class)->recordAdministrative($action, $actor, $t->patient, ['task' => $t->public_id, 'status' => $t->status, 'due_on' => $t->dueOn(), 'branch' => $t->branch?->legacy_ref]);
    }

    private function view(FollowupTask $t, User $viewer): array
    {
        $due = $t->dueOn();
        $out = ['id' => $t->public_id, 'status' => $t->status, 'due_on' => $due, 'overdue' => in_array($t->status, FollowupTask::OPEN, true) && $due < ClinicClock::today(),
            'branch' => ['id' => $t->branch?->legacy_ref, 'name' => $t->branch?->name], 'source' => $t->source, 'revision' => $t->revision];
        if ($viewer->role->value === 'owner') return $out; // counts and dates only
        $local = $t->appointment ? ClinicClock::local($t->appointment->starts_at) : null;

        return $out + ['patient' => ['id' => $t->patient?->public_id, 'name' => $t->patient?->person?->fullName(), 'code' => $t->patient?->patient_code, 'phone' => $t->patient?->person?->phone],
            'reason' => $t->reason, 'service' => $t->service ? ['id' => $t->service->legacy_ref, 'name' => $t->service->name] : null,
            'assignee' => $t->assignee ? $t->assignee->person?->fullName() : 'Branch front desk', 'close_note' => $t->close_note,
            'appointment' => $t->appointment ? ['id' => $t->appointment->public_id, 'code' => $t->appointment->appointment_code, 'when' => $local->format('D, M j, g:i A')] : null,
            'can_contact' => $t->status === 'Open', 'can_close' => $t->status !== 'Closed', 'can_book' => in_array($t->status, FollowupTask::OPEN, true)];
    }
}

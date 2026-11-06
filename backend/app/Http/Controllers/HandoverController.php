<?php

namespace App\Http\Controllers;

use App\Models\Appointment;
use App\Models\Branch;
use App\Models\DentistProfile;
use App\Models\Document;
use App\Models\Patient;
use App\Models\PatientHandover;
use App\Models\User;
use App\Models\UserBranchScope;
use App\Models\Visit;
use App\Services\Audit\AuditService;
use App\Services\Automations\AutomationCatalog;
use App\Services\Notifications\NotificationCenter;
use App\Support\ClinicClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * M25 Patient Handovers (R2-08: the branches used to keep separate records). When a patient's care moves to another branch or
 * dentist, the sender (front desk or the treating dentist) writes a handover: a summary, pending treatment, notes for the next
 * dentist and references to existing documents of that patient. The receiving branch's front desk and the receiving dentist see it
 * and acknowledge it. Who sees what:
 *   - Sending side: the creator, and the front desk of the sending branch.
 *   - Receiving side: the front desk of the receiving branch (the handover also counts as an in-scope record for the patient's
 *     full profile while it waits for acknowledgement or for the Owner's number of days after it, see grantsProfileAccess) and
 *     the receiving dentist (the handover itself; the generic patient record stays closed to dentists, a clinic decision).
 *   - Owner: metadata only (who, when, from, to, status) and the audit entries; never the clinical text.
 *   - Patient: never the content; a neutral in-app notice that their record was shared with the receiving branch.
 * Created, viewed by the receiving side, acknowledged and cancelled are audited without any clinical text. Never deleted.
 */
class HandoverController extends Controller
{
    /** Inbox: handovers to me (to acknowledge) and handovers I sent. Owner: metadata of every handover. */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['status' => ['nullable', 'in:Sent,Acknowledged,Cancelled'], 'patient_id' => ['nullable', 'string', 'max:40']]);
        $q = PatientHandover::with(['patient.person', 'fromBranch', 'toBranch', 'fromDentist.person', 'toDentist.person', 'creator.person', 'acknowledger.person'])
            ->when($data['status'] ?? null, fn ($q, $s) => $q->where('status', $s))
            ->when($data['patient_id'] ?? null, fn ($q, $p) => $q->whereIn('patient_id', Patient::select('id')->where('public_id', $p)))
            ->orderByDesc('created_at')->limit(200);
        $rows = $user->role->value === 'owner' ? $q->get() : $q->get()->filter(fn (PatientHandover $h) => $this->side($user, $h) !== null)->values();

        return response()->json(['data' => $rows->map(fn (PatientHandover $h) => $this->view($h, $user, false))->values()]);
    }

    /** One handover with its content (receiving and sending side only; a receiving-side read is audited). */
    public function show(Request $request, PatientHandover $patientHandover): JsonResponse
    {
        $user = $request->user();
        $side = $this->side($user, $patientHandover);
        abort_unless($side !== null || $user->role->value === 'owner', 404);
        if ($side === 'receiving') $this->audit($user, 'handover.viewed', $patientHandover);

        return response()->json(['data' => $this->view($patientHandover->load(['patient.person', 'fromBranch', 'toBranch', 'fromDentist.person', 'toDentist.person', 'creator.person', 'acknowledger.person']), $user, $side !== null)]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['patient_id' => ['required', 'string', 'max:40'], 'from_branch_ref' => ['required', 'string', 'max:50'], 'to_branch_ref' => ['required', 'string', 'max:50'],
            'to_dentist_ref' => ['nullable', 'string', 'max:50'], 'summary' => ['required', 'string', 'max:2000'], 'pending_treatment' => ['nullable', 'string', 'max:2000'],
            'notes' => ['nullable', 'string', 'max:2000'], 'document_ids' => ['nullable', 'array', 'max:10'], 'document_ids.*' => ['string', 'max:40']]);
        $handover = DB::transaction(function () use ($request, $data) {
            // Match scope-replacement's User boundary first. NO KEY UPDATE still excludes its FOR UPDATE lock,
            // while allowing audit/notification foreign-key KEY SHARE checks on this user (avoids a lock inversion).
            $user = User::whereKey($request->user()->id)->lock('FOR NO KEY UPDATE')->firstOrFail();
            abort_unless($user->account_status === 'Active', 403);
            $patient = Patient::where('public_id', $data['patient_id'])->firstOrFail();
            // Stable order for two opposite-direction handovers; shared locks exclude branch closure updates.
            $branches = Branch::whereIn('legacy_ref', [$data['from_branch_ref'], $data['to_branch_ref']])->orderBy('id')->sharedLock()->get();
            $from = $branches->firstWhere('legacy_ref', $data['from_branch_ref']);
            $to = $branches->firstWhere('legacy_ref', $data['to_branch_ref']);
            abort_unless($from && $to && $to->status === 'Open', 404);
            $fromDentist = $user->role->value === 'dentist' ? DentistProfile::where('person_id', $user->person_id)->first() : null;
            $toDentist = ! empty($data['to_dentist_ref']) ? DentistProfile::where('legacy_ref', $data['to_dentist_ref'])->firstOrFail() : null;
            // Profile edits precede pivot sync in administration. Lock profiles in that same order before pivots,
            // including combined profile/membership edits; branch-only edits still need the pivot locks below.
            $dentists = DentistProfile::whereIn('id', array_values(array_filter([$fromDentist?->id, $toDentist?->id])))
                ->orderBy('id')->sharedLock()->get();
            $fromDentist = $fromDentist ? $dentists->firstWhere('id', $fromDentist->id) : null;
            $toDentist = $toDentist ? $dentists->firstWhere('id', $toDentist->id) : null;
            // Lock existing membership rows, not a new global/profile mutex: sync/detach DELETEs must wait for these
            // shares even when a branch-only PATCH leaves the profile itself clean and emits no profile UPDATE.
            $memberships = DB::table('dentist_branches')->whereIn('dentist_profile_id', array_values(array_filter([$fromDentist?->id, $toDentist?->id])))
                ->whereIn('branch_id', [$from->id, $to->id])->orderBy('dentist_profile_id')->orderBy('branch_id')->sharedLock()->get();
            // Authorize only memberships actually locked: a later insertion into an initially empty result is not protected.
            $hasMembership = fn (DentistProfile $dentist, Branch $branch) => $memberships->contains(
                fn ($row) => (int) $row->dentist_profile_id === $dentist->id && (int) $row->branch_id === $branch->id);
            abort_if($fromDentist && ! $hasMembership($fromDentist, $from), 403, 'You can hand over only a patient you are caring for at your branch.');
            abort_unless($this->maySend($user, $patient, $from, $fromDentist), 403, 'You can hand over only a patient you are caring for at your branch.');
            if ($toDentist && ! $hasMembership($toDentist, $to)) throw ValidationException::withMessages(['to_dentist_ref' => ['That dentist does not work at the receiving branch.']]);
            if ($from->id === $to->id && (! $toDentist || $toDentist->id === $fromDentist?->id)) throw ValidationException::withMessages(['to_branch_ref' => ['Choose another branch or another dentist.']]);
            // Only existing documents of this patient that the sender can already see; the receiving side sees their titles only.
            $documentIds = collect($data['document_ids'] ?? [])->unique()->values();
            // Lock rows before evaluating the visibility subqueries. Retraction/metadata UPDATEs coordinate through
            // PostgreSQL's row locks even though the document writer does not explicitly SELECT FOR UPDATE.
            $lockedDocs = Document::whereIn('public_id', $documentIds)->orderBy('id')->sharedLock()->get();
            if ($lockedDocs->count() !== $documentIds->count()) throw ValidationException::withMessages(['document_ids' => ['Attach only this patient’s existing documents.']]);
            $docs = Document::visibleTo($user)->where('patient_id', $patient->id)->where('status', 'Active')->whereIn('public_id', $documentIds)->pluck('public_id');
            if ($docs->count() !== $documentIds->count()) throw ValidationException::withMessages(['document_ids' => ['Attach only this patient’s existing documents.']]);

            $handover = PatientHandover::create(['patient_id' => $patient->id, 'from_branch_id' => $from->id, 'to_branch_id' => $to->id, 'from_dentist_profile_id' => $fromDentist?->id,
                'to_dentist_profile_id' => $toDentist?->id, 'created_by_user_id' => $user->id, 'summary' => $data['summary'], 'pending_treatment' => $data['pending_treatment'] ?? null,
                'notes' => $data['notes'] ?? null, 'document_ids' => $docs->all(), 'status' => 'Sent']);
            $this->audit($user, 'handover.created', $handover);

            // Notices are best-effort effects of a committed, audited handover, never proof of delivery.
            DB::afterCommit(function () use ($handover, $patient, $from, $to) {
                try {
                    $title = 'Handover: '.($patient->person?->fullName() ?? 'a patient');
                    foreach ($this->receivers($handover) as $receiver) {
                        app(NotificationCenter::class)->staffNotice($receiver, 'handover_received', $title, 'From '.$from->name.'. Open it to acknowledge.', 'handovers', $handover->public_id, "handover:{$handover->public_id}:{$receiver->id}");
                    }
                    if ($patientUser = $patient->contactUser()) app(NotificationCenter::class)->recordShared($patientUser, $to->name, "record_shared:{$handover->public_id}");
                } catch (\Throwable $e) {
                    report($e); // A notification failure cannot roll back the already committed handover.
                }
            });

            return $handover;
        });

        return response()->json(['data' => $this->view($handover->fresh(['patient.person', 'fromBranch', 'toBranch', 'fromDentist.person', 'toDentist.person', 'creator.person']), $user, true)], 201);
    }

    public function acknowledge(Request $request, PatientHandover $patientHandover): JsonResponse
    {
        return DB::transaction(function () use ($request, $patientHandover) {
            // Route binding may precede a competing transition. Recheck access and state after taking the row lock.
            $current = PatientHandover::whereKey($patientHandover->id)->lockForUpdate()->firstOrFail();
            $user = User::whereKey($request->user()->id)->firstOrFail();
            abort_unless($user->account_status === 'Active', 403);
            abort_unless($this->side($user, $current) === 'receiving', 403, 'Only the receiving branch or dentist acknowledges a handover.');
            if ($current->status !== 'Sent') throw ValidationException::withMessages(['status' => ["This handover is already {$current->status}."]]);
            $current->update(['status' => 'Acknowledged', 'acknowledged_by_user_id' => $user->id, 'acknowledged_at' => now()]);
            $this->audit($user, 'handover.acknowledged', $current);

            return response()->json(['data' => $this->view($current->fresh(['patient.person', 'fromBranch', 'toBranch', 'fromDentist.person', 'toDentist.person', 'creator.person', 'acknowledger.person']), $user, true)]);
        });
    }

    public function cancel(Request $request, PatientHandover $patientHandover): JsonResponse
    {
        return DB::transaction(function () use ($request, $patientHandover) {
            $current = PatientHandover::whereKey($patientHandover->id)->lockForUpdate()->firstOrFail();
            $user = User::whereKey($request->user()->id)->firstOrFail();
            abort_unless($user->account_status === 'Active', 403);
            abort_unless($this->side($user, $current) === 'sending', 403, 'Only the sending side cancels a handover.');
            if ($current->status !== 'Sent') throw ValidationException::withMessages(['status' => ["This handover is already {$current->status}."]]);
            $current->update(['status' => 'Cancelled', 'cancelled_by_user_id' => $user->id, 'cancelled_at' => now()]);
            $this->audit($user, 'handover.cancelled', $current);

            return response()->json(['data' => $this->view($current->fresh(['patient.person', 'fromBranch', 'toBranch', 'creator.person']), $user, true)]);
        });
    }

    /** "Request handover" from the duplicate guard: the front desk asks the branch that has the record to send a handover. */
    public function requestOne(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['patient_id' => ['required', 'string', 'max:40'], 'from_branch_ref' => ['nullable', 'string', 'max:50']]);
        $patient = Patient::where('public_id', $data['patient_id'])->firstOrFail();
        $mine = UserBranchScope::where('user_id', $user->id)->pluck('branch_id')->all();
        abort_if($mine === [], 403);
        // Only from the duplicate guard: the patient must be a possible match of a registration waiting at one of my branches.
        // Otherwise the answer would tell any front desk where an arbitrary patient was treated.
        $intake = app(\App\Services\Intake\IntakeService::class);
        $matched = \App\Models\IntakeSubmission::where('status', 'pending')->whereIn('branch_id', $mine)->get()
            ->contains(fn ($s) => $intake->duplicates((array) ($s->data['self'] ?? []))->contains(fn ($d) => $d['patient']->id === $patient->id));
        abort_unless($matched, 404);
        // The branch that has the record: the one named, else the patient's latest visit or appointment branch.
        $from = ! empty($data['from_branch_ref']) ? Branch::where('legacy_ref', $data['from_branch_ref'])->first()
            : Branch::find(Visit::where('patient_id', $patient->id)->latest('id')->value('branch_id') ?? Appointment::where('patient_id', $patient->id)->latest('starts_at')->value('branch_id'));
        if (! $from || in_array($from->id, $mine, true)) throw ValidationException::withMessages(['patient_id' => ['There is no other branch to ask for this patient’s handover.']]);
        $myBranch = Branch::find($mine[0]);
        $askers = User::where('role', 'staff')->where('account_status', 'Active')->whereIn('id', UserBranchScope::select('user_id')->where('branch_id', $from->id))->get();
        foreach ($askers as $staff) {
            app(NotificationCenter::class)->staffNotice($staff, 'handover_received', 'Handover requested: '.($patient->person?->fullName() ?? 'a patient'),
                $myBranch->name.' asks you to send a handover for this patient.', 'handovers', $patient->public_id, "handover_request:{$patient->public_id}:{$myBranch->id}:{$staff->id}:".ClinicClock::today());
        }
        app(AuditService::class)->recordAdministrative('handover.requested', $user, $patient, ['from' => $from->legacy_ref, 'to' => $myBranch->legacy_ref]);

        return response()->json(['data' => ['asked' => $askers->count(), 'branch' => $from->name]]); // the branch was already shown as "Record found from
    }

    // ---- rules --------------------------------------------------------------------------------------------------------

    /** 'sending', 'receiving' or null (no access to the content). */
    private function side(User $user, PatientHandover $h): ?string
    {
        $scope = fn () => UserBranchScope::where('user_id', $user->id)->pluck('branch_id')->all();

        return match ($user->role->value) {
            'staff' => in_array($h->to_branch_id, $scope(), true) ? 'receiving' : (in_array($h->from_branch_id, $scope(), true) || $h->created_by_user_id === $user->id ? 'sending' : null),
            'dentist' => ($me = DentistProfile::where('person_id', $user->person_id)->value('id')) && $h->to_dentist_profile_id === $me ? 'receiving'
                : ($h->created_by_user_id === $user->id || ($me && $h->from_dentist_profile_id === $me) ? 'sending' : null),
            default => null,
        };
    }

    private function maySend(User $user, Patient $patient, Branch $from, ?DentistProfile $dentist): bool
    {
        return match ($user->role->value) {
            // A real appointment or visit at the sending branch: access that came from another handover cannot be passed on, so a
            // grant can never be chained or renewed by the receiving side.
            'staff' => UserBranchScope::where('user_id', $user->id)->where('branch_id', $from->id)->exists()
                && (Appointment::where('patient_id', $patient->id)->where('branch_id', $from->id)->exists() || Visit::where('patient_id', $patient->id)->where('branch_id', $from->id)->exists()),
            // The treating dentist: an appointment or visit of this patient with them at that branch.
            'dentist' => $dentist !== null && $dentist->branches()->where('branches.id', $from->id)->exists()
                && (Appointment::where('patient_id', $patient->id)->where('dentist_profile_id', $dentist->id)->where('branch_id', $from->id)->exists()
                    || Visit::where('patient_id', $patient->id)->where('branch_id', $from->id)->where('responsible_dentist_profile_id', $dentist->id)->exists()),
            default => false,
        };
    }

    /** @return \Illuminate\Support\Collection<int,User> the receiving branch's front desk and the receiving dentist */
    private function receivers(PatientHandover $h): \Illuminate\Support\Collection
    {
        $desk = User::where('role', 'staff')->where('account_status', 'Active')->whereIn('id', UserBranchScope::select('user_id')->where('branch_id', $h->to_branch_id))->get();
        $dentist = $h->to_dentist_profile_id ? User::where('role', 'dentist')->where('account_status', 'Active')->where('person_id', DentistProfile::whereKey($h->to_dentist_profile_id)->value('person_id'))->get() : collect();

        return $desk->merge($dentist)->reject(fn (User $u) => $u->id === $h->created_by_user_id)->unique('id')->values();
    }

    /** Who, when, from, to: never the summary, pending treatment or notes. */
    private function audit(User $actor, string $action, PatientHandover $h): void
    {
        $h->loadMissing(['fromBranch', 'toBranch', 'patient']);
        app(AuditService::class)->recordAdministrative($action, $actor, $h->patient, ['handover' => $h->public_id, 'from' => $h->fromBranch?->legacy_ref, 'to' => $h->toBranch?->legacy_ref,
            'to_dentist' => $h->toDentist?->legacy_ref, 'status' => $h->status]);
    }

    private function view(PatientHandover $h, User $viewer, bool $content): array
    {
        $dr = fn (?DentistProfile $d) => $d ? ['id' => $d->legacy_ref, 'name' => 'Dr. '.trim(($d->person?->first_name ?? '').' '.($d->person?->last_name ?? ''))] : null;
        $side = $this->side($viewer, $h);
        $out = ['id' => $h->public_id, 'status' => $h->status, 'side' => $side, 'created_at' => $h->created_at?->toIso8601String(),
            'patient' => ['id' => $h->patient?->public_id, 'name' => $h->patient?->person?->fullName(), 'code' => $h->patient?->patient_code],
            'from' => ['branch' => ['id' => $h->fromBranch?->legacy_ref, 'name' => $h->fromBranch?->name], 'dentist' => $dr($h->fromDentist), 'by' => $h->creator?->person?->fullName()],
            'to' => ['branch' => ['id' => $h->toBranch?->legacy_ref, 'name' => $h->toBranch?->name], 'dentist' => $dr($h->toDentist)],
            'acknowledged' => $h->acknowledged_at ? ['by' => $h->acknowledger?->person?->fullName(), 'at' => $h->acknowledged_at->toIso8601String()] : null,
            'can_acknowledge' => $side === 'receiving' && $h->status === 'Sent', 'can_cancel' => $side === 'sending' && $h->status === 'Sent'];
        // The clinical text only for the two sides, and only when asked for (the inbox lists metadata).
        if ($content && $side !== null) {
            $docs = Document::whereIn('public_id', $h->document_ids ?? [])->get(['public_id', 'title', 'category', 'created_at']);
            $out += ['summary' => $h->summary, 'pending_treatment' => $h->pending_treatment, 'notes' => $h->notes,
                'documents' => $docs->map(fn ($d) => ['id' => $d->public_id, 'title' => $d->title, 'category' => $d->category, 'date' => $d->created_at?->toDateString()])->values()];
        }

        return $out;
    }
}

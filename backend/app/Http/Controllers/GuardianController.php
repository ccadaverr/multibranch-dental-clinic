<?php

namespace App\Http\Controllers;

use App\Models\Patient;
use App\Models\User;
use App\Models\PatientGuardian;
use App\Models\CommandKey;
use App\Support\IdempotentCommand;
use App\Http\Controllers\Concerns\ReadsIdempotencyKey;
use App\Models\Person;
use App\Services\Audit\AuditService;
use App\Services\Intake\Guardianship;
use App\Services\Mail\MailDispatcher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * Parents and guardians. A patient adds dependents (consent recorded per dependent), sees them in the person switcher
 * ("Booking for: Me / Ana"), and — once a dependent is 18 — invites them to claim their own account (email code); the guardian
 * then loses access. Staff link an existing record to a guardian (audited).
 */
class GuardianController extends Controller
{
    use ReadsIdempotencyKey;
    public function mine(Request $request): JsonResponse
    {
        $me = $request->user()->patient;
        abort_unless($me, 403);

        return response()->json(['data' => Guardianship::dependentsOf($me)->map(fn ($l) => $this->view($l->dependent, $l->relationship, $l->relationship_other))->values(),
            'meta' => ['creation_contract' => ['version' => 1, 'idempotency' => true, 'durable_recovery' => true], 'me' => ['id' => $me->public_id, 'name' => $me->person?->fullName(), 'first_name' => $me->person?->first_name]]])->header('Cache-Control', 'private, no-store');
    }

    public function add(Request $request): JsonResponse
    {
        $actor = $request->user();
        $me = $this->creationGuardian($actor);
        $data = $request->validate(['first_name' => ['required', 'string', 'max:100'], 'last_name' => ['required', 'string', 'max:100'],
            'date_of_birth' => ['required', 'date_format:Y-m-d', 'before_or_equal:today'], 'sex' => ['nullable', 'in:Female,Male,Prefer not to say'],
            'relationship' => ['required', 'string', 'max:40'], 'relationship_other' => ['nullable', 'string', 'max:100'], 'consent' => ['accepted'],
            ...array_fill_keys(['patient_id','guardian_patient_id','branch_id','preferred_branch_id','created_by_user_id','revision'], ['prohibited'])]);
        if (strcasecmp(trim($data['relationship']), 'Other') === 0 && trim((string) ($data['relationship_other'] ?? '')) === '') {
            throw ValidationException::withMessages(['relationship_other' => ['Please specify the relationship.']]);
        }
        $key = $this->idempotencyKey($request, true);
        $response = IdempotentCommand::run(CommandKey::class, $actor, $key, 'patient.dependent.create', ['guardian' => $me->public_id, 'data' => $data], function () use ($actor, $me, $data) {
            // Retain established Patient-code serialization and recheck the existing limit under the guardian lock.
            DB::statement('LOCK TABLE patients IN SHARE ROW EXCLUSIVE MODE');
            $guardian = Patient::whereKey($me->id)->lockForUpdate()->firstOrFail();
            $this->creationGuardian($actor, $guardian->id);
            if (Guardianship::dependentsOf($guardian)->count() >= 10) throw ValidationException::withMessages(['first_name' => ['Ask the front desk to add more dependents.']]);
            $patient = Guardianship::addDependent($guardian, $data, $actor);
            $link = PatientGuardian::where('guardian_patient_id', $guardian->id)->where('dependent_patient_id', $patient->id)->where('status', 'active')->sole();
            return [['data' => $this->view($patient->load('person'), $link->relationship, $link->relationship_other), 'meta' => ['dependent_receipt' => [
                'guardian_id' => $guardian->public_id, 'dependent_id' => $patient->public_id, 'link_id' => $link->public_id,
            ]]], 201];
        }, fn () => ValidationException::withMessages(['idempotency_key' => ['This key was used for a different dependent creation.']]));
        $this->authorizeCreationReceipt($actor, $response->getData(true));
        return $response->header('Cache-Control', 'private, no-store');
    }

    /** Read only the original actor/key receipt, and only while that exact guardian/dependent link remains active. */
    public function creationReceipt(Request $request): JsonResponse
    {
        $actor = $request->user(); $this->creationGuardian($actor);
        $key = $this->idempotencyKey($request, true);
        $journal = CommandKey::where('user_id', $actor->id)->where('idempotency_key', $key)->where('command', 'patient.dependent.create')->where('response_status', 201)->first();
        abort_unless($journal, 404);
        $this->authorizeCreationReceipt($actor, $journal->response_body);
        return response()->json($journal->response_body)->header('Cache-Control', 'private, no-store');
    }

    private function creationGuardian(User $actor, ?int $expectedId = null): Patient
    {
        $current = $actor->fresh();
        abort_unless($current && $current->account_status === 'Active' && $current->role->value === 'patient' && $current->email_verified_at
            && $current->person_id === $actor->person_id && $current->auth_version === $actor->auth_version && $current->patient
            && ($expectedId === null || $current->patient->id === $expectedId), 403);
        $guardian = $current->patient;
        if (Guardianship::isMinor($guardian->person?->date_of_birth?->toDateString())) throw ValidationException::withMessages(['guardian' => ['Only an adult (18 or older) can add dependents.']]);
        return $guardian;
    }

    private function authorizeCreationReceipt(User $actor, array $body): void
    {
        $guardian = $this->creationGuardian($actor);
        $proof = $body['meta']['dependent_receipt'] ?? [];
        abort_unless(($proof['guardian_id'] ?? null) === $guardian->public_id && ($body['data']['id'] ?? null) === ($proof['dependent_id'] ?? null)
            && PatientGuardian::where('public_id', $proof['link_id'] ?? '')->where('guardian_patient_id', $guardian->id)->where('status', 'active')
                ->whereHas('dependent', fn ($q) => $q->where('public_id', $proof['dependent_id'] ?? ''))->exists(), 404);
    }

    /** Guardian (or Staff): a dependent of 18 or more gets an email to claim their own account. */
    public function invite(Request $request, Patient $patient): JsonResponse
    {
        $user = $request->user();
        $staff = in_array($user->role->value, ['staff', 'owner'], true);
        abort_unless($staff ? Gate::allows('update', $patient) || $user->role->value === 'owner' : (Guardianship::canActFor($user, $patient) && $user->patient->id !== $patient->id), 404);
        $data = $request->validate(['email' => ['required', 'email:rfc', 'max:255']]);
        $email = strtolower(trim($data['email']));
        if ((Guardianship::age($patient->person?->date_of_birth?->toDateString()) ?? 0) < Guardianship::ADULT_AGE) throw ValidationException::withMessages(['email' => ['Only a dependent of 18 or older can have their own account.']]);
        if ($patient->user?->email_verified_at) throw ValidationException::withMessages(['email' => ['This patient already has an account.']]);
        // A one-time claim link to the dependent's own email (single use, expires); the guardian keeps access until the claim succeeds.
        $result = app(\App\Services\Intake\AccountClaims::class)->offer($patient, $email, $user, $staff ? 'staff' : 'guardian');

        return response()->json(['data' => ['status' => $result['status'], 'message' => $result['message']]]);
    }

    /** Staff: link an existing record (for example a child registered before) to a guardian. Audited. */
    public function link(Request $request, Patient $patient): JsonResponse
    {
        Gate::authorize('update', $patient);
        $data = $request->validate(['guardian_patient_id' => ['required', 'string', 'max:40'], 'relationship' => ['required', 'string', 'max:40'], 'relationship_other' => ['nullable', 'string', 'max:100']]);
        if (strcasecmp(trim($data['relationship']), 'Other') === 0 && trim((string) ($data['relationship_other'] ?? '')) === '') {
            throw ValidationException::withMessages(['relationship_other' => ['Please specify the relationship.']]);
        }
        $guardian = Patient::where('public_id', $data['guardian_patient_id'])->firstOrFail();
        $link = Guardianship::link($patient, $guardian, $data['relationship'], $request->user(), null, $data['relationship_other'] ?? null);

        return response()->json(['data' => ['id' => $link->public_id, 'guardian' => $guardian->person?->fullName(), 'relationship' => $link->relationship, 'relationship_other' => $link->relationship_other]], 201);
    }

    private function view(Patient $p, string $relationship, ?string $relationshipOther = null): array
    {
        $dob = $p->person?->date_of_birth?->toDateString();

        return ['id' => $p->public_id, 'code' => $p->patient_code, 'name' => $p->person?->fullName(), 'first_name' => $p->person?->first_name, 'last_name' => $p->person?->last_name,
            'date_of_birth' => $dob, 'relationship' => $relationship, 'relationship_other' => $relationshipOther, 'minor' => Guardianship::isMinor($dob), 'age' => Guardianship::age($dob), 'has_account' => $p->user !== null];
    }
}

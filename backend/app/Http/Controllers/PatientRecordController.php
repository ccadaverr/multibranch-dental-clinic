<?php

namespace App\Http\Controllers;

use App\Http\Requests\Patient\UpdatePatientRecordRequest;
use App\Http\Resources\PatientRecordResource;
use App\Models\Appointment;
use App\Models\Branch;
use App\Models\CommandKey;
use App\Models\HmoCase;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\Person;
use App\Models\Treatment;
use App\Models\User;
use App\Models\Visit;
use App\Services\Audit\AuditService;
use App\Services\Visits\VisitCommandException;
use App\Support\ClinicClock;
use App\Support\IdempotentCommand;
use App\Http\Controllers\Concerns\ReadsIdempotencyKey;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

// M4 Patient record. One clinic-wide Patient identity (Person + Patient) is shared by every branch; branch scope never
// duplicates or hides it. This controller serves the non-clinical profile and a read-only INDEX of the records other
// modules own. The index carries only public ids, statuses and dates — never a copy of another module's mutable data
// (balances, treatment documentation, HMO decisions) — and each list is filtered by that module's own read scope.
class PatientRecordController extends Controller
{
    use ReadsIdempotencyKey;
    private const INDEX_LIMIT = 100;

    public function show(Request $request, Patient $patient): JsonResponse
    {
        Gate::authorize('view', $patient);

        return response()->json(['data' => new PatientRecordResource($patient->load(['person.user', 'preferredBranch']))])->header('Cache-Control', 'private, no-store');
    }

    public function update(UpdatePatientRecordRequest $request, Patient $patient): JsonResponse
    {
        $this->authorizeProfileUpdate($request->user(), $patient);
        $data = $request->validated();
        $actor = $request->user();
        $key = $this->idempotencyKey($request);
        $write = fn () => $this->applyProfileUpdate($request, $patient, $actor, $data);
        if ($key !== null) {
            return IdempotentCommand::run(CommandKey::class, $actor, $key, 'patient.profile.update', ['patient' => $patient->public_id, 'data' => $data], $write,
                fn () => VisitCommandException::rule('idempotency_key_reused', 'This Idempotency-Key was used for another request.', 'idempotency_key'))->header('Cache-Control', 'private, no-store');
        }
        [$body, $status] = $write();
        return response()->json($body, $status)->header('Cache-Control', 'private, no-store');
    }

    private function authorizeProfileUpdate(User $actor, Patient $patient): void
    {
        $current = $actor->fresh();
        abort_unless($current && $current->account_status === 'Active' && $current->auth_version === $actor->auth_version && $current->person_id === $actor->person_id, 403);
        Gate::forUser($current)->authorize('update', $patient);
    }

    private function applyProfileUpdate(Request $request, Patient $patient, User $actor, array $data): array
    {
        try {
            $record = DB::transaction(function () use ($data, $patient, $actor) {
                // Changing an email shares the registration paths' patients-table lock so a concurrent registration cannot
                // claim the same address (taken before the row locks to keep one lock order).
                if (array_key_exists('email', $data)) {
                    DB::statement('LOCK TABLE patients IN SHARE ROW EXCLUSIVE MODE');
                }
                $locked = Patient::whereKey($patient->id)->lockForUpdate()->firstOrFail();
                $this->authorizeProfileUpdate($actor, $locked);
                if ($locked->revision !== (int) $data['expected_revision']) {
                    throw new VisitCommandException(409, 'stale_revision', 'This patient record changed after it was opened. Reload it before trying again.', ['current_revision' => $locked->revision]);
                }
                $person = Person::whereKey($locked->person_id)->lockForUpdate()->firstOrFail();

                $personFields = array_intersect_key($data, array_flip(['first_name', 'last_name', 'email', 'phone', 'date_of_birth', 'sex', 'address']));
                $patientFields = array_intersect_key($data, array_flip(['emergency_contact', 'hmo_provider_name', 'hmo_member_number']));

                if (array_key_exists('email', $personFields) && $personFields['email'] !== $person->email) {
                    $this->guardEmailChange($person, $personFields['email']);
                }
                if (array_key_exists('preferred_branch_id', $data)) {
                    $patientFields['preferred_branch_id'] = $data['preferred_branch_id'] === null ? null : $this->resolveBranch($data['preferred_branch_id'])->id;
                }

                $person->fill($personFields);
                $locked->fill($patientFields);
                $changed = array_merge(array_keys($person->getDirty()), array_keys($locked->getDirty()));
                if ($changed) {
                    $person->save();
                    $locked->revision = $locked->revision + 1;
                    $locked->save();
                    // Field names only: a profile change never copies personal values into the audit payload.
                    app(AuditService::class)->recordClinical('patient.profile.updated', $actor, $locked, ['fields' => array_values($changed)]);
                }

                return $locked;
            });
        } catch (QueryException $e) {
            if (str_contains($e->getMessage(), 'persons_email_unique')) {
                throw VisitCommandException::rule('patient_email_exists', 'A record with this email already exists.', 'email');
            }
            throw $e;
        }

        return [['data' => (new PatientRecordResource($record->load(['person.user', 'preferredBranch'])))->resolve($request),
            'meta' => ['unchanged' => $record->revision === (int) $data['expected_revision']]], 200];
    }

    public function records(Request $request, Patient $patient): JsonResponse
    {
        Gate::authorize('view', $patient);
        $user = $request->user();
        $local = fn ($instant) => $instant ? ClinicClock::local($instant)->toIso8601String() : null;
        $limit = self::INDEX_LIMIT;
        $branch = fn ($model) => $model->branch ? ['id' => $model->branch->legacy_ref, 'name' => $model->branch->name] : null;

        $appointments = Appointment::visibleTo($user)->where('patient_id', $patient->id)->with('branch')
            ->orderByDesc('starts_at')->limit($limit)->get();
        $visits = Visit::visibleTo($user)->where('patient_id', $patient->id)->with('branch')
            ->orderByDesc('arrived_at')->limit($limit)->get();
        $treatments = Treatment::visibleTo($user)->whereHas('visit', fn ($q) => $q->where('patient_id', $patient->id))->with('visit.branch')
            ->orderByDesc('started_at')->limit($limit)->get();
        $invoices = Invoice::visibleTo($user)->where('patient_id', $patient->id)->with('branch')
            ->orderByDesc('id')->limit($limit)->get();
        $hmoCases = HmoCase::visibleTo($user)->where('patient_id', $patient->id)->with('branch')
            ->orderByDesc('id')->limit($limit)->get();

        return response()->json(['data' => [
            'patient' => ['id' => $patient->public_id, 'code' => $patient->patient_code],
            // Authoritative data stays in the owning module; these rows are links (public id + status + date + branch).
            'appointments' => $appointments->map(fn ($a) => ['id' => $a->public_id, 'code' => $a->appointment_code, 'status' => $a->status, 'starts_at' => $local($a->starts_at), 'branch' => $branch($a)])->values(),
            'visits' => $visits->map(fn ($v) => ['id' => $v->public_id, 'status' => $v->status, 'source' => $v->source, 'clinic_date' => $v->clinic_date->format('Y-m-d'), 'branch' => $branch($v)])->values(),
            'treatments' => $treatments->map(fn ($t) => ['id' => $t->public_id, 'status' => $t->status, 'started_at' => $local($t->started_at), 'completed_at' => $local($t->completed_at), 'branch' => $branch($t->visit)])->values(),
            'invoices' => $invoices->map(fn ($i) => ['id' => $i->public_id, 'status' => $i->status, 'issued_at' => $local($i->issued_at), 'branch' => $branch($i)])->values(),
            'hmo_cases' => $hmoCases->map(fn ($c) => ['id' => $c->public_id, 'status' => $c->status, 'branch' => $branch($c)])->values(),
            'limit_per_list' => $limit,
            // Record families with no server-authoritative source yet. They are listed so the client never presents an
            // empty list as "no records".
            'unavailable' => ['clinical_history', 'prescriptions', 'follow_ups'],
        ]])->header('Cache-Control', 'private, no-store');
    }

    private function resolveBranch(string $reference): Branch
    {
        $branch = Branch::where('legacy_ref', $reference)->orWhereRaw('lower(public_id) = ?', [strtolower($reference)])->first();

        return $branch ?? throw VisitCommandException::rule('branch_not_found', 'Choose an existing branch.', 'preferred_branch_id');
    }

    /** The email of a Patient who has a portal account is owned by M1 (verification, session revocation). */
    private function guardEmailChange(Person $person, ?string $email): void
    {
        if ($person->user()->exists()) {
            throw VisitCommandException::rule('email_managed_by_account', 'This patient has a portal account. Their email is changed through account management, not the patient record.', 'email');
        }
        if ($email !== null && (Person::where('email', $email)->where('id', '!=', $person->id)->exists() || User::withTrashed()->where('email', $email)->exists())) {
            throw VisitCommandException::rule('patient_email_exists', 'A record with this email already exists.', 'email');
        }
    }
}

<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Http\Controllers\Concerns\ReadsIdempotencyKey;
use App\Http\Resources\HmoCaseResource;
use App\Http\Resources\HmoMembershipResource;
use App\Http\Resources\PatientHmoCaseResource;
use App\Models\Appointment;
use App\Models\HmoCase;
use App\Models\HmoCaseRequirement;
use App\Models\Patient;
use App\Models\PatientHmoMembership;
use App\Models\User;
use App\Models\UserBranchScope;
use App\Models\Visit;
use App\Services\Hmo\HmoCaseService;
use App\Services\Hmo\HmoFinancialGate;
use App\Support\ClinicClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

// Minimal M12 API. Staff (branch scope of the Visit) operate cases; Staff maintain memberships; Owner reads everything
// (no mutation this wave); a Dentist reads a safe summary for Visits they are responsible for; a Patient reads only their
// own cases through /mine (identity from the session). Server policy decides — never the browser.
class HmoController extends Controller
{
    use ReadsIdempotencyKey;

    private const RELATIONS = ['visit.dentist.person', 'visit.appointment', 'patient.person', 'branch', 'requirements', 'events.actor.person', 'membership'];

    private const MAX_RANGE_DAYS = 184;

    public function __construct(private readonly HmoCaseService $cases, private readonly HmoFinancialGate $gate) {}

    // ---- MEMBERSHIP ---------------------------------------------------------------------------------------------------

    public function membership(Request $request, string $patient): JsonResponse
    {
        $user = $request->user();
        $this->assertStaffOrOwner($user);
        $record = Patient::where('public_id', $patient)->first();
        abort_unless($record && ($user->role === Role::Owner
            || Visit::visibleTo($user)->where('patient_id', $record->id)->exists()
            || Appointment::visibleTo($user)->where('patient_id', $record->id)->exists()), 404);

        return response()->json(['data' => $this->membershipBody($record)])
            ->header('Cache-Control', 'private, no-store');
    }

    // Membership MUTATION needs an authoritative operational context: a Visit in the Staff member's branch scope. The
    // Patient is derived from that Visit (never from a submitted Patient id, name, email or branch); the membership itself
    // stays global to the Patient and carries no branch.
    private const MEMBERSHIP_FORGED = ['patient_id' => ['prohibited'], 'patient_ref' => ['prohibited'], 'branch_id' => ['prohibited'], 'branch_ref' => ['prohibited']];

    private function membershipPatient(Request $request, Visit $visit): Patient
    {
        $this->assertStaffForBranch($request->user(), $visit->branch_id);

        return $visit->patient()->firstOrFail();
    }

    public function setMembership(Request $request, Visit $visit): JsonResponse
    {
        $patient = $this->membershipPatient($request, $visit);
        $v = $request->validate([
            'provider_name' => ['required', 'string', 'max:120'],
            'member_number' => ['required', 'string', 'max:80'],
            'expected_active_id' => ['present', 'nullable', 'string'],
            'status' => ['prohibited'], 'created_by_user_id' => ['prohibited'],
        ] + self::MEMBERSHIP_FORGED);

        return $this->cases->setMembership($request->user(), $patient, trim($v['provider_name']), trim($v['member_number']), $v['expected_active_id'],
            $this->idempotencyKey($request, true), fn () => ['data' => $this->membershipBody($patient)]);
    }

    public function endMembership(Request $request, Visit $visit): JsonResponse
    {
        $patient = $this->membershipPatient($request, $visit);
        $v = $request->validate(['expected_active_id' => ['required', 'string']] + self::MEMBERSHIP_FORGED);

        return $this->cases->endMembership($request->user(), $patient, $v['expected_active_id'], $this->idempotencyKey($request, true),
            fn () => ['data' => $this->membershipBody($patient)]);
    }

    private function membershipBody(Patient $patient): array
    {
        $rows = PatientHmoMembership::with(['createdBy.person', 'endedBy.person'])->where('patient_id', $patient->id)->orderByDesc('id')->get();

        return [
            'patient' => ['id' => $patient->public_id, 'code' => $patient->patient_code],
            'active' => ($active = $rows->firstWhere('status', 'active')) ? (new HmoMembershipResource($active))->resolve() : null,
            'history' => HmoMembershipResource::collection($rows)->resolve(),
        ];
    }

    // ---- READS --------------------------------------------------------------------------------------------------------

    public function index(Request $request)
    {
        [$from, $to] = $this->window($request);
        $query = HmoCase::visibleTo($request->user())->with(self::RELATIONS)
            ->whereHas('visit', fn ($v) => $v->whereBetween('clinic_date', [$from, $to]))
            ->orderBy('id');

        return HmoCaseResource::collection($query->get());
    }

    public function show(Request $request, HmoCase $hmoCase): HmoCaseResource
    {
        abort_unless(HmoCase::visibleTo($request->user())->whereKey($hmoCase->id)->exists(), 403, 'Forbidden.');

        return new HmoCaseResource($hmoCase->load(self::RELATIONS));
    }

    public function mine(Request $request)
    {
        $user = $request->user();
        abort_unless($user->role === Role::Patient && $user->patient !== null, 403, 'Forbidden.');
        $request->validate(['patient_id' => ['prohibited']]);

        return PatientHmoCaseResource::collection(HmoCase::where('patient_id', $user->patient->id)
            ->with(['visit.appointment', 'branch', 'requirements', 'membership'])->orderByDesc('id')->limit(100)->get());
    }

    /** Visits in scope whose Patient has an active membership but no case yet: a claim decision is required (P3). */
    public function claimDecisions(Request $request): JsonResponse
    {
        $user = $request->user();
        $this->assertStaffOrOwner($user);
        [$from, $to] = $this->window($request);
        $visits = Visit::visibleTo($user)->with(['patient.person', 'branch', 'appointment'])
            ->whereBetween('clinic_date', [$from, $to])
            ->whereDoesntHave('hmoCase')
            ->whereIn('patient_id', PatientHmoMembership::select('patient_id')->where('status', 'active'))
            ->orderBy('clinic_date')->orderBy('id')->get();

        return response()->json(['data' => $visits->map(fn (Visit $v) => [
            'visit' => ['id' => $v->public_id, 'clinic_date' => $v->clinic_date->format('Y-m-d'), 'status' => $v->status],
            'patient' => ['id' => $v->patient->public_id, 'code' => $v->patient->patient_code, 'name' => $v->patient->person?->fullName()],
            'branch' => ['id' => $v->branch->legacy_ref, 'name' => $v->branch->name],
            'appointment' => $v->appointment ? ['id' => $v->appointment->public_id, 'code' => $v->appointment->appointment_code] : null,
        ])->values()]);
    }

    /** The M12 financial gate for a Visit (read-only; M11 calls HmoFinancialGate internally). */
    public function gate(Request $request, string $visit): JsonResponse
    {
        $user = $request->user();
        $this->assertStaffOrOwner($user);
        $visit = Visit::visibleTo($user)->where('public_id', strtolower($visit))->first();
        abort_unless($visit, 404, 'Visit not found.');

        return response()->json(['data' => $this->gate->forVisit($visit)]);
    }

    // ---- COMMANDS -----------------------------------------------------------------------------------------------------

    public function open(Request $request, Visit $visit): JsonResponse
    {
        $this->assertStaffForBranch($request->user(), $visit->branch_id);

        return $this->cases->open($request->user(), $visit, $this->idempotencyKey($request, true), $this->presenter($request));
    }

    public function selfPay(Request $request, Visit $visit): JsonResponse
    {
        $this->assertStaffForBranch($request->user(), $visit->branch_id);
        $v = $request->validate(['reason' => ['required', 'string', 'max:1000']]);

        return $this->cases->selfPay($request->user(), $visit, trim($v['reason']), $this->idempotencyKey($request, true), $this->presenter($request));
    }

    public function requirement(Request $request, HmoCase $hmoCase, string $rule): JsonResponse
    {
        $this->assertStaffForBranch($request->user(), $hmoCase->branch_id);
        abort_unless(array_key_exists($rule, HmoCaseRequirement::RULES), 404);
        $v = $request->validate(['expected_revision' => ['required', 'integer', 'min:1'], 'document_label' => ['nullable', 'string', 'max:200']]);

        return $this->cases->validateRequirement($request->user(), $hmoCase, $rule, (int) $v['expected_revision'], isset($v['document_label']) ? trim($v['document_label']) : null,
            $this->idempotencyKey($request, true), $this->presenter($request));
    }

    public function submit(Request $request, HmoCase $hmoCase): JsonResponse
    {
        $this->assertStaffForBranch($request->user(), $hmoCase->branch_id);
        $v = $request->validate(['expected_revision' => ['required', 'integer', 'min:1'], 'method' => ['required', Rule::in(HmoCase::METHODS)], 'note' => ['required', 'string', 'max:2000']]);

        return $this->cases->submit($request->user(), $hmoCase, (int) $v['expected_revision'], $v['method'], trim($v['note']), $this->idempotencyKey($request, true), $this->presenter($request));
    }

    public function contact(Request $request, HmoCase $hmoCase): JsonResponse
    {
        $this->assertStaffForBranch($request->user(), $hmoCase->branch_id);
        $v = $request->validate([
            'expected_revision' => ['required', 'integer', 'min:1'], 'method' => ['required', Rule::in(HmoCase::METHODS)],
            'note' => ['required', 'string', 'max:2000'], 'next_action' => ['required', 'string', 'max:1000'],
        ]);

        return $this->cases->contact($request->user(), $hmoCase, (int) $v['expected_revision'], $v['method'], trim($v['note']), trim($v['next_action']),
            $this->idempotencyKey($request, true), $this->presenter($request));
    }

    public function escalate(Request $request, HmoCase $hmoCase): JsonResponse
    {
        $this->assertStaffForBranch($request->user(), $hmoCase->branch_id);
        $v = $request->validate(['expected_revision' => ['required', 'integer', 'min:1']]);

        return $this->cases->escalate($request->user(), $hmoCase, (int) $v['expected_revision'], $this->idempotencyKey($request, true), $this->presenter($request));
    }

    public function respond(Request $request, HmoCase $hmoCase): JsonResponse
    {
        $this->assertStaffForBranch($request->user(), $hmoCase->branch_id);
        $v = $request->validate([
            'expected_revision' => ['required', 'integer', 'min:1'],
            'submission_cycle' => ['required', 'integer', 'min:1'],
            'outcome' => ['required', Rule::in(['Approved', 'Rejected', 'Returned'])],
            'method' => ['required', Rule::in(HmoCase::METHODS)],
            'note' => ['required', 'string', 'max:10000'],
            'provider_reference' => ['nullable', 'string', 'max:120'],
            // Decimal text; zero is a valid approved amount (full non-coverage is recorded as Rejected, not here).
            'approved_amount' => ['required_if:outcome,Approved', 'prohibited_unless:outcome,Approved', 'nullable', 'string', 'regex:/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/'],
            'returned_requirements' => ['required_if:outcome,Returned', 'prohibited_unless:outcome,Returned', 'array', 'min:1'],
            'returned_requirements.*' => ['string', Rule::in(array_keys(HmoCaseRequirement::RULES))],
            'status' => ['prohibited'], 'final_at' => ['prohibited'],
        ], ['approved_amount.regex' => 'Enter the approved amount as a peso value with at most two decimals, for example 1200.00.']);

        return $this->cases->respond($request->user(), $hmoCase, (int) $v['expected_revision'], (int) $v['submission_cycle'], $v['outcome'], $v['method'], trim($v['note']),
            isset($v['provider_reference']) ? trim($v['provider_reference']) : null, $v['approved_amount'] ?? null, array_values(array_unique($v['returned_requirements'] ?? [])),
            $this->idempotencyKey($request, true), $this->presenter($request));
    }

    public function withdraw(Request $request, HmoCase $hmoCase): JsonResponse
    {
        $this->assertStaffForBranch($request->user(), $hmoCase->branch_id);
        $v = $request->validate(['expected_revision' => ['required', 'integer', 'min:1'], 'reason' => ['required', 'string', 'max:1000']]);

        return $this->cases->withdraw($request->user(), $hmoCase, (int) $v['expected_revision'], trim($v['reason']), $this->idempotencyKey($request, true), $this->presenter($request));
    }

    // ---- SUPPORT ------------------------------------------------------------------------------------------------------

    private function presenter(Request $request): \Closure
    {
        return fn (HmoCase $case) => (new HmoCaseResource($case->load(self::RELATIONS)))->response($request)->getData(true);
    }

    private function window(Request $request): array
    {
        $v = $request->validate([
            'from' => ['nullable', 'date_format:Y-m-d', 'required_with:to'],
            'to' => ['nullable', 'date_format:Y-m-d', 'required_with:from', 'after_or_equal:from'],
        ]);
        $from = $v['from'] ?? ClinicClock::today();
        $to = $v['to'] ?? $from;
        if (ClinicClock::at($from, '00:00')->diffInDays(ClinicClock::at($to, '00:00')) >= self::MAX_RANGE_DAYS) {
            throw ValidationException::withMessages(['to' => 'A date range may cover at most '.self::MAX_RANGE_DAYS.' days.']);
        }

        return [$from, $to];
    }

    private function staffScope(User $user, int $branchId): bool
    {
        return UserBranchScope::where('user_id', $user->id)->where('branch_id', $branchId)->exists();
    }

    private function assertStaffForBranch(User $user, int $branchId): void
    {
        abort_unless($user->role === Role::Staff && $this->staffScope($user, $branchId), 403, 'Forbidden.');
    }

    private function assertStaffOrOwner(User $user): void
    {
        abort_unless($user->role === Role::Owner || $user->role === Role::Staff, 403, 'Forbidden.');
    }

}

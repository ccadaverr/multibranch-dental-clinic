<?php

namespace App\Http\Controllers;

use App\Models\Branch;
use App\Models\IntakeSubmission;
use App\Models\Patient;
use App\Models\UserBranchScope;
use App\Services\Intake\Guardianship;
use App\Services\Intake\IntakeService;
use App\Services\Intake\JoinCodes;
use App\Support\ClinicClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use libphonenumber\NumberParseException;
use libphonenumber\PhoneNumberFormat;
use libphonenumber\PhoneNumberUtil;

/**
 * Registration intake. Public (the counter QR, no sign-in): the branch page and the registration form, which
 * needs today's code from the front-desk screen and is rate-limited per IP and device. Signed-in patients join today's queue
 * with the same code. Staff: today's code (refresh), pending registrations with possible existing records, confirm or
 * cancel, and the one-click in-person ID check.
 */
class IntakeController extends Controller
{
    public function __construct(private readonly IntakeService $intake) {}

    /** Public: what the counter page shows (the code itself is NEVER returned here). */
    public function branch(string $branchRef): JsonResponse
    {
        $branch = $this->branchOrFail($branchRef);

        return response()->json(['data' => ['id' => $branch->legacy_ref, 'name' => $branch->name, 'address' => $branch->address, 'today' => ClinicClock::today(),
            'open_today' => $branch->hoursOnDate(ClinicClock::today()) !== null, 'id_types' => IntakeService::ID_TYPES, 'consent_version' => IntakeService::CONSENT_VERSION]]);
    }

    /** Public: register at the counter (and optionally join today's queue). */
    public function submit(Request $request): JsonResponse
    {
        $data = $this->validateForm($request);
        $branch = $this->branchOrFail($data['branch_ref']);
        $this->requireCode($branch, $data['code'] ?? null);
        if (Guardianship::isMinor($data['self']['date_of_birth'])) {
            throw ValidationException::withMessages(['self.date_of_birth' => ['Under 18: a parent or guardian registers you, as their dependent, in this same form.']]);
        }
        $submission = $this->intake->submit($branch, $data, $data['channel'] ?? 'phone', $this->deviceHash($request));

        return response()->json(['data' => ['reference' => $submission->reference, 'branch' => $branch->name, 'join_queue' => $submission->join_queue,
            'message' => $submission->join_queue ? 'The front desk will check your ID and call you.' : 'Registered. Show this reference at the front desk.']], 201);
    }

    /** Signed-in patient: join today's queue with the counter code (for themselves or a dependent). */
    public function accountJoin(Request $request): JsonResponse
    {
        $data = $request->validate(['branch_ref' => ['required', 'string', 'max:50'], 'code' => ['required', 'string', 'max:12'], 'visit_for' => ['nullable', 'string', 'max:40']]);
        $branch = $this->branchOrFail($data['branch_ref']);
        $this->requireCode($branch, $data['code']);
        $patient = $request->user()->patient;
        abort_unless($patient, 403);
        $visitFor = $data['visit_for'] ?? 'self';
        if ($visitFor !== 'self') {
            $dependent = Patient::where('public_id', $visitFor)->first();
            if (! Guardianship::canActFor($request->user(), $dependent)) throw ValidationException::withMessages(['visit_for' => ['Choose yourself or one of your dependents.']]);
            $visitFor = 'dependent:'.$dependent->public_id;
        }
        $submission = $this->intake->submitForAccount($branch, $patient, $visitFor, $this->deviceHash($request));

        return response()->json(['data' => ['reference' => $submission->reference, 'branch' => $branch->name, 'message' => 'The front desk will check your ID and call you.']], 201);
    }

    /** Staff: today's code for their branch (Owner: any branch). */
    public function code(Request $request): JsonResponse
    {
        $branch = $this->staffBranch($request);
        $row = JoinCodes::current($branch);

        return response()->json(['data' => ['branch' => ['id' => $branch->legacy_ref, 'name' => $branch->name], 'code' => $row->code, 'valid_on' => ClinicClock::today(),
            'join_url' => rtrim((string) config('app.frontend_url'), '/').'/#join/'.$branch->legacy_ref]]);
    }

    public function refreshCode(Request $request): JsonResponse
    {
        $branch = $this->staffBranch($request);
        $row = JoinCodes::refresh($branch, $request->user());

        return response()->json(['data' => ['branch' => ['id' => $branch->legacy_ref, 'name' => $branch->name], 'code' => $row->code, 'valid_on' => ClinicClock::today()]]);
    }

    /** Staff: today's pending registrations in their branches, with possible existing records from any branch. */
    public function pending(Request $request): JsonResponse
    {
        $user = $request->user();
        $rows = IntakeSubmission::where('status', 'pending')->where('created_at', '>=', ClinicClock::at(ClinicClock::today(), '00:00')->toIso8601String())
            ->when($user->role->value === 'staff', fn ($q) => $q->whereIn('branch_id', UserBranchScope::select('branch_id')->where('user_id', $user->id)))
            ->with(['branch', 'accountPatient.person', 'accountPatient.user'])->orderBy('created_at')->get();

        return response()->json(['data' => $rows->map(fn (IntakeSubmission $s) => $this->view($s))->values(), 'meta' => ['id_types' => IntakeService::ID_TYPES]]);
    }

    public function confirm(Request $request, IntakeSubmission $intakeSubmission): JsonResponse
    {
        $this->assertBranch($request, $intakeSubmission->branch_id);
        $data = $request->validate(['use_patient' => ['nullable', 'string', 'max:40'], 'corrections' => ['sometimes', 'array'], 'corrections.*' => ['nullable'],
            'id_verified' => ['sometimes', 'boolean'], 'id_type' => ['nullable', 'string', 'max:30'], 'id_last4' => ['nullable', 'string', 'max:8'],
            'other_details' => ['nullable', 'string', 'max:100'],
            'service_ref' => ['nullable', 'string', 'max:50'], 'dentist_ref' => ['nullable', 'string', 'max:50']]);
        if (! empty($data['id_verified']) && ($data['id_type'] ?? null) === 'other' && (! isset($data['other_details']) || trim((string) $data['other_details']) === '')) {
            throw ValidationException::withMessages(['other_details' => ['Specify the ID type.']]);
        }
        if (isset($data['corrections'])) $data['corrections'] = $this->validateCorrections($data['corrections']);
        [$submission, $patient, $visitId] = $this->intake->confirm($intakeSubmission, $request->user(), $data);

        return response()->json(['data' => ['reference' => $submission->reference, 'status' => $submission->status, 'patient' => ['id' => $patient->public_id, 'code' => $patient->patient_code,
            'name' => $patient->person?->fullName()], 'visit_id' => $visitId]]);
    }

    public function cancel(Request $request, IntakeSubmission $intakeSubmission): JsonResponse
    {
        $this->assertBranch($request, $intakeSubmission->branch_id);

        return response()->json(['data' => ['reference' => $this->intake->cancel($intakeSubmission, $request->user())->reference, 'status' => 'cancelled']]);
    }

    /** Staff: one click at Check-In — the physical ID was checked (type only; never the number or a photo). */
    public function verifyId(Request $request, Patient $patient): JsonResponse
    {
        Gate::authorize('update', $patient);
        $data = $request->validate([
            'id_type' => ['required', 'string', 'max:30'],
            'id_last4' => ['nullable', 'string', 'max:8'],
            'other_details' => ['nullable', 'string', 'max:100'],
        ]);
        if ($data['id_type'] === 'other' && (! isset($data['other_details']) || trim((string) $data['other_details']) === '')) {
            throw ValidationException::withMessages(['other_details' => ['Specify the ID type.']]);
        }
        $p = $this->intake->recordIdCheck($patient, $request->user(), $data['id_type'], $data['id_last4'] ?? null, $data['other_details'] ?? null);

        return response()->json(['data' => [
            'patient_id' => $p->public_id,
            'id_type' => $p->id_type,
            'other_details' => $p->id_type === 'other' ? $p->other_details : null,
            'id_verified_at' => $p->id_verified_at?->toIso8601String(),
            'id_last4' => $p->id_last4,
        ]]);
    }

    /**
     * Staff: "Offer online account" for a record without one (for example registered at the counter without an email). The
     * physical ID is checked first (now, or already recorded); staff confirm the patient's email with them; a one-time claim link
     * goes to that email. Audited with who and when.
     */
    public function offerAccount(Request $request, Patient $patient): JsonResponse
    {
        Gate::authorize('update', $patient);
        $data = $request->validate([
            'email' => ['required', 'email:rfc', 'max:255'],
            'id_type' => ['nullable', 'string', 'max:30'],
            'other_details' => ['nullable', 'string', 'max:100'],
        ]);
        // One transaction: a refused offer (a minor, an email in use) also leaves no ID-check record behind.
        $result = DB::transaction(function () use ($patient, $data, $request) {
            if (! $patient->id_verified_at) {
                if (empty($data['id_type'])) throw ValidationException::withMessages(['id_type' => ['Check the patient’s ID in person first.']]);
                if ($data['id_type'] === 'other' && (! isset($data['other_details']) || trim((string) $data['other_details']) === '')) {
                    throw ValidationException::withMessages(['other_details' => ['Specify the ID type.']]);
                }
                $this->intake->recordIdCheck($patient, $request->user(), $data['id_type'], null, $data['other_details'] ?? null);
            }

            return app(\App\Services\Intake\AccountClaims::class)->offer($patient, $data['email'], $request->user(), 'staff');
        });

        // Say what really happened to the email (sent, test address suppressed, failed): the link exists either way.
        $message = $result['status'] === 'transport_accepted' ? 'A one-time link was emailed to the patient. It works once and expires.' : $result['message'];

        return response()->json(['data' => ['status' => $result['status'], 'message' => $message]]);
    }

    private function view(IntakeSubmission $s): array
    {
        $base = ['id' => $s->public_id, 'reference' => $s->reference, 'channel' => $s->channel, 'branch' => $s->branch?->name, 'branch_ref' => $s->branch?->legacy_ref, 'join_queue' => $s->join_queue,
            'visit_for' => $s->visit_for, 'id_type' => $s->id_type, 'scanned_fields' => $s->scanned_fields ?? [], 'created_at' => ClinicClock::local($s->created_at)->toIso8601String(),
            'time' => ClinicClock::local($s->created_at)->format('g:i A')];
        if ($s->channel === 'account') {
            $p = $s->accountPatient;
            $for = str_starts_with($s->visit_for, 'dependent:') ? Patient::where('public_id', substr($s->visit_for, 10))->with('person')->first() : null;

            return $base + ['account' => ['patient_id' => $p->public_id, 'code' => $p->patient_code, 'name' => $p->person?->fullName(), 'id_verified' => $p->id_verified_at !== null,
                'visit_for_name' => $for?->person?->fullName(), 'visit_for_minor' => $for ? Guardianship::isMinor($for->person?->date_of_birth?->toDateString()) : false]];
        }
        $self = $s->data['self'] ?? [];
        $deps = array_map(fn ($d) => $d + ['minor' => Guardianship::isMinor($d['date_of_birth'] ?? null)], $s->data['dependents'] ?? []);

        return $base + ['self' => $self, 'dependents' => $deps, 'duplicates' => $this->intake->duplicates($self)->map(fn ($d) => [
            'patient_id' => $d['patient']->public_id, 'code' => $d['patient']->patient_code, 'name' => $d['patient']->person?->fullName(),
            'found_from' => $d['found_from'], 'has_account' => $d['has_account'], 'id_verified' => $d['patient']->id_verified_at !== null])->values()];
    }

    private function validateForm(Request $request): array
    {
        $data = $request->validate([
            'branch_ref' => ['required', 'string', 'max:50'], 'code' => ['nullable', 'string', 'max:12'], 'channel' => ['nullable', 'in:phone,account'],
            'consent' => ['accepted'],
            'self.first_name' => ['required', 'string', 'max:100'], 'self.last_name' => ['required', 'string', 'max:100'],
            'self.date_of_birth' => ['required', 'date_format:Y-m-d', 'before_or_equal:'.ClinicClock::today(), 'after:1900-01-01'],
            'self.sex' => ['nullable', 'in:Female,Male,Prefer not to say'], 'self.phone' => ['required', 'string', 'max:20'],
            'self.email' => ['nullable', 'email:rfc', 'max:255'], 'self.address' => ['nullable', 'string', 'max:255'],
            'self.emergency_contact.name' => ['required', 'string', 'max:120'], 'self.emergency_contact.phone' => ['required', 'string', 'max:20'],
            'dependents' => ['sometimes', 'array', 'max:6'],
            'dependents.*.first_name' => ['required', 'string', 'max:100'], 'dependents.*.last_name' => ['required', 'string', 'max:100'],
            'dependents.*.date_of_birth' => ['required', 'date_format:Y-m-d', 'before_or_equal:'.ClinicClock::today()],
            'dependents.*.sex' => ['nullable', 'in:Female,Male,Prefer not to say'], 'dependents.*.relationship' => ['required', 'string', 'max:40'], 'dependents.*.relationship_other' => ['nullable', 'string', 'max:100'],
            'join_queue' => ['sometimes', 'boolean'], 'visit_for' => ['nullable', 'regex:/^(self|dependent:[0-5])$/'],
            'scan.id_type' => ['nullable', 'in:'.implode(',', array_keys(IntakeService::ID_TYPES))], 'scan.fields' => ['sometimes', 'array'], 'scan.fields.*' => ['string', 'max:30'],
            // An ID image or number is never accepted, even by mistake.
            'id_number' => ['prohibited'], 'id_image' => ['prohibited'], 'image' => ['prohibited'], 'scan.image' => ['prohibited'], 'scan.number' => ['prohibited'],
        ]);
        foreach (['self.phone', 'self.emergency_contact.phone'] as $field) {
            data_set($data, $field, $this->phone(data_get($data, $field), $field));
        }
        if (! empty($data['self']['email'])) $data['self']['email'] = strtolower(trim($data['self']['email']));
        foreach ($data['dependents'] ?? [] as $i => $d) {
            if (strcasecmp(trim((string) ($d['relationship'] ?? '')), 'Other') === 0 && trim((string) ($d['relationship_other'] ?? '')) === '') {
                throw ValidationException::withMessages(["dependents.{$i}.relationship_other" => ['Please specify the relationship.']]);
            }
        }
        if (str_starts_with($data['visit_for'] ?? 'self', 'dependent:') && ! isset($data['dependents'][(int) substr($data['visit_for'], 10)])) {
            throw ValidationException::withMessages(['visit_for' => ['Choose who the visit is for.']]);
        }

        return $data;
    }

    private function validateCorrections(array $c): array
    {
        $v = validator($c, ['first_name' => ['sometimes', 'string', 'max:100'], 'last_name' => ['sometimes', 'string', 'max:100'],
            'date_of_birth' => ['sometimes', 'date_format:Y-m-d'], 'sex' => ['sometimes', 'nullable', 'in:Female,Male,Prefer not to say'],
            'phone' => ['sometimes', 'string', 'max:20'], 'email' => ['sometimes', 'nullable', 'email:rfc'], 'address' => ['sometimes', 'nullable', 'string', 'max:255']])->validate();
        if (isset($v['phone'])) $v['phone'] = $this->phone($v['phone'], 'corrections.phone');

        return $v;
    }

    /** Philippine numbers may be typed locally (0917…); stored in E.164. */
    private function phone(?string $value, string $field): string
    {
        try {
            $util = PhoneNumberUtil::getInstance();
            $parsed = $util->parse((string) $value, 'PH');
            if ($util->isValidNumber($parsed)) return $util->format($parsed, PhoneNumberFormat::E164);
        } catch (NumberParseException) {
        }
        throw ValidationException::withMessages([$field => ['Enter a valid mobile number, for example 0917 123 4567.']]);
    }

    private function requireCode(Branch $branch, ?string $code): void
    {
        if (! JoinCodes::valid($branch, $code)) {
            throw ValidationException::withMessages(['code' => ['Enter today’s code shown at the front desk of this branch.']]);
        }
    }

    private function deviceHash(Request $request): ?string
    {
        $device = substr(preg_replace('/[^A-Za-z0-9-]/', '', (string) $request->header('X-Device-Id')), 0, 64);

        return $device !== '' ? hash('sha256', $device) : null;
    }

    private function branchOrFail(string $ref): Branch
    {
        $branch = Branch::where('legacy_ref', $ref)->where('status', 'Open')->first();
        abort_unless($branch, 404, 'Branch not found.');

        return $branch;
    }

    private function staffBranch(Request $request): Branch
    {
        $user = $request->user();
        $ref = $request->input('branch_ref');
        $query = Branch::where('status', 'Open')->when($ref, fn ($q) => $q->where('legacy_ref', $ref))
            ->when($user->role->value === 'staff', fn ($q) => $q->whereIn('id', UserBranchScope::select('branch_id')->where('user_id', $user->id)));
        $branch = $query->orderBy('id')->first();
        abort_unless($branch, 403, 'Forbidden.');

        return $branch;
    }

    private function assertBranch(Request $request, int $branchId): void
    {
        $user = $request->user();
        abort_if($user->role->value === 'staff' && ! UserBranchScope::where('user_id', $user->id)->where('branch_id', $branchId)->exists(), 403, 'Forbidden.');
    }
}

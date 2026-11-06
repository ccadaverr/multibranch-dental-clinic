<?php

namespace App\Http\Controllers;

use App\Models\DentistProfile;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\User;
use App\Models\UserBranchScope;
use App\Models\Visit;
use App\Services\Audit\AuditService;
use App\Services\Automations\AutomationCatalog;
use App\Services\Intake\Guardianship;
use App\Services\Mail\MailOutbox;
use App\Services\Notifications\NotificationCenter;
use App\Support\ClinicClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * M19 Prescriptions. A Dentist working at the visit's branch (the treating one or another dentist there) writes a prescription for
 * a visit: free-text lines (medicine, dosage, frequency, duration, instructions) and an optional note. No drug list and no
 * interaction checks; the Owner may keep a list of common medicine names for quick selection. Issuing locks it (append-only) and
 * numbers it RX-YYYY-000001 without gaps; a mistake is corrected by voiding it with a reason and issuing a new one.
 * Who sees what: Dentists at the branch everything (drafts included); the branch front desk issued and void ones (view and print,
 * audited); the Owner metadata only; the patient (or their guardian) their own issued and void ones, read-only, with the PDF.
 * Audit entries never contain medicine text, and neither do notices or emails.
 */
class PrescriptionController extends Controller
{
    private const LINE_RULES = ['lines' => ['required', 'array', 'min:1', 'max:20'], 'lines.*.medicine' => ['required', 'string', 'max:200'],
        'lines.*.dosage' => ['nullable', 'string', 'max:120'], 'lines.*.frequency' => ['nullable', 'string', 'max:120'], 'lines.*.duration' => ['nullable', 'string', 'max:120'],
        'lines.*.instructions' => ['nullable', 'string', 'max:500'], 'note' => ['nullable', 'string', 'max:1000']];

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['patient_id' => ['nullable', 'string', 'max:40'], 'status' => ['nullable', 'in:Draft,Issued,Void']]);
        $q = Prescription::with(['patient.person', 'branch', 'dentist.person', 'visit'])->orderByDesc('id')->limit(200)
            ->when($data['patient_id'] ?? null, fn ($q, $p) => $q->whereIn('patient_id', Patient::select('id')->where('public_id', $p)))
            ->when($data['status'] ?? null, fn ($q, $s) => $q->where('status', $s));
        $q = match ($user->role->value) {
            'dentist' => $q->whereIn('branch_id', $this->dentistBranchIds($user)),
            'staff' => $q->whereIn('branch_id', UserBranchScope::select('branch_id')->where('user_id', $user->id))->where('status', '<>', 'Draft'),
            'owner' => $q->where('status', '<>', 'Draft'),
            default => abort(403),
        };

        return response()->json(['data' => $q->get()->map(fn (Prescription $p) => $this->view($p, $user, false))->values()]);
    }

    /** Patient (and guardian): their own issued and void prescriptions, read-only. */
    public function mine(Request $request): JsonResponse
    {
        $ids = Guardianship::patientIdsFor($request->user());
        $rows = Prescription::whereIn('patient_id', $ids)->whereIn('status', ['Issued', 'Void'])->with(['patient.person', 'branch', 'dentist.person', 'lines'])->orderByDesc('issued_at')->get();

        return response()->json(['data' => $rows->map(fn (Prescription $p) => $this->view($p, $request->user(), true))->values()]);
    }

    /** Dentist: visits at their branches in the last 30 days, to write a prescription for (with the allergy reminder). */
    public function visits(Request $request): JsonResponse
    {
        $user = $request->user();
        $from = ClinicClock::addDays(ClinicClock::today(), -30);
        $visits = Visit::whereIn('branch_id', $this->dentistBranchIds($user))->where('clinic_date', '>=', $from)
            ->with(['patient.person', 'branch', 'treatment', 'dentist.person'])->orderByDesc('clinic_date')->orderByDesc('id')->limit(100)->get();

        return response()->json(['data' => $visits->map(fn (Visit $v) => ['id' => $v->public_id, 'date' => substr((string) $v->clinic_date, 0, 10), 'status' => $v->status,
            'patient' => ['id' => $v->patient?->public_id, 'name' => $v->patient?->person?->fullName(), 'age' => Guardianship::age($v->patient?->person?->date_of_birth?->toDateString())],
            'branch' => $v->branch?->name, 'dentist' => $v->dentist ? 'Dr. '.$v->dentist->person?->fullName() : null, 'treatment' => $v->treatment?->public_id])->values(),
            'meta' => ['common_medicines' => $this->commonMedicines(), 'license_no' => $this->me($user)?->rx_license_no,
                // The clinic server does not record allergies yet: say so instead of implying there are none.
                'allergies' => null, 'allergy_notice' => 'No allergies are recorded in the clinic system. Ask the patient before prescribing.']]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['visit_id' => ['required', 'string', 'max:40']] + self::LINE_RULES);
        $visit = Visit::where('public_id', $data['visit_id'])->with('treatment')->firstOrFail();
        $dentist = $this->dentistAt($user, $visit->branch_id);
        $p = DB::transaction(function () use ($user, $visit, $dentist, $data) {
            $p = Prescription::create(['patient_id' => $visit->patient_id, 'branch_id' => $visit->branch_id, 'visit_id' => $visit->id, 'treatment_id' => $visit->treatment?->id,
                'dentist_profile_id' => $dentist->id, 'created_by_user_id' => $user->id, 'status' => 'Draft', 'note' => $data['note'] ?? null]);
            $this->writeLines($p, $data['lines']);
            $this->audit($user, 'prescription.created', $p);

            return $p->fresh(['patient.person', 'branch', 'dentist.person', 'lines']);
        });

        return response()->json(['data' => $this->view($p, $user, true)], 201);
    }

    public function update(Request $request, Prescription $prescription): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['expected_revision' => ['required', 'integer']] + self::LINE_RULES);
        $this->dentistAt($user, $prescription->branch_id);
        $accepted = DB::transaction(function () use ($prescription, $data, $user) {
            $p = Prescription::whereKey($prescription->id)->lockForUpdate()->first();
            if ($p->status !== 'Draft') throw ValidationException::withMessages(['status' => ['An issued prescription cannot be changed. Void it and write a new one.']]);
            if ($p->revision !== (int) $data['expected_revision']) throw ValidationException::withMessages(['expected_revision' => ['This draft changed. Reload it.']]);
            $p->lines()->delete();
            $this->writeLines($p, $data['lines']);
            $p->update(['note' => $data['note'] ?? null, 'revision' => $p->revision + 1]);
            // Materialize the complete accepted response while this row is locked.
            // A post-commit fresh() could adopt a later editor's unreviewed revision.
            return $this->view($p->fresh(['patient.person', 'branch', 'dentist.person', 'lines', 'visit']), $user, true);
        });

        return response()->json(['data' => $accepted]);
    }

    /** Issue: lock it and give it the next number of the year (a locked counter row: concurrent issues never leave a gap). */
    public function issue(Request $request, Prescription $prescription): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['expected_revision' => ['required', 'integer']]);
        $dentist = $this->dentistAt($user, $prescription->branch_id);
        $p = DB::transaction(function () use ($prescription, $data, $user, $dentist) {
            $p = Prescription::whereKey($prescription->id)->lockForUpdate()->first();
            if ($p->status !== 'Draft') throw ValidationException::withMessages(['status' => ['This prescription was already issued.']]);
            if ($p->revision !== (int) $data['expected_revision']) throw ValidationException::withMessages(['expected_revision' => ['This draft changed. Reload it.']]);
            if (! $p->lines()->exists()) throw ValidationException::withMessages(['lines' => ['Add at least one medicine.']]);
            $year = (int) ClinicClock::now()->format('Y');
            DB::table('prescription_counters')->insertOrIgnore(['year' => $year, 'last_number' => 0]);
            $n = DB::table('prescription_counters')->where('year', $year)->lockForUpdate()->value('last_number') + 1;
            DB::table('prescription_counters')->where('year', $year)->update(['last_number' => $n]);
            $p->update(['status' => 'Issued', 'number' => sprintf('RX-%d-%06d', $year, $n), 'issued_at' => now(), 'issued_by_user_id' => $user->id,
                'license_no' => $dentist->rx_license_no, 'revision' => $p->revision + 1]);
            $this->audit($user, 'prescription.issued', $p);
            $p->load(['patient.person', 'branch', 'dentist.person', 'lines']);
            // No patient/guardian notice for an uncommitted or rolled-back
            // issuance, including when this command has an outer transaction.
            DB::afterCommit(function () use ($p, $user) {
                if ($to = $p->patient?->contactUser()) {
                    app(NotificationCenter::class)->staffNotice($to, 'prescription_ready', 'A prescription is ready', 'A prescription from your visit is ready in the portal.', 'visits', $p->public_id, "prescription_ready:{$p->public_id}");
                    try {
                        app(MailOutbox::class)->queue('prescription_ready', "prescription_ready:{$p->public_id}", $p, null, $to, $user);
                    } catch (\Throwable $e) {
                        report($e);
                    }
                }
            });

            return $p;
        });

        return response()->json(['data' => $this->view($p, $user, true)]);
    }

    public function void(Request $request, Prescription $prescription): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:300']]);
        $this->dentistAt($user, $prescription->branch_id);
        $p = DB::transaction(function () use ($prescription, $data, $user) {
            $p = Prescription::whereKey($prescription->id)->lockForUpdate()->first();
            if ($p->status !== 'Issued') throw ValidationException::withMessages(['status' => [$p->status === 'Void' ? 'This prescription is already void.' : 'Only an issued prescription is voided; a draft is just not issued.']]);
            $p->update(['status' => 'Void', 'voided_at' => now(), 'voided_by_user_id' => $user->id, 'void_reason' => $data['reason'], 'revision' => $p->revision + 1]);
            $this->audit($user, 'prescription.voided', $p);

            return $p->load(['patient.person', 'branch', 'dentist.person', 'lines']);
        });

        return response()->json(['data' => $this->view($p, $user, true)]);
    }

    public function show(Request $request, Prescription $prescription): JsonResponse
    {
        $user = $request->user();
        $content = $this->canRead($user, $prescription);
        abort_unless($content || $this->ownerMeta($user, $prescription), 404);
        if ($content && $user->role->value === 'staff') $this->audit($user, 'prescription.viewed', $prescription);

        return response()->json(['data' => $this->view($prescription->load(['patient.person', 'branch', 'dentist.person', 'lines']), $user, $content)]);
    }

    public function pdf(Request $request, Prescription $prescription)
    {
        $user = $request->user();
        abort_unless($this->canRead($user, $prescription) && $prescription->status !== 'Draft', 404);
        $prescription->load(['patient.person', 'branch', 'dentist.person', 'lines']);
        $this->audit($user, 'prescription.downloaded', $prescription);
        $person = $prescription->patient?->person;
        $pdf = app(\App\Services\Billing\BillingDocuments::class)->documentPdf('pdf.prescription', [
            'p' => $prescription, 'branch' => $prescription->branch, 'patientName' => $person?->fullName() ?? 'Patient',
            'age' => Guardianship::age($person?->date_of_birth?->toDateString()), 'date' => ClinicClock::local($prescription->issued_at)->format('F j, Y'),
            'dentistName' => 'Dr. '.($prescription->dentist?->person?->fullName() ?? ''), 'void' => $prescription->status === 'Void',
        ], 'Prescription '.$prescription->number);

        return response($pdf, 200, ['Content-Type' => 'application/pdf', 'Content-Disposition' => 'inline; filename="Prescription-'.$prescription->number.'.pdf"', 'Cache-Control' => 'private, no-store']);
    }

    /** The dentist's own optional license number for prescriptions (never prefilled). */
    public function license(Request $request): JsonResponse
    {
        $data = $request->validate(['rx_license_no' => ['nullable', 'string', 'max:40', 'regex:/^[A-Za-z0-9 .\\/-]*$/']]);
        $me = $this->me($request->user());
        abort_unless($me, 403);
        $me->forceFill(['rx_license_no' => ($data['rx_license_no'] ?? null) ?: null])->save();
        app(AuditService::class)->recordAdministrative('dentist.rx_license_updated', $request->user(), null, ['dentist' => $me->legacy_ref, 'set' => (bool) $me->rx_license_no]);

        return response()->json(['data' => ['rx_license_no' => $me->rx_license_no]]);
    }

    // ---- rules --------------------------------------------------------------------------------------------------------

    private function me(User $user): ?DentistProfile
    {
        return $user->role->value === 'dentist' ? DentistProfile::where('person_id', $user->person_id)->first() : null;
    }

    private function dentistBranchIds(User $user): array
    {
        return $this->me($user)?->branches()->pluck('branches.id')->all() ?? [];
    }

    /** Only a Dentist working at that branch writes, issues or voids. */
    private function dentistAt(User $user, int $branchId): DentistProfile
    {
        $me = $this->me($user);
        abort_unless($me && in_array($branchId, $this->dentistBranchIds($user), true), 403, 'Only a dentist at this branch can write or change prescriptions.');

        return $me;
    }

    private function canRead(User $user, Prescription $p): bool
    {
        return match ($user->role->value) {
            'dentist' => in_array($p->branch_id, $this->dentistBranchIds($user), true),
            'staff' => $p->status !== 'Draft' && UserBranchScope::where('user_id', $user->id)->where('branch_id', $p->branch_id)->exists(),
            'patient' => $p->status !== 'Draft' && in_array($p->patient_id, Guardianship::patientIdsFor($user), true),
            default => false,
        };
    }

    private function ownerMeta(User $user, Prescription $p): bool
    {
        return $user->role->value === 'owner' && $p->status !== 'Draft';
    }

    private function commonMedicines(): array
    {
        return array_values((array) (AutomationCatalog::setting('prescriptions')?->settings['common_medicines'] ?? []));
    }

    private function writeLines(Prescription $p, array $lines): void
    {
        foreach (array_values($lines) as $i => $l) {
            $p->lines()->create(['line_no' => $i + 1, 'medicine' => trim($l['medicine']), 'dosage' => $l['dosage'] ?? null, 'frequency' => $l['frequency'] ?? null,
                'duration' => $l['duration'] ?? null, 'instructions' => $l['instructions'] ?? null]);
        }
    }

    /** Number, patient, branch and line count only: never medicine text, dosage or the note. */
    private function audit(User $actor, string $action, Prescription $p): void
    {
        app(AuditService::class)->recordAdministrative($action, $actor, $p->patient, ['prescription' => $p->public_id, 'number' => $p->number, 'branch' => $p->branch?->legacy_ref,
            'status' => $p->status, 'lines' => $p->lines()->count()]);
    }

    private function view(Prescription $p, User $viewer, bool $content): array
    {
        $out = ['id' => $p->public_id, 'number' => $p->number, 'status' => $p->status, 'issued_at' => $p->issued_at?->toIso8601String(),
            'date' => $p->issued_at ? ClinicClock::local($p->issued_at)->toDateString() : null, 'branch' => $p->branch?->name,
            'dentist' => $p->dentist ? 'Dr. '.$p->dentist->person?->fullName() : null, 'revision' => $p->revision];
        if ($viewer->role->value === 'owner') return $out; // metadata only
        $out += ['patient' => ['id' => $p->patient?->public_id, 'name' => $p->patient?->person?->fullName()], 'visit' => $p->visit?->public_id,
            'voided' => $p->voided_at ? ['at' => $p->voided_at->toIso8601String(), 'reason' => $p->void_reason] : null,
            'can_edit' => $viewer->role->value === 'dentist' && $p->status === 'Draft' && in_array($p->branch_id, $this->dentistBranchIds($viewer), true),
            'can_void' => $viewer->role->value === 'dentist' && $p->status === 'Issued' && in_array($p->branch_id, $this->dentistBranchIds($viewer), true)];
        if ($content) {
            $out += ['note' => $p->note, 'license_no' => $p->license_no, 'lines' => $p->lines->map(fn ($l) => ['medicine' => $l->medicine, 'dosage' => $l->dosage,
                'frequency' => $l->frequency, 'duration' => $l->duration, 'instructions' => $l->instructions])->values()];
        }

        return $out;
    }
}

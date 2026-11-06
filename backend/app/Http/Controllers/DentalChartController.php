<?php

namespace App\Http\Controllers;

use App\Models\Appointment;
use App\Models\DentistProfile;
use App\Models\Patient;
use App\Models\ToothChartEntry;
use App\Models\Treatment;
use App\Models\User;
use App\Models\Visit;
use App\Services\Audit\AuditService;
use App\Services\Automations\AutomationCatalog;
use App\Services\Intake\Guardianship;
use App\Support\ClinicClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * M10 Dental Charts. A Dentist records a finding per tooth (and optional surfaces) from the Owner's status list, with a date, an
 * optional note and an optional treatment link (only a patient the Dentist is caring for: their own appointment or visit, or a
 * handover to them); nothing is ever changed, the current chart is the latest entry per tooth and each
 * tooth's history stays visible. The front desk sees a read-only chart (without notes); the patient (or guardian) a simplified
 * current chart; the Owner no chart content. Teeth are stored in FDI codes; the Owner chooses FDI or Universal labels. The system
 * makes no diagnosis and no suggestion. Writes and front-desk views are audited without notes.
 */
class DentalChartController extends Controller
{
    public const SURFACES = ['M', 'O', 'D', 'B', 'L'];

    public const CATEGORY_BASELINE = 'baseline';
    public const CATEGORY_STRUCTURAL = 'structural';
    public const CATEGORY_PATHOLOGY = 'pathology';
    public const CATEGORY_ABSENT = 'absent';

    public const KNOWN_STATUS_CATEGORIES = [
        'sound' => self::CATEGORY_BASELINE,
        'healthy' => self::CATEGORY_BASELINE,
        'missing' => self::CATEGORY_ABSENT,
        'extracted' => self::CATEGORY_ABSENT,
        'unerupted' => self::CATEGORY_ABSENT,
        'impacted' => self::CATEGORY_ABSENT,
        'crown' => self::CATEGORY_STRUCTURAL,
        'root canal' => self::CATEGORY_STRUCTURAL,
        'implant' => self::CATEGORY_STRUCTURAL,
        'bridge' => self::CATEGORY_STRUCTURAL,
        'veneer' => self::CATEGORY_STRUCTURAL,
        'denture' => self::CATEGORY_STRUCTURAL,
        'caries' => self::CATEGORY_PATHOLOGY,
        'filled' => self::CATEGORY_PATHOLOGY,
        'to monitor' => self::CATEGORY_PATHOLOGY,
        'fracture' => self::CATEGORY_PATHOLOGY,
        'abrasion' => self::CATEGORY_PATHOLOGY,
        'erosion' => self::CATEGORY_PATHOLOGY,
    ];

    /**
     * Categorize a status into: baseline | structural | pathology | absent.
     *
     * Fallback for unknown / custom statuses added by the clinic Owner in automation settings:
     * - If recorded with surfaces: categorized as 'pathology' (surface-specific finding).
     * - If recorded without surfaces: categorized as 'structural' (persists on whole tooth).
     * For clinical safety, custom statuses never default to 'baseline' (which clears surface
     * findings and is excluded from summary) or 'absent' (which blocks surface findings).
     */
    public static function statusCategory(string $status, array $surfaces = []): string
    {
        $normalized = mb_strtolower(trim($status));
        if (isset(self::KNOWN_STATUS_CATEGORIES[$normalized])) {
            return self::KNOWN_STATUS_CATEGORIES[$normalized];
        }

        return ! empty($surfaces) ? self::CATEGORY_PATHOLOGY : self::CATEGORY_STRUCTURAL;
    }

    public function show(Request $request, Patient $patient): JsonResponse
    {
        $user = $request->user();
        $role = $user->role->value;
        abort_unless(match ($role) {
            'dentist' => $this->dentistMayChart($user, $patient),
            'staff' => $user->can('viewProfile', $patient),
            default => false,
        }, $role === 'owner' ? 403 : 404);
        if ($role === 'staff') app(AuditService::class)->recordAdministrative('chart.viewed', $user, $patient, ['patient' => $patient->public_id]);

        return response()->json(['data' => $this->chart($patient, $role === 'dentist', true)]);
    }

    /** Patient (or guardian for a dependent): the simplified current chart, read-only. */
    public function mine(Request $request): JsonResponse
    {
        $data = $request->validate(['patient_id' => ['nullable', 'string', 'max:40']]);
        $user = $request->user();
        $patient = ! empty($data['patient_id']) ? Patient::where('public_id', $data['patient_id'])->firstOrFail() : $user->patient;
        abort_unless($patient && in_array($patient->id, Guardianship::patientIdsFor($user), true), 404);

        return response()->json(['data' => $this->chart($patient, false, false)]);
    }

    public function store(Request $request, Patient $patient): JsonResponse
    {
        $user = $request->user();
        $me = DentistProfile::where('person_id', $user->person_id)->first();
        abort_unless($user->role->value === 'dentist' && $me && $this->dentistMayChart($user, $patient), 403, 'Only a dentist caring for this patient records the chart.');
        $data = $request->validate([
            'tooth' => ['required', 'string', 'regex:/^([1-4][1-8]|[5-8][1-5])$/'],
            'surfaces' => ['nullable', 'array', 'max:5'],
            'surfaces.*' => ['in:'.implode(',', self::SURFACES)],
            'status' => ['required', 'string', 'max:40'],
            'note' => ['nullable', 'string', 'max:1000'],
            'recorded_on' => ['nullable', 'date_format:Y-m-d'],
            'treatment_id' => ['nullable', 'string', 'max:40'],
            'branch_id' => ['nullable', 'integer', 'exists:branches,id'],
            'branch_ref' => ['nullable', 'string', 'exists:branches,legacy_ref'],
        ]);
        $status = collect($this->settings()['statuses'])->first(fn ($s) => mb_strtolower($s) === mb_strtolower(trim($data['status'])));
        if (! $status) throw ValidationException::withMessages(['status' => ['Choose a status from the clinic’s list.']]);
        $on = $data['recorded_on'] ?? ClinicClock::today();
        if ($on > ClinicClock::today()) throw ValidationException::withMessages(['recorded_on' => ['The date cannot be in the future.']]);
        $treatment = null;
        if (! empty($data['treatment_id'])) {
            // Only this patient's treatment that this Dentist performed.
            $treatment = Treatment::where('public_id', $data['treatment_id'])->where('dentist_profile_id', $me->id)->whereHas('visit', fn ($v) => $v->where('patient_id', $patient->id))->first();
            if (! $treatment) throw ValidationException::withMessages(['treatment_id' => ['Link only a treatment of this patient that you performed.']]);
        }
        $branchId = $this->resolveBranchId($me, $patient, $treatment, $data, $on);
        DB::transaction(function () use ($patient, $data, $status, $on, $treatment, $branchId, $me, $user) {
            // This is the only runtime chart-entry writer. Serialize even the first finding (there may be no row to
            // lock) by patient + tooth, without locking unrelated teeth or append-only historical rows. No other
            // runtime writer acquires this advisory lock, and no encounter row lock precedes it here. Hash collisions
            // only add contention; tooth is a validated FDI integer. PostgreSQL releases it on commit or rollback.
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?), ?)', ['dental-chart:'.$patient->id, (int) $data['tooth']]);
            // Read AFTER acquiring the lock: a waiting writer must validate against the preceding committed finding.
            if (! empty($data['surfaces'])) {
                $currentChart = $this->chart($patient, false, false);
                $activeEntries = collect($currentChart['current'])->where('tooth', $data['tooth']);
                $isAbsent = $activeEntries->contains(fn ($e) => self::statusCategory($e['status'], $e['surfaces'] ?? []) === self::CATEGORY_ABSENT);
                if ($isAbsent) {
                    throw ValidationException::withMessages([
                        'status' => ['Tooth is marked Extracted/Missing. Record a whole-tooth status first.'],
                    ]);
                }
            }
            $entry = ToothChartEntry::create(['patient_id' => $patient->id, 'tooth' => $data['tooth'], 'surfaces' => array_values(array_unique($data['surfaces'] ?? [])),
                'status' => $status, 'recorded_on' => $on, 'note' => $data['note'] ?? null, 'treatment_id' => $treatment?->id,
                'branch_id' => $branchId, 'dentist_profile_id' => $me->id, 'created_by_user_id' => $user->id]);
            app(AuditService::class)->recordAdministrative('chart.recorded', $user, $patient, ['entry' => $entry->public_id, 'tooth' => $entry->tooth]); // no status text, no note
        });

        return response()->json(['data' => $this->chart($patient, true, true)], 201);
    }

    // ---- helpers ------------------------------------------------------------------------------------------------------

    /**
     * Resolve the clinic branch for a chart entry:
     * 1. Treatment's visit branch if linked.
     * 2. Explicit branch_id or branch_ref requested (must be among the clinician's authorized branches).
     * 3. Active visit or appointment with this patient on the recorded date.
     * 4. Clinician's single assigned branch.
     * 5. Fails with 422 if ambiguous or unassigned — never writes NULL.
     */
    private function resolveBranchId(DentistProfile $me, Patient $patient, ?Treatment $treatment, array $data, string $on): int
    {
        if ($treatment?->visit?->branch_id) {
            return (int) $treatment->visit->branch_id;
        }

        $branches = $me->branches()->get();

        if (! empty($data['branch_id'])) {
            $reqBranch = $branches->firstWhere('id', (int) $data['branch_id']);
            if (! $reqBranch) {
                throw ValidationException::withMessages(['branch_id' => ['You are not assigned to the specified branch.']]);
            }
            return (int) $reqBranch->id;
        }

        if (! empty($data['branch_ref'])) {
            $reqBranch = $branches->firstWhere('legacy_ref', $data['branch_ref']);
            if (! $reqBranch) {
                throw ValidationException::withMessages(['branch_ref' => ['You are not assigned to the specified branch.']]);
            }
            return (int) $reqBranch->id;
        }

        $encounterBranchId = Visit::where('patient_id', $patient->id)
            ->where('responsible_dentist_profile_id', $me->id)
            ->where('clinic_date', $on)
            ->value('branch_id');

        if (! $encounterBranchId) {
            $encounterBranchId = Appointment::where('patient_id', $patient->id)
                ->where('dentist_profile_id', $me->id)
                ->whereDate('starts_at', $on)
                ->whereNotIn('status', ['Cancelled', 'No-show'])
                ->value('branch_id');
        }

        if ($encounterBranchId && $branches->contains('id', $encounterBranchId)) {
            return (int) $encounterBranchId;
        }

        if ($branches->count() === 1) {
            return (int) $branches->first()->id;
        }

        throw ValidationException::withMessages(['branch_id' => ['Unable to determine clinic branch for this entry. Please select a branch.']]);
    }

    /**
     * Workflow-tied, like every other Dentist access to patient data: the Dentist's own appointment with this patient (not
     * cancelled and not a no-show), a visit they are responsible for, or an open handover addressed to them. Never the whole branch.
     */
    private function dentistMayChart(User $user, Patient $patient): bool
    {
        $me = DentistProfile::where('person_id', $user->person_id)->value('id');
        if (! $me) return false;

        return Appointment::where('patient_id', $patient->id)->where('dentist_profile_id', $me)->whereNotIn('status', ['Cancelled', 'No-show'])->exists()
            || Visit::where('patient_id', $patient->id)->where('responsible_dentist_profile_id', $me)->exists()
            || self::openHandoverTo($me, $patient);
    }

    /** A handover to this Dentist counts for the same Owner-set number of days as everywhere else (from sending or acknowledgement). */
    private static function openHandoverTo(int $dentistId, Patient $patient): bool
    {
        $since = now()->subDays((int) (AutomationCatalog::setting('staffing')?->settings['handover_access_days'] ?? 60))->toIso8601String();

        return \App\Models\PatientHandover::where('patient_id', $patient->id)->where('to_dentist_profile_id', $dentistId)
            ->where(fn ($q) => $q->where(fn ($s) => $s->where('status', 'Sent')->where('created_at', '>', $since))
                ->orWhere(fn ($a) => $a->where('status', 'Acknowledged')->where('acknowledged_at', '>', $since)))->exists();
    }

    private function settings(): array
    {
        return (array) (AutomationCatalog::setting('dental_chart')?->settings ?? ['numbering' => 'fdi', 'statuses' => []]);
    }

    private function chart(Patient $patient, bool $notes, bool $history): array
    {
        $entries = ToothChartEntry::where('patient_id', $patient->id)->with('dentist.person')->orderBy('id')->get();
        $view = fn (ToothChartEntry $e, array $surfaces = []) => [
            'id' => $e->public_id,
            'tooth' => $e->tooth,
            'surfaces' => array_values($surfaces ?: ($e->surfaces ?? [])),
            'status' => $e->status,
            'recorded_on' => substr((string) $e->getRawOriginal('recorded_on'), 0, 10),
            'dentist' => $e->dentist ? 'Dr. '.$e->dentist->person?->fullName() : null,
        ] + ($notes ? ['note' => $e->note] : []);

        // Compute active findings per tooth and per surface:
        // Rule: Whole-Tooth & Surface Finding Precedence
        // 1. Whole-tooth entries (surfaces: []) supersede and clear all prior surface findings on that tooth (activePerSurface = []).
        // 2. The latest whole-tooth entry wins over any prior whole-tooth entry (e.g. Extracted then Healthy/Implant -> latest wins).
        // 3. Newer surface findings (surfaces: [...]) update activePerSurface.
        //    - Structural/monitoring whole-tooth states (Crown, Root canal, Implant, To monitor) remain active alongside surface findings ("on top").
        //    - Baseline whole-tooth states (Healthy, Sound) are superseded when a new surface finding arrives.
        //    - Absent whole-tooth states (Missing, Extracted) cannot receive surface findings (rejected with 422 in store());
        //      any historical absent whole-tooth state is preserved and not silently cleared.
        // 4. Output emits the active whole-tooth entry (if retained) plus all active surface findings.
        // 5. Baseline statuses (Healthy, Sound) are excluded from the findings summary (Healthy != finding).
        $currentEntries = collect();
        foreach ($entries->groupBy('tooth') as $tooth => $toothEntries) {
            $activePerSurface = [];
            $wholeToothEntry = null;

            foreach ($toothEntries as $entry) {
                $entrySurfaces = $entry->surfaces ?? [];
                if (empty($entrySurfaces)) {
                    // Whole-tooth entry clears prior surface findings and replaces prior whole-tooth state
                    $activePerSurface = [];
                    $wholeToothEntry = $entry;
                } else {
                    // Surface-specific entry updates surface findings
                    foreach ($entrySurfaces as $s) {
                        $activePerSurface[$s] = $entry;
                    }
                    // If existing whole-tooth state is baseline (Healthy, Sound), the new surface finding supersedes it.
                    // Absent states (Missing, Extracted) are rejected in store() and never silently cleared here.
                    if ($wholeToothEntry && self::statusCategory($wholeToothEntry->status) === self::CATEGORY_BASELINE) {
                        $wholeToothEntry = null;
                    }
                }
            }

            // Emit active whole-tooth entry if present
            if ($wholeToothEntry) {
                $currentEntries->push($view($wholeToothEntry, []));
            }

            // Emit active surface findings grouped by entry ID
            if (! empty($activePerSurface)) {
                $surfacesByEntryId = [];
                foreach ($activePerSurface as $s => $entry) {
                    $surfacesByEntryId[$entry->id][] = $s;
                }
                foreach ($surfacesByEntryId as $entryId => $activeSurfaces) {
                    $entry = $toothEntries->firstWhere('id', $entryId);
                    if ($entry) {
                        $currentEntries->push($view($entry, $activeSurfaces));
                    }
                }
            }
        }

        $summary = $currentEntries
            ->reject(fn ($e) => self::statusCategory($e['status'], $e['surfaces'] ?? []) === self::CATEGORY_BASELINE)
            ->groupBy('status')
            ->map(fn ($group, $status) => [
            'status' => $status,
            'count' => $group->count(),
            'teeth' => $group->map(fn ($e) => [
                'tooth' => $e['tooth'],
                'surfaces' => $e['surfaces'],
                'recorded_on' => $e['recorded_on'],
                'dentist' => $e['dentist'],
            ] + ($notes && isset($e['note']) ? ['note' => $e['note']] : []))->values(),
        ])->values();

        return [
            'patient' => ['id' => $patient->public_id, 'name' => $patient->person?->fullName()],
            'settings' => $this->settings(),
            'surfaces' => self::SURFACES,
            'current' => $currentEntries->values(),
            'summary' => $summary,
            'history' => $history ? $entries->reverse()->map(fn ($e) => $view($e))->values() : null,
        ];
    }
}

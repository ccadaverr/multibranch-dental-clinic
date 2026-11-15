<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Http\Controllers\Concerns\ReadsIdempotencyKey;
use App\Http\Requests\Treatment\DocumentTreatmentRequest;
use App\Http\Requests\Treatment\TreatmentCommandRequest;
use App\Http\Requests\Treatment\StartTreatmentRequest;
use App\Http\Resources\PatientTreatmentResource;
use App\Http\Resources\TreatmentResource;
use App\Models\Treatment;
use App\Models\Visit;
use App\Services\Treatments\TreatmentService;
use App\Support\ClinicClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

// M5 Treatment API. Controllers only resolve references and authorize; every rule and state change lives in
// TreatmentService's named commands (no generic PATCH). Reads are role-scoped (Treatment::scopeVisibleTo) and projected
// per role (TreatmentResource / PatientTreatmentResource).
class TreatmentController extends Controller
{
    use ReadsIdempotencyKey;

    // Same bounded window as the appointment and Visit lists.
    private const MAX_RANGE_DAYS = 184;

    public function __construct(private readonly TreatmentService $treatments) {}

    public function index(Request $request)
    {
        $validated = $request->validate([
            'date' => ['nullable', 'date_format:Y-m-d', 'prohibits:from,to'],
            'from' => ['nullable', 'date_format:Y-m-d', 'required_with:to'],
            'to' => ['nullable', 'date_format:Y-m-d', 'required_with:from', 'after_or_equal:from'],
            'status' => ['nullable', 'in:In Treatment,Completed'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        [$from, $to] = isset($validated['date']) ? [$validated['date'], $validated['date']] : [$validated['from'] ?? null, $validated['to'] ?? null];
        if (! $from) {
            $from = $to = ClinicClock::today();
        }
        if (ClinicClock::at($from, '00:00')->diffInDays(ClinicClock::at($to, '00:00')) >= self::MAX_RANGE_DAYS) {
            throw ValidationException::withMessages(['to' => 'A date range may cover at most '.self::MAX_RANGE_DAYS.' days.']);
        }
        $query = Treatment::visibleTo($request->user())->with(TreatmentService::RELATIONS)
            ->whereHas('visit', fn ($v) => $v->whereBetween('clinic_date', [$from, $to]))
            ->when($validated['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->orderBy('started_at')->orderBy('id');

        return TreatmentResource::collection($query->paginate($validated['per_page'] ?? 50)->withQueryString());
    }

    public function show(Treatment $treatment): TreatmentResource
    {
        $treatment->load([...TreatmentService::RELATIONS, 'history']);
        Gate::authorize('view', $treatment);

        return new TreatmentResource($treatment);
    }

    /**
     * The signed-in Patient's own COMPLETED Treatments (safe subset), newest first and keyset-paged (per_page 1-100, default 50;
     * cursor = the last Treatment's public id). The Patient comes from the account, never a parameter; an unknown or another
     * Patient's cursor yields the same empty page and reveals nothing.
     */
    public function mine(Request $request)
    {
        $user = $request->user();
        abort_unless($user->role === Role::Patient && $user->patient !== null, 403, 'Forbidden.');
        $v = $request->validate(['patient_id' => ['prohibited'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100'], 'cursor' => ['nullable', 'string', 'size:26']]);
        $per = (int) ($v['per_page'] ?? 50);
        $own = fn ($visit) => $visit->where('patient_id', $user->patient->id);
        $query = Treatment::where('status', 'Completed')->whereHas('visit', $own);
        if (! empty($v['cursor'])) {
            $at = Treatment::where('status', 'Completed')->whereHas('visit', $own)->where('public_id', strtolower($v['cursor']))->first(['completed_at', 'id']);
            // Order is (completed_at desc, id desc); the cursor row is looked up inside the Patient's own set only.
            $query->where(fn ($q) => $at
                ? $q->where('completed_at', '<', $at->completed_at)->orWhere(fn ($t) => $t->where('completed_at', $at->completed_at)->where('id', '<', $at->id))
                : $q->whereRaw('false'));
        }
        $rows = $query->with(['visit', 'dentist.person', 'procedures'])->orderByDesc('completed_at')->orderByDesc('id')->limit($per + 1)->get();
        $page = $rows->take($per)->values();

        return response()->json(['data' => PatientTreatmentResource::collection($page)->resolve($request), 'meta' => ['per_page' => $per, 'next_cursor' => $rows->count() > $per ? $page->last()->public_id : null]]);
    }

    public function forVisit(Request $request, Visit $visit): JsonResponse
    {
        $treatment = $this->treatments->forVisit($request->user(), $visit);
        return response()->json(['data' => (new TreatmentResource($treatment))->resolve($request), 'meta' => ['encounter_readback' => true]])
            ->header('Cache-Control', 'private, no-store');
    }

    public function start(StartTreatmentRequest $request, Visit $visit): JsonResponse
    {
        $visit->load('dentist');
        Gate::authorize('start', [Treatment::class, $visit]);

        return $this->treatments->start($request->user(), $visit, (int) $request->validated('expected_revision'), $this->idempotencyKey($request, true), $this->presenter($request),
            $request->has('queue_id') ? ['queue_id' => $request->validated('queue_id'), 'expected_queue_revision' => (int) $request->validated('expected_queue_revision')] : null);
    }

    public function document(DocumentTreatmentRequest $request, Treatment $treatment): JsonResponse
    {
        $treatment->load(['dentist', 'visit']);
        Gate::authorize('author', $treatment);

        return $this->treatments->document($request->user(), $treatment, (int) $request->validated('expected_revision'), $request->documentation(), $this->idempotencyKey($request, true), $this->presenter($request));
    }

    public function complete(TreatmentCommandRequest $request, Treatment $treatment): JsonResponse
    {
        $treatment->load(['dentist', 'visit']);
        Gate::authorize('author', $treatment);

        return $this->treatments->complete($request->user(), $treatment, (int) $request->validated('expected_revision'), $this->idempotencyKey($request, true), $this->presenter($request));
    }

    private function presenter(Request $request): \Closure
    {
        return fn (Treatment $treatment) => (new TreatmentResource($treatment))->response($request)->getData(true);
    }
}

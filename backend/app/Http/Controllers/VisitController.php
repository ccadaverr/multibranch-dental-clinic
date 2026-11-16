<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ReadsIdempotencyKey;
use App\Http\Requests\Visit\CheckInVisitRequest;
use App\Http\Requests\Visit\WalkInVisitRequest;
use App\Http\Resources\VisitResource;
use App\Models\Appointment;
use App\Models\Branch;
use App\Models\DentistProfile;
use App\Models\Patient;
use App\Models\Service;
use App\Models\Visit;
use App\Models\CommandKey;
use App\Services\Visits\VisitService;
use App\Support\ClinicClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

// M8 Patient Check-In and the shared Visit API. Controllers only resolve references and authorize; every rule and
// state change lives in VisitService's named commands (no generic status PATCH).
class VisitController extends Controller
{
    use ReadsIdempotencyKey;

    private const RELATIONS = ['patient.person', 'branch', 'appointment.service', 'dentist.person', 'requestedService', 'queueEntry'];

    // Same bounded window as the appointment list (about three months back and three ahead), always paginated.
    private const MAX_RANGE_DAYS = 184;

    public function __construct(private readonly VisitService $visits) {}

    public function index(Request $request)
    {
        $validated = $request->validate([
            'date' => ['nullable', 'date_format:Y-m-d', 'prohibits:from,to'],
            'from' => ['nullable', 'date_format:Y-m-d', 'required_with:to'],
            'to' => ['nullable', 'date_format:Y-m-d', 'required_with:from', 'after_or_equal:from'],
            'status' => ['nullable', 'string'],
            'branch_ref' => ['nullable', 'string'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        [$from, $to] = isset($validated['date']) ? [$validated['date'], $validated['date']] : [$validated['from'] ?? null, $validated['to'] ?? null];
        if (! $from) {
            $from = $to = ClinicClock::today();
        }
        if (ClinicClock::at($from, '00:00')->diffInDays(ClinicClock::at($to, '00:00')) >= self::MAX_RANGE_DAYS) {
            throw ValidationException::withMessages(['to' => 'A date range may cover at most '.self::MAX_RANGE_DAYS.' days.']);
        }
        $query = Visit::visibleTo($request->user())->with(self::RELATIONS)
            ->whereBetween('clinic_date', [$from, $to])
            ->when($validated['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->when($validated['branch_ref'] ?? null, fn ($q, $ref) => $q->whereHas('branch', fn ($b) => $b->where('legacy_ref', $ref)))
            ->orderBy('arrived_at')->orderBy('id');

        return VisitResource::collection($query->paginate($validated['per_page'] ?? 50)->withQueryString());
    }

    public function show(Request $request, string $visit): JsonResponse
    {
        // Do not implicitly bind an arbitrary Visit before account/role checks. Missing, malformed and
        // out-of-scope IDs share one non-disclosing response, including when APP_DEBUG is enabled.
        $notFound = response()->json(['message' => 'Visit not found.'], 404)->header('Cache-Control', 'private, no-store');
        if (! Str::isUlid($visit)) {
            return $notFound;
        }

        $actor = $request->user(); // EnsureAccountAccess refreshed this identity; the guard may still cache an old role.
        $current = Visit::visibleTo($actor)->where('public_id', $visit)->first();
        // Recheck policy with that same actor: a branch grant can be revoked after the scoped query.
        if (! $current || Gate::forUser($actor)->denies('view', $current)) {
            return $notFound;
        }

        return (new VisitResource($current->load([...self::RELATIONS, 'history'])))->response()->header('Cache-Control', 'private, no-store');
    }

    /** Original receipt for an exact Visit and the same account, including after reload/new sign-in. */
    public function arrivalReceipt(Request $request, Visit $visit): JsonResponse
    {
        $current = Visit::visibleTo($request->user())->where('public_id', $visit->public_id)->firstOrFail();
        Gate::authorize('view', $current);
        $record = CommandKey::where('user_id', $request->user()->id)->whereIn('command', ['visit.check_in', 'visit.walk_in'])
            ->where('response_body->data->id', $current->public_id)->where('response_status', 201)->firstOrFail();
        $body = $record->response_body;
        abort_unless(data_get($body, 'data.patient.id') === $current->patient->public_id
            && data_get($body, 'data.branch.id') === $current->branch->legacy_ref
            && data_get($body, 'data.appointment.id') === $current->appointment?->public_id, 404);

        return response()->json(['data' => $body, 'meta' => ['historical_receipt' => true]])->header('Cache-Control', 'private, no-store');
    }

    public function checkIn(CheckInVisitRequest $request): JsonResponse
    {
        $appointment = Appointment::where('public_id', $request->validated('appointment_id'))->firstOrFail();
        Gate::authorize('checkIn', [Visit::class, $appointment]);

        return $this->visits->checkInScheduled($request->user(), $appointment, (int) $request->validated('expected_revision'), $this->idempotencyKey($request, true),
            $request->has('id_confirmed') ? $request->boolean('id_confirmed') : null);
    }

    public function walkIn(WalkInVisitRequest $request): JsonResponse
    {
        $branch = Branch::where('legacy_ref', $request->validated('branch_ref'))->firstOrFail();
        Gate::authorize('walkIn', [Visit::class, $branch]);
        $serviceRef = $request->validated('service_ref');
        $dentistRef = $request->validated('dentist_ref');

        return $this->visits->walkIn(
            $request->user(),
            Patient::where('public_id', $request->validated('patient_id'))->firstOrFail(),
            $branch,
            $serviceRef ? Service::where('legacy_ref', $serviceRef)->firstOrFail() : null,
            $dentistRef ? DentistProfile::where('legacy_ref', $dentistRef)->firstOrFail() : null,
            $this->idempotencyKey($request, true),
        );
    }
}

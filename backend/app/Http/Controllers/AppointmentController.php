<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Http\Controllers\Concerns\ReadsIdempotencyKey;
use App\Http\Requests\Appointment\AvailabilityRequest;
use App\Http\Requests\Appointment\CancelAppointmentRequest;
use App\Http\Requests\Appointment\RecommendationRequest;
use App\Http\Requests\Appointment\RescheduleAppointmentRequest;
use App\Http\Requests\Appointment\StoreAppointmentRequest;
use App\Http\Requests\Appointment\TransitionAppointmentRequest;
use App\Http\Resources\AppointmentResource;
use App\Models\Appointment;
use App\Models\Branch;
use App\Models\DentistProfile;
use App\Models\Patient;
use App\Models\Service;
use App\Services\Appointments\AppointmentService;
use App\Services\Billing\BillingDocuments;
use App\Services\Payment\PayMongoService;
use App\Services\Scheduling\SchedulingService;
use App\Services\Scheduling\SlotRequest;
use App\Support\ClinicClock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

// M6 Appointment API. Controllers only resolve references and authorize; every scheduling rule lives in
// SchedulingService and every state change in AppointmentService's named commands.
class AppointmentController extends Controller
{
    use ReadsIdempotencyKey;

    private const RELATIONS = ['patient.person', 'branch', 'service', 'dentist.person'];

    public function __construct(
        private readonly AppointmentService $appointments,
        private readonly SchedulingService $scheduling,
    ) {}

    // Longest clinic-date range one list request may cover (about three months back and three ahead); results stay
    // paginated within it, so there is no unbounded "return everything" request.
    private const MAX_RANGE_DAYS = 184;

    public function index(Request $request)
    {
        $validated = $request->validate([
            'date' => ['nullable', 'date_format:Y-m-d', 'prohibits:from,to'],
            'from' => ['nullable', 'date_format:Y-m-d', 'required_with:to'],
            'to' => ['nullable', 'date_format:Y-m-d', 'required_with:from', 'after_or_equal:from'],
            'status' => ['nullable', 'string'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        [$from, $to] = isset($validated['date']) ? [$validated['date'], $validated['date']] : [$validated['from'] ?? null, $validated['to'] ?? null];
        if ($from && ClinicClock::at($from, '00:00')->diffInDays(ClinicClock::at($to, '00:00')) >= self::MAX_RANGE_DAYS) {
            throw ValidationException::withMessages(['to' => 'A date range may cover at most '.self::MAX_RANGE_DAYS.' days.']);
        }

        $user = $request->user();
        if ($user && $user->role === Role::Patient && $user->patient) {
            $held = Appointment::where('patient_id', $user->patient->id)->where('booking_payment_status', 'held')->get();
            foreach ($held as $h) {
                try {
                    app(PayMongoService::class)->syncSessionForAppointment($h);
                } catch (\Throwable) {}
            }
        }

        $query = Appointment::visibleTo($request->user())->with(self::RELATIONS)
            ->when($validated['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->when($from, fn ($q) => $q->where('starts_at', '>=', SchedulingService::ts(ClinicClock::at($from, '00:00')))
                ->where('starts_at', '<', SchedulingService::ts(ClinicClock::at($to, '00:00')->addDay())))
            ->orderBy('starts_at')->orderBy('id');

        return AppointmentResource::collection($query->paginate($validated['per_page'] ?? 50)->withQueryString());
    }

    public function show(Request $request, Appointment $appointment): AppointmentResource
    {
        Gate::authorize('view', $appointment);

        if ($appointment->booking_payment_status === 'held') {
            try {
                app(PayMongoService::class)->syncSessionForAppointment($appointment);
                $appointment->refresh();
            } catch (\Throwable) {}
        }

        return new AppointmentResource($appointment->load([...self::RELATIONS, 'history']));
    }

    public function receiptPdf(Request $request, Appointment $appointment, BillingDocuments $documents): Response
    {
        Gate::authorize('view', $appointment);
        abort_unless($appointment->booking_payment_status === 'paid' && (float) ($appointment->booking_fee_php ?? 0) > 0, 404);

        return response($documents->bookingDepositPdf($appointment), 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="'.BillingDocuments::bookingDepositFileName($appointment).'"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function store(StoreAppointmentRequest $request): JsonResponse
    {
        $user = $request->user();
        $branch = Branch::where('legacy_ref', $request->validated('branch_ref'))->firstOrFail();
        Gate::authorize('book', [Appointment::class, $branch]);

        $patient = $user->role === Role::Patient
            ? $user->patient
            : Patient::where('public_id', $request->validated('patient_id'))->firstOrFail();
        if ($user->role === Role::Patient && ($for = $request->validated('for_patient_id'))) {
            $dependent = Patient::where('public_id', $for)->first();
            abort_unless(\App\Services\Intake\Guardianship::canActFor($user, $dependent), 403, 'You can book only for yourself or your dependents.');
            $patient = $dependent;
        }
        $dentistRef = $request->validated('dentist_ref');

        return $this->appointments->create(
            $user,
            $patient,
            $branch,
            Service::where('legacy_ref', $request->validated('service_ref'))->firstOrFail(),
            $dentistRef ? DentistProfile::where('legacy_ref', $dentistRef)->firstOrFail() : null,
            $request->safe()->only(['date', 'start_time', 'notes', 'pay_at_clinic', 'consultation_acknowledged', 'followup_task_id', 'followup_expected_revision']),
            $this->idempotencyKey($request, $request->selectsFollowup()),
        );
    }

    public function reschedule(RescheduleAppointmentRequest $request, Appointment $appointment): JsonResponse
    {
        Gate::authorize('reschedule', $appointment);
        $dentistRef = $request->validated('dentist_ref');

        return $this->appointments->reschedule(
            $request->user(),
            $appointment,
            $dentistRef ? DentistProfile::where('legacy_ref', $dentistRef)->firstOrFail() : null,
            $request->safe()->only(['date', 'start_time', 'expected_revision']),
            $this->idempotencyKey($request),
        );
    }

    public function cancel(CancelAppointmentRequest $request, Appointment $appointment): JsonResponse
    {
        Gate::authorize('cancel', $appointment);

        return $this->appointments->cancel($request->user(), $appointment, $request->safe()->only(['expected_revision', 'reason', 'note']), $this->idempotencyKey($request));
    }

    /** Appointment-only lifecycle command: the pre-arrival No-show (see AppointmentService::TRANSITIONS). */
    public function transition(TransitionAppointmentRequest $request, Appointment $appointment, string $command): JsonResponse
    {
        Gate::authorize('transition', [$appointment, $command]);

        return $this->appointments->transition($request->user(), $appointment, $command, $request->safe()->only(['expected_revision']), $this->idempotencyKey($request));
    }

    public function availability(AvailabilityRequest $request): JsonResponse
    {
        $user = $request->user();
        $branch = Branch::where('legacy_ref', $request->validated('branch_ref'))->firstOrFail();
        Gate::authorize('book', [Appointment::class, $branch]);
        $service = Service::where('legacy_ref', $request->validated('service_ref'))->firstOrFail();
        $isPatient = $user->role === Role::Patient;
        $patientId = $request->validated('patient_id');
        $patient = $isPatient ? $this->bookingPatient($request) : ($patientId ? Patient::where('public_id', $patientId)->first() : null);

        $ignore = null;
        if ($publicId = $request->validated('appointment_id')) {
            $ignore = Appointment::where('public_id', $publicId)->firstOrFail();
            Gate::authorize('reschedule', $ignore);
            $patient = $ignore->patient;
        }

        $date = $request->validated('date');
        $base = new SlotRequest($patient, $branch, $service, null, null, null, $isPatient, $ignore?->id, requirePatient: false);
        // A Patient reschedule keeps the same Dentist (AppointmentService::reschedule), so its search is limited to
        // that Dentist; Staff/Owner may move an appointment to any eligible Dentist.
        $dentistRef = $request->validated('dentist_ref');
        $pool = $isPatient && $ignore ? collect([$ignore->dentist])
            : ($dentistRef ? collect([DentistProfile::where('legacy_ref', $dentistRef)->firstOrFail()]) : null);
        $slots = $this->scheduling->slotsOn($base, $date, $pool);

        return response()->json(['data' => [
            'date' => $date,
            'branch' => ['id' => $branch->legacy_ref, 'name' => $branch->name],
            'service' => ['id' => $service->legacy_ref, 'name' => $service->name, 'duration_minutes' => $this->scheduling->duration($branch, $service)],
            'rules' => $this->rules($isPatient),
            'slots' => array_map(fn (array $slot) => $this->slot($slot), $slots),
        ]]);
    }

    public function recommendation(RecommendationRequest $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user->patient !== null, 403, 'Forbidden.');
        $service = Service::where('legacy_ref', $request->validated('service_ref'))->firstOrFail();
        $branchRef = $request->validated('branch_ref');
        $branch = $branchRef ? Branch::where('legacy_ref', $branchRef)->firstOrFail() : null;
        $lat = $request->validated('latitude');
        $lng = $request->validated('longitude');

        $outcome = $this->scheduling->recommend(
            new SlotRequest($this->bookingPatient($request), $branch, $service, null, null, null, true),
            $lat === null ? null : (float) $lat,
            $lng === null ? null : (float) $lng,
        );
        $found = $outcome['recommendation'];

        return response()->json(['data' => [
            'service' => ['id' => $service->legacy_ref, 'name' => $service->name],
            'location_ranking' => $outcome['location_ranking'],
            'eligible_branches' => $outcome['eligible_branches']->map(fn (Branch $b) => [
                'id' => $b->legacy_ref,
                'name' => $b->name,
                'has_coordinates' => $b->latitude !== null && $b->longitude !== null,
            ])->values(),
            'rules' => $this->rules(true),
            // A recommendation reserves nothing; the create command revalidates everything.
            'recommendation' => $found ? [
                'branch' => ['id' => $found['branch']->legacy_ref, 'name' => $found['branch']->name],
                'duration_minutes' => $found['result']->duration,
                'reserved' => false,
            ] + $this->slot($found) : null,
        ]]);
    }

    /**
     * GET /appointments/branch-options?service_ref&latitude&longitude — every Open branch offering the service, with its address,
     * hours, opening days, the earliest bookable slot and (only when the Patient shared a location and the branch has coordinates)
     * the distance. One branch is recommended with a plain reason. The location is used for this calculation only: it is not
     * stored, logged or sent anywhere.
     */
    public function branchOptions(Request $request): JsonResponse
    {
        $data = $request->validate(['service_ref' => ['required', 'string', 'max:50'], 'latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude']]);
        $patient = $this->bookingPatient($request);
        $service = Service::where('legacy_ref', $data['service_ref'])->firstOrFail();
        $lat = isset($data['latitude']) ? (float) $data['latitude'] : null;
        $lng = isset($data['longitude']) ? (float) $data['longitude'] : null;
        [$first, $last] = $this->scheduling->patientWindow();
        $options = $this->scheduling->branchesOffering($service)->map(function (Branch $branch) use ($service, $patient, $lat, $lng, $first, $last) {
            $earliest = $this->earliestSlot($branch, $service, $patient, $first, $last);
            $distance = $lat !== null && $branch->latitude !== null && $branch->longitude !== null
                ? round(SchedulingService::haversineKm($lat, $lng, (float) $branch->latitude, (float) $branch->longitude), 1) : null;

            return ['branch' => $branch, 'earliest' => $earliest, 'distance_km' => $distance];
        });
        $ranked = $options->sortBy(fn ($o) => [$o['earliest'] ? 0 : 1, $o['distance_km'] ?? INF, $o['earliest'] ? $o['earliest']['date'].$o['earliest']['start_time'] : '9999', $o['branch']->id])->values();
        $withLocation = $lat !== null && $ranked->contains(fn ($o) => $o['distance_km'] !== null);
        $recommended = $ranked->first(fn ($o) => $o['earliest'] !== null);
        $when = fn (?array $slot) => $slot ? ClinicClock::at($slot['date'], $slot['start_time'])->format('D M j, g:i A') : null;

        return response()->json(['data' => [
            'service' => ['id' => $service->legacy_ref, 'name' => $service->name],
            'location_used' => $withLocation,
            'window' => ['first_date' => $first, 'last_date' => $last],
            'branches' => $ranked->map(fn ($o) => [
                'id' => $o['branch']->legacy_ref, 'name' => $o['branch']->name, 'address' => $o['branch']->address, 'city' => $o['branch']->city,
                'open_time' => substr((string) $o['branch']->open_time, 0, 5), 'close_time' => substr((string) $o['branch']->close_time, 0, 5),
                'operating_days' => $o['branch']->operating_days, 'weekly_hours' => $o['branch']->weekHours(), 'distance_km' => $o['distance_km'],
                'earliest' => $o['earliest'] ? ['date' => $o['earliest']['date'], 'start_time' => $o['earliest']['start_time'], 'label' => $when($o['earliest'])] : null,
                'recommended' => $recommended !== null && $o['branch']->is($recommended['branch']),
                'reason' => $recommended !== null && $o['branch']->is($recommended['branch'])
                    ? implode(', ', array_filter([$withLocation && $o['distance_km'] !== null ? 'Closest to you' : null, 'earliest slot '.$when($o['earliest'])]))
                    : null,
            ])->values(),
        ]]);
    }

    /** GET /appointments/dentist-options?branch_ref&service_ref — Dentists who can perform the service at the branch. */
    public function dentistOptions(Request $request): JsonResponse
    {
        $data = $request->validate(['branch_ref' => ['required', 'string', 'max:50'], 'service_ref' => ['required', 'string', 'max:50']]);
        $branch = Branch::where('legacy_ref', $data['branch_ref'])->firstOrFail();
        $service = Service::where('legacy_ref', $data['service_ref'])->firstOrFail();

        return response()->json(['data' => $this->scheduling->eligibleDentists($branch, $service)->map(fn (DentistProfile $d) => [
            'id' => $d->legacy_ref, 'name' => $d->person?->fullName(), 'specialty' => $d->specialty,
        ])->values()]);
    }

    /**
     * GET /appointments/calendar?branch_ref&service_ref&dentist_ref&month=YYYY-MM&appointment_id — one month, each day marked
     * closed (the branch does not open that weekday), full (open but no bookable slot), available (with its slot count),
     * past or outside the online booking window. Every count comes from the same rules the booking command enforces.
     */
    public function calendar(Request $request): JsonResponse
    {
        $data = $request->validate(['branch_ref' => ['required', 'string', 'max:50'], 'service_ref' => ['required', 'string', 'max:50'], 'dentist_ref' => ['nullable', 'string', 'max:50'],
            'month' => ['nullable', 'regex:/^\d{4}-\d{2}$/'], 'appointment_id' => ['nullable', 'string', 'max:40']]);
        $user = $request->user();
        $branch = Branch::where('legacy_ref', $data['branch_ref'])->firstOrFail();
        Gate::authorize('book', [Appointment::class, $branch]);
        $service = Service::where('legacy_ref', $data['service_ref'])->firstOrFail();
        $isPatient = $user->role === Role::Patient;
        $ignore = null;
        if (! empty($data['appointment_id'])) {
            $ignore = Appointment::where('public_id', $data['appointment_id'])->firstOrFail();
            Gate::authorize('reschedule', $ignore);
        }
        [$first, $last] = $this->scheduling->patientWindow();
        $month = $data['month'] ?? substr($first, 0, 7);
        $start = \Carbon\CarbonImmutable::createFromFormat('!Y-m-d', $month.'-01', ClinicClock::TIMEZONE);
        $pool = $isPatient && $ignore ? collect([$ignore->dentist])
            : (! empty($data['dentist_ref']) ? collect([DentistProfile::where('legacy_ref', $data['dentist_ref'])->firstOrFail()]) : $this->scheduling->eligibleDentists($branch, $service));
        $patient = $isPatient ? ($ignore?->patient ?? $this->bookingPatient($request)) : null;
        $base = new SlotRequest($patient, $branch, $service, null, null, null, $isPatient, $ignore?->id, requirePatient: false);
        $busy = $pool->isEmpty() ? collect() : $this->scheduling->busyBetween($start, $start->addMonth(), $pool->pluck('id')->all(), $patient?->id, $ignore?->id);
        $today = ClinicClock::today();
        $days = [];
        for ($day = $start; $day->format('Y-m') === $month; $day = $day->addDay()) {
            $date = $day->toDateString();
            if ($date <= $today) { $days[] = ['date' => $date, 'status' => 'past']; continue; }
            if ($isPatient && ($date < $first || $date > $last)) { $days[] = ['date' => $date, 'status' => 'outside']; continue; }
            // F5: an Owner-closed date carries its reason (shown on hover or tap in the booking calendar).
            if (! SchedulingService::openOn($branch, $date)) { $days[] = ['date' => $date, 'status' => 'closed', 'reason' => $branch->closureOn($date)?->reason ?? ($branch->closureOn($date) ? 'Closed' : null)]; continue; }
            // The calendar needs only open or full: the search stops at the first open slot (the time list loads a day's times).
            $open = ! $pool->isEmpty() && $this->scheduling->slotsOn($base, $date, $pool, $busy, limit: 1) !== [];
            // M3/M15: nobody in the pool works that day (day off, leave or no hours) is not "fully booked": a waitlist cannot help.
            // The reason never says why a dentist is away.
            $working = $open || $pool->contains(fn ($d) => $this->scheduling->work()->windows($d, $branch, $date) !== []);
            $days[] = $working ? ['date' => $date, 'status' => $open ? 'available' : 'full']
                : ['date' => $date, 'status' => 'off', 'reason' => $pool->count() === 1 ? 'The dentist is not working this day.' : 'No dentist for this service is working this day.'];
        }

        return response()->json(['data' => [
            'month' => $month, 'today' => $today, 'window' => ['first_date' => $first, 'last_date' => $last],
            'previous_month' => $start->subMonth()->format('Y-m') >= substr($first, 0, 7) ? $start->subMonth()->format('Y-m') : null,
            'next_month' => $start->addMonth()->format('Y-m') <= substr($last, 0, 7) ? $start->addMonth()->format('Y-m') : null,
            'branch' => ['id' => $branch->legacy_ref, 'name' => $branch->name, 'open_time' => substr((string) $branch->open_time, 0, 5),
                'close_time' => substr((string) $branch->close_time, 0, 5), 'operating_days' => $branch->operating_days, 'weekly_hours' => $branch->weekHours()],
            'days' => $days,
        ]]);
    }

    private function bookingPatient(Request $request): Patient
    {
        $data = $request->validate(['for_patient_id' => ['nullable', 'string', 'max:40']]);
        $patient = ! empty($data['for_patient_id']) ? Patient::where('public_id', $data['for_patient_id'])->first() : $request->user()->patient;
        abort_unless(\App\Services\Intake\Guardianship::canActFor($request->user(), $patient), 403, 'Forbidden.');

        return $patient;
    }

    /** Read-only price/capability snapshot; never reserves a slot or contacts the provider. */
    public function bookingOptions(AvailabilityRequest $request): JsonResponse
    {
        $this->bookingPatient($request);
        $branch = Branch::where('legacy_ref', $request->validated('branch_ref'))->firstOrFail();
        Gate::authorize('book', [Appointment::class, $branch]);
        $service = Service::where('legacy_ref', $request->validated('service_ref'))->firstOrFail();
        $bookable = $service->status === 'Active' && ($service->online_booking ?? 'bookable') === 'bookable'
            && $this->scheduling->branchesOffering($service)->contains('id', $branch->id);
        $price = app(\App\Services\Pricing\PriceResolver::class)->resolve($service, $branch, $request->validated('date'));
        $gateway = app(PayMongoService::class);
        $amount = $price->available() ? $price->amount() : null;
        $reason = ! $bookable ? 'service_not_bookable_online' : (! $gateway->isConfigured() ? 'payment_not_configured'
            : ($amount === null ? 'booking_price_unavailable' : (app(\App\Services\Billing\BillingService::class)->centavos($amount) < PayMongoService::MIN_CENTAVOS ? 'amount_too_small' : null)));

        return response()->json(['data' => [
            'branch_ref' => $branch->legacy_ref, 'service_ref' => $service->legacy_ref, 'date' => $request->validated('date'),
            'currency' => 'PHP', 'booking_fee_php' => $amount, 'online_payment_available' => $reason === null,
            'online_payment_unavailable_reason' => $reason, 'payment_methods' => $reason === null ? $gateway->acceptedMethodNames() : [],
            'pay_at_clinic_available' => $bookable, 'hold_minutes' => 15, 'reserves_slot' => false,
        ]]);
    }

    /** The first bookable slot in the Patient window at this branch (one busy query for the whole window). */
    private function earliestSlot(Branch $branch, Service $service, ?Patient $patient, string $first, string $last): ?array
    {
        $pool = $this->scheduling->eligibleDentists($branch, $service);
        if ($pool->isEmpty()) return null;
        $base = new SlotRequest($patient, $branch, $service, null, null, null, true, requirePatient: false);
        $busy = $this->scheduling->busyBetween(ClinicClock::at($first, '00:00'), ClinicClock::at($last, '00:00')->addDay(), $pool->pluck('id')->all(), $patient?->id);
        for ($date = $first; $date <= $last; $date = \Carbon\CarbonImmutable::createFromFormat('!Y-m-d', $date, ClinicClock::TIMEZONE)->addDay()->toDateString()) {
            if ($slots = $this->scheduling->slotsOn($base, $date, $pool, $busy, null, 1)) return $slots[0];
        }

        return null;
    }

    private function slot(array $slot): array
    {
        return [
            'date' => $slot['date'],
            'start_time' => $slot['start_time'],
            'end_time' => ClinicClock::local($slot['result']->endsAt)->format('H:i'),
            'starts_at' => ClinicClock::local($slot['result']->startsAt)->toIso8601String(),
            'ends_at' => ClinicClock::local($slot['result']->endsAt)->toIso8601String(),
            'dentist' => ['id' => $slot['dentist']->legacy_ref, 'name' => $slot['dentist']->person?->fullName()],
        ];
    }

    private function rules(bool $patient): array
    {
        [$first, $last] = $this->scheduling->patientWindow();

        return $patient
            ? ['start_grid_minutes' => SchedulingService::PATIENT_GRID_MINUTES, 'window' => ['first_date' => $first, 'last_date' => $last]]
            : ['start_grid_minutes' => SchedulingService::STAFF_GRID_MINUTES, 'window' => null];
    }
}

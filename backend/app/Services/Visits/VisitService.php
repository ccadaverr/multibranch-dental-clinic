<?php

namespace App\Services\Visits;

use App\Http\Resources\VisitResource;
use App\Models\Appointment;
use App\Models\Branch;
use App\Models\CommandKey;
use App\Models\DentistProfile;
use App\Models\Patient;
use App\Models\Service;
use App\Models\User;
use App\Models\Visit;
use App\Models\VisitHistory;
use App\Services\Appointments\AppointmentService;
use App\Services\Queue\QueueService;
use App\Services\Scheduling\SchedulingService;
use App\Support\ClinicClock;
use App\Support\IdempotentCommand;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;

// M8 Patient Check-In and the shared Visit / Clinical Encounter lifecycle (CONTRACTS.md §3). Every command runs in one
// transaction through the shared idempotency mechanism and appends Visit history:
//   - checkInScheduled: Appointment (Pending/Confirmed, today) -> Checked In AND a new Visit, atomically;
//   - walkIn:           a new Visit with no appointment (never a fake appointment).
// The Visit's clinical progression (In Treatment, Completed) is owned by the M5 Treatment commands, which call
// applyClinical inside their own transaction; there is no standalone Visit start/complete command.
// Lock order is always appointment, then Visit, then queue entry, so concurrent commands cannot deadlock on each other.
// M9: an arrival with a responsible Dentist is queued in the SAME transaction (QueueService::enqueue). M5 treatment start
// Serves the queue entry (QueueService::serve) in the Treatment transaction. The dependency is one-way.
final class VisitService
{
    private const RELATIONS = ['patient.person', 'branch', 'appointment.service', 'dentist.person', 'requestedService', 'queueEntry'];

    private const ATTEMPTS = 3;

    public function __construct(
        private readonly AppointmentService $appointments,
        private readonly SchedulingService $scheduling,
        private readonly QueueService $queue,
    ) {}

    public function checkInScheduled(User $actor, Appointment $appointment, int $expectedRevision, string $key): JsonResponse
    {
        $payload = ['appointment' => $appointment->id, 'expected_revision' => $expectedRevision];

        return $this->idempotent($actor, $key, 'visit.check_in', $payload, function () use ($actor, $appointment, $expectedRevision) {
            $current = Appointment::whereKey($appointment->id)->lockForUpdate()->firstOrFail();
            if (Visit::where('appointment_id', $current->id)->exists()) {
                throw VisitCommandException::visitExists();
            }
            if ($current->revision !== $expectedRevision) {
                throw VisitCommandException::staleAppointment();
            }
            if (! in_array($current->status, ['Pending', 'Confirmed'], true)) {
                throw VisitCommandException::rule('invalid_transition', "An appointment that is {$current->status} cannot be checked in.", 'status');
            }
            // Existing approved rule: only today's appointments (Asia/Manila business date). The earliest-arrival window remains
            // an unresolved clinic policy (P3). Late arrival (R2-07): see the queue entry below.
            if (ClinicClock::local($current->starts_at)->toDateString() !== ClinicClock::today()) {
                throw VisitCommandException::rule('not_today', 'Only today’s appointments can be checked in.', 'status');
            }
            // An online-payment hold is not admission approval. Match the existing appointment-confirmation guard;
            // unpaid pay-at-clinic appointments remain eligible under the existing admission rules.
            if ($current->booking_payment_status === 'held') {
                throw VisitCommandException::rule('booking_payment_pending', 'This booking is awaiting verified payment confirmation.', 'booking_payment_status');
            }
            $this->assertNoActiveVisit($current->patient_id);

            $from = $current->status;
            $current->update(['status' => 'Checked In', 'revision' => $current->revision + 1, 'updated_by_user_id' => $actor->id]);
            $this->appointments->record($current, $actor, 'appointment.checked_in', $from);

            // R2-07: a patient more than the late limit past the start goes to the end of that Dentist's queue (F2 setting).
            $lateSettings = \App\Services\Automations\NoShowDetection::settings();
            $late = $lateSettings !== null && ClinicClock::now()->greaterThan(\Carbon\CarbonImmutable::instance($current->starts_at)->addMinutes((int) $lateSettings['late_minutes']));
            $visit = $this->open($actor, [
                'patient_id' => $current->patient_id,
                'branch_id' => $current->branch_id,
                'appointment_id' => $current->id,
                'source' => 'appointment',
                'responsible_dentist_profile_id' => $current->dentist_profile_id,
            ], $late);

            return [$visit, 201];
        });
    }

    public function walkIn(User $actor, Patient $patient, Branch $branch, ?Service $service, ?DentistProfile $dentist, string $key): JsonResponse
    {
        $payload = ['patient' => $patient->id, 'branch' => $branch->id, 'service' => $service?->id, 'dentist' => $dentist?->id];

        return $this->idempotent($actor, $key, 'visit.walk_in', $payload, function () use ($actor, $patient, $branch, $service, $dentist) {
            $failures = $this->walkInFailures($branch, $service, $dentist);
            if ($failures) {
                throw VisitCommandException::ineligible($failures);
            }
            $this->assertNoActiveVisit($patient->id);

            $visit = $this->open($actor, [
                'patient_id' => $patient->id,
                'branch_id' => $branch->id,
                'appointment_id' => null,
                'source' => 'walk_in',
                'responsible_dentist_profile_id' => $dentist?->id,
                'requested_service_id' => $service?->id,
            ]);

            return [$visit, 201];
        });
    }

    /** Visit clinical progression, applied ONLY by the M5 Treatment commands: [source status, target, Visit event, appointment event]. */
    public const CLINICAL = [
        'In Treatment' => ['Checked In', 'visit.treatment_started', 'appointment.treatment_started'],
        'Completed' => ['In Treatment', 'visit.completed', 'appointment.completed'],
    ];

    /**
     * M5 cascade: moves an already-locked Visit (and its already-locked linked appointment) to In Treatment or Completed,
     * with history. There is no standalone Visit start/complete endpoint any more — the M5 Treatment start/complete
     * commands call this inside their own transaction, after their own checks, so a Visit never enters or leaves
     * treatment without its Treatment (decision Q-T2). The caller has verified the source statuses.
     */
    public function applyClinical(User $actor, Visit $visit, ?Appointment $appointment, string $to): void
    {
        [$from, $visitEvent, $appointmentEvent] = self::CLINICAL[$to];
        $visit->update([
            'status' => $to,
            'revision' => $visit->revision + 1,
            'updated_by_user_id' => $actor->id,
            'closed_at' => $to === 'Completed' ? ClinicClock::now() : null,
        ]);
        $this->history($visit, $actor, $visitEvent, $from);
        if ($appointment) {
            $appointment->update(['status' => $to, 'revision' => $appointment->revision + 1, 'updated_by_user_id' => $actor->id]);
            $this->appointments->record($appointment, $actor, $appointmentEvent, $from);
        }
    }

    /**
     * Walk-in admission checks at the arrival instant (decision D7). Branch open state and hours come from M2 data;
     * the service and Dentist checks mirror SchedulingService eligibility. No Dentist time is reserved and no overlap
     * with appointments is checked — walk-ins do not occupy scheduling time yet.
     *
     * @return list<array{key:string,label:string}>
     */
    private function walkInFailures(Branch $branch, ?Service $service, ?DentistProfile $dentist): array
    {
        $now = ClinicClock::now()->format('H:i');
        $within = fn ($start, $end) => $start !== null && $end !== null && substr((string) $start, 0, 5) <= $now && $now < substr((string) $end, 0, 5);
        $failures = [];
        $fail = function (string $key, string $label) use (&$failures) {
            $failures[] = ['key' => $key, 'label' => $label];
        };

        if ($branch->status !== 'Open') {
            $fail('branch-open', 'The branch is open');
        } elseif (! ($today = $branch->hoursOnDate(ClinicClock::today())) || ! $within($today['open'], $today['close'])) {
            $fail('branch-hours', 'The branch is within its operating hours');
        }
        if ($service) {
            if ($service->status !== 'Active') {
                $fail('service-active', 'The service is active');
            } elseif (! $this->scheduling->branchService($branch, $service)) {
                $fail('branch-service', 'The branch offers this service');
            }
        }
        if ($dentist) {
            if (! $service) {
                $fail('dentist-service', 'Choose the service before assigning a Dentist');
            } elseif (! $this->scheduling->eligibleDentists($branch, $service)->contains('id', $dentist->id)) {
                $fail('dentist-eligible', 'The Dentist works at this branch, is authorized for this service and is available');
            }
            if (! $this->scheduling->work()->workingNow($dentist, $branch)) {
                $fail('dentist-shift', 'The Dentist is working at this branch now (work schedule, not on leave)');
            }
        }

        return $failures;
    }

    private function assertNoActiveVisit(int $patientId): void
    {
        if (Visit::where('patient_id', $patientId)->whereIn('status', Visit::ACTIVE_STATUSES)->exists()) {
            throw VisitCommandException::activeVisitExists();
        }
    }

    private function open(User $actor, array $attributes, bool $late = false): Visit
    {
        $now = ClinicClock::now();
        $visit = Visit::create($attributes + [
            'requested_service_id' => null,
            'status' => 'Checked In',
            'arrived_at' => $now,
            'clinic_date' => $now->toDateString(),
            'revision' => 1,
            'created_by_user_id' => $actor->id,
            'updated_by_user_id' => $actor->id,
        ]);
        $this->history($visit, $actor, 'visit.checked_in', null);
        // M9: a Visit with a responsible Dentist enters that Dentist's queue in this same transaction.
        $this->queue->enqueue($actor, $visit, $late);

        return $visit;
    }

    private function history(Visit $visit, User $actor, string $event, ?string $from): void
    {
        VisitHistory::create([
            'visit_id' => $visit->id,
            'event' => $event,
            'from_status' => $from,
            'to_status' => $visit->status,
            'revision' => $visit->revision,
            'responsible_dentist_profile_id' => $visit->responsible_dentist_profile_id,
            'actor_user_id' => $actor->id,
            'actor_role' => $actor->role->value,
            'occurred_at' => ClinicClock::now(),
        ]);
    }

    private function idempotent(User $actor, ?string $key, string $command, array $payload, Closure $work): JsonResponse
    {
        return IdempotentCommand::run(
            CommandKey::class, $actor, $key, $command, $payload,
            function () use ($work) {
                [$visit, $status] = $work();
                $body = (new VisitResource($visit->fresh(self::RELATIONS)))->response()->getData(true);

                return [$body, $status];
            },
            fn () => VisitCommandException::rule('idempotency_key_reused', 'This Idempotency-Key was already used for a different request.', 'idempotency_key'),
            function (QueryException $e) {
                // The database constraints are the final guard against concurrent duplicates.
                $message = $e->getMessage();
                if (str_contains($message, 'visits_one_per_appointment')) {
                    throw VisitCommandException::visitExists();
                }
                if (str_contains($message, 'visits_one_active_per_patient')) {
                    throw VisitCommandException::activeVisitExists();
                }
                if (in_array($e->getCode(), ['40P01', '40001'], true)) {
                    throw new VisitCommandException(409, 'conflict', 'Another request changed this record at the same time. Reload and try again.');
                }
            },
            self::ATTEMPTS,
        );
    }
}

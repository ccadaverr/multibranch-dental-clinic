<?php

namespace App\Services\Appointments;

use App\Enums\Role;
use App\Http\Resources\AppointmentResource;
use App\Models\Appointment;
use App\Models\AppointmentCommandKey;
use App\Models\AppointmentHistory;
use App\Models\Branch;
use App\Models\DentistProfile;
use App\Models\Patient;
use App\Models\Service;
use App\Models\User;
use App\Services\Scheduling\SchedulingService;
use App\Services\Scheduling\SlotRequest;
use App\Support\ClinicClock;
use App\Support\IdempotentCommand;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;

// M6 named commands: create, reschedule, cancel and the pre-arrival No-show. Each runs in one transaction,
// revalidates through SchedulingService, appends history, and is optionally idempotent. The PostgreSQL exclusion
// constraints are the final guard against concurrent overlapping bookings (SQLSTATE 23P01). Arrival (Check-In) and the
// clinical progression (treatment start/completion) are Visit commands (App\Services\Visits\VisitService), which
// move the linked appointment in the same transaction — there is no second path for them here.
final class AppointmentService
{
    private const RELATIONS = ['patient.person', 'branch', 'service', 'dentist.person'];

    // Competing inserts can deadlock while each checks the exclusion constraint against the other's uncommitted
    // row; PostgreSQL aborts one. Laravel re-runs a deadlocked transaction, and the retry revalidates against the
    // now-committed winner.
    private const ATTEMPTS = 3;

    public function __construct(private readonly SchedulingService $scheduling) {}

    public function create(User $actor, Patient $patient, Branch $branch, Service $service, ?DentistProfile $dentist, array $input, ?string $key): JsonResponse
    {
        $payload = ['patient' => $patient->id, 'branch' => $branch->id, 'service' => $service->id, 'dentist' => $dentist?->id] + $input;

        return $this->idempotent($actor, $key, 'appointment.create', $payload, function () use ($actor, $patient, $branch, $service, $dentist, $input) {
            $isPatient = $actor->role === Role::Patient;
            // F7 (R2-17): a consultation-first or hidden service is not booked online; the front desk still can.
            if ($isPatient && ($service->online_booking ?? 'bookable') !== 'bookable') {
                throw AppointmentCommandException::rule('service_not_bookable_online', $service->online_booking === 'consultation_first'
                    ? 'This service starts with a consultation. Please book the consultation instead.' : 'This service cannot be booked online. Please message the front desk.', 'service_ref');
            }
            if (! $isPatient && ($service->online_booking ?? 'bookable') === 'consultation_first' && empty($input['consultation_acknowledged'])) {
                throw AppointmentCommandException::rule('consultation_acknowledgement_required', 'This service requires preliminary consultation or clinical authorization acknowledgement.', 'consultation_acknowledged');
            }
            $request = new SlotRequest($patient, $branch, $service, $dentist, $input['date'], $input['start_time'], $isPatient);

            if ($dentist) {
                $result = $this->scheduling->evaluate($request);
                $method = 'selected';
            } else {
                $choice = $this->scheduling->assignDentist($request);
                $result = $choice['result'] ?? null;
                $dentist = $choice['dentist'] ?? null;
                $method = 'auto';
            }
            if (! $result?->valid) {
                $failures = $this->scheduling->evaluate($request)->failures();
                if (! $dentist) {
                    $failures = array_values(array_filter($failures, fn ($f) => ! str_starts_with($f['key'], 'dentist') && $f['key'] !== 'overlap'));
                    $failures[] = ['key' => 'dentist-assignment', 'label' => 'No Dentist is available for this service, branch and time'];
                }
                throw AppointmentCommandException::invalidSchedule($failures, $this->alternatives($request, $dentist));
            }

            $targetService = $service;
            if ($service->online_booking === 'consultation_first' && $service->consultation_service_id) {
                $targetService = Service::find($service->consultation_service_id) ?? $service;
            }
            $resolved = app(\App\Services\Pricing\PriceResolver::class)->resolve($targetService, $branch, $result->startsAt->toDateString());
            $fee = ($resolved instanceof \App\Services\Pricing\ResolvedPrice)
                ? $resolved->amount()
                : null;

            $payMongo = app(\App\Services\Payment\PayMongoService::class);
            // An explicit online choice must never silently become an unpaid booking. Omitted legacy choices retain compatibility.
            if ($isPatient && array_key_exists('pay_at_clinic', $input) && $input['pay_at_clinic'] !== null
                && ! $input['pay_at_clinic'] && ! $payMongo->isConfigured()) {
                throw AppointmentCommandException::rule('payment_not_configured', 'Online payment is unavailable. Please choose pay at clinic or contact the clinic.', 'pay_at_clinic');
            }
            $payOnline = $isPatient && $payMongo->isConfigured() && empty($input['pay_at_clinic']);
            if ($payOnline && $fee === null) {
                throw AppointmentCommandException::rule('booking_price_unavailable', 'Online payment is unavailable because no confirmed booking price applies. Please contact the clinic or choose pay at clinic.', 'service_ref');
            }

            $appointment = Appointment::create([
                'patient_id' => $patient->id,
                'branch_id' => $branch->id,
                'service_id' => $service->id,
                'dentist_profile_id' => $dentist->id,
                'starts_at' => $result->startsAt,
                'ends_at' => $result->endsAt,
                'duration_minutes' => $result->duration,
                'booking_fee_php' => $isPatient ? $fee : null,
                'booking_payment_status' => $payOnline ? 'held' : 'unpaid',
                'booking_hold_expires_at' => $payOnline ? ClinicClock::now()->addMinutes(15) : null,
                // F4: a patient over the late-cancellation/no-show limit books as Pending until the front desk confirms.
                // Online payment holds the slot as Pending until the server verifies payment with the provider.
                'status' => $payOnline || ($isPatient && \App\Services\Automations\AttendancePolicy::needsConfirmation($patient)) ? 'Pending' : 'Confirmed',
                'source' => $isPatient ? 'patient_portal' : 'front_desk',
                'assignment_method' => $method,
                'assignment_rule_version' => $method === 'auto' ? SchedulingService::RULE_VERSION : null,
                'revision' => 1,
                'notes' => $input['notes'] ?? null,
                'created_by_user_id' => $actor->id,
                'updated_by_user_id' => $actor->id,
            ]);
            $this->record($appointment, $actor, 'appointment.created', null);
            if (! $isPatient && ($service->online_booking ?? 'bookable') === 'consultation_first') {
                app(\App\Services\Audit\AuditService::class)->recordClinical('appointment.consultation_authorized', $actor, $appointment, [
                    'service_id' => $service->id,
                    'staff_id' => $actor->id,
                ]);
            }

            if ($payOnline) {
                $checkout = $payMongo->createAppointmentCheckoutSession($appointment, $actor);
                $appointment->checkout_url = $checkout['checkout_url'] ?? null;
                $appointment->checkout_session_id = $checkout['checkout_session_id'] ?? null;
            } else {
                \App\Services\Automations\FillFreedSlots::claimByBooking($appointment);
                \App\Services\Followups\Followups::booked($appointment); // M20: the patient's open follow-up is now Booked
                $this->notifyPatient($appointment, $actor, 'appointment_confirmation');
            }

            return [$appointment, 201];
        });
    }

    public function reschedule(User $actor, Appointment $appointment, ?DentistProfile $dentist, array $input, ?string $key): JsonResponse
    {
        $payload = ['appointment' => $appointment->id, 'dentist' => $dentist?->id] + $input;

        return $this->idempotent($actor, $key, 'appointment.reschedule', $payload, function () use ($actor, $appointment, $dentist, $input) {
            $current = Appointment::whereKey($appointment->id)->lockForUpdate()->firstOrFail();
            if ($current->revision !== (int) $input['expected_revision']) {
                throw AppointmentCommandException::staleRevision();
            }
            if (! in_array($current->status, ['Pending', 'Confirmed'], true)) {
                throw AppointmentCommandException::rule('appointment_not_reschedulable', 'An admitted or closed appointment cannot be rescheduled.', 'status');
            }
            // A Patient changes only the date and time (the Dentist, branch and service stay fixed).
            $isPatient = $actor->role === Role::Patient;
            $dentist = $isPatient || ! $dentist ? $current->dentist : $dentist;
            $request = new SlotRequest($current->patient, $current->branch, $current->service, $dentist, $input['date'], $input['start_time'], $isPatient, $current->id);
            $result = $this->scheduling->evaluate($request);
            if (! $result->valid) {
                throw AppointmentCommandException::invalidSchedule($result->failures(), $this->alternatives($request, $dentist));
            }
            if ($result->startsAt->equalTo($current->starts_at) && $result->endsAt->equalTo($current->ends_at) && $dentist->id === $current->dentist_profile_id) {
                return [$current, 200];
            }

            $from = $current->status;
            $current->update([
                'starts_at' => $result->startsAt,
                'ends_at' => $result->endsAt,
                'duration_minutes' => $result->duration,
                'dentist_profile_id' => $dentist->id,
                // Changing a time is not payment confirmation or clearance of an attendance-policy hold.
                'revision' => $current->revision + 1,
                'updated_by_user_id' => $actor->id,
            ]);
            $this->record($current, $actor, 'appointment.rescheduled', $from);
            \App\Services\Automations\FillFreedSlots::claimByBooking($current);
            $this->notifyPatient($current, $actor, 'appointment_rescheduled');

            return [$current, 200];
        });
    }

    public function cancel(User $actor, Appointment $appointment, array $input, ?string $key): JsonResponse
    {
        $payload = ['appointment' => $appointment->id] + $input;

        return $this->idempotent($actor, $key, 'appointment.cancel', $payload, function () use ($actor, $appointment, $input) {
            $current = Appointment::whereKey($appointment->id)->lockForUpdate()->firstOrFail();
            if ($current->status === 'Cancelled') {
                return [$current, 200];
            }
            if ($current->revision !== (int) $input['expected_revision']) {
                throw AppointmentCommandException::staleRevision();
            }
            // Once the Patient has arrived there is a Visit, and leaving or cancelling after Check-In needs a future
            // Visit/Queue clinic-policy decision (no Visit Cancelled state exists yet), so it is refused here.
            if ($current->status === 'Checked In' || $current->visit()->exists()) {
                throw AppointmentCommandException::rule('appointment_admitted', 'This patient has already checked in. Cancelling after Check-In isn’t available yet — the clinic needs to decide how an admitted visit is closed.', 'status');
            }
            if (! in_array($current->status, ['Pending', 'Confirmed'], true)) {
                throw AppointmentCommandException::rule('appointment_not_cancellable', 'This appointment can no longer be cancelled.', 'status');
            }
            $now = ClinicClock::now();
            if ($actor->role === Role::Patient && $current->starts_at->lessThanOrEqualTo($now)) {
                throw AppointmentCommandException::rule('appointment_started', 'This appointment’s scheduled time has passed, so it can’t be cancelled online. Please contact the clinic for assistance.', 'status');
            }

            $from = $current->status;
            // F4 (R2-13): the Patient's own cancellation less than the policy's hours before the visit is a late cancellation.
            $late = $actor->role === Role::Patient && \App\Services\Automations\AttendancePolicy::isLate(\Carbon\CarbonImmutable::instance($current->starts_at), $now);
            $current->update([
                'status' => 'Cancelled',
                'cancelled_at' => $now,
                'late_cancellation' => $late,
                'revision' => $current->revision + 1,
                'updated_by_user_id' => $actor->id,
            ]);
            $this->record($current, $actor, 'appointment.cancelled', $from);
            if (! empty($input['reason'])) {
                app(\App\Services\Audit\AuditService::class)->recordAdministrative('appointment.cancelled', $actor, $current, [
                    'reason' => $input['reason'],
                    'note' => $input['note'] ?? null,
                ]);
            }
            if ($late) \App\Services\Automations\AttendancePolicy::recordStrike($current->patient);

            // Section 22.3: Booking payment refund handling (>=24h automatic refund via PayMongo; <24h withheld for front-desk decision)
            if ($current->booking_payment_status === 'paid' && $current->booking_payment_ref) {
                $diffHours = $now->diffInHours($current->starts_at, false);
                if ($diffHours >= 24) {
                    try {
                        app(\App\Services\Payment\PayMongoService::class)->refundAppointment($current, 'requested_by_customer');
                    } catch (\Throwable $e) {
                        report($e);
                    }
                } else {
                    $current->update(['booking_payment_status' => 'forfeited']);
                    app(\App\Services\Audit\AuditService::class)->record([
                        'action' => 'billing.booking_refund_withheld_late_cancellation',
                        'category' => 'financial',
                        'severity' => 'info',
                        'actor' => $actor,
                        'target' => $current,
                        'branch_id' => $current->branch_id,
                        'payload' => [
                            'appointment_code' => $current->appointment_code,
                            'fee' => (string) $current->booking_fee_php,
                            'hours_before' => $diffHours,
                        ],
                    ]);
                }
            }

            // F3: the time is free now; it is offered to patients booked later that day, then to the waitlist.
            \App\Services\Automations\FillFreedSlots::open($current, ($input['source'] ?? null) === 'cant_make_it' ? 'cant_make_it' : 'cancelled', $now);
            \App\Services\Followups\Followups::cancelled($current); // M20: its follow-up task is open again
            $this->notifyPatient($current, $actor, 'appointment_cancelled');

            return [$current, 200];
        });
    }

    /**
     * M18 / PI-29: tell the Patient by email that their appointment was booked or changed. Called INSIDE the command's
     * transaction: it writes one durable send intent (unique per appointment revision), so a rolled-back or refused command
     * leaves none and an idempotent replay never re-enters here. The worker sends after commit, records every attempt and
     * retries within its limit; a mail problem never undoes or fails the appointment command.
     */
    private function notifyPatient(Appointment $appointment, User $actor, string $purpose): void
    {
        try {
            app(\App\Services\Mail\MailOutbox::class)->queue($purpose, "$purpose:{$appointment->public_id}:r{$appointment->revision}",
                $appointment, $appointment->revision, $appointment->patient?->contactUser(), $actor);
        } catch (\Throwable $e) {
            report($e); // written inside a savepoint: a failure is reported and the appointment change still commits
        }
        app(\App\Services\Notifications\NotificationCenter::class)->appointment($appointment, $purpose);
    }

    /**
     * Appointment-only lifecycle transitions (CONTRACTS.md): today only the pre-arrival No-show — the scheduled Patient
     * did not arrive, so no Visit exists or is created. It is a manual same-day Staff decision; no lateness threshold
     * is applied (unresolved policy P4). A repeat of an already-applied transition returns the current record unchanged
     * (safe retry); anything else needs the expected revision and an allowed source status.
     */
    public function transition(User $actor, Appointment $appointment, string $command, array $input, ?string $key): JsonResponse
    {
        [$from, $to, $event] = self::TRANSITIONS[$command];
        $payload = ['appointment' => $appointment->id] + $input;

        return $this->idempotent($actor, $key, 'appointment.'.$command, $payload, function () use ($actor, $appointment, $command, $from, $to, $event, $input) {
            $current = Appointment::whereKey($appointment->id)->lockForUpdate()->firstOrFail();
            if ($current->status === $to) {
                return [$current, 200];
            }
            if ($current->revision !== (int) $input['expected_revision']) {
                throw AppointmentCommandException::staleRevision();
            }
            if (! in_array($current->status, $from, true)) {
                throw AppointmentCommandException::rule('invalid_transition', "An appointment that is {$current->status} cannot move to {$to}.", 'status');
            }
            if ($command === 'confirm' && $current->booking_payment_status === 'held') {
                throw AppointmentCommandException::rule('booking_payment_pending', 'This booking is awaiting verified payment confirmation.', 'booking_payment_status');
            }
            if ($command === 'no-show') {
                $this->assertNoShowAllowed($current);
            }

            $previous = $current->status;
            $current->update([
                'status' => $to,
                'revision' => $current->revision + 1,
                'updated_by_user_id' => $actor->id,
            ]);
            $this->record($current, $actor, $event, $previous);
            if ($command === 'no-show') {
                $this->afterNoShow($current);
                if ($current->booking_payment_status === 'paid') {
                    $current->update(['booking_payment_status' => 'forfeited']);
                    app(\App\Services\Audit\AuditService::class)->record([
                        'action' => 'billing.booking_refund_withheld_no_show',
                        'category' => 'financial',
                        'severity' => 'info',
                        'actor' => $actor,
                        'target' => $current,
                        'branch_id' => $current->branch_id,
                        'payload' => [
                            'appointment_code' => $current->appointment_code,
                            'fee' => (string) $current->booking_fee_php,
                        ],
                    ]);
                }
            }

            return [$current, 200];
        });
    }

    /** command => [allowed source statuses, target status, history event] */
    public const TRANSITIONS = [
        'no-show' => [['Pending', 'Confirmed'], 'No-show', 'appointment.no_show'],
        // F4: the front desk confirms an online booking that waited for confirmation.
        'confirm' => [['Pending'], 'Confirmed', 'appointment.confirmed'],
    ];

    private function assertNoShowAllowed(Appointment $current): void
    {
        if ($current->visit()->exists()) {
            throw AppointmentCommandException::rule('appointment_admitted', 'This patient has already checked in, so the appointment can’t be marked No-show.', 'status');
        }
        if (ClinicClock::local($current->starts_at)->toDateString() !== ClinicClock::today()) {
            throw AppointmentCommandException::rule('not_today', 'Only today’s appointments can be marked No-show.', 'status');
        }
    }

    /** A recorded no-show frees the rest of the time (F3) and counts toward the cancellation policy (F4). */
    private function afterNoShow(Appointment $appointment): void
    {
        \App\Services\Automations\FillFreedSlots::open($appointment, 'released');
        \App\Services\Automations\AttendancePolicy::recordStrike($appointment->patient);
    }

    /**
     * F2 (R2-10): the scheduler releases an appointment still not checked in at the release time: it becomes No-show with no
     * person as actor (history actor "system"), and its time is freed. Same rules as the front desk's No-show command.
     */
    public function releaseLate(Appointment $appointment, int $expectedRevision): ?Appointment
    {
        return \Illuminate\Support\Facades\DB::transaction(function () use ($appointment, $expectedRevision) {
            $current = Appointment::whereKey($appointment->id)->lockForUpdate()->firstOrFail();
            if ($current->revision !== $expectedRevision || ! in_array($current->status, ['Pending', 'Confirmed'], true)) return null;
            if ($current->visit()->exists() || ClinicClock::local($current->starts_at)->toDateString() !== ClinicClock::today()) return null;
            $previous = $current->status;
            $current->update(['status' => 'No-show', 'revision' => $current->revision + 1, 'updated_by_user_id' => null]);
            if ($current->booking_payment_status === 'paid') {
                $current->update(['booking_payment_status' => 'forfeited']);
                app(\App\Services\Audit\AuditService::class)->record([
                    'action' => 'billing.booking_refund_withheld_no_show',
                    'category' => 'financial',
                    'severity' => 'info',
                    'actor' => null,
                    'target' => $current,
                    'branch_id' => $current->branch_id,
                    'payload' => [
                        'appointment_code' => $current->appointment_code,
                        'fee' => (string) $current->booking_fee_php,
                        'reason' => 'released_late',
                    ],
                ]);
            }
            $this->record($current, null, 'appointment.no_show_released', $previous);
            $this->afterNoShow($current);

            return $current;
        });
    }

    /**
     * Section 22.3: releases pending appointments held for payment whose 15-minute checkout window expired.
     */
    public function releaseExpiredHolds(): int
    {
        $now = ClinicClock::now();
        $expired = Appointment::where('status', 'Pending')
            ->where('booking_payment_status', 'held')
            ->whereNotNull('booking_hold_expires_at')
            ->where('booking_hold_expires_at', '<=', $now)
            ->get();

        $count = 0;
        foreach ($expired as $appointment) {
            \Illuminate\Support\Facades\DB::transaction(function () use ($appointment, $now) {
                $locked = Appointment::whereKey($appointment->id)->lockForUpdate()->first();
                if (! $locked || $locked->status !== 'Pending' || $locked->booking_payment_status !== 'held') {
                    return;
                }
                if ($locked->booking_hold_expires_at && $locked->booking_hold_expires_at->greaterThan($now)) {
                    return;
                }
                $from = $locked->status;
                $locked->update([
                    'status' => 'Cancelled',
                    'cancelled_at' => $now,
                    'booking_payment_status' => 'unpaid',
                    'revision' => $locked->revision + 1,
                ]);
                $this->record($locked, null, 'appointment.hold_expired', $from);
                \App\Services\Automations\FillFreedSlots::open($locked, 'released', $now);
                $patientUser = $locked->patient?->user ?? ($locked->created_by_user_id ? User::find($locked->created_by_user_id) : null);
                if ($patientUser) {
                    $this->notifyPatient($locked, $patientUser, 'appointment_cancelled');
                }
            });
            $count++;
        }

        return $count;
    }

    /**
     * Section 22.3: Front desk or Owner decides to refund a forfeited or paid booking payment.
     */
    public function refundBookingPayment(User $actor, Appointment $appointment, string $reason): array
    {
        return \Illuminate\Support\Facades\DB::transaction(function () use ($actor, $appointment, $reason) {
            $locked = Appointment::whereKey($appointment->id)->lockForUpdate()->firstOrFail();
            if (! in_array($locked->booking_payment_status, ['paid', 'forfeited'], true)) {
                throw AppointmentCommandException::rule('not_refundable', 'Only paid or forfeited booking payments can be refunded.', 'booking_payment_status');
            }

            $result = app(\App\Services\Payment\PayMongoService::class)->refundAppointment($locked, $reason);
            $this->record($locked, $actor, $result['status'] === 'refunded' ? 'appointment.booking_refunded' : 'appointment.booking_refund_requested', $locked->status);

            return $result;
        });
    }

    /**
     * F2: the front desk undoes a same-day release or No-show (the patient is here after all). Back to Confirmed only if the time
     * is still free: when it was given to another patient, the exclusion constraint refuses and the front desk books anew.
     */
    public function undoNoShow(User $actor, Appointment $appointment, int $expectedRevision): JsonResponse
    {
        return $this->idempotent($actor, null, 'appointment.undo_no_show', ['appointment' => $appointment->id, 'expected_revision' => $expectedRevision], function () use ($actor, $appointment, $expectedRevision) {
            $current = Appointment::whereKey($appointment->id)->lockForUpdate()->firstOrFail();
            if ($current->revision !== $expectedRevision) throw AppointmentCommandException::staleRevision();
            if ($current->status !== 'No-show') throw AppointmentCommandException::rule('invalid_transition', 'Only a No-show can be undone.', 'status');
            if (ClinicClock::local($current->starts_at)->toDateString() !== ClinicClock::today()) {
                throw AppointmentCommandException::rule('not_today', 'A No-show can be undone only on the same day.', 'status');
            }
            $busy = $this->scheduling->busyBetween(\Carbon\CarbonImmutable::instance($current->starts_at), \Carbon\CarbonImmutable::instance($current->ends_at), [$current->dentist_profile_id], $current->patient_id, $current->id);
            if ($busy->isNotEmpty()) {
                throw AppointmentCommandException::rule('time_taken', 'This time was already given to another patient. Check the patient in as a walk-in or book a new time.', 'status');
            }
            \App\Services\Automations\FillFreedSlots::withdraw($current);
            $current->update(['status' => 'Confirmed', 'revision' => $current->revision + 1, 'updated_by_user_id' => $actor->id]);
            $this->record($current, $actor, 'appointment.no_show_undone', 'No-show');

            return [$current, 200];
        });
    }

    /**
     * F3: the patient accepted an earlier time offer. The caller (FillFreedSlots::accept) holds the opening and appointment locks
     * inside its transaction. Validated with the front-desk rules (same-day times are allowed) for the freed Dentist.
     */
    public function moveUp(User $actor, Appointment $current, \App\Models\SlotOpening $opening): Appointment
    {
        $start = ClinicClock::local($opening->starts_at);
        $request = new SlotRequest($current->patient, $current->branch, $current->service, $opening->dentist, $start->toDateString(), $start->format('H:i'), false, $current->id);
        $result = $this->scheduling->evaluate($request);
        if (! $result->valid) throw AppointmentCommandException::invalidSchedule($result->failures());
        if ($result->endsAt->greaterThan($opening->ends_at)) throw AppointmentCommandException::rule('offer_too_short', 'Your visit does not fit in this earlier time.', 'offer');
        $from = $current->status;
        $current->update(['starts_at' => $result->startsAt, 'ends_at' => $result->endsAt, 'duration_minutes' => $result->duration,
            'dentist_profile_id' => $opening->dentist_profile_id, 'revision' => $current->revision + 1, 'updated_by_user_id' => $actor->id]);
        $this->record($current, $actor, 'appointment.moved_up', $from);
        $this->notifyPatient($current, $actor, 'appointment_rescheduled');

        return $current;
    }

    /** Up to five valid start times on the requested date (src/logic.js alternatives). */
    private function alternatives(SlotRequest $request, ?DentistProfile $dentist): array
    {
        if (! ClinicClock::validDate($request->date) || ! $request->branch || ! $request->service) {
            return [];
        }
        $pool = $dentist ? collect([$dentist]) : null;

        return array_map(fn (array $slot) => $slot['start_time'], $this->scheduling->slotsOn($request, $request->date, $pool, null, null, 5));
    }

    /** Appends appointment history; also used by VisitService when a Visit command moves the linked appointment. */
    public function record(Appointment $appointment, ?User $actor, string $event, ?string $from): void
    {
        AppointmentHistory::create([
            'appointment_id' => $appointment->id,
            'event' => $event,
            'from_status' => $from,
            'to_status' => $appointment->status,
            'revision' => $appointment->revision,
            'branch_id' => $appointment->branch_id,
            'dentist_profile_id' => $appointment->dentist_profile_id,
            'starts_at' => $appointment->starts_at,
            'ends_at' => $appointment->ends_at,
            'actor_user_id' => $actor?->id,
            'actor_role' => $actor?->role->value ?? 'system',
            'assignment_rule_version' => $appointment->assignment_rule_version,
            'occurred_at' => ClinicClock::now(),
        ]);
    }

    /** One command per (account, Idempotency-Key) — the shared mechanism in App\Support\IdempotentCommand. */
    private function idempotent(User $actor, ?string $key, string $command, array $payload, Closure $work): JsonResponse
    {
        return IdempotentCommand::run(
            AppointmentCommandKey::class, $actor, $key, $command, $payload,
            function () use ($work) {
                [$appointment, $status] = $work();
                $fresh = $appointment->fresh(array_merge(self::RELATIONS, ['activeCheckoutSession']));
                $fresh->checkout_url = $appointment->checkout_url ?? $fresh->activeCheckoutSession?->checkout_url;
                $fresh->checkout_session_id = $appointment->checkout_session_id ?? $fresh->activeCheckoutSession?->provider_session_id;
                $body = (new AppointmentResource($fresh))->response()->getData(true);

                return [$body, $status, ['appointment_id' => $appointment->id]];
            },
            fn () => AppointmentCommandException::rule('idempotency_key_reused', 'This Idempotency-Key was already used for a different request.', 'idempotency_key'),
            function (QueryException $e) {
                // 23P01 exclusion violation: another request took the time first. 40P01/40001: two competing inserts
                // deadlocked on each other's exclusion check and retries were exhausted — also a lost race.
                if (in_array($e->getCode(), ['23P01', '40P01', '40001'], true)) {
                    throw AppointmentCommandException::conflict();
                }
            },
            self::ATTEMPTS,
        );
    }
}

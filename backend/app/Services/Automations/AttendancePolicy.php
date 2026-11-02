<?php

namespace App\Services\Automations;

use App\Models\Appointment;
use App\Models\Patient;
use App\Models\User;
use App\Services\Audit\AuditService;
use App\Support\ClinicClock;
use Carbon\CarbonImmutable;

/**
 * F4 cancellation policy (recommended; the 24 hours are from R2-13). Patients may cancel or reschedule online anytime so the time
 * can be reused. A Patient's own cancellation less than `late_hours` before the visit is a late cancellation. Late cancellations
 * plus no-shows within `window_months` (counted since Staff last cleared the patient) reaching `limit` mean the patient's next
 * online bookings wait for front-desk confirmation (status Pending) until Staff clear the flag. No fees. A cancellation by the
 * front desk is never counted (it may be the clinic's own change).
 */
final class AttendancePolicy
{
    public static function settings(): ?array
    {
        $row = AutomationCatalog::setting('attendance_policy');

        return $row?->enabled ? $row->settings : null;
    }

    /** True when a Patient cancelling now, for a visit at $startsAt, would be cancelling late. */
    public static function isLate(CarbonImmutable $startsAt, ?CarbonImmutable $now = null): bool
    {
        $s = self::settings();

        return $s !== null && $startsAt->diffInMinutes($now ?? ClinicClock::now(), true) < $s['late_hours'] * 60 && $startsAt->greaterThan($now ?? ClinicClock::now());
    }

    /** Late cancellations and no-shows that count now (within the window, after the last clearance). */
    public static function strikes(Patient $patient, ?CarbonImmutable $now = null): int
    {
        $s = self::settings();
        if ($s === null) return 0;
        $now ??= ClinicClock::now();
        $since = $now->subMonths($s['window_months']);
        if ($patient->attendance_cleared_at && $patient->attendance_cleared_at->greaterThan($since)) $since = CarbonImmutable::instance($patient->attendance_cleared_at);
        $since = $since->toIso8601String();

        return Appointment::where('patient_id', $patient->id)->where(fn ($q) => $q
            ->where(fn ($l) => $l->where('late_cancellation', true)->where('cancelled_at', '>', $since))
            ->orWhere(fn ($n) => $n->where('status', 'No-show')->where('starts_at', '>', $since)))->count();
    }

    /** Called after a late cancellation or a no-show is recorded (inside that command's transaction). */
    public static function recordStrike(Patient $patient): void
    {
        $s = self::settings();
        if ($s === null || $patient->confirmation_required_at) return;
        if (self::strikes($patient) >= $s['limit']) {
            $patient->forceFill(['confirmation_required_at' => now()])->save(); // UTC: patients has no offset date format
        }
    }

    /** The policy in plain words for booking review, the confirmation email and the FAQ; null when switched off. */
    public static function summary(): ?string
    {
        $s = self::settings();
        if ($s === null) return null;

        return "You can cancel or reschedule online anytime, so another patient can use the time. Please cancel at least {$s['late_hours']} hours before your visit: "
            ."later cancellations are recorded as late. After {$s['limit']} late cancellations or missed visits within {$s['window_months']} months, new online bookings "
            .'need the front desk to confirm them. Booking payments and refund eligibility are handled separately.';
    }

    public static function needsConfirmation(?Patient $patient): bool
    {
        return $patient?->confirmation_required_at !== null && self::settings() !== null;
    }

    /** Staff clear the flag; the count starts again from now. */
    public static function clear(Patient $patient, User $actor, string $reason): Patient
    {
        $before = $patient->confirmation_required_at?->toIso8601String();
        $patient->forceFill(['confirmation_required_at' => null, 'attendance_cleared_at' => now()])->save();
        app(AuditService::class)->recordAdministrative('patient.attendance_flag_cleared', $actor, $patient, ['flag_since' => $before, 'reason' => $reason]);

        return $patient;
    }
}

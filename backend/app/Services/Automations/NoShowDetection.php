<?php

namespace App\Services\Automations;

use App\Models\Appointment;
use App\Models\AppointmentResponse;
use App\Models\NoShowFlag;
use App\Models\User;
use App\Services\Appointments\AppointmentService;
use App\Services\Audit\AuditService;
use App\Services\Notifications\NotificationCenter;
use App\Support\ClinicClock;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * F2 late arrivals and no-shows (R2-07, R2-10; replaces the A2 grace period). For TODAY's booked appointments (Asia/Manila) with
 * no check-in, counted from the start time:
 *   + check_minutes   "Are you on your way?" in the app and by email, with "On my way" and "Reschedule" (the reply shows on
 *                     the Check-In page);
 *   + late_minutes    shown as Late on the Check-In page; this flag never changes recorded arrival FIFO.
 *                     Explicit operational queue moves require a current-order review, reason and audit;
 *   + release_minutes automatic (default, R2-10): the appointment becomes No-show, the time is freed and offered (F3), and a
 *                     rebook email is sent; the front desk can undo it the same day. "ask": it is flagged as a possible
 *                     no-show and a person confirms (the existing No-show command) or undoes it — one flag per appointment,
 *                     so nothing is handled twice.
 * A flag whose appointment was checked in, moved or cancelled is cleared by the next run.
 */
final class NoShowDetection implements AutomationJob
{
    public const REBOOK_PURPOSE = 'no_show_rebook';

    public const LATE_PURPOSE = 'late_check';

    public static function lateKey(Appointment $appointment): string
    {
        return self::LATE_PURPOSE.":{$appointment->public_id}:r{$appointment->revision}";
    }

    /** Current settings when the automation is on (also used by check-in and the Check-In page), else null. */
    public static function settings(): ?array
    {
        $row = AutomationCatalog::setting('no_show');

        return $row?->enabled && ! MessageTemplates::unapprovedFor('no_show') ? $row->settings : null;
    }

    public function run(CarbonImmutable $now, array $settings, array $options = []): array
    {
        $counts = ['asked' => 0, 'sent' => 0, 'skipped' => 0, 'flagged' => 0, 'released' => 0, 'cleared' => 0];
        $dayStart = ClinicClock::local($now)->startOfDay();
        $query = Appointment::query()->whereIn('status', ['Pending', 'Confirmed'])->whereDoesntHave('visit')
            ->where('starts_at', '>=', $dayStart->toIso8601String())->where('starts_at', '<=', $now->subMinutes((int) $settings['check_minutes'])->toIso8601String())
            ->whereNotExists(fn ($q) => $q->from('no_show_flags')->whereColumn('no_show_flags.appointment_id', 'appointments.id'))
            ->with(['patient.user', 'patient.person', 'branch'])->orderBy('starts_at');
        if (! empty($options['appointment_id'])) $query->whereKey($options['appointment_id']);
        foreach ($query->get() as $appointment) {
            $late = (int) CarbonImmutable::instance($appointment->starts_at)->diffInMinutes($now, true);
            if ($late >= (int) $settings['release_minutes']) {
                $settings['release_mode'] === 'automatic' ? $this->release($appointment, $now, $settings, $counts) : $this->flag($appointment, $now, $counts);
                continue;
            }
            $this->askOnTheWay($appointment, $counts);
        }
        // The patient arrived late, or the booking changed: the hint is no longer true.
        foreach (NoShowFlag::where('status', 'open')->with('appointment')->get() as $flag) {
            $a = $flag->appointment;
            if (! $a || ! in_array($a->status, ['Pending', 'Confirmed'], true) || $a->revision !== $flag->appointment_revision || $a->visit()->exists()) {
                $flag->update(['status' => 'cleared', 'resolved_at' => $now]);
                $counts['cleared']++;
            }
        }

        return $counts;
    }

    /** + check_minutes: "Are you on your way?" once per appointment revision (in-app always, email when deliverable). */
    private function askOnTheWay(Appointment $appointment, array &$counts): void
    {
        $key = self::lateKey($appointment);
        if (AutomationLog::done($key)) return;
        if (AppointmentResponse::where('appointment_id', $appointment->id)->where('appointment_revision', $appointment->revision)->where('response', 'on_my_way')->exists()) return;
        $counts['asked']++;
        [$user, $reason] = Recipient::patient($appointment->patient);
        if ($user) app(NotificationCenter::class)->lateCheck($appointment, $key);
        if ($reason) {
            if (AutomationLog::skip('no_show', $key, $reason, $appointment, $appointment->branch_id)) $counts['skipped']++;
            AutomationLog::record('no_show', $key, $user ? 'notified' : 'skipped', $user ? null : $reason, $appointment, $appointment->branch_id);

            return;
        }
        if (AutomationLog::queueEmail('no_show', $key, self::LATE_PURPOSE, $appointment, $appointment->revision, $user, $appointment->branch_id)) $counts['sent']++;
    }

    /** "ask" mode: a possible no-show for the front desk to confirm or undo. */
    private function flag(Appointment $appointment, CarbonImmutable $now, array &$counts): void
    {
        $flag = NoShowFlag::firstOrCreate(['appointment_id' => $appointment->id], ['branch_id' => $appointment->branch_id,
            'appointment_revision' => $appointment->revision, 'status' => 'open', 'flagged_at' => $now]);
        if ($flag->wasRecentlyCreated && AutomationLog::record('no_show', "no_show_flag:{$appointment->public_id}", 'flagged', null, $appointment, $appointment->branch_id)) $counts['flagged']++;
    }

    /** "automatic" mode (R2-10): No-show, freed time, rebook email; the flag row records the release for the same-day undo. */
    private function release(Appointment $appointment, CarbonImmutable $now, array $settings, array &$counts): void
    {
        DB::transaction(function () use ($appointment, $now, $settings, &$counts) {
            $released = app(AppointmentService::class)->releaseLate($appointment, $appointment->revision);
            if (! $released) return;
            NoShowFlag::create(['appointment_id' => $released->id, 'branch_id' => $released->branch_id, 'appointment_revision' => $appointment->revision,
                'status' => 'released', 'flagged_at' => $now, 'resolved_at' => $now]);
            AutomationLog::record('no_show', "no_show_released:{$released->public_id}", 'flagged', 'released', $released, $released->branch_id);
            $counts['released']++;
            if ($settings['rebook_email']) $this->rebook($released->fresh(['patient.user', 'patient.person', 'branch']));
        });
    }

    private function rebook(Appointment $appointment): void
    {
        $key = self::REBOOK_PURPOSE.":{$appointment->public_id}";
        [$user, $reason] = Recipient::patient($appointment->patient);
        if ($user) app(NotificationCenter::class)->noShowRebook($appointment, $key);
        $reason ? AutomationLog::skip('no_show', $key, $reason, $appointment, $appointment->branch_id)
            : AutomationLog::queueEmail('no_show', $key, self::REBOOK_PURPOSE, $appointment, $appointment->revision, $user, $appointment->branch_id);
    }

    /** Front desk: confirm the possible no-show through the existing No-show command, then close the flag. */
    public function confirm(NoShowFlag $flag, User $actor): NoShowFlag
    {
        $this->open($flag);
        $appointment = $flag->appointment;
        if ($appointment->revision !== $flag->appointment_revision) throw ValidationException::withMessages(['flag' => ['This appointment changed after it was flagged. Refresh the list.']]);
        $response = app(AppointmentService::class)->transition($actor, $appointment, 'no-show', ['expected_revision' => $appointment->revision], null);
        if ($response->getStatusCode() >= 300) throw ValidationException::withMessages(['flag' => ['The appointment could not be marked No-show.']]);

        return DB::transaction(function () use ($flag, $actor) {
            $flag->update(['status' => 'confirmed', 'resolved_at' => ClinicClock::now(), 'resolved_by_user_id' => $actor->id]);
            $appointment = $flag->appointment->fresh(['patient.user', 'branch']);
            app(AuditService::class)->recordAdministrative('automation.no_show_confirmed', $actor, $appointment, ['automation' => 'no_show']);
            $settings = self::settings();
            if ($settings && $settings['rebook_email']) $this->rebook($appointment);

            return $flag->fresh();
        });
    }

    /** Front desk: the patient did come, or it was a mistake. The appointment is not changed. */
    public function dismiss(NoShowFlag $flag, User $actor): NoShowFlag
    {
        $this->open($flag);
        $flag->update(['status' => 'dismissed', 'resolved_at' => ClinicClock::now(), 'resolved_by_user_id' => $actor->id]);
        app(AuditService::class)->recordAdministrative('automation.no_show_dismissed', $actor, $flag->appointment, ['automation' => 'no_show']);

        return $flag->fresh();
    }

    private function open(NoShowFlag $flag): void
    {
        if ($flag->status !== 'open') throw ValidationException::withMessages(['flag' => ['This flag was already resolved.']]);
    }
}

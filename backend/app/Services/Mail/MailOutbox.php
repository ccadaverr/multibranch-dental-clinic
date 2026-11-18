<?php

namespace App\Services\Mail;

use App\Jobs\SendMailDispatch;
use App\Mail\AppointmentChangedMail;
use App\Mail\AppointmentConfirmationMail;
use App\Mail\PaymentReceiptMail;
use App\Models\Appointment;
use App\Models\MailDispatch;
use App\Models\Receipt;
use App\Models\User;
use Illuminate\Contracts\Mail\Mailable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * M18 durable, retryable email (transactional outbox).
 *
 *  queue()   — called INSIDE the domain transaction: writes one intent row (unique per business event), so the intent commits
 *              or rolls back with the change. A queued job is dispatched after commit.
 *  process() — run by the queue worker (and the due-sweeper): claims the row atomically (so duplicate jobs or two workers
 *              cannot both send), re-renders the message from the authoritative record, sends once, records the attempt, and
 *              either finishes or schedules a bounded retry.
 *
 * Delivery is at-least-once: if a worker dies after the transport accepted a message but before the outcome was saved, the
 * stale claim is retaken after `clinic.mail_processing_timeout_seconds` and the message may be sent again.
 * Only purposes that can be rebuilt from stored records without a secret are queued here; verification codes and invitation
 * links are sent once, immediately (MailDispatcher::send), and the person asks again instead of the system retrying.
 */
class MailOutbox
{
    public const PURPOSES = ['appointment_confirmation', 'appointment_rescheduled', 'appointment_cancelled', 'payment_receipt', 'invoice_issued', 'message_alert',
        // Scheduled automations (App\Services\Automations): re-checked against the record just before sending.
        'appointment_reminder', 'no_show_rebook', 'invoice_overdue', 'recall_due', 'waitlist_opening', 'owner_daily_summary',
        // Interview round 2 (F2, F3, F5).
        'late_check', 'move_up_offer', 'closure_notice',
        // M3/M15: the dentist is no longer available at the visit's time.
        'dentist_unavailable_notice',
        // M15: a leave request to an approver, and the decision back to the requester.
        'leave_requested', 'leave_decided',
        // M19: "a prescription from your visit is ready" (never its content).
        'prescription_ready',
        // M20 optional reminder (approved wording, Owner and Dentist).
        'followup_due'];

    /** Purposes whose wording the Owner approves (F1): an email whose wording lost its approval before sending is not sent. */
    private const APPROVED_WORDING = ['appointment_reminder', 'no_show_rebook', 'invoice_overdue', 'recall_due', 'waitlist_opening', 'owner_daily_summary',
        'late_check', 'move_up_offer', 'closure_notice', 'dentist_unavailable_notice', 'leave_requested', 'leave_decided', 'followup_due'];

    public function __construct(private readonly MailDispatcher $dispatcher) {}

    public static function maxAttempts(): int
    {
        return max(1, (int) config('clinic.mail_max_attempts', 4));
    }

    /** Seconds to wait before attempt n+1 after n failures (last value repeats). */
    public static function backoffAfter(int $failures): int
    {
        $steps = array_values(array_filter((array) config('clinic.mail_retry_backoff_seconds', [60, 300, 900]), 'is_numeric'));
        return (int) ($steps[min(max($failures, 1), count($steps)) - 1] ?? 60);
    }

    public function queue(string $purpose, string $dedupeKey, \Illuminate\Database\Eloquent\Model $subject, ?int $revision, ?User $recipient, ?User $actor): MailDispatch
    {
        if (! in_array($purpose, self::PURPOSES, true)) throw new \InvalidArgumentException("Unsupported queued mail purpose '$purpose'.");
        $attributes = [
            'purpose' => $purpose, 'subject_type' => strtolower(class_basename($subject)), 'subject_public_id' => $subject->public_id ?? null,
            'subject_revision' => $revision, 'recipient_user_id' => $recipient?->id, 'created_by_user_id' => $actor?->id,
            'retryable' => true, 'max_attempts' => self::maxAttempts(), 'status' => 'pending',
        ];
        try {
            $dispatch = DB::transaction(fn () => MailDispatch::firstOrCreate(['dedupe_key' => $dedupeKey], $attributes));
        } catch (QueryException $e) {
            if ($e->getCode() !== '23505') throw $e; // a concurrent writer created the same intent first
            $dispatch = MailDispatch::where('dedupe_key', $dedupeKey)->firstOrFail();
        }
        if ($dispatch->wasRecentlyCreated) SendMailDispatch::dispatch($dispatch->id)->afterCommit();

        return $dispatch;
    }

    /** @return string|null the dispatch status after this run, or null if nothing was claimed (duplicate job, not due, finished). */
    public function process(int $dispatchId): ?string
    {
        $timeout = max(60, (int) config('clinic.mail_processing_timeout_seconds', 600));
        // Instants are bound WITH their offset (timestamptz), never as a zone-less local string.
        $now = now()->toIso8601String();
        $staleBefore = now()->subSeconds($timeout)->toIso8601String();
        $claimed = DB::table('mail_dispatches')->where('id', $dispatchId)->where('retryable', true)
            ->whereColumn('attempts', '<', 'max_attempts')
            ->where(function ($q) use ($now, $staleBefore) {
                $q->where(fn ($due) => $due->whereIn('status', ['pending', 'retry_scheduled'])
                    ->where(fn ($t) => $t->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', $now)))
                  ->orWhere(fn ($stale) => $stale->where('status', 'processing')->where('locked_at', '<', $staleBefore));
            })
            ->update(['status' => 'processing', 'locked_at' => $now, 'updated_at' => $now]);
        if ($claimed !== 1) return null;

        $dispatch = MailDispatch::with(['recipient', 'creator'])->findOrFail($dispatchId);
        $started = now();
        [$mail, $subject, $skip, $email] = $this->render($dispatch);
        if ($skip || ! $email) {
            // Nothing is sent: a newer change superseded this message, or no recipient address exists any more.
            $result = ['status' => 'skipped', 'mailer' => null, 'transport_kind' => null, 'error_class' => null];
            \App\Models\MailDispatchAttempt::create(['mail_dispatch_id' => $dispatch->id, 'attempt_no' => $dispatch->attempts + 1, 'outcome' => 'skipped',
                'started_at' => $started, 'finished_at' => now()]);
            $dispatch->forceFill(['attempts' => $dispatch->attempts + 1, 'status' => $skip ? 'superseded' : 'failed', 'failure_reason' => $skip ? null : 'no_recipient',
                'locked_at' => null, 'next_attempt_at' => null, 'completed_at' => now()])->save();

            return $dispatch->status;
        }
        $result = $this->dispatcher->attempt($email, $mail, $dispatch->purpose);
        $failures = $dispatch->attempts + 1;
        $final = $result['status'] !== 'failed' || $failures >= $dispatch->max_attempts;
        $next = $final ? null : now()->addSeconds(self::backoffAfter($failures));
        $this->dispatcher->record($dispatch, $result, $started, $dispatch->creator, $subject, final: $final, reason: 'retries_exhausted', nextAt: $next);
        if ($next) SendMailDispatch::dispatch($dispatch->id)->delay($next);

        return $dispatch->fresh()->status;
    }

    /** Due intents (pending, retry time reached, or a stale claim), oldest first. Used by `mail:process-due`. */
    public function processDue(int $limit = 50): array
    {
        $timeout = max(60, (int) config('clinic.mail_processing_timeout_seconds', 600));
        $now = now()->toIso8601String();
        $staleBefore = now()->subSeconds($timeout)->toIso8601String();
        $ids = MailDispatch::query()->where('retryable', true)->whereColumn('attempts', '<', 'max_attempts')
            ->where(function ($q) use ($now, $staleBefore) {
                $q->where(fn ($due) => $due->whereIn('status', ['pending', 'retry_scheduled'])
                    ->where(fn ($t) => $t->whereNull('next_attempt_at')->orWhere('next_attempt_at', '<=', $now)))
                  ->orWhere(fn ($stale) => $stale->where('status', 'processing')->where('locked_at', '<', $staleBefore));
            })->orderBy('id')->limit($limit)->pluck('id');
        $results = [];
        foreach ($ids as $id) $results[$id] = $this->process($id);

        return $results;
    }

    /**
     * Re-renders from the authoritative record and resolves the CURRENT address from it (never a stored address).
     * @return array{0:?Mailable,1:mixed,2:bool,3:?string} [mail, audit target, superseded, recipient address]
     */
    private function render(MailDispatch $dispatch): array
    {
        if (in_array($dispatch->purpose, self::APPROVED_WORDING, true) && ! \App\Services\Automations\MessageTemplates::approved($dispatch->purpose)) return [null, null, true, null];
        if ($dispatch->subject_type === 'slotoffer' && $dispatch->purpose === 'move_up_offer') {
            $offer = \App\Models\SlotOffer::where('public_id', $dispatch->subject_public_id)->with(['opening', 'appointment.patient.user', 'appointment.patient.person', 'appointment.branch'])->first();
            // Taken, expired or the appointment changed: the offer is no longer true.
            if (! $offer || $offer->status !== 'offered' || $offer->opening?->status !== 'open' || $offer->opening->starts_at->lessThanOrEqualTo(now())
                || $offer->appointment?->revision !== $offer->appointment_revision) return [null, $offer, true, null];
            [$user, $reason] = \App\Services\Automations\Recipient::patient($offer->appointment->patient);

            return [new \App\Mail\MoveUpOfferMail($offer), $offer->appointment, false, $reason ? null : $user?->email];
        }
        if ($dispatch->subject_type === 'followuptask') {
            // Booked, closed or already has an upcoming appointment by the time the worker runs: no reminder.
            $task = \App\Models\FollowupTask::where('public_id', $dispatch->subject_public_id)->with(['patient.user', 'patient.person', 'branch'])->first();
            if (! $task || ! in_array($task->status, \App\Models\FollowupTask::OPEN, true) || \App\Services\Automations\RecallReminders::hasUpcoming($task->patient_id, \Carbon\CarbonImmutable::now())) return [null, $task, true, null];
            [$user, $reason] = \App\Services\Automations\Recipient::patient($task->patient);

            return [new \App\Mail\FollowupDueMail($task), $task, false, $reason ? null : $user?->email];
        }
        if ($dispatch->subject_type === 'prescription') {
            // Voided before the email went out: nothing to announce. The address is the patient's (or guardian's) current one.
            $p = \App\Models\Prescription::where('public_id', $dispatch->subject_public_id)->with('patient.person')->first();
            if (! $p || $p->status !== 'Issued') return [null, $p, true, null];

            return [new \App\Mail\PrescriptionReadyMail($p->patient?->person?->first_name), $p, false, $p->patient?->contactUser()?->email];
        }
        if ($dispatch->subject_type === 'leaverequest') {
            // A request already decided, or a decision changed again (cancelled), is not emailed. The address is resolved now.
            $leave = \App\Models\LeaveRequest::where('public_id', $dispatch->subject_public_id)->with('requester.person')->first();
            $recipient = $dispatch->recipient;
            if (! $leave || ! $recipient || $recipient->account_status !== 'Active') return [null, $leave, true, null];
            if ($dispatch->purpose === 'leave_requested' && $leave->status !== 'Pending') return [null, $leave, true, null];
            if ($dispatch->purpose === 'leave_decided' && ! in_array($leave->status, ['Approved', 'Declined'], true)) return [null, $leave, true, null];

            return [new \App\Mail\LeaveMail($leave, $dispatch->purpose, $recipient->person?->first_name), $leave, false, $recipient->email];
        }
        if ($dispatch->subject_type === 'appointment') {
            $appointment = Appointment::where('public_id', $dispatch->subject_public_id)->with(['patient.person', 'branch', 'service', 'dentist.person'])->first();
            if (! $appointment) return [null, null, true, null];
            // A later change produced its own message; this older one would show details that are no longer true.
            if ($dispatch->subject_revision !== null && $appointment->revision !== $dispatch->subject_revision) return [null, $appointment, true, null];
            if ($dispatch->purpose === 'appointment_reminder') {
                // Cancelled, checked in, moved (new revision, handled above) or already started: no reminder.
                if (! in_array($appointment->status, ['Pending', 'Confirmed'], true) || $appointment->starts_at->lessThanOrEqualTo(now()) || $appointment->visit()->exists()) return [null, $appointment, true, null];
                [$user, $reason] = \App\Services\Automations\Recipient::patient($appointment->patient);

                return [new \App\Mail\AppointmentReminderMail($appointment, substr(strrchr($dispatch->dedupe_key, ':'), 1) ?: 'lead', $user), $appointment, false, $reason ? null : $user?->email];
            }
            if ($dispatch->purpose === 'late_check') {
                $settings = \App\Services\Automations\NoShowDetection::settings();
                $release = (int) ($settings['release_minutes'] ?? 15);
                // Checked in, cancelled, already answered "On my way", or past the release time: no question.
                if (! in_array($appointment->status, ['Pending', 'Confirmed'], true) || $appointment->visit()->exists()
                    || \App\Models\AppointmentResponse::where('appointment_id', $appointment->id)->where('appointment_revision', $appointment->revision)->where('response', 'on_my_way')->exists()
                    || now()->greaterThanOrEqualTo(\Carbon\CarbonImmutable::instance($appointment->starts_at)->addMinutes($release))) return [null, $appointment, true, null];
                [$user, $reason] = \App\Services\Automations\Recipient::patient($appointment->patient);

                return [new \App\Mail\LateCheckMail($appointment, $release), $appointment, false, $reason ? null : $user?->email];
            }
            if ($dispatch->purpose === 'closure_notice') {
                // Already moved or cancelled, or the closure was removed: no notice.
                $closure = $appointment->branch?->closureOn(\App\Support\ClinicClock::local($appointment->starts_at)->toDateString());
                if (! in_array($appointment->status, ['Pending', 'Confirmed'], true) || ! $closure || $appointment->starts_at->lessThanOrEqualTo(now())) return [null, $appointment, true, null];
                [$user, $reason] = \App\Services\Automations\Recipient::patient($appointment->patient);

                return [new \App\Mail\ClosureNoticeMail($appointment, $closure->reason), $appointment, false, $reason ? null : $user?->email];
            }
            if ($dispatch->purpose === 'dentist_unavailable_notice') {
                // Already moved, cancelled or in the past, or the dentist is available again (schedule restored, leave cancelled): no notice.
                if (! in_array($appointment->status, ['Pending', 'Confirmed'], true) || $appointment->starts_at->lessThanOrEqualTo(now()) || ! $appointment->dentist
                    || ! \App\Services\Scheduling\ScheduleNotices::stillAffected($appointment)) return [null, $appointment, true, null];
                [$user, $reason] = \App\Services\Automations\Recipient::patient($appointment->patient);

                return [new \App\Mail\DentistUnavailableMail($appointment), $appointment, false, $reason ? null : $user?->email];
            }
            if ($dispatch->purpose === 'no_show_rebook') {
                // Already booked again (or the No-show was not kept): the invitation is not needed.
                if ($appointment->status !== 'No-show' || \App\Services\Automations\RecallReminders::hasUpcoming($appointment->patient_id, \Carbon\CarbonImmutable::now())) return [null, $appointment, true, null];
                [$user, $reason] = \App\Services\Automations\Recipient::patient($appointment->patient);

                return [new \App\Mail\NoShowRebookMail($appointment), $appointment, false, $reason ? null : $user?->email];
            }
            $mail = $dispatch->purpose === 'appointment_confirmation'
                ? new AppointmentConfirmationMail($appointment)
                : new AppointmentChangedMail($appointment, $dispatch->purpose === 'appointment_cancelled' ? 'cancelled' : 'rescheduled');

            return [$mail, $appointment, false, $appointment->patient?->contactUser()?->email];
        }
        if ($dispatch->subject_type === 'conversation') {
            // M17 offline alert (no message text). subject_revision is the internal id of the message that triggered it: if the Patient
            // has read up to it (or past it) by the time the worker runs, the alert is no longer needed.
            $conversation = \App\Models\Conversation::where('public_id', $dispatch->subject_public_id)->first();
            $recipient = $dispatch->recipient;
            if (! $conversation || ! $recipient) return [null, null, true, null];
            $read = \App\Models\ConversationParticipant::where('conversation_id', $conversation->id)->where('user_id', $recipient->id)->value('last_read_message_id');
            if ($read !== null && $dispatch->subject_revision !== null && $read >= $dispatch->subject_revision) return [null, $conversation, true, null];

            return [new \App\Mail\MessageAlertMail($recipient->person?->first_name), $conversation, false, $recipient->account_status === 'Active' ? $recipient->email : null];
        }
        if ($dispatch->subject_type === 'receipt') {
            $receipt = Receipt::where('public_id', $dispatch->subject_public_id)->with('invoice.patient.person')->first();
            if (! $receipt) return [null, null, true, null];
            $patient = $receipt->invoice?->patient;

            return [new PaymentReceiptMail($receipt->invoice, $receipt), $receipt->invoice, false, $patient?->contactUser()?->email ?? $patient?->person?->email];
        }
        if ($dispatch->subject_type === 'invoice' && $dispatch->purpose === 'invoice_overdue') {
            $invoice = \App\Models\Invoice::where('public_id', $dispatch->subject_public_id)->with(['patient.person', 'patient.user', 'branch'])->first();
            // Paid, voided or settled before the worker ran: no reminder.
            if (! $invoice || $invoice->status !== 'Issued' || (float) $invoice->balance() <= 0) return [null, $invoice, true, null];
            [$user, $reason] = \App\Services\Automations\Recipient::patient($invoice->patient);

            return [new \App\Mail\InvoiceOverdueMail($invoice), $invoice, false, $reason ? null : $user?->email];
        }
        if ($dispatch->subject_type === 'visit' && $dispatch->purpose === 'recall_due') {
            $visit = \App\Models\Visit::where('public_id', $dispatch->subject_public_id)->with(['patient.user', 'patient.person', 'branch', 'appointment.service', 'requestedService'])->first();
            if (! $visit || \App\Services\Automations\RecallReminders::hasUpcoming($visit->patient_id, \Carbon\CarbonImmutable::now())) return [null, $visit, true, null];
            [$user, $reason] = \App\Services\Automations\Recipient::patient($visit->patient);

            return [new \App\Mail\RecallMail($visit), $visit, false, $reason ? null : $user?->email];
        }
        if ($dispatch->subject_type === 'waitlistentry' && $dispatch->purpose === 'waitlist_opening') {
            $entry = \App\Models\WaitlistEntry::where('public_id', $dispatch->subject_public_id)->with(['patient.user', 'patient.person', 'branch', 'service', 'dentist.person'])->first();
            if (! $entry || $entry->dateString() < \App\Support\ClinicClock::today()) return [null, $entry, true, null];
            [$user, $reason] = \App\Services\Automations\Recipient::patient($entry->patient);

            return [new \App\Mail\WaitlistOpeningMail($entry), $entry, false, $reason ? null : $user?->email];
        }
        if ($dispatch->subject_type === 'user' && $dispatch->purpose === 'owner_daily_summary') {
            $owner = $dispatch->recipient;
            if (! $owner || $owner->account_status !== 'Active' || $owner->deleted_at || ! $dispatch->subject_revision) return [null, $owner, true, null];
            $date = \Carbon\CarbonImmutable::createFromFormat('!Ymd', (string) $dispatch->subject_revision, \App\Support\ClinicClock::TIMEZONE)->toDateString();

            return [new \App\Mail\OwnerDailySummaryMail($owner, $date), null, false, $owner->email];
        }
        if ($dispatch->subject_type === 'invoice') {
            $invoice = \App\Models\Invoice::where('public_id', $dispatch->subject_public_id)->with(['patient.person', 'patient.user', 'branch', 'lines'])->first();
            // Paid (or no longer Issued) before the worker ran: the receipt email covers it, so this invoice email is not needed.
            if (! $invoice || $invoice->status !== 'Issued') return [null, $invoice, true, null];
            $patient = $invoice->patient;

            return [new \App\Mail\InvoiceMail($invoice), $invoice, false, $patient?->contactUser()?->email ?? $patient?->person?->email];
        }

        return [null, null, true, null];
    }
}

<?php

namespace App\Services\Notifications;

use App\Models\Appointment;
use App\Models\Conversation;
use App\Models\Invoice;
use App\Models\Receipt;
use App\Models\User;
use App\Models\UserNotification;
use App\Support\Brand;
use App\Support\ClinicClock;
use Illuminate\Support\Facades\DB;

/**
 * Notifications (identity-specific, CLAUDE.md "Messages != Notifications"): written ONLY when a real server event happens, inside
 * the same transaction, at most once per event (dedupe key). They never carry message text or clinical detail. A failure here is
 * reported and never blocks the booking, payment or message that caused it.
 */
class NotificationCenter
{
    private const APPOINTMENT_KINDS = ['appointment_confirmation' => ['appointment_booked', 'Appointment confirmed'],
        'appointment_rescheduled' => ['appointment_rescheduled', 'Appointment moved'], 'appointment_cancelled' => ['appointment_cancelled', 'Appointment cancelled']];

    public function appointment(Appointment $appointment, string $purpose): void
    {
        [$kind, $title] = self::APPOINTMENT_KINDS[$purpose] ?? [null, null];
        $user = $appointment->patient?->contactUser();
        if (! $kind || ! $user) return;
        $appointment->loadMissing(['service', 'branch']);
        $when = ClinicClock::local($appointment->starts_at)->format('M j, g:i A');
        $this->write($user, $kind, $title, implode(' · ', array_filter([$appointment->service?->name, $when, $appointment->branch?->name])),
            'visits', $appointment->public_id, "$purpose:{$appointment->public_id}:r{$appointment->revision}");
    }

    public function invoiceIssued(Invoice $invoice): void
    {
        $user = $invoice->patient?->contactUser();
        if (! $user) return;
        $this->write($user, 'invoice_issued', "New invoice {$invoice->invoice_number}", 'Amount due '.Brand::money($invoice->balance()), 'billing', $invoice->public_id,
            "invoice_issued:{$invoice->public_id}");
    }

    public function paymentReceived(Invoice $invoice, Receipt $receipt): void
    {
        $user = $invoice->patient?->contactUser();
        if (! $user) return;
        $this->write($user, 'payment_received', 'Payment received', Brand::money($receipt->amount)." for {$invoice->invoice_number} · Receipt {$receipt->receipt_number}",
            'billing', $invoice->public_id, "payment_received:{$receipt->public_id}");
    }

    /** A new message from the clinic: who and where, never what (the text stays in Messages). */
    public function messageReceived(Conversation $conversation, int $messageId): void
    {
        $user = $conversation->patient?->user;
        if (! $user) return;
        $this->write($user, 'message_received', 'New message from the clinic', ($conversation->branch?->name ?? 'The clinic').' front desk replied',
            'messages', $conversation->public_id, "message_received:{$messageId}");
    }

    /** Scheduled automations: written when the automation acts, with the same key as its email (once per event). */
    public function appointmentReminder(Appointment $appointment, string $dedupe): void
    {
        $user = $appointment->patient?->contactUser();
        if (! $user) return;
        $appointment->loadMissing(['service', 'branch']);
        $when = ClinicClock::local($appointment->starts_at)->format('D, M j, g:i A');
        $this->write($user, 'appointment_reminder', 'Upcoming visit reminder', implode(' · ', array_filter([$when, $appointment->branch?->name])), 'visits', $appointment->public_id, $dedupe);
    }

    public function noShowRebook(Appointment $appointment, string $dedupe): void
    {
        $user = $appointment->patient?->contactUser();
        if (! $user) return;
        $this->write($user, 'no_show_rebook', 'We missed you', 'Book a new time that suits you', 'book', $appointment->public_id, $dedupe);
    }

    public function invoiceOverdue(Invoice $invoice, string $dedupe): void
    {
        $user = $invoice->patient?->contactUser();
        if (! $user) return;
        $this->write($user, 'invoice_overdue', "Invoice {$invoice->invoice_number} is still unpaid", 'Balance '.Brand::money($invoice->balance()), 'billing', $invoice->public_id, $dedupe);
    }

    public function recallDue(\App\Models\Visit $visit, string $category, string $dedupe): void
    {
        $user = $visit->patient?->contactUser();
        if (! $user) return;
        $this->write($user, 'recall_due', 'Time for your check-up', 'Book your next visit when it suits you', 'book', null, $dedupe);
    }

    /** M20: a follow-up is due (no reason or clinical text). */
    public function followupDue(\App\Models\FollowupTask $task, string $dedupe): void
    {
        $user = $task->patient?->contactUser();
        if (! $user) return;
        $this->write($user, 'followup_due', 'Time to book your follow-up visit', 'Your dentist asked to see you again. Book when it suits you.', 'book', null, $dedupe);
    }

    public function waitlistOpening(\App\Models\WaitlistEntry $entry, string $dedupe): void
    {
        $user = $entry->patient?->contactUser();
        if (! $user) return;
        $entry->loadMissing(['branch', 'service']);
        $day = \Carbon\CarbonImmutable::createFromFormat('!Y-m-d', $entry->dateString(), ClinicClock::TIMEZONE)->format('D, M j');
        $this->write($user, 'waitlist_opening', 'A time opened on '.$day, implode(' · ', array_filter([$entry->service?->name, $entry->branch?->name, 'first come, first served'])), 'book', null, $dedupe);
    }

    /** F2: "Are you on your way?" — the visit page shows the "On my way" and "Reschedule" buttons. */
    public function lateCheck(Appointment $appointment, string $dedupe): void
    {
        $user = $appointment->patient?->contactUser();
        if (! $user) return;
        $appointment->loadMissing('branch');
        $this->write($user, 'late_check', 'Are you on your way?', 'Your visit was at '.ClinicClock::local($appointment->starts_at)->format('g:i A').' · '.($appointment->branch?->name ?? 'the clinic'),
            'visits', $appointment->public_id, $dedupe);
    }

    /** F3: "An earlier time is available" — accepted from My visits or the email link. */
    public function moveUpOffer(\App\Models\SlotOffer $offer, string $dedupe): void
    {
        $appointment = $offer->appointment;
        $user = $appointment?->patient?->user;
        if (! $user) return;
        $appointment->loadMissing('branch');
        $this->write($user, 'move_up_offer', 'An earlier time is available', ClinicClock::local($offer->opening->starts_at)->format('D, M j, g:i A').' instead of '.ClinicClock::local($appointment->starts_at)->format('g:i A').' · first to accept gets it',
            'visits', $appointment->public_id, $dedupe);
    }

    /** F5: the branch closed a date that has this appointment (it was not cancelled). */
    public function closureNotice(Appointment $appointment, string $dedupe): void
    {
        $user = $appointment->patient?->contactUser();
        if (! $user) return;
        $appointment->loadMissing('branch');
        $this->write($user, 'closure_notice', 'Please choose a new time', ($appointment->branch?->name ?? 'The branch').' will be closed on '.ClinicClock::local($appointment->starts_at)->format('D, M j'),
            'visits', $appointment->public_id, $dedupe);
    }

    /** M3/M15: the dentist is no longer available at this visit's time (not cancelled). */
    public function dentistUnavailable(Appointment $appointment, string $dedupe): void
    {
        $user = $appointment->patient?->contactUser();
        if (! $user) return;
        $appointment->loadMissing('branch');
        $this->write($user, 'dentist_unavailable', 'Please choose a new time', 'Your dentist is not available on '.ClinicClock::local($appointment->starts_at)->format('D, M j \a\t g:i A').'. Your visit was not cancelled.',
            'visits', $appointment->public_id, $dedupe);
    }

    /** M15/M25 staff notices (no private note, no clinical text): leave to the approver and back, a handover to the receiving side. */
    public function staffNotice(User $user, string $kind, string $title, ?string $body, string $page, ?string $targetId, string $dedupe): void
    {
        $this->write($user, $kind, $title, $body, $page, $targetId, $dedupe);
    }

    /** M25: the patient is told, neutrally, that their record was shared with the receiving branch (no clinical text). */
    public function recordShared(User $user, string $branchName, string $dedupe): void
    {
        $this->write($user, 'record_shared', 'Your record was shared', "Your patient record was shared with $branchName so they can continue your care.", 'visits', null, $dedupe);
    }

    /** Leave commands require durable notice intents before issuing a replay receipt. Other callers retain best-effort behavior. */
    public function staffNoticeOrFail(User $user, string $kind, string $title, ?string $body, string $page, ?string $targetId, string $dedupe): void
    {
        $this->write($user, $kind, $title, $body, $page, $targetId, $dedupe, true);
    }

    private function write(User $user, string $kind, string $title, ?string $body, ?string $page, ?string $targetId, string $dedupe, bool $strict=false): void
    {
        try {
            DB::transaction(fn () => UserNotification::firstOrCreate(['dedupe_key' => $dedupe], [
                'user_id' => $user->id, 'kind' => $kind, 'title' => mb_substr($title, 0, 160), 'body' => $body ? mb_substr($body, 0, 300) : null,
                'target_page' => $page, 'target_id' => $targetId, 'created_at' => now(),
            ]));
        } catch (\Throwable $e) {
            if ($strict) throw $e;
            report($e); // in a savepoint: the event that caused it still commits
        }
    }
}

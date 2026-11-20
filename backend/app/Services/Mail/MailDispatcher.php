<?php

namespace App\Services\Mail;

use App\Models\MailDispatch;
use App\Models\MailDispatchAttempt;
use App\Models\User;
use App\Services\Audit\AuditService;
use Illuminate\Contracts\Mail\Mailable;
use Illuminate\Support\Facades\Mail;

/**
 * M18 email dispatch foundation. Sends one message through the configured mailer and reports ONLY what this process can
 * know: whether a real outbound transport accepted it, whether it was merely written to a local log/array, or whether it
 * failed. It never claims recipient (inbox) delivery — no provider delivery receipt exists in this application yet.
 *
 * Outcomes:
 *   transport_accepted  a real transport (smtp/ses/postmark/resend/sendmail…) accepted the message without error;
 *                       inbox delivery is NOT confirmed.
 *   logged_only         the mailer is log/array: the message was recorded locally and NOT sent to anyone.
 *   failed              the transport raised an error; nothing is known to have been sent.
 *   suppressed          a reserved or fake test address (example.test, .invalid…): not handed to a real transport.
 *
 * Messages are sent synchronously (no queue worker runs yet — TD-24). Audit evidence records purpose, outcome and
 * transport name only: never the address, subject, link, token or body.
 */
class MailDispatcher
{
    public const REAL_TRANSPORTS = ['smtp', 'sendmail', 'ses', 'ses-v2', 'postmark', 'resend', 'mailgun'];
    public const LOCAL_TRANSPORTS = ['log', 'array', 'local_capture'];

    public function __construct(private readonly AuditService $audit) {}

    /** The effective transport class of the default mailer: 'real', 'local' or 'unknown'. Failover/roundrobin are real only if every child is. */
    public function transportKind(?string $mailer = null, array $seen = []): string
    {
        $mailer ??= (string) config('mail.default');
        if ($mailer === '' || in_array($mailer, $seen, true)) return 'unknown';
        $transport = (string) (config("mail.mailers.$mailer.transport") ?? '');
        if (in_array($transport, ['failover', 'roundrobin'], true)) {
            $kinds = array_map(fn ($child) => $this->transportKind($child, [...$seen, $mailer]), config("mail.mailers.$mailer.mailers", []));
            if (! $kinds) return 'unknown';
            return count(array_unique($kinds)) === 1 ? $kinds[0] : 'unknown';
        }
        if (in_array($transport, self::REAL_TRANSPORTS, true)) return 'real';
        if (in_array($transport, self::LOCAL_TRANSPORTS, true)) return 'local';
        return 'unknown';
    }

    /**
     * One transport attempt, no bookkeeping. Returns the truthful outcome and, on failure, the exception CLASS only
     * (transport messages can contain message content such as a one-time code, or SMTP credentials).
     *
     * @return array{status:string, mailer:string, transport_kind:string, error_class:?string}
     */
    public function attempt(string $to, Mailable $mail, string $purpose): array
    {
        $mailer = (string) config('mail.default');
        $kind = $this->transportKind();
        // Mail guard: a reserved or fake domain (example.test, example.com, .test, .invalid, .localhost) is never handed to a real
        // transport. Demo and test accounts use them; a real provider would only bounce them (and may flag the sender).
        if ($kind !== 'local' && ! \App\Services\Automations\Recipient::deliverable($to)) {
            return ['status' => 'suppressed', 'mailer' => $mailer, 'transport_kind' => $kind, 'error_class' => null];
        }
        try {
            // The From name follows the white-label sender name (the address stays the configured, authenticated sender).
            if (! $mail->from) $mail->from((string) config('mail.from.address'), \App\Support\Brand::senderName());
            Mail::to($to)->send($mail);
            $status = $kind === 'local' ? 'logged_only' : 'transport_accepted';
            $error = null;
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Mail dispatch failed.', ['purpose' => $purpose, 'exception' => $e::class]);
            $status = 'failed';
            $error = $e::class;
        }

        return ['status' => $status, 'mailer' => $mailer, 'transport_kind' => $kind, 'error_class' => $error];
    }

    /**
     * Immediate, single-attempt send for messages that carry a one-time secret (verification code, invitation link) or are
     * diagnostics: they are never stored or retried — the person asks again instead. The intent and attempt are still
     * recorded durably (without the address, link or code).
     *
     * @return array{status:string, mailer:string, transport_kind:string, message:string}
     */
    public function send(string $to, Mailable $mail, string $purpose, ?User $actor = null, mixed $target = null): array
    {
        $dispatch = MailDispatch::create([
            'purpose' => $purpose, 'dedupe_key' => $purpose.':'.\Illuminate\Support\Str::ulid(),
            'subject_type' => $target instanceof \Illuminate\Database\Eloquent\Model ? strtolower(class_basename($target)) : null,
            'subject_public_id' => $target instanceof \Illuminate\Database\Eloquent\Model ? ($target->public_id ?? null) : null,
            'recipient_user_id' => null, 'created_by_user_id' => $actor?->id, 'retryable' => false, 'max_attempts' => 1,
            'status' => 'processing', 'locked_at' => now(),
        ]);
        $started = now();
        $result = $this->attempt($to, $mail, $purpose);
        $this->record($dispatch, $result, $started, $actor, $target, final: true, reason: $result['status'] === 'failed' ? 'not_retryable' : null);

        return ['status' => $result['status'], 'mailer' => $result['mailer'], 'transport_kind' => $result['transport_kind'], 'message' => self::describe($result['status'], $result['transport_kind'])];
    }

    /**
     * Queues a message that must be sent exactly once (a one-time code or an account security notice). Call it INSIDE the
     * transaction that issues the code: the intent row rolls back with it, and the encrypted job is dispatched only after
     * commit. The response to the person therefore never claims the email was sent; the dispatch row records the outcome.
     */
    public function queueOnce(string $to, Mailable $mail, string $purpose, ?User $recipient = null, ?int $otpId = null): MailDispatch
    {
        if (app()->environment('production') && $this->transportKind() !== 'real') {
            // In production a code that is only written to a local log would leave the person waiting for an email that never comes.
            throw new \App\Exceptions\MailTransportUnavailable('Account email requires a real mail transport.');
        }
        $dispatch = MailDispatch::create([
            'purpose' => $purpose, 'dedupe_key' => $purpose.':'.\Illuminate\Support\Str::ulid(),
            'subject_type' => $recipient ? 'user' : null, 'subject_public_id' => $recipient?->public_id,
            'recipient_user_id' => $recipient?->id, 'retryable' => false, 'max_attempts' => 1, 'status' => 'pending',
        ]);
        if ($otpId && app()->environment('local') && $this->transportKind() === 'real') {
            // The local demonstration runs without a persistent mail worker. Release account locks before SMTP.
            \Illuminate\Support\Facades\DB::afterCommit(fn () =>
                \App\Jobs\SendOnceMail::dispatchSync($dispatch->id, $to, $mail, $otpId));
        } else {
            \App\Jobs\SendOnceMail::dispatch($dispatch->id, $to, $mail, $otpId);
        }

        return $dispatch;
    }

    /** Appends the attempt row, updates the intent and writes the audit evidence (purpose, outcome, mailer — nothing else). */
    public function record(MailDispatch $dispatch, array $result, \DateTimeInterface $started, ?User $actor, mixed $target, bool $final, ?string $reason = null, ?\DateTimeInterface $nextAt = null): void
    {
        $attemptNo = $dispatch->attempts + 1;
        MailDispatchAttempt::create([
            'mail_dispatch_id' => $dispatch->id, 'attempt_no' => $attemptNo, 'outcome' => $result['status'],
            'mailer' => $result['mailer'], 'transport_kind' => $result['transport_kind'], 'error_class' => $result['error_class'] ?? null,
            'started_at' => $started, 'finished_at' => now(),
        ]);
        $status = $result['status'] === 'failed' ? ($final ? 'failed' : 'retry_scheduled') : $result['status'];
        $dispatch->forceFill([
            'attempts' => $attemptNo, 'status' => $status, 'locked_at' => null, 'mailer' => $result['mailer'], 'transport_kind' => $result['transport_kind'],
            'next_attempt_at' => $status === 'retry_scheduled' ? $nextAt : null, 'failure_reason' => $status === 'failed' ? $reason : null,
            'completed_at' => in_array($status, MailDispatch::TERMINAL, true) ? now() : null,
        ])->save();
        try {
            $payload = ['purpose' => $dispatch->purpose, 'status' => $result['status'], 'mailer' => $result['mailer'], 'transport_kind' => $result['transport_kind']];
            $actor
                ? $this->audit->recordAdministrative('mail.dispatched', $actor, $target, $payload)
                : $this->audit->record(['action' => 'mail.dispatched', 'category' => 'administrative', 'severity' => $result['status'] === 'failed' ? 'warning' : 'info', 'actor' => null, 'target' => $target, 'payload' => $payload]);
        } catch (\Throwable $e) {
            report($e); // evidence failure is reported, never hidden, and never changes the send result
        }
    }

    public static function describe(string $status, string $kind): string
    {
        return match ($status) {
            'suppressed' => 'Not sent: the address is a reserved test address (suppressed).',
            'logged_only' => 'Recorded in the local mail log only. No email was sent to the recipient (the mail transport is not configured for delivery).',
            'transport_accepted' => $kind === 'real'
                ? 'Accepted by the mail transport. Delivery to the recipient’s inbox is not confirmed.'
                : 'Handed to the configured mailer. Whether it reached the recipient is not known.',
            default => 'Sending failed. No email is known to have been sent.',
        };
    }
}

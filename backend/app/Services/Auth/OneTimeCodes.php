<?php

namespace App\Services\Auth;

use App\Mail\OneTimeCodeMail;
use App\Models\EmailVerificationOtp;
use App\Models\User;
use App\Services\Mail\MailDispatcher;
use Illuminate\Support\Facades\Hash;

/**
 * M1 one-time codes for registration, password reset and email change. Every method expects to run inside a transaction
 * that already holds the account row lock (User::lockForUpdate), which serializes issue/check per account.
 *
 *  - 6 digits from random_int; only a bcrypt digest is stored; the code is never returned by the API.
 *  - Valid clinic.otp_ttl_minutes (10); clinic.otp_max_attempts (5) wrong entries consume it; single use.
 *  - Issuing a code consumes every earlier unused code of the same purpose for that account.
 *  - Sent once, through the queue, after commit (MailDispatcher::queueOnce); never stored for a retry.
 */
class OneTimeCodes
{
    public function __construct(private readonly MailDispatcher $mail) {}

    /** Seconds the account must still wait before another code of this purpose, or 0. */
    public function cooldown(User $user, string $purpose): int
    {
        $latest = EmailVerificationOtp::where('user_id', $user->id)->where('purpose', $purpose)->latest('id')->lockForUpdate()->first();
        $wait = (int) config('clinic.otp_resend_cooldown_seconds', 60);
        if (! $latest || $latest->sent_at->lte(now()->subSeconds($wait))) return 0;

        return max(1, (int) ceil(now()->diffInSeconds($latest->sent_at->copy()->addSeconds($wait))));
    }

    /** Issues a new code, replacing earlier unused ones, and queues its email to $to (the account email, or the new email). */
    public function issue(User $user, string $purpose, string $to, ?string $newEmail = null): EmailVerificationOtp
    {
        $code = (string) random_int(100000, 999999);
        $now = now();
        EmailVerificationOtp::where('user_id', $user->id)->where('purpose', $purpose)->whereNull('consumed_at')->update(['consumed_at' => $now]);
        $otp = EmailVerificationOtp::create([
            'user_id' => $user->id, 'purpose' => $purpose, 'new_email' => $newEmail, 'digest' => Hash::make($code), 'attempts' => 0,
            'expires_at' => $now->copy()->addMinutes((int) config('clinic.otp_ttl_minutes', 10)), 'sent_at' => $now,
        ]);
        $this->mail->queueOnce($to, new OneTimeCodeMail($code, $purpose, $user->person?->first_name), self::MAIL_PURPOSES[$purpose], $user, $otp->id);

        return $otp;
    }

    public const MAIL_PURPOSES = [
        EmailVerificationOtp::REGISTRATION => 'patient_email_verification',
        EmailVerificationOtp::PASSWORD_RESET => 'password_reset_code',
        EmailVerificationOtp::EMAIL_CHANGE => 'email_change_code',
        EmailVerificationOtp::ACCOUNT_CLAIM => 'account_claim_code',
    ];

    /**
     * Checks a submitted code against the newest unused code of this purpose. On success the code is consumed.
     * @return array{otp?: EmailVerificationOtp, failure?: array{0:string,1:string}}
     */
    public function check(User $user, string $purpose, string $code): array
    {
        $otp = EmailVerificationOtp::where('user_id', $user->id)->where('purpose', $purpose)->whereNull('consumed_at')->latest('id')->lockForUpdate()->first();
        $max = (int) config('clinic.otp_max_attempts', 5);
        if (! $otp || $otp->expires_at->isPast()) return ['failure' => ['otp_expired', 'That code has expired. Request a new code.']];
        if ($otp->attempts >= $max) return ['failure' => ['otp_attempt_limit', 'Too many incorrect attempts. Request a new code.']];
        if (! Hash::check($code, $otp->digest)) {
            $otp->attempts++;
            if ($otp->attempts >= $max) {
                $otp->consumed_at = now();
                $otp->save();

                return ['failure' => ['otp_attempt_limit', 'Too many incorrect attempts. Request a new code.']];
            }
            $otp->save();

            return ['failure' => ['invalid_otp', 'That code is not valid.']];
        }
        $otp->forceFill(['consumed_at' => now()])->save();

        return ['otp' => $otp];
    }

    public static function failure(string $code, string $message, string $field = 'otp')
    {
        return response()->json(['message' => $message, 'errors' => [$field => [$message]], 'code' => $code], 422);
    }
}

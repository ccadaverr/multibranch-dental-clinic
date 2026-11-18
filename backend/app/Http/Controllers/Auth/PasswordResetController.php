<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Mail\SecurityNoticeMail;
use App\Models\EmailVerificationOtp;
use App\Models\Person;
use App\Models\User;
use App\Services\Audit\AuditService;
use App\Services\Auth\OneTimeCodes;
use App\Services\Auth\OtpThrottle;
use App\Services\Mail\MailDispatcher;
use App\Support\ClinicClock;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;

/**
 * M1 password reset by emailed one-time code, for every role (Patient, Staff, Dentist, Owner) with an Active account.
 * Invited employees finish through their invitation link instead; suspended or deleted accounts get no code.
 *
 *  forgot    — always the same answer whether or not the address has an account (no enumeration). Returns session verification ticket.
 *  verifyOtp — Step 2: verifies OTP and returns signed reset token.
 *  reset     — Step 3: resets password with signed reset token, or with otp directly for backward compatibility.
 */
class PasswordResetController extends Controller
{
    private const GENERIC_FAILURE = ['invalid_otp', 'That code is not valid or has expired. Request a new code if you need one.'];

    public function __construct(private readonly OneTimeCodes $codes, private readonly AuditService $audit) {}

    public function forgot(Request $request)
    {
        if ($request->has('identifier')) {
            $raw = trim((string) $request->input('identifier'));
            if (str_contains($raw, '@')) {
                $email = strtolower($raw);
            } else {
                $cleaned = preg_replace('/[^\d+]/', '', $raw);
                $person = Person::where('phone', $raw)->orWhere('phone', $cleaned)->first();
                $email = $person?->user?->email ?? ($cleaned ? $cleaned.'@phone.placeholder' : 'unknown@example.com');
            }
        } else {
            $data = $request->validate(['email' => ['required', 'email:rfc', 'max:255']]);
            $email = strtolower(trim($data['email']));
        }

        if ($wait = app(OtpThrottle::class)->hit($email, (string) $request->ip(), OtpThrottle::RESET)) return OtpThrottle::limited($wait);

        DB::transaction(function () use ($email) {
            $user = User::where('email', $email)->lockForUpdate()->first();
            // A pending account claim is finished only through /api/account/claim/verify (the same neutral answer here).
            if (! $user || $user->account_status !== 'Active' || $user->pending_claim) return;
            // Inside the 60-second wait the earlier code stays valid; answering differently would reveal the account.
            if ($this->codes->cooldown($user, EmailVerificationOtp::PASSWORD_RESET)) return;
            $this->codes->issue($user->load('person'), EmailVerificationOtp::PASSWORD_RESET, $user->email);
            $this->audit->recordAuth('auth.password_reset_requested', $user);
        });

        $ticket = Crypt::encryptString(json_encode([
            'email' => $email,
            'created_at' => now()->timestamp,
            'purpose' => 'password_reset_ticket',
        ]));

        return response()->json([
            'message' => 'If an account uses this email, we sent it a code to reset the password.',
            'data' => [
                'resend_available_at' => now()->addSeconds((int) config('clinic.otp_resend_cooldown_seconds', 60))->toISOString(),
                'ticket' => $ticket,
            ],
        ]);
    }

    public function verifyOtp(Request $request)
    {
        $data = $request->validate([
            'ticket' => ['required', 'string'],
            'otp' => ['required', 'digits:6'],
        ]);

        try {
            $payload = json_decode(Crypt::decryptString($data['ticket']), true);
        } catch (\Throwable) {
            return OneTimeCodes::failure(...self::GENERIC_FAILURE);
        }

        if (! is_array($payload) || ($payload['purpose'] ?? '') !== 'password_reset_ticket') {
            return OneTimeCodes::failure(...self::GENERIC_FAILURE);
        }

        $email = strtolower(trim((string) ($payload['email'] ?? '')));

        $result = DB::transaction(function () use ($email, $data) {
            $user = User::where('email', $email)->lockForUpdate()->first();
            if (! $user || $user->account_status !== 'Active' || $user->pending_claim) {
                Hash::check($data['otp'], '$2y$12$H5ntb6FLY.qFGr/Rba08b.Dt0raoSs2QEEhzAIt5grrYJ3L8/f/q2');

                return ['failure' => self::GENERIC_FAILURE];
            }

            $check = $this->codes->check($user, EmailVerificationOtp::PASSWORD_RESET, $data['otp']);
            if (isset($check['failure'])) return ['failure' => self::GENERIC_FAILURE];

            $resetToken = Crypt::encryptString(json_encode([
                'user_id' => $user->id,
                'email' => $user->email,
                'purpose' => 'password_reset_token',
                'auth_version' => $user->auth_version,
                'expires_at' => now()->addMinutes(15)->timestamp,
            ]));

            return ['ok' => true, 'reset_token' => $resetToken];
        });

        if (isset($result['failure'])) return OneTimeCodes::failure(...$result['failure']);

        return response()->json([
            'message' => 'Code verified successfully.',
            'data' => [
                'reset_token' => $result['reset_token'],
            ],
        ]);
    }

    public function reset(Request $request)
    {
        if ($request->filled('reset_token')) {
            $data = $request->validate([
                'reset_token' => ['required', 'string'],
                'password' => ['required', 'string', new \App\Rules\PasswordInput(), 'max:72', 'confirmed', Password::min(8)->letters()->numbers()],
            ]);

            try {
                $payload = json_decode(Crypt::decryptString($data['reset_token']), true);
            } catch (\Throwable) {
                return OneTimeCodes::failure(...self::GENERIC_FAILURE);
            }

            if (! is_array($payload) || ($payload['purpose'] ?? '') !== 'password_reset_token' || ($payload['expires_at'] ?? 0) < now()->timestamp) {
                return OneTimeCodes::failure('invalid_reset_token', 'Your password reset session has expired or is invalid. Please request a new code.');
            }

            $userId = $payload['user_id'] ?? null;
            $result = DB::transaction(function () use ($userId, $data, $payload) {
                $user = User::where('id', $userId)->lockForUpdate()->first();
                if (! $user || $user->account_status !== 'Active') {
                    return ['failure' => ['account_inactive', 'Account is not active.']];
                }

                // A successful password change advances auth_version under this same account lock.
                if (($payload['auth_version'] ?? null) !== $user->auth_version) {
                    return ['failure' => ['invalid_reset_token', 'Your password reset session has expired or is invalid. Please request a new code.', 'reset_token']];
                }

                EmailVerificationOtp::where('user_id', $user->id)
                    ->whereIn('purpose', [EmailVerificationOtp::PASSWORD_RESET, EmailVerificationOtp::EMAIL_CHANGE])
                    ->whereNull('consumed_at')
                    ->update(['consumed_at' => now()]);

                $user->forceFill(['password' => Hash::make($data['password']), 'email_verified_at' => $user->email_verified_at ?? now()])->save();
                $this->audit->recordAuth('auth.password_reset_completed', $user);
                app(MailDispatcher::class)->queueOnce($user->email, new SecurityNoticeMail('password_changed', $user->person?->first_name, ClinicClock::now()->format('F j, Y g:i A')), 'password_changed_notice', $user);

                return ['ok' => true];
            });

            if (isset($result['failure'])) return OneTimeCodes::failure(...$result['failure']);

            return response()->json(['message' => 'Your password was reset. Sign in with your new password.']);
        }

        $data = $request->validate([
            'email' => ['required', 'email:rfc', 'max:255'],
            'otp' => ['required', 'digits:6'],
            'password' => ['required', 'string', new \App\Rules\PasswordInput(), 'max:72', 'confirmed', Password::min(8)->letters()->numbers()],
        ]);
        $email = strtolower(trim($data['email']));

        $result = DB::transaction(function () use ($email, $data) {
            $user = User::where('email', $email)->lockForUpdate()->first();
            if (! $user || $user->account_status !== 'Active' || $user->pending_claim) {
                Hash::check($data['otp'], '$2y$12$H5ntb6FLY.qFGr/Rba08b.Dt0raoSs2QEEhzAIt5grrYJ3L8/f/q2');

                return ['failure' => self::GENERIC_FAILURE];
            }

            $check = $this->codes->check($user, EmailVerificationOtp::PASSWORD_RESET, $data['otp']);
            if (isset($check['failure'])) return ['failure' => self::GENERIC_FAILURE];

            EmailVerificationOtp::where('user_id', $user->id)->where('purpose', EmailVerificationOtp::EMAIL_CHANGE)->whereNull('consumed_at')->update(['consumed_at' => now()]);
            $user->forceFill(['password' => Hash::make($data['password']), 'email_verified_at' => $user->email_verified_at ?? now()])->save();
            $this->audit->recordAuth('auth.password_reset_completed', $user);
            app(MailDispatcher::class)->queueOnce($user->email, new SecurityNoticeMail('password_changed', $user->person?->first_name, ClinicClock::now()->format('F j, Y g:i A')), 'password_changed_notice', $user);

            return ['ok' => true];
        });

        if (isset($result['failure'])) return OneTimeCodes::failure(...$result['failure']);

        return response()->json(['message' => 'Your password was reset. Sign in with your new password.']);
    }
}

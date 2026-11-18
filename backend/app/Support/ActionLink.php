<?php

namespace App\Support;

use App\Models\User;
use Carbon\CarbonImmutable;

/**
 * Signed, expiring, single-use email links (F1–F3): "I'll be there", "I can't make it", "On my way" and "Take the earlier time".
 * The token carries what it is for (purpose, record, revision, expiry, a nonce) and an HMAC made with a key derived from the
 * application key, so it cannot be forged or edited. Nothing is stored when the email is built; a link is spent by inserting its
 * hash into appointment_responses (unique), so it works once. A link for an older revision of the appointment is out of date.
 * Links open the patient site (`/#respond/<token>`); the token stays in the URL fragment, which browsers never send to a server.
 */
final class ActionLink
{
    public const PURPOSES = ['attend', 'cant_make_it', 'on_my_way', 'move_up'];

    public static function make(string $purpose, string $subjectPublicId, int $revision, CarbonImmutable $expiresAt, string $nonce = '', ?User $recipient = null): string
    {
        if (! in_array($purpose, self::PURPOSES, true)) throw new \InvalidArgumentException("Unknown link purpose '$purpose'.");
        $claims = ['p' => $purpose, 's' => $subjectPublicId, 'r' => $revision, 'e' => $expiresAt->getTimestamp(), 'n' => $nonce];
        if ($recipient) {
            $claims['u'] = $recipient->public_id;
            $claims['v'] = $recipient->auth_version;
        }
        $payload = self::b64(json_encode($claims));

        return $payload.'.'.self::b64(hash_hmac('sha256', $payload, self::key(), true));
    }

    /** @return array{purpose:string, subject:string, revision:int, expires_at:CarbonImmutable, hash:string, recipient:?string, recipient_version:?int}|null null when forged or malformed */
    public static function parse(?string $token): ?array
    {
        if (! is_string($token) || strlen($token) > 600 || ! preg_match('/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/', $token)) return null;
        [$payload, $signature] = explode('.', $token, 2);
        if (! hash_equals(self::b64(hash_hmac('sha256', $payload, self::key(), true)), $signature)) return null;
        $data = json_decode((string) base64_decode(strtr($payload, '-_', '+/'), true), true);
        if (! is_array($data) || ! in_array($data['p'] ?? null, self::PURPOSES, true) || ! is_string($data['s'] ?? null) || ! is_int($data['r'] ?? null) || ! is_int($data['e'] ?? null)) return null;

        return ['purpose' => $data['p'], 'subject' => $data['s'], 'revision' => $data['r'], 'expires_at' => CarbonImmutable::createFromTimestamp($data['e']), 'hash' => hash('sha256', $token),
            'recipient' => is_string($data['u'] ?? null) ? $data['u'] : null,
            'recipient_version' => is_int($data['v'] ?? null) ? $data['v'] : null];
    }

    public static function url(string $token): string
    {
        return rtrim((string) config('app.frontend_url'), '/').'/#respond/'.$token;
    }

    private static function key(): string
    {
        return hash_hmac('sha256', 'clinic-action-links-v1', (string) config('app.key'), true);
    }

    private static function b64(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}

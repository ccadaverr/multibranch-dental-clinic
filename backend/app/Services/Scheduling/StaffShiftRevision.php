<?php

namespace App\Services\Scheduling;

use App\Models\AuditLog;
use App\Models\StaffProfile;

/** An opaque comparison value for the existing flat profile, never evidence of dated duty. */
class StaffShiftRevision
{
    public static function for(StaffProfile $profile): string
    {
        $lastChange = AuditLog::where('action', 'staff_profile.updated')
            ->where('auditable_type', 'StaffProfile')->where('auditable_public_id', $profile->legacy_ref)
            ->max('id');

        return self::digest($profile->getAttributes(), $lastChange);
    }

    public static function digest(array $attributes, int|string|null $lastChange): string
    {
        // Include raw persisted fields and the append-only change sequence: A -> B -> A must not restore a revision.
        return self::combine(self::stateDigest($attributes), $lastChange);
    }

    public static function stateDigest(array $attributes): string
    {
        ksort($attributes);

        return hash('sha256', json_encode($attributes, JSON_THROW_ON_ERROR));
    }

    public static function combine(string $stateDigest, int|string|null $lastChange): string
    {
        return hash('sha256', json_encode([$stateDigest, $lastChange], JSON_THROW_ON_ERROR));
    }
}

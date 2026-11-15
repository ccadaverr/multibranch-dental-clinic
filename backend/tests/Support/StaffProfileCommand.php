<?php

namespace Tests\Support;

use App\Models\StaffProfile;
use App\Services\Scheduling\StaffShiftRevision;
use Illuminate\Support\Str;

/** Explicit observation for pre-existing Staff mutation tests, not a production auto-rebase. */
class StaffProfileCommand
{
    public static function body(string $ref, array $changes): array
    {
        return $changes + ['expected_revision' => StaffShiftRevision::for(StaffProfile::where('legacy_ref', $ref)->firstOrFail()),
            'operation_id' => (string) Str::uuid()];
    }
}

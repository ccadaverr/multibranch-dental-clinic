<?php

namespace App\Http\Resources\Reference;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

// userId is legacy_user_ref — a plain transitional string, NOT a real backend relationship, and deliberately
// carries no account_status field: linked account activity is explicitly NOT backend-authoritative this
// phase (Phase 2A plan, section G) — nothing in this response could be mistaken for that claim.
// `title` reads from staff_profiles.title directly (bugfix — see add_title_to_staff_profiles_table
// migration comment), never from the linked User: only 1 of 5 roster members has a real User to read a
// title from at all, and the profile must carry its own job title regardless of identity/account state.
class StaffProfileResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->legacy_ref,
            'userId' => $this->legacy_user_ref,
            'personId' => 'per-'.$this->legacy_ref,
            'name' => $this->person->fullName(),
            'title' => $this->title,
            'branchId' => $this->branch?->legacy_ref,
            'branch' => $this->branch?->name ?? 'All Branches',
            'shiftStart' => $this->shift_start,
            'shiftEnd' => $this->shift_end,
            'available' => $this->available,
            'revision' => \App\Services\Scheduling\StaffShiftRevision::for($this->resource),
        ];
    }
}

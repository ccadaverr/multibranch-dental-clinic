<?php

namespace App\Http\Resources\Reference;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

// Exposes legacy_ref as the resource's `id` — the internal bigint primary key never reaches the client
// (Phase 2A plan, section C/D).
class BranchResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->legacy_ref,
            'public_id' => $this->public_id,
            'operating_data_status' => 'unconfirmed',
            'branch_code' => $this->branch_code,
            'name' => $this->name,
            'city' => $this->city,
            'address' => $this->address,
            'phone' => $this->phone,
            'email' => $this->email,
            'open_time' => $this->open_time,
            'close_time' => $this->close_time,
            'status' => $this->status,
            'archived' => $this->archived_at !== null,
            'archived_at' => $this->archived_at?->toIso8601String(),
            'archive_reason' => $request->user()?->role?->value === 'owner' ? $this->archive_reason : null,
            'capacity_threshold' => $this->capacity_threshold,
            'latitude' => $this->latitude !== null ? (float) $this->latitude : null,
            'longitude' => $this->longitude !== null ? (float) $this->longitude : null,
            // ISO weekdays (1 = Monday … 7 = Sunday) the branch takes appointments; null = every day.
            'operating_days' => $this->operating_days,
            // Opening hours per ISO weekday (null = closed), from the one source every rule and screen uses.
            'weekly_hours' => (object) $this->weekHours(), // an object keyed "1" (Monday) to "7" (Sunday), never a list
        ];
    }
}

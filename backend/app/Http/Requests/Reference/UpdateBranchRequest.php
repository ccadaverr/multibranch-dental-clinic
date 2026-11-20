<?php

namespace App\Http\Requests\Reference;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

// Wires the existing frontend saveBranch action (Phase 2A plan, section H/J) — update-only, matching what
// the current Admin UI actually does; no create endpoint exists this phase. authorize() defers to the
// 'role:owner' route middleware, matching the existing RegisterPatientRequest/LoginRequest convention of
// returning true here.
class UpdateBranchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $branchId = $this->route('branch')?->id;

        return [
            'branch_code' => ['sometimes', 'string', 'max:50',
                Rule::in(array_merge(config('branch_codes'), [$this->route('branch')?->branch_code])),
                Rule::unique('branches', 'branch_code')->ignore($branchId)],
            'name' => ['sometimes', 'required', 'string', 'max:150', Rule::unique('branches', 'name')->ignore($branchId)],
            'city' => ['sometimes', 'string', 'max:100'],
            'address' => ['sometimes', 'string', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'email' => ['sometimes', 'nullable', 'email', 'max:150'],
            // Approximate map position for the nearest-branch ranking (both or neither).
            'latitude' => ['nullable', 'numeric', 'between:4,22', 'required_with:longitude'],
            'longitude' => ['nullable', 'numeric', 'between:114,128', 'required_with:latitude'],
            'open_time' => ['sometimes', 'date_format:H:i'],
            'close_time' => ['sometimes', 'date_format:H:i'],
            'status' => ['sometimes', Rule::in(['Open', 'Temporarily Closed', 'Inactive'])],
            'capacity_threshold' => ['sometimes', 'integer', 'min:1', 'max:100'],
            // Days the branch takes appointments (ISO weekday 1 = Monday … 7 = Sunday); null = every day.
            'operating_days' => ['sometimes', 'nullable', 'array', 'min:1', 'max:7'],
            'operating_days.*' => ['integer', 'between:1,7', 'distinct'],
            // Per-day hours: {"1": {"open": "08:00", "close": "20:00"}, …}; a weekday left out is closed. At least one open day.
            'weekly_hours' => ['sometimes', 'nullable', 'array', 'min:1', 'max:7'],
            'weekly_hours.*' => ['array:open,close'],
            'weekly_hours.*.open' => ['required', 'date_format:H:i'],
            'weekly_hours.*.close' => ['required', 'date_format:H:i'],

            // legacy_ref/id are never client-mutable (legacy_ref is bridge-internal only). Coordinates are Owner-editable since
            // 2026-10-14 (real branches; docs/BRANCH_LOCATIONS.md) and validated above.
            'legacy_ref' => ['prohibited'],
            'public_id' => ['prohibited'],
            'operating_data_status' => ['prohibited'],
            'id' => ['prohibited'],
            'archived_at' => ['prohibited'],
            'archived_by_user_id' => ['prohibited'],
            'archive_reason' => ['prohibited'],
        ];
    }
}

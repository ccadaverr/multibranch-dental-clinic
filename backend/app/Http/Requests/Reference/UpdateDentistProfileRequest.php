<?php

namespace App\Http\Requests\Reference;

use Illuminate\Foundation\Http\FormRequest;

// Wires the existing frontend savePersonnel('dentists', ...) action (Phase 2A plan, section H/J).
// branch_ids accepts a replace-set array, matching the live edit form (confirmed at implementation start,
// plan section S2B) — the form only ever submits a single-element array today, but the contract itself
// supports more than one, since a Dentist can genuinely work multiple branches (d5, seeded with 2).
class UpdateDentistProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'license_no' => ['sometimes', 'nullable', 'string', 'max:50'],
            'specialty' => ['sometimes', 'nullable', 'string', 'max:100'],
            'assistant_staff_ref' => ['sometimes', 'nullable', 'string', 'exists:staff_profiles,legacy_ref'],
            'branch_ids' => ['sometimes', 'array', 'min:1'],
            'branch_ids.*' => ['string', 'exists:branches,legacy_ref'],
            'authorize_service_refs' => ['sometimes', 'array', 'min:1', 'max:100'],
            'authorize_service_refs.*' => ['required', 'string', 'distinct', 'exists:services,legacy_ref'],
            'shift_start' => ['sometimes', 'date_format:H:i'],
            'shift_end' => ['sometimes', 'date_format:H:i', 'after:shift_start'],
            'available' => ['sometimes', 'boolean'],

            'legacy_ref' => ['prohibited'],
            'legacy_user_ref' => ['prohibited'],
            'person_id' => ['prohibited'],
            'id' => ['prohibited'],
        ];
    }
}

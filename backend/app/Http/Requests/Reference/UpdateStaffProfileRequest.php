<?php

namespace App\Http\Requests\Reference;

use Illuminate\Foundation\Http\FormRequest;

// Wires the existing frontend savePersonnel('staff', ...) action (Phase 2A plan, section H/J).
class UpdateStaffProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'title' => ['sometimes', 'nullable', 'string', 'max:100'],
            'branch_ref' => ['sometimes', 'nullable', 'string', 'exists:branches,legacy_ref'],
            'shift_start' => ['sometimes', 'date_format:H:i'],
            'shift_end' => ['sometimes', 'date_format:H:i'],
            'available' => ['sometimes', 'boolean'],
            // Opt-in comparison/replay extension; legacy personnel clients remain compatible.
            'expected_revision' => ['required_with:operation_id', 'string', 'regex:/^[a-f0-9]{64}$/'],
            'operation_id' => ['required_with:expected_revision', 'uuid', 'lowercase'],

            // Identity fields are immutable here, matching the existing savePersonnel behavior exactly.
            'legacy_ref' => ['prohibited'],
            'legacy_user_ref' => ['prohibited'],
            'person_id' => ['prohibited'],
            'id' => ['prohibited'],
        ];
    }
}

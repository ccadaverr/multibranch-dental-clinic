<?php

namespace App\Http\Requests\Appointment;

use Illuminate\Foundation\Http\FormRequest;

// Smart Scheduling request (Patient). The Patient's location is optional and only used when branches carry real
// coordinates; it is never stored.
class RecommendationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'service_ref' => ['required', 'string', 'exists:services,legacy_ref'],
            'for_patient_id' => ['nullable', 'string', 'max:40'],
            'branch_ref' => ['nullable', 'string', 'exists:branches,legacy_ref'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude'],
        ];
    }
}

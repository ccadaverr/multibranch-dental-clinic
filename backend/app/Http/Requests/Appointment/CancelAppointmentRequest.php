<?php

namespace App\Http\Requests\Appointment;

use App\Support\ReasonSelection;
use Illuminate\Foundation\Http\FormRequest;

class CancelAppointmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'expected_revision' => ['required', 'integer', 'min:1'],
            'reason' => ['nullable', 'string', 'max:255', 'not_in:Other', 'prohibits:reason_category'],
            'note' => ['nullable', 'string', 'max:500'],
            ...ReasonSelection::rules('reason_category', 'reason_detail',
                $this->user()->role->value === 'patient' ? ReasonSelection::PATIENT_CANCELLATION : ReasonSelection::STAFF_CANCELLATION, 255),
            'status' => ['prohibited'],
        ];
    }
}

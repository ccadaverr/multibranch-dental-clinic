<?php

namespace App\Http\Requests\Visit;

use Illuminate\Foundation\Http\FormRequest;

// Scheduled Check-In: the appointment (public_id) and the revision the Staff member saw. Everything else about the
// Visit — Patient, branch, Dentist, arrival time, status — comes from the server, never from the client.
class CheckInVisitRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'appointment_id' => ['required', 'string', 'max:26'],
            'expected_revision' => ['required', 'integer', 'min:1'],
            // Additive evidence for the existing explicit Staff checkbox; no new global intake policy.
            'id_confirmed' => ['sometimes', 'accepted'],
            'patient_id' => ['prohibited'],
            'branch_ref' => ['prohibited'],
            'dentist_ref' => ['prohibited'],
            'status' => ['prohibited'],
            'source' => ['prohibited'],
            'arrived_at' => ['prohibited'],
            'clinic_date' => ['prohibited'],
        ];
    }
}

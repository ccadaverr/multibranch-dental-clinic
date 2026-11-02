<?php

namespace App\Http\Requests\Appointment;

use App\Enums\Role;
use Illuminate\Foundation\Http\FormRequest;

// Read-only availability search for one branch/service/date. `appointment_id` (a public id the caller may view)
// excludes that appointment from conflict checks when searching times for a reschedule.
class AvailabilityRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $patient = $this->user()->role === Role::Patient;

        return [
            'branch_ref' => ['required', 'string', 'exists:branches,legacy_ref'],
            'service_ref' => ['required', 'string', 'exists:services,legacy_ref'],
            'date' => ['required', 'date_format:Y-m-d'],
            'for_patient_id' => $patient ? ['nullable', 'string', 'max:40'] : ['prohibited'],
            'patient_id' => $patient ? ['prohibited'] : ['nullable', 'string', 'exists:patients,public_id'],
            'patient_code' => ['prohibited'],
            'appointment_id' => ['nullable', 'string', 'exists:appointments,public_id'],
            // Staff/Owner may check one specific eligible Dentist (explicit selection or a Dentist-requested follow-up);
            // a Patient never chooses a Dentist.
            // A Patient may prefer a Dentist (optional; "Any available" keeps the automatic assignment). The scheduling rules still
            // check that the Dentist works at the branch, does the service and is free.
            'dentist_ref' => ['nullable', 'string', 'exists:dentist_profiles,legacy_ref'],
        ];
    }
}

<?php

namespace App\Http\Requests\Appointment;

use App\Enums\Role;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

// Create an appointment. A Patient books for themself (no Patient identifier) and never chooses a Dentist; Staff/Owner
// name the Patient and may either select a Dentist or let the deterministic assignment choose one. Status, source,
// revision and ids are always server-decided. Scheduling rules are checked by SchedulingService, not here.
class StoreAppointmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return ! $this->selectsFollowup() || $this->user()->role === Role::Staff;
    }

    public function selectsFollowup(): bool
    {
        // Presence, including explicit null/empty values, selects the strict contract.
        return array_key_exists('followup_task_id', $this->all()) || array_key_exists('followup_expected_revision', $this->all());
    }

    public function rules(): array
    {
        $patient = $this->user()->role === Role::Patient;

        return [
            'branch_ref' => ['required', 'string', 'exists:branches,legacy_ref'],
            'service_ref' => ['required', 'string', 'exists:services,legacy_ref'],
            'date' => ['required', 'date_format:Y-m-d'],
            'start_time' => ['required', 'date_format:H:i'],
            'notes' => ['nullable', 'string', 'max:1000'],
            // Staff/Owner name the Patient by public_id (never the bigint or patient_code). A Patient's own booking is
            // always derived from the authenticated identity, so any Patient identifier they send is refused.
            'patient_id' => $patient ? ['prohibited'] : ['required', 'string', 'exists:patients,public_id'],
            // A guardian books for a dependent (intake, R2-12); checked in the controller.
            'for_patient_id' => $patient ? ['nullable', 'string', 'max:40'] : ['prohibited'],
            // A Patient may prefer a Dentist (optional; "Any available" keeps the automatic assignment). The scheduling rules still
            // check that the Dentist works at the branch, does the service and is free.
            'dentist_ref' => ['nullable', 'string', 'exists:dentist_profiles,legacy_ref'],
            'pay_at_clinic' => ['nullable', 'boolean'],
            'consultation_acknowledged' => $patient ? ['prohibited'] : ['nullable', 'boolean'],
            'followup_task_id' => [Rule::requiredIf($this->selectsFollowup()), 'string', 'ulid'],
            'followup_expected_revision' => [Rule::requiredIf($this->selectsFollowup()), 'integer', 'min:1', 'max:2147483647'],

            'id' => ['prohibited'],
            'status' => ['prohibited'],
            'source' => ['prohibited'],
            'revision' => ['prohibited'],
            'patient_code' => ['prohibited'],
            'dentist_profile_id' => ['prohibited'],
        ];
    }
}

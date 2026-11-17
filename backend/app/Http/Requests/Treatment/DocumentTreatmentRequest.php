<?php

namespace App\Http\Requests\Treatment;

use App\Support\ReasonSelection;
use Illuminate\Foundation\Http\FormRequest;

// The complete editable Treatment documentation (decision Q-T3): the four clinical text fields, the Dentist's explicit
// prescription / follow-up decisions with the follow-up recommendation, and the full procedure-line set. Status, Dentist,
// Visit, timestamps, prices and amounts are never accepted from the client.
class DocumentTreatmentRequest extends FormRequest
{
    private const TEXT = ['chief_complaint', 'treatment_plan', 'procedure_summary', 'clinical_notes'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'expected_revision' => ['required', 'integer', 'min:1'],
            'chief_complaint' => ['nullable', 'string', 'max:5000'],
            'treatment_plan' => ['nullable', 'string', 'max:5000'],
            'procedure_summary' => ['nullable', 'string', 'max:5000'],
            'clinical_notes' => ['nullable', 'string', 'max:10000'],
            'prescription_required' => ['required', 'boolean'],
            'followup_required' => ['required', 'boolean'],
            // Follow-up recommendation fields exist only when the Dentist marked a follow-up as required.
            'followup_recommended_date' => ['nullable', 'date_format:Y-m-d', 'prohibited_unless:followup_required,true,1'],
            'followup_reason' => ['nullable', 'string', 'max:1000', 'not_in:Other', 'prohibits:followup_reason_category', 'prohibited_unless:followup_required,true,1'],
            ...array_map(
                fn ($rules) => [...$rules, 'prohibited_unless:followup_required,true,1'],
                ReasonSelection::rules('followup_reason_category', 'followup_reason_detail', ReasonSelection::FOLLOWUP, 500),
            ),
            'followup_interval' => ['nullable', 'string', 'max:100', 'prohibited_unless:followup_required,true,1'],
            'procedures' => ['present', 'array', 'max:30'],
            'procedures.*' => ['array:id,service_ref,quantity,notes'],
            'procedures.*.id' => ['nullable', 'string', 'size:26'],
            'procedures.*.service_ref' => ['required', 'string', 'max:64'],
            'procedures.*.quantity' => ['required', 'integer:strict', 'min:1', 'max:99'],   // never a boolean or string coerced to a number
            'procedures.*.notes' => ['nullable', 'string', 'max:1000'],
            'status' => ['prohibited'],
            'dentist_ref' => ['prohibited'],
            'visit_id' => ['prohibited'],
            'started_at' => ['prohibited'],
            'completed_at' => ['prohibited'],
            // Identity, ownership, state, clocks, money and audit fields are server context: supplying one is refused, never ignored.
            ...array_fill_keys(['patient_id', 'branch_id', 'branch_ref', 'dentist_id', 'dentist_profile_id', 'assistant_ref', 'id', 'public_id', 'revision',
                'created_by_user_id', 'updated_by_user_id', 'reviewed_by', 'billing_status', 'invoice_id', 'price', 'amount', 'fee', 'total', 'history', 'audit'], ['prohibited']),
        ];
    }

    /** @return array{fields: array<string,mixed>, procedures: list<array{id:?string,service_ref:string,quantity:int,notes:?string}>} */
    public function documentation(): array
    {
        $v = $this->validated();
        $text = fn ($value) => ($value = trim((string) $value)) === '' ? null : $value;
        $fields = [];
        foreach (self::TEXT as $field) {
            $fields[$field] = $text($v[$field] ?? null);
        }
        $fields['prescription_required'] = (bool) $v['prescription_required'];
        $fields['followup_required'] = (bool) $v['followup_required'];
        $fields['followup_recommended_date'] = $fields['followup_required'] ? ($v['followup_recommended_date'] ?? null) : null;
        $fields['followup_reason'] = $fields['followup_required'] ? $text(ReasonSelection::text($v, 'followup_reason_category', 'followup_reason_detail', 'followup_reason')) : null;
        if (isset($v['followup_reason_category'])) {
            $fields['followup_reason_category'] = $v['followup_reason_category'];
        }
        $fields['followup_interval'] = $fields['followup_required'] ? $text($v['followup_interval'] ?? null) : null;

        $procedures = array_map(fn ($row) => [
            'id' => $row['id'] ?? null,
            'service_ref' => $row['service_ref'],
            'quantity' => (int) $row['quantity'],
            'notes' => $row['notes'] ?? null,
        ], array_values($v['procedures'] ?? []));

        return ['fields' => $fields, 'procedures' => $procedures];
    }
}

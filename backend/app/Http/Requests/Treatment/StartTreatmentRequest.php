<?php

namespace App\Http\Requests\Treatment;

// Reviewed queue context is additive for existing clients, but must be supplied as a complete pair.
class StartTreatmentRequest extends TreatmentCommandRequest
{
    public function rules(): array
    {
        return parent::rules() + [
            'queue_id' => ['required_with:expected_queue_revision', 'string', 'size:26'],
            'expected_queue_revision' => ['required_with:queue_id', 'integer', 'min:1'],
        ];
    }
}

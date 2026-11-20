<?php

namespace App\Http\Requests\Appointment;

use Illuminate\Foundation\Http\FormRequest;

final class RefundBookingPaymentRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'expected_revision' => ['required', 'integer', 'min:1'],
            'reason' => ['required', 'in:requested_by_customer,duplicate,fraudulent,others'],
            'note' => ['nullable', 'string', 'max:500', 'required_if:reason,others'],
            // Provider amount, payment identity, Patient and branch are derived on the server.
            'amount' => ['prohibited'], 'payment_id' => ['prohibited'],
            'refund_id' => ['prohibited'], 'status' => ['prohibited'],
            'patient_id' => ['prohibited'], 'branch_id' => ['prohibited'],
            'booking_fee_php' => ['prohibited'],
        ];
    }
}

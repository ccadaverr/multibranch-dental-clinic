<?php

namespace App\Http\Requests\Appointment;

use Illuminate\Foundation\Http\FormRequest;

/** Readback-only: the client must never supply a provider refund target or amount. */
final class ReconcileBookingRefundRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'expected_revision' => ['required', 'integer', 'min:1'],
            'amount' => ['prohibited'], 'payment_id' => ['prohibited'],
            'refund_id' => ['prohibited'], 'status' => ['prohibited'],
            'reason' => ['prohibited'], 'patient_id' => ['prohibited'],
            'branch_id' => ['prohibited'], 'booking_fee_php' => ['prohibited'],
        ];
    }
}

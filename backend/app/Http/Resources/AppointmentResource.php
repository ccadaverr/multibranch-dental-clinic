<?php

namespace App\Http\Resources;

use App\Support\ClinicClock;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

// Public appointment shape. `id` and `patient.id` are ULID public_ids (bigints never leave the server); `patient.code`
// is the clinic-facing patient_code. Timestamps are ISO-8601
// with an explicit +08:00 offset; `date`/`start_time`/`end_time` are the same instant as Asia/Manila business values.
// Branch/service/Dentist use their transitional legacy_ref ids, matching the Phase 2A reference API.
class AppointmentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $start = ClinicClock::local($this->starts_at);
        $end = ClinicClock::local($this->ends_at);
        $iso = fn ($value) => $value ? ClinicClock::local($value)->toIso8601String() : null;
        $dentistConversationState = $this->resource->getAttributes()['dentist_conversation_state'] ?? null;

        return [
            'id' => $this->public_id,
            // Server-generated, immutable human-readable reference (never derived by React).
            'code' => $this->appointment_code,
            'status' => $this->status,
            'is_upcoming' => $this->when($request->user()?->role?->value === 'patient',
                fn () => $this->resource->isUpcomingForPatient($request->attributes->get('appointment_day_start') ?? ClinicClock::now()->startOfDay())),
            'source' => $this->source,
            'assignment_method' => $this->assignment_method,
            'revision' => $this->revision,
            'date' => $start->toDateString(),
            'start_time' => $start->format('H:i'),
            'end_time' => $end->format('H:i'),
            'starts_at' => $start->toIso8601String(),
            'ends_at' => $end->toIso8601String(),
            'duration_minutes' => $this->duration_minutes,
            'patient' => ['id' => $this->patient->public_id, 'code' => $this->patient->patient_code, 'name' => $this->patient->person?->fullName()],
            'branch' => ['id' => $this->branch->legacy_ref, 'public_id' => $this->branch->public_id, 'name' => $this->branch->name],
            'service' => ['id' => $this->service->legacy_ref, 'name' => $this->service->name],
            ...($this->intended_service_id ? ['intended_service' => [
                'id' => $this->intendedService->legacy_ref, 'name' => $this->intendedService->name,
            ]] : []),
            ...($this->dentist_conversation_id ? ['dentist_conversation_id' => $this->dentist_conversation_id] : []),
            ...($dentistConversationState ? ['dentist_conversation_state' => $dentistConversationState] : []),
            'dentist' => ['id' => $this->dentist->legacy_ref, 'name' => $this->dentist->person?->fullName()],
            'notes' => $this->notes,
            'booking_fee_php' => $this->booking_fee_php !== null ? (string) $this->booking_fee_php : null,
            'booking_payment_status' => $this->booking_payment_status ?? 'unpaid',
            'booking_hold_expires_at' => $iso($this->booking_hold_expires_at),
            'booking_payment_method' => $this->booking_payment_method,
            'booking_paid_at' => $iso($this->booking_paid_at),
            'booking_refunded_at' => $iso($this->booking_refunded_at),
            'cancellation_refund' => $this->cancellationRefund(),
            'checkout_url' => $this->checkout_url ?? $this->activeCheckoutSession?->checkout_url,
            'checkout_session_id' => $this->checkout_session_id ?? $this->activeCheckoutSession?->provider_session_id,
            'cancellation_category' => $this->when(
                $request->user()?->role?->value === 'staff' ||
                ($request->user()?->role?->value === 'patient' && $this->cancellation_actor_role === 'patient'),
                fn () => $this->cancellation_category,
            ),
            'cancellation_detail' => $this->when(
                $request->user()?->role?->value === 'staff' ||
                ($request->user()?->role?->value === 'patient' && $this->cancellation_actor_role === 'patient'),
                fn () => $this->cancellation_detail,
            ),
            'cancelled_at' => $iso($this->cancelled_at),
            'created_at' => $iso($this->created_at),
            'updated_at' => $iso($this->updated_at),
            'history' => $this->whenLoaded('history', fn () => $this->history->map(fn ($h) => [
                'event' => $h->event,
                'from_status' => $h->from_status,
                'to_status' => $h->to_status,
                'revision' => $h->revision,
                'starts_at' => $iso($h->starts_at),
                'ends_at' => $iso($h->ends_at),
                'actor_role' => $h->actor_role,
                'occurred_at' => $iso($h->occurred_at),
            ])),
        ];
    }
}

<?php

namespace App\Http\Resources;

use App\Support\ClinicClock;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

// Public queue-entry shape (Staff / Dentist / Owner). `id`, `visit.id`, `patient.id` and `appointment.id` are ULID
// public_ids; branch/service/Dentist use their transitional legacy_ref ids. `position` is computed by the server
// (null while Temporarily Away or once Served). Patient, arrival, service and appointment come from the Visit — the
// queue entry does not copy them. `status` is the real queue status; the Visit's status is returned alongside so a
// client can present a broader encounter phase without writing it back into the queue.
class QueueEntryResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $iso = fn ($value) => $value ? ClinicClock::local($value)->toIso8601String() : null;
        $visit = $this->visit;
        $queue = $this->dentistQueue;
        $service = $visit->appointment?->service ?? $visit->requestedService;

        return [
            'id' => $this->public_id,
            'status' => $this->status,
            'priority' => $this->priority,
            'priority_reason' => $this->priority_reason,
            'late_arrival' => (bool) $this->late_arrival,
            'queue_number' => $this->queue_number,
            'position' => $this->getAttribute('position'),
            'branch_position' => $this->when(in_array($request->user()?->role?->value, ['staff', 'owner'], true), $this->getAttribute('branch_position')),
            'revision' => $this->revision,
            'clinic_date' => $queue->clinic_date->format('Y-m-d'),
            'closed_at' => $iso($this->closed_at),
            'branch' => ['id' => $queue->branch->legacy_ref, 'name' => $queue->branch->name],
            'dentist' => ['id' => $queue->dentist->legacy_ref, 'name' => $queue->dentist->person?->fullName()],
            'visit' => ['id' => $visit->public_id, 'status' => $visit->status, 'source' => $visit->source, 'revision' => $visit->revision, 'arrived_at' => $iso($visit->arrived_at)],
            'patient' => ['id' => $visit->patient->public_id, 'code' => $visit->patient->patient_code, 'name' => $visit->patient->person?->fullName()],
            'service' => $service ? ['id' => $service->legacy_ref, 'name' => $service->name] : null,
            'appointment' => $visit->appointment ? [
                'id' => $visit->appointment->public_id,
                'code' => $visit->appointment->appointment_code,
                'status' => $visit->appointment->status,
                'start_time' => ClinicClock::local($visit->appointment->starts_at)->format('H:i'),
            ] : null,
            'updated_at' => $iso($this->updated_at),
            'history' => $this->whenLoaded('history', fn () => $this->history->map(fn ($h) => [
                'event' => $h->event,
                'from_status' => $h->from_status,
                'to_status' => $h->to_status,
                'from_priority' => $h->from_priority,
                'to_priority' => $h->to_priority,
                'priority_reason' => $h->priority_reason,
                'revision' => $h->revision,
                'actor_role' => $h->actor_role,
                'occurred_at' => $iso($h->occurred_at),
            ])),
        ];
    }
}

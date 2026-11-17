<?php

namespace App\Http\Resources;

use App\Enums\Role;
use App\Models\Treatment;
use App\Models\User;
use App\Support\ClinicClock;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

// Public Treatment shapes (decision Q-T6). `id`, `visit.id`, `patient.id`, `appointment.id` and procedure-line ids are
// ULID public_ids; branch/service/Dentist/assistant use their transitional legacy_ref ids. No price, fee or amount exists.
//   clinical (Staff in scope, Dentists): the full clinical record, read or write per TreatmentPolicy;
//   summary  (Owner):                    operational facts only — no complaint, plan, procedure summary, notes,
//                                        follow-up reason or line notes;
//   patient  (the Patient's own):        see PatientTreatmentResource.
// History events are included on detail reads; the per-revision documentation snapshot only for the authoring Dentist.
class TreatmentResource extends JsonResource
{
    public static function modeFor(User $user): string
    {
        return $user->role === Role::Owner ? 'summary' : 'clinical';
    }

    public function toArray(Request $request): array
    {
        /** @var Treatment $t */
        $t = $this->resource;
        $user = $request->user();
        $clinical = self::modeFor($user) === 'clinical';
        $author = $user->role === Role::Dentist && $t->dentist?->person_id === $user->person_id;
        $iso = fn ($value) => $value ? ClinicClock::local($value)->toIso8601String() : null;
        $visit = $t->visit;
        $appointment = $visit->appointment;
        $requested = $appointment?->service ?? $visit->requestedService;

        $body = [
            'id' => $t->public_id,
            'status' => $t->status,
            'revision' => $t->revision,
            'clinic_date' => $visit->clinic_date->format('Y-m-d'),
            'started_at' => $iso($t->started_at),
            'completed_at' => $iso($t->completed_at),
            'author' => $author,
            'visit' => [
                'id' => $visit->public_id,
                'status' => $visit->status,
                'revision' => $visit->revision,
                'source' => $visit->source,
                'queue' => $visit->queueEntry ? ['id' => $visit->queueEntry->public_id, 'status' => $visit->queueEntry->status, 'revision' => $visit->queueEntry->revision] : null,
            ],
            'patient' => ['id' => $visit->patient->public_id, 'code' => $visit->patient->patient_code, 'name' => $visit->patient->person?->fullName()],
            'branch' => ['id' => $visit->branch->legacy_ref, 'name' => $visit->branch->name],
            'dentist' => ['id' => $t->dentist->legacy_ref, 'name' => $t->dentist->person?->fullName()],
            'appointment' => $appointment ? ['id' => $appointment->public_id, 'code' => $appointment->appointment_code, 'status' => $appointment->status] : null,
            'requested_service' => $requested ? ['id' => $requested->legacy_ref, 'name' => $requested->name] : null,
            'prescription_required' => $t->prescription_required,
            'followup_required' => $t->followup_required,
            'procedures' => $t->procedures->map(fn ($line) => [
                'id' => $line->public_id,
                'line_no' => $line->line_no,
                'service' => ['id' => $line->service->legacy_ref, 'code' => $line->service_code, 'name' => $line->service_name],
                'quantity' => $line->quantity,
            ] + ($clinical ? ['notes' => $line->notes] : []))->values()->all(),
        ];

        if ($clinical) {
            $body += [
                'chief_complaint' => $t->chief_complaint,
                'treatment_plan' => $t->treatment_plan,
                'procedure_summary' => $t->procedure_summary,
                'clinical_notes' => $t->clinical_notes,
                'assistant' => $t->assistant ? ['id' => $t->assistant->legacy_ref, 'name' => $t->assistant->person?->fullName()] : null,
                'followup_recommended_date' => $t->followup_recommended_date?->format('Y-m-d'),
                'followup_reason' => $t->followup_reason,
                'followup_reason_category' => $t->followup_reason_category,
                'followup_reason_detail' => $t->followup_reason_category === 'Other' ? $t->followup_reason : null,
                'followup_interval' => $t->followup_interval,
            ];
        }

        if ($t->relationLoaded('history')) {
            $body['history'] = $t->history->map(fn ($h) => [
                'event' => $h->event,
                'from_status' => $h->from_status,
                'to_status' => $h->to_status,
                'revision' => $h->revision,
                'actor_role' => $h->actor_role,
                'occurred_at' => $iso($h->occurred_at),
            ] + ($author ? ['snapshot' => $h->snapshot] : []))->values()->all();
        }

        return $body;
    }
}

<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

// Purpose-specific Patient record projection (M4), in two tiers decided by PatientPolicy for the viewing account:
//   identity (`profile_access: identity`): code, name, phone, date of birth — the existing Patient directory fields.
//   full (`profile_access: full`): adds sex, email, address, emergency contact, preferred branch, revision, timestamps.
// Never clinical history, account/security metadata, internal ids, HMO, billing or document internals. Ids are public ULIDs;
// the branch uses its transitional legacy_ref, as the rest of the reference API does.
class PatientRecordResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $person = $this->person;
        $iso = fn ($value) => $value ? \App\Support\ClinicClock::local($value)->toIso8601String() : null;
        $decision = $request->attributes->get('patient_record_full_'.$this->id);
        $full = is_bool($decision) ? $decision : ($request->user()?->can('viewProfile', $this->resource) ?? false);

        $identity = [
            'id' => $this->public_id,
            'code' => $this->patient_code,
            'name' => $person?->fullName(),
            'first_name' => $person?->first_name,
            'last_name' => $person?->last_name,
            'date_of_birth' => $person?->date_of_birth?->toDateString(),
            'phone' => $person?->phone,
            'profile_access' => $full ? 'full' : 'identity',
        ];

        if (! $full) {
            return $identity;
        }

        return $identity + [
            'sex' => $person?->sex,
            'email' => $person?->email,
            'address' => $person?->address,
            'emergency_contact' => $this->emergency_contact,
            'preferred_branch' => $this->preferredBranch ? ['id' => $this->preferredBranch->legacy_ref, 'name' => $this->preferredBranch->name] : null,
            'has_portal_account' => $person?->user !== null,
            // F8: the patient's own HMO details, for the front desk to check at the visit (information only, no claims).
            'hmo_provider_name' => $this->hmo_provider_name,
            'hmo_member_number' => $this->hmo_member_number,
            // F4: online bookings wait for front-desk confirmation until Staff clear this.
            'confirmation_required' => \App\Services\Automations\AttendancePolicy::needsConfirmation($this->resource),
            'attendance_strikes' => \App\Services\Automations\AttendancePolicy::strikes($this->resource),
            // Intake (R2-03, R2-12): how the record was registered, the in-person ID check (type, who, when; never the number) and,
            // for a minor or dependent, the guardian(s).
            'registration_source' => $this->registration_source,
            'id_check' => $this->id_verified_at ? ['type' => $this->id_type, 'other_details' => $this->id_type === 'other' ? $this->other_details : null, 'last4' => $this->id_last4, 'at' => $iso($this->id_verified_at),
                'by' => \App\Models\User::find($this->id_verified_by_user_id)?->person?->fullName()] : null,
            'has_online_account' => (bool) $this->user?->email_verified_at,
            'minor' => \App\Services\Intake\Guardianship::isMinor($person?->date_of_birth?->toDateString()),
            'guardians' => $this->guardianLinks->map(fn ($l) => ['id' => $l->guardian?->public_id, 'name' => $l->guardian?->person?->fullName(), 'relationship' => $l->relationship, 'relationship_other' => $l->relationship_other])->values(),
            'revision' => $this->revision,
            'created_at' => $iso($this->created_at),
            'updated_at' => $iso($this->updated_at),
        ];
    }
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

// TREATMENTS — the M5 clinical record of one Visit (see the create_treatment_tables migration). The bigint id stays
// internal; routes bind and resources expose the ULID public_id. Changes happen only through TreatmentService's named
// commands (start, document, complete), never a generic update.
class Treatment extends Model
{
    use HasUlids;

    public const EDITABLE = [
        'chief_complaint', 'treatment_plan', 'procedure_summary', 'clinical_notes', 'prescription_required',
        'followup_required', 'followup_recommended_date', 'followup_reason', 'followup_reason_category', 'followup_interval',
    ];

    protected $dateFormat = 'Y-m-d H:i:sP';

    protected $guarded = ['id', 'public_id'];

    protected function casts(): array
    {
        return [
            'started_at' => 'immutable_datetime',
            'completed_at' => 'immutable_datetime',
            'followup_recommended_date' => 'date:Y-m-d',
            'prescription_required' => 'boolean',
            'followup_required' => 'boolean',
            'revision' => 'integer',
        ];
    }

    public function uniqueIds(): array
    {
        return ['public_id'];
    }

    public function getRouteKeyName(): string
    {
        return 'public_id';
    }

    public function visit(): BelongsTo
    {
        return $this->belongsTo(Visit::class);
    }

    public function dentist(): BelongsTo
    {
        return $this->belongsTo(DentistProfile::class, 'dentist_profile_id');
    }

    public function assistant(): BelongsTo
    {
        return $this->belongsTo(StaffProfile::class, 'assistant_staff_profile_id');
    }

    public function procedures(): HasMany
    {
        return $this->hasMany(TreatmentProcedure::class)->orderBy('line_no');
    }

    public function history(): HasMany
    {
        return $this->hasMany(TreatmentHistory::class)->orderBy('id');
    }

    /**
     * The read scope (TreatmentPolicy::view as a query, decision Q-T6/Q-T9). Owner: every Treatment (summary projection).
     * Staff: Visits in the account's branch scopes. Dentist: Treatments they authored, plus COMPLETED Treatments of a
     * Patient for whom they are currently the responsible Dentist on an active Visit. Patients use /treatments/mine.
     */
    public function scopeVisibleTo(Builder $query, User $user): Builder
    {
        return match ($user->role->value) {
            'owner' => $query,
            'staff' => $query->whereHas('visit', fn (Builder $v) => $v->whereIn('branch_id', UserBranchScope::select('branch_id')->where('user_id', $user->id))),
            'dentist' => $query->where(fn (Builder $q) => $q
                ->whereHas('dentist', fn (Builder $d) => $d->where('person_id', $user->person_id))
                ->orWhere(fn (Builder $c) => $c->where('status', 'Completed')->whereHas('visit', fn (Builder $v) => $v->whereIn('patient_id', self::treatingPatients($user))))),
            default => $query->whereRaw('false'),
        };
    }

    /** Patients with an active Visit whose responsible Dentist is this account's Dentist profile (continuity read). */
    public static function treatingPatients(User $user): \Illuminate\Database\Query\Builder
    {
        return Visit::query()->toBase()->select('visits.patient_id')
            ->join('dentist_profiles', 'dentist_profiles.id', '=', 'visits.responsible_dentist_profile_id')
            ->whereIn('visits.status', Visit::ACTIVE_STATUSES)
            ->where('dentist_profiles.person_id', $user->person_id);
    }
}

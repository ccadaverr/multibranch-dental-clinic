<?php

namespace App\Models;

use App\Enums\Role;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

// M17 conversation. Access (Phase 2 decision 3 — front-desk routing):
//   Patient  — their own conversation (participant + the conversation's Patient is their own record);
//   Staff    — EVERY conversation of a branch in their authorization scope (the branch front desk); replying or reading adds them as a
//              participant row (read state), and the first Staff reply becomes the participant of record (`assigned_user_id`);
//   Dentist  — only when Staff added them as a participant AND they are assigned to the conversation's branch;
//   Owner    — none (decision 4), as every other role. Roles alone never grant a conversation.
class Conversation extends Model
{
    use HasUlids;

    protected $dateFormat = 'Y-m-d H:i:sP';

    protected $guarded = ['id', 'public_id'];

    protected function casts(): array
    {
        return ['closed_at' => 'immutable_datetime', 'revision' => 'integer'];
    }

    public function uniqueIds(): array
    {
        return ['public_id'];
    }

    public function getRouteKeyName(): string
    {
        return 'public_id';
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_user_id');
    }

    public function participants(): HasMany
    {
        return $this->hasMany(ConversationParticipant::class);
    }

    public function messages(): HasMany
    {
        return $this->hasMany(ConversationMessage::class)->orderBy('id');
    }

    public function scopeVisibleTo(Builder $query, User $user): Builder
    {
        $participant = fn (Builder $q) => $q->whereHas('participants', fn ($p) => $p->where('user_id', $user->id));

        return match ($user->role) {
            Role::Patient => $participant($query->where('patient_id', $user->patient?->id ?? 0)),
            Role::Staff => $query->whereIn('branch_id', UserBranchScope::select('branch_id')->where('user_id', $user->id)),
            Role::Dentist => $this->dentistScope($participant($query->whereIn('branch_id', DentistProfile::where('person_id', $user->person_id)->join('dentist_branches', 'dentist_branches.dentist_profile_id', '=', 'dentist_profiles.id')->select('dentist_branches.branch_id'))), $user),
            default => $query->whereRaw('false'),
        };
    }

    public function accessibleTo(User $user): bool
    {
        return static::visibleTo($user)->whereKey($this->id)->exists();
    }

    private function dentistScope(Builder $query, User $user): Builder
    {
        // Reviewed-schema cutover only: no grant is inferred for legacy participant rows.
        $grants = app(\App\Services\Messaging\ConversationDentistAccess::class);
        if (! $grants->enforced()) return $query;
        if (! $grants->schemaInstalled()) return $query->whereRaw('false');
        return $query->whereIn('active_dentist_grant_id', ConversationDentistGrant::select('id')->where('dentist_user_id', $user->id)
            ->whereColumn('conversation_id', 'conversations.id')->whereColumn('patient_id', 'conversations.patient_id')->whereColumn('branch_id', 'conversations.branch_id'));
    }
}

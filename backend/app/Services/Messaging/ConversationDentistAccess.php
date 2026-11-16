<?php

namespace App\Services\Messaging;

use App\Enums\Role;
use App\Models\CommandKey;
use App\Models\Conversation;
use App\Models\ConversationDentistGrant;
use App\Models\DentistProfile;
use App\Models\User;
use App\Models\UserBranchScope;
use App\Services\Audit\AuditService;
use App\Services\Visits\VisitCommandException;
use App\Support\IdempotentCommand;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Schema;

/** DEN-14 explicit grant command. Deployment/routing cutover requires the separately reviewed grant schema. */
final class ConversationDentistAccess
{
    public function available(): bool
    {
        return config('messaging.conversation_grants_enabled') && $this->schemaInstalled();
    }

    public function schemaInstalled(): bool
    {
        return Schema::hasTable('conversation_dentist_grants') && Schema::hasColumn('conversations', 'active_dentist_grant_id');
    }

    public function enforced(): bool
    {
        // Installing the reviewed schema is a one-way authorization cutover. Disabling new grants never revives legacy access.
        return config('messaging.conversation_grants_enabled') || $this->schemaInstalled();
    }

    public function permits(User $actor, Conversation $conversation): bool
    {
        if (! $this->schemaInstalled()) return false;
        $actor = User::find($actor->id);
        if (! $actor || $actor->role !== Role::Dentist || $actor->account_status !== 'Active' || $actor->deleted_at) return false;
        return ConversationDentistGrant::whereKey(Conversation::whereKey($conversation->id)->value('active_dentist_grant_id'))
            ->where('conversation_id', $conversation->id)->where('patient_id', $conversation->patient_id)->where('branch_id', $conversation->branch_id)
            ->where('dentist_user_id', $actor->id)
            ->whereIn('branch_id', DentistProfile::where('person_id', $actor->person_id)->join('dentist_branches', 'dentist_branches.dentist_profile_id', '=', 'dentist_profiles.id')->select('dentist_branches.branch_id'))->exists();
    }

    public function reassign(User $actor, Conversation $conversation, string $dentistPublicId, int $revision, string $reason, string $key): JsonResponse
    {
        if (! $this->available()) throw new VisitCommandException(409, 'conversation_grants_unavailable', 'Dentist reassignment is unavailable. No access was changed. Contact the clinic administrator.');
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason) > 500 || $key === '') throw VisitCommandException::rule('grant_details_required', 'A reason and original request key are required.', 'reason');
        return \Illuminate\Support\Facades\DB::transaction(function () use ($actor, $conversation, $dentistPublicId, $revision, $reason, $key) {
            $current = Conversation::whereKey($conversation->id)->lockForUpdate()->firstOrFail();
            $staff = $this->staff($actor, $current, true);
            return $this->command($staff, $current, $dentistPublicId, $revision, $reason, $key)->header('Cache-Control', 'private, no-store');
        }, 3);
    }

    private function command(User $actor, Conversation $conversation, string $dentistPublicId, int $revision, string $reason, string $key): JsonResponse
    {
        // Current Staff authority also applies to lost-response replays (the idempotency callback does not run on replay).
        $this->staff($actor, $conversation);
        return IdempotentCommand::run(CommandKey::class, $actor, $key, 'conversation.dentist.reassign',
            ['conversation' => $conversation->id, 'dentist' => strtolower($dentistPublicId), 'revision' => $revision,
                'reason' => hash_hmac('sha256', $reason, (string) config('app.key'))],
            function () use ($actor, $conversation, $dentistPublicId, $revision, $reason) {
                $current = Conversation::whereKey($conversation->id)->lockForUpdate()->firstOrFail();
                $staff = $this->staff($actor, $current, true);
                if ($current->status !== 'Open') throw VisitCommandException::rule('conversation_closed', 'This conversation is closed.', 'conversation');
                if ($current->revision !== $revision) throw new VisitCommandException(409, 'stale_revision', 'This conversation changed. Reload before reassigning it.');
                $dentist = User::where('public_id', strtolower($dentistPublicId))->lockForUpdate()->first();
                if (! $dentist || $dentist->role !== Role::Dentist || $dentist->account_status !== 'Active' || $dentist->deleted_at
                    || ! DentistProfile::where('person_id', $dentist->person_id)->whereHas('branches', fn ($q) => $q->where('branches.id', $current->branch_id))->exists()) {
                    throw VisitCommandException::rule('dentist_not_available', 'Choose an active Dentist permitted at this branch.', 'dentist_id');
                }
                if (! $current->patient()->exists() || ! $current->branch()->exists()) throw new VisitCommandException(409, 'conversation_scope_invalid', 'The conversation identity could not be confirmed.');
                $previous = $current->active_dentist_grant_id ? ConversationDentistGrant::findOrFail($current->active_dentist_grant_id) : null;
                if ($previous?->dentist_user_id === $dentist->id) return [['data' => $this->receipt($current, $previous, $dentist, false)], 200];
                $grant = ConversationDentistGrant::create(['conversation_id' => $current->id, 'patient_id' => $current->patient_id,
                    'branch_id' => $current->branch_id, 'dentist_user_id' => $dentist->id, 'previous_dentist_user_id' => $previous?->dentist_user_id,
                    'authorized_by_user_id' => $staff->id, 'reason' => $reason, 'revision' => $current->revision + 1]);
                $current->update(['active_dentist_grant_id' => $grant->id, 'revision' => $grant->revision]);
                \App\Models\ConversationParticipant::firstOrCreate(['conversation_id' => $current->id, 'user_id' => $dentist->id], ['created_at' => now()]);
                app(AuditService::class)->record(['action' => 'conversation.dentist_reassigned', 'category' => 'administrative',
                    'actor' => $staff, 'target' => $current, 'branch_id' => $current->branch_id,
                    'payload' => ['grant' => $grant->public_id, 'previous_dentist' => $previous ? User::find($previous->dentist_user_id)?->public_id : null,
                        'new_dentist' => $dentist->public_id, 'reason_recorded' => true, 'revision' => $grant->revision]]);
                $channels = [$dentist->public_id, $current->patient?->user?->public_id];
                if ($previous) $channels[] = User::find($previous->dentist_user_id)?->public_id;
                // The former Dentist receives only this content-free access-change signal, never future message signals.
                RealtimeEvents::afterCommit(new \App\Events\Messaging\ConversationChanged($current->public_id, 'dentist_reassigned', $current->status,
                    $current->branch->public_id, array_values(array_unique(array_filter($channels)))));
                return [['data' => $this->receipt($current, $grant, $dentist, true)], 201];
            },
            fn () => VisitCommandException::rule('idempotency_key_reused', 'The original request key cannot be used for different reassignment details.', 'idempotency_key'),
            null, 3);
    }

    private function receipt(Conversation $conversation, ConversationDentistGrant $grant, User $dentist, bool $changed): array
    {
        return ['id' => $conversation->public_id, 'grant_id' => $grant->public_id, 'dentist_id' => $dentist->public_id,
            'patient_id' => $conversation->patient->public_id, 'branch_id' => $conversation->branch->legacy_ref,
            'revision' => $conversation->revision, 'changed' => $changed];
    }

    private function staff(User $actor, Conversation $conversation, bool $lock = false): User
    {
        $query = User::whereKey($actor->id);
        if ($lock) $query->lockForUpdate();
        $current = $query->first();
        $scope = UserBranchScope::where('user_id', $actor->id)->where('branch_id', $conversation->branch_id);
        if ($lock) $scope->lockForUpdate();
        if (! $current || $current->role !== Role::Staff || $current->account_status !== 'Active' || $current->deleted_at || ! $scope->first()) {
            throw new VisitCommandException(403, 'forbidden', 'Only currently authorized branch Staff can reassign this conversation.');
        }
        return $current;
    }
}

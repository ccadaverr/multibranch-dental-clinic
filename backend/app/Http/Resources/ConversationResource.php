<?php

namespace App\Http\Resources;

use App\Support\ClinicClock;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

// Conversation SUMMARY: deliberately carries no message text (lists must not leak bodies). `unread` counts other participants'
// messages this account has not yet opened, in this application only. `participants` are the OTHER participants by display name and role.
class ConversationResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $c = $this->resource;
        $me = $request->user()->id;
        $iso = fn ($v) => $v ? ClinicClock::local($v instanceof \DateTimeInterface ? $v : \Carbon\CarbonImmutable::parse($v))->toIso8601String() : null;
        $grants = app(\App\Services\Messaging\ConversationDentistAccess::class);
        $strict = $grants->enforced();
        $activeDentist = $strict && $grants->schemaInstalled()
            ? \App\Models\ConversationDentistGrant::whereKey($c->active_dentist_grant_id)->value('dentist_user_id') : null;

        return [
            'id' => $c->public_id,
            'context' => $c->context,
            'status' => $c->status,
            'revision' => $c->revision,
            'patient' => ['id' => $c->patient->public_id, 'code' => $c->patient->patient_code, 'name' => $c->patient->person?->fullName()],
            // `ref` is the branch public id used for the realtime channel names; `id` stays the legacy reference existing screens use.
            'branch' => ['id' => $c->branch->legacy_ref, 'ref' => strtolower((string) $c->branch->public_id), 'name' => $c->branch->name],
            // A Patient sees the participant of record and any Dentist brought in — not every branch Staff member who opened the thread.
            'participants' => $c->participants->filter(fn ($p) => $p->user_id !== $me)
                ->filter(fn ($p) => ! $strict || $p->user->role !== \App\Enums\Role::Dentist || $p->user_id === $activeDentist)
                ->filter(fn ($p) => $request->user()->role !== \App\Enums\Role::Patient || $p->user_id === $c->assigned_user_id || $p->user->role === \App\Enums\Role::Dentist)
                ->map(fn ($p) => ['name' => $p->user->person?->fullName(), 'role' => ucfirst($p->user->role->value)])->values()->all(),
            // The participant of record: the first Staff member who replied (null until someone does).
            'assigned' => $c->assigned_user_id ? ['name' => $c->assignee?->person?->fullName(), 'mine' => $c->assigned_user_id === $me] : null,
            'unread' => (int) ($c->unread_count ?? 0),
            'last_message_at' => $iso($c->last_message_at ?? null),
            'closed_at' => $iso($c->closed_at),
        ];
    }
}

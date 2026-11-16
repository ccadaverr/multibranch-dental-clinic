<?php

namespace App\Events\Messaging;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

/** A conversation was started, assigned, closed or gained a Dentist participant. Identifiers and status only; clients re-read the list. */
class ConversationChanged implements ShouldBroadcastNow
{
    /** @param list<string> $userIds */
    public function __construct(public string $conversationId, public string $change, public string $status, public string $branchId, public array $userIds) {}

    public function broadcastOn(): array
    {
        // Channel names are always lower-case (ULIDs are case-insensitive; clients subscribe with lower-case ids).
        $strict = app(\App\Services\Messaging\ConversationDentistAccess::class)->enforced();
        $ids = $strict && $this->change !== 'dentist_reassigned'
            ? \App\Services\Messaging\AuthorizedSignals::recipients($this->conversationId, $this->userIds) : $this->userIds;
        return [...($strict ? [] : [new PrivateChannel('conversation.'.strtolower($this->conversationId))]), new PrivateChannel('branch-inbox.'.strtolower($this->branchId)),
            ...array_map(fn ($id) => new PrivateChannel('user.'.strtolower($id)), $ids)];
    }

    public function broadcastAs(): string
    {
        return 'conversation.changed';
    }

    public function broadcastWith(): array
    {
        return ['conversation_id' => $this->conversationId, 'change' => $this->change, 'status' => $this->status];
    }
}

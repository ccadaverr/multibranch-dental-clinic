<?php

namespace App\Events\Messaging;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

/**
 * A new message exists. The payload is a SIGNAL with identifiers only — never the message text, sender name or Patient details — so the
 * socket server never handles content. On receipt the client reads GET /api/conversations/{id}/messages?after=…, the same endpoint the
 * polling fallback uses, so both paths produce the identical projection.
 */
class MessagePosted implements ShouldBroadcastNow
{
    /** @param list<string> $userIds public ids of the patient/dentist accounts whose inbox should refresh */
    public function __construct(public string $conversationId, public string $messageId, public string $senderRole, public string $branchId, public array $userIds) {}

    public function broadcastOn(): array
    {
        // Channel names are always lower-case (ULIDs are case-insensitive; clients subscribe with lower-case ids).
        $strict = app(\App\Services\Messaging\ConversationDentistAccess::class)->enforced();
        $ids = $strict ? \App\Services\Messaging\AuthorizedSignals::recipients($this->conversationId, $this->userIds) : $this->userIds;
        return [...($strict ? [] : [new PrivateChannel('conversation.'.strtolower($this->conversationId))]), new PrivateChannel('branch-inbox.'.strtolower($this->branchId)),
            ...array_map(fn ($id) => new PrivateChannel('user.'.strtolower($id)), $ids)];
    }

    public function broadcastAs(): string
    {
        return 'message.posted';
    }

    public function broadcastWith(): array
    {
        return ['conversation_id' => $this->conversationId, 'message_id' => $this->messageId, 'sender_role' => $this->senderRole];
    }
}

<?php

namespace App\Services\Messaging;

use App\Models\Conversation;
use App\Models\User;

/** Revalidate delayed signal recipients; already-subscribed conversation channels cannot be revoked by a later API check. */
final class AuthorizedSignals
{
    public static function recipients(string $conversationId, array $ids): array
    {
        $conversation = Conversation::where('public_id', $conversationId)->first();
        if (! $conversation) return [];
        return User::whereIn('public_id', $ids)->where('account_status', 'Active')->get()
            ->filter(fn ($user) => $conversation->accessibleTo($user))->pluck('public_id')->all();
    }
}

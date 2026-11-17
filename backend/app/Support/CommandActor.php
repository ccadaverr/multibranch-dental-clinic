<?php

namespace App\Support;

use App\Models\User;
use Closure;
use Illuminate\Support\Facades\DB;

/** Current account authority must precede both a write and an idempotent receipt disclosure. */
final class CommandActor
{
    public static function run(User $observed, Closure $work): mixed
    {
        return DB::transaction(function () use ($observed, $work) {
            $current = User::whereKey($observed->id)->lock('FOR NO KEY UPDATE')->first();
            abort_unless($current && $current->account_status === 'Active'
                && $current->auth_version === $observed->auth_version && $current->role === $observed->role, 403);

            return $work($current);
        }, 3);
    }
}

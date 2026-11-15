<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;

/** An identity-specific notification written by a real server event (App\Services\Notifications\NotificationCenter). */
class UserNotification extends Model
{
    // timestamptz columns: write the offset, or PostgreSQL reads a UTC wall-clock time as Asia/Manila (an 8-hour shift).
    protected $dateFormat = 'Y-m-d H:i:sP';

    use HasUlids;

    public const UPDATED_AT = null;

    protected $guarded = ['id', 'public_id'];

    public function uniqueIds(): array
    {
        return ['public_id'];
    }

    public function archive(): \Illuminate\Database\Eloquent\Relations\HasOne
    {
        return $this->hasOne(NotificationArchive::class, 'notification_id');
    }

    protected function casts(): array
    {
        return ['created_at' => 'immutable_datetime', 'read_at' => 'immutable_datetime'];
    }
}

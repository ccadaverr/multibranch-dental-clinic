<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use RuntimeException;

class NotificationArchive extends Model
{
    public $timestamps = false;

    protected $primaryKey = 'notification_id';

    protected $guarded = ['*'];

    protected function casts(): array
    {
        return ['archived_at' => 'immutable_datetime'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new RuntimeException('Notification archives are append-only.'));
        static::deleting(fn () => throw new RuntimeException('Notification archives are append-only.'));
    }
}

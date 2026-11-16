<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;

/** Immutable explicit clinical conversation grant; it never grants rights to other clinical records. */
final class ConversationDentistGrant extends Model
{
    use HasUlids;

    public $timestamps = false;
    protected $guarded = ['id', 'public_id'];

    public function uniqueIds(): array { return ['public_id']; }

    protected function casts(): array
    {
        return ['reason' => 'encrypted', 'created_at' => 'immutable_datetime', 'revision' => 'integer'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new \RuntimeException('Conversation grants are append-only.'));
        static::deleting(fn () => throw new \RuntimeException('Conversation grants are append-only.'));
    }
}

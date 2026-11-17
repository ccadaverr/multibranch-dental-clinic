<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/** One clinic-approved (or draft) answer of the Clinic Assistant's knowledge base. */
class AssistantAnswer extends Model
{
    public const CATEGORIES = ['about', 'services', 'branches', 'hours', 'booking', 'changes', 'payment', 'account', 'contact', 'care', 'hmo', 'other'];

    // timestamptz columns: write the offset, or PostgreSQL reads a UTC wall-clock time as Asia/Manila (an 8-hour shift).
    protected $dateFormat = 'Y-m-d H:i:sP';

    protected $fillable = ['seed_key', 'question', 'answer', 'keywords', 'category', 'category_detail', 'branch_id', 'active', 'draft', 'source'];

    protected function casts(): array
    {
        return ['keywords' => 'array', 'active' => 'boolean', 'draft' => 'boolean', 'revision' => 'integer'];
    }

    protected static function booted(): void
    {
        static::creating(fn (self $a) => $a->public_id ??= strtolower((string) Str::ulid()));
    }

    public function getRouteKeyName(): string
    {
        return 'public_id';
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}

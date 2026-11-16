<?php

namespace App\Models;

use App\Enums\Role;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

class AuditLog extends Model
{
    use HasFactory, HasUlids;

    public $timestamps = false;

    public const CATEGORIES = [
        'security',
        'clinical',
        'financial',
        'administrative',
        'automation',
        'general',
    ];

    public const SEVERITIES = [
        'info',
        'warning',
        'critical',
    ];

    // Nothing is mass-assignable: audit rows are written only by AuditService, which sets every column explicitly (actor,
    // action, target and the server timestamp are never taken from a client or from mass assignment).
    protected $fillable = [];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'created_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        // Application-level guard in addition to the database triggers (migration 2026_10_13_000100).
        static::updating(fn () => throw new RuntimeException('Audit logs are append-only and cannot be modified.'));
        static::deleting(fn () => throw new RuntimeException('Audit logs are immutable and cannot be deleted.'));
    }

    public function uniqueIds(): array
    {
        return ['public_id'];
    }

    public function getRouteKeyName(): string
    {
        return 'public_id';
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class, 'branch_id');
    }

    /**
     * Audit logs are strictly append-only. Updates and deletes are disallowed.
     */
    public function update(array $attributes = [], array $options = []): bool
    {
        throw new RuntimeException('Audit logs are append-only and cannot be modified.');
    }

    public function delete(): ?bool
    {
        throw new RuntimeException('Audit logs are immutable and cannot be deleted.');
    }

    /** Free-text search. LIKE metacharacters in the term are literal, never wildcards. */
    public function scopeSearch(Builder $query, ?string $term): Builder
    {
        $term = trim((string) $term);
        if ($term === '') {
            return $query;
        }
        $like = '%'.addcslashes($term, '%_\\').'%';

        return $query->where(function (Builder $q) use ($like) {
            $q->where('action', 'ilike', $like)
                ->orWhere('actor_name', 'ilike', $like)
                ->orWhere('auditable_public_id', 'ilike', $like)
                ->orWhere('auditable_type', 'ilike', $like)
                ->orWhere('ip_address', 'ilike', $like);
        });
    }

    /** The branch ID is resolved once from the request's public reference. */
    public function scopeForBranch(Builder $query, ?int $branchId): Builder
    {
        return $branchId === null ? $query : $query->where('branch_id', $branchId);
    }

    /**
     * Scope for category filter.
     */
    public function scopeByCategory(Builder $query, ?string $category): Builder
    {
        if (empty($category) || $category === 'all') {
            return $query;
        }

        return $query->where('category', $category);
    }

    /**
     * Scope for severity filter.
     */
    public function scopeBySeverity(Builder $query, ?string $severity): Builder
    {
        if (empty($severity) || $severity === 'all') {
            return $query;
        }

        return $query->where('severity', $severity);
    }
}

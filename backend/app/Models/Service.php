<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

// SERVICES — see the create_services_table migration comment and the Phase 2A plan, section C/F.
// No getRouteKeyName() override: this table has no mutation route this phase (no current UI edits the
// catalog directly), so no route-binding concern exists for it.
class Service extends Model
{
    use HasFactory;

    protected $fillable = [
        'legacy_ref',
        'code',
        'name',
        'duration_minutes',
        'reference_fee_php',
        'category',
        'status',
        'description',
    ];

    protected function casts(): array
    {
        return [
            'duration_minutes' => 'integer',
            'reference_fee_php' => 'decimal:2',
        ];
    }

    public function branchServices(): HasMany
    {
        return $this->hasMany(BranchService::class);
    }

    public function consultationService(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(self::class, 'consultation_service_id');
    }

    public function dentistServiceAssignments(): HasMany
    {
        return $this->hasMany(DentistServiceAssignment::class);
    }
}

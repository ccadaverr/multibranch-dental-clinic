<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

// DENTIST_SERVICE_ASSIGNMENTS — see the create_dentist_service_assignments_table migration comment and the
// Phase 2A plan, section C/D. Qualifications are maintained through the Owner Dentist profile command.
class DentistServiceAssignment extends Model
{
    use HasFactory;

    protected $fillable = [
        'dentist_profile_id',
        'service_id',
        'is_authorized',
    ];

    protected function casts(): array
    {
        return [
            'is_authorized' => 'boolean',
        ];
    }

    public function dentistProfile(): BelongsTo
    {
        return $this->belongsTo(DentistProfile::class);
    }

    public function service(): BelongsTo
    {
        return $this->belongsTo(Service::class);
    }
}

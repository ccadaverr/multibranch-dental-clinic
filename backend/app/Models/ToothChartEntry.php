<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** M10: one recorded finding for one tooth (append-only history; the latest entry per tooth is the current chart). */
class ToothChartEntry extends Model
{
    use HasUlids;

    public const UPDATED_AT = null;

    protected $dateFormat = 'Y-m-d H:i:sP';

    protected $guarded = ['id', 'public_id'];

    protected function casts(): array
    {
        return ['surfaces' => 'array', 'note' => 'encrypted', 'recorded_on' => 'date:Y-m-d'];
    }

    public function uniqueIds(): array { return ['public_id']; }

    public function patient(): BelongsTo { return $this->belongsTo(Patient::class); }

    public function dentist(): BelongsTo { return $this->belongsTo(DentistProfile::class, 'dentist_profile_id'); }

    public function branch(): BelongsTo { return $this->belongsTo(Branch::class); }

    public function plannedService(): BelongsTo { return $this->belongsTo(Service::class, 'planned_service_id'); }

    public function completedProcedure(): BelongsTo { return $this->belongsTo(TreatmentProcedure::class, 'completed_procedure_id'); }

    public function treatment(): BelongsTo { return $this->belongsTo(Treatment::class); }
}

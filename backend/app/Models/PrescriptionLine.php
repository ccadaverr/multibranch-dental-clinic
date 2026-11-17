<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** M19: one free-text medicine line (encrypted at rest). Changes only while its prescription is a Draft. */
class PrescriptionLine extends Model
{
    protected $dateFormat = 'Y-m-d H:i:sP';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['medicine' => 'encrypted', 'dosage' => 'encrypted', 'frequency' => 'encrypted', 'duration' => 'encrypted', 'instructions' => 'encrypted', 'line_no' => 'integer', 'value_origins' => 'array'];
    }

    public function prescription(): BelongsTo { return $this->belongsTo(Prescription::class); }
}

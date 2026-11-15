<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;

class StaffRosterDraft extends Model
{
    use HasUlids;

    protected $dateFormat = 'Y-m-d H:i:sP';

    protected $guarded = ['id', 'public_id'];

    public function uniqueIds(): array { return ['public_id']; }

    protected function casts(): array { return ['on_date' => 'immutable_date', 'revision' => 'integer', 'effective_from'=>'immutable_date', 'effective_until'=>'immutable_date', 'weekdays'=>'array', 'exceptions'=>'array']; }

    public function branch(): \Illuminate\Database\Eloquent\Relations\BelongsTo { return $this->belongsTo(Branch::class); }
    public function staff(): \Illuminate\Database\Eloquent\Relations\BelongsTo { return $this->belongsTo(StaffProfile::class,'staff_profile_id'); }
}

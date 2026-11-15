<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** M15: a leave request of a dentist or staff member. The private note is encrypted at rest. */
class LeaveRequest extends Model
{
    use HasUlids;

    public const TYPES = ['vacation' => 'Vacation', 'sick' => 'Sick', 'other' => 'Other'];

    protected $dateFormat = 'Y-m-d H:i:sP';

    protected $guarded = ['id', 'public_id'];

    protected function casts(): array
    {
        return ['starts_at' => 'immutable_datetime', 'ends_at' => 'immutable_datetime', 'decided_at' => 'immutable_datetime', 'cancelled_at' => 'immutable_datetime',
            'patients_notified_at' => 'immutable_datetime', 'private_note' => 'encrypted', 'revision' => 'integer'];
    }

    public function uniqueIds(): array { return ['public_id']; }

    public function getRouteKeyName(): string { return 'public_id'; }

    public function requester(): BelongsTo { return $this->belongsTo(User::class, 'requester_user_id'); }

    public function decider(): BelongsTo { return $this->belongsTo(User::class, 'decided_by_user_id'); }

    public function dentist(): BelongsTo { return $this->belongsTo(DentistProfile::class, 'dentist_profile_id'); }

    public function staffProfile(): BelongsTo { return $this->belongsTo(StaffProfile::class, 'staff_profile_id'); }
}

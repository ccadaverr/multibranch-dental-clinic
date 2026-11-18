<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
class Invoice extends Model {
    use HasUlids;
    protected $dateFormat = 'Y-m-d H:i:sP';
    protected $guarded=['id','public_id'];
    protected function casts(): array { return ['gross_amount'=>'decimal:2','discount_amount'=>'decimal:2','hmo_coverage_amount'=>'decimal:2','patient_responsibility_amount'=>'decimal:2','paid_amount'=>'decimal:2','hmo_approved_amount'=>'decimal:2','issued_at'=>'immutable_datetime','paid_at'=>'immutable_datetime','revision'=>'integer']; }
    public function uniqueIds(): array { return ['public_id']; }
    public function getRouteKeyName(): string { return 'public_id'; }
    public function treatment(): BelongsTo { return $this->belongsTo(Treatment::class); }
    public function visit(): BelongsTo { return $this->belongsTo(Visit::class); }
    public function patient(): BelongsTo { return $this->belongsTo(Patient::class); }
    public function branch(): BelongsTo { return $this->belongsTo(Branch::class); }
    public function lines(): HasMany { return $this->hasMany(InvoiceLine::class)->orderBy('line_no'); }
    public function payment(): HasOne { return $this->hasOne(Payment::class); }
    public function receipt(): HasOne { return $this->hasOne(Receipt::class); }
    public function histories(): HasMany { return $this->hasMany(InvoiceHistory::class)->orderBy('id'); }
    public function bookingCredit(): ?array
    {
        $issued = $this->relationLoaded('histories')
            ? $this->histories->firstWhere('event', 'invoice.issued')
            : $this->histories()->where('event', 'invoice.issued')->first();

        return $issued?->snapshot['booking_credit'] ?? null;
    }
    public function balance(): string { $toCents=function($v){$p=explode('.',(string)$v);return ((int)$p[0])*100+(int)str_pad($p[1]??'0',2,'0');}; $c=$toCents($this->patient_responsibility_amount)-$toCents($this->paid_amount); return number_format($c/100,2,'.',''); }
    public function getBalanceAttribute(): string { return $this->balance(); }
    public function scopeVisibleTo(Builder $query, User $user): Builder {
        return match($user->role->value) {
            'owner' => $query,
            'staff' => $query->whereIn('branch_id', UserBranchScope::select('branch_id')->where('user_id',$user->id)),
            'patient' => $query->whereIn('patient_id', \App\Services\Intake\Guardianship::patientIdsFor($user) ?: [0]), // own and dependents'
            default => $query->whereRaw('false'),
        };
    }
}

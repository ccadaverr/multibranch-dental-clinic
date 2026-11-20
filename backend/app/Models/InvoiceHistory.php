<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
class InvoiceHistory extends Model {
    public const CASH_REVIEW_REQUESTED = 'invoice.cash_correction_requested';
    public const CASH_REVIEW_ACKNOWLEDGED = 'invoice.cash_correction_acknowledged';
    public const CASH_REVIEW_REASONS = ['refund_requested', 'suspected_duplicate', 'collection_discrepancy'];

    public $timestamps=false; protected $dateFormat = 'Y-m-d H:i:sP'; protected $guarded=['id']; protected function casts():array{return ['snapshot'=>'array','occurred_at'=>'immutable_datetime'];} public function invoice():BelongsTo{return $this->belongsTo(Invoice::class);} public function actor():BelongsTo{return $this->belongsTo(User::class,'actor_user_id');}
}

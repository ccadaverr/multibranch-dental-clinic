<?php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LeaveCommandReceipt extends Model
{
    public $timestamps = false;
    protected $guarded = ['id'];
    protected $hidden = ['receipt','fingerprint'];
    protected function casts(): array { return ['receipt'=>'encrypted:array','http_status'=>'integer']; }
}

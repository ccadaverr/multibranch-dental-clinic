<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('patient_booking_drafts', function (Blueprint $table) {
            $table->foreignId('patient_id')->primary()->constrained('patients')->restrictOnDelete();
            $table->unsignedBigInteger('revision');
            $table->jsonb('selection')->nullable();
            $table->timestampTz('expires_at')->nullable()->index();
            $table->timestampTz('updated_at');
        });
        DB::statement('ALTER TABLE patient_booking_drafts ENABLE ROW LEVEL SECURITY');
        DB::statement('REVOKE ALL ON patient_booking_drafts FROM PUBLIC');
        foreach (['anon', 'authenticated'] as $role) {
            if (DB::table('pg_roles')->where('rolname', $role)->exists()) {
                DB::statement("REVOKE ALL ON patient_booking_drafts FROM $role");
            }
        }
    }
};

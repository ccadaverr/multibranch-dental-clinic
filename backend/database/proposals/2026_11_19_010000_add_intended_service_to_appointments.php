<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('appointments', function (Blueprint $table) {
            $table->foreignId('intended_service_id')->nullable()->index()->constrained('services')->restrictOnDelete();
        });
        DB::statement('ALTER TABLE appointments ADD CONSTRAINT appointments_intended_service_differs
            CHECK (intended_service_id IS NULL OR intended_service_id <> service_id)');
    }
};

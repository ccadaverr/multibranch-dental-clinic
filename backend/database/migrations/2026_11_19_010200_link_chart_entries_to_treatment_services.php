<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('tooth_chart_entries', function (Blueprint $table) {
            $table->foreignId('planned_service_id')->nullable()->constrained('services')->restrictOnDelete();
            $table->foreignId('completed_procedure_id')->nullable()->constrained('treatment_procedures')->restrictOnDelete();
        });
        DB::statement('ALTER TABLE tooth_chart_entries ADD CONSTRAINT chart_single_treatment_link CHECK (
            num_nonnulls(planned_service_id, completed_procedure_id) <= 1 AND
            (num_nonnulls(planned_service_id, completed_procedure_id) = 0 OR treatment_id IS NOT NULL))');
    }
};

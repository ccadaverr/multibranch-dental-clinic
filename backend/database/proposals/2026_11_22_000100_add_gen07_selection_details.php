<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('assistant_answers', fn (Blueprint $table) => $table->string('category_detail', 255)->nullable());
        Schema::table('appointments', function (Blueprint $table) {
            $table->string('cancellation_category', 100)->nullable();
            $table->string('cancellation_detail', 255)->nullable();
            $table->string('cancellation_actor_role', 20)->nullable();
        });
        Schema::table('followup_tasks', fn (Blueprint $table) => $table->string('reason_category', 100)->nullable());
        Schema::table('treatments', fn (Blueprint $table) => $table->string('followup_reason_category', 100)->nullable());
        Schema::table('prescription_lines', fn (Blueprint $table) => $table->jsonb('value_origins')->nullable());
    }

    public function down(): void
    {
        throw new LogicException('Restore a reviewed snapshot to roll back category provenance.');
    }
};

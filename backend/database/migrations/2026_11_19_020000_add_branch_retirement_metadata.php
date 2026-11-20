<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// R14. The business record is never physically removed: all Visit, appointment,
// payment, and audit foreign keys keep pointing at the original branch ID.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->timestampTz('archived_at')->nullable();
            $table->foreignId('archived_by_user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('archive_reason', 300)->nullable();
            $table->index('archived_at', 'branches_archived_at_index');
        });
    }

    public function down(): void
    {
        // Rolling back destroys retirement metadata. Never roll this back as a
        // recovery shortcut on a populated clinic database.
        Schema::table('branches', function (Blueprint $table) {
            $table->dropIndex('branches_archived_at_index');
            $table->dropConstrainedForeignId('archived_by_user_id');
            $table->dropColumn(['archived_at', 'archive_reason']);
        });
    }
};

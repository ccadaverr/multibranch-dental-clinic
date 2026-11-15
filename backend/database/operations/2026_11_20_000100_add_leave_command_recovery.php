<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('leave_requests', fn (Blueprint $table) => $table->unsignedInteger('revision')->default(1));
        DB::statement('ALTER TABLE leave_requests ADD CONSTRAINT leave_revision_positive CHECK (revision > 0)');
        Schema::create('leave_command_receipts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->uuid('operation_id');
            $table->foreignId('leave_request_id')->constrained('leave_requests')->restrictOnDelete();
            $table->foreignId('audit_log_id')->unique()->constrained('audit_logs')->restrictOnDelete();
            $table->string('action', 16);
            $table->char('fingerprint', 64);
            $table->text('receipt'); // encrypted:array, never private note in audit metadata.
            $table->unsignedSmallInteger('http_status');
            $table->timestampTz('created_at')->useCurrent();
            $table->unique(['actor_user_id', 'operation_id']);
        });
        DB::statement("ALTER TABLE leave_command_receipts ADD CONSTRAINT leave_command_kind CHECK (action IN ('create','approve','decline','cancel') AND http_status IN (200,201))");
        DB::unprepared(<<<'SQL'
CREATE FUNCTION leave_command_receipts_guard() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Leave command receipts are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER leave_command_receipts_no_changes BEFORE UPDATE OR DELETE ON leave_command_receipts FOR EACH ROW EXECUTE FUNCTION leave_command_receipts_guard();
CREATE TRIGGER leave_command_receipts_no_truncate BEFORE TRUNCATE ON leave_command_receipts FOR EACH STATEMENT EXECUTE FUNCTION leave_command_receipts_guard();
SQL);
    }

    public function down(): void
    {
        if (DB::table('leave_command_receipts')->exists()) throw new RuntimeException('Retain leave recovery history; use verified snapshot recovery.');
        Schema::drop('leave_command_receipts');
        DB::unprepared('DROP FUNCTION leave_command_receipts_guard()');
        Schema::table('leave_requests', fn (Blueprint $table) => $table->dropColumn('revision'));
    }
};

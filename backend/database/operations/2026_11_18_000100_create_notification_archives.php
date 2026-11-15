<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Opt-in Operations extension. Original migration inventory and four holds remain unchanged. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notification_archives', function (Blueprint $table) {
            $table->foreignId('notification_id')->primary()->constrained('user_notifications')->restrictOnDelete();
            $table->foreignId('archived_by_user_id')->constrained('users')->restrictOnDelete();
            $table->timestampTz('archived_at')->useCurrent();
        });
        DB::unprepared(<<<'SQL'
CREATE FUNCTION notification_archives_guard() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Notification archive history is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER notification_archives_no_changes BEFORE UPDATE OR DELETE ON notification_archives
FOR EACH ROW EXECUTE FUNCTION notification_archives_guard();
CREATE TRIGGER notification_archives_no_truncate BEFORE TRUNCATE ON notification_archives
FOR EACH STATEMENT EXECUTE FUNCTION notification_archives_guard();
SQL);
    }

    public function down(): void
    {
        if (DB::table('notification_archives')->exists()) {
            throw new RuntimeException('Retain recorded archive history; use a verified snapshot recovery plan.');
        }
        Schema::drop('notification_archives');
        DB::unprepared('DROP FUNCTION notification_archives_guard()');
    }
};

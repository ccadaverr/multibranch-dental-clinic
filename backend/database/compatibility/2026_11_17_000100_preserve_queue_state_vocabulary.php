<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/** Local preservation profile only: vocabulary compatibility without conversion of clinical state or history. */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('LOCK TABLE queue_entries, queue_entry_history IN SHARE ROW EXCLUSIVE MODE');
        DB::statement("ALTER TABLE queue_entries ADD CONSTRAINT queue_entries_supported_status_check CHECK (status IN ('Waiting','Called','Treatment Ready','Temporarily Away','Served','In Queue','In Treatment','Done','Cancelled','No-show'))");
        DB::statement("ALTER TABLE queue_entries ADD CONSTRAINT queue_entries_supported_closed_check CHECK ((status IN ('Served','Done')) = (closed_at IS NOT NULL))");
        DB::statement('ALTER TABLE queue_entries DROP CONSTRAINT queue_entries_status_check');
        DB::statement('ALTER TABLE queue_entries DROP CONSTRAINT queue_entries_closed_check');
        DB::statement('ALTER TABLE queue_entries RENAME CONSTRAINT queue_entries_supported_status_check TO queue_entries_status_check');
        DB::statement('ALTER TABLE queue_entries RENAME CONSTRAINT queue_entries_supported_closed_check TO queue_entries_closed_check');
        // No row, revision, priority/reason, link, timestamp, queue number or history trigger is changed.
    }

    public function down(): void
    {
        DB::statement('LOCK TABLE queue_entries, queue_entry_history IN SHARE ROW EXCLUSIVE MODE');
        $unsupported = "('Waiting','Called','Treatment Ready','Temporarily Away','Served')";
        if (DB::table('queue_entries')->whereRaw("status NOT IN {$unsupported}")->exists()
            || DB::table('queue_entry_history')->whereRaw("to_status NOT IN {$unsupported} OR (from_status IS NOT NULL AND from_status NOT IN {$unsupported})")->exists()) {
            throw new RuntimeException('Cannot narrow the queue vocabulary while current or historical non-legacy states exist. Restore a verified snapshot instead.');
        }
        DB::statement("ALTER TABLE queue_entries ADD CONSTRAINT queue_entries_legacy_status_check CHECK (status IN {$unsupported})");
        DB::statement("ALTER TABLE queue_entries ADD CONSTRAINT queue_entries_legacy_closed_check CHECK ((status = 'Served') = (closed_at IS NOT NULL))");
        DB::statement('ALTER TABLE queue_entries DROP CONSTRAINT queue_entries_status_check');
        DB::statement('ALTER TABLE queue_entries DROP CONSTRAINT queue_entries_closed_check');
        DB::statement('ALTER TABLE queue_entries RENAME CONSTRAINT queue_entries_legacy_status_check TO queue_entries_status_check');
        DB::statement('ALTER TABLE queue_entries RENAME CONSTRAINT queue_entries_legacy_closed_check TO queue_entries_closed_check');
    }
};

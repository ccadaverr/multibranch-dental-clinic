<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
    public function up(): void {
        // Dedicated history ordering for recipient-scoped recent + continuation reads.
        // Additive, no changes to existing notification/clinical records.
        DB::statement('CREATE INDEX IF NOT EXISTS user_notifications_recipient_history_idx ON user_notifications (user_id, created_at DESC, id DESC)');
    }
    public function down(): void {
        DB::statement('DROP INDEX IF EXISTS user_notifications_recipient_history_idx');
    }
};

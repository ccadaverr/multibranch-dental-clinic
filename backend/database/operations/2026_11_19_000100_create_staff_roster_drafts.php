<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Preparation only: no published duty or recurrence/leave/publication policy is introduced. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('staff_roster_drafts', function (Blueprint $table) {
            $table->id();
            $table->ulid('public_id')->unique();
            $table->foreignId('staff_profile_id')->constrained('staff_profiles')->restrictOnDelete();
            $table->foreignId('branch_id')->constrained('branches')->restrictOnDelete();
            $table->date('on_date');
            $table->time('start_time');
            $table->time('end_time');
            $table->unsignedInteger('revision');
            $table->string('status', 16)->default('Draft');
            $table->foreignId('updated_by_user_id')->constrained('users')->restrictOnDelete();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();
            $table->unique(['staff_profile_id', 'on_date']);
        });
        DB::statement("ALTER TABLE staff_roster_drafts ADD CONSTRAINT staff_roster_draft_valid CHECK (start_time < end_time AND revision > 0 AND status = 'Draft')");
        Schema::create('staff_roster_draft_revisions', function (Blueprint $table) {
            $table->id();
            $table->ulid('public_id')->unique();
            $table->foreignId('draft_id')->constrained('staff_roster_drafts')->restrictOnDelete();
            $table->unsignedInteger('revision');
            $table->foreignId('actor_user_id')->constrained('users')->restrictOnDelete();
            $table->jsonb('snapshot');
            $table->timestampTz('created_at')->useCurrent();
            $table->unique(['draft_id', 'revision']);
        });
        DB::statement("ALTER TABLE staff_roster_draft_revisions ADD CONSTRAINT staff_roster_draft_snapshot_valid CHECK (revision > 0 AND jsonb_typeof(snapshot) = 'object' AND snapshot @> '{\"status\":\"Draft\",\"published\":false}'::jsonb AND jsonb_exists(snapshot, 'revision') AND (snapshot->>'revision')::integer = revision)");
        DB::unprepared(<<<'SQL'
CREATE FUNCTION staff_roster_draft_history_guard() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Staff roster draft history is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER staff_roster_draft_history_no_changes BEFORE UPDATE OR DELETE ON staff_roster_draft_revisions FOR EACH ROW EXECUTE FUNCTION staff_roster_draft_history_guard();
CREATE TRIGGER staff_roster_draft_history_no_truncate BEFORE TRUNCATE ON staff_roster_draft_revisions FOR EACH STATEMENT EXECUTE FUNCTION staff_roster_draft_history_guard();
CREATE TRIGGER staff_roster_drafts_no_delete BEFORE DELETE ON staff_roster_drafts FOR EACH ROW EXECUTE FUNCTION staff_roster_draft_history_guard();
CREATE TRIGGER staff_roster_drafts_no_truncate BEFORE TRUNCATE ON staff_roster_drafts FOR EACH STATEMENT EXECUTE FUNCTION staff_roster_draft_history_guard();
SQL);
    }

    public function down(): void
    {
        if (DB::table('staff_roster_drafts')->exists() || DB::table('staff_roster_draft_revisions')->exists()) throw new RuntimeException('Retain roster preparation history; recover through a verified snapshot.');
        Schema::drop('staff_roster_draft_revisions');
        Schema::drop('staff_roster_drafts');
        DB::unprepared('DROP FUNCTION staff_roster_draft_history_guard()');
    }
};

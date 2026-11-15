<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Approved R1–R10. Extend the existing preparation aggregate; retain every prior snapshot. */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('staff_roster_drafts', function (Blueprint $t) {
            $t->string('kind', 20)->default('custom_hours');
            $t->jsonb('weekdays')->default('[]');
            $t->date('effective_from')->nullable();
            $t->date('effective_until')->nullable();
            $t->jsonb('exceptions')->default('[]');
            $t->unsignedBigInteger('publication_id')->nullable();
        });
        DB::statement('ALTER TABLE staff_roster_drafts ALTER COLUMN start_time DROP NOT NULL, ALTER COLUMN end_time DROP NOT NULL');
        DB::statement('ALTER TABLE staff_roster_drafts DROP CONSTRAINT staff_roster_draft_valid');
        DB::statement("ALTER TABLE staff_roster_drafts ADD CONSTRAINT staff_roster_draft_valid CHECK (revision > 0 AND status IN ('Draft','Pending','Approved','Published') AND kind IN ('weekly','custom_hours','day_off') AND ((kind='day_off' AND start_time IS NULL AND end_time IS NULL) OR (kind<>'day_off' AND start_time IS NOT NULL AND end_time IS NOT NULL AND start_time<end_time)) AND ((effective_from IS NULL AND effective_until IS NULL AND kind<>'weekly') OR (effective_from IS NOT NULL AND effective_until IS NOT NULL AND effective_from<=effective_until)) AND jsonb_typeof(weekdays)='array' AND jsonb_typeof(exceptions)='array')");
        // Old immutable snapshots remain byte-for-byte unchanged; new transition snapshots carry actual state.
        DB::statement('ALTER TABLE staff_roster_draft_revisions DROP CONSTRAINT staff_roster_draft_snapshot_valid');
        DB::statement("ALTER TABLE staff_roster_draft_revisions ADD CONSTRAINT staff_roster_draft_snapshot_valid CHECK (revision>0 AND jsonb_typeof(snapshot)='object' AND snapshot->>'status' IN ('Draft','Pending','Approved','Published') AND jsonb_exists(snapshot,'revision') AND (snapshot->>'revision')::integer=revision)");
        Schema::create('staff_roster_publications', function (Blueprint $t) {
            $t->id(); $t->ulid('public_id')->unique();
            $t->foreignId('draft_id')->constrained('staff_roster_drafts')->restrictOnDelete();
            $t->foreignId('staff_profile_id')->constrained('staff_profiles')->restrictOnDelete();
            $t->foreignId('branch_id')->constrained('branches')->restrictOnDelete();
            $t->unsignedInteger('revision'); $t->unsignedInteger('approved_revision');
            $t->foreignId('actor_user_id')->constrained('users')->restrictOnDelete();
            $t->jsonb('snapshot'); $t->timestampTz('created_at')->useCurrent();
            $t->unique(['draft_id','revision']);
            $t->index('staff_profile_id');
            $t->unique(['id','draft_id']);
        });
        DB::statement('ALTER TABLE staff_roster_drafts ADD CONSTRAINT staff_roster_current_publication_fk FOREIGN KEY (publication_id,id) REFERENCES staff_roster_publications(id,draft_id)');
        DB::statement("ALTER TABLE staff_roster_publications ADD CONSTRAINT staff_roster_publication_valid CHECK (revision>approved_revision AND approved_revision>0 AND snapshot->>'status'='Published' AND (snapshot->>'revision')::integer=revision)");
        DB::unprepared('CREATE TRIGGER staff_roster_publications_no_changes BEFORE UPDATE OR DELETE ON staff_roster_publications FOR EACH ROW EXECUTE FUNCTION staff_roster_draft_history_guard(); CREATE TRIGGER staff_roster_publications_no_truncate BEFORE TRUNCATE ON staff_roster_publications FOR EACH STATEMENT EXECUTE FUNCTION staff_roster_draft_history_guard();');
        // Preserve the installed kind vocabulary and add only the new operational notice type.
        $check=DB::selectOne("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='user_notifications'::regclass AND conname='user_notifications_kind_check'")->definition;
        if(!str_starts_with($check,'CHECK ('))throw new RuntimeException('Unrecognized notification kind constraint.');
        DB::statement('ALTER TABLE user_notifications DROP CONSTRAINT user_notifications_kind_check');
        DB::statement("ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_kind_check CHECK (".substr($check,6)." OR kind='staff_roster')");
    }
    public function down(): void { throw new RuntimeException('Preserve roster approval/publication history. Use a verified snapshot recovery.'); }
};

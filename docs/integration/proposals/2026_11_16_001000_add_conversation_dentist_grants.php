<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// REVIEW REQUIRED BEFORE PROMOTION/EXECUTION. No legacy grant/backfill is inferred from branch membership or participants.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('conversation_dentist_grants', function (Blueprint $table) {
            $table->id();
            $table->ulid('public_id')->unique();
            $table->foreignId('conversation_id')->constrained()->restrictOnDelete();
            $table->foreignId('patient_id')->constrained()->restrictOnDelete();
            $table->foreignId('branch_id')->constrained()->restrictOnDelete();
            $table->foreignId('dentist_user_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('previous_dentist_user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->foreignId('authorized_by_user_id')->constrained('users')->restrictOnDelete();
            $table->text('reason');
            $table->unsignedInteger('revision');
            $table->timestampTz('created_at')->useCurrent();
            $table->unique(['conversation_id', 'revision'], 'conversation_grant_revision_unique');
            $table->unique(['id', 'conversation_id', 'patient_id', 'branch_id'], 'conversation_grant_scope_unique');
        });
        Schema::table('conversations', function (Blueprint $table) {
            $table->unsignedBigInteger('active_dentist_grant_id')->nullable();
            // A grant of another conversation, Patient or branch cannot become this conversation's active grant.
            $table->foreign(['active_dentist_grant_id', 'id', 'patient_id', 'branch_id'], 'conversation_active_grant_scope_fk')
                ->references(['id', 'conversation_id', 'patient_id', 'branch_id'])->on('conversation_dentist_grants')->restrictOnDelete();
        });
        DB::unprepared("CREATE FUNCTION conversation_grants_append_only() RETURNS trigger AS $$ BEGIN
            RAISE EXCEPTION 'Conversation Dentist grants are append-only'; RETURN NULL; END; $$ LANGUAGE plpgsql;
            CREATE TRIGGER conversation_grants_immutable BEFORE UPDATE OR DELETE ON conversation_dentist_grants
            FOR EACH ROW EXECUTE FUNCTION conversation_grants_append_only();
            ALTER TABLE conversation_dentist_grants ADD CONSTRAINT conversation_grant_revision_positive CHECK (revision > 0);");
    }

    public function down(): void
    {
        throw new RuntimeException('Clinical grant history requires reviewed recovery; automatic destructive rollback is prohibited.');
    }
};

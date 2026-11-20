<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

/** Read-only grant cutover preflight. No schema/data writes or permission changes. */
final class InspectConversationGrantReadiness extends Command
{
    protected $signature = 'dentalops:conversation-grants:check {--json : Print machine-readable status only}';

    protected $description = 'Inspect the Dentist messaging grant prerequisites without changing data or schema';

    public function handle(): int
    {
        if (DB::getDriverName() !== 'pgsql') {
            $this->error('This preflight supports PostgreSQL only. No changes were made.');
            return self::FAILURE;
        }

        try {
            DB::beginTransaction();
            DB::statement('SET TRANSACTION READ ONLY');
            DB::statement("SET LOCAL statement_timeout = '5s'");

            $grants = Schema::hasTable('conversation_dentist_grants');
            $conversations = Schema::hasTable('conversations');
            $required = [
                'id', 'public_id', 'conversation_id', 'patient_id', 'branch_id',
                'dentist_user_id', 'previous_dentist_user_id', 'authorized_by_user_id',
                'reason', 'revision', 'created_at',
            ];
            $missing = $grants ? array_values(array_filter($required, fn (string $column) => ! Schema::hasColumn('conversation_dentist_grants', $column))) : $required;
            $activeColumn = $conversations && Schema::hasColumn('conversations', 'active_dentist_grant_id');

            // A matching table and column do not alone prove that a safe authorization
            // cutover is possible. Check the reviewed cross-scope FK and the DB trigger.
            $scopeConstraint = false;
            $immutableTrigger = false;
            $revisionUnique = false;
            $scopeUnique = false;
            $positiveRevision = false;
            if ($grants && $conversations) {
                $scopeConstraint = in_array(DB::selectOne(<<<'SQL'
                    SELECT EXISTS (
                        SELECT 1 FROM pg_constraint c
                        WHERE c.conrelid = 'conversations'::regclass
                          AND c.conname = 'conversation_active_grant_scope_fk'
                          AND c.contype = 'f'
                    ) AS present
                SQL)->present, [true, 1, '1', 't'], true);

                // A named foreign key and trigger are not sufficient if the other
                // reviewed constraints were omitted from a partial installation.
                $grantConstraints = collect(DB::select(<<<'SQL'
                    SELECT conname, contype, pg_get_constraintdef(oid) AS definition
                    FROM pg_constraint
                    WHERE conrelid = 'conversation_dentist_grants'::regclass
                      AND conname IN (
                        'conversation_grant_revision_unique',
                        'conversation_grant_scope_unique',
                        'conversation_grant_revision_positive'
                      )
                SQL))->keyBy('conname');
                $revisionUnique = $grantConstraints->get('conversation_grant_revision_unique')?->contype === 'u'
                    && str_contains($grantConstraints->get('conversation_grant_revision_unique')->definition, 'conversation_id, revision');
                $scopeUnique = $grantConstraints->get('conversation_grant_scope_unique')?->contype === 'u'
                    && str_contains($grantConstraints->get('conversation_grant_scope_unique')->definition, 'id, conversation_id, patient_id, branch_id');
                $positiveRevision = $grantConstraints->get('conversation_grant_revision_positive')?->contype === 'c'
                    && preg_match('/\brevision\s*>\s*0\b/', $grantConstraints->get('conversation_grant_revision_positive')->definition) === 1;

                $immutableTrigger = in_array(DB::selectOne(<<<'SQL'
                    SELECT EXISTS (
                        SELECT 1 FROM pg_trigger t
                        JOIN pg_proc p ON p.oid = t.tgfoid
                        WHERE t.tgrelid = 'conversation_dentist_grants'::regclass
                          AND NOT t.tgisinternal AND t.tgenabled <> 'D'
                          AND (t.tgtype & 2) <> 0 -- BEFORE
                          AND (t.tgtype & 16) <> 0 -- UPDATE
                          AND (t.tgtype & 8) <> 0 -- DELETE
                          AND pg_get_functiondef(p.oid) ILIKE '%append-only%'
                    ) AS present
                SQL)->present, [true, 1, '1', 't'], true);
            }

            // Aggregate only; no Patient identities, message text, or grant reasons are read.
            // Installing the grant schema deliberately removes legacy Dentist access until
            // authorized Staff records an explicit grant. Show the scope of that cutover.
            $legacyOpenDentistThreads = $conversations ? (int) DB::table('conversations as c')
                ->join('conversation_participants as cp', 'cp.conversation_id', '=', 'c.id')
                ->join('users as u', 'u.id', '=', 'cp.user_id')
                ->where('c.status', 'Open')->where('u.role', 'dentist')
                ->when($activeColumn, fn ($q) => $q->whereNull('c.active_dentist_grant_id'))
                ->distinct()->count('c.id') : 0;

            $schemaReady = $grants && $activeColumn && $missing === [] && $scopeConstraint
                && $revisionUnique && $scopeUnique && $positiveRevision && $immutableTrigger;
            $enabled = (bool) config('messaging.conversation_grants_enabled');
            $result = [
                'database_driver' => 'pgsql',
                'grants_table' => $grants,
                'active_grant_column' => $activeColumn,
                'missing_grant_columns' => $missing,
                'scope_foreign_key' => $scopeConstraint,
                'revision_unique_constraint' => $revisionUnique,
                'scope_unique_constraint' => $scopeUnique,
                'positive_revision_check' => $positiveRevision,
                'append_only_trigger' => $immutableTrigger,
                'schema_prerequisites_met' => $schemaReady,
                'new_grants_feature_enabled' => $enabled,
                'grant_creation_ready' => $schemaReady && $enabled,
                'legacy_open_dentist_threads_without_grant' => $legacyOpenDentistThreads,
                'note' => $schemaReady ? 'Schema prerequisites detected; independent permission and end-to-end validation still required.' : 'Missing reviewed grant prerequisites. Do not enable Dentist messaging or apply held migrations.',
            ];
            DB::rollBack();

            if ($this->option('json')) {
                $this->line(json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
            } else {
                foreach ($result as $key => $value) {
                    $this->line($key.': '.(is_array($value) ? implode(', ', $value) : (is_bool($value) ? ($value ? 'yes' : 'no') : $value)));
                }
            }
            return $schemaReady ? self::SUCCESS : self::FAILURE;
        } catch (Throwable $e) {
            if (DB::transactionLevel() > 0) DB::rollBack();
            // Deliberately do not print connection details or SQL exceptions.
            $this->error('Grant preflight could not complete safely. No data was changed.');
            return self::FAILURE;
        }
    }
}

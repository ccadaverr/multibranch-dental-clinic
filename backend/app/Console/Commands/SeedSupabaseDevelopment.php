<?php

namespace App\Console\Commands;

use App\Services\Automations\MessageTemplates;
use App\Support\SupabaseDevelopmentFixtures as Fixtures;
use App\Support\SupabaseDevelopmentTarget;
use Illuminate\Console\Command;
use Illuminate\Database\Connection;
use InvalidArgumentException;
use Throwable;

final class SeedSupabaseDevelopment extends Command
{
    protected $signature = 'dentalops:seed-supabase-development
        {mode=dry-run : dry-run or apply}
        {--project= : Exact Supabase development project reference}
        {--confirm= : For apply, repeat the exact project reference}
        {--fixture-sha256= : For apply, confirm the approved fixture fingerprint printed by dry-run}
        {--data-api-disabled : Confirm the unused Supabase Data API is disabled}';

    protected $description = 'Inspect or seed only the reviewed synthetic data in the initialized Supabase development schema';

    // These rows are installed by the approved migrations. Other tables must be empty unless they hold this fixture.
    private const MIGRATION_DEFAULTS = [
        'automation_settings' => ['key', [
            'appointment_reminders', 'no_show', 'overdue_invoices', 'recall', 'waitlist', 'owner_summary',
            'fill_slots', 'attendance_policy', 'calendar_load', 'intake', 'staffing', 'prescriptions', 'followup_reminders', 'dental_chart',
        ]],
        'workflow_rules' => ['rule_code', [
            'R1_APPT_LIFECYCLE', 'R2_HMO_FOLLOWUP_REMINDER', 'R3_CAPACITY_ALERT',
            'R4_TREATMENT_DOWNSTREAM', 'R5_MESSAGE_ROUTING', 'R6_USER_PROFILE_SYNC',
        ]],
        'message_templates' => ['key', []],
        'm11_billing_cutovers' => ['id', [1]],
    ];

    public function handle(Fixtures $fixtures): int
    {
        try {
            $mode = $this->argument('mode');
            $this->require(in_array($mode, ['dry-run', 'apply'], true), 'Choose dry-run or apply.');
            $apply = $mode === 'apply';
            $project = (string) $this->option('project');
            $fingerprint = Fixtures::fingerprint();
            if ($apply) {
                $this->require($this->option('confirm') === $project && $this->option('fixture-sha256') === $fingerprint,
                    'Apply requires explicit approval of the exact project and dry-run fixture fingerprint.');
                $this->require($this->option('data-api-disabled'), 'Verify that the unused Supabase Data API is disabled before applying.');
            }

            $db = SupabaseDevelopmentTarget::connection($project);
            [$paths, $held] = SupabaseDevelopmentTarget::inventory();
            $approved = array_map(fn (string $path) => pathinfo($path, PATHINFO_FILENAME), $paths);
            $this->line("Target project: $project. Fixture SHA-256: $fingerprint");
            $this->line('Plan: 5 demo accounts, 2 synthetic services, 2 synthetic map points, and their booking and role relationships.');

            $created = $db->transaction(function () use ($db, $apply, $approved, $held, $fixtures) {
                $db->statement($apply ? 'SET TRANSACTION READ WRITE' : 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
                $db->statement("SET LOCAL lock_timeout = '5s'");
                $db->statement("SET LOCAL statement_timeout = '30s'");
                // Fail closed if the role cannot see all rows because of RLS.
                $db->statement('SET LOCAL row_security = off');
                $this->verifyIdentity($db);

                if ($apply) {
                    $lock = $db->selectOne("SELECT pg_try_advisory_xact_lock(hashtext('dentalops:supabase-development')) AS acquired");
                    $this->require($lock->acquired, 'Another Supabase development initialization is running.');
                }

                $tables = $this->applicationTables($db);
                if ($apply) {
                    // Keep ordinary database writes from changing the inspected state during initialization.
                    $db->statement('LOCK TABLE '.implode(', ', $tables).' IN SHARE ROW EXCLUSIVE MODE');
                }
                $this->verifyLedger($db, $approved, $held);
                $this->verifyMigrationDefaults($db);
                $present = $this->inspectRows($db, $tables);
                if ($present) {
                    $fixtures->reconcile(false);
                    $this->info('The exact fixture is already present. No writes needed.');

                    return false;
                }
                if (! $apply) {
                    return false;
                }

                $this->require(strlen((string) env('DEMO_ACCOUNT_PASSWORD')) >= 16,
                    'Set a private DEMO_ACCOUNT_PASSWORD of at least 16 characters before creating the reviewed accounts.');
                $fixtures->reconcile(true);
                $this->require($this->inspectRows($db, $tables), 'Seeded fixture counts did not match the approved plan.');
                $fixtures->reconcile(false);

                return true;
            });

            $this->info($created ? 'Committed the approved synthetic development fixture.' : 'Checks passed without database writes.');

            return self::SUCCESS;
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage());
        } catch (Throwable $e) {
            $code = (string) $e->getCode();
            $state = preg_match('/\A[0-9A-Z]{5}\z/', $code) ? " (SQLSTATE $code)" : '';
            $source = basename($e->getFile()).':'.$e->getLine();
            // PHP exception messages can embed SQL bindings or connection details.
            $this->error('Seed command stopped: '.class_basename($e).' at '.$source.$state.'.');
        }

        return self::FAILURE;
    }

    private function verifyIdentity(Connection $db): void
    {
        $identity = $db->selectOne(<<<'SQL'
            SELECT current_database() = 'postgres' AND current_schemas(false) = ARRAY['public']::name[]
                AND current_user = session_user AND current_user = ?
                AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999 AS verified
            SQL, [strstr($db->getConfig('username'), '.', true)]);
        $this->require($identity->verified, 'The connected PostgreSQL database, version, search path, or role does not match the development target.');
    }

    private function applicationTables(Connection $db): array
    {
        $tables = $db->select(<<<'SQL'
            SELECT c.relname AS name FROM pg_class c
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'f', 'm') AND NOT c.relispartition
              AND NOT EXISTS (
                SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
              )
            ORDER BY c.relname
            SQL);
        $quoted = [];
        foreach ($tables as $table) {
            $this->require(preg_match('/\A[a-z_][a-z0-9_]*\z/', $table->name) === 1, 'Found an unexpected application table identifier.');
            $quoted[$table->name] = $db->getQueryGrammar()->wrapTable('public.'.$table->name);
        }
        $required = ['migrations', ...array_keys(self::MIGRATION_DEFAULTS), ...array_keys(Fixtures::COUNTS)];
        $this->require(! array_diff($required, array_keys($quoted)), 'A required application table is missing.');

        return $quoted;
    }

    private function verifyLedger(Connection $db, array $approved, array $held): void
    {
        $ledger = $db->table('migrations')->pluck('migration')->all();
        sort($ledger, SORT_STRING);
        sort($approved, SORT_STRING);
        $this->require(count($approved) === 87 && count($held) === 4 && ! array_intersect($ledger, $held) && $ledger === $approved,
            'The migration ledger does not exactly match the 87 approved entries and four held exclusions.');
        $this->info('Ledger verified: 87 approved migrations, zero held migrations.');
    }

    private function verifyMigrationDefaults(Connection $db): void
    {
        foreach (self::MIGRATION_DEFAULTS as $table => [$column, $expected]) {
            $expected = $table === 'message_templates' ? array_keys(MessageTemplates::DEFAULTS) : $expected;
            $actual = $db->table($table)->pluck($column)->all();
            sort($expected);
            sort($actual);
            $this->require($expected === $actual, "Unexpected migration defaults in $table.");
        }
        foreach (['automation_settings' => 'updated_by_user_id', 'message_templates' => 'approved_at'] as $table => $column) {
            $this->require(! $db->table($table)->whereNotNull($column)->exists(), "Existing operator changes detected in $table.");
        }
    }

    private function inspectRows(Connection $db, array $tables): bool
    {
        $tables = array_diff_key($tables, self::MIGRATION_DEFAULTS, ['migrations' => true]);
        $queries = [];
        foreach ($tables as $name => $quoted) {
            $queries[] = isset(Fixtures::COUNTS[$name])
                ? "SELECT ? AS table_name, count(*) AS total FROM $quoted"
                : "SELECT ? AS table_name, EXISTS (SELECT 1 FROM $quoted)::int AS total";
        }
        $counts = collect($db->select(implode(' UNION ALL ', $queries), array_keys($tables)))
            ->pluck('total', 'table_name')->map(fn ($total) => (int) $total)->all();
        $this->line('Current rows: '.collect(array_intersect_key($counts, Fixtures::COUNTS))
            ->map(fn (int $total, string $table) => "$table=$total")->implode(', '));

        foreach (array_diff_key($counts, Fixtures::COUNTS) as $table => $total) {
            $this->require($total === 0, "Unexpected application data in $table. No seeding performed.");
        }
        $existing = array_replace(Fixtures::COUNTS, array_intersect_key($counts, Fixtures::COUNTS));
        if (array_sum($existing) === 0) {
            return false;
        }
        $this->require($existing === Fixtures::COUNTS, 'Partial or unexpected fixture counts. No seeding performed.');

        return true;
    }

    private function require(bool $condition, string $message): void
    {
        if (! $condition) {
            throw new InvalidArgumentException($message);
        }
    }
}

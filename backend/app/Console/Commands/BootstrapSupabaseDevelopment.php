<?php

namespace App\Console\Commands;

use App\Support\ClinicDatabaseGuard;
use App\Support\SupabaseDevelopmentTarget;
use Database\Seeders\DemoAccountsSeeder;
use Illuminate\Console\Command;
use Illuminate\Database\Connection;
use Illuminate\Database\Migrations\Migrator;
use InvalidArgumentException;
use Throwable;

class BootstrapSupabaseDevelopment extends Command
{
    protected $signature = 'dentalops:supabase-development
        {mode=preflight : preflight or apply}
        {--project= : Exact Supabase development project reference}
        {--confirm= : For apply, repeat the exact project reference}
        {--data-api-disabled : Confirm in the Supabase Dashboard that the Data API is disabled}
        {--password-rotated : Confirm the exposed database password was rotated and Laravel has the new credential}
        {--seed-accounts : Also initialize the existing synthetic role accounts during apply}';

    protected $description = 'Preflight or initialize an empty Supabase development project with the reviewed Round 8 schema';

    public function handle(Migrator $migrator): int
    {
        $apply = $this->argument('mode') === 'apply';

        try {
            $this->require(in_array($this->argument('mode'), ['preflight', 'apply'], true), 'Choose preflight or apply.');
            $project = (string) $this->option('project');
            $this->require(preg_match('/\A[a-z0-9]{20}\z/', $project) === 1, 'Specify the Supabase development project with --project.');
            $this->require(! $apply || $this->option('confirm') === $project, 'Apply requires --confirm with the same project reference.');
            $this->require(! $apply || $this->option('data-api-disabled'), 'Before applying, verify the unused Supabase Data API is disabled and pass --data-api-disabled.');
            $this->require(! $apply || $this->option('password-rotated'), 'Before applying, rotate the exposed database password, update Laravel privately, and pass --password-rotated.');
            $seedAccounts = $this->option('seed-accounts');
            $this->require(! $seedAccounts || ($apply && strlen((string) env('DEMO_ACCOUNT_PASSWORD')) >= 16),
                'Account seeding requires apply mode and a private DEMO_ACCOUNT_PASSWORD of at least 16 characters.');

            [$paths, $held] = SupabaseDevelopmentTarget::inventory();
            $ordered = $migrator->getMigrationFiles($paths);
            $this->require(array_values($ordered) === $paths, 'Laravel migration ordering differs from the reviewed inventory.');
            $this->info('Verified the reviewed order and all hashes: 87 selected migrations and four held migrations.');
            $this->line('Only explicit migration files will be used. No schema dump is loaded.');
            $this->line('The existing demo account seeder uses example.test identities and makes no provider calls. The catalog seeders use clinic reference data and are excluded.');
            $this->require(filled(config('app.key')), 'Retain the existing Laravel APP_KEY in the private environment before using this bootstrap.');
            $this->line('Laravel has an APP_KEY configured. The bootstrap does not change it.');

            $db = SupabaseDevelopmentTarget::connection($project);
            $config = $db->getConfig();
            $this->line("Project $project via {$config['host']}:5432, database postgres, client TLS {$config['sslmode']}.");

            $db->transaction(function () use ($db, $migrator, $apply, $paths, $ordered, $held, $seedAccounts) {
                if (! $apply) {
                    $db->statement('SET TRANSACTION READ ONLY');
                }
                $db->statement("SET LOCAL lock_timeout = '5s'");
                $db->statement("SET LOCAL statement_timeout = '60s'");
                if ($apply) {
                    $lock = $db->selectOne("SELECT pg_try_advisory_xact_lock(hashtext('dentalops:supabase-development')) AS acquired");
                    $this->require($lock->acquired, 'Another schema bootstrap is running.');
                }

                $this->preflight($db, array_keys($ordered), $held);
                if (! $apply) {
                    return;
                }

                // One PostgreSQL transaction covers the ledger, all selected migrations, and verification.
                // The Laravel migrator still emits MigrationStarted and runs any registered guards.
                $migrator->usingConnection('pgsql', function () use ($migrator, $paths, $ordered, $held) {
                    $repository = $migrator->getRepository();
                    $repository->createRepository();
                    $ran = $migrator->setOutput($this->output)->run($paths, ['step' => true]);
                    $ledger = $repository->getRan();
                    $this->require(array_values($ran) === $paths && $ledger === array_keys($ordered) && ! array_intersect($ledger, $held),
                        'Migration results differ from the reviewed profile.');
                });

                if ($seedAccounts) {
                    $this->require(ClinicDatabaseGuard::refusal(DemoAccountsSeeder::class) === null, 'The clinic database guard refused account seeding.');
                    app(DemoAccountsSeeder::class)->run();
                    $roleCounts = $db->table('users')->selectRaw('role, count(*) AS total')->groupBy('role')->pluck('total', 'role')->map(fn ($count) => (int) $count)->sortKeys()->all();
                    $this->require($roleCounts === ['dentist' => 1, 'owner' => 1, 'patient' => 1, 'staff' => 2],
                        'The synthetic account records did not match the reviewed role counts.');
                }
            });

            $this->info($apply ? 'Committed and verified 87 migrations. All four held migrations remain unapplied.' : 'Read-only preflight passed for the empty target.');
            if ($seedAccounts) {
                $this->info('Committed five synthetic accounts across four roles.');
            }

            return self::SUCCESS;
        } catch (InvalidArgumentException $e) {
            $this->error($e->getMessage());
        } catch (Throwable $e) {
            // Connection and query exception text can include credentials or database details.
            $code = (string) $e->getCode();
            $state = preg_match('/\A[0-9A-Z]{5}\z/', $code) ? " (SQLSTATE $code)" : '';
            $this->error(($apply ? 'Apply failed. Check the read-only preflight before any retry.' : 'Read-only database inspection failed. Check network access and the configured connection.').$state);
        }

        return self::FAILURE;
    }

    private function preflight(Connection $db, array $approved, array $held): void
    {
        $state = $db->selectOne(<<<'SQL'
            SELECT current_database() AS database, current_schemas(false)::text AS search_path,
                current_setting('server_version_num')::int AS version,
                (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS server_tls,
                current_user = session_user AND current_user = ? AS expected_role,
                has_schema_privilege('public', 'USAGE') AND has_schema_privilege('public', 'CREATE') AS schema_create,
                has_language_privilege('plpgsql', 'USAGE') AS plpgsql_usage,
                (SELECT count(*) FROM pg_namespace WHERE nspname IN ('auth', 'storage', 'realtime', 'vault', 'extensions')) AS managed_schemas,
                to_regclass('auth.users') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL AS managed_tables,
                to_regclass('public.migrations') IS NOT NULL AS ledger_exists,
                (SELECT installed_version IS NOT NULL FROM pg_available_extensions WHERE name = 'btree_gist') AS gist_installed,
                has_database_privilege(current_database(), 'CREATE') AND EXISTS (
                    SELECT 1 FROM pg_available_extension_versions v JOIN pg_available_extensions e USING (name)
                    WHERE v.name = 'btree_gist' AND v.version = e.default_version AND v.trusted
                ) AS gist_installable,
                EXISTS (
                    SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
                    WHERE d.defaclrole = current_user::regrole
                      AND d.defaclnamespace IN (0, 'public'::regnamespace)
                      AND (a.grantee = 0 OR EXISTS (
                          SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
                            AND pg_has_role(r.oid, NULLIF(a.grantee, 0), 'USAGE')
                      ))
                ) AS api_grants
            SQL, [strstr($db->getConfig('username'), '.', true)]);
        $this->require($state->database === 'postgres', 'The server returned a database other than postgres.');
        $this->require($state->search_path === '{public}', 'The connected search path is not limited to public.');
        $this->require($state->expected_role, 'The server role does not match the configured pooler login.');
        $this->line("Connected PostgreSQL version number: {$state->version}.");
        $this->line($state->server_tls ? 'PostgreSQL reports TLS on the pooler-to-database connection.' : 'PostgreSQL does not report TLS on the pooler-to-database connection. The client-to-pooler connection requires TLS.');
        $this->require($state->version >= 170000 && $state->version < 180000, 'This development profile targets the project’s PostgreSQL 17 server.');
        $this->require((int) $state->managed_schemas === 5 && $state->managed_tables, 'Expected Supabase managed schemas or catalog tables are missing.');

        if ($state->ledger_exists) {
            $columns = $db->getSchemaBuilder()->getColumnListing('public.migrations');
            if (in_array('migration', $columns, true)) {
                $ledger = $db->table('public.migrations')->orderBy('migration')->pluck('migration')->all();
                $this->line('Existing ledger rows: '.count($ledger).'. Held entries present: '.count(array_intersect($ledger, $held)).'.');
                if ($ledger === $approved) {
                    $this->info('The existing ledger exactly matches the 87 selected migrations.');
                }
            }
            $this->require(false, 'The migration ledger already exists. Bootstrap requires a new target.');
        }

        $objects = $db->selectOne(<<<'SQL'
            SELECT count(*) AS total FROM (
                SELECT 'pg_class'::regclass AS class, oid FROM pg_class WHERE relnamespace = 'public'::regnamespace
                UNION ALL SELECT 'pg_proc'::regclass, oid FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                UNION ALL SELECT 'pg_type'::regclass, oid FROM pg_type WHERE typnamespace = 'public'::regnamespace
            ) objects
            WHERE NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = objects.class AND d.objid = objects.oid AND d.deptype = 'e')
            SQL);
        $this->require((int) $objects->total === 0, 'The public schema has unexpected objects. Bootstrap requires a new target.');
        $this->line('Managed schemas found. No application objects or migration ledger in public.');
        $this->require($state->schema_create && $state->plpgsql_usage, 'The migration role needs CREATE in public and USAGE on PL/pgSQL for the application tables, functions and triggers.');
        $this->require($state->gist_installed || $state->gist_installable, 'The appointment migration requires btree_gist for its overlap constraints. The current role cannot install the default extension.');
        $this->line($state->gist_installed ? 'btree_gist is installed.' : 'The migration role can install the trusted btree_gist extension in public.');

        if ($state->api_grants) {
            $this->warn('The migration role has default grants that can expose new objects through the Supabase Data API. SQL does not verify the Dashboard toggle.');
        }
    }

    private function require(bool $condition, string $message): void
    {
        if (! $condition) {
            throw new InvalidArgumentException($message);
        }
    }
}

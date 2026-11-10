# BE-QA-DB-01: Disposable PostgreSQL acceptance readiness

November 10, 2026, Asia/Manila. Cutoff: November 11, 2026, 02:00 Asia/Manila.

**Disposition: preparation complete; database-backed execution is not authorized.** None of the 10 Staff P0 regressions can execute database-free. Their normal setup invokes the full migration chain, including the unsafe queue migration and other destructive schema operations. An empty disposable installation may avoid the queue conversion failure; it cannot establish populated-upgrade safety.

## Verified checkout and configuration

- Branch: `feature/joevan-staff-p0-be-20261110`.
- HEAD: `185626093e31f583a9dd41c168eb1dc3ecf1133d`, `test(queue): document migration incompatibilities and safety audit`, November 10, 2026, 21:51:01 +08:00. Parent `d3cafc8` preserves STAFF-P0-BE-01. Tree initially clean.
- `backend/.env` and `backend/.env.testing` are absent. No values were read from secret files. `backend/bootstrap/cache` contains only `.gitignore`; no cached configuration was present. Existing process overrides, live server identity, listener ownership, user privileges and database contents were not inspected and remain unverified.
- PHP is available; `pdo_pgsql`, `pgsql`, OpenSSL, mbstring, DOM/XML and other installed modules were listed without opening a connection. Installed PHPUnit is 12.5.35; Laravel source and vendor dependencies are available. All 86 migration files passed `php -l`; this proves PHP syntax only.

| Requirement | Actual source contract / preparation |
| --- | --- |
| Application | `APP_ENV=testing`; fresh process, no config cache; a new synthetic `APP_KEY` valid for AES-256-CBC, generated in memory and never printed or reused from another environment |
| Database | `DB_CONNECTION=pgsql`, `DB_HOST=127.0.0.1`, `DB_PORT=5432`, `DB_DATABASE=dental_clinic_scratch`, `DB_URL` empty |
| Credentials | Explicit dedicated disposable-role `DB_USERNAME` and privately supplied `DB_PASSWORD`; no default `root` or PostgreSQL superuser test login |
| Identity guard | Actual `current_database()` must equal scratch; actual server address must equal `TEST_SCRATCH_SERVER_ADDRESS` (default 127.0.0.1); actual server port must be 5432. Container address override must be independently reverified, never copied from earlier reports |
| Sessions/auth | `SESSION_DRIVER=database`; `SANCTUM_STATEFUL_DOMAINS=localhost:5173,127.0.0.1:5173`; local URL/cookie settings; fixture sends the localhost Referer and uses Sanctum's in-process authenticated actor |
| Side effects | `MAIL_MAILER=array`, `CACHE_STORE=array`, `QUEUE_CONNECTION=sync`, `BROADCAST_CONNECTION=null`; Pulse/Telescope/Nightwatch disabled; no workers or scheduled processes |
| External keys | No real SMTP/payment/AI/storage credentials. PHPUnit forces assistant keys empty; sanitize other inherited provider credentials and outbound destinations in the future child process |
| Time | Fixture freezes September 28, 2026, 10:00 Asia/Manila. Application config remains UTC; preserve centralized `ClinicClock` conversion rather than claiming a global Manila configuration |

Most PHPUnit environment entries, including DB identity, do **not** use `force=true`; inherited process settings can override them. `config/database.php` also accepts `DB_URL` and defaults to database `laravel`, username `root` if unspecified. Use explicit process-only values in a fresh, isolated runner. No `.env` creation, copying, key-generation command or configuration-clearing command is required in this checkout.

Documentation conflicts: `.env.testing.example` and parts of `backend/README.md` describe `dental_clinic_test`, but `phpunit.xml` and the guard require **scratch**. The repository's standing database boundary names demo/test databases; approve an explicit exception for a newly provisioned disposable scratch instance before execution. Do not rename a shared database, substitute demo/test into this guard, set `ALLOW_CLINIC_DATABASE`, or weaken the guard. The prior queue report's disposable `dental_clinic_test` proposal also needs this correction for the existing Staff test harness.

## Test dependency graph and destructive setup

```text
PHPUnit configuration -> vendor autoload -> StaffP0BranchScopePreservationTest
  -> Tests\TestCase::createApplication()
       -> Laravel console bootstrap/providers
       -> ScratchDatabaseGuard::assertSafe() (identity SELECT only after config checks)
  -> Laravel setUpTraits() -> RefreshDatabase
       -> first refresh per process: migrate:fresh
            -> if migration repository exists: db:wipe (drop tables, cascading dependencies)
            -> migrate all 86 files in filename order (no schema dump present)
       -> begin per-test pgsql transaction
  -> SchedulingFixture::setUpSchedulingWorld()
  -> create Staff profile s-p0; authenticate synthetic Owner
  -> PATCH /api/staff/s-p0 -> auth/account/role middleware -> request validation
       -> StaffProfileController transaction + profile/account row locks
       -> conditional scope DELETE/INSERT + append-only audit INSERT
  -> assert persisted profiles, exact scope rows and audit count/payload
  -> rollback per-test transaction and disconnect
```

Framework sources inspected: `RefreshDatabase`, `CanConfigureMigrationCommands`, test lifecycle setup, `FreshCommand`, `WipeCommand`, migrator and PostgreSQL schema builder. The guard runs before RefreshDatabase, but after application bootstrap. The registered application provider was inspected; it registers bindings/rate limiters and optional CA configuration, with no startup database query found. The guard is not a universal safety wrapper for standalone Artisan commands.

RefreshDatabase uses the configured default connection and calls `migrate:fresh` before starting its test transaction. Reusing a pre-migrated database does **not** avoid the first reset in a new PHPUnit process. The migration repository determines whether FreshCommand first calls `db:wipe`; on a new empty database, migrations still create all objects. Per-test rollback does not undo initial schema setup. No seed attribute/property or custom migration options are present in the Staff class/base/fixture: `--seed=false`, `--drop-views=false`, `--drop-types=false`. Table drops can still cascade dependent views. Migration `up()` methods themselves insert settings/templates/rules even without seeders.

Fixture data: two synthetic branches, two services, three branch-service offers, three Dentists with branch/service joins, two Patients, four Staff accounts, one Owner and their Persons/Users/scopes; Staff profile `s-p0` is added afterwards. No demo or production seeder is needed. `UserFactory` and `PersonFactory` generate fictional identities. No appointments, visits, queue entries or clinical records are created by the Staff tests.

Ten cases confirmed through **discovery only**: four unchanged-edit variants (hours, same branch, same branch plus hours, metadata) for each of multi-branch and empty scopes; repeated-null assignment; real reassignment plus retry after an independent scope edit. Empty-scope fixtures explicitly DELETE scope rows. The controller also deletes obsolete scopes on real reassignment. These are synthetic-data writes, not read-only runtime tests. Audit rows are appended, not edited/deleted. Null-assignment authorization policy is deliberately not approved by these tests.

## Migration dependencies and hazards

All **86** migration sources were scanned in chronological order for schema/data operations, service calls, extension requirements, trigger changes and transaction overrides; the Staff filter does not reduce this set. Primary direct dependencies are Persons/Users/sessions, branches/services/joins, Staff/Dentist profiles and joins, Patients, public-ID/auth-version/claim fields, branch scopes, audit schema/trigger and archive additions. The standard harness also executes every unrelated queue, clinical, billing, message, staffing, loyalty and intake migration.

| Source under `backend/database/migrations/` | Acceptance consequence |
| --- | --- |
| `2026_09_28_000200_create_appointments_table.php` | Requires `btree_gist` and GiST exclusion support; SQLite is unsuitable |
| `2026_09_30_000200_backfill_visits_from_appointments.php`; `2026_10_01_000200_backfill_queue_entries_from_visits.php` | Call current `VisitBackfill`/`QueueBackfill` services. Expected no rows on a genuinely fresh unseeded chain; populated restoration would invoke historical-data interpretation. Their rollback helpers disable history triggers and delete records: do not use rollback as cleanup |
| `2026_10_03_000100_create_service_prices_table.php` | Uses `NULLS NOT DISTINCT` unique-index syntax, requiring PostgreSQL 15+. Match the deployment major once known; previous reports' PostgreSQL 16 is context, not current instance evidence |
| `2026_10_08_000100_create_automation_tables.php` and subsequent automation/template migrations | Insert defaults during migration. No scheduler/worker should run; this is not a zero-data schema-only setup |
| `2026_11_10_000100_remove_patient_feedback_table.php` | Rewrites feedback follow-up sources, drops feedback trigger/function and the table. Even an unrelated Staff test invokes this destructive migration |
| `2026_11_15_000400_backfill_tooth_chart_branch.php` | Temporarily disables the chart append-only trigger; derives branch from linked treatment/Visit or patient preference, then reenables it. Needs table ownership. No runtime clinical policy acceptance follows from running this on empty tables |
| `2026_11_15_000500_add_critical_foreign_key_and_analytics_indexes.php` | Uses `CREATE INDEX CONCURRENTLY`, `withinTransaction=false`. Cannot wrap the entire migration chain in a single outer transaction. A later migration failure can leave earlier committed migrations/indexes |
| `2026_11_16_000100_create_loyalty_and_referrals_tables.php` | Depends on earlier invoice refunds, invoices, Visits and Patients; creates functions/triggers and a view. Do not select only arbitrary late migrations to bypass prerequisites |
| `2026_11_16_000200_remove_kiosk_channel_from_intake_submissions.php` | Explicitly refuses if kiosk rows exist; another reason to prohibit imported/shared state |
| `2026_11_16_000500_update_queue_statuses_and_remove_urgent_priority.php` | **Automatically included**, despite future filename date. Updates precede old constraint removal; populated-upgrade hazards remain. Empty queue tables may allow its completion; the Staff fixture runs only afterwards |

Other source changes include middle-name column removal, public-ID/code backfills, constraint replacements and immutable-history triggers. No migration source was altered or executed. PHP lint cannot prove SQL validity, dependency completeness or successful fresh installation; no additional guaranteed fresh-chain failure is claimed. Existing [queue audit](QUEUE_MIGRATION_SAFETY_BE_01_2026_11_10.md) and its four failing checks remain operative.

## Isolation and least privilege: proposed procedure only

1. Technical lead approves a new disposable PostgreSQL instance and exact scratch identity. Provision in a separate VM/container/runner with no existing data mounts, snapshots, clinic credentials or shared PostgreSQL access. Use tmpfs/ephemeral storage and a pinned PostgreSQL image/major with contrib installed. Provisioning is a separate authorized action, not performed here.
2. Bind only its runner's `127.0.0.1:5432`. If occupied, stop and choose a separately isolated runner; do not stop/reconfigure an existing service or substitute another port without a reviewed guard change. Inspect new instance ID, image, mounts, binding and current server address before connecting. Never infer identity from a familiar name/IP alone.
3. Provisioning administrator creates only the disposable scratch database and dedicated login, then withholds administrator credentials from PHP. Test login: LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS; no privileged memberships, server-file/program roles or other-database access. Restrict authentication to that role/database and revoke inappropriate PUBLIC connection privileges in the new instance. No shared server is acceptable.
4. Give the login CONNECT/TEMP on scratch, USAGE/CREATE on its public schema and ownership of objects it creates. Preinstall `btree_gist` as administrator so the test login need not receive database CREATE. The existing migration's `CREATE EXTENSION IF NOT EXISTS` should then be a no-op. If another permission is needed, stop rather than granting superuser. A migration runner necessarily owns test objects and can disable their triggers; this verifies workflow enforcement, not a hardened production runtime role.
5. Prepare a fresh child process with the configuration table above, private synthetic key/password and no inherited provider credentials, connection URLs, alternate/direct connections, remote destinations or config caches. Prefer a separate checkout at the reviewed commit. Do not run Composer `setup`/`test` scripts or Artisan key/config commands as a prerequisite: those can migrate, boot with unintended settings or write files.
6. Only after connection authorization, use catalog-only preflight to verify exact server/database/session role, role attributes/memberships, schema ownership/grants, installed `btree_gist`, version and zero user tables/views/sequences. Check both configured and actual identity through the unchanged guard. Do not query patient/clinic tables. Abort if any existing application object or unknown state is found. No connection or such query occurred in this task.
7. Obtain the full-chain execution approval below before the actual Staff test command. Keep all runs serial; never use `--parallel` or another developer's database. Capture migration completion/failure before interpreting test results. On failure, stop and preserve sanitized evidence; no automatic schema repair, rollback, retry against existing state or cleanup.

`btree_gist` is a trusted extension; database CREATE can permit installation without superuser, but preinstallation is the narrower proposed permission model. PostgreSQL 15 introduced NULLS NOT DISTINCT uniqueness. Sources: [btree_gist](https://www.postgresql.org/docs/current/btree-gist.html), [PostgreSQL 15 release notes](https://www.postgresql.org/docs/15/release-15.html), [role attributes](https://www.postgresql.org/docs/current/sql-createrole.html).

## Acceptance sequence and minimum approvals

**Safe now without database setup:** `tests/Unit/ExampleTest.php` (1), `GeminiScratchGuardTest.php` (4, mocked connection), `QueueMigrationRollbackSafetyTest.php` (6, source/constants). Explicit `tests/SourceContracts/QueueMigrationCompatibilityTest.php` is also database-free, with 3 passes/4 expected failures already preserved in the audit commit. Staff P0 data-provider discovery is safe, but **zero of its 10 cases can execute without migrations under the current harness**. Preprovisioning schema alone does not change that. Do not silently remove RefreshDatabase, fake migration completion or exclude migrations to claim acceptance.

Database-free validation performed here:

```powershell
php backend/vendor/bin/phpunit --no-configuration --bootstrap backend/vendor/autoload.php --do-not-cache-result backend/tests/Unit
php backend/vendor/bin/phpunit --configuration backend/phpunit.xml --do-not-cache-result --list-tests --filter StaffP0BranchScopePreservationTest
php -l backend/tests/Feature/Identity/StaffP0BranchScopePreservationTest.php
php -l backend/tests/Support/ScratchDatabaseGuard.php
```

Results: **11 Unit tests / 45 assertions passed**; discovery lists **10 Staff cases** without running setup; both syntax checks and all 86 migration syntax checks passed. No new tests were needed. No application/database boot, seeder, setup script, container provisioning or existing database access occurred.

Before execution, obtain explicit approvals for:

1. **Provisioning and access:** new isolated scratch instance/name exception, exact runner/network identity, dedicated role/grants, synthetic secrets handling and catalog-only preflight. Existing infrastructure is excluded.
2. **Destructive synthetic setup:** the Staff class's automatic `migrate:fresh`/possible `db:wipe`, all 86 migration `up()` operations, fixture/controller deletes and transaction rollback on that disposable instance only. Specifically review automatic execution of the queue migration, feedback removal and chart trigger bypass; generic permission to run Staff tests is insufficient under the existing queue hold. Resolve the queue policy/data-preservation hold or explicitly review the scope of a disposable-only test exception; it grants no production/lifecycle approval. An alternative limited-schema harness would require a separate reviewed patch and narrower acceptance claims.
3. **Bounded test run:** only the named 10 cases, serial execution with evidence collection. No full suite expansion, migrations against populated/shared data, broad rollback or instance disposal without its separately defined authorization.

After these gates, the planned test command, **not executed here**, is run from `backend` in the verified child process:

```text
php vendor/bin/phpunit --configuration phpunit.xml --do-not-cache-result tests/Feature/Identity/StaffP0BranchScopePreservationTest.php
```

Expected sequence: preflight -> unchanged guard -> full empty-schema migrations -> eight unchanged-assignment cases -> repeated-null case -> reassignment/retry case (runner ordering need not match this conceptual list). Record 10 results, assertions, migration log, exact commit, server/role identity and sanitized configuration names. Scope-row identity and audit behavior acceptance are separate from queue upgrade acceptance. A successful run would not clear any of the four known queue failures. Cleanup means a separately approved disposal of only the new instance, not schema rollback or deletion of shared resources.

## Remaining blockers and change manifest

- No approved/provisioned scratch instance or verified least-privilege role exists as evidence from this task; port availability and effective process configuration are unknown.
- Synthetic key and dedicated credentials are not supplied; no environment files exist in this checkout.
- Database-name documentation conflicts and the standing scratch-name exception require explicit review.
- Full-chain destructive setup and the held queue migration are not authorized; PostgreSQL fresh-chain/runtime acceptance is unverified.
- All 10 Staff regressions remain **unexecuted**. Queue upgrade semantics remain unresolved. No production readiness/module status was promoted.

Only added file: `docs/BE_QA_DB_01_DISPOSABLE_POSTGRES_READINESS_2026_11_10.md`. Existing audit files, migrations, guard, services, Staff tests, frontend, clinical code and environment files are unchanged. No staging, commit, push or merge was performed.

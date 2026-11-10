# BE-DB-BOOT-01: Bootstrap and test-isolation audit

November 10, 2026, Asia/Manila. Cutoff: November 11, 2026, 02:00 Asia/Manila.

**Recommendation: accept the audit/test evidence for controlled local review; retain the database execution hold.** The scratch guard protects a particular test entry path and one connection identity read. It is not a pre-bootstrap barrier or a global connection firewall. No database, migration, application bootstrap, seeder, worker or Artisan command was executed in this audit.

## Repository

Branch: `feature/joevan-staff-p0-be-20261110`.
HEAD: `d7e026a0f106605aae6936cc179915a8ed3cf97d`, `test(backend): cover scratch database guard exception paths`.
The prior guard, readiness, queue-audit and Staff P0 commits are preserved. Working tree started clean.

## Actual execution order

The following is source-inspected order, not an executed full-framework integration test:

1. PHPUnit loads `vendor/autoload.php`, discovers tests/providers and applies `phpunit.xml` environment entries. Composer autoload registration is not Laravel kernel bootstrap.
2. A framework-backed test calls repository `Tests\TestCase::createApplication()`. Its parent requires `bootstrap/app.php` and bootstraps the console kernel.
3. Installed `Console\Kernel` bootstrappers run: LoadEnvironmentVariables -> LoadConfiguration -> HandleExceptions -> RegisterFacades -> SetRequestForConsole -> RegisterProviders -> BootProviders. `Application::bootstrapWith()` also dispatches before/after bootstrapper events. Cached configuration can bypass environment-file loading. Most PHPUnit environment settings are not forced and can be superseded by inherited process values.
4. Console kernel bootstrap loads deferred providers, registers/discovers commands and loads console routes. Application and package providers can therefore run before scratch validation. Console-route command bodies are registered closures; registration does not execute those bodies. Scheduling declarations register events rather than running scheduled work.
5. Only after parent `createApplication()` returns does repository `Tests\TestCase` call `ScratchDatabaseGuard::assertSafe()`.
6. After application creation succeeds, test lifecycle calls `setUpTraits()`. RefreshDatabase then invokes its initial `migrate:fresh` before beginning the per-test transaction. Guard failure prevents this normal trait path. It cannot undo earlier bootstrap side effects.
7. The concurrency helper scripts similarly bootstrap the HTTP kernel before invoking the scratch guard and then handling a request. `concurrent_verification.php` adds another database-name SELECT after the guard. No helpers were executed here.

Sources: `backend/tests/TestCase.php`; installed framework `Foundation/Testing/TestCase.php`, `Foundation/Testing/Concerns/InteractsWithTestCaseLifecycle.php`, `Foundation/Console/Kernel.php`, `Foundation/Application.php` and `Foundation/Testing/RefreshDatabase.php`; `backend/tests/Support/concurrent_*.php`.

## Providers and pre-guard activity

`bootstrap/providers.php` names AppServiceProvider. Its registration binds services; its boot method configures optional HTTP CA options and registers rate limiters. No explicit application-provider SQL query was found. The registered ClinicSettings/ClosureCalendar services are scoped bindings, not evidence that their database-reading methods run during registration.

However `RateLimiter::for()` resolves Laravel's rate-limiter service. `CacheServiceProvider` obtains its configured cache store; `CacheManager::createDatabaseDriver()` requests a database connection for the cache and another for locks. This can happen before the test guard if the effective cache/limiter store is database-backed. Repository cache defaults to database; PHPUnit asks for array, but inherited configuration can differ. The new component test demonstrates **connection-object acquisition**, not database network I/O or SQL, during rate-limiter resolution.

`DatabaseServiceProvider::boot()` installs Eloquent's resolver and event dispatcher. Its manager/factory bindings are lazy. ConnectionFactory normally constructs a connection with a PDO resolver closure; `Connection::getPdo()` invokes that closure when needed. Named `::read`, `::write` and `::direct` resolution can instead request the corresponding PDO during manager configuration. A connection object is therefore distinct from an established network connection. DatabaseManager also dispatches a connection-established event when resolving a new object; subscribed code could do more work.

Composer-installed package metadata lists DomPDF, Pail, Pao, Reverb, Sanctum, Tinker, Carbon, Collision and Termwind provider hooks. Their registration/boot sources were screened along with the application provider. No direct SQL call was identified in those inspected hooks. This is not a proof that all transitive callbacks, configured extensions or future providers are free of side effects. Pao has a unit-test early return. Web/channel files register callbacks; channel queries occur when authorization callbacks execute, not merely from reading their definitions.

## Guard coverage and bypass boundaries

| Boundary | Confirmed source/isolated evidence | Limit of conclusion |
| --- | --- | --- |
| Configuration rejection | Guard checks testing environment, expected-address validity, default connection name, scratch database, host, port and URL before requesting `pgsql` | Does not protect code already executed during bootstrap |
| Identity and errors | Actual identity SELECT follows connection acquisition. Previous 43 rejection and 9 exception tests remain unchanged; errors propagate | Identity requires a connection; no pre-connection actual identity claim is possible |
| Named connections | A real DatabaseManager with mocked factory permits resolving an additional named connection after default guard success, without another identity check | The test adds a synthetic named connection; no unsafe alternate connection was opened or shown in use by Staff P0 |
| Nested driver | Guard does not inspect `database.connections.pgsql.driver`; a mock factory can return a matching identity despite a different configured driver | Current production configuration sets `pgsql`. This does not prove a real MySQL driver can execute the PostgreSQL identity SELECT successfully |
| Cached connection | DatabaseManager returns an already cached object after configuration changes; the new test confirms the guard still rejects its mismatched mocked database identity | Earlier uses of that object cannot be retroactively protected. Role/other properties may differ even when the three identity fields match |
| Read/write/direct endpoints | Guard's `selectOne()` defaults to read PDO. Writes use write PDO; schema wipe can select a configured direct connection through `InteractsWithPooledConnections` | Repository pgsql config currently has no read/write/direct split. A split introduced through cached/runtime config could leave a different write/direct endpoint unverified; not demonstrated against live infrastructure |
| Standalone Artisan | `backend/artisan` calls `Application::handleCommand()`, not `Tests\TestCase`. Standard migration/wipe/seed commands and console command bodies have no universal scratch check | Production confirmations/force flags are not scratch-identity verification. No such command was invoked |

No application/model/migration override selecting a separate named SQL connection was found in the targeted scan, apart from ordinary default connection accesses. The framework supports named connections, custom resolvers, connection extensions and per-model connections, so this finding is not a prohibition against their future use. `config/database.php` already defines multiple connection families; validating `pgsql` does not validate them all.

`ClinicDatabaseGuard` is a separate selective demo-command control, found in DemoCheck. It is not installed at the Artisan entry point and is not equivalent to the scratch guard. It checks the protected clinic name, not an allowlist of disposable servers. Its identity-query catch returns false when the configured name did not already match the clinic name; that is a source-level uncertainty/fail-open boundary for that helper, not a demonstrated database write or a new permission to execute commands. `DemoMode` also uses a configured `_demo` suffix rather than strong instance identity. Neither should be reused as a substitute preflight.

The guard does not validate role privileges, empty schema, exclusive execution, container/image/mount identity, nested driver, all configured connections or all PDO endpoints. Those remain infrastructure/preflight requirements. No real guard bypass into clinic data or destructive operation was experimentally demonstrated.

## Earliest checks and mitigation options (not implemented)

- **Before any application bootstrap:** an external runner can reject unsupported environment/connection shapes, inherited URLs/provider credentials, config caches, unexpected connection families and unknown infrastructure identity. This is the earliest useful configuration fence.
- **Before provider registration/boot:** a reviewed bootstrap hook after effective configuration loading could enforce complete connection configuration and verify the explicitly approved target. Its own identity query necessarily connects. Bootstrapper events and earlier autoload/config code must also be considered; moving the existing call alone is not a complete sandbox.
- **Separate minimal preflight:** after explicit access authorization, use a process that does not load app providers and can connect only to the independently provisioned disposable instance. Verify actual database/server/role, privileges, empty schema and every permitted endpoint. Pass a restricted configuration to a fresh child, preserve the in-process guard and reject drift. A successful parent preflight alone cannot prevent later configuration changes, endpoint replacement or concurrent use.
- **Infrastructure enforcement:** a dedicated ephemeral instance, credentials with no access elsewhere, restricted outbound network, no data mounts and an exclusive runner lifecycle provide stronger isolation than source checks. Serial execution alone is not a lock.
- **Command path:** separately review a test-runner/Artisan fence for database-mutating commands. Do not globally impose scratch-only checks on legitimate production CLI behavior without a scoped design and technical-lead approval.
- **Connection lifecycle:** separately review nested driver validation, named/read/write/direct restrictions and cached-connection handling. Purging/reconnecting is not harmless verification and is not authorized here. Reject unsupported configurations before executing work rather than guessing how to repair them.

None of these options authorizes migrations. The [readiness report](BE_QA_DB_01_DISPOSABLE_POSTGRES_READINESS_2026_11_10.md) provisioning/identity/full-chain approval gates and [queue migration hold](QUEUE_MIGRATION_SAFETY_BE_01_2026_11_10.md) remain in force. All 10 Staff P0 database regressions remain unexecuted.

## Added evidence and validation

`backend/tests/Unit/ScratchDatabaseGuardBoundaryTest.php` adds four behavior tests, not source-string ordering assertions:

1. Real DatabaseManager resolves a separately named mocked connection that the default guard never checks.
2. Real manager reuses a cached mocked connection after config changes; the real guard rejects the wrong actual identity.
3. Real guard permits a synthetic matching identity without inspecting the nested driver (characterizes a missing guarantee, not successful real-driver interoperability).
4. Real CacheServiceProvider/CacheManager resolves a database-backed RateLimiter through mocked connections without querying their identity.

The real manager never receives a real ConnectionFactory result: factory constructors are disabled and results are constructor-disabled PostgresConnection mocks. Application shells are mocks; the cache test uses an isolated plain Container. All identity reads are stubbed and counted, writes/transaction starts/PDO access are prohibited in the exercised paths, and the expected-address environment override is restored per test. No full application bootstrap or database operation is performed. These tests establish the component contracts above, not complete infrastructure isolation or end-to-end ordering.

Focused tests: **4 passed / 29 assertions**. Full database-free Unit suite: **67 passed / 335 assertions**, zero failures or skipped cases. New test PHP syntax, tracked/staged whitespace checks, explicit untracked-file whitespace checks and secret-pattern scans passed. Git emitted only a documentation LF-to-CRLF normalization warning. No production safeguard, migration, configuration, existing regression, frontend or clinical file was changed.

Exact new-file manifest:

- `backend/tests/Unit/ScratchDatabaseGuardBoundaryTest.php`
- `docs/BE_DB_BOOT_01_BOOTSTRAP_ISOLATION_AUDIT_2026_11_10.md`

Commit-review recommendation: **GO for a controlled local audit/test commit**, subject to review of both files. This is not approval to run database-backed tests. No staging, commit, push or merge was performed.

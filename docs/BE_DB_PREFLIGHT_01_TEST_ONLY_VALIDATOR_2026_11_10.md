# BE-DB-PREFLIGHT-01: Test-only preflight configuration prototype

November 10, 2026, Asia/Manila. Cutoff: November 11, 2026, 02:00 Asia/Manila.

Branch: `feature/joevan-staff-p0-be-20261110`.
Verified HEAD: `3fcf212701fe5a7f57412ad4cc8f7d5aa141e624`, `test(backend): audit database bootstrap isolation boundaries`.
All previous commits are preserved. Working tree started clean.

**Disposition: GO for controlled test-only commit review; no database execution authorized.**

## Source-grounded approach

The existing `tests/Support/ScratchDatabaseGuard.php` checks the testing environment, default connection name, selected pgsql target fields and a connected identity query. It does not validate all named SQL connections, the nested driver, read/write/direct overrides, configuration caches or the manager's previously resolved objects. Its invocation still occurs after application bootstrap. This prototype leaves that behavior unchanged.

Installed Laravel source confirms:

- `config/database.php` defines several SQL connection families. Its pgsql definition uses driver `pgsql`, host/port/database/URL environment values, UTF-8, empty prefix, `prefix_indexes=true`, public search path and default SSL mode `prefer`.
- `DatabaseManager::configuration()` passes settings through ConfigurationUrlParser. URL primary fields and query options can override ordinary configuration values.
- `ConnectionFactory::getReadWriteConfig()` supports an override or a list of overrides; lists can select a member. `mergeReadWriteConfig()` merges endpoint settings with base settings.
- `Connectors/Concerns/ConfiguresPooledConnections` handles `direct`, `pooled`, `connect_via_database` and `connect_via_port`; these are not ordinary cosmetic keys.
- `DatabaseManager::getConnections()` returns its already-created connection array, without calling `connection()` or constructing PDO. Resolving a connection can reuse an existing object even after configuration changes.
- `Application::configurationIsCached()` exposes cache state and can memoize that state. It is not an independent fresh filesystem/infrastructure attestation.

## Implemented profile and boundaries

New helper: `backend/tests/Support/PreflightConfigurationValidator.php`.
New tests: `backend/tests/Unit/PreflightConfigurationValidatorTest.php`.

The helper calls the supplied application's environment/cache-state methods, reads the supplied configuration repository and finally inspects the supplied manager's `getConnections()` metadata. It never calls `connection()`, builds a manager/factory, opens PDO, resolves app providers or repairs configuration.

The **proposed test-runner profile** is deliberately narrower than Laravel's supported configuration:

| Input | Prototype rule |
| --- | --- |
| Environment/cache | Testing only; cached configuration rejected |
| SQL connection inventory | Exactly one configured connection, named `pgsql`, selected as default. Even a same-target alias is rejected |
| Nested target | Driver `pgsql`, database `dental_clinic_scratch`, host `127.0.0.1`, port integer 5432 or exact string `5432`, explicit public search path |
| URL | Missing, null or empty string only; other strings, whitespace and unexpected types rejected |
| Endpoint/unknown keys | Only the pgsql keys enumerated from the reviewed configuration are permitted. Read/write/direct keys are rejected even when empty/null/false. Pooled/connect-via/PDO options and unknown keys are rejected |
| Optional ordinary settings | If supplied: UTF-8, empty prefix, true prefix indexing, SSL mode `prefer`. Other values are unsupported by this prototype, not necessarily unsafe in every application |
| Credentials | Optional username/password fields must be strings when present. Missing/empty credentials are not established as usable. No role identity, privilege or credential validation occurs |
| Existing connection cache | Any entry in the supplied manager's resolved-object array is rejected, regardless of name; no object is queried, purged or reconnected |

The ordinary repository configuration has multiple named connection definitions and will therefore **fail this profile unchanged**. A future isolated runner would need a separately reviewed configuration snapshot and wiring. No production config was reduced, rewritten or activated here. Strict rejection of harmless-looking empty overrides avoids claiming support for unreviewed merge behavior.

The helper is **not installed** in `Tests\TestCase`, PHPUnit bootstrap, production providers, Artisan or a launcher. Normal Unit discovery runs its tests, not a universal preflight. Do not treat a call to this helper as database-testing permission or a substitute for the existing connected identity guard.

## Regression evidence

All tests invoke the actual new helper with real configuration repositories and constructor-disabled Application/DatabaseManager/PostgresConnection mocks. No full Laravel bootstrap or real connection is used. Tests explicitly forbid connection acquisition, dynamic connection building, reconnect/purge/disconnect and manager proxy calls. Cached-object cases forbid identity SELECT, writes, transactions and PDO operations on those objects.

| Cases | Count |
| --- | ---: |
| Invalid configuration shapes: missing/default/alternate/nested-driver/target/URL/search-path settings, endpoint override variants, unsupported options and credential field types | 57 |
| Wrong environment | 1 |
| Cached configuration | 1 |
| Existing default/alternate/read/write/direct connection objects | 5 |
| Accepted target variants: integer/string port; missing/null/empty URL | 6 |
| Manager-metadata exception propagates as the identical object | 1 |
| **Total** | **71** |

Configuration rejection precedes manager metadata access. Accepted cases verify the caller's configuration remains unchanged. Metadata failure propagates rather than producing acceptance. Synthetic inputs contain no real credentials, provider keys or clinic records. No source-string assertions are used to simulate safety.

Validation from repository root:

```text
php -l backend/tests/Support/PreflightConfigurationValidator.php
php -l backend/tests/Unit/PreflightConfigurationValidatorTest.php
php backend/vendor/bin/phpunit --no-configuration --bootstrap backend/vendor/autoload.php --do-not-cache-result backend/tests/Unit/PreflightConfigurationValidatorTest.php
php backend/vendor/bin/phpunit --no-configuration --bootstrap backend/vendor/autoload.php --do-not-cache-result backend/tests/Unit
```

Results: syntax PASS; focused **71 passed / 357 assertions**; complete database-free Unit suite **138 passed / 692 assertions**; zero failures or skipped tests. Existing guard/boundary/exception/rollback evidence is unchanged. Full database-backed suites, smoke/build and database/service diagnostics were not run for this test-only scope.

## Limits and next approval boundary

A pass validates only the supplied snapshot and the supplied manager's metadata. It does not independently prove:

- The physical server, actual database, session user, role grants, empty schema or approved disposable instance.
- Exclusive use, network/filesystem isolation, container/image/mount identity or absence of provider side effects.
- That a cache-state flag is fresh, every manager/connection object in the process was supplied, or custom factories/resolvers/dynamic definitions cannot later introduce connections.
- That configuration will remain unchanged after validation, a later child process uses the same settings, or another process cannot replace an endpoint.
- Real PostgreSQL driver/extension compatibility, credential validity, migration behavior or protected-history enforcement.

Redis and other non-SQL outbound services are outside this SQL profile; separate side-effect suppression remains necessary. No bootstrap ordering guarantee or production security enforcement is added by this helper.

Before wiring/executing a runner, review the profile choices and cache/manager provenance, establish a fresh isolated process and restricted network/credentials, and obtain the existing explicit scratch-instance/name, identity-preflight and full-chain execution approvals. Actual identity/privileges/emptiness checks necessarily require separately authorized connections. Do not add those connections to this helper or bypass the queue hold as a convenience.

The queue migration remains blocked. All 10 Staff P0 database regressions remain unexecuted. No production integration or deployment is authorized.

## Exact change manifest

1. `backend/tests/Support/PreflightConfigurationValidator.php`
2. `backend/tests/Unit/PreflightConfigurationValidatorTest.php`
3. `docs/BE_DB_PREFLIGHT_01_TEST_ONLY_VALIDATOR_2026_11_10.md`

No existing file, environment value, production guard, migration, queue service, frontend or clinical code was modified. No staging, commit, push or merge was performed.

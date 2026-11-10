# BE-DB-PREFLIGHT-02: Drift and provenance evidence

November 10, 2026, Asia/Manila. Cutoff: November 11, 2026, 02:00 Asia/Manila.

Branch: `feature/joevan-staff-p0-be-20261110`.
Verified HEAD: `39f567e53e9134b073dea8a25e8d8c8f7bc55a31`, `test(backend): prototype isolated database preflight validation`.
All earlier Staff P0, queue-audit, readiness, guard, bootstrap and preflight commits remain intact. Tree started clean.

**Recommendation: GO for controlled test-only commit review.** No database execution, launcher integration or production safeguard change is authorized or implemented.

## Source findings

The BE-DB-PREFLIGHT-01 helper validates current configuration and the supplied manager's resolved-object array; it does not retain mutation history or bind a later execution to the validated dependencies. A successful check cannot keep a mutable configuration repository unchanged. Re-running it rejects currently unsupported values, but still accepts a different snapshot that independently fits its profile.

Installed Laravel `Application::configurationIsCached()` can return the container's `config_loaded_from_cache` value without inspecting the cache path again. The new partial-mock test exercises that real method with a false marker and prohibits cache-path lookup. This proves the observable method contract, not the creation or loading of a real cache file.

`DatabaseManager::getConnections()` returns the manager's existing connection array without constructing a connection. It is suitable for observing resolved objects in that manager, not for finding all managers or connections in a process. Existing scratch-guard identity checks, bootstrap order, named/read/write/direct gaps and database execution holds are unchanged.

## New test-only helper

`backend/tests/Support/PreflightHandoffEvidence.php` captures:

- The exact supplied Application and DatabaseManager object references.
- The exact configuration repository reference.
- The SQL snapshot consisting of `database.default` and `database.connections`.

Capture snapshots the repository, runs the existing preflight validator, then checks reference/value consistency again before issuing evidence. The old validator is not modified.

`consumeBeforeSimulatedHandoff()` checks object identity and snapshot equality, re-runs current preflight validation, and checks repository/snapshot consistency again. Each attempt consumes that evidence instance before checks, including a rejected attempt. `invalidate()` explicitly revokes that instance. No callback, test runner, Artisan command or database operation is invoked. Snapshot values may contain credential strings in memory; the helper emits only fixed error messages and refuses ordinary serialization.

This is a proposed evidence protocol, **not an authorization token or security boundary against arbitrary code in the same process**. It has no global registry, automatic latest-ticket rule, process-wide dependency attestation or cross-process identity mechanism. One-use/invalidation state is local to each evidence instance, not a universal revocation service. No production bootstrap, command or database-backed test is wired to it.

## Demonstrated drift and provenance contracts

| Scenario | Observed test-only result |
| --- | --- |
| Database, host, port, URL, alias, read/write/direct endpoint or driver changed after capture | Evidence rejects before simulated handoff; current configuration is not repaired |
| Profile-valid port representation, URL shape or username changed | Evidence still rejects exact-snapshot drift, even though the old validator could independently accept the new profile |
| Supplied manager or application replaced | Exact-reference comparison rejects before inspecting the replacement manager |
| Repository replaced with equal values | Exact repository-reference comparison rejects |
| Old evidence explicitly invalidated; new evidence captured | Old reference rejects; new evidence can pass its own revalidation |
| Rejected attempt followed by restoration | Used evidence remains unavailable; a new capture is needed |
| Observable cache flag or testing-environment status changes | Revalidation rejects |
| Default or alternate resolved connection appears in supplied manager | Revalidation rejects without calling methods on that object |
| Controlled configuration mutation during manager-metadata inspection in capture/revalidation | Final snapshot consistency check rejects |
| Unchanged snapshot and references | One evidence instance permits one simulated handoff check and rejects reuse |
| Ordinary serialization | Rejected to avoid persisting the captured snapshot/dependencies |

The new tests also deliberately demonstrate acceptance limitations rather than claiming them fixed:

- A wrong value changed and restored before the next observation is indistinguishable from an unchanged snapshot. Likewise, a cache flag that becomes true and false between observations leaves no history.
- Capturing new evidence does not implicitly invalidate previous evidence. The caller must explicitly invalidate stale references if supersession is intended.
- If a runner changes its manager variable but supplies the old validated manager to this helper, that hidden replacement is not detected. The helper does not resolve or verify the application's `db` binding, nor any runner-local variable.
- Laravel can report cached-false without rechecking the disk path. Re-reading that method does not create independent fresh cache evidence.

These results are mock/component observations; no live database bypass or filesystem cache race was executed.

## Regression evidence

`backend/tests/Unit/PreflightHandoffEvidenceTest.php` adds **30 cases**:

- 12 configuration-drift variants, including three independently profile-valid changes.
- 18 cases for successful one-use revalidation, manager/application/repository provenance, explicit invalidation, rejection persistence, cache/environment changes, two resolved-object variants, two mid-check mutations, restored-history limits, independent captures, stale caller arguments, serialization refusal, plain-validator recheck and Laravel's memoized cache-state behavior.

Tests invoke the real new helper and the real existing preflight validator. Configuration repositories are real, mutable, synthetic instances. Application/manager/connection boundaries are constructor-disabled mocks. Manager acquisition/build/reconnect/purge/proxy calls are forbidden; resolved connection objects prohibit identity queries, writes, transactions and PDO operations. A partial Application mock exercises only the real cache-state method with its dependencies replaced. No environment variables or environment files are changed by these new tests.

Simulated handoff evidence is a local integer increment after a successful consume call. Rejection tests verify that increment is not reached. No execution callback or kernel is involved. These assertions prove control flow through the helper, not actual process-wide execution enforcement.

Validation from repository root:

```text
php -l backend/tests/Support/PreflightHandoffEvidence.php
php -l backend/tests/Unit/PreflightHandoffEvidenceTest.php
php backend/vendor/bin/phpunit --no-configuration --bootstrap backend/vendor/autoload.php --do-not-cache-result backend/tests/Unit/PreflightHandoffEvidenceTest.php
php backend/vendor/bin/phpunit --no-configuration --bootstrap backend/vendor/autoload.php --do-not-cache-result backend/tests/Unit
```

Results: new tests **30 passed / 325 assertions**; complete database-free Unit suite **168 passed / 1,017 assertions**, zero failures or skips. Syntax passed. Existing profile/guard/boundary/exception evidence remains unchanged. No database connection, bootstrap, migration, seeder, provisioning or destructive command was executed.

## Architectural limits and next review gate

The snapshot covers SQL default/connection configuration, not arbitrary application/cache/mail/Redis settings. Dependencies, cache markers and manager metadata are caller-supplied observations; their origin is not independently authenticated. References and comparison checks cannot observe hidden replacement, mutations restored between observations, future changes after return, other processes or container/server replacement. Post-check timing is not atomic with a real execution path. Snapshot equality is deliberately strict, so representational changes can require recapture.

This prototype verifies no actual server/database identity, credentials, role grants, empty schema, exclusive-run lock, container/image/mount identity, network isolation or migration safety. Ordinary serialization refusal is not a general defense against reflection, cloning, custom extraction or hostile code running in-process. Snapshots remain sensitive in-memory data and must not be logged.

A future runner needs separately reviewed wiring that owns the current dependencies, refuses stale arguments, handles explicit supersession/invalidation, validates before any permitted execution boundary and enforces isolation outside these PHP objects. Do not infer permission to run that runner from these test results. The existing scratch-instance/name, connected-preflight and full migration-chain approvals remain outstanding.

The queue migration remains blocked. All 10 Staff P0 database-backed regressions remain unexecuted. Production integration and deployment are not authorized.

## Exact change manifest

1. `backend/tests/Support/PreflightHandoffEvidence.php`
2. `backend/tests/Unit/PreflightHandoffEvidenceTest.php`
3. `docs/BE_DB_PREFLIGHT_02_DRIFT_PROVENANCE_2026_11_10.md`

Only these files were added. Existing helpers/tests, production guard, bootstrap, Artisan behavior, configuration, migrations, frontend and clinical files are unchanged. Nothing was staged, committed, pushed or merged.

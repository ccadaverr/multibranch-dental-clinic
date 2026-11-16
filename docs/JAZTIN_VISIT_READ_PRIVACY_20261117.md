# Direct Visit GET privacy correction — 2026-11-17 Asia/Manila

Owner-authorized Clinical security correction only. Starting Clinical HEAD `3c81b04086beb31d523859ac8ea37201a8c16c90`, branch `feature/jaztin-qa-20261115`. This report is committed with the correction; the final delivery identifies its full commit SHA. No push, PR #9 alteration, Operations import, merge, deployment, or migration.

## Vulnerability and corrected contract

The assessment at `/private/tmp/dentalops-clinical-assessment-20261117-s38w3p5i/` proved Staff/Dentist direct `GET /api/visits/{visit}` returned 403 for an existing unauthorized Visit and 404 for a missing public ID. Implicit Visit binding happened before the resource policy, exposing existence. Denial responses did not contain the clinical record.

The endpoint now takes a raw string, validates the ULID, and resolves it through `Visit::visibleTo` using the identity refreshed by `EnsureAccountAccess`. The existing `VisitPolicy` remains an additional check before loading/projecting authorized relationships. Both checks use the same current request actor via `Gate::forUser`, rather than a potentially stale cached authentication-guard role. A deterministic additional regression reproduced a 200 with a cached former Owner role during branch revocation; the explicit actor fixes that case too.

| Request | Corrected response |
|---|---|
| Authorized branch-scoped Staff, responsible Dentist, existing Owner oversight | 200, unchanged VisitResource/public identities and permitted history |
| Existing Visit outside Staff branch or Dentist responsibility | 404, exactly `{"message":"Visit not found."}` |
| Patient role, including its own Visit | Same generic 404; no Patient Visit access added |
| Valid-format missing public ID | Same generic 404 |
| Internal numeric ID, legacy/non-ULID identifier, malformed path segment | Same generic 404; no internal-ID lookup |
| No authentication | Existing generic 401, independent of existing/missing/malformed ID |
| Suspended or stale-version session | Existing session-level denial (`403`, `session_revoked`), independent of Visit existence |

Successful reads and resource-level 404s explicitly set `Cache-Control: private, no-store`. Generic denial bodies remain identical with APP_DEBUG enabled, excluding record IDs, names, relationships, policy messages, model identifiers and debug traces. Session middleware and its established session-level error contracts are unchanged.

Only this direct read's coarse route allowlist is replaced by the existing authoritative visibility scope and positive policy. The route stays inside `auth:sanctum` plus `EnsureAccountAccess`. Unpermitted roles can never produce a Visit resource. List, arrival receipt, Check-In, walk-in, treatment and HMO routes retain their existing role gates and commands. No VisitPolicy or permission expansion occurs.

No lifecycle, admission, queue order, Served/start/completion meaning, chart revision/CAS/idempotency, prescription, billing, immutable history or DEN-14/STF-21 grant behavior changes.

## Consumers and compatibility

`src/api-client.js:getVisit` is the public frontend wrapper; source search found no current product call/import of it. Other product Visit projections use the list or exact treatment/arrival-receipt routes, which are unchanged. The shared client already maps 404 to `not_found`, session-revoked 403 to `unauthenticated`, and network errors to a retryable read failure; new tests preserve these mappings without automatic replay.

Direct GET assertions also exist in VisitTest, the synthetic VisitSettlementJourneyTest and local Visit/arrival/encounter browser drivers. Only their direct unauthorized-read expectations change from 403 to 404; no authorized read, collection denial or treatment-route denial is relaxed. The arrival browser driver's Patient-denial assertion is updated. Existing direct read successes preserve exact Patient, branch, appointment, Visit, Dentist and queue public identities.

No product UI rendering or user-visible recovery implementation changed, so the existing multi-step arrival browser journey was not rerun or claimed as passing anew. Real HTTP/kernel PostgreSQL checks, real web-session regressions, API error/retry tests, full frontend, smoke and build provide the relevant acceptance here. This is not a four-role integrated browser acceptance claim.

## Isolated database safety

The owned source manifest `/private/tmp/jaztin-clinical-20261115c/target.json` was verified against loopback host, actual database/server/cluster/data-directory identity, ownership and reviewed source hashes. Its `dental_clinic_test` source was empty (zero Patients), with exactly 83 reviewed applied migrations and none of the four held migrations.

New disposable clusters were cloned from that reviewed empty schema. Feature tests used `/private/tmp/contention-1c6154f8/target.json`, the restricted runtime database role, the normal per-database lock and `IsolatedTestBootstrap`. RefreshDatabase used transactions against the already verified ledger; no default migration/reset chain was executed. Mail array/sync was explicitly selected for these HTTP feature tests, and stray HTTP requests were prohibited. No real recipient/payment/provider was involved.

Real independent-process authorization races used separate empty clones. Final evidence is `/private/tmp/contention-fd6bc6cf/logs/visit-read-race-result.json`; earlier successful race evidence is `/private/tmp/contention-3bc3de19/logs/visit-read-race-result.json`. The harness verifies the exact ledger and dedicated clone, refuses normal demo/test service manifests, and takes the database lock before fixtures. It creates only synthetic records and one named walk-in. Owner branch revocation uses the existing authorized, audited API rather than a competing workforce implementation.

Both before-query and after-scoped-query/before-policy barriers proved: authorized read first 200; a separate Owner process/PG connection commits scope revocation while the reader is in flight; the reader then returns exactly the private/no-store generic 404. The harness verifies distinct PostgreSQL connection IDs. This is a real authorization interleaving, not a claim that the read endpoint uses application write locks or a new write-race algorithm.

The race harness stops only its verified disposable cluster and retains private evidence. No migration runs. Normal non-disposable target refusal was exercised. No original demo intents/jobs were replayed or edited.

## Tests actually run

Private logs: `/private/tmp/jaztin-visit-security-20261117-t063ve_n/`. Counts overlap; do not add them into a unique whole-suite total.

| Check | Actual result |
|---|---|
| New foreign-versus-missing baseline before correction | **1 test / 4 assertions, 1 failure**: expected 404, received 403. `baseline-privacy.log`. |
| Initial corrected privacy file | **13 tests / 278 assertions pass**. `privacy-after.log`. |
| Additional cached-Owner actor baseline | **1 test / 4 assertions, 1 failure**: expected 404, received 200. `canonical-actor-before.log`. |
| Final VisitReadPrivacyTest + VisitTest + AppointmentAuthorizationTest | **54 tests / 597 assertions pass**, including all **14 new privacy regressions** and the corrected actor case. `final-visit-security.log`. |
| Visit/arrival/treatment/encounter/Cash journey/auth hardening regressions | **84 tests / 1,165 assertions pass**, before the final explicit-actor refinement. `clinical-regressions.log`. The deliberate audit-unavailable diagnostic is an expected rollback test, not a failing test. |
| Appointment authorization, RBAC and Staff branch-scope preservation | **36 tests / 164 assertions pass**, before final actor refinement. `appointment-role-regressions.log`. |
| Final session suspension/stale revision/unverified-session + synthetic Cash settlement journey | **4 tests / 70 assertions pass**, after final actor refinement. `final-session-settlement.log`. |
| Independent-process scope revocation, final code | **Both phases pass**, 200→Owner revoke 200→read 404; independent PG connections; zero migrations. `independent-revocation-final.log`. |
| Affected API/Visit/treatment/arrival/ID frontend tests | **81 pass / 0 fail / 0 skip**. `frontend-focused.log`. |
| Final API-client file after test-title clarification | **15 pass / 0 fail / 0 skip**. `api-final.log`. |
| Full frontend | **1,956 total: 1,947 pass / 1 fail / 8 skip / 0 cancelled**. Sole failure remains OWN-11, `tests/staffing.test.js:106`, `/Staff work schedules/`. `frontend-full.log`. |
| Smoke / frontend build | **17 smoke groups pass; build passes**. Inherited React list-key / bundle-size warnings retained. `smoke.log`, `build.log`. |
| Local-only predefense, read-only database option | **5 FAIL / 6 WARN**. Global worker/scheduler absent, no unpaid invoice, deliberately synthetic branch contact/hours, 14 aged synthetic intents; no external checks/delivery. `predefense-local.log`. |
| PHP syntax / Python syntax / diff / credential-pattern checks | Pass on changed source and reviewed additions. No secret, environment, MIME, private document or dump committed. |

The final backend group covers authorized scheduled/walk-in Staff and responsible Dentist readback, Owner's existing scope, cross-branch/same-branch-unrelated-Dentist/Patient denial, exact sanitized equality, APP_DEBUG, numeric/malformed IDs, anonymous denial, actual Owner branch revocation, role refresh, suspended and stale web sessions, and revocation between lookup and projection.

### Reproducible commands

Use an explicitly verified private owned target, never ambient/backend .env credentials. `clone-test` returns a NEW target manifest; substitute it below. No migration command is required or permitted.

```sh
python3 scripts/local-system.py --target <owned-source-manifest> --profile test clone-test
python3 scripts/local-system.py --target <new-clone-manifest> --profile test --test-mail-profile suite test tests/Feature/Visits/VisitReadPrivacyTest.php tests/Feature/Visits/VisitTest.php tests/Feature/Appointments/AppointmentAuthorizationTest.php

# A separate NEW empty clone is required: this intentionally commits synthetic race fixtures and stops that clone.
python3 scripts/local-system.py --target <owned-source-manifest> --profile test clone-test
python3 scripts/visit-read-privacy-race.py --target <separate-new-clone-manifest>

node --test tests/api-client.test.js tests/m8-visit-cutover.test.js tests/m5-treatment-cutover.test.js tests/arrival-command.test.js tests/id-verification-receipt.test.js
npm test
npm run test:smoke
npm run build
```

Full backend/default reset suites were not run on this held-migration profile. All scoped backend acceptance above ran on real PostgreSQL; the red full-frontend/predefense results remain visible rather than excluded. The security fix does not repair OWN-11 or manufacture worker/fixture readiness.

## QA, integration and remaining work

The correction closes the independently demonstrated direct-Visit disclosure defect and its actor-consistency edge case. It strengthens the shared Visit authorization boundary; it is not a new original QA ID or proof that a broader original criterion is complete. The authoritative 68-row ledger is unchanged and validates at **21 locally Complete / 36 Partial / 11 Blocked**, all integrated acceptance PENDING.

Reported frozen Operations remains `9409b59e769de29ec0e58ab238b11d40fee29b45`, unavailable on this Mac. No source receipt, receiver digest/ancestry verification, import, merge or integration execution occurred; candidate HEAD NONE. GitHub/source-delivery/publication gates remain unchanged. The small shared route change must be explicitly preserved during eventual authorized source comparison.

All four held migration files remain unchanged and unexecuted. The conversation grant proposal and existing-service schema remain untouched. Highest-priority remaining Clinical blocker is separately reviewed DEN-14/STF-21 existing-service grant cutover and authentic contract parity; GEN-07 representation/inventory and GEN-09 complete workflow measurements remain partial. OWN-11 reconciliation remains Joevan-owned pending authentic evidence/source. No demo, integrated or production readiness is established.

Applied: Tesler's Law (central server-side identity/scope rule); Postel's Law (strict, consistent non-disclosing response structure without weakening authorization).

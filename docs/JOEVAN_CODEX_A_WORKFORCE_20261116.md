# Codex A workforce/personnel acceptance — November16,2026

Phase1, local synthetic acceptance only. Starting branch `feature/joevan-qa-20261115`, HEAD `63a8832d59105b1ef3c209fc0e84f0401b0ac43e`,17 preserved commits beyond `a0725e645df6f8266c2bc4bebacc9d62dd18e7c1`. Initial index/tree clean; later B changes are separately owned. No push, merge, deployment or Jaztin PR action. Final commit/bundle identities are reported from Git after this file is committed.

## Source-supported scope and changes

| QA | Exact original criterion in FINALS-QA-REVISIONS.md | This batch's demonstrated correction | Status |
| --- | --- | --- | --- |
| OWN-10 | “Work schedule matches the agreed staff changes.” Q1 default: Owner reuses Staff schedule/leave logic and manages both roles. | An authorized Staff requester assigned to b1 but permitted b2 could save Pending at b2, then received403 on their own read/history and could not reopen their workspace. Exact-self reference metadata now keeps login and request navigation available; record/history access uses the actual resource branch. Owner reviews and publishes the same persisted request; a new Staff sign-in reads its effective duty. | Locally acceptance-ready, awaiting integration; retains Batch11 recurrence/leave/publication evidence. |
| OWN-11 | “Work schedule can be set for dentists and staff.” Tasks require both role choices; hardening specifies role permissions and overlaps. | Staff self entry remains reachable without widening the scoped directory. Removed a false unavailable-roster notice on publication-capable servers. Also corrected a reproduced Owner personnel-write authority gap: an already-authenticated Owner revoked during a PostgreSQL wait could update a Dentist operational profile. Current actor locks/revalidation, transactional audit and exact readback now refuse that write. | Locally acceptance-ready, awaiting integration; accepted roster lifecycle and Doctor-duty contracts preserved. |
| STF-08 / OWN-12 | Existing shared partial-day leave requirements. | No implementation changes or new full-closure claim; existing accepted candidates retained. | Retained local acceptance candidates. |
| GEN-11 | “No record is permanently deleted by normal users; each role sees only permitted archives; Dr Dana sees all.” | A does not claim archive closure. Exact-self history remains restricted by current resource branch; B owns operational archives. Approved recipient/clinical privacy rules take precedence over universal-inbox interpretations. | Partial across modules; entity-specific restore/delete policy remains unresolved. |

No new roster model, state transition, migration, default hours or clinical booking dependency. No further missing independent A-owned original criterion was demonstrated in the narrow source comparison; do not reimplement accepted leave/roster recovery to manufacture progress.

## Owned files and actual contracts

Self-access: `backend/app/Http/Controllers/{WorkScheduleController,StaffRosterController}.php`, `backend/app/Http/Controllers/Reference/StaffProfileController.php` (index only), `src/pages/Staffing.jsx`, shared `src/reference-data-bridge.js` (bootstrap only), `docs/contracts/STAFF_ROSTER_DUTY_API_V2.md`.

The actual GET routes add `data.self_staff` on `/api/work-schedules` and `meta.self_staff` on `/api/staff`. Other directory data is unchanged. Metadata identifies exact authenticated self; assignment is descriptive, not authority. Roster reads/history retain exact Staff/date and authorize existing record branches; unknown own preparation returns explicit null only with current scopes. History still filters revoked snapshots before its50-row page. The v2 mutation revision/idempotency/publication contracts are unchanged.

Personnel: `backend/app/Http/Controllers/Reference/DentistProfileController.php`; existing Owner-only `PATCH /api/dentists/{legacy_ref}`. Actor is refetched and held with NO KEY UPDATE before locking the profile; Active Owner and observed auth-version must still match. Fields and branch pivot synchronize in one transaction. A real change writes `dentist_profile.updated` with exact actor/profile identity and changed-field/branch-reference metadata; professional values are not copied to audit. Resource DTO is materialized under the profile lock. A repeated identical no-op creates no second audit. This existing endpoint does not gain a new CAS/idempotency API; do not confuse no-op behavior with durable command replay.

A regression paths: `backend/tests/Feature/Staffing/{WorkforceSelfAccessTest,PersonnelUpdateReadbackTest,PersonnelAuthorityContentionTest}.php`, `backend/tests/Support/personnel_authority_worker.php`, retained `Scope01WorkScheduleVisibilityTest.php`, `tests/workforce-self-access.{test.js,browser.mjs}`. Two stale exact DTO-key expectations were updated to name all actual keys, including pre-existing revision/capability fields; strict equality and all directory/no-scope/peer assertions remain intact.

## Focused verification

```text
node --test tests/workforce-self-access.test.js tests/reference-data-bridge.test.js tests/staffing.test.js
# 39 passed,0 failed.

docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/roster11b/target.json --profile test test tests/Feature/Staffing/WorkforceSelfAccessTest.php tests/Feature/Staffing/Scope01WorkScheduleVisibilityTest.php tests/Feature/Staffing/PersonnelUpdateReadbackTest.php
# 14 tests,104 assertions passed on actual PostgreSQL.

docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/contention-d6322bb8/target.json --profile test test tests/Feature/Staffing/PersonnelAuthorityContentionTest.php
# Fresh clone:1 test,71 assertions passed; three actual PostgreSQL lock waits.

node tests/workforce-self-access.browser.mjs <installed-playwright-index.mjs>
# Real private PostgreSQL/API and Chrome: passed.
```

Before correction, own roster read returned403 and navigation metadata was absent; the committed-race baseline returned200 after Owner deactivation. After correction, inactive Owner, changed role and changed auth-version each return403 without profile/branch/audit mutation. Dedicated committed contention fixtures refuse the regular target and a nonempty clone; never rerun them on a used clone.

Browser verifies b1 assignment/b2-only access, unchanged scoped directory, exact self request/history, keyboard submit and Owner review, explicit approval/publication, new-sign-in duty09:00–17:00 and unchanged profile assignment. Owner personnel dialog saves to the exact persisted profile ID and keeps branch assignments. Six widths375/390/430/768/1024/1440 fit without page overflow/runtime errors. The script restores the synthetic account's original scopes and the original profile specialty; published test evidence remains retained. The initial browser failure exposed the bootstrap dependency and was fixed; later selector setup uses stable endpoint order and authoritative ID because legacy display names are transitional projections. No name-data reconciliation or clinical source changes are claimed.

Verified runtime: only A-owned `dentalops-joevan-ops-20261115`, `/private/roster11b/target.json`, demo/test databases and fresh A contention clones;87 selected/applied migrations, all four holds preserved. B uses a separate container/source/private target. No `.env`, cached Laravel configuration, migrations or protected queue semantics changed.

## Shared-worktree coordination and limits

A coordination file lists exact claims and verification. A commits are `be90871` (exact self access) and `b017284` (personnel authority). B explicitly declared READY FOR CODEX A COMMIT; A reviewed paired record filters, scope-before-pagination, sanitized metadata and CSV changes, reran19 focused B Node checks, checked staged files remained unchanged, scanned the staged diff and committed only B's14 named files as `fe8c7d8`. B's owned report is `docs/coordination/JOEVAN_CODEX_B_20261116.md`; A made no edits to B's business files or handoff. B reports29 PostgreSQL tests/443 assertions and targeted audit/report/archive browsers in its separate container; these are B-reported results, not duplicate A test runs. Its earlier analytics automation-health setup404 is inherited/environmental and unchanged.

B requested a narrow AnalyticsPage CSV context correction in shared `src/pages/Admin.jsx`; A claimed that section and `tests/analytics-export-context.test.js`. Four Node tests cover live Owner/branch dispatch, duplicate prevention and stale callback/success/failure handling. `tests/analytics-export-context.browser.mjs` with its A-only fixture proves unresolved branch dispatches zero requests, exact b2/this-week CSV downloads, both controls deny Staff/inactive/offline sessions and current success is shown. The handler remains backward-compatible with B's current undefined return. **Partial:** B's owned transport must honor the requested second callback before creating/clicking a download. A requested that change through its handoff, did not edit B's file, and does not certify delayed-download cancellation. A's callback tests validate the call-site contract, not a nonexistent transport capability. No new whole QA closure is based on export guards.

Batch boundary: `npm run test:smoke` passed, and `npm run build -- --outDir <unique TEMP dentalops-codex-a-batch12 directory>` passed (359 modules). Existing React Table-key and bundle-size warnings remain; the unique external output was deliberately not emptied. `node --test tests/analytics-export-context.test.js tests/audit-api.test.js tests/owner-report-export.test.js tests/aud03-archive-feedback.test.js` passed23/23 (4 A,19 B), in addition to the39 earlier A-focused checks. No focused introduced failures remain. PHP lint for all four changed controllers, `git diff --check` and guarded `verify-guard` (1test/14assertions) passed; all four held migrations are untouched. Staged exact paths and credential-pattern scans passed for each commit. Full suites, hosted predefense and unified cross-module acceptance remain deferred under the selective parallel-work instruction; no full68/68 claim.

Remote publication remains blocked by missing authoritative Vercel preview isolation and connected Render/Railway deployment exclusions. Roster business publication is unrelated to Git/hosting publication. Shared integration later must retain Doctor booking/duty, self identity versus branch authority, exact revisions/publication receipts and clinical/private notification restrictions.

DONE: exact-self workforce completion and revoked-Owner personnel authority/readback; focused local acceptance.
IN PROGRESS: B transport callback follow-up and later integrated acceptance; B ready-batch review/commit completed.
BLOCKED: hosting publication gate; universal archive/restore/delete policies outside approved entity scope.
NEXT: B implements the scoped export callback, then run its delayed-response browser acceptance; retain the completed workforce/personnel and reporting/archive candidates for later integration. Final Git/bundle state is reported after this document's commit.

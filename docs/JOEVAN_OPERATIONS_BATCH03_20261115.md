# Operations continuation batch03 — 2026-11-15, Asia/Manila

Started clean on `feature/joevan-qa-20261115` at34bd2e61d75e577bb30838985be092a00c74783e. Preserved all four local commits. Explicit fetch still resolves collaboration to baseline a0725e645df6f8266c2bc4bebacc9d62dd18e7c1; baseline ancestry confirmed. No reset, merge, integration or publication.

## Implemented and scoped original criteria

Exact original criteria remain in root `FINALS-QA-REVISIONS.md`; module planning in `docs/MODULE_IPO_BLUEPRINT.md`, M3 dated shifts/revision/history. This is an implementation queue, not a new68-item audit.

| ID | Original criterion | This batch and status |
|---|---|---|
| OWN-11 | Work schedule can be set for dentists and staff. | **Partial.** Owner date/branch Staff preparation, strict date/interval/calendar validation, observed revisions, exact replay, immutable revision history, authoritative reload. Explicit Draft only; effective recurring/published Staff duty remains blocked by policy. |
| OWN-10 | Work schedule matches the agreed staff changes. | **Partial.** Same shared schedules entry, preparation/recovery and leave audit correction. Original clarification points to STF-07/STF-08, not a new Owner-only schedule system. No invented agreement or closure. |
| STF-07 | Operations shows correct on-duty status per doctor per branch. | Existing Doctor-duty API unchanged; drafts are never consumed as Doctor or Staff duty. No duplicate closure. |
| STF-08 / OWN-12 | Partial-day leave saves correct dates and times / Owner leave requests match staff behavior. | Existing date/time workflow retained. Fixed audit atomicity for leave request/approve/decline/cancel; real rollback plus existing partial-day/leave regression passed. No new claim that all leave policies or concurrency contracts are complete. |
| GEN-11 | No record is permanently deleted by normal users; each role sees only permitted archives; Dr Dana sees all. | **Partial.** Owner can filter existing safe archive-activity metadata and personnel/draft audit actions. Fixed obsolete pagination, inspection and export contexts. Verified non-Owner audit denial and that Owner does not inherit another recipient's notification content access. Broad Owner restore/delete/privacy conflict remains unresolved. |
| GEN-10 | Notifications grouped under date headers; each can be removed (archived); button looks consistent and outline-free. | Previous implemented-awaiting-integration status retained. No archive rewrite, restore/delete or duplicated closure. |

## Files and behavior

- Roster: new `StaffRosterDraftController`, `StaffRosterDraft` model, additive opt-in migration in `database/operations`, `src/pages/StaffRosterDraft.jsx`, `src/staff-roster-draft.js`. Narrow routes and API-client additions; Owner entry in existing `StaffScheduleProfiles`. Strict identity and dates, same-day hours inside existing branch calendar, single current preparation per Staff/date. Saving never changes personnel profile, branch membership, availability, leave, booking or duty. Stale conflicts preserve entries; uncertain saves retain exact operation/payload and Staff context. History is append-only and date-bound cursor-paginated.
- Audit review: `src/pages/AuditTrail.jsx`, `src/audit-api.js`. Active server Owner guard, exact existing action filter, old-filter/session requests cannot append rows, reveal obsolete inspection or download stale exports. Manila rendering. Private notification contents are not added to audit metadata.
- API client: preserve explicit `data:null` instead of returning its enclosing object. Regression verifies null/revision-zero contract; existing authenticated/CSRF/failure tests pass.
- Leave: `LeaveController.php` moves existing audit writes inside request/decision/cancellation transactions. No fields, route bodies, role rules, notification wording or booking semantics changed. Failed audit rolls back state and all decision metadata before follow-on notices.
- Safety tooling/tests: explicit83/84/85 migration selections and fresh-clone roster contention lane, without changing original migration inventory, held selection, hash enforcement or existing manifests. No clinical files, branding assets, secrets, dependency locks or frozen shared contract changes.

## Actual commands and evidence

Container prefix: `docker exec dentalops-joevan-ops-20261115`. Backend commands run inside `/workspace` using the identity/hash-guarded runner. Private PostgreSQL18.7, PHP8.3.6. Runtime `/private/roster-batch4/target.json`, internal127.0.0.1:55491, databases dental_clinic_demo/test, selected/applied85. PostgreSQL has no host-published port. Synthetic data only; snapshots before/after migrations, all four holds excluded.

```text
python3 scripts/local-system.py --target /private/roster-batch4/target.json --profile test test tests/Feature/Staffing/StaffRosterDraftTest.php tests/Feature/Audit/OperationalArchiveActivityTest.php
# 7 tests / 150 assertions passed: current/history reads, stale/replay, foreign roles, invalid intervals/dates, rollback, immutability,50-row pagination during inserts, recipient privacy.
python3 scripts/local-system.py --target /private/contention-0609eb17/target.json --profile test roster-draft-contention
# 1 test / 250 assertions passed;4 scenarios,2 independent HTTP workers actually waiting on PostgreSQL locks per scenario.
python3 scripts/local-system.py --target /private/ops/target.json --profile test test tests/Feature/Staffing/StaffRosterDraftCapabilityTest.php
# retained84 schema:1 test / 7 assertions passed, explicit503 reads/save, profile unchanged.
python3 scripts/local-system.py --target /private/roster-batch4/target.json --profile test test tests/Feature/Staffing/LeaveAuditAtomicityTest.php tests/Feature/Staffing/LeaveTest.php
# 8 tests / 118 assertions passed, existing date/time/authorization/leave behavior retained.
python3 -m unittest scripts.tests.test_operations_profile scripts.tests.test_local_system
# 12 passed; pre-existing runner lock-file ResourceWarnings remain.
cd backend
php vendor/bin/phpunit tests/Unit/LocalMigrationProfileTest.php
# 11 tests / 16 assertions passed, database-free; guarded Feature runner correctly refuses its destructive-command literals.
node --test tests/api-client.test.js tests/staff-roster-draft.test.js tests/audit-api.test.js tests/m22-audit-trail.test.js tests/sched01-staff-roster.test.js
# 36 passed. Existing chooser assertion now requires both profile-save and dated-draft blocking.
node tests/operations-preparation.browser.mjs <Playwright index.mjs>
# synthetic: exact uncertain retry, preserved conflict, explicit reload/history, stale date ignored, keyboard,375/390/430/768/1024/1440 without overflow; late audit pagination cannot contaminate action filter.
node tests/roster-draft-postgres.browser.mjs <Playwright index.mjs>
# real React/API/PostgreSQL: committed-response loss, identical retry, context retained, saved history, new-session readback, unchanged Staff profiles, unpublished result.
npm run build
npm run test:smoke
git diff --check
```

Build/smoke pass with inherited large-chunk/Table-key warnings. Full Node/PHP/cross-module suites are intentionally deferred to Phase3 per current sprint instructions. The inherited full OWN-11 weekly-roster failure is not relabeled or weakened. Initial new checks exposed and corrected migration JSON-operator placeholder syntax, explicit-null normalization, test fixture branch/calendar assumptions and PostgreSQL hydrated attribute comparison; failed migration/clone evidence retained and fresh targets used. No remaining focused test failure.

`scripts/predefense-check.sh --local-only` ran through the verified new demo environment, execution-copy LF/ROOT adaptation only. It reports **5 FAIL / 3 WARN**: container127.0.0.1 cannot reach Windows Vite at the same address; worker/scheduler deliberately not running; base seed has only1 Patient and no unpaid invoice. Warnings: external providers not checked, unconfirmed branch email, no active assistant answers. These are fresh-runtime prerequisites, not regression evidence; no clinical invoice, contact or provider behavior was fabricated to pass the diagnostic.

## Policy and integration handoff

[Dated preparation API v1](contracts/STAFF_ROSTER_DRAFT_API_V1.md) documents actual three routes, exact Draft/unpublished response, Owner scope, integer revisions, exact actor-operation receipts,409/422/503 shapes and schema opt-in. This document is ready for Jaztin in source; no external message was sent. He must not consume drafts as duty; existing Doctor `/api/work-schedules` contract remains unchanged.

Unresolved questions: Which Staff weekdays/effective periods apply? What denotes explicit no duty? Which date exception wins across branches, closures and approved leave? Are multiple/overnight intervals allowed? Who decides shift requests and coverage, when is duty published, and what consent is needed for impacted bookings? These block effective recurrence/exception/publication only, not the preparation delivered here. Approved Dentist leave behavior already exists and was preserved; Staff effective leave precedence is not inferred from it.

GEN-11 still needs entity-specific agreement for universal Owner visibility/restore and permanent removal versus protected clinical/messages/feedback privacy and append-only retention. No hard delete/restore route is added. GEN-06 and DEN-03 reproduction remains unavailable. Highest-value next batch: approved Staff publication/projection contract, then leave request revision/retry/actor-revocation recovery and entity-scoped archive decisions; do not change clinical contracts unilaterally.

Shared files: `backend/routes/api.php`, `src/api-client.js`, `src/pages/Staffing.jsx`; audit screen/API helper and shared leave controller require careful later integration. Source changes remain domain-scoped. No branch integration initiated.

Publication is still blocked by [TEAM_DEVELOPMENT_SETUP.md](TEAM_DEVELOPMENT_SETUP.md), Publication gate: **“A missing dashboard confirmation remains an explicit publication blocker.”** Need Vercel feature-preview exclusion/isolation from existing Render proxy and connected Render/Railway feature-push exclusion from production deployment. No new authoritative dashboard evidence exists in the repository. No push, PR, merge or deployment performed; meaningful local commits preserve this batch.

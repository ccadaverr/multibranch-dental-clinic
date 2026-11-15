# Batch09 — operational filter recovery and current branch-access authority

Started clean at `74bd34fe59540c229e811598e87a4c7342896d5f` on `feature/joevan-qa-20261115`. All twelve earlier local commits and baseline ancestry preserved. Existing complete-history backup `../dentalops-local-backups/joevan-qa-20261115-223531.bundle` verified before edits. No integration, push, PR, hosting change or deployment.

## Original criteria and delivered functionality

| Original ID / exact source | Demonstrated gap and correction | Status |
| --- | --- | --- |
| GEN-02, `FINALS-QA-REVISIONS.md` revision: shared X clear control, tooltip/aria label, only when a filter is active; clicking resets filters | Audit Trail's clear button was always present and failed to reset Operational activity. Now it resets all seven filters, including activity, and disappears at defaults. Access & Roles likewise shows its existing shared clear icon only with an active search/role filter. Reset issues the authoritative unfiltered audit query rather than leaving an undisclosed action constraint. | Owned workflow portion locally verified, awaiting integration. No blanket all-dashboard closure. |
| GEN-13, same source revision: replace text Refresh with labelled icon; visible busy state | Live Owner personnel and Owner/authorized Staff leave review still used text refresh buttons. Reused existing `RefreshButton`: preserved accessible names, async busy/spin indication, keyboard activation and pending-read duplicate suppression. Existing leave command/draft protections remain. | Changed Owner workflows locally verified; shared Staff approval component updated. Global QA remains for combined role acceptance. |
| GEN-11, same source revision: normal users cannot permanently delete and each role sees only permitted archives; existing Owner-only branch-scope policy in `UserBranchScopeController` | Existing branch-access command checked authority only before a possible target-account lock wait. Now it locks/refetches current Owner first and enforces role, Active status and observed auth version; refetches locked target and rejects non-Staff targets; grants, audit and response readback stay in one transaction. Revocation cannot leave newly granted cross-branch archive/resource access. No archive access expansion. | Concrete existing authorization defect fixed and locally accepted; full GEN-11 still needs entity-specific archive policy. |

Files: `src/pages/Admin.jsx`, `src/pages/AuditTrail.jsx`, `src/pages/Staffing.jsx`; `backend/app/Http/Controllers/UserBranchScopeController.php`; focused extension of existing `OperationsContentionTest.php`/`operations_worker.php`; `tests/operations-controls.browser.mjs`. No new framework, dependencies, migrations or audit/receipt tables. A candidate refresh edit in the retired Automation Monitor was removed after confirming the actual route uses `Automations.jsx`; no dormant-monitor or live automation behavior changed.

## Contracts and permissions

Existing `PUT /api/users/{public_user_id}/branch-scopes` remains Owner-only. Body `{ "branch_refs": ["<existing branch legacy_ref>"] }` replaces a Staff account's authorization scope set; empty array removes all scopes. Duplicate/unknown references and immutable body identities retain existing422 validation. Operational Staff profile assignment is separate and untouched.

Response remains `{ "data": { "user": { "id": "<public_user_id>", "role": "staff" }, "branch_scopes": [{ "id": "<branch legacy_ref>", "name": "<branch name>" }] } }`. Ordinary401/403/404 behavior retained. Current authority lost during lock wait returns403 without grants or success audit; a target that ceased to be Staff returns422. Locks order current Owner then Staff account, consistent with personnel writer authority ordering. The readback is materialized while locks are held. No new revision/idempotency contract is claimed: distinct branch-scope replacement commands retain the established serialized replacement semantics and audit behavior; this batch does not invent replay receipts for this endpoint.

GEN-02/13 changes call the unchanged `/api/audit-logs`, `/api/users`, `/api/work-schedules` and `/api/leave` reads. No role expansion, route/shared App edits, Dentist-duty changes, financial changes, booking activation or clinical semantics. Integration must preserve the narrow changed sections in shared Admin/Staffing screens and the branch-access controller. Jaztin needs no client contract migration.

## Focused verification actually executed

Owned private PostgreSQL runtime identity and held-source hashes verified before tests. Changed PHP files explicitly copied into the existing source volume, without environments/secrets. The new race used a fresh `clone-test` from the guarded Operations profile, `/private/contention-43769712/target.json`; committed fixtures remain in that disposable clone. No data resets, migration execution or privilege escalation.

```text
docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/contention-43769712/target.json --profile test --filter test_branch_access_rechecks operations-contention
# 1 test / 148 assertions passed; three real contention scenarios, two independent blocked requests each.

docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/leave-batch5/target.json --profile test --filter 'test_(owner_assigns|duplicate_scopes|removing_a_scope|staff_cannot|scopes_apply|operational_assignment|guest_and_inactive|sequential_accepted|failed_scope_replacement|rejected_non_owner)' test tests/Feature/Identity/IdentityBridgeTest.php tests/Feature/Identity/Scope05StaffScopeAuditTest.php
# 10 tests / 78 assertions passed on final controller.

node --test tests/staffing.test.js tests/aud01-personnel-navigation.test.js tests/audit-api.test.js tests/m22-audit-trail.test.js tests/automations.test.js
# 28 passed, one known inherited OWN-11 failure. Original assertion preserved.

node tests/operations-controls.browser.mjs <installed Playwright index.mjs>
# Passed against actual React app + private Laravel/PostgreSQL.

npm run test:smoke
npm run build
git diff --check
# Passed. Existing Table-key/chunk-size warnings remain.

docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/leave-batch5/target.json --profile test verify-guard
# 1 test / 14 assertions passed. All three changed PHP files passed php -l.
```

The race proves both requests reached real PostgreSQL row-lock waits before revocation committed. Cases: Owner deactivation403; auth-version invalidation403; target Staff-to-Owner role change422. Each preserves the exact previous scope rows and audit count. A subsequent valid current Owner replacement persists the exact target/branch set, returns it and writes the correct actor/target audit. These are branch-access races, not a repeat of accepted leave/notification contention suites.

Live browser checks: Owner sign-in; personnel and leave icon-only refresh through Enter; title/aria labels; busy/spin and disabled states while actual server responses are held; repeated clicks produce one read; audit reset of activity/search/category/severity/branch/from/to and actual unfiltered API query; account search/role reset; clear absent at defaults. All changed Owner workflows checked at375/390/430/768/1024/1440; refresh targets at least44px and no page overflow. No clinical records or mutations were fabricated for acceptance. The Staff-shared refresh control is covered by the same implementation; this browser run does not claim a separate authorized front-desk session.

Initial broader IdentityBridge run:24 passes and one environment-specific error in the existing migration backfill test, which attempts to alter `users` through the restricted application role (table-owner privilege required). It is a schema-experiment prerequisite, not an authorization application failure; the restricted account and original test are preserved. Relevant final branch-scope tests were selected by name, without weakening or removing that test. First new contention attempt found no test because the source volume had not yet received the new test file; copying the reviewed files resolved it. Initial browser setup referenced the retired monitor; corrected to actual owned routes. Final changed checks pass; no unresolved introduced failure. Comprehensive suites/predefense remain deferred by Phase1 instructions; prior five synthetic predefense prerequisites remain unverified.

## Remaining scoped queue and decisions

- OWN-01, GEN-10 and STF-08/OWN-12 retain their previous implemented-awaiting-integration status, with no repeated implementation/counting. No revenue, notification, leave-command or roster infrastructure was rebuilt.
- OWN-02/03 A3 acceptance and historical OWN-04/05/06 closures preserved. STF-25's existing read-only View details control is present; broad archive/restore policy is not inferred from it. Clinical appointment/message/record/queue QAs remain Jaztin's ownership.
- OWN-10/11 still need approved Staff recurrence/effective boundaries, dated exception and approved-leave precedence, overlap/coverage/overnight rules, approval/publication actors and states, and when publication changes duty/booking. Drafts remain unpublished.
- GEN-11 needs entity-specific archive visibility/restore rules consistent with retained private-record restrictions and no hard deletes. Owner gets no other recipient's notification content. No permanent deletion or retention rule added.
- GEN-06/DEN-03 reproduction remains unavailable. No new criterion invented and no reconciled68-QA closure count claimed.

Publication remains blocked by absent authoritative Vercel preview/backend-isolation and connected Render/Railway deployment-exclusion evidence under `TEAM_DEVELOPMENT_SETUP.md`. Keep local accepted commits and a refreshed verified bundle. Back up the owned demo/test/clone and stop owned runtime processes after checks, retaining volumes and evidence. All four held migrations/diagnostic tests remain intact; `Served` remains treatment start.

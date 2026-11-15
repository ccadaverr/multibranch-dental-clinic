# Batch11 — Staff approval/publication and scoped operational history

Started November15 and finished after midnight November16,2026, Asia/Manila. Branch `feature/joevan-qa-20261115`, starting clean HEAD `72d464650882a4b291a206670d9cf35d17b992c9`,14 local commits after shared baseline `a0725e645df6f8266c2bc4bebacc9d62dd18e7c1`. Existing complete-history bundle `joevan-qa-20261115-230634.bundle` verified first. No reset/recreation, integration, remote push, PR, merge or deployment.

## Delivered full-stack workflow

Approved project-owner R1–R10 decisions extend the **same** Staff preparation aggregate, profiles and immutable revision history:

- Staff/date/branch weekly recurrence with explicit inclusive effective boundaries and ISO weekdays; same-day valid intervals, no fabricated fallback hours.
- Date-specific custom hours/day off, both as dated records and inline exceptions; approved/published exceptions override recurrence, then current Approved leave subtracts the affected interval. Pending/Declined/Cancelled leave does not override. No private leave reason enters duty, notices or audit.
- Owner saves Draft; exact linked authorized Staff submits Pending. Pending requests appear in branch/date review and notify active Owners. Only a current Owner can approve; approval does not publish. A second explicit Owner action publishes the exact approved revision.
- Current Staff row is the cross-branch publication gate. Effective interval conflicts are rejected transactionally, including concurrent Owners; adjacent/nonoverlapping assignments are supported. No staffing minimum, automatic cover, overnight policy or clinical duty is invented.
- Immutable publication identity/source revision/approved revision/actor/time/snapshot and a transactional current-version switch. New Draft/Pending edits retain the last valid publication until another approved version is explicitly published.
- Exact actor/operation/action/body replay, structured stale conflict, transactional audit/notification intents, no duplicate effects. Full100-exception replay uses a compact audit reference to the existing immutable snapshot, preserving the audit logger's8KB limit. Earlier small inline receipts remain replayable.
- Owner/Staff screens retain the existing Work schedules role tabs and personnel selection. Added recurrence/effective dates, supported date exceptions, current state, explicit confirmation dialogs, branch/date review, effective duty, paginated immutable history, lost-response retry, stale review and separate authoritative current readback. New unsaved form edits cannot be approved or published.
- Staff duty is an independent backend resolver/API. Existing Doctor duty and clinical booking/queue/encounter/Patient/financial authority remain unchanged. Roster publication grants no account branch scope.

Trigger → strict validation → current actor/Staff/branch authorization → Pending Owner routing or explicit permitted Owner transition → atomic revision/publication/audit/recipient notice → exact receipt → current readback. Conflicts retain entries and require explicit review; unknown responses retain one frozen original command. No automatic rebase or clinical activation.

## Original QA disposition

Exact source: revision elements in `FINALS-QA-REVISIONS.md`; OWN-10 Q1 defaults, followed by the project owner's explicit Batch11 policies. No master checkbox/68-item closure count was inflated.

| ID | Exact original criterion | Evidence / status |
| --- | --- | --- |
| OWN-10 | “Work schedule matches the agreed staff changes.” Q1: reuse corresponding Staff schedule/leave logic and manage both roles. | Shared role interface, Staff request→Owner approval→separate publication→dated duty; existing Doctor schedule/leave behavior retained. PostgreSQL and actual Owner/Staff browser acceptance. **Locally acceptance-ready, awaiting integration** for the approved working policy. |
| OWN-11 | “Work schedule can be set for dentists and staff.” Tasks: Staff option alongside Dentist, schedules for both, duty support; permission/overlap hardening. | Previously blocked authoritative Staff recurrence, exceptions and duty now implemented. All requested lifecycle/boundary/replay/authority/overlap checks have focused evidence; Doctor projection unchanged. **Locally acceptance-ready, awaiting integration.** |
| GEN-11 | “No record is permanently deleted by normal users; each role sees only permitted archives; Dr Dana sees all.” Tasks additionally request restore/permanent removal and archive actor/time/role. | Recipient-only archives preserved; Owner operational metadata only; same-filter audit cursor and correct Manila day boundaries; current-scope Staff history before pagination; foreign recipient/role denials and no restore/delete routes. **Partially implemented**: universal entity archive access, clinical lifecycle and restore/permanent removal are excluded by A1/A3/A4 and retained privacy safeguards. |
| STF-08 | “Partial-day leave saves correct dates and times.” | Prior shared leave/date/revision/recovery implementation retained, no repeat fixes. New resolver correctly consumes approved leave windows. **Locally acceptance-ready, awaiting integration**, retaining Batches05–07 evidence. |
| OWN-12 | “Owner leave requests match staff behavior.” | Existing shared authorized Owner leave review retained. No invented Owner self-request entitlement or altered leave lifecycle. **Locally acceptance-ready, awaiting integration** under existing authorized behavior. |

OWN-01, GEN-10, GEN-02 and GEN-13 accepted candidates were preserved. OWN-02/03 and historical OWN-04/05/06 were not rebuilt. Clinical calendar/arrival/queue/encounter/prescription/Patient criteria remain Jaztin's; GEN-06/DEN-03 reproduction is still missing. No new speculative feature was substituted for an original requirement.

## Actual contracts and source changes

Full request/response examples, transitions, errors, locks, schema and exclusions: [Staff roster/duty v2](contracts/STAFF_ROSTER_DUTY_API_V2.md). Archive resource/role/scope matrix and actual routes: [Operational archive scope v1](contracts/OPERATIONAL_ARCHIVE_SCOPE_V1.md).

New roster routes: GET `/api/staff-rosters`; GET/PUT `/api/staff/{staff_ref}/roster`; GET `/roster/history`; POST `/roster/approve`; POST `/roster/publish`; GET `/api/staff/{staff_ref}/duty`. All Staff/date/branch references remain exact established identities. Existing audit and notification routes remain unchanged.

Primary backend files: `StaffRosterController.php`, `Services/Scheduling/StaffDuty.php`, `StaffRosterDraftController.php`, `WorkScheduleController.php`, `Models/StaffRosterDraft.php`; additive `database/operations/2026_11_21_000100_publish_staff_rosters.php`; domain routes, guarded private provisioning/worker extensions. `AuditController.php` corrects only cursor/date predicates.

Primary React files: `Staffing.jsx`, `StaffRosterWorkflow.jsx`, `StaffRosterDraftCollection.jsx`, `staff-roster-workflow.js`, narrow `api-client.js` additions and audit activity options in `AuditTrail.jsx`. No App/layout/Dashboards, Patient, clinical, brand asset, CSS redesign, dependency or payment changes.

Frozen migration inventory and all four holds remain intact. Final newly provisioned private profile `/private/roster11b/target.json`, internal loopback55494, verified owned identities, `dental_clinic_demo`/`dental_clinic_test`,87 selected/applied migrations. Old manifests were not repinned. The initially incomplete experimental profile and earlier clones are retained; source changed only the new uncommitted migration during development, so final acceptance used a newly provisioned profile rather than bypassing hashes. No real-clinic or production writes. Pending real-clinic schema work is recorded in `POST_DEFENSE_TASKS.md` without authorization to execute it.

## Focused verification actually executed

```text
docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/roster11b/target.json --profile test test tests/Feature/Staffing/StaffRosterPublicationTest.php tests/Feature/Staffing/StaffRosterDraftTest.php tests/Feature/Audit/OperationalArchiveScopeTest.php tests/Feature/Audit/AuditQueryTest.php tests/Feature/Audit/OperationalArchiveActivityTest.php tests/Feature/Notifications/NotificationArchiveTest.php
# Final:32 tests /516 assertions passed.

docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/contention-22670df2/target.json --profile test roster-publication-contention
# Final fresh clone:1 test /310 assertions passed; five real contention scenarios.

docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/roster11b/target.json --profile test verify-guard
# 1 test /14 assertions passed; destructive/default migration paths refused.

docker exec dentalops-joevan-ops-20261115 python3 -m unittest scripts/tests/test_operations_profile.py
# 4 passed.

node --test tests/staffing.test.js tests/staff-roster-workflow.test.js tests/staff-roster-draft.test.js tests/audit-api.test.js
# 24 passed,0 failures/skips.

node tests/staff-roster-publication.browser.mjs <installed Playwright index.mjs>
# Actual React/Laravel/PostgreSQL Owner/Staff flow passed.

npm run test:smoke
npm run build
git diff --check
# Passed. Changed PHP controller/service/migration syntax checks passed.
```

The five real races prove both commands reached PostgreSQL row-lock waits: incompatible two-Owner publications (one200/one422); same-command replay (two200,one publication); Staff edit versus Owner publication (one200/one409, no account/profile deadlock); revoked Owner (two403); target role changed while blocked (two403). Fresh clones only; no committed-fixture reuse. Assertion counts vary with lock-poll loops and are not additional QA closures.

PostgreSQL covers effective boundaries, missing schedules, Draft/Approved no-duty, explicit publication, inline and independent exceptions, approved/pending/cancelled leave, requested intervals, foreign identities/scopes, adjacent/cross-branch conflicts, later-version preservation, exact replay after later changes, maximum100-exception replay, illegal transitions, audit rollback, immutable publication guards, scoped collection/history pagination and retained original Draft behavior. Doctor duty DTO is compared before/after publication. Existing private notification archive/audit tests pass under the approved restrictions.

Browser covers exact linked Staff request, branch/date Owner review, approval without publication, lost committed publication response and byte-identical command retry, new Staff sign-in readback, dated exceptions and outside-period no-duty, immutable history, stale approval with explicit review/no automatic resend, old duty retained during new Draft edits, discoverable publication audit, ignored obsolete date responses, keyboard submit/review and widths375/390/430/768/1024/1440 without page overflow/errors. No claim of a comprehensive WCAG audit or integrated clinical acceptance.

Resolved development failures: missing required synthetic profile hours; notification kind initially absent (new migration now adds it); JSON object key-order comparison corrected without weakening value/identity checks; browser login used the actual reception account and current CSRF token; exact accessible labels and delayed-route test synchronization corrected. The midnight failure was a reproduced existing audit offset defect, fixed with explicit instants. The retained audit column rounds fractional seconds, so the new boundary fixture uses its actual whole-second precision; no storage/history rewrite. No unresolved introduced failure. Existing Table-key/chunk warnings remain.

The inherited OWN-11 source assertion referenced retired component text/internal calls. It was updated after the actual full workflow passed, retaining both role selectors and shift assertions and adding required recurrence/effective/approval/publication/request/duty controls and published-state validation. The browser and PostgreSQL tests establish behavior beyond those source assertions; no meaningful test was disabled to hide missing Staff scheduling.

Full Node/PHP/browser suites, hosted checks, predefense and unified integration remain deliberately unexecuted under the Phase1 selective-testing instruction. Prior environment prerequisites are not application passes.

## Local commits, integration and next

Roster commit `a8768bf772c690a00211260dde9b71314557293b`; exact large-receipt recovery follow-up `3d18e1146772101705af77a9f571b7b404a8ee13`; final operational-history commit includes this report. A complete-history bundle was verified after the roster commit and refreshed at final completion. Final commit/backup identities are reported with `git log` and bundle verification, not inferred from this self-containing file.

Conflict-sensitive shared edits: seven domain routes; Staff section/metadata in `WorkScheduleController.php`; Staff tab and API-client additions; Owner audit options; no booking resolver change. Jaztin has no immediate clinical consumer migration. Later integration must retain current Doctor duty/booking semantics, optional schema capability, publication/revision identities, current authorization and the existing leave contract.

Publication gate remains missing authoritative Vercel preview/backend isolation and connected Render/Railway deployment exclusions. No push/PR/merge/deployment. Back up demo/test and owned committed clones, stop only started owned clusters/runtime, preserve volumes and evidence.

DONE: approved Staff request→approval→publication→effective-duty workflow; supported operational archive/filter authorization; focused acceptance and local commits.
IN PROGRESS: shared integration and original68-item acceptance across both developers.
BLOCKED: universal GEN-11 entity lifecycle/restore/permanent deletion under A3/A4; missing reproduction for GEN-06/DEN-03; remote publication isolation evidence.
NEXT: integrate the completed roster contract when the project schedules it; finish independently demonstrated original Operations gaps if identified; retain existing acceptance candidates and defer clinical activation, broad testing and redesign.

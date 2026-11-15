# Joevan Operations/Workforce implementation — 2026-11-15

Baseline: `a0725e645df6f8266c2bc4bebacc9d62dd18e7c1`, clean assigned `feature/joevan-qa-20261115`; explicit collaboration fetch succeeded and ancestry matched. No later work existed to preserve. User's full-stack domain assignment supersedes the older layer split in TEAM_QA_WORKFLOW. No clinical, Patient, financial, provider, hosting or migration changes were made.

Status: **implementation awaiting PostgreSQL/integration acceptance**, no new original QA closures. The private owned Linux/WSL runtime required by the team setup was unavailable: `wsl --list --quiet` exposed only Docker Desktop, no target manifest was supplied/found at the documented runtime location, and native Windows cannot execute the POSIX ownership/fcntl runner. No database was accessed and no guards were bypassed. Neither persistence nor real concurrent acceptance is claimed.

## Implemented source batches

1. Existing Staff shift profile: opaque observed revision, paired operation UUID, stale/contradictory retry 409 responses, transactionally durable original receipt in the existing append-only audit table, actor revalidation after locking, complete resulting-interval validation for partial PATCHes, and stored-hour reads without invented defaults. Owner Work schedules retains its exact command during uncertain errors, freezes edits until recovery, confirms the exact operation/Staff/branch/hours/revision before success, preserves conflict drafts, and restores focus. Shift-only edits omit assignment instructions. Legacy personnel clients remain compatible and unguarded; universal concurrency enforcement is **not** claimed.
2. Notification history: recipient-bound public cursor pages, 50 records per page with has-more metadata, stable older traversal during newer inserts, exact confirmation for reads outside the newest page, shell Load older notifications, and retained history/retry after page failure. No deletion/archive/restore is invented. Patient portal continues its existing recent-window behavior.

Contracts: [roster/profile](contracts/ROSTER_DUTY_API_V1.md), [notification history](contracts/NOTIFICATION_HISTORY_API_V1.md). These are prepared for Jaztin in source; they have not been published or delivered through an external communication service. No existing Doctor-duty route/body/status semantics changed.

Staff files: `backend/app/Http/Controllers/Reference/StaffProfileController.php`, `WorkScheduleController.php`, `Requests/Reference/UpdateStaffProfileRequest.php`, `Resources/Reference/StaffProfileResource.php`, `Services/Scheduling/StaffShiftRevision.php`; `src/pages/Staffing.jsx`, `src/staff-shift-command.js`; Staff recovery/validation/revision tests and existing shift fixtures/tests.

Notification files: `backend/app/Http/Controllers/NotificationController.php`, `backend/tests/Feature/Notifications/NotificationHistoryTest.php`, `src/api-client.js`, `src/layout.jsx`, `tests/notif01-server-feed.test.js`, `tests/fixtures/notification-history.html`. **Shared integration files:** api-client.js and layout.jsx; preserve Jaztin's changes when integrating. No api.php, App.jsx, frozen shared contract or migration was edited.

## Scoped original QA mapping

Each exact criterion below comes from the matching `<revision id="…">` in root `FINALS-QA-REVISIONS.md`. Historical checkboxes are not treated as current acceptance. The 68-row master matrix is untouched.

| ID | Exact original acceptance | Current batch / evidence / remaining work |
|---|---|---|
| OWN-11 | Work schedule can be set for dentists and staff. | **Partial.** Flat shift comparison/recovery implementation and synthetic acceptance added. Weekday/effective-period, exception precedence, overlap, duty and publication policy remain unresolved. Existing full-roster regression retained. No full closure. |
| OWN-10 | Work schedule matches the agreed staff changes. | **Partial/dependent.** Existing shared schedule entry retained. New Staff editor source; real PostgreSQL/browser acceptance pending. |
| STF-07 | Operations shows correct on-duty status per doctor per branch. | Existing Doctor-duty contract retained, no closure added. Staff flat profiles are not this Doctor-duty criterion. Jaztin's clinical scheduling work remains separate. |
| STF-08 | Partial-day leave saves correct dates and times. | No production change. Existing focused Node scheduling tests passed; persisted leave acceptance still separate. No new closure. |
| OWN-12 | Owner leave requests match staff behavior. | No production change or new acceptance. Leave/coverage policy and persisted decision lifecycle remain separate. |
| GEN-10 | Notifications grouped under date headers; each can be removed (archived); button looks consistent and outline-free. | **Partial.** Existing grouping retained; functional older history/read/retry added and synthetically exercised. Archival backend/schema/policy absent; PostgreSQL tests authored but not run. No closure. |
| GEN-11 | No record is permanently deleted by normal users; each role sees only permitted archives; Dr Dana sees all. | **Policy blocker.** No deletes added. Universal Owner access conflicts with protected clinical/messages/feedback boundaries; entity-specific permissions and approved archive/restore semantics required. |
| OWN-01 | Both charts hoverable; values match billing data to the peso; histogram appears on Saturdays. | Untouched; retain existing evidence. Financial definitions and clinical billing belong to integration/Jaztin; no current peso-match acceptance claimed. |
| OWN-02 | Branch code is chosen from a dropdown; duplicates are blocked. | Untouched accepted source controls; no new persisted branch acceptance. |
| OWN-03 | Branch location is set by pinning on the map; no manual lat/long entry. | Untouched accepted source controls; no new browser acceptance. |
| OWN-04 | Branches screen is colorful, readable, and consistent. | Historical closure retained; smoke/build regression only, no reopening or duplicate closure. |
| OWN-05 | Closed is a button with a clear active state. | Historical closure retained; no production change. |
| OWN-06 | Services display in a 2x2 grid on desktop. | Historical closure retained; no production change. |
| OWN-07 | Owner calendar matches the staff calendar. | Cross-domain calendar work belongs to Jaztin under the current sprint; untouched. |
| OWN-08 | Past days are greyed out on Staff, Dentist, and Owner calendars. | Cross-domain calendar work belongs to Jaztin; untouched. |
| OWN-09 | Appointment details are clear and easy to scan. | Appointment workflow belongs to Jaztin; untouched. |
| OWN-13 | Owner live queue by branch matches staff queue behavior. | Queue workflow belongs to Jaztin; untouched. |
| GEN-09 | Key flows (check-in, appointments, patient record, prescriptions) require measurably fewer clicks. | These named journeys belong to Jaztin. No timing/click-saving claim from shift/history changes. |

STF-25/DEN-16 clinical record deletion/archive screens remain outside this implementation; GEN-11 does not authorize editing their contracts. GEN-06/DEN-03 have no supplied original reproduction and receive no guessed criteria or closure.

## Verification actually executed

- `composer install --no-interaction --prefer-dist --no-scripts --no-plugins` and `npm ci --ignore-scripts`: locked installation succeeded; lockfiles unchanged. `composer check-platform-reqs`: passed (native PHP8.3.33; this does not establish runner compatibility).
- `node --test tests/batch04-scheduling.test.js tests/sched01-staff-roster.test.js tests/staff-shift-command.test.js`: **43/43 passed**. Includes same-operation uncertain retry, stale refusal, exact receipt checks, invalid intervals, context changes and duplicate dispatch.
- `node --test tests/notif01-server-feed.test.js tests/notification-date-groups.test.js tests/staff-shift-command.test.js`: **14/14 passed**. Includes cursor/last-row consistency and preserved existing date/identity behavior.
- `php vendor/bin/phpunit --bootstrap vendor/autoload.php tests/Unit` in backend: **248/248 passed, 1,175 assertions**. Actual request-rule tests require revision/operation together; missing pair/invalid values fail without any database access.
- Final `npm test`: **1,823 passed, one inherited full OWN-11 failure, eight skipped (1,832 total)**. The inherited expectation requires the full Staff weekly roster; it was not relabeled or weakened to hide the missing functionality. Source-behavior fixtures were extended for the new revision/operation dependencies.
- `npm run test:smoke`: passed; Table key warnings emitted. `npm run build`: passed; bundle-size warning emitted. Logo hashes and original branding assets unchanged.
- `git diff --check` and PHP syntax checks on changed controllers/new Feature tests: passed. No migration/lockfile diff; four migration holds untouched. Explicit staged secret scan required before each commit.
- Synthetic browser shift fixture: simulated response lost **after fixture state/receipt update**, retained draft, disabled edit controls, exact same command retry, confirmed success and restored focus. This is UI evidence only, not PostgreSQL acceptance.
- Synthetic notification fixture: failure preserved50 rows; retry loaded100 then120; read of oldest row confirmed and unread count became119. Six widths375/390/430/768/1024/1440 had no page overflow for both changed workflows. Browser console reported a fixture favicon404; no application exception. One initial browser script used an ambiguous locator; corrected exact-row selection passed. No real-user data involved.

## Deferred mandatory gates and blockers

No backend Feature suite, real PostgreSQL contention/persistence/new-session readback, or `scripts/predefense-check.sh` was executed: there is no verified private target. Running the ambient legacy .env/scratch path would violate the requested database boundary. Full backend acceptance must use the guarded test lane, never broad migrate/reset or held migrations.

After a verified Linux target is supplied, run sequentially through `scripts/local-system.py --profile test test`:

```text
tests/Feature/Identity/StaffShiftRecoveryTest.php
tests/Feature/Identity/StaffP0BranchScopePreservationTest.php
tests/Feature/Identity/Scope04StaffScopeAtomicityTest.php
tests/Feature/Identity/Scope05StaffScopeAuditTest.php
tests/Feature/Staffing/Scope03WorkScheduleProjectionTest.php
tests/Feature/Notifications/NotificationHistoryTest.php
tests/Feature/Notifications/NotificationIntegrationTest.php
```

Also add/run real committed separate-connection races on a disposable clone (stale simultaneous writes, repeated operation and actor revocation while waiting), actual new-session GET readback and browser-to-Laravel journeys. The authored sequential tests do not prove lock contention. Run local-only predefense through the verified demo profile and integration's consolidated gates.

Required dated-roster decisions: Editor authority; recurrence/effective periods; no-duty days; date exception precedence across branches/closures/approved leave; overlap/multiple interval rules; durable revision/history/publication semantics. A proposed conservative rule set was requested but not approved during this run, so no schema or policy was invented. Staff shift requests remain distinct from approved duty and are not added to the flat profile PATCH.

Publication is **blocked** until hosting dashboard exclusion is confirmed, per `TEAM_DEVELOPMENT_SETUP.md` Publication gate: “A missing dashboard confirmation remains an explicit publication blocker.” The user's branch push is authorized, but a feature push must not be used to probe production deployment behavior. No push, PR, merge, force-push or hosting changes were performed.

Next highest value: establish the owned runtime, accept these two source batches against PostgreSQL, settle the dated Staff policy and reviewed additive schema, then complete OWN-11 and entity-specific GEN-10 archival. Integration readiness is conditional; there are no new closure counts.

# YZH-QA-02 — cross-role frontend acceptance

2026-11-02, Asia/Manila. Developer B / Yzhekiel. Local review candidate only.

**Disposition:** frontend corrections and synthetic acceptance completed within the coverage below. **Authenticated cross-role end-to-end acceptance: BLOCKED — approved authenticated synthetic session unavailable.** The user explicitly confirmed this limitation and authorized continuation with intercepted tests. This batch does not satisfy an authenticated integration or production sign-off gate.

## A. Git baseline

- Workspace: `C:/Users/Yzhe Yu/Documents/dental-clinic-b-qa-20261102`.
- Branch: `qa/yzhekiel-ui-20261102`.
- HEAD: `a6a0de5bf36c77a43d948b98f821940bac41df3d`, matching assignment.
- Full initial inventory: **zero modified tracked files, zero untracked files, zero staged files**. Initial status, diff stat, whitespace check and cached diff were empty. Last 30 commits inspected.
- HANDOFF, member tracker, master reference, DEV-01/R1, DEN-UI-01/02 and Developer A integration contract reviewed against active routes and source. Older frontend-only/module/status assertions are historical; current code has Laravel/Sanctum APIs.
- No backend environment file, credentials, database, production account, migration, seeder or backend test was accessed/run. No other worktree was operated on.

## B. QA traceability

Existing Done statuses are preserved; the following evidence does not replace their original acceptance or independent review requirements.

| QA ID | Disposition in this batch | Evidence and limit |
| --- | --- | --- |
| GEN-06 | **Blocked/unverified original report** | Shared native controls exercised with Patient/Staff/Dentist/Owner labels at four widths, plus actual booking and clinical selectors. No common opening/selection/clipping defect established. Full active Staff/Owner screens, native mobile OS popups and original reproduction remain unverified. |
| GEN-07 | Existing Done retained | Shared Other input reveals, accepts text, clears on standard selection, and returns blank. Prescription custom values retain existing tests. No new server validation claim. |
| GEN-12 | Existing Done retained | Booking, encounter and schedule rendered controls; visible focus and wrapping inspected. No blanket sizing redesign. |
| STF-03 / DEN-04 | Existing Done retained | Actual shared chart: keyboard selection, stable SVG coordinates, front/top switching, patient reset; four widths. No geometry/numbering change. Tiny phone tooth targets remain a usability limitation. |
| STF-04 / DEN-10 | Existing Done retained | Shared ID Other behavior checked synthetically. Authenticated patient-record writes not attempted. |
| STF-05 | Existing Done retained; populated-server acceptance not repeated | Chart summary source/unit coverage retained. Fixture chart has no findings; cannot certify populated summary aggregation from these screenshots. |
| DEN-01 / DEN-02 | Existing Done retained | Home/Schedule harness passed six widths; actual date navigation and detail focus checked. |
| DEN-06 / DEN-07 / DEN-08 | Existing Done retained; additional defect corrected | Medicine/dosage separation and danger remove source preserved. Out-of-order prescription draft race reproduced and corrected. Save/issue separation tested with intercepted commands. |
| DEN-09 | Existing Done retained | Actual Open/Contacted/Booked/Closed mapping and encounter recommendation copy preserved. Empty task navigation tested; no fabricated Treatment relation. |
| DEN-12 / DEN-15 | Existing Done retained, no new full rendered sign-off | Existing suite/source evidence; work-hours and wording-approval pages were not independently exercised in a signed-in session. |
| DEN-03 | **Unverified historical defect; not Done** | Schedule fixture passes date/month/year movement, status/search, scope, walk-ins, read errors/retry. Does not establish what “FIX DAH SHI (BUG)” originally meant. |
| STF-06 / DEN-11 / DEN-13 | Dependency/support status unchanged | Handover automation and leave policy/backend ownership remain with Jaztin; no implementation takeover. |
| GEN-09 | Richmon ownership unchanged | Action observations below are supporting evidence, not a productivity or completion claim. |

## C. GEN-06 findings

There is no single universal dropdown implementation to replace. `SelectWithOther` and `FilterBar` render native selects. Booking uses a native person select, button-based branch/service choices, details disclosures and calendar/time buttons. Prescription fields are native selects. Staff walk-in patient search is an ARIA combobox/listbox; chart patient search is an input with selectable result buttons. Shell menus/drawers and native dialog overlays have separate behavior.

`tests/yzh-qa-02.browser.mjs` tests native selection, Other clearing/value synchronization, ArrowUp/ArrowDown/Enter, Tab/Shift+Tab, Escape, dialog return focus, long branch options and nested dialog scrolling at 390/768/1024/1440. The four role names in this fixture identify a **shared-component matrix**, not authenticated role dashboards. The additional `yzh-qa-02-staff.browser.mjs` renders the actual CheckInPage with synthetic store/callbacks and tests the walk-in combobox's arrows, Enter selection, clear, Escape, no results, Tab/Shift+Tab and responsive overflow at all four widths. No admission hits an API. Native Chrome may temporarily focus the document/browser boundary when tabbing past the last dialog control; the test verifies the next Tab returns inside and never reaches an actionable background control. This is not a claim of a custom JS focus trap.

No blanket z-index changes or native-select replacements were made. Async booking option errors/retry are tested. Exhaustive native popup opening/cancellation, touch on iOS/Android, disabled/empty control combinations, assistive technology and every custom selector are not established by this matrix. GEN-06 stays blocked pending an exact original case or an approved authenticated session with a reproducible failure.

### Reproduced booking-calendar context failure

1. Render `BookingCalendar` for branch b1; let November 2099 load.
2. Change branch to b2 without changing the month.
3. b2 fixture returns a closure on November 2.
4. Baseline retains b1 availability: its guard considers only month/readiness, so it skips the new request.

`QA_BASELINE_CALENDAR=1 node tests/yzh-qa-02-calendar.browser.mjs` serves the original HEAD calendar module through an intercepted module response. It fails waiting for the b2 closure. Current source passes with reads `["b1","b2"]`. This is a separate reproducible booking defect, **not proof of the historical GEN-06 or DEN-03 defect**.

Correction: cache identity includes branch, service, Dentist, appointment, dependent, month and retry generation; changed context clears rendered calendar data and closure notes; canceled reads cannot replace the new context. The initial server-selected month is reused without a duplicate read.

## D. Clinical workflow

The extended DEN-UI-02 browser harness passes at all four required widths: 197 intercepted requests, 26 synthetic mutations, zero page errors. No command reaches Laravel.

- Queue: own assigned Dentist/branch projections, Waiting review with Start disabled, Call, eligible Start and exact encounter links. Active encounter filtering, revoked branch and missing-record boundaries also have existing unit coverage. No new Staff-only controls were added.
- Identity: mismatched patient/Visit/queue links refuse the workspace. Switching encounter explicitly discards and starts with blank notes. Delayed chart responses cannot replace the next patient's heading or tooth selection in tested cases.
- Unsaved work: Stay preserves notes for Queue, Records, Chart, Prescriptions and Follow-ups destinations; explicit discard switches patient. Source verifies App sidebar/logout/hash routing through the guard and native beforeunload registration. Actual browser refresh prompt and authenticated logout were not executed; the browser may suppress beforeunload.
- Revisions: newer server revision keeps typed notes and disables Save; explicit cancel retains them; explicit reload discards and adopts the latest. Failed Save/Complete retain the editor. Rapid duplicate Start/Save/Complete tests pass. Completed editor is disabled. Existing command-gate units cover stable retry intent and conflict/transport handling.
- Privacy: synthetic legacy note sentinel is neither displayed nor removed through patient/session switches. There is no local clinical Save action. No real legacy keys were read. Medical-alert API and custodian-authorized legacy recovery remain separate requirements; no generic patient migration was attempted.
- Chart: patient-linked navigation, Return to encounter, FDI selection, Enter, front/top views, fixed tooth transform and reset after patient switch pass. Added chart screenshots use `automations.css`, as production main does; the original fixture omitted this stylesheet. No production anatomy, tooth number or asset was changed. Phone tooth labels/targets remain small; touch usability and approved anatomical reference still need clinical review.
- Follow-ups: recommendation remains distinct from Booked; actual server status vocabulary retained. The current API projection still lacks a reliable originating Treatment/Visit link, so exact task attribution is not asserted.

### Reproduced prescription race and correction

1. In Prescriptions, choose Edit draft for synthetic patient 1 and hold its GET response.
2. Choose Edit draft for patient 2; return its response first.
3. Release patient 1's response.
4. Baseline replaces patient 2's heading and medicine with patient 1's draft. The new browser assertion failed `1 !== 0` before the source fix.

`WriteCard` now remounts per selected draft, cancels stale read effects, hides editing controls until the selected draft is loaded, and accepts only the requested editable Draft. Refused/locked drafts have a visible error and Cancel. The focused browser replay passes; it additionally verifies Save sends patient 2's medicine to prescription 2, stays Draft, issues only after a distinct confirmation, and refuses a stale Edit control once the response is Issued. Three intercepted mutations; no real prescription, notice or email. Existing medicine/dosage catalogs were not redesigned.

## E. Patient Portal integration

Source inspected: AppointmentController bookingPatient/bookingOptions/store, AvailabilityRequest, AppointmentService explicit `pay_at_clinic` handling, API client and active `patient/pages/Book.jsx` (not legacy PatientBook).

| Finding | Correction / verified frontend behavior |
| --- | --- |
| Creation sends dependent, searches use guardian | Pass `for_patient_id` consistently to branch-options, calendar, availability and booking-options. Selecting another person clears branch/date/slot and returns to branch selection. Missing dependent is refused at confirmation. |
| Integrated quote/capability never used | Call existing GET `/api/appointments/booking-options` on Review for exact branch/service/date/dependent. Clear prior snapshot, ignore canceled response, display server PHP quote, provide error/retry and disable submission until a matching choice is available. |
| Online permanently unavailable despite server support | Enable only for matching snapshot, finite server fee, PHP currency, boolean capability and nonempty methods. Send **explicit `pay_at_clinic:false`** for online; cash sends true. Omitted legacy clients keep their existing behavior. No provider request is added. |
| Dependent waitlist could silently refer to guardian | Waitlist endpoint is self-patient oriented. Hide the self-only full-day waitlist action for a dependent and explain front-desk contact; do not invent a dependent waitlist API. |

Rendered tests: self and dependent choices, exact dependent query/body identity, capability unavailable/error/retry, authoritative quote, explicit cash, explicit online, rapid duplicate submit, pending front-desk confirmation, held-payment wording, stale-slot conflict and recovery to person selection. Six intercepted booking attempts; zero page errors at four widths. Unit tests additionally reject mismatched/malformed quotes, preserve explicit online payload/key and retain existing pending/confirmed/paid feedback cases. Consultation-first service resolution, active/hidden services and same-key retry behavior remain covered by existing tests.

No fee or refund policy is invented; the fixture PHP 500 is synthetic. Quote is not a reservation or locked price. Automatic Dentist assignment remains server-owned. Pay-at-clinic is current server behavior, not a new clinic policy endorsement. A 403 quote refusal prevents submission; actual revocation enforcement, final slot/price revalidation, provider capability changes between read/create, checkout redirects, webhook settlement, cancellation/refund lifecycle and real dependent authorization require authenticated acceptance. No real payment/cancellation/booking was performed.

## F. UX measurements

An action here means an intentional click/select/check, excluding text keystrokes, automatic reads and waits. These are fixture observations, not clinic efficiency measurements. No claim of time saved.

| Workflow/start point | Before | After | Observation |
| --- | --- | --- | --- |
| Booking, consultation prefilled, self; choose branch/date/time/payment/submit | 5 | 5 | Same visible flow; quote loads automatically. Dependent selection adds one action. Online path was unavailable before, so no valid before comparison. |
| Staff appointment check-in from Scheduled arrivals | 3 | 3 | Actual unchanged CheckInPage: select appointment, check Valid ID presented, Confirm arrival. Synthetic callback records exact selected appointment once. Authenticated command acceptance unverified. |
| Dentist Waiting queue to started Treatment | 3 | 3 | Call patient, Open encounter, Start Treatment. No clinical confirmation removed. |
| Correct patient's chart from encounter | 1 | 1 | Open dental chart preserves context; no patient reselection. |
| Existing draft review/save, then reopen and issue | 6 | 6 | Edit, Save draft, close detail, Edit, Issue, confirm Issue. Entering a new prescription from blank was not measured. The test observes three synthetic commands. |
| Review follow-ups from completed encounter | 1 | 1 | Open patient follow-ups; empty fixture tasks. Populated task handling unmeasured. |

The corrections improve context reliability without adding clicks. Richmon retains GEN-09 ownership. Full new-prescription action counts and authenticated Staff check-in remain in the checklist below.

## G. Regression evidence

| Exact command | Result |
| --- | --- |
| `npm.cmd ci --ignore-scripts` | Locked dependencies installed after sandbox cache denial. No manifest/lockfile change. |
| `npm.cmd test` on untouched HEAD after dependencies/elevation | **1025 passed, 0 failed, 5 skipped; 1030 total**. |
| `node --test tests/yzh-qa-02.test.js` | **3 passed**, zero failed. |
| Final `npm.cmd test` | **1028 passed, 0 failed, 5 skipped; 1033 total**. |
| `npm.cmd run test:smoke` | PASS; existing Table key warning retained. |
| `npm.cmd run build` | PASS; existing >500 kB chunk warning retained. |
| `node tests/yzh-qa-02.browser.mjs` | PASS, 390/768/1024/1440; 56 requests, 6 intercepted mutations, zero page errors. |
| `node tests/yzh-qa-02-prescription.browser.mjs` | PASS; late-response identity and separate Save/Issue, 3 intercepted mutations. Failed before fix. |
| `node tests/yzh-qa-02-calendar.browser.mjs` | PASS; b1/b2 context read. Original HEAD module replay fails on stale b1 data. |
| `node tests/yzh-qa-02-staff.browser.mjs` | PASS, four widths; actual CheckInPage callback/three actions and walk-in custom combobox. Zero page errors; no API mutation. |
| `node tests/den-ui-02.browser.mjs` | PASS, four required widths; 197 requests, 26 intercepted mutations, zero page errors. |
| `node tests/den-ui-01.browser.mjs` | PASS, 390/768/1024/1440 plus 375/430; 81 requests, no mutation, zero page errors. |
| `git diff --check` | PASS. |
| `bash scripts/predefense-check.sh` | **BLOCKED/failed**, existing CRLF at line 8: `set: pipefail\r: invalid option name`. Sandbox first denied Bash; elevated retry reached this unchanged failure. No PHP/database probe ran. |

Browser setup: local Vite at 127.0.0.1:5187, installed Chrome, temporary untracked/ignored Playwright runner (`npm.cmd install --no-save --package-lock=false --ignore-scripts playwright`). Existing clinical scripts use `PLAYWRIGHT_MODULE=<workspace>/node_modules/playwright`. Home/Schedule uses `DEN_UI_URL=http://127.0.0.1:5187/tests/fixtures/den-ui-01.html`. Set `QA_EVIDENCE_DIR=docs/ui-review/yzh-qa-02/clinical` or `.../schedule` to preserve original artifacts. Baseline-calendar replay uses PowerShell `$env:QA_BASELINE_CALENDAR='1'`; clear it for current-source replay.

Initial no-dependency/sandbox runs were environment failures (missing esbuild, then denied subprocess); these are superseded by the reproduced baseline, not classified as product regressions. Backend full suites intentionally not run: no approved isolated authenticated backend target. Five historical optional skips remain skips. No assertions were removed or weakened to turn a product failure green.

Evidence: `docs/ui-review/yzh-qa-02/` includes booking/shared-control images, chart/queue/encounter images and schedule/Home images plus machine-readable results. Visually inspected booking 390, controls 1440, encounter 1024, schedule 390 and chart 390 (including corrected production stylesheet). No document overflow in tested states. Screenshots supplement behavioral assertions; they do not establish auth, screen-reader conformance, exhaustive contrast or real touch-device acceptance. Role-labelled component fixtures are not full role dashboards.

## H. Outstanding dependencies and authenticated closure checklist

**BLOCKED — approved authenticated synthetic session unavailable.** User confirms 127.0.0.1:5173 / :8000 are previously used development URLs only, not verified QA sessions. Do not use production accounts, existing clinic credentials, auth bypasses or real records.

Prerequisites: approved QA origin; isolated demo/test backend and non-delivering mail/payment adapters; synthetic accounts for all four roles; two branches, two Dentists, guardian/dependent relationships (including revoked), disposable authorized appointments/Visits/queues/treatments, prescription drafts/issued records and follow-ups; independent backend-owner approval for any mutation execution. Capture redacted request/result IDs, clock/branch/actor, UI assertions, errors and screenshots without secrets or clinical content.

| Remaining scenario | Evidence needed to close |
| --- | --- |
| Patient self/dependent booking, revocation and switching | Real authenticated availability and quote queries use the chosen patient; create returns that same patient; revoked relationship refuses all reads/writes without guardian fallback. |
| Final slot revalidation, duplicate/ambiguous request retry | Two synthetic clients conflict on one slot; one persisted appointment; stable retry key returns same record; changed intent cannot silently replay a different appointment. |
| Online unavailable/provider failure, cash, pending/paid | Explicit false refuses with no unpaid substitution; true respects capability/policy. Test checkout/webhook proves Pending/held versus Confirmed/paid; browser redirect alone never confirms. |
| Cancel, hold expiry, refund pending/failure/settled | Exact server lifecycle and reconciled amount/status shown; no guarantee based on UI intent; no duplicate provider refund. Joevan owns backend/provider evidence. |
| Staff check-in and queue scope | Approved synthetic scheduled patient, exact appointment/Visit/queue relationship; required confirmation and actual action count; no duplicate admission. |
| Dentist own/foreign queue and encounter | Real authorization denies other Dentist/branch IDs, Waiting start refused, Called/Ready accepted, active encounter accessible; exact seven identities preserved. |
| Documentation conflicts/session/refresh | Two synthetic sessions produce actual 409/revision refresh; failed Save retains text; retry is stable; logout/discard/Stay/browser beforeunload behave in the full App. No draft localStorage. |
| Chart/history and prescriptions | Real authorized patient chart/summary, no delayed response leak; new prescription draft/issue counts, dose separate, exact Visit/patient, locked issued state and denial for other roles. |
| Follow-ups and continuity | Populated real tasks/statuses; recommendation not Booked; origin relationship must be supplied before asserting exact Treatment association. |
| GEN-06 and DEN-03 | Original steps/screenshot plus full active-role controls/custom comboboxes at four widths; actual schedule/work-hours/closed days/partial leave/assignment responses. |
| Handover/leave/work-hours/wording approvals | Jaztin's rules and policies, role access and server errors; Richmon/Celin-owned UI fixes coordinated with owners. |

Joevan: authenticated booking/payment/authorization evidence, follow-up origin contract and full backend regression discrepancies documented in DEV_A_01_R1_INTEGRATION_CONTRACT. The earlier DEN-UI-02 Waiting-start warning is superseded in this integrated source by R1's Called/Ready guard; do not reopen it from the old report alone. Jaztin: original DEN-03 reproduction and leave/coverage/handover behavior. Richmon: GEN-09 actual efficiency study and shared calendar/design ownership. Clinic/custodian: confirmed fees/refunds, medical-alert contract, legacy note recovery, approved chart reference and real Dentist hours. Operations: repair/validate predefense shell separately and verify hosted workers/provider setup.

## I. Final repository state

Branch and HEAD remain the baseline; nothing staged. No commit, merge, cherry-pick, push, deploy, reset, clean, stash or rebase. Only this QA tracker was updated. Other trackers, master QA, backend source/tests, original DEV/DEN worktrees and shared integration branch preserved. Approved logo assets unchanged (smoke hashes pass).

Modified source: `src/api-client.js`, `src/appointments-api.js`, `src/patient/booking-flow.js`, `src/patient/BookingCalendar.jsx`, `src/patient/pages/Book.jsx`, `src/pages/ServerPrescriptions.jsx`.

Modified verification/tracker: `tests/den-ui-01.browser.mjs` (isolated evidence directory), `tests/den-ui-02.browser.mjs` (four widths/chart behavior/evidence isolation), `tests/fixtures/den-ui-02.jsx` (production chart stylesheet), `QA-YZHEKIEL.md` (dated evidence only).

New files: this report; `tests/yzh-qa-02.test.js`; `tests/yzh-qa-02.browser.mjs`; `tests/yzh-qa-02-calendar.browser.mjs`; `tests/yzh-qa-02-prescription.browser.mjs`; `tests/yzh-qa-02-staff.browser.mjs`; `tests/fixtures/yzh-qa-02.html`; `tests/fixtures/yzh-qa-02.jsx`; screenshots and result JSON under `docs/ui-review/yzh-qa-02/`.

Original screenshots/result JSON briefly regenerated by the initial existing-harness runs were restored to HEAD content; new evidence is isolated under this batch. Generated MCP console artifacts were moved to OS temporary storage; no pre-existing untracked file existed or was removed. Dependency installation and build output are ignored. Final diff/secret-pattern scan and full inventory are recorded below after the final check.

Final inventory check: **10 modified tracked files; 39 new untracked files; zero staged files**. Tracked diff (untracked additions excluded):

```text
QA-YZHEKIEL.md                    | 13 +++++++++
 src/api-client.js                 |  1 +
 src/appointments-api.js           |  3 +-
 src/pages/ServerPrescriptions.jsx | 13 +++++++--
 src/patient/BookingCalendar.jsx   | 22 +++++++++------
 src/patient/booking-flow.js       |  6 ++++
 src/patient/pages/Book.jsx        | 58 +++++++++++++++++++++++++--------------
 tests/den-ui-01.browser.mjs       |  2 +-
 tests/den-ui-02.browser.mjs       | 20 ++++++++++----
 tests/fixtures/den-ui-02.jsx      |  1 +
 10 files changed, 98 insertions(+), 41 deletions(-)
```

Full final status:

```text
M QA-YZHEKIEL.md
 M src/api-client.js
 M src/appointments-api.js
 M src/pages/ServerPrescriptions.jsx
 M src/patient/BookingCalendar.jsx
 M src/patient/booking-flow.js
 M src/patient/pages/Book.jsx
 M tests/den-ui-01.browser.mjs
 M tests/den-ui-02.browser.mjs
 M tests/fixtures/den-ui-02.jsx
?? docs/YZH_QA_02_CROSS_ROLE_ACCEPTANCE_REPORT.md
?? docs/ui-review/yzh-qa-02/booking-1024.png
?? docs/ui-review/yzh-qa-02/booking-1440.png
?? docs/ui-review/yzh-qa-02/booking-390.png
?? docs/ui-review/yzh-qa-02/booking-768.png
?? docs/ui-review/yzh-qa-02/browser-results.json
?? docs/ui-review/yzh-qa-02/clinical/browser-results.json
?? docs/ui-review/yzh-qa-02/clinical/chart-1024.png
?? docs/ui-review/yzh-qa-02/clinical/chart-1440.png
?? docs/ui-review/yzh-qa-02/clinical/chart-390.png
?? docs/ui-review/yzh-qa-02/clinical/chart-768.png
?? docs/ui-review/yzh-qa-02/clinical/encounter-1024.png
?? docs/ui-review/yzh-qa-02/clinical/encounter-1440.png
?? docs/ui-review/yzh-qa-02/clinical/encounter-390.png
?? docs/ui-review/yzh-qa-02/clinical/encounter-768.png
?? docs/ui-review/yzh-qa-02/clinical/queue-1024.png
?? docs/ui-review/yzh-qa-02/clinical/queue-1440.png
?? docs/ui-review/yzh-qa-02/clinical/queue-390.png
?? docs/ui-review/yzh-qa-02/clinical/queue-768.png
?? docs/ui-review/yzh-qa-02/controls-1024.png
?? docs/ui-review/yzh-qa-02/controls-1440.png
?? docs/ui-review/yzh-qa-02/controls-390.png
?? docs/ui-review/yzh-qa-02/controls-768.png
?? docs/ui-review/yzh-qa-02/prescription-results.json
?? docs/ui-review/yzh-qa-02/schedule/browser-results.json
?? docs/ui-review/yzh-qa-02/schedule/home-1440.png
?? docs/ui-review/yzh-qa-02/schedule/home-390.png
?? docs/ui-review/yzh-qa-02/schedule/home-768.png
?? docs/ui-review/yzh-qa-02/schedule/schedule-1440.png
?? docs/ui-review/yzh-qa-02/schedule/schedule-390.png
?? docs/ui-review/yzh-qa-02/schedule/schedule-768.png
?? docs/ui-review/yzh-qa-02/staff-results.json
?? tests/fixtures/yzh-qa-02.html
?? tests/fixtures/yzh-qa-02.jsx
?? tests/yzh-qa-02-calendar.browser.mjs
?? tests/yzh-qa-02-prescription.browser.mjs
?? tests/yzh-qa-02-staff.browser.mjs
?? tests/yzh-qa-02.browser.mjs
?? tests/yzh-qa-02.test.js
```

Final scan: 23 changed/new text files checked for private-key, provider-key, AWS access-key and credentialed PostgreSQL URL patterns: zero matches. Changed-path review found zero backend files. Whitespace check passed; staged diff empty; branch/HEAD unchanged.

## J. Post-Audit R1 Correction and Regression Evidence

2026-11-02, Asia/Manila. This section is a continuation of QA-02. Sections A–I retain their historical results; their test runs are not presented as R1 runs.

### Preservation and bounded scope

Preflight matched branch `qa/yzhekiel-ui-20261102` and HEAD `a6a0de5bf36c77a43d948b98f821940bac41df3d`. Starting inventory was ten modified tracked files and 39 untracked files; no staged changes; whitespace check passed. SHA-256 preservation manifest captured all 49 existing changed/untracked files in OS temporary storage before editing. All 31 previous QA-02 evidence files remain byte-identical. No worktree, commit, branch, backend, database, original DEV/DEN workspace, other tracker or published integration candidate was changed.

### Findings, root causes and corrections

| Finding | Pre-correction evidence | Root cause / exact correction | Disposition |
| --- | --- | --- | --- |
| P1: late prescription Save/Issue affects another editor | Deferred Save A and Issue A, then select and type into B: stale success opens A's dialog. Cancel during pending Save also permits stale A navigation. | Parent-owned editor generation increments synchronously when a different draft is selected or Cancel resets selection. WriteCard captures that generation, and checks it plus mount lifetime after the complete Save/explicit-Issue command chain, before any state update, error/success toast, reset or navigation. Transmitted commands retain A's captured ID/body/revision and are not aborted. | **Fixed in tested frontend paths.** |
| P1: ambiguous booking loses quotation retry | Abort booking response, Back, Return to Review, fail quote read: Try again is disabled for both cash and online intent. | ErrorState recovery was nested inside the payment fieldset locked by uncertain intent. Move only the quotation error/retry outside that fieldset. Payment/person choices stay locked; Submit still requires a valid matching quote and capability. Retry performs only a GET; only an explicit subsequent Submit replays the original body/key. | **Fixed.** |
| P2: calendar A → pending B → A stays loading | After A loads, hold B, return to A: wait for settled calendar times out, for both eventual B success and B failure. | The old completed key survived after its display data was cleared. Clear `loaded.current` when starting any new request, before clearing display state. Retain the complete context key and canceled-response guard; a valid displayed initial month still avoids a duplicate read. Returning to A now makes a fresh A request. | **Fixed.** |
| P2: online selection shows cash reassurance | Intercepted replay of the pre-R1 unconditional copy leaves “No payment is collected online with this choice” visible after selecting online. | Condition cash explanation on cash intent plus cash capability; condition checkout/pending-verification explanation on online intent plus online capability. No payment/refund guarantee or redirect-based confirmation added. | **Fixed.** |

Related mutation inspection: Cancel is synchronous and invalidates the editor generation without canceling its transmitted command. The separate PrescriptionDialog Void path now ignores feedback/state/parent refresh after its dialog unmounts or its record ID changes; dialog reads also discard obsolete results. An already requested PDF download is not canceled, while stale PDF error feedback is suppressed. License saving is an account-level action, not a patient/editor mutation, and was left unchanged. No prescription backend, issuance authority, medicine/dosage catalog or API contract changed.

### Deterministic regressions and before/after evidence

New harness: `node tests/yzh-qa-02-r1.browser.mjs`. Every case uses an independent browser context and intercepted synthetic requests. Deferred responses are released explicitly; tests wait for response completion and browser frames rather than fixed response-order sleeps.

- Save and Issue: hold A's write, select B, type B dosage/note, release A success or failure. Assert B remains selected, typed values remain unchanged, no stale A dialog/toast/reset, and A's transmitted dosage/target stays A's. On failure cases B first produces its own validation error, which must survive A's response. A subsequent normal Save B must target B with the typed data and show its own result.
- Cancel: cancel while Save A is pending, select B's Visit in the new draft and type a note; late A cannot navigate or clear that new draft.
- Void: start Void A, close that dialog, edit/type B, then release A success or failure. The command still targets A exactly once; B is unchanged and no stale feedback appears.
- Quote recovery without a prior submission and after ambiguous cash/online submissions: retry remains enabled; a held read keeps Submit disabled; a mismatched quote cannot enable Submit; read retries never POST; valid recovery preserves dependent/branch/service/date/slot/payment intent. Explicit replay uses the exact original body and idempotency key, and stays Pending/unpaid or Pending/held as returned. No automatic resend is performed.
- Calendar: initial A read occurs once; B is held; returning to A settles with its own available day; releasing B success or failure afterward never shows B's closure/error under A. Two A reads and one B read are asserted.
- Copy: rendered cash and online selections have the appropriate distinct explanations; online never displays cash reassurance. No document overflow in the tested states.

Before the production fixes, `node tests/yzh-qa-02-r1.browser.mjs --before` recorded eight failures/three passes at 390px. The Save, Issue, Cancel, ambiguous-quote and calendar failures reproduce the audit paths; the failure-path controls and initial quotation recovery already passed. The initial copy assertion used an overly exact partial paragraph locator and was corrected. Its valid red proof is separately retained as `copy-before-results.json`: `node tests/yzh-qa-02-r1.browser.mjs --pre-r1-copy` intercepts only the Book module's copy with the original unconditional paragraph, and fails the online/no-cash-reassurance assertion. It does not restore or overwrite a working file.

Final R1 result: **52 passed, zero failed**: 13 cases at **390, 768, 1024 and 1440px**. `after-results.json` contains every case. Intermediate test-development failures included the corrected partial-paragraph locator and a Void fixture returning a record object for the initial service-list read; these were fixture errors, not application fixes or weakened assertions. The final Void fixture returns valid list shapes and both Void paths pass.

### Verification commands and results obtained during R1

| Command | R1 result |
| --- | --- |
| `node tests/yzh-qa-02-r1.browser.mjs` | 52 passed, 0 failed; independent synthetic contexts, four required widths. |
| `npm.cmd test` | **1028 passed, 0 failed, 5 skipped; 1033 total.** New R1 behavioral cases are in the browser harness, not an inflated Node unit-test count. |
| `npm.cmd run test:smoke` | PASS; existing React Table key warning remains. |
| `npm.cmd run build` | PASS; existing >500 kB chunk warning remains. |
| `node tests/yzh-qa-02.browser.mjs` | PASS four widths; 56 requests, six intercepted booking mutations, zero page errors. |
| `node tests/yzh-qa-02-calendar.browser.mjs` | PASS; same-month b1/b2 read regression retained. |
| `node tests/yzh-qa-02-prescription.browser.mjs` | PASS; original GET race and separate Save/Issue/locked-state checks retained; three intercepted mutations. |
| `node tests/den-ui-02.browser.mjs` | PASS four widths; 197 requests, 26 intercepted mutations, zero page errors. |
| `git diff --check` | PASS. |

Vite initially failed inside the sandbox because esbuild could not read the configuration directory; the elevated local server succeeded. Full suite, smoke and build ran elevated for the same known esbuild environment restriction. No dependency installation, backend test, migration, seeder, real payment or clinical operation ran during R1. The previously recorded predefense CRLF blocker remains unchanged; that operations script was not edited or rerun for this bounded correction.

Rerun existing harnesses with `QA_EVIDENCE_DIR=docs/ui-review/yzh-qa-02/r1/existing-booking`, `.../existing-prescription`, or `.../clinical`; clinical also uses `PLAYWRIGHT_MODULE=<workspace>/node_modules/playwright`. The two older booking/prescription harnesses now accept this optional evidence directory while preserving their original default. R1 screenshots and result JSON are isolated under `docs/ui-review/yzh-qa-02/r1/`; the earlier evidence is not overwritten. Online-mode and enabled-retry screenshots were visually inspected; screenshots disable transient animations for evidence capture only.

### Remaining limits and disposition

**GO FOR READ-ONLY RE-AUDIT.** Both P1 and both P2 findings are resolved in the tested frontend paths. This is not commit, integration or deployment approval. **Authenticated acceptance remains BLOCKED — approved authenticated synthetic session unavailable.** No new backend contract is required for these corrections. Existing Joevan provider/authorization/settlement evidence, Jaztin scheduling/leave dependencies, GEN-06/DEN-03 reproduction gaps, clinical policies and legacy-record recovery remain as listed in section H. Synthetic callback and intercepted tests cannot establish backend concurrency, authorization or financial settlement.

R1 source edits: `src/pages/ServerPrescriptions.jsx`, `src/patient/pages/Book.jsx`, `src/patient/BookingCalendar.jsx`. R1 verification edits: `tests/fixtures/yzh-qa-02.jsx` (capture synthetic prescription feedback), `tests/yzh-qa-02.browser.mjs` and `tests/yzh-qa-02-prescription.browser.mjs` (optional output directory). New focused test: `tests/yzh-qa-02-r1.browser.mjs`. Tracker and this report extended; previous valid content retained. Final exact inventory, preservation and secret-scan results follow.

Final R1 inventory and preservation check:

```json
{
  "modifiedTracked": 10,
  "untracked": 74,
  "staged": 0,
  "R1ChangedPriorFiles": [
    "QA-YZHEKIEL.md",
    "src/pages/ServerPrescriptions.jsx",
    "src/patient/BookingCalendar.jsx",
    "src/patient/pages/Book.jsx",
    "docs/YZH_QA_02_CROSS_ROLE_ACCEPTANCE_REPORT.md",
    "tests/fixtures/yzh-qa-02.jsx",
    "tests/yzh-qa-02-prescription.browser.mjs",
    "tests/yzh-qa-02.browser.mjs"
  ],
  "R1NewFiles": 35,
  "previousEvidenceFiles": 31,
  "previousEvidenceByteIdentical": true,
  "textFilesScanned": 30,
  "secretPatternMatches": [],
  "backendChanges": []
}
```

Exact final working-tree inventory (all prior QA-02 files plus R1 additions; nothing staged):

```text
 M QA-YZHEKIEL.md
 M src/api-client.js
 M src/appointments-api.js
 M src/pages/ServerPrescriptions.jsx
 M src/patient/BookingCalendar.jsx
 M src/patient/booking-flow.js
 M src/patient/pages/Book.jsx
 M tests/den-ui-01.browser.mjs
 M tests/den-ui-02.browser.mjs
 M tests/fixtures/den-ui-02.jsx
?? docs/YZH_QA_02_CROSS_ROLE_ACCEPTANCE_REPORT.md
?? docs/ui-review/yzh-qa-02/booking-1024.png
?? docs/ui-review/yzh-qa-02/booking-1440.png
?? docs/ui-review/yzh-qa-02/booking-390.png
?? docs/ui-review/yzh-qa-02/booking-768.png
?? docs/ui-review/yzh-qa-02/browser-results.json
?? docs/ui-review/yzh-qa-02/clinical/browser-results.json
?? docs/ui-review/yzh-qa-02/clinical/chart-1024.png
?? docs/ui-review/yzh-qa-02/clinical/chart-1440.png
?? docs/ui-review/yzh-qa-02/clinical/chart-390.png
?? docs/ui-review/yzh-qa-02/clinical/chart-768.png
?? docs/ui-review/yzh-qa-02/clinical/encounter-1024.png
?? docs/ui-review/yzh-qa-02/clinical/encounter-1440.png
?? docs/ui-review/yzh-qa-02/clinical/encounter-390.png
?? docs/ui-review/yzh-qa-02/clinical/encounter-768.png
?? docs/ui-review/yzh-qa-02/clinical/queue-1024.png
?? docs/ui-review/yzh-qa-02/clinical/queue-1440.png
?? docs/ui-review/yzh-qa-02/clinical/queue-390.png
?? docs/ui-review/yzh-qa-02/clinical/queue-768.png
?? docs/ui-review/yzh-qa-02/controls-1024.png
?? docs/ui-review/yzh-qa-02/controls-1440.png
?? docs/ui-review/yzh-qa-02/controls-390.png
?? docs/ui-review/yzh-qa-02/controls-768.png
?? docs/ui-review/yzh-qa-02/prescription-results.json
?? docs/ui-review/yzh-qa-02/r1/after-results.json
?? docs/ui-review/yzh-qa-02/r1/before-results.json
?? docs/ui-review/yzh-qa-02/r1/clinical/browser-results.json
?? docs/ui-review/yzh-qa-02/r1/clinical/chart-1024.png
?? docs/ui-review/yzh-qa-02/r1/clinical/chart-1440.png
?? docs/ui-review/yzh-qa-02/r1/clinical/chart-390.png
?? docs/ui-review/yzh-qa-02/r1/clinical/chart-768.png
?? docs/ui-review/yzh-qa-02/r1/clinical/encounter-1024.png
?? docs/ui-review/yzh-qa-02/r1/clinical/encounter-1440.png
?? docs/ui-review/yzh-qa-02/r1/clinical/encounter-390.png
?? docs/ui-review/yzh-qa-02/r1/clinical/encounter-768.png
?? docs/ui-review/yzh-qa-02/r1/clinical/queue-1024.png
?? docs/ui-review/yzh-qa-02/r1/clinical/queue-1440.png
?? docs/ui-review/yzh-qa-02/r1/clinical/queue-390.png
?? docs/ui-review/yzh-qa-02/r1/clinical/queue-768.png
?? docs/ui-review/yzh-qa-02/r1/copy-before-results.json
?? docs/ui-review/yzh-qa-02/r1/existing-booking/booking-1024.png
?? docs/ui-review/yzh-qa-02/r1/existing-booking/booking-1440.png
?? docs/ui-review/yzh-qa-02/r1/existing-booking/booking-390.png
?? docs/ui-review/yzh-qa-02/r1/existing-booking/booking-768.png
?? docs/ui-review/yzh-qa-02/r1/existing-booking/browser-results.json
?? docs/ui-review/yzh-qa-02/r1/existing-booking/controls-1024.png
?? docs/ui-review/yzh-qa-02/r1/existing-booking/controls-1440.png
?? docs/ui-review/yzh-qa-02/r1/existing-booking/controls-390.png
?? docs/ui-review/yzh-qa-02/r1/existing-booking/controls-768.png
?? docs/ui-review/yzh-qa-02/r1/existing-prescription/prescription-results.json
?? docs/ui-review/yzh-qa-02/r1/online-1024.png
?? docs/ui-review/yzh-qa-02/r1/online-1440.png
?? docs/ui-review/yzh-qa-02/r1/online-390.png
?? docs/ui-review/yzh-qa-02/r1/online-768.png
?? docs/ui-review/yzh-qa-02/r1/quote-retry-1024.png
?? docs/ui-review/yzh-qa-02/r1/quote-retry-1440.png
?? docs/ui-review/yzh-qa-02/r1/quote-retry-390.png
?? docs/ui-review/yzh-qa-02/r1/quote-retry-768.png
?? docs/ui-review/yzh-qa-02/schedule/browser-results.json
?? docs/ui-review/yzh-qa-02/schedule/home-1440.png
?? docs/ui-review/yzh-qa-02/schedule/home-390.png
?? docs/ui-review/yzh-qa-02/schedule/home-768.png
?? docs/ui-review/yzh-qa-02/schedule/schedule-1440.png
?? docs/ui-review/yzh-qa-02/schedule/schedule-390.png
?? docs/ui-review/yzh-qa-02/schedule/schedule-768.png
?? docs/ui-review/yzh-qa-02/staff-results.json
?? tests/fixtures/yzh-qa-02.html
?? tests/fixtures/yzh-qa-02.jsx
?? tests/yzh-qa-02-calendar.browser.mjs
?? tests/yzh-qa-02-prescription.browser.mjs
?? tests/yzh-qa-02-r1.browser.mjs
?? tests/yzh-qa-02-staff.browser.mjs
?? tests/yzh-qa-02.browser.mjs
?? tests/yzh-qa-02.test.js
```

## K. Post-Audit R2 — New-Prescription Visit Identity Protection

2026-11-03, Asia/Manila. Targeted Developer B correction authorized by Yzhekiel. Earlier sections retain their historical results. This section does not grant commit, integration, authenticated acceptance or deployment approval.

### Independent finding and before evidence

The independent R1 re-audit found one remaining P1. Existing-draft selection changes already invalidated pending completions, but the new-prescription Visit selector only changed `visitId` within the same mounted WriteCard. Neither its mount lifetime nor the parent's saved-draft selection generation changed.

Reproduction against the actual pre-R2 source: select synthetic Visit A, enter Paracetamol/500mg and A's note, start Save or explicitly confirm Issue, hold its response, select Visit B and enter Ibuprofen/250mg and B's note, then release A's response. Save/Issue success cleared B's Visit and content and opened A through `reset`, `onEdited` and `onDone`; failure placed A's validation feedback in B through `setErr`.

`node tests/yzh-qa-02-r2.browser.mjs --before` ran before the source correction: **0 passed, 4 failed at 390px**, reproducing all four original cases. Save/Issue success failed the active-Visit assertion (`'' !== 'vB'`); Save/Issue failure failed the no-stale-error assertion (`1 !== 0`). `r2/before-results.json` retains the failure assertions and pre-R2 source SHA-256. No source restoration or baseline substitution was used.

### Correction and ownership strategy

Only production source changed by R2: `src/pages/ServerPrescriptions.jsx`.

- WriteCard owns a monotonic `visitGeneration` ref. Each explicit Visit change increments it synchronously before updating React state. The handler does not compare a captured Visit value, so returning A → B → A cannot revive A's earlier completion.
- A Visit change starts blank medicine/note state and clears the previous editor's error, loading and confirmation state. No other patient's content is silently carried into the selected Visit. No per-patient browser persistence or new confirmation dialog was introduced.
- Save/Issue captures the generation before awaiting. After the existing command chain, completion must pass mount lifetime, parent draft-selection identity and local Visit-generation guards before updating loading/error state, showing a toast, resetting, refreshing/opening a record or invoking parent callbacks.
- The original create body is captured before awaiting. It retains its original Visit and clinical content. The existing explicitly confirmed Issue chain retains the returned prescription ID/revision for A, including when its create response is delayed. Selection itself sends no mutation; it neither retargets, retries nor automatically submits B.
- The existing-draft guards, read cancellation, stale Void/PDF feedback protection, separate Save/Issue confirmation, medicine/dosage fields, authorization handling and issued immutability remain unchanged.

This preserves task continuity and safe defaults without a visual redesign: B's current work survives A's completion, a new Visit does not inherit another patient's medicine, and normal Save/Issue remain explicit actions. Earlier P2/P3 design observations remain recommendations only; no repository-wide design standard was adopted.

### Deterministic regression coverage

New focused harness: `tests/yzh-qa-02-r2.browser.mjs`. It imports the existing production-component fixture through Vite, uses a fresh browser context per case and intercepts every API request. Deferred responses are explicitly released, followed by response completion and browser frames; there are no fixed race-order sleeps. All commands are synthetic and never reach Laravel.

Final matrix: **52 passed, zero failed — 13 cases at 390, 768, 1024 and 1440px**:

1. Save A success after selecting B.
2. Save A failure after selecting B.
3. Issue A success after selecting B, holding the Issue response.
4. Issue A failure after selecting B, holding the Issue response.
5. Issue with delayed create success before its explicit Issue continuation.
6. Issue with delayed create failure; no Issue command follows the failed create.
7. Save success after A → B → A.
8. Save failure after A → B → A.
9. Issue success after A → B → A.
10. Issue failure after A → B → A.
11. B's own failed Save feedback survives late A failure; B is not locked by A's loading state.
12. Normal active B Issue: opening confirmation sends nothing, confirming creates/Issues B with its own payload/revision and opens B's Issued record.
13. Explicit Visit change starts with blank medicine, dosage and note; empty Save remains disabled.

The six non-rapid Save/Issue race variants also explicitly Save B afterward, assert its exact Visit/medicine/dosage/note body and confirm B's own detail/success feedback. Stale-result assertions check current Visit and typed content, no A error/toast/dialog, and enabled current-editor Save. Request assertions verify A's original payload exactly, one create for A and only the original explicit Issue continuation where applicable. Returning to A must retain its freshly typed note before any test cleanup.

`r2/after-results.json` records the final source SHA-256 and every case with request bodies. Sixteen screenshots capture B's editor after the four primary stale completions at all widths. The 390px Issue-failure screenshot was visually inspected; layout and existing action hierarchy are retained. The synthetic Visit data uses null age explicitly rather than an absent age field. Early 44-case output was expanded with rapid-return failure cases and superseded by this final 52-case matrix; it is not counted as additional coverage.

### Commands actually executed during R2

| Command | Result |
| --- | --- |
| `node tests/yzh-qa-02-r2.browser.mjs --before` | Expected red: 0 passed / 4 failed before source edits. |
| `node tests/yzh-qa-02-r2.browser.mjs` | Final 52 passed / 0 failed, four widths. |
| `npm.cmd test` | Final source: 1028 passed / 0 failed / 5 skipped, 1033 total. R2 browser cases are separate from this count. |
| `npm.cmd run test:smoke` | PASS; existing React Table key warning retained; official logo hashes pass. |
| `npm.cmd run build` | PASS; existing >500 kB chunk warning retained. No deployment. |
| `node tests/yzh-qa-02-r1.browser.mjs` | 52 passed / 0 failed; output directed to `r2/r1-regression`. |
| `node tests/yzh-qa-02.browser.mjs` | PASS four widths; 56 requests, six synthetic booking mutations, zero page errors; output `r2/existing-booking`. |
| `node tests/den-ui-02.browser.mjs` | PASS four widths; 197 intercepted requests, zero page errors; output `r2/clinical`. Existing unsaved-work, revision-conflict, failed Save/Complete and encounter identity assertions retained. |
| `node tests/yzh-qa-02-prescription.browser.mjs` | PASS; original GET race, separate Save/Issue and locked-state checks; three synthetic mutations; output `r2/existing-prescription`. |
| `node tests/yzh-qa-02-calendar.browser.mjs` | PASS; same-month b1/b2 reads retained. No evidence writes in this harness. |
| `git diff --check` | PASS. |

The local Vite server uses 127.0.0.1:5187. Its initial sandbox startup was denied by esbuild directory access; elevated startup succeeded. Full suite, smoke and build used elevation for that established environment restriction. No dependency installation or manifest/lockfile change occurred. Final suite/smoke/build and R1 matrix were rerun after the last source adjustment.

Browser commands use `QA_EVIDENCE_DIR=docs/ui-review/yzh-qa-02/r2/<directory>` as listed above; the clinical harness additionally uses `PLAYWRIGHT_MODULE=<workspace>/node_modules/playwright`. R2 adds only the optional evidence-directory override to the R1 harness; its default and all assertions remain intact. `r2/verification-results.json` records commands and outcomes.

`scripts/predefense-check.sh` was not rerun in R2. Its existing CRLF at `set -euo pipefail` was statically confirmed unchanged. No backend/database probes, backend suites, migrations, seeders, real authentication, payments, prescriptions or email operations ran.

### Preservation, scope and inventory

Preflight matched branch `qa/yzhekiel-ui-20261102`, HEAD `a6a0de5bf36c77a43d948b98f821940bac41df3d`: **10 modified tracked files, 74 untracked files, zero staged files**. SHA-256 hashes captured all 84 existing changed/untracked files before edits.

R2 intentionally changes four prior files only:

- `src/pages/ServerPrescriptions.jsx` — local Visit-generation correction.
- `tests/yzh-qa-02-r1.browser.mjs` — optional isolated evidence directory; no assertion changes.
- `docs/YZH_QA_02_CROSS_ROLE_ACCEPTANCE_REPORT.md` — this appended section K.
- `QA-YZHEKIEL.md` — dated R2 evidence entry; prior evidence retained.

New files: `tests/yzh-qa-02-r2.browser.mjs` and 52 evidence/verification/preservation files under `docs/ui-review/yzh-qa-02/r2/`. Final inventory: **10 modified tracked files, 127 untracked files, zero staged files**. The full before/after inventory and preservation hashes are in `r2/preservation-results.json`.

All **65 pre-R2 QA-02/R1 evidence files remain byte-identical**, including the earlier 31 QA-02 artifacts. No prior file is missing; all 80 pre-existing files outside the four authorized edits are byte-identical. No backend source/tests, other tracker, shared integration branch, clinic logo, package manifest or lockfile changed. Final whitespace and secret-pattern checks pass. No reset, clean, stash, restore, branch switch, commit, merge, push or deployment was performed.

### Limits and disposition

**GO FOR READ-ONLY R2 RE-AUDIT.** All four remaining P1 reproductions now pass, normal active-editor Save/Issue work, and existing R1 regressions remain green. No new backend contract or owner decision is required for this correction.

Authenticated cross-role E2E remains BLOCKED because no approved signed-in synthetic environment exists. Backend persistence, authorization, provider settlement, original GEN-06/DEN-03 reproduction gaps, queue-state policy review, historical backend-suite discrepancies and deployment/predefense acceptance retain their earlier limits. The intercepted tests do not establish production readiness, screen-reader conformance or real-device touch acceptance. Further Git operations still require Yzhekiel's authorization.

# Jaztin clinical batch 02 — 2026-11-15 (Asia/Manila)

Implemented on `feature/jaztin-qa-20261115`, `/private/tmp/dentalops-jaztin-qa-20261115`, starting at published `b4b2a19a3be4244b41df32f050ab7be576727ac9`. Original collaboration baseline remains `a0725e645df6f8266c2bc4bebacc9d62dd18e7c1`. No reset, merge, deployment or Joevan-branch change. Draft PR #9 remains the publication vehicle.

Arrival implementation commit: `ce72a75376de838187c4e7ae5b1020d82f55317e` — `feat(arrivals): recover exact admission receipts across retries and sessions`. Companion ID-evidence/browser/contract commit follows it. The final Git report identifies its exact SHA; this document is contained in that commit.

## Implemented and locally accepted

Explicit scheduled arrival and existing-Patient walk-in now retain immutable reviewed identity/key through uncertainty, suppress duplicate clicks and obsolete session responses, recover the original committed Visit/queue receipt, and distinguish a verified write from a failed list refresh. Staff can review today's actual scoped arrivals and recover their exact original receipt after reload/new sign-in. Walk-ins retain null appointment; scheduled admission resolves Patient/branch/service/Dentist from the appointment. No automatic admission or treatment completion.

Current authority is enforced before journal replay and again in the transaction. Existing unique constraints and transactional history prevent duplicate Visits/queues under real concurrent Staff commands. Explicit scheduled physical-ID acknowledgement adds sanitized audit evidence without inventing global verification policy.

Shared ID-check save/readback now requires the exact Patient identity. ID update/audit commit together. New verification timestamps preserve the actual instant under UTC and Manila DB sessions; no historical repair. Existing callers still receive their original updated Patient model. Conditional Other details retain blank/whitespace refusal and trimmed persisted readback.

Workflow automation: explicit Staff trigger → current role/branch/identity/prerequisite validation → existing scheduling eligibility → atomic Visit, appointment transition, queue/history/journal → verified exact receipt → optional live queue navigation. Conflicts reject; uncertainty retains original command; current list and original receipt remain visibly distinct.

## Original QA mapping (no broad closure claim)

Source: `FINALS-QA-REVISIONS.md`, corresponding `QA-*.md` artifacts, and `docs/TEAM_QA_WORKFLOW_20261115.md` scoped assignments.

| ID | Original criterion / evidence in this batch | Status |
| --- | --- | --- |
| STF-04 | Patient summary Other valid ID reveals required Specify input; whitespace refused; exact saved Patient evidence | Shared server-backed checker strengthened; local browser/PG evidence; no integrated ledger closure claimed |
| GEN-07 | Conditional Other/Specify validation | ID subset covered; broader General criterion remains partial |
| STF-10 | One working Check-In refresh | Existing control retained and covered by focused tests; new recovery does not add another refresh control |
| STF-12 | Single searchable keyboard Patient combobox, name/phone/code | Existing picker retained; browser code search + ArrowDown/Enter exercised |
| STF-11 | Automatic confirmation/ID/cancel-reason workflow | Supported explicit-ID/admission recovery improved; automatic/policy portions remain gated |
| STF-13 | Unified find/create/automatic-admit walk-in | Existing separate register → select → explicit admit works; unified/automatic policy remains gated |
| GEN-09 | Fewer meaningful workflow actions | Confirm arrival → exact Visit/queue evidence is immediate; no navigation/reload needed to learn identities. After reload, Check-In → Review arrival receipt uses 2 actions. Whole benchmark/closure remains unverified |

No attribution to candidate DEN/STF IDs without matching criteria. AUD-10 is separate: batch 01 remains accepted on its private target; this batch does not rebuild or activate it elsewhere.

## API / persistence / file scope

Contract: [Arrival recovery API v1](contracts/ARRIVAL_RECOVERY_API_V1.md). New GET Visit arrival receipt; additive check-in `id_confirmed`; additive verify-ID response `patient_id`. No migrations, schema changes, held-migration modifications or new workforce authority.

Backend: `VisitController`, `CheckInVisitRequest`, `VisitService`, one Visit route; `IntakeController`, `IntakeService`. Frontend: `arrival-command.js`, `ArrivalRecovery.jsx`, `PatientFlow.jsx`, `appointment-flow.js`, `visits-api.js`, `api-client.js`, shared `CounterIntake.jsx` ID checker. Tests: arrival/ID feature tests, real contention workers, command/receipt Node tests, resumable actual-browser driver. Local runner adds a guarded arrival-contention lane and refusal test. Common-file integration overlap: `backend/routes/api.php`, `src/api-client.js`, `src/appointment-flow.js`; no App/layout/store or workforce edits.

## Focused verification

Only Jaztin-owned loopback PostgreSQL target with `dental_clinic_demo` and `dental_clinic_test`, manifest identity/permissions/cluster verified. Four held migrations excluded; no production/real Patient/payment/HMO/message operations. Private credentials, fixtures, screenshots and dumps stay outside Git.

* `python3 scripts/local-system.py --target <owned target> --profile test test tests/Feature/Visits/ArrivalRecoveryTest.php tests/Feature/Visits/VisitTest.php tests/Feature/Visits/Stf12WalkInAcceptanceTest.php tests/Feature/Intake/IdVerificationAtomicityTest.php`: **39 tests / 329 assertions passed**.
* Filtered existing Intake `verify_id|confirm_intake_validates`: **4 tests / 34 assertions passed**.
* `python3 scripts/local-system.py arrival-concurrency --target <fresh clone target> --profile test`: **1 test, five real two-worker PostgreSQL contention scenarios, 1,301 assertions passed**. Distinct Staff/key and same-key scheduled/walk-in races, plus scheduled-versus-walk-in for one Patient. Each verifies real lock waits, one Visit/queue/history/journal and safe replay. Clone remains separate from browser fixture.
* `node --test tests/arrival-command.test.js tests/id-verification-receipt.test.js tests/gen07-counter-id-clear.test.js tests/gen09-checkin-navigation.test.js tests/stf11-checkin-cancel.test.js tests/b2-staff-ui.test.js tests/m6-cutover.test.js tests/m5-treatment-cutover.test.js`: **128 passed**.
* `python3 -m unittest discover -s scripts/tests -v`: **15 passed**. Final runner-only module check: **10 passed**. Existing Python resource warnings about runner lock handles remain; worker launch refusal is verified.
* `DENTALOPS_LOCAL_TARGET=<owned manifest> LOCAL_SYSTEM_EVIDENCE=<private directory> PLAYWRIGHT_MODULE=<installed module> node tests/local-arrival.browser.mjs`: **10 unique actual Chromium/React/Laravel/PostgreSQL acceptance groups**, collected across resumable runs: explicit ID refusal; Other-ID validation and committed-loss readback; scheduled Visit/appointment/Waiting linkage; new authenticated Staff session; Patient isolation/assigned Dentist visibility; separate registration and walk-in committed-loss reload recovery; real same-body/key keyboard walk-in retry; actual ID timestamp reload; STF-04 directly on Patient summary; six widths (375/390/430/768/1024/1440) without horizontal overflow. Driver resumes exact committed fixture state; test-locator errors were corrected without duplicate admission. Screenshots/evidence are private.
* `npm run test:smoke` and `npm run build`: passed. Existing React list-key warnings and >500 kB bundle warning remain. No full-system regression rerun in Phase 1.
* `git diff --check` and changed/new-file secret scan passed. No migration/App/layout/activation-config changes. The separate contention database was backed up and stopped after acceptance; the private demo remains available for review.

Narrow related regression revealed **six existing queued-mail Intake assertions** (OTP/guardian cases). Running those exact cases with baseline `b4b2a19` IntakeService reproduced all six failures. They are baseline/profile failures, not passing checks; no email delivery behavior/test was weakened. Historical OWN-11 was not rerun or claimed fixed.

Predefense (local-only external checks omitted) reports **6 FAIL / 6 WARN**: queue worker down; scheduler down; only four synthetic Patients; no unpaid invoice; deliberately synthetic branch contact/hours placeholder; seven aged unsent local-outbox messages. The last is an additional elapsed-time consequence of deliberately stopped delivery. These are fixture/operations prerequisites, not broad acceptance. Do not start real delivery or fabricate clinic details to make this gate green. Warnings include absent branch emails, no active assistant answers, waiting jobs/mail, and omitted external checks.

## Remaining / next

No full-system, integrated-target, production or official WCAG acceptance claimed. GEN-09 remains partial; broader STF-11/13 policy decisions remain unresolved. Preserve separate registration, explicit Staff admission and all existing ID/HMO restrictions until those policies are approved. Next owned work: source-supported queue → encounter context/navigation and Patient appointment recovery criteria, then remaining clinical record/receipt usability defects with exact reproductions. Integrate only in the later authorized phase; preserve Joevan's duty projection authority.

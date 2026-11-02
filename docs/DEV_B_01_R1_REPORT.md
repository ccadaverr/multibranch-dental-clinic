# DEV-B-01-R1 — targeted corrections

Date: 2026-11-01, Asia/Manila. Local implementation only; integration approval is not requested or claimed.

## A. Starting repository state

Branch `integration/developer-a-b`, HEAD `2b9c891b0195198c970169fc6b752cdc038176b0`. Nothing staged. Starting inventory:

```text
 M backend/app/Services/Automations/AttendancePolicy.php
 M src/landing.css
 M src/pages/PublicSite.jsx
 M src/patient/Portal.jsx
 M src/patient/format.js
 M src/patient/pages/Account.jsx
 M src/patient/pages/Archives.jsx
 M src/patient/pages/Book.jsx
 M src/patient/pages/Home.jsx
 M src/patient/pages/Visits.jsx
 M src/patient/portal.css
 M tests/m23-archives.test.js
 M tests/public-auth-site.test.js
 M tests/staffing.test.js
?? docs/DEV01_IMPLEMENTATION_REPORT.md
?? src/patient/visit-history.js
?? tests/dev01-active-patient.test.js
```

The earlier DEV-01 report remains unchanged as a historical report. The R1 changes below supersede its booking/payment initiation and eager-history descriptions.

## B. Corrections and exact R1 files

- `src/patient/pages/Book.jsx`: city controls including All remain available after granted/denied location lookup. Branch changes still clear date/slot. Prefill and manual selection share the same service resolver, including Active/hidden/consultation eligibility. Unavailable prefills produce an explanation without inventing another service.
- `src/patient/booking-flow.js` (new): shared service resolution, server-status feedback, and booking-attempt coordinator. BookPage owns the coordinator above the keyed Review subtree. The synchronous in-flight promise blocks duplicate commands through Back/Review remounts. Equal payloads reuse their key; known failed intents can be changed with a new key. Successful intents are cached rather than resubmitted. Ambiguous network failures preserve and lock the intent until same-key retry resolves it; Return to Review and My visits remain reachable. This is not durable cross-reload or cross-device draft recovery.
- `Book.jsx` feedback: Confirmed, held payment verification, front-desk Pending and terminal/unknown records have different headings, copy, icons and toast tones. HTTP/validation failure remains an alert and keeps the form. Creation is not evidence of payment. The submitted patient and display details are captured before awaiting the response, and selections are frozen during an in-flight request. Payment choice survives Review remounts.
- **Online initiation is deliberately unavailable in this checkout.** There is no verified pre-booking capability/fee quote. No online request is sent and no payment method is automatically switched. Pay at clinic requires an explicit selection and sends the existing `pay_at_clinic: true` contract. Existing records/payments are untouched. A server-issued held booking is displayed as pending; any returned checkout link is an optional continuation for that record, never an automatic redirect or proof of settlement.
- `src/patient/pages/Home.jsx`: active-status queries replace all-history loading. Home stops a status search once its first relevant ascending page arrives; no completed/cancelled history is required to show the next visit. Empty copy does not infer that the person has never visited.
- `src/patient/visit-history.js`: status-filtered active reads use the current API's pagination and impose no invented future horizon. Visits consumes every active page; Home can stop early. Full appointment pagination and treatment cursor pagination remain available for history. Failures are returned honestly.
- `src/patient/pages/Visits.jsx`: upcoming records load independently of full history. Full appointment history starts on a historical filter; treatment history starts on History. Date-only merging remains removed. Historical appointment links fall back to History and scroll after the actual data arrives. Existing cancellation/rescheduling commands and scopes remain unchanged.
- `src/pages/PublicSite.jsx`: narrow payment-copy corrections to avoid advertising currently unavailable online booking initiation. Online payment for issued invoices remains a separate existing Billing capability.
- `tests/dev01-active-patient.test.js`: adapt the existing SSR fixture to the separate active/history loaders; keep its seven regressions.
- `tests/dev-b-01-r1.test.js` (new): eight behavior tests for shared service rules, feedback, duplicate/remount consumers, retries and intent replacement, ambiguous transport results, independent active reads and historical pagination failures.
- `tests/dev-b-01-r1.browser.js` (new): repeatable Playwright-tool fixture script exercising the actual active Book component and existing calendar/time components, with all API/CSRF calls intercepted.
- `tests/interview-r2.test.js`: replace one obsolete assertion about the inline consultation implementation with the shared-resolver call plus real resolution/failure assertions. Other assertions remain.
- This report is the only new documentation file for R1.

## C. Regression execution

Final commands:

```powershell
node --test tests/dev-b-01-r1.test.js tests/dev01-active-patient.test.js tests/patient-portal.test.js tests/landing.test.js tests/patient-booking-ux2.test.js tests/interview-r2.test.js
npm.cmd test
npm.cmd run test:smoke
npm.cmd run build
git diff --check
```

Results:

- Targeted: **65 passed, 0 failed, 0 skipped**.
- Full frontend: **998 passed, 0 failed, 5 skipped; 1003 total**.
- Render smoke: **PASS**, existing Table key warning remains.
- Production build: **PASS**, existing >500 kB chunk warning remains.
- Diff check: **PASS**.
- Initial targeted sandbox execution: eight utility tests passed, three esbuild-based test files could not start because directory access was denied. Escalated runs passed. An initial full run also found the obsolete inline consultation assertion; it was corrected as described above, and the final suite passed.
- Existing five skips: A12 real production shell responsive/keyboard/scrolling/pending/failure/logout; B8 rendered integrated acceptance at 1440px and 390px; B9 rendered queue acceptance at 1440px and 390px. They require their respective optional Playwright module environment settings (and B9 fixture preparation). R1's browser script was executed separately, not counted in the Node pass count.

Playwright tool execution of `tests/dev-b-01-r1.browser.js` passed at **390x900 and 1440x900**, using a patient-shell-sized fixture containing the actual Book component:

1. City selection → granted location → All restores both eligible branches.
2. City selection → denied location → All restores both eligible branches.
3. Dependent selection survives lookup; changing branch clears date/time.
4. Direct/consultation prefill reaches the right branch flow; hidden/missing prefill produces an alert.
5. No default payment selection; no online booking submission. Explicit cash/dependent/automatic-assignment payload checked.
6. Two synchronous confirmation clicks and Back/Review remount produce one in-flight POST.
7. Stale-slot 422 stays visible; same-intent retry reuses its key; changing time uses a different key.
8. Keyboard Enter on Change time works; Pending never produces a success toast.
9. Confirmed, held payment and expired-record feedback verified; no fixture horizontal overflow at either width.

All booking mutations were intercepted fixtures. No live patient/payment changes occurred. These checks do not prove live authentication, backend assignment/concurrency, real payments or full portal-route acceptance. Utility tests separately cover inactive/missing-consultation resolution and ambiguous-network replay.

`bash scripts/predefense-check.sh` was attempted: sandbox Bash access denied; escalated retry failed before Laravel at line 8, `pipefail\r: invalid option name`. Script line endings were not changed. No application-level predefense pass is claimed. No backend tests, migrations, seeders or reset commands ran.

## D. Developer A dependencies

No unintegrated backend fields or endpoints were assumed. Current verified request is branch/service/date/start time, optional dependent, omitted dentist for automatic assignment, explicit pay-at-clinic, and Idempotency-Key.

Joevan's reviewed integration needs to establish:

- An authenticated pre-booking quote/capability response for the exact patient/dependent, branch, service and schedule: online enabled/disabled with a safe reason; authoritative fee/currency and validity; supported payment choices and hold duration. This is required information, not a proposed endpoint implemented here.
- Explicit online intent that fails without creating an unpaid fallback; exact refusal codes and whether an appointment exists after each refusal. No silent cash substitution.
- Final appointment/payment status vocabulary, checkout URL availability, hold expiry, paid-but-front-desk-Pending behavior and authoritative status refresh. Creation, redirects and settlement remain distinct.
- Stable idempotency/replay behavior for identical intent, changed intent, transport ambiguity and provider failures. Current IdempotentCommand rolls back failed commands and rejects key reuse with a different payload; R1 follows that inspected behavior.
- Automatic dentist assignment and slot revalidation for eligibility, schedules/leave, branch, overlap and concurrent requests. Frontend availability still comes from the existing server calendar/availability endpoints.
- Dependent-aware availability: current searches use the guardian patient while creation can use a dependent. Runtime correctness remains a backend gate.
- Appointment status-filter pagination/order and treatment cursor/ownership behavior; any reviewed changes to the intentionally restricted treatment projection.
- Booking payment credit/refund-pending representation, confirmed refund policy versus late-cancellation settings, and retry/reconciliation when a refund fails. No refund promise is introduced here.
- Authorized verification/correction of public FAQ and closures. The original reported inappropriate content has not been accepted as corrected.

## E. Shared-file warning

`backend/app/Services/Automations/AttendancePolicy.php` was **not edited, reverted, replaced or reconciled** in R1. Its pre-existing DEV-01 diff replaces:

> need the front desk to confirm them. There are no fees.

with:

> need the front desk to confirm them. Booking payments and refund eligibility are handled separately.

Starting and ending SHA-256:

```text
0a8c4db9971aedafd3fdd221c799b53dd3919a316ed393462143acd1fdbe9fff
```

Reconciliation with Developer A's version remains a separate integration task. No other backend source was modified.

## F. Remaining blockers

Corrected: city/geolocation discoverability, consultation prefill, misleading Pending toast, Review-local request/key ownership, critical Home dependence on completed history, and eager Visits history loading.

Still blocked/unverified: online initiation until quote/capability and explicit-intent contracts are reviewed; Developer A's unintegrated backend corrections; authenticated/dependent end-to-end acceptance; real payment/hold/refund behavior; backend test isolation; predefense shell compatibility; public FAQ/closure content clearance. Existing records history and authorized routes remain available. No integration readiness or full redesign completion is claimed.

## G. Final repository state

15 tracked files modified in total (original 14 plus `tests/interview-r2.test.js`). Seven untracked source/test/report files:

```text
?? docs/DEV01_IMPLEMENTATION_REPORT.md
?? docs/DEV_B_01_R1_REPORT.md
?? src/patient/booking-flow.js
?? src/patient/visit-history.js
?? tests/dev-b-01-r1.browser.js
?? tests/dev-b-01-r1.test.js
?? tests/dev01-active-patient.test.js
```

The tracked inventory is the starting list plus `tests/interview-r2.test.js`. Nothing staged; branch and HEAD unchanged. Generated Playwright logs/snapshots were moved from the initially absent `.playwright-mcp` directory to the local temporary directory `dev-b-01-r1-playwright`. No pre-existing work was discarded. No environment, database, approved asset or unrelated backend changes; no commit, merge, push, reset, rebase or integration operation.

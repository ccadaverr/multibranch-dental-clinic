# Jaztin clinical implementation Batch 05 — 2026-11-16 Asia/Manila

Phase 1 original-QA implementation. Started from published `2a4df2305dfa524262ab39773310e06f0405fced`, descendant of collaboration baseline `a0725e645df6f8266c2bc4bebacc9d62dd18e7c1`. Worktree `/private/tmp/dentalops-jaztin-qa-20261115`, branch `feature/jaztin-qa-20261115`. The work crossed midnight Manila; earlier report filenames retain November 15. Draft PR #9 remains the publication target, unmerged. No integration/deployment or global redesign.

## Implemented workflows

1. **Dentist chart documentation and recovery.** Existing append-only chart was serialized per tooth but lacked observed-revision and command-key protection; a lost response could append twice, and concurrent stale editors could silently supersede findings. The new UI uses exact Patient/FDI tooth revision and immutable idempotent intent, preserves linked Treatment's original revision/Visit/branch, and accepts only the exact saved receipt/history. PostgreSQL CAS, existing journal uniqueness, linked Visit/Treatment locks, audit and append are transactional. Same-key retry returns the original entry; distinct contenders get a conflict. No revision substitution, replacement of prior findings, treatment completion, or modification of finalized care. Historical chart appends remain separate from protected encounter documentation. Capability guard leaves older targets read-only in this editor. Legacy unkeyed backend clients remain compatible and do not gain the keyed/CAS guarantee.
2. **Clinical history and safe chart reads.** Dentist history now shows actual documentation timestamp, branch and exact encounter/Visit references alongside the original clinical date. Encounter return context is retained, including walk-ins without appointments. Staff still has read-only chart without Dentist notes; Patient only the permitted current projection. Recovery automatically reads the current chart after verifying the original receipt; a later revision or failed current read requires review without rebasing the original editor. Both chart screens reject mismatched Patient reads and suppress obsolete requests. My teeth now has bounded loading, exact signed-in Patient validation, safe retry/refresh and truthful empty/error states, rather than adopting arbitrary successful data.
3. **Patient appointment → receipt navigation.** The actual Patient portal discarded receipt identity and offered no direct appointment-to-billing action. Eligible existing appointment cards now open exact authorized billing context. A single confirmed matching receipt opens details immediately; Return to appointment preserves that resource. General Billing retains real walk-in Visit context and never invents an appointment. New-session list readback, pagination/refresh request generations, explicit failure/retry and invoice/Patient/receipt PDF-header checks preserve resource ownership. `Paid` without matching monetary/payment/receipt proof is unverified. Reads/downloads never settle a bill. Existing payment and email-resend controls are preserved, not invoked during read-only browser acceptance.

No new clinical notation/status, diagnosis, procedure category, sign-off, correction/handover, cancellation or automatic admission policy. No payment engine, receipt renderer or prescription rebuild. No new schema; all four held migrations and history triggers remain unchanged.

## Original criteria and status

Source: [FINALS-QA-REVISIONS.md](../FINALS-QA-REVISIONS.md), YZH-2 / lines 638–689; routing only in [TEAM_QA_WORKFLOW_20261115.md](TEAM_QA_WORKFLOW_20261115.md). Existing source `done` labels are historical and are not substituted for current acceptance.

| ID | Actual criterion | This batch's evidence / status |
|---|---|---|
| STF-03 | Teeth never move on interaction/data load, shared chart | Fixed SVG anchors/transforms retained; actual Staff Patient record and Dentist chart keyboard/select/hover/readback, six widths, motion checks. **Locally acceptance-ready; integrated acceptance deferred.** Saved feedback now follows the diagram so confirming a finding does not shift its document coordinates; no chart-layout rewrite. |
| DEN-04 | Same stability fix in Dentist chart | Actual Dentist chart through saved clinical response and view toggles, fixed coordinates; scope as above. **Locally acceptance-ready.** |
| STF-05 | Overall findings grouped by condition/treatment; chips select tooth; per-Patient aggregation | Existing aggregation/summary retained; current findings + history have exact Patient identity; real Staff/Dentist summary selects persisted tooth; PostgreSQL precedence/summary/redaction checks retained. **Locally acceptance-ready; integration deferred.** No new treatment categories invented. |
| DEN-05 | Top/occlusal toggle; selection/findings synchronized; Dentist records there | Actual top-view keyboard recording linked to walk-in encounter, commit/lost response/same-key retry, front/top selection/readback, six widths. **Locally acceptance-ready.** |
| GEN-09 | Count/reduce common clinical interaction paths | Completed appointment → expanded exact receipt was formerly Billing navigation + find invoice + View details (at least 3 actions; list search varies). Direct Invoice and receipt is **1 action**, zero additional detail-opening actions for one verified match. Actual keyboard browser evidence. **Partial**: no complete original benchmark/time study or all-flow acceptance. |

Chart CAS/recovery, My teeth identity checks and receipt navigation also address reproducible source defects and the explicit Batch 05 requirements; they are not extra original QA IDs. No unrelated STF-18 closure or 68-QA completion count is claimed. Prior accepted GEN-07/DEN-10, follow-up, admission, encounter, profile and financial lifecycles are preserved.

## API / persistence

See implemented [chart recording v1](contracts/CHART_RECORDING_API_V1.md) and [Patient receipt navigation v1](contracts/PATIENT_RECEIPT_NAVIGATION_API_V1.md).

Existing chart routes gain Dentist-only v1 capability/revision metadata and chart POST `expected_revision`, paired linked `expected_treatment_revision` and `Idempotency-Key`. Receipt includes exact entry/Patient/tooth/result revision/branch/Dentist/Treatment/Visit. Tooth revision counts immutable entries; no column/backfill. Audit deliberately excludes finding status/note. Historical encounter/procedure/Visit snapshots are unchanged by append. Existing role/Patient/handover read grants remain; new linked writes also verify the current assigned branch, with no new handover policy.

Existing Patient `GET /api/invoices/mine` gains optional exact appointment filtering under own/guardian scope; InvoiceResource adds actual appointment/source/clinic-date. Existing PDF routes add exact invoice/Patient/receipt headers. CORS only exposes these response headers plus filename, preserving audit-export headers and origin/method policy. Existing payment/receipt uniqueness, amount checks, histories and command semantics are untouched.

No route/App/layout/middleware/workforce edits. Shared-file overlap: `src/api-client.js`, narrow Patient `src/patient/Portal.jsx`, `backend/config/cors.php`, local development runner. Later integration must preserve Joevan's independent changes; no competing roster projection or integration has begun.

## Focused verification

Verified private manifest `/private/tmp/jaztin-clinical-20261115c/target.json`, loopback PostgreSQL 55493; demo/test databases only. All 83 reviewed migrations remain; four held migrations excluded. Disposable contention target `/private/tmp/contention-2cd42147/target.json` was backed up and stopped. Credentials, synthetic state, PDF, screenshots and dumps remain private/outside Git. The receipt fixture creates only explicitly labelled synthetic provider/price prerequisites; browser setup uses existing authorized commands for a new synthetic walk-in's explicit treatment completion and Cash receipt. It never completes the unrelated existing active encounter or changes its documentation.

* `python3 scripts/local-system.py --target <owned target> --profile test test tests/Feature/Charts/ChartCommandRecoveryTest.php tests/Feature/Charts/DentalChartTest.php tests/Feature/Charts/ChartBe01AuditAtomicityTest.php tests/Feature/Billing/PatientReceiptNavigationTest.php`: **29 passed / 388 assertions**. After adding the finalized-history invariant, chart recovery-only run: **8 passed / 83 assertions** (overlaps prior 7; do not sum as 37 distinct tests). Covers exact linkage, stale revision, invalid Patient/branch, role/revocation, same-command/new-auth, history preservation, audit rollback, unpaid state, walk-in null appointment, foreign Patient/PDF denial, exact PDF headers/bytes and no financial mutation on read.
* `python3 scripts/local-system.py --target <fresh clone> --profile test chart-concurrency`: **1 passed / 579 assertions, three actual two-worker PostgreSQL contention scenarios**. Same tooth / distinct authorized Dentists: one entry, one journal/audit and one conflict. Same account/key: one immutable entry and identical responses. Independent teeth: both commit. Workers demonstrably block on PostgreSQL locks; no mocked race.
* `node --test tests/chart-command.test.js tests/patient-invoice-readback.test.js tests/m10-dental-chart.test.js tests/m10-odontogram-motion.test.js tests/billing-ui.test.js tests/billing-command.test.js tests/billing-pdf-identity.test.js tests/api-client.test.js`: **47 passed**. `node --test tests/patient-portal.test.js tests/den-ui-02.test.js`: **29 passed**. Includes capability, receipt identity, frozen key/revision, uncertain vs refused, duplicate dispatch, obsolete auth/CSRF ownership, simplified Patient projection, PDF identity and old payment-command behavior.
* `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests`: **18 passed**, including refusal of chart races on the regular target. Existing lock-handle ResourceWarnings remain.
* Actual React/Laravel/PostgreSQL scripts `tests/local-chart.browser.mjs`, `local-chart-readback.browser.mjs`, `local-receipt-navigation.browser.mjs`: **14 unique acceptance groups passed** across resumable runs. Evidence under owned runtime `chart-browser-batch05` / final / intervening runs, `chart-readback-browser-batch05`, `receipt-browser-batch05`. Covers committed lost response + keyboard original retry, an intervening committed finding between lost response and retry (fresh current read, explicit review without revision substitution), second session conflict/draft review, Staff/Patient redaction, foreign-payload refusal/Retry, delayed response suppression, new authenticated sessions, appointment/receipt return, actual authorized PDF, walk-in without appointment, failed list load and **zero financial writes during navigation**. All required widths: **375, 390, 430, 768, 1024, 1440**; keyboard/focus and page-overflow checks, not WCAG certification.
* Existing encounter/chart fixture browser regression also passes four width journeys (390/768/1024/1440) with zero page errors; its chart mock now identifies the actual requested Patient and includes the real summary shape. Final chart/motion Node rerun: **11 passed**. Smoke and production build pass. Existing React list-key and >500 kB chunk warnings remain. **Final diff, changed-PHP syntax and 31-file secret scan pass; all migration sources are unchanged.** Comprehensive system suites and hosted/predefense checks remain deferred by Phase 1 scope.

### Failures and limits

The exploratory combined 36-test chart/billing-document run had **3 failures**, all existing receipt-resend assertions expecting 200 but receiving 502 mail transport errors. A targeted rerun loading the starting HEAD's unmodified BillingDocumentController under the same verified test profile reproduces **all 3** (3 tests / 18 assertions / 3 failures). This is a scoped baseline-controller/environment comparison, not a full clean-baseline system run. No resend/transport logic or test expectation was changed to hide the failures. The PDF/authorization tests in that group passed. The initial new stale-account test incorrectly tried to preserve an old Sanctum actor across middleware refresh; it was corrected to assert actual persisted account suspension/revocation, retaining 403 and no-extra-entry assertions. Browser-driver fixes used actual accessible labels, mobile More navigation and SVG coordinate anchors rather than page position/bounds that legitimately include highlighting/feedback.

Historical six Intake queued-mail assertions and OWN-11 remain unaccepted and were not rerun or claimed fixed. Earlier predefense reported five initial prerequisites, then six after aged outbox accumulated: worker down; scheduler down; synthetic Patient count below rehearsal; absent unpaid fixture; deliberately synthetic contact/hours; aged unsent local outbox. These are operational/fixture gates, not chart/receipt acceptance. Today's Patient count/receipt setup is different and was not used to declare any prerequisite passing. No delivery worker, external provider, HMO or real Patient communications were enabled.

## Remaining / next

Original-QA local evidence in this batch is ready for feature-branch review; full original closure and integrated/hosted acceptance are deferred. AUD-10 other-target activation stays disabled pending its existing true capability/integration gates. Existing automatic admission, cancellation and broader profile/handover policy decisions remain unresolved; no new policy is invented.

Next owned work: source-supported Patient historical-record/navigation and remaining Dentist clinical criteria; retain prescription/financial safeguards and inspect actual residual defects before changing them. No operations/workforce or notification changes. Full GEN-09 requires its broader benchmark. Exact GEN-06/DEN-03 reproduction evidence remains unavailable. Integration begins only after the implementation-phase decision, not by merging PR #9 now.

## Changed-file inventory

* `backend/app/Http/Controllers/BillingController.php`
* `backend/app/Http/Controllers/BillingDocumentController.php`
* `backend/app/Http/Controllers/DentalChartController.php`
* `backend/app/Http/Resources/InvoiceResource.php`
* `backend/config/cors.php`
* `backend/tests/Feature/Billing/PatientReceiptNavigationTest.php`
* `backend/tests/Feature/Charts/ChartCommandContentionTest.php`
* `backend/tests/Feature/Charts/ChartCommandRecoveryTest.php`
* `backend/tests/Support/chart_worker.php`
* `backend/tests/Support/local_receipt_fixture.php`
* `docs/JAZTIN_CLINICAL_BATCH05_20261116.md`
* `docs/contracts/CHART_RECORDING_API_V1.md`
* `docs/contracts/PATIENT_RECEIPT_NAVIGATION_API_V1.md`
* `scripts/local-system.py`
* `scripts/tests/test_local_system.py`
* `src/api-client.js`
* `src/chart-command.js`
* `src/components/odontogram/ToothTimeline.jsx`
* `src/pages/DentalChart.jsx`
* `src/patient/Portal.jsx`
* `src/patient/invoice-readback.js`
* `src/patient/pages/Billing.jsx`
* `src/patient/pages/Teeth.jsx`
* `src/patient/pages/Visits.jsx`
* `tests/billing-pdf-identity.test.js`
* `tests/chart-command.test.js`
* `tests/den-ui-02.browser.mjs`
* `tests/local-chart-readback.browser.mjs`
* `tests/local-chart.browser.mjs`
* `tests/local-receipt-navigation.browser.mjs`
* `tests/patient-invoice-readback.test.js`

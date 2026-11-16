# Codex B coordination for Owner reporting, audit and archives

Started from `63a8832d59105b1ef3c209fc0e84f0401b0ac43e` on `feature/joevan-qa-20261115`. Codex A owns Git and shared files. This batch makes no new claim on workforce, personnel, clinical records or Patient access.

## Original QA claims and implementation queue

| ID | Original acceptance in FINALS-QA-REVISIONS.md | Scope and disposition |
| --- | --- | --- |
| OWN-01 | Both charts hoverable; values match billing data to the peso; histogram appears on Saturdays. | Batch 11 charts retained. Fix historical weekly report finalization after the Manila day changes, and preserve requested period/branch in Owner operational CSV transport. Uses the established server aggregates. |
| GEN-11 | No record is permanently deleted by normal users; each role sees only permitted archives; Dr Dana sees all. | Implement the supported exact-record Owner history subset. Audit inspection can narrow to that record type and exact public ID across pages and CSV. Null branch events are labelled accurately. The bounded appointments archive labels a reached page limit and its CSV accordingly. Universal private/clinical archive access and unspecified lifecycle actions remain policy-blocked. |
| GEN-02 | "X" appears everywhere clear-filter existed; clicking resets filters; no text "Clear filters" remains. | The existing global audit reset includes the new record filter. The record filter also has its own clear button and retains the other filters. No new systemwide acceptance claim. |
| GEN-10 | Notifications grouped under date headers; each can be removed (archived); button looks consistent and outline-free. | Existing recipient-only functionality retained. The audit test exercises the existing archive, exact receipt and operational metadata paths. No change to personal notification behavior. |

## Owned paths

- `backend/app/Http/Controllers/AuditController.php`
- `backend/tests/Feature/Audit/OperationalArchiveActivityTest.php`
- `src/pages/AuditTrail.jsx`, `src/audit-api.js`, `src/pages/ArchivesPage.jsx`
- `src/pages/OwnerRevenueCharts.jsx`, `src/analytics-api.js`
- `tests/audit-api.test.js`, `tests/aud03-archive-feedback.test.js`, `tests/owner-analytics-rendered.mjs`
- New `tests/owner-report-export.test.js`, `tests/owner-audit-record.browser.mjs`, `tests/fixtures/owner-audit-record.html`
- This coordination file

No A-owned files or sections edited.

## Contracts

- Existing Owner-only `GET /api/audit-logs` and `GET /api/audit-logs/export` accept paired `target_type` (max 100) and `target_id` (max 50). Sending only one is 422. Equality compares the existing immutable `auditable_type` and `auditable_public_id` columns. It combines with branch/action/search/date filters before paging, cursor lookup and CSV limits. Unknown or out-of-filter cursor still returns an empty page. Existing detail route, response schema, role gate, audit row storage and private notification scope are preserved. Inspection uses the already-sanitized audit row and opens no underlying resource.
- Existing Owner `GET /api/analytics/export` uses the same base URL resolution as report reads, sends the chosen branch and period (including the supported `all` alias), verifies CSV content type before downloading and uses a Manila date in the filename. Audit export uses the same transport rules and preserves exact string values such as search text `all`. The historical weekly resource reloads on a reporting-day change to pick up server finalization.
- Existing archive appointment projection is bounded. The reached-limit notice and export label describe the loaded scope. No full historical appointment collection API, restore, retention interval or permanent deletion introduced.
- Schema and migrations: none. No route, CORS, environment or shared configuration changes required for the implemented paths.

## Shared-file request for Codex A

Separate follow-up in the AnalyticsPage section of `src/pages/Admin.jsx`, a file shared with A's personnel work. `exportServerCsv` currently forwards a null branch when a named selected branch fails to resolve. The existing `GET /api/analytics/export` interprets a null or omitted branch as All Branches. Export should require a live Owner session and either the explicit "All Branches" selection or a resolved branch ID. Guard both handlers/buttons, then use the same request-context check before completing a pending download or showing success after an account/branch/period change. No route or permission expansion needed. Verify unresolved branch produces zero network requests. This call-site defect is separate from the completed CSV transport correction.

## Verification

- Node focused Owner/Audit/Archive regressions: 45 passed. The opt-in archive browser cases ran separately and passed.
- Laravel PostgreSQL dedicated to B: `dentalops-codex-b-20261116`, its own source/private volumes and `/private/audit-b-full/target.json` on container loopback 55517, no published DB port. Uses `dental_clinic_test` only, 87 reviewed migrations and four preserved holds. Operational archive activity/scope, audit queries and notification archives: 15 passed, 218 assertions. AnalyticsComparisonTest and OwnerDashboardEvidenceTest: 14 passed, 225 assertions. A's source volume was mounted read-only to copy the existing vendor tree only. No shared DB or environment/cache changes.
- The earlier archive-only profile exposed an existing roster notice fixture dependency on the publication extension. The full isolated profile resolves it. The legacy analytics automation-health integration test returned 404 for its existing setup endpoint in the initial broader run. No change was made to that endpoint.
- Headless Chrome synthetic Owner exact-record filter, keyboard activation, CSV and clear at 390px and 1440px passed. Private Vite cache on port 5197. Owner revenue browser checks passed at 390px and 1440px, including the Manila rollover, and archive browser checks passed for role/scope changes, detail invalidation and CSV.
- PHP lint and diff whitespace check passed. Render smoke and production build passed. The build used a unique temp output directory and the existing OCR hook found all assets already present. Existing React Table key and bundle-size warnings remain. The concurrent protocol deferred the full suites and deployed predefense check to combined acceptance.

## Git handoff

READY FOR CODEX A COMMIT. Stage only the owned paths above. The separate mixed-file AnalyticsPage request and GEN-11 policy gaps remain open. Codex B performed read-only Git operations.

## Round 2 from d9663e8

Round 1 was committed as fe8c7d8. The A-owned dispatch guard was committed as d9663e8. The isolated CSV helper is **READY - isolated helper complete, awaits A UI wiring**. New files: `src/clinic-csv.js`, `tests/clinic-csv-transport.test.js`. Updated adapters and regression: `src/analytics-api.js`, `src/audit-api.js`, `tests/owner-report-export.test.js`. Reserve AuditTrail and the dedicated audit controller/tests for independent work below. No A-owned files edited.

### OWN-01 reporting and GEN-11 audit CSV contract

Import `requestAnalyticsCsv` and `saveClinicCsv` from `src/analytics-api.js`. Call `requestAnalyticsCsv({ branch_id, period, date_from?, date_to? }, { signal })` with an explicit resolved public/legacy branch ID or the literal `'all'` for an explicit All Branches selection, and the current nonblank report period. The optional dates use the existing analytics route contract. A missing named branch must be rejected before requesting. The isolated requester refuses absent/blank branch or period. Audit consumers can use `requestAuditLogsCsv(filters, { signal })` from `src/audit-api.js`; paired exact `target_type` and `target_id` and existing date/branch/search semantics are retained.

Both requesters use the established API base and authenticated GET, refuse redirects, perform no retry, and resolve `{ blob, filename, truncated, limit }` without downloading. Filename uses a safe server attachment name when visible, or the Manila-dated fallback. HTTP failures throw an Error with numeric `status` and a safe message. Error and non-CSV bodies are excluded from payloads. Abort checks run before fetch, after headers, and after the body read. Caller abort reasons and fetch/body AbortError or TimeoutError propagate. A stale call must still fail the UI request identity check, including filter A-to-B-to-A and account/session changes.

In A-owned AnalyticsPage, keep the existing owner and resolved-branch guards. Allocate an AbortController per accepted export and cancel it on branch/period/actor change or unmount. Use a unique export identity and controller for cleanup and completion. A superseded request must not lock the next request or clear that request's busy state. Example inside the existing ownership lifecycle:

```js
const result = await requestAnalyticsCsv({
  branch_id: activeBranch === 'All Branches' ? 'all' : activeBranchId,
  period: period.toLowerCase(),
}, { signal: controller.signal })
if (!ownsRequest() || controller.signal.aborted) return
saveClinicCsv(result)
toast('Operational analytics CSV exported successfully.', 'success')
```

Call `saveClinicCsv` only after the current-request check above. Send error feedback only for the current request. The compatibility `downloadAnalyticsCsv(params, isCurrent)` honors the callback immediately before saving and returns false when superseded, so the already committed call-site can safely run before cancellable UI wiring. For this adapter only, explicit null is its old All Branches sentinel. A should test cancellation through the real request/save split using a delayed response and an immediate replacement export.

Focused Node tests: `node --test tests/clinic-csv-transport.test.js tests/owner-report-export.test.js tests/audit-api.test.js` (17 passed). Cases cover authenticated origin and scope, exact record pairs, status failures, HTML instead of CSV, safe metadata, pre-abort, late headers and body, abort-like errors, no automatic save, and independent requests. Combined A UI acceptance is pending.

### Independent audit completion

- GEN-11 original acceptance: "No record is permanently deleted by normal users; each role sees only permitted archives; Dr Dana sees all." The authorized history subset now orders both list and CSV by stored event time, then internal ID for equal instants. The existing public-ID cursor resolves inside the same filters and advances by the timestamp/ID tuple. CSV and list agree even if insert sequence differs from event time. The regression reproduced the old ordering failure on real PostgreSQL before the controller edit. Existing date bounds, exact record matching, Owner-only routes, append-only schema and export limits remain in force.
- GEN-13 original acceptance: "No text refresh buttons remain; icon triggers refresh with visible loading state." Audit Trail could previously reload a successful result only by changing filters or reopening the page. It now uses the existing keyboard-operable refresh icon and spinner to reload the current filter set.
- Audit Trail releases a prepared CSV only after the existing `GET /api/me` confirms the same public ID, Active status and Owner role, followed by a request-identity check. The export uses a unique AbortController, cancellable pending state, and current-request-only cleanup. Filter changes, refresh, account changes and unmount supersede the request. No new route or schema change.
- GEN-11 remains partial under the approved rules. Universal access to private notifications and clinical archives, restoration, permanent removal and retention need entity-specific policy. GEN-10 recipient archive permissions and receipts retain their prior acceptance.

### Round 2 verification

- `node --test tests/clinic-csv-transport.test.js tests/owner-report-export.test.js tests/audit-api.test.js tests/m22-audit-trail.test.js tests/owner-revenue-analytics.test.js tests/owner-analytics-a5.test.js`: 32 passed.
- `node tests/owner-audit-record.browser.mjs <Playwright index.mjs>`: Chrome passed at 390 and 1440 px on B-only port 5197. Exact-record filter and CSV, keyboard refresh with busy state, explicit abort, immediate replacement and revoked Owner refusal verified with synthetic responses.
- B-only Docker runtime `dentalops-codex-b-20261116`, `/private/audit-b-full/target.json` on loopback 55517, guarded `dental_clinic_test`. Focused Laravel command using `scripts/local-system.py --target /private/audit-b-full/target.json --profile test test` with AuditQueryTest, OperationalArchiveScopeTest, OperationalArchiveActivityTest and NotificationArchiveTest passed 16 tests and 230 assertions. Four held migrations preserved. B's test snapshot was backed up and the runtime stopped.
- PHP lint, scoped diff whitespace and secret-pattern checks passed. The inherited automation-health setup 404 was outside this round's focused run. Full suites, global build and predefense were deferred under the concurrent testing protocol. A owns shared AnalyticsPage integration and its end-to-end verification.

### Final Round 2 Git handoff

**READY - self-contained audit QA change complete.** The isolated reporting helper is also **READY** for A's shared AnalyticsPage wiring and acceptance. Stage only these Round 2 B-owned paths, separately from A's work:

- `src/clinic-csv.js`, `src/analytics-api.js`, `src/audit-api.js`, `src/pages/AuditTrail.jsx`
- `backend/app/Http/Controllers/AuditController.php`, `backend/tests/Feature/Audit/AuditQueryTest.php`
- `tests/clinic-csv-transport.test.js`, `tests/owner-report-export.test.js`, `tests/m22-audit-trail.test.js`, `tests/owner-audit-record.browser.mjs`, `tests/fixtures/owner-audit-record.html`
- `docs/coordination/JOEVAN_CODEX_B_20261116.md`

Round 1 is already committed. No A-owned files or Git state changes by B. No additional independently actionable original reporting or archive criterion was demonstrated in this pass.

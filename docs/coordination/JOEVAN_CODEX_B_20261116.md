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

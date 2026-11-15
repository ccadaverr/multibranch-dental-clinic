# Batch08 — authoritative Executive dashboard revenue

Continued on `feature/joevan-qa-20261115` from `06592b931c135fbc336d4883141fc659f523c83e`; all eleven earlier local commits and baseline ancestry preserved. Before edits, a complete Git bundle was created and verified outside the checkout: `../dentalops-local-backups/joevan-qa-20261115-221532.bundle`. It contains committed Git history, not private runtime/environment files. No integration or publication.

## Narrow original-QA queue

| Original criterion source | Current disposition |
| --- | --- |
| `FINALS-QA-REVISIONS.md`, OWN-01 revision and Q2 decision: daily revenue line, exact date/amount tooltips, Mon–Sat histogram on Saturday, billing reconciliation, empty/loading/error/responsive states | Implemented in the actual Executive dashboard this batch; local closure candidate awaiting integrated acceptance. Saturday means the existing on-demand, Manila-date report, not a new scheduled immutable financial snapshot. |
| OWN-02/03: branch-code dropdown/duplicates and pinnable location | Existing accepted A3 functionality and `docs/OWNER_BRANCH_A3_ACCEPTANCE.md`; preserved, not rebuilt or recounted. OWN-04/05/06 historical closures unchanged. |
| STF-08 and OWN-12: part-day dates and corresponding Owner leave behavior | Existing shared leave UI, transitions, revision/recovery and authorized collection implementation from Batches05–07; implemented awaiting integrated acceptance. Broader Staff roster publication policies do not block already implemented leave requests/decisions. |
| OWN-10, Q1: reuse corresponding Staff schedule/leave logic and manage both roles; OWN-11: schedules for Staff and Dentists | Partial. Shared leave and unpublished Staff draft review are implemented. Published Staff recurrence/effective duty still needs the decisions below. |
| STF-07: dated Doctor-duty status from schedules | Existing dated branch-specific Doctor evidence preserved. No unpublished Staff draft is promoted to effective duty. |
| GEN-10: notification archive/lifecycle | Already implemented awaiting integration; no reimplementation this batch. |
| GEN-11: soft archive with actor/time/role, role-filtered history, Owner restore/permanent-delete wording | Partial/policy-blocked. Original broad archive wording conflicts with retained private-record restrictions and later no-hard-delete instructions. Need entity-specific visibility/restore rules; no universal private inbox access, permanent deletion or invented retention. |
| OWN-07/08/09 and clinical Staff items | Appointment/clinical ownership remains Jaztin's; no edits. GEN-06/DEN-03 reproduction evidence remains missing. |

This is a scoped implementation queue, not a new 68-item audit or a reconciled closure count.

## Delivered behavior

The validated exact-decimal charts already existed on Analytics, but the actual Owner Executive dashboard still mounted separate legacy charts. It also showed a local-demo Paid revenue card during live sessions. The dashboard now reuses `OwnerRevenueCharts` and the established payment/refund read projections:

- Daily revenue with supported week/month/year selection; exact centavos, payment/refund dates and signed net cash flow.
- Mon–Sat summary only on the current Manila Saturday; a newly reached Saturday requests its own date. Daily resource identity includes the current clinic day.
- Existing branch/response validation, loading/empty/error/retry handling and obsolete-result suppression; authentication identity changes remount the chart resource.
- Existing mouse/focus tooltips, keyboard Escape dismissal and responsive chart layout. Live sessions no longer display local-demo Paid revenue. Other Owner metrics and all other roles remain unchanged.
- Analytics keeps its existing 30-day overview and independent historical-week selection. Dashboard mode omits those extra controls. Legacy exported chart components remain for compatibility.

Files: `src/pages/Dashboards.jsx`, `src/pages/OwnerRevenueCharts.jsx`; updated original dashboard acceptance assertions; aggregate PostgreSQL evidence test; actual-component fixture and two focused browser scripts. No CSS, dependency, logo, clinical workflow, financial mutation, route, migration or frozen contract changes.

## Contracts and integration

Unchanged Owner-only reads:

- `GET /api/analytics/daily-revenue?period=week|month|year&branch_id=<public branch reference>`
- `GET /api/analytics/weekly-histogram?date=YYYY-MM-DD&branch_id=<public branch reference>`

Omit branch for all authorized Owner branches. Existing daily/bucket decimal strings (`gross_collected_php`, `refunded_php`, `net_cash_flow_php`), totals, date/scope metadata and weekly finalization remain authoritative. Existing 401/403/422 failures are preserved. These are read projections; no mutation revision, operation receipt or retry contract changes. No consumer migration is required from Jaztin. Preserve the narrowly scoped Owner section of shared `Dashboards.jsx` when integrating his unrelated role edits. `OwnerRevenueCharts.jsx` is shared with Analytics; default behavior remains intact.

## Executed focused evidence

The owned isolated runtime was identity-verified before use. Only synthetic data and the existing guarded migration profile were used. No migrations or demo financial seeding were run.

```text
node --test tests/owner-revenue-analytics.test.js tests/own01-dashboard-charts.test.js tests/owner-analytics-a5.test.js tests/m21-analytics.test.js
# 30 passed, zero failed/skipped.

docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/leave-batch5/target.json --profile test --filter 'daily_revenue|weekly_histogram' test tests/Feature/Analytics/AnalyticsTest.php
# 5 PostgreSQL tests / 84 assertions passed.

docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/leave-batch5/target.json --profile test --filter test_owner_dashboard_evidence test tests/Feature/Analytics/OwnerDashboardEvidenceTest.php
# 1 PostgreSQL test / 44 assertions passed.

node tests/owner-executive.browser.mjs <Playwright index.mjs>
node tests/owner-executive-live.browser.mjs <Playwright index.mjs>
# Both passed. Explicit Joevan private runtime and host Vite on 5195 required.

npm run test:smoke
npm run build
git diff --check
# Passed; inherited Table-key and Vite chunk-size warnings remain.

docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/leave-batch5/target.json --profile test verify-guard
# 1 test / 14 assertions passed. PHP syntax check of the new evidence test passed.
```

Existing PostgreSQL cases cover Owner-only access, branch/date rejection, Manila payment-day boundaries, multiple partial refunds without double counting, Mon–Sat buckets/Sunday exclusion, and Saturday-in-progress versus finalized historical summaries. The new evidence test reuses the established synthetic billing fixture and independently reconciles PostgreSQL payment sums through canonical invoice/branch linkage. All branches: gross8000.00, refunds1250.25, net6749.75; first branch6000.00/1250.25/4749.75; second branch2000.00/0.00/2000.00. It writes only aggregate API DTOs into a private0600 runtime JSON file, then transactions roll back the synthetic billing fixture. No Patient data or credentials enter the browser fixture or Git.

The component browser replays those captured real aggregate API responses. It proves exact positive and negative-day mouse/keyboard tooltips, an empty month, failure/retry, wrong-branch response refusal, rapid branch switches with delayed old responses, Saturday visibility and date rollover. The separate live browser signs into the actual app against private Laravel/PostgreSQL, opens Executive dashboard, selects a canonical branch and compares displayed gross to a direct same-scope API read. The demo's empty financial report is legitimate; no fabricated payment records were added to make it populated. Both checks cover375/390/430/768/1024/1440 without page overflow. Snapshot replay is not claimed as live persisted financial mutation or new-session nonzero billing acceptance.

One initial new evidence query used a nonexistent payment branch column; corrected to the existing invoice relationship. Browser locator setup was corrected to the actual SVG hit area. Final focused checks pass; no unresolved introduced failures. No write contract changed, so no new contention suite was required. Full suites, cross-developer integration, full predefense and comprehensive acceptance remain deferred by the current Phase1 instruction. The five earlier synthetic predefense prerequisites remain explicitly unverified, not application passes. No accepted leave/roster/notification suite was repeatedly rerun.

## Roster Policy Decision Required

Approved source still does not define Staff weekday recurrence/effective boundaries; date-exception precedence; approved-leave precedence; overlapping/overnight shifts and minimum coverage; approval/publication actors and whether those are separate states; or the point publication affects duty/booking. These decisions block only corresponding effective-duty/publication behavior. Drafts remain unpublished and cannot affect booking, branch authority or clinical work.

## Publication and next work

`TEAM_DEVELOPMENT_SETUP.md` publication gate still lacks authoritative Vercel preview/backend isolation and connected Render/Railway feature-branch deployment exclusions. The checked-in proxy/config is not dashboard evidence. No push, PR, merge, hosting change or deployment occurred. Local implementation and backup continue independently of this gate.

Next highest-value work: obtain those exact roster decisions to finish OWN-11/OWN-10; resolve entity-specific GEN-11 privacy/restore policy. Existing STF-08/OWN-12, GEN-10 and this OWN-01 batch are integration closure candidates, not an inflated fully closed QA count. Preserve all four held migrations and diagnostic tests; `Served` remains treatment start. Private databases are backed up and owned runtime processes stopped after checks; no volumes or history are deleted.

# DEN-UI-01 - Dentist Home and My Schedule

2026-11-01, Asia/Manila. Developer B / Yzhekiel. Local review candidate; no deployment approval or authenticated end-to-end acceptance claimed.

## A. Baseline and isolation

- Worktree: `C:/Users/Yzhe Yu/Documents/dental-clinic-b-den01`.
- Branch: `feature/yzhekiel-den01-dentist-ui`.
- Initial and final HEAD: `2b9c891b0195198c970169fc6b752cdc038176b0`.
- Both destination and branch were verified absent before `git worktree add -b feature/yzhekiel-den01-dentist-ui <destination> <baseline>`; initial candidate status was clean.
- Original DEV-01/R1 working tree was verified as 15 modified tracked files, seven untracked files, nothing staged. No uncommitted DEV-01 files were applied to this candidate. All 22 original files were checked against their preflight SHA-256 values and are byte-identical; original branch/HEAD and inventory are unchanged.
- Developer A's reported directory remains inaccessible; no action targeted it. INT-01 remains separate and pending.
- Existing installed `node_modules` is linked through a local junction; dependencies and lockfiles were not installed or changed. Vite's fixture cache is in the OS temporary directory. The fixture server uses `configFile:false`; build uses `--configLoader runner` to avoid writing configuration caches through the junction into the original workspace.
- No environment file was copied; no database, migration, seeder, account, payment or clinic-record operation was performed.

## B. Verified routing and original usability findings

`App.jsx` sends the Dentist dashboard to `DashboardPage` in `pages/Dashboards.jsx`, which previously rendered `DentistDashboard`. The `schedule` switch renders `SchedulePage` from `pages/Scheduling.jsx`. Those are the active routes; legacy Patient pages are not this implementation.

The previous Home led with a slogan, three statistic summaries, repeated queue/treatment actions and browser-local prescription/follow-up totals. It could infer on-duty status from general availability. Its current-treatment link depended on finding the treatment's queue row in the current queue projection. The previous Schedule was a date-input/day list, with no immediately visible calendar, a limited status filter and no appointment detail action. Its date range depended on the shared bounded appointment window. Existing walk-in visibility needed preservation.

A6/A7 acceptance records and their historical fixtures were reviewed. Existing shared authorization, queue freshness, exact encounter links and server appointment pagination remain the foundations. Source candidates `PatientFlow.jsx`, `Clinical.jsx`, `layout.jsx`, `components.jsx`, `App.jsx` and Staff Calendar were inspected and left unchanged.

## C. Implementation

- `src/pages/DentistHome.jsx`: Home title, actual Manila date and assigned branch; explicit three-state duty wording; current treatment/ready encounter first; waiting list before the appointment list in mobile reading order; chronological current-day appointments; branch follow-ups from the existing server endpoint; one prescription destination without a fabricated task count. Redundant chart/message/task buttons and the slogan are removed from Home; existing navigation remains available.
- `src/pages/DentistSchedule.jsx`: immediately visible month calendar, selected/today indicators, appointment markers, roving calendar focus, arrows/Home/End/PageUp/PageDown, previous/next day and week, Today and native date entry. Selected-day search/status filters include all seven existing appointment lifecycle states. A separate section retains today's admitted walk-ins from the authorized queue. Calendar markers describe appointments, not available slots.
- `src/pages/DentistWorkspace.jsx`: shared appointment agenda, read-state feedback, authorized detail modal, Manila day updates and a read hook using Staff Calendar's existing period loader/pagination/request gate. Date-specific reads do not mutate shared collections. Manual refresh, visible-tab polling and focus refresh preserve freshness. Incomplete/stale results do not advertise complete counts; errors remain distinct from empty lists.
- `src/dentist-workspace.js`: read-only scoping and day filtering, date labels and keyboard movement. Shared `validSession`/`inScope` checks revalidate identity and branch links; no display-name relationships. Active treatment links include the exact Treatment and Visit, including when the queue entry is from an earlier day. `In Queue` and existing Waiting/Called/Treatment Ready records are supported without introducing queue commands.
- `src/dentist-workspace.css`: scoped tokens, restrained white surfaces, teal encounter/selection emphasis, readable headings, labeled status colors, wrapping rows, visible focus and reduced-motion treatment. Shared global styles, branding assets, Staff/Owner workflows and Patient/Landing files are unchanged.
- `src/pages/Dashboards.jsx` and `src/pages/Scheduling.jsx`: narrow delegation to the new Dentist components. `src/data.js`: only the Dentist `Clinical Home` navigation label becomes `Home`.
- Targeted regressions and a reproducible full-shell component fixture were added. Existing schedule/duty source assertions now follow the active component and explicit duty states. No backend or shared scheduling calculation changed.

Design choices are technical decisions: one encounter action and progressive detail reduce choices (Hick/cognitive load); reachable controls and visible focus support Fitts; familiar calendar navigation supports Jakob; restrained encounter emphasis supports Von Restorff; consistent typography/surfaces support aesthetic usability; encounter then waiting then agenda establishes reading order (serial position). This is WCAG 2.2 AA-oriented work, not conformance certification.

## D. Regression evidence

| Command/check | Final result |
| --- | --- |
| `node --test tests/den-ui-01.test.js tests/ui-foundation.test.js` | 24 passed before the closing full-suite run; new DEN-UI tests also passed in the final suite |
| `npm.cmd test` | **996 passed, zero failed, five skipped; 1001 total** |
| `npm.cmd run test:smoke` | PASS; 65 initial role/page renders and existing scenario checks; existing React Table key warning remains |
| `npm.cmd run build -- --configLoader runner` | PASS; existing >500 kB chunk warning remains |
| `git diff --check` | PASS |
| `node tests/den-ui-01.browser.mjs` with an existing Playwright package and installed Chrome | PASS at **390, 768, 1440, 375, 430 and 1024px** |
| `bash scripts/predefense-check.sh` | **Blocked, exit 2**: CRLF produces `pipefail` invalid option at line 8, before Laravel; unchanged baseline script |

The five existing skips are A12 production-shell optional browser acceptance, B8 rendered acceptance at 1440/390, and B9 rendered acceptance at 1440/390. They were not converted into passes. DEN-UI browser acceptance ran independently.

Browser checks exercised the actual routed Home/Schedule exports inside the production Shell, with every API request intercepted. They verified exact treatment navigation, waiting patients, current-day walk-ins and hiding them on another date, all appointment statuses, date/week/year transitions, calendar keyboard focus, filtering, modal Escape/focus restoration, loading/empty/error/retry states, manual refresh including follow-ups, forbidden detail data and revoked branch access. Six widths had no horizontal overflow. Reduced motion and OS dark preference were exercised; this checkout retains its existing light palette, not a new dark theme. **81 intercepted read requests, zero mutation requests, zero page errors** in the final run.

Six screenshots in `docs/ui-review/den-ui-01/` cover Home and Schedule at 390/768/1440; `browser-results.json` records the matrix. Representative final desktop/mobile/tablet screenshots were visually inspected.

Initial test development found two new-test assumptions about SSR comments and loader invalidation; these were corrected. Full-suite execution found an old duty-copy assertion still inspecting Dashboards; it now verifies the new Home's true/false/unavailable states. The initial browser script's unauthorized-error selector was corrected to include the surrounding retry control. Final runs have no known new regression.

No backend suite or authenticated browser test ran: this batch has no verified disposable database or configured backend session. No backend safety or live authorization acceptance is inferred from fixtures. Predefense did not reach application checks, so hosting/service configuration remains unevaluated.

## E. Dependencies and limits

- Existing reads only: `GET /api/appointments` with date or bounded from/to and pagination; `GET /api/appointments/{id}`; `GET /api/followups?status=active&due=all&branch_ref=...`; existing shared queue/treatment refresh. No new endpoint or request property was invented.
- The follow-up response is branch-scoped, capped at 300, and does not expose a responsible Dentist identifier. Home labels its preview **Branch follow-ups**, displays at most three returned records and offers the existing full workflow; no personal-task total or complete global count is claimed.
- Duty is shown only from an explicit `on_duty_today` boolean; absence is unavailable. No new duty calculation is introduced.
- Calendar reads remain bounded/paginated. Existing server page limits may produce an explicitly incomplete response; they are not portrayed as full availability or an empty calendar.
- Appointment details preserve server status, never infer financial settlement, and send no clinical command. Queue/treatment workflow enforcement remains in its existing destination and backend.
- Live authenticated acceptance, integration with Developer A's pending changes, backend regression QA and the existing public-content release blocker remain outside this batch. Dental chart reference imagery remains pending; no chart, prescription workflow, clinic photograph or logo was redesigned.

## F. Integration handoff

Use the changed tracked diff **plus all new files below**; branch HEAD alone does not contain this uncommitted work. Preserve file bytes when exporting. No commit, merge, push or rebase was performed.

The only file overlap with DEV-01/R1 is `tests/staffing.test.js`: DEV-01 changes the Archives navigation wording assertion; DEN-UI changes the separate duty-state assertion around line 102. Both should be retained when integrating. Patient and Landing production source has zero overlap. Pending Developer A artifacts have not been received, so complete overlap cannot be certified; inspect incoming edits to `Dashboards.jsx`, `Scheduling.jsx`, `data.js` and the two existing test files before combining. `AttendancePolicy.php` is untouched by DEN-UI.

Affected runtime areas: M6 appointment read presentation, M9 queue preview, M5 treatment navigation and M20 follow-up preview. Their process-document status should retain the existing module classification, with this note: **Dentist Home/Schedule UI implemented and fixture-verified; live authenticated and combined-backend acceptance pending.** This batch does not promote module status or establish new clinic policy. No process document was edited.

## G. Final repository state

**Ready for independent code/UI review.** No production readiness, deployment or integration approval claimed.

Branch and HEAD remain as in section A; nothing staged. Complete inventory follows (M = modified tracked; ?? = new untracked):

```text
 M src/data.js
 M src/pages/Dashboards.jsx
 M src/pages/Scheduling.jsx
 M tests/staffing.test.js
 M tests/ui-foundation.test.js
?? docs/DEN_UI_01_IMPLEMENTATION_REPORT.md
?? docs/ui-review/den-ui-01/browser-results.json
?? docs/ui-review/den-ui-01/home-1440.png
?? docs/ui-review/den-ui-01/home-390.png
?? docs/ui-review/den-ui-01/home-768.png
?? docs/ui-review/den-ui-01/schedule-1440.png
?? docs/ui-review/den-ui-01/schedule-390.png
?? docs/ui-review/den-ui-01/schedule-768.png
?? src/dentist-workspace.css
?? src/dentist-workspace.js
?? src/pages/DentistHome.jsx
?? src/pages/DentistSchedule.jsx
?? src/pages/DentistWorkspace.jsx
?? tests/den-ui-01.browser.mjs
?? tests/den-ui-01.test.js
?? tests/fixtures/den-ui-01.html
?? tests/fixtures/den-ui-01.jsx
?? tests/support/den-ui-01-fixture.js
```

Tracked diff summary (new files above are additional, not included by ordinary `git diff`):

```text
src/data.js                 |  2 +-
 src/pages/Dashboards.jsx    | 58 ++------------------------------------
 src/pages/Scheduling.jsx    | 68 ++-------------------------------------------
 tests/staffing.test.js      |  6 ++--
 tests/ui-foundation.test.js | 16 +++++------
 5 files changed, 18 insertions(+), 132 deletions(-)
```

No unintended tracked changes, secrets, environment files, backend files or approved assets are included. Remaining acceptance/environment limits are listed in sections D and E.

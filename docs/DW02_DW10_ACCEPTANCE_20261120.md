# DW-02 / DW-10 — Focused implementation and acceptance package

**Prepared against:** `f4734a439fa9ef29a17fd51118e781c5f5293f31` (`jaztin-ego-fullstack` source archive `dentalops-f4734a4-dw02-dw10-source.zip`).

**Scope:** Staff Dentist Duty read (DW-02) and shared Staff/Owner calendar capacity read (DW-10). No unrelated redesign, schema change, migration, deployment change, or write workflow is included.

## Implementation

### DW-02 — Dentist Duty current-day branch-scoped read

- The existing dedicated `GET /api/work-schedules/duty` remains the only request used by the Staff dashboard duty widget. The full Work Schedules directory is not fetched for this card.
- The client enforces the agreed **2,000 ms maximum observed read budget**. The timer starts before the API call and the elapsed value is measured after the normalized response/body has been read.
- A response arriving after the budget is not accepted as current. The GET is aborted at the limit, the previous duty projection is cleared, and the card shows an explicit timeout state with a manual Refresh action.
- Successful reads show the clinic date, server update time, and measured client read duration. This is diagnostic transparency, not a substitute for browser Network timing.
- The backend primes only today's closure rows for the already-authorized Dentist branches before computing duty. This avoids `ClosureCalendar` falling back to its full-year closure lookup on this dashboard read. The existing server-side `UserBranchScope` filter, role check, private/no-store response, and `Server-Timing: app;dur=...` header are preserved.
- Backend regression coverage measures SQL round trips with the original fixture and after adding twelve synthetic Dentists. The query count must stay constant and at most ten; the measured controller duration must remain at or below 2,000 ms in the test environment.

### DW-10 — Calendar load performance and partial failure detection

- Calendar capacity remains a separate read from the appointment list and keeps its existing finite **15,000 ms** request timeout.
- A visible loading state is shown while capacity is being read. A timeout, forbidden response, network failure, or incomplete response is surfaced explicitly with Retry; the error is shown to Staff and Owner.
- The client validates the full requested date sequence, branch identities, and numeric capacity fields before painting any capacity band. A missing day, missing branch, duplicate identity, mismatched selected branch, or malformed metric makes the entire capacity projection unavailable.
- Old capacity bands are cleared while a new month/branch request is pending and after failure. A late response from an earlier month, branch, or session cannot replace the latest request.
- The calendar's manual Refresh action and visible refresh both refresh the appointment list and capacity projection for Staff and Owner.
- Appointment counts remain available from the appointment read; they are not relabelled as Dentist capacity when the capacity read is pending or failed.
- The backend test exercises a 42-day range with twelve additional synthetic Dentists and asserts that query count stays bounded (at most twelve round trips), with complete date/branch projections and private timing headers.

## Files changed

- `src/read-performance.js` — shared read budgets and strict complete-capacity response guard.
- `backend/app/Http/Controllers/WorkScheduleController.php` — bounded current-day closure preload for authorized duty branches.
- `src/pages/StaffOnDuty.jsx` — 2-second budget, measured duration, clinic-date display, manual refresh/retry.
- `src/pages/StaffDayCalendar.jsx` — explicit capacity loading/error/retry, complete-response gate, stale-band clearing, synchronized refresh.
- `src/b4-calendar.css` — compact cross-role capacity status styling.
- `backend/tests/Feature/Staffing/Dw02Dw10ReadPerformanceTest.php` — dedicated endpoint, branch privacy, timing, and bounded-query regression coverage.
- Focused Node and browser fixtures/tests for the two read paths and the dedicated duty endpoint.

No authorization policy, business rule, migration, or deployment configuration is changed by this package. The sole backend controller change is a read-only closure preload narrowed to the already-authorized branches and current clinic date.

## Apply

Start from the published `jaztin-ego-fullstack` checkpoint matching the source archive. Preserve any uncommitted work first.

```bash
cd ~/Downloads/dentalops-latest || exit 1
git status --short
git rev-parse HEAD

git apply --check ~/Downloads/DW02_DW10_READINESS.patch
git apply ~/Downloads/DW02_DW10_READINESS.patch
git diff --check
```

The expected base is `f4734a439fa9ef29a17fd51118e781c5f5293f31`. If the current checkout is not based on that commit, stop and reconcile before applying; do not force the patch.

## Focused verification

Run frontend checks from the repository root:

```bash
node --test tests/dw02-dw10-read-performance.test.js
node --test tests/stf07-duty.test.js tests/duty-branch-selection.test.js
node --test tests/cal02-calendar-scope.test.js
npm run build
```

Run backend tests only against the project's isolated test database/profile (never the clinic database):

```bash
cd backend
php artisan test --filter=Dw02Dw10ReadPerformanceTest
php artisan test --filter=OnDutyStatusTest
php artisan test --filter=WorkSchedulesTest
```

The backend suite uses `RefreshDatabase`. Confirm `.env.testing` or the existing guarded `local-system.py --profile test` target resolves to the isolated test database before running it.

For the rendered browser checks, start the local Vite server and use the repository's existing Playwright installation:

```bash
npm run dev -- --host 127.0.0.1 --port 5198
```

In another terminal, run the focused duty and calendar browser acceptance scripts using the locally installed Playwright module. These browser checks use synthetic data and refuse writes.

## Manual acceptance — DW-02

1. Sign in as Staff with at least one authorized branch and open the dashboard.
2. In DevTools Network, confirm the widget calls `GET /api/work-schedules/duty`, not the full `/api/work-schedules` directory.
3. Confirm the request returns `200`, `Cache-Control: private, no-store`, and `Server-Timing` containing `app;dur=...`.
4. Record ten consecutive cold/warm browser request durations. **Every successful read must be at or below 2,000 ms.** The widget's `Verified in ... ms` value should agree with the observed client duration within normal rendering overhead.
5. Simulate a response taking longer than two seconds. The widget must stop waiting at the limit, remove the unverified old duty rows, show the timeout message, and allow Refresh.
6. Verify Staff sees only their server-authorized branches. A forged or out-of-scope branch must not widen the result; Patient access remains forbidden.
7. Verify Manila midnight changes the clinic date and triggers a new duty read.

**DW-02 passes only if all ten successful browser reads are <= 2,000 ms in the target environment and the authorization/timeout checks pass.** A synthetic timeout test does not prove the real database meets the latency target.

## Manual acceptance — DW-10

1. Open the Appointment Calendar as Staff and Owner. Confirm `GET /api/calendar/load` covers the displayed calendar date range.
2. While the request is pending, confirm `Loading Dentist capacity…` appears and old capacity bands are not presented as current.
3. On success, confirm every requested day has a matching capacity projection and every day uses the same authorized branch set returned by the server.
4. Switch month and branch while a previous capacity request is pending. Confirm only the latest month/branch response is rendered.
5. Simulate a truncated response (missing one date or branch). Confirm the page shows the incomplete-capacity error, clears all old capacity bands, and offers Retry.
6. Simulate a network failure and a response taking longer than fifteen seconds. Confirm each ends in an explicit error and Retry; neither leaves an indefinite spinner.
7. Retry successfully. Confirm the latest capacity bands return, appointment counts remain accurate, and no scheduling/payment/attendance write is issued.
8. Use the manual Refresh action and leave the calendar visible long enough to confirm its scheduled refresh updates appointments and capacity together for Staff and Owner.

## Evidence limits

- The Node tests validate the 2,000 ms and 15,000 ms budgets and reject incomplete/mismatched capacity payloads.
- The backend feature tests validate role/branch boundaries, response headers, and bounded query counts using synthetic fixtures.
- A test database's `Server-Timing` and query-count results do not prove hosted or production latency. DW-02 remains **Needs live evidence** until the ten browser timings are captured on the intended local/target database.
- No real Patient data is required. No migration or deployment action is part of this patch.

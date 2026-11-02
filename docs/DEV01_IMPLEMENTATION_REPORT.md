# DEV-01 implementation and verification — 2026-10-31 (Asia/Manila)

## A. Baseline

- Branch: `integration/developer-a-b`; HEAD: `2b9c891b0195198c970169fc6b752cdc038176b0`.
- Initial staged, unstaged and untracked state: clean. No commit, merge or push performed.
- Routing verified: App renders PatientPortal, which lazy-loads `patient/pages/Book.jsx` and `Visits.jsx`. Several UX2 tests still exercise legacy `pages/PatientBook.jsx`; those tests remain intact.
- Historical environment and test claims were not treated as current acceptance.

## B. Verified findings

Source-confirmed:

- Visits requested a 272-day range; Home requested 182 days and was within the server limit. AppointmentController rejects differences >=184 days. Visits' invalid request is a concrete source-level explanation for its API error, not a reproduction using a real patient's session. Both now load paginated appointment records without date-range truncation.
- Visits and the historical-records page collapsed distinct records by date. Their treatment summaries invented a branch, and Visits also invented 09:00–10:00 times. These are removed.
- PatientTreatmentResource exposes a treatment public ID, date, summary, service names and dentist display name, but deliberately no appointment/visit/branch link. AppointmentResource exposes the appointment public ID and real scheduling fields. A date cannot establish their relationship. Summaries remain explicitly separate record types; no permission expansion or clinical API change was made.
- The reported future-as-Completed bug was not reproduced live. Filters now rely on lifecycle states; today’s active/in-progress appointments remain visible, and only actual Completed appointments enter Completed.
- A checkout return URL previously triggered an unverified payment-success/email-sent claim. It now describes verification as pending and directs the patient to server status.
- AppointmentService accepts a null dentist, invokes SchedulingService.assignDentist and revalidates eligibility, branch, availability and overlap. PostgreSQL constraints remain the final concurrency guard. Guardian ownership is checked in AppointmentController.

## C. Implementation

Changed files:

- `src/patient/visit-history.js`: appointment pagination, treatment cursor pagination, safe summary projection, legacy History filter normalization.
- `src/patient/pages/Visits.jsx`: Upcoming/Completed/Cancelled/History filters; distinct summary list; independent treatment loading/error feedback; truthful payment return feedback; terminal/in-progress records do not expose cancellation/rescheduling controls.
- `src/patient/format.js`: active states and robust timestamp sorting.
- `src/patient/pages/Archives.jsx`: preserve same-day records, remove fabricated branch/reference values, identify treatment summaries, paginate care history, report partial-read errors, retain prescription and receipt access.
- `src/patient/pages/Book.jsx`: four steps; combined calendar/time; server-assigned dentist; category disclosure; optional location; working branch retry; consultation eligibility guard; synchronous duplicate-submit lock; preserve Back selections; server create remains authoritative.
- `src/patient/pages/Home.jsx`: accurate online/pay-at-clinic copy, less repetitive CTA, paginated reads, previous-appointment wording.
- `src/patient/Portal.jsx`, `pages/Account.jsx`: patient number hidden; historical-record label; Security reached through Profile; existing routes and Family management preserved.
- `src/pages/PublicSite.jsx`, `src/landing.css`, `src/patient/portal.css`: prominent clinic identity, viewport hero, existing illustration fallback, secondary branch link, editorial four-step sequence, consultation-first service labels, focus styles and category disclosure.
- `backend/app/Services/Automations/AttendancePolicy.php`: remove misleading blanket “There are no fees” from the shared policy summary. No scheduling, financial or database logic changes.
- `tests/dev01-active-patient.test.js`: seven behavior/render regressions for active pages and pagination.
- `tests/m23-archives.test.js`, `tests/staffing.test.js`, `tests/public-auth-site.test.js`: update wording assertions for intentionally changed labels. Initial full-suite failures were these labels plus the dependent success heading; the latter was restored for confirmed bookings.

UX: progressive choices (Hick/cognitive load), familiar calendar and Back behavior (Jakob), reachable primary controls (Fitts), restrained emphasis and typography (Von Restorff/aesthetic usability), clear entry and confirmation (serial position). This is not a WCAG conformance certification.

Payment source: AppointmentService currently permits `pay_at_clinic` for patients; otherwise configured PayMongo creates a 15-minute held booking. Online payment is credited to the visit invoice. Cancellation code uses a literal 24-hour threshold for refund attempts; AttendancePolicy’s configurable late-hours summary is a separate policy and does not establish refund eligibility. Copy avoids unconditional refund/email-delivery promises. Billing already treats redirect parameters as unverified and retains real invoice/deposit adjustments.

## D. Tests and browser checks

- `node --test tests/landing.test.js tests/patient-portal.test.js tests/patient-booking-ux2.test.js`: 45 passed after sandbox escalation.
- Same command plus `tests/dev01-active-patient.test.js`: **52 passed, 0 failed** on final code.
- `npm.cmd test`: **990 passed, 0 failed, 5 skipped; 995 total** on final code.
- `npm.cmd run test:smoke`: PASS on final code. Existing React Table key warning remains.
- `npm.cmd run build`: PASS on final code. Existing >500kB chunk warning remains.
- `git diff --check`: PASS. Changed diff scanned for credential patterns; no matches. No environment files or approved logo assets changed.
- PowerShell blocks `npm.ps1`; used `npm.cmd`. Initial sandbox esbuild directory-access failures were retried outside the sandbox and passed.
- `bash scripts/predefense-check.sh`: attempted; sandbox denied Bash, escalated retry failed at `set -euo pipefail` because checked-out script uses CRLF. PHP is also unavailable on this shell’s PATH. Check not passed.
- Backend suite NOT run: phpunit.xml names `dental_clinic_scratch`; isolation/disposability and any testing overrides have not been verified. No migrations, seeders, resets or database-writing test commands were executed.
- Playwright: real local landing DOM inspected at 390x900 and 1440x900, no horizontal overflow; hero approximately 830px/820px tall with clinic identity. Public API requests produced console/network errors, so populated live content was not accepted.
- Actual Book component mounted in-browser with all API calls intercepted: empty state; category/service/branch/date/time to Review; Back preserves slot and refetches availability; keyboard Enter on Change date; no overflow at 390/1440; two synchronous confirmation clicks produce one intercepted POST with no dentist_ref; stale-slot 422 stays visible and retains Review.
- These browser fixtures created no appointments or payments. Authenticated live booking, cancellation/reschedule integration, paid confirmation, dependents end-to-end and the full responsive matrix remain unverified. SSR/render smoke alone does not establish those behaviors.

## E. Remaining work and release gates

1. **Public content release gate remains open.** Prior inappropriate FAQ/closure text is a user-reported observation; exact current records/IDs were not independently retrieved because public API content was unavailable. No data was edited and no profanity filter was added.
2. Source trace: GET `/api/public/faq` → PublicContentController → `assistant_answers` where active=true, draft=false, branch_id=null. Authorized Owner screen: Administration → Assistant answers (`src/pages/AssistantAnswers.jsx`), using PATCH `/api/assistant-answers/{id}`. Owner should record affected IDs and wording privately, deactivate the inappropriate answer, supply approved replacement wording in the editor as a draft, and confirm only after review. Preserve audit history and verify the public endpoint on a fresh load.
3. GET `/api/public/closures` → BranchClosureController.upcoming → active `branch_closures` in the next 60 days. Authorized Owner screen: Closed dates (`src/pages/ClosedDates.jsx`). Capture date, branch, ID and reason privately; verify the closure itself with the clinic. Update API only supports remove/confirm/dismiss, not reason editing. An authorized Owner can soft-remove the bad closure, then enter an approved replacement closure where needed; check affected appointments and booking-calendar behavior. Do not remove a genuine closure merely to hide text or automatically cancel visits. Verify both public closure content and availability before release.
4. No approved clinic photograph was found in `public/images` (only the two protected logos); existing illustration retained, assets unchanged.
5. Backend gaps remain: online-payment capability and fee are not provided as a review quote; server may fall back to unpaid booking when PayMongo is unconfigured. Refund cutoff is hard-coded separately from configurable lateness policy. No new quote/settings contract or payment behavior was invented in this frontend batch.
6. Visits History and the broader historical-records destination still overlap; they remain reachable to preserve receipt/prescription access. Further consolidation needs a complete records/navigation acceptance pass. Dentist preference is no longer a required booking step; unused legacy DentistStep code is retained rather than performing unrelated cleanup.
7. No claim that the entire redesign, live payment workflow, backend policies, accessibility certification or release acceptance is complete. Other role redesigns are deferred.

## F. Repository state

14 tracked implementation/test files modified; two new source/test files plus this report. Browser-generated evidence moved from the initially absent `.playwright-mcp` directory to the local temporary directory `dev01-playwright-20261031`. No pre-existing work was discarded. No patient/clinic records, secrets, migrations, environment files or brand assets were modified. No commit, merge or push.

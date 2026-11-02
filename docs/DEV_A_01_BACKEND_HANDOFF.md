# DEV-A-01 backend integrity and Patient Portal integration handoff

R1 follow-up: [DEV_A_01_R1_INTEGRATION_CONTRACT.md](DEV_A_01_R1_INTEGRATION_CONTRACT.md) supersedes the earlier dependent-search/payment-capability limitations. Exact failure comparisons are in [DEV_A_01_R1_FAILURE_COMPARISON.md](DEV_A_01_R1_FAILURE_COMPARISON.md). Original run results below remain historical evidence, not final R1 full-suite acceptance.

Developer A: Joevan Delos Santos. Work began 2026-10-31 and validation continued after midnight on 2026-11-01, Asia/Manila. This is a local review batch, not deployment or clinic-data acceptance.

## A. Baseline, isolation and scope

- Original workspace: `C:\Users\Joevan Delos Santos\Documents\dental-clinic-a-ui-20261031`, branch `feature/joevan-a12-shell-notifications-20261031`, HEAD `6b93754d425acdabb580ae463f36d0452eb456f7`. Tracked and staged inventories were empty. Existing untracked `$config.txt`, `.agents/skills/motion/` and `.codex/` artifacts were preserved.
- The fetched integration reference is `2b9c891b0195198c970169fc6b752cdc038176b0`. Relative to A12 it adds B9's four frontend/evidence files; backend files are identical. No assumption that the initial workspace already held this baseline was made.
- Isolated development worktree: `C:\Users\Joevan Delos Santos\Documents\dental-clinic-dev-a01-20261031`; branch `feature/joevan-dev-a01-backend-integrity-20261031`, based directly on that integration commit. No shared-branch merge, rebase, push or integration commit.
- Inspected all requested controllers/services/resources, route middleware, appointment/treatment policies, scheduling/work/leave rules, payment settlement/refund paths and the named existing tests. Existing Composer dependencies were installed from the lockfile with scripts disabled. Actual installed Laravel is 13.33.0; PHP CLI is 8.3.33. No manifest or lockfile change.
- No Developer B frontend source, style or test was edited. No new patient-visible relationship fields, appointment statuses, migration, database cleanup, or clinic-policy value was introduced.

### Database safety evidence

No existing `.env` was read/copied, and no connection to `dental_clinic` was made. Docker had no running containers before this batch. Created `dental-dev-a01-scratch-20261031`, image `postgres:16`, label `dental.dev-a01=disposable`, PostgreSQL published only on `127.0.0.1:5432`; its data directory is tmpfs and it has no persistent/host volume mounts. Initial TCP inspection returned `dental_clinic_scratch|127.0.0.1|5432|0` (zero public tables).

The worktree's new, ignored `.env.testing` contains only scratch connection settings, a newly generated local application key, array mail, synchronous test queue and empty provider credentials. Its values were never printed. `TEST_SCRATCH_SERVER_ADDRESS=172.17.0.2` matches the independently inspected container address. Reinspect it after recreating the container; do not copy that address as a permanent assumption.

`Tests\TestCase::createApplication()` calls `ScratchDatabaseGuard` before test database refreshes. It requires testing mode, PostgreSQL, exact database `dental_clinic_scratch`, client host `127.0.0.1`, port `5432`, no connection URL, and matching actual server/database identity. Concurrent child runners call the same guard. Existing `migrate:fresh` calls therefore ran only in the disposable container. No test guard was relaxed or edited. The four pending migrations in Developer B's QA database were not inspected or applied.

## B. Findings and disposition

| Finding | Status | Evidence / resulting behavior |
| --- | --- | --- |
| Omitted/null Dentist selects a real eligible Dentist | Verified working | `StoreAppointmentRequest` accepts nullable `dentist_ref`; create calls `assignDentist`, which evaluates every candidate and ranks active booked minutes, then internal profile ID |
| Branch/service authorization, operational availability, schedule/breaks, approved leave, overlap, hours and Patient time window | Verified working | Same scheduling validator under search and final creation; existing tests plus `PatientBookingContractTest`. Account login status is deliberately separate from operational availability; a roster-only Dentist can be assigned |
| Online hidden/consultation-first restrictions differed between search and creation | Defect confirmed and fixed | Reproduced nine advertised Patient slots for a hidden service that creation refused. Shared validator now suppresses restricted direct Patient slots/recommendations; Staff scheduling and consultation acknowledgement remain unchanged |
| Future active appointments become completed automatically | Not reproduced in backend | New authenticated API regression creates a future Confirmed appointment, lists its unchanged status, distinguishes cancelled/no-show rows, exposes no foreign row and creates no Visit/Treatment |
| Two same-day completed treatments | Verified working | Distinct public treatment IDs survive even equal completion instants and `per_page=1` keyset pagination; patient subset unchanged |
| Date-based history merge, fabricated historical metadata and unconditional payment success toast | Frontend-only issue | Exact baseline `Visits.jsx` findings below; Developer B must correct these |
| Reschedule confirmed an unpaid hold and prevented expiry cleanup | Defect confirmed and fixed | New regression failed Pending vs Confirmed before correction. Reschedule now preserves current status and original hold deadline |
| Staff confirm bypassed an outstanding online payment hold | Defect confirmed and fixed | Named confirm refuses `booking_payment_status=held` with 422 `booking_payment_pending`; ordinary attendance-pending confirmation still works |
| Different event ID / polling then webhook applied one payment again | Defect confirmed and fixed | Deduplicate the provider payment reference under the appointment lock, preserve terminal clinical states/revision/history, and mark event Duplicate. Different extra payments remain Needs review |
| First payment on a no-show/closed or retired checkout could reopen the appointment | Defect confirmed and fixed | Polling does not reopen it; webhook retains the payment event for review. Cancelled appointments retain the existing cancellation-review path |
| Unconfirmed reference/demo fee used as a checkout price | Defect confirmed and fixed | Only `PriceResolver` results authorize a new charge. Unpriced online booking returns 422 `booking_price_unavailable` with no appointment or HTTP request. Pay-at-clinic remains supported with a null fee rather than an invented price |
| Pending provider refund reported as refunded | Defect confirmed and fixed | Reproduced pending → refunded before correction. Validate refund ID/amount/status; only succeeded sets refunded/time. Retain acknowledged refund reference; subsequent service reconciliation retrieves that refund instead of creating another. Creation has a stable provider idempotency key |
| Public cancellation summary promised cancellation “anytime” and “no fees” | Defect confirmed and fixed | Summary now describes pre-start/pre-admission cancellation and separates booking payments/refunds from attendance tracking |
| FAQ/closure publication authority | Verified working | Owner-only mutations, active/non-draft/global FAQ filtering, active closure filtering, audited deactivation/removal; new production-route tests. No independent second-reviewer workflow exists |
| Reported inappropriate stored public text | Not verified; needs clinic authorization | Reported by coordinator; exact QA record IDs and current public responses are not verified without its API base URL. Treat as a release blocker until Owner-approved correction and a fresh public-response check |
| Existing Waiting-vs-Called treatment-start contract conflict | Needs coordinator authorization | Existing unchanged test expects `queue_not_ready` for Waiting. Baseline `QueueService::serve` intentionally expanded acceptance to Waiting/In Queue in `f4b04f6`. Do not silently reverse this earlier QA decision or weaken the assertion |

## C. Exact Patient booking contract for Developer B

Authenticated Sanctum session + active Patient account; normal SPA CSRF flow. **POST `/api/appointments`**.

```json
{
  "branch_ref": "b1",
  "service_ref": "svc1",
  "date": "2026-11-02",
  "start_time": "09:00",
  "pay_at_clinic": true
}
```

The example references are illustrative, not clinic facts or guaranteed available dates/times. Send actual references and availability from the API.

| Field | Contract |
| --- | --- |
| `branch_ref` | Required existing branch `legacy_ref`; active/open/day/hours checked by scheduling |
| `service_ref` | Required existing service `legacy_ref`; active, offered by branch, online-bookable for Patient |
| `date` | Required `YYYY-MM-DD`; tomorrow through one calendar month after tomorrow inclusive, Asia/Manila, month-end clamped |
| `start_time` | Required `HH:mm`; Patient starts on the hour; duration comes from branch override or service |
| `dentist_ref` | Optional existing Dentist `legacy_ref`; **omit for automatic assignment**. Explicit null is also accepted. Existing clients may select an eligible Dentist, but simplifying the UI requires no backend engine change |
| `notes` | Optional/null string, max 1000 |
| `pay_at_clinic` | Optional/null boolean; true prevents online checkout. Omitted/null/false requests the current configured-online path |
| `for_patient_id` | Optional dependent's public ID (max 40); controller verifies current guardianship. Ordinary own booking omits it |
| `Idempotency-Key` header | Optional but recommended for create/reschedule/cancel; 1–255 visible ASCII characters. Keep the same key for the same retry; a different payload with the same key is refused |

Do not submit `patient_id`, `patient_code`, `id`, `status`, `source`, `revision`, `dentist_profile_id` or `consultation_acknowledged` as a Patient. They are prohibited. Unknown fields cannot reach the service's allowlisted input; a submitted amount, URL or inferred identity is never payment/scheduling authority.

**Assignment:** branch membership + authorized service + profile `available`; then schedule/exception, branch hours, breaks and approved leave; Patient and Dentist overlap checks. Fewest active booked minutes on that clinic date wins, tied by ascending internal profile ID. Responses expose the transitional Dentist reference/name, never that internal rank/ID. No random or first-array fallback.

**Search:** `GET /api/appointments/availability?branch_ref=...&service_ref=...&date=...`, with optional `appointment_id` when rescheduling. Patient reschedule searches retain that appointment's Dentist. Availability reserves nothing; creation revalidates. Availability's Patient identity is the authenticated Patient; dependent availability is not a separate supported contract here—final creation still validates the selected dependent. Staff/Owner use their authorized branch scopes, optional public `patient_id`, 30-minute starts, and may select a different eligible Dentist. Patient-only date window does not constrain those operational roles. No scheduling rule is waived merely by being Owner.

**Response:** 201 `{data: AppointmentResource}`. Fields: public `id`, server `code`, `status`, `source`, `assignment_method`, `revision`; Manila `date`, `start_time`, `end_time`, offset `starts_at`/`ends_at`, `duration_minutes`; `patient:{id,code,name}`, `branch:{id,name}`, `service:{id,name}`, `dentist:{id,name}`; `notes`; decimal-string-or-null `booking_fee_php`, `booking_payment_status`, `booking_hold_expires_at`, `booking_payment_method`, `booking_paid_at`, `checkout_url`, `checkout_session_id`; cancellation/create/update timestamps. Detail additionally contains append-only `history`. Never manufacture missing data in React.

**Errors:** 401 unauthenticated; 403 identity/branch/guardian/role denial; 422 field validation (`errors`), `service_not_bookable_online`, `schedule_invalid` (`failed_checks`, `alternatives`), `booking_price_unavailable`, `idempotency_key_reused`; 409 `stale_revision` or race-time `schedule_conflict`; provider/configuration failures can return 502/503. An observed occupied slot may return 422; a race lost at the PostgreSQL exclusion constraint returns 409. Both mean reload availability, not success. Competing writes cannot both occupy the same active Dentist/Patient interval; transaction retries remain intact.

**Reschedule:** POST `/api/appointments/{public-id}/reschedule` with `date`, `start_time`, `expected_revision`; Patient cannot change Dentist/Patient/branch/service. Existing payment snapshot and hold deadline stay attached; status now stays Pending or Confirmed. It does not verify payment, clear an attendance hold or grant a fresh 15-minute window. The new catalog-publication check applies to new bookings; it preserves the existing reschedule path for an already booked service subsequently hidden or made consultation-first. **Cancel:** POST `/api/appointments/{public-id}/cancel` with `expected_revision`, optional `reason`/`note`. Once checked in/visited, cancellation is refused; completed/closed care cannot be rescheduled. Patient cancellation after the start is refused. Staff operational exceptions remain unchanged.

Consultation-first/hidden services cannot be booked directly by a Patient. Authenticated **GET `/api/services`** already exposes `online_booking` and `consultation_service_id`; despite that historical field name, the resource returns the linked service's **legacy reference**, not its bigint ID. Use that configured reference as `service_ref` for the bookable consultation after rechecking availability. The public service list exposes only `starts_with_consultation`, not this mapping. Do not guess a consultation or use Staff-only acknowledgement. Existing Staff/Owner consultation acknowledgement remains required. No automatic clinical decision or new response field is introduced.

## D. Visits and history contract

| Entity/status | Meaning for the portal |
| --- | --- |
| Appointment Pending | Reserved appointment awaiting payment when payment status is held, or awaiting front-desk confirmation under enabled attendance policy. Not completed |
| Appointment Confirmed | Scheduled appointment. May still be unpaid at clinic; not proof of payment or completed treatment |
| Appointment/Visit Checked In | Staff recorded arrival and created the exact Visit; not completed |
| Appointment/Visit/Treatment In Treatment | Clinical encounter has started; not completed |
| Appointment/Visit/Treatment Completed | Dentist completion command finalized the treatment and cascaded to linked Visit/appointment atomically |
| Appointment Cancelled / No-show | Terminal scheduling disposition; not a completed clinical encounter |
| Queue Served | Patient left the waiting queue when treatment started. **Not a completed Appointment/Treatment status** |
| Historical treatment | A separate completed treatment record, keyed by its public treatment ID; not an inferred appointment |

`GET /api/appointments` is scope-filtered and page-number paginated, default 50, max 100. Optional `date` is exclusive with `from`/`to`; a supplied range is at most **184 inclusive days**. With no date/range it lists scoped appointments without imposing that date window. Follow pagination; absence from one page is not evidence of completion/cancellation.

`GET /api/visits` is for authorized operational roles, not a general Patient history feed. It defaults to today's Manila clinic date; explicit ranges are capped at 184 inclusive days and results are paginated. Scheduled Visit → optional appointment link; walk-in Visit has no appointment. One Visit per scheduled appointment and one active Visit per Patient; one Treatment per Visit. Multiple successive completed Visits/Treatments on one day are legitimate.

**GET `/api/treatments/mine`**: own completed Treatments only, keyset order `(completed_at DESC, internal id DESC)`; `per_page` 1–100 (default 50), `cursor` = last returned treatment public ID, `meta.next_cursor` drives further reads. No date filter/window. Foreign/unknown cursor returns the same empty page. No Patient-supplied identity can broaden the set; staff/owner/other Patient cannot read another Patient's private treatment subset through this endpoint.

Each row remains exactly `{id, date, procedure_summary, services:[{name}], dentist:{name}}`. `id` is the stable public treatment ID. No Visit/appointment/branch/service IDs, private chief complaint/plan/clinical notes, line notes, prescription/follow-up flags or history were added. This endpoint does not provide dependent clinical history merely because the account can book a dependent.

### Specific frontend actions (baseline source only)

- `src/patient/pages/Visits.jsx:15`: `from=today-180` through `to=today+92` exceeds 184 days and returns 422. Split bounded ranges and page them, or page the scoped list without a date range. Preserve explicit loading/error state.
- `Visits.jsx:26–43`: do not merge by matching dates. Two same-day treatments are separate. With the current privacy contract, show appointment and treatment histories as distinct record kinds/sections keyed by their own public IDs. Do not imply an exact cross-type join that the API intentionally does not provide.
- Do not fabricate treatment start/end times, branch name or an appointment-like code from a treatment ID. Those values do not exist in `PatientTreatmentResource`.
- `Visits.jsx:51`: `payment=success` is a return hint, not evidence. Refetch the authorized appointment and show confirmed payment only from `booking_payment_status=paid` (or a subsequently refunded state). The GET can reconcile provider truth; failure/pending must remain honest.
- `splitAppointments` classifies future active appointments as upcoming and everything else as past; “past” is not equivalent to “completed.” Use canonical statuses; a queue Served label must not be treated as clinical completion.
- The original reported future-booking-as-completed QA symptom was not reproduced with authenticated backend fixtures. If it persists after these UI corrections, capture the exact public appointment ID, returned status and request range for a read-only investigation; do not repair clinic rows manually.

## E. Payment/refund contract and recommended UI wording

**Verified backend rules:** when the account is a Patient, online payment is configured and `pay_at_clinic` is not true, creation uses the authoritative full booked-service price for the appointment date, starts checkout and returns Pending/held with a 15-minute expiry and checkout URL. This batch removes the reference-fee/fixed-500 fallback. It does not add a fixed-reservation-fee setting, quote endpoint or new clinic fee policy. Staff/Owner bookings do not initiate booking checkout. If online methods/credentials are not configured, current behavior falls back to unpaid booking; do not advertise working online payment without deployment verification.

The active Pending hold occupies the scheduling interval. `appointments:release-expired-holds` is registered every minute with overlap protection; expired held appointments become Cancelled/unpaid and their slot is released. Actual release depends on that scheduler running. A late captured payment after cancellation is retained as Needs review, never silently revived.

Confirmation is based on server-to-provider read-back, both after a signed webhook and through existing authenticated GET polling. The browser return cannot settle anything. Webhook validation retains raw-body HMAC, mode-specific signature, timestamp tolerance, event deduplication, server-created checkout linkage, reference, exact integer-centavo amount and currency checks. Return URLs remain server-built. This batch additionally prevents payment replay from resetting clinical state. No live checkout, refund or webhook was initiated.

Cancellation eligibility and attendance tracking are different from refund eligibility. Existing refund code attempts a full refund for a paid booking cancelled at least 24 hours before its start; a later cancellation or no-show marks the payment forfeited and requires a front-desk decision. Provider failures do not undo cancellation. A request being eligible is not a guarantee that the provider accepted/finished it. Existing manual refund service allows paid/forfeited bookings under the caller's established workflow; no new public refund endpoint was added.

Refund responses now distinguish pending/processing/failed from succeeded. Acknowledged references are retained; another service reconciliation retrieves the same refund. Only succeeded records `booking_payment_status=refunded` and `booking_refunded_at`. There is **no new scheduled refund reconciliation worker or Patient refund-detail API** in this batch. Pending/failed/unknown outcomes need operator review; do not promise automatic retry or money already returned. A transport failure before any refund reference is known remains an unknown outcome: the stable provider idempotency key helps within provider retention, but an unbounded later retry is not proven safe.

Existing billing caps booking-deposit credit at the invoice's Patient responsibility. The existing exercised full-credit path creates a Payment and Payment Receipt; partial/excess-credit cases do not imply an automatic residual refund. Final actual procedures still determine the invoice.

| UI situation | Accurate wording |
| --- | --- |
| Online booking | “Continue to secure online payment. Your appointment awaits payment confirmation.” Show the amount returned by the server/hosted checkout; do not invent one |
| Pay at clinic | “Pay at the clinic. Check your appointment status for confirmation.” Do not say free/no charge |
| Slot reservation | “Your slot is held until [server expiry, Manila time] while you complete payment.” Before creation, availability reserves nothing |
| Return from checkout | “Checking payment status…” Then show “Payment received” only after the authorized API reports paid; keep Pending/error honest |
| Cancellation | “You can cancel online before the appointment starts and before check-in. Cancellation and refund status are separate.” Surface actual command refusals |
| Refund eligibility | “Eligible paid cancellations at least 24 hours before the visit are submitted for a full refund. Later cancellations and missed visits need clinic review. Refund completion depends on payment-provider confirmation.” |

**Needs clinic authorization:** exact approved booking/refund policy, any fixed reservation amount, excess-deposit disposition and how attendance-confirmation holds should combine with paid online bookings. Current settlement confirms an online booking after verified payment even when attendance policy flagged the Patient; this interaction should not be described as an independently approved new policy. No values were changed here.

Provider references used for refund-state verification: [PayMongo refund resource](https://docs.paymongo.com/reference/refund-resource), [retrieve a refund](https://docs.paymongo.com/reference/retrieve-a-refund), [idempotent requests](https://docs.paymongo.com/reference/idempotent-requests). Pending/processing are non-final; succeeded means the refund has been sent to the payment partner, not proof of the time it appears in a customer's account. Provider idempotency retention is finite (documented as 24 hours). Mocked calls validate application behavior, not live provider compatibility.

## F. Public content, release blocker and safe remediation

Public endpoints: `/api/public/branches` (open branch records, contact/location/hours), `/api/public/services` (active non-hidden services, descriptions/durations and consultation flag), `/api/public/faq` (active, non-draft, global assistant answers plus policy/HMO metadata), `/api/public/closures` (active confirmed closures in the next 60 days, at most 20, including reason/partial hours). Public branding/settings are also clinic-managed; a UI redesign is not content verification.

Owner writes to `/api/assistant-answers` and revision-checked PATCH `/api/assistant-answers/{public-id}`. An Owner-created answer defaults to active/confirmed unless explicitly marked draft. That is the existing Owner-as-publisher design, **not** proof that each stored answer was separately reviewed by a second person. Staff/Dentist/Patient publication is forbidden. A draft or inactive entry never appears in public FAQ; branch-specific answers are not global public FAQ. Audit entries record the action/changed fields, not answer text.

Owner creates closures; an Owner-created active closure's reason is public immediately. Holiday suggestions remain non-public until confirmed. PATCH closure actions remove/confirm/dismiss retain the row and audit. There is no independent text-approval gate or profanity/test-content classifier, and none was invented. These controls cannot make a deliberately Owner-published test string clinic-approved content.

**Release blocker:** reported inappropriate public FAQ/closure text must be corrected and checked again before public release. Exact current IDs/content are **Not verified** because the QA API URL was not supplied; no clinic DB was queried to guess them. The new synthetic publication tests are not evidence that real records are clean.

Safe Owner-authorized procedure:

1. Capture read-only public FAQ/closure responses and inventory each exact public ID, current text, branch/date and publication state. Review services/branch descriptions/branding as well. Avoid patient data.
2. For a bad FAQ, fetch its current administrative revision. Owner PATCH `{expected_revision, active:false}` (retain/audit), prepare reviewed text as a draft, then publish with the current revision only after approval. Do not bulk-delete or rerun seeders.
3. For an invalid test closure, Owner may PATCH `{action:"remove"}` after approving the effect on booking availability. Removal retains history. For a legitimate closure with only a bad reason, **do not remove it merely to hide text**: the current API cannot edit the reason, and a removed row can still block recreation by its unique key. Coordinator must approve a targeted audited correction path before changing that record; no manual SQL was executed here.
4. Verify the corrected public responses unauthenticated and recheck booking calendar behavior. Update publication acceptance evidence only after that verification; no QA tracker was edited in this batch.

## G. Validation and review stop

All claims above distinguish code/fixture evidence from clinic data and external-provider acceptance. No deployment, shared-branch update or production operation is part of this batch.

### Exact change inventory

| File | Purpose |
| --- | --- |
| `backend/app/Services/Appointments/AppointmentService.php` | Preserve Pending holds on reschedule; prevent manual payment-hold confirmation; require a confirmed online price; truthful refund history |
| `backend/app/Services/Payment/PayMongoService.php` | Payment-level replay/terminal-state protection; confirmed price only; verifiable refund states, reference reconciliation and provider idempotency |
| `backend/app/Services/Scheduling/SchedulingService.php` | Apply online service restrictions to shared Patient slot validation |
| `backend/app/Services/Automations/AttendancePolicy.php` | Remove unsupported cancellation/no-fee promises from public policy text |
| `backend/tests/Feature/Payment/AppointmentBookingPaymentTest.php` | Eight added regressions; existing fixture now has an authoritative confirmed price rather than relying on reference metadata |
| `backend/tests/Feature/Treatments/TreatmentTest.php` | One added same-day/equal-time pagination and privacy regression |
| `backend/tests/Feature/Appointments/PatientBookingContractTest.php` | Five new assignment, availability, leave, status and authorization regressions |
| `backend/tests/Feature/Reference/PublicContentPublicationTest.php` | Four new publication/authorization/audit/public-copy regressions |
| `docs/DEV_A_01_BACKEND_HANDOFF.md` | Contracts, evidence, limitations and integration actions |

Eighteen tests were added. Existing assertions were not weakened. The restricted-service fixture explicitly sets the protected catalog fields and supplies a valid consultation-service link; it asserts the persisted mode before checking slots.

### Commands and evidence

Run backend commands from the isolated worktree's `backend/`, with its ignored synthetic `.env.testing` and the inspected `TEST_SCRATCH_SERVER_ADDRESS` value. Do not run these commands against the clinic/QA database.

```powershell
php vendor/bin/phpunit --colors=never
php vendor/bin/phpunit tests/Feature/Appointments tests/Feature/Payment tests/Feature/Visits tests/Feature/Staffing tests/Feature/Reference tests/Feature/Treatments tests/Unit/GeminiScratchGuardTest.php --colors=never
```

- Full backend run: **956 tests, 913 passed, 42 failed, one error; 10,376 assertions; 23m27s**. This was before the final restricted-service test/guard was completed, so it is not a full-suite claim for the final revision. Full suite is **not green**.
- Broad targeted run (appointments, payments, visits, staffing, reference, treatments and scratch-guard unit tests): **305 tests, 304 passed, one failed, no errors; 2,664 assertions; 3m54s**. All eighteen added tests passed. The sole failure was the unchanged Waiting-start contract conflict reproduced on baseline. After this run, the catalog guard was narrowed to preserve existing rescheduling; the final focused check below covers that last change.
- Red-phase payment regressions reproduced seven failures before the first fixes; refund-state regression separately reproduced pending being recorded as refunded. The corrected restricted-service fixture was also run against untouched baseline source and failed with nine slots instead of zero.
- To distinguish regressions from baseline, created a separate detached worktree at `2b9c891b0195198c970169fc6b752cdc038176b0`, with the same locked dependencies and isolated scratch settings. A temporary bootstrap remapped application/test class paths and verified them by reflection. Replayed all 43 full-run failure/error test names serially against that untouched source: **40 failures, one error, two passed**. No baseline tracked file was edited.
- The two replay passes were the account-recovery superseded-job timing test and concurrent queue numbering. The latter originally ran near Manila midnight/closing time and failed fixture schedule checks. They remain timing-sensitive, not defects represented as fixed by this batch.
- Frontend `npm test`: **988 tests, 983 passed, zero failed, five optional browser checks skipped**. `npm run test:smoke`: **16 PASS scenarios**, existing React list-key warnings. `npm run build`: passed, existing large-chunk warning. No frontend source was changed.
- `scripts/predefense-check.sh` executed with testing mode and explicit scratch database, without `--send`: **9 FAIL, 3 WARN**. API/frontend servers, worker, scheduler, real mail, provider credentials/tunnel and demo records were intentionally absent; settings/content checks were against synthetic test state. This is a failed deployment-readiness gate, not production smoke evidence. No live delivery/payment was attempted and no seeder was run to make this gate appear green.
- PHP parser/syntax, whitespace/secret checks, final targeted results and scratch shutdown are recorded in the final verification below.

Logs remain outside Git under `%TEMP%`: `dev-a01-backend-full.txt`, `dev-a01-baseline-replay.txt`, `dev-a01-availability-baseline-red.txt`, `dev-a01-final-regression.txt`, `dev-a01-final-reschedule.txt`, `dev-a01-frontend.txt`, `dev-a01-smoke.txt`, `dev-a01-build.txt`, `dev-a01-predefense.txt`. Synthetic test configuration, dependencies and local junctions are ignored; none is staged.

### Existing suite blockers requiring coordination

| Group | Full-run failures | Untouched baseline replay |
| --- | --- | --- |
| Analytics automation health | 1 | Same failure |
| AutomationControl / AutomationTruthfulness | 5 / 13 | Same 18 failures; retired monitor routes return 404 |
| Feedback / ConcurrentFeedback | 11 / 2, plus one error | Same; removed routes/table remain referenced by tests |
| QueueTest | 6 | Same; status/priority/readiness/fixture expectations conflict with baseline behavior |
| InterviewRoundTwo late-step ordering | 1 | Same ordering failure |
| TreatmentTest Waiting-start refusal | 1 | Same expected 422 vs actual 201 |
| AccountRecovery / ConcurrentQueueNumber | 1 / 1 | Both passed on replay; timing-sensitive |

Restoring removed modules or reversing a prior queue-policy change is outside this Patient booking batch. Coordinator must reconcile the approved scope and queue admission/priority requirements with these tests. Do not delete/skip tests or accept a green integration gate by weakening their expectations.

### Review readiness and remaining dependencies

Backend corrections and the Developer B contracts are ready for review; **integration/release acceptance remains blocked** by the suite conflicts, unavailable deployment smoke and unverified reported public content. Developer B must address the exact range/history/payment-return issues above and coordinate the consultation mapping/error handling. Clinic/coordinator decisions are still needed on financial wording, attendance/payment interaction and any audited edit path for a legitimate closure with a bad reason.

This worktree contains only the nine listed changed/new files, all unstaged; HEAD remains `2b9c891b0195198c970169fc6b752cdc038176b0`. No commit, push, merge or rebase was performed. Backend service edits may overlap any coordinator payment/scheduling work; compare these four services before integration. Developer B's assigned frontend paths have no overlap. The original A12 workspace and all its pre-existing local artifacts remain preserved.

### Final verification

- Final booking-contract + appointment-lifecycle run after preserving existing-service rescheduling: **23/23 passed, 162 assertions**, including hidden/consultation-first new-booking refusal and existing-appointment reschedule acceptance for both modes.
- Final PHP token parser: **441 files passed**. `git diff --check` passed. A secret-pattern scan covered all nine changed/new files; no private key, cloud access key, long provider key or application-key assignment was detected. No secret configuration was printed or staged.
- Stopped only `dental-dev-a01-scratch-20261031` after all database tests finished. Inspected status: exited; data remained configured as tmpfs with no persistent mounts. Restart/recreate and re-inspect identity before reproducing tests; do not substitute the clinic database. Docker Desktop and unrelated local files were left intact.
- Final Git inventory: six modified tracked files, three new untracked files, no staged changes; development branch/HEAD unchanged. Detached baseline worktree remains tracked-clean. Original A12 workspace remains tracked-clean with its existing untracked artifacts preserved. No commit, push, merge, reset, clean, stash or shared-branch update.

# Jaztin clinical implementation — November 15, 2026

Time zone: Asia/Manila. Scope: selected follow-up booking, durable recovery and immediate verified appointment-reference feedback. This is implementation evidence, not a new 68-item audit or a claim of production acceptance.

## Git and ownership

- Requested/published baseline: `a0725e645df6f8266c2bc4bebacc9d62dd18e7c1`; parent accepted source `df56fda57c640ea772f4d73417a17275657095de`.
- Origin: `https://github.com/ccadaverr/multibranch-dental-clinic.git`.
- Actual isolated worktree: `/private/tmp/dentalops-jaztin-qa-20261115`, branch `feature/jaztin-qa-20261115`.
- The initial directory was Joevan's historical AUD-10 worktree. Its source/branch was not edited. Existing Jaztin branch was attached at the exact baseline; no reset/cherry-pick/rebase/merge or historical source replay.
- Shared collaboration branch fetched and baseline existence/ancestry verified. User explicitly confirmed feature/PR previews cannot affect live services before publication.
- Final commits, remote tip and PR are reported in the session's final Git report. No collaboration/main merge or deployment is performed.

## Implemented and acceptance boundaries

**AUD-10 — locally accepted synthetic full-stack workflow; release default remains disabled.** Reused the baseline's transactional selected-task booking and journal instead of rebuilding it. Added missing requested-Dentist preservation, current capability discovery, exact authorized task review, original receipt recovery after reload/new sign-in, and observed-revision contact/close validation. Staff continues through the existing shared AppointmentForm. No clinical completion is inferred from booking.

The browser driver creates tasks through the authenticated Dentist API (not a newly built Dentist create screen), then uses actual Staff UI contact, booking, retry and review controls. Dentist task/appointment readback and Patient isolation are also exercised with authenticated browser requests. The Patient sees the actual appointment in My visits after reload. No external provider or real Patient is used.

**GEN-09 — partial, measured follow-up subset.** Original criteria in `FINALS-QA-REVISIONS.md` require measurable reductions across key check-in/appointments/records/prescription flows; no numeric threshold is specified. During this sprint, obtaining the verified appointment reference after booking previously required selecting Booked and choosing Review current task (two additional control activations). The final verified-receipt notice shows it with **zero further actions**. This compares the functioning local workflow before/after the feedback addition, not a fabricated functioning baseline path: baseline selected booking was disabled. Full GEN-09 remains partial; no new original QA closure is claimed.

**DEN-09 — retained, not newly closed.** Its actual original criterion is distinct labelled status colors readable under light/dark preferences. Existing accepted status classes are preserved. AUD-10 is a separate finding, not a 69th original QA. No other original QA ID is marked complete by these tests.

M6 Appointment Management and M15 Follow-Up Management retain their historical implementation classifications with this qualification: exact selected-task workflow accepted on an isolated local target; other running targets require explicit readiness/rollout acceptance. No academic DOCX was edited.

## API, persistence and safety

Versioned contract: [FOLLOWUP_BOOKING_API_V1](contracts/FOLLOWUP_BOOKING_API_V1.md).

- Existing `POST /api/appointments`: selected ULID + original revision + per-account key retain transactional linkage/replay. Requested Dentist is resolved from the task when omitted and cannot be substituted; final locked-task validation repeats that check.
- New Staff GETs: `/api/followups/booking-capability` and `/api/followups/{task}/booking-receipt`.
- Existing task GET now includes authorized Dentist identity. Task review uses this exact endpoint, not a capped Patient list requiring unrelated profile permission.
- Existing task PATCH accepts optional `expected_revision`; updated React contact/close callers supply it. A stale observed revision is refused under the task lock. Backward-compatible older clients may still omit it; no universal contact/close command receipt is claimed.
- Receipt recovery reads this account's latest original selected-booking journal for the exact task, with current account/auth/branch/appointment and Patient-link checks. It returns no key/hash/token/task reason and never creates/retries. Another Staff account cannot recover that journal. Current relationship/state remains separately labelled.
- Missing receipt is unresolved, not proof that a previous command failed. The existing frozen in-memory retry retains identical task/revision/key/intent; cross-reload recovery uses server evidence without storing Patient details or keys in browser storage.
- No migration/schema change. Existing foreign keys, task link/revisions/checks, command uniqueness, appointment exclusion constraints and sanitized audits remain operative. All four held migrations remain genuinely pending.
- No treatment/admission/financial/provider/notification policy change. No real email, HMO request or payment processor action.

## Executed verification

All PostgreSQL targets were newly provisioned Jaztin-owned loopback clusters. The runner checked actual host, port, database, physical data directory and cluster marker before writes. Normal target: `/private/tmp/jaztin-clinical-20261115c/target.json`, `127.0.0.1:55493`, only `dental_clinic_demo`/`dental_clinic_test`; 83 reviewed migrations, four holds excluded. No production or another developer's database was used.

| Check | Result / limits |
| --- | --- |
| Follow-up PostgreSQL files | **55 passed, 474 assertions**: SelectedFollowupRecoveryTest, SelectedFollowupBookingTest, FollowupExactReadbackTest, Follow03RevisionResponseTest |
| Final readiness/recovery hardening | **11 passed, 71 assertions**, rerun of the new recovery file, not 11 additional unique tests |
| Consolidated clinical PostgreSQL regression | **117 passed, 1,312 assertions** across appointment booking/authorization/lifecycle, follow-ups, treatment, clinical integration, visit settlement and prescription lifecycle/recovery |
| Real contention | **1 test, six scenarios passed**; 1,224 assertions including polling assertions. Fresh clone `/private/tmp/contention-6eb63f50/target.json`; committed synthetic fixtures, actual `pg_stat_activity` lock waiting, different keys, same key, closure while waiting, ordinary competitor, two distinct Staff accounts, and opposing overlapping-slot cycle without retry masking |
| Full PHP Unit directory | **246 passed, 1,158 assertions** |
| Full frontend Node suite | **1,834 passed, one inherited OWN-11 failure, eight skipped**, 1,843 total. No new failing identity; workforce behavior untouched |
| Focused follow-up client tests | **171 passed** across shared booking, clinical selection/review and durable recovery |
| Real local browser | **11 acceptance groups passed**. Final accepted journey log and `journey.json` under `/private/tmp/jaztin-clinical-20261115c/followup-browser-accepted`; actual React → Laravel → PostgreSQL |
| Existing shared-booking adversarial browser suite | **33 passed**, synthetic fixture; same-key/unknown/conflict, stale ownership, ordinary callers and five widths |
| Existing clinical page adversarial browser suite | **41 passed**, synthetic fixture; disabled capability, exact task readback, stale auth/branch/permissions, duplicate read guard, keyboard/focus and five widths |
| Runner safety tests | **14 passed** (`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -v`) |
| Smoke | Passed; existing React Table key warnings remain |
| Production build | Passed; existing bundle-size warning remains |
| `git diff --check` | Passed |
| `scripts/predefense-check.sh --local-only` | **Executed, exit 1: five environment/demo prerequisites fail**, detailed below. No full hosted/provider acceptance |

The real browser covers: Dentist-authorized creation; Staff observed-revision contact; exact non-oldest task; requested Dentist retained; duplicate-submit latch; deliberately discarded response **after real commit**; identical-key/payload keyboard retry; original receipt after reload and new authenticated Staff session; discarded committed response followed by reload **without retry**, then exact receipt recovery with one create; Dentist current readback remains Booked, not Closed; Patient My visits/readback after reload; another Patient denied; and immediate verified reference with no extra actions. Booking/recovery screens inspected at **375, 390, 430, 768, 1024 and 1440px** with no page/dialog horizontal overflow. Native screen-reader/device certification, all-role redesign and a WCAG certification are not claimed.

Predefense failures are accurately retained: no queue worker; no scheduler; only two synthetic Patients (fewer than dress-rehearsal expectation); no unpaid invoice fixture; synthetic acceptance branch intentionally lacks clinic phone/confirmed hours. Six warnings include omitted external checks, missing branch emails, inactive assistant answers and queued local email. Do not fabricate clinic contacts, create financial evidence or seed a dress rehearsal solely to turn this check green. The synthetic browser target is not a hosted/demo-release acceptance target.

The blanket historical backend Feature suite was not run: it includes reset-based/concurrency/held-migration suites outside the guarded schema profile. The nine explicit clinical regression files above and four follow-up files were executed in full. Four held queue-migration diagnostics remain unresolved, not weakened or claimed fixed.

## Verification setup corrections

The first older atomic fixture suite used `DatabaseMigrations` and left committed fixtures incompatible with the guarded profile; its private target `/private/tmp/jaztin-clinical-20261115b` is preserved for diagnosis, never reset. The runner now refuses such files before PHP execution, with a regression test. It also creates the clone's required `cache/test` directory. The existing synthetic visit fixture's early Console Kernel lookup was fixed to a fully qualified class name. None changes production business behavior.

Initial new tests incorrectly expected 404 instead of the existing Patient appointment endpoint's 403; the expectation was corrected, retaining non-disclosure assertions. Browser driver selectors were corrected to actual Staff navigation/field accessible names. Finished role contexts are closed before Patient readback to avoid unrelated polling on the single-worker local API. Earlier unsuccessful runs and synthetic records remain private and preserved. Existing tests were not weakened: changed fixture assertions now verify exactly one exact-task GET **and** one receipt GET; contact lifecycle assertions require the observed revision.

## Shared files and integration

Shared additions: two follow-up routes in `backend/routes/api.php`; three read functions in `src/api-client.js`; disabled release config in `backend/config/clinic.php` and `.env.example`; requested-Dentist preservation in the shared AppointmentForm. No `src/App.jsx`, `src/layout.jsx`, middleware, payment implementation, workforce endpoint or roster semantics changed. The generic local runner and synthetic fixture fixes are a separate logical commit for independent review.

Joevan dependency: none newly introduced. Existing scheduling service remains authoritative; future dated workforce API changes must be consumed through Joevan's reviewed contract. Do not merge this branch into Joevan's feature branch. No integration merge is performed without an accepted SHA/contract review.

Readiness: suitable for scoped PR/source review. Local synthetic AUD-10 acceptance passes. All other targets remain disabled by default; enable only after their schema/capability, PostgreSQL, contention, session and real browser gates pass. Inherited OWN-11 and predefense/hosted prerequisites prevent claiming an all-green integrated release. Concurrent scope/account revocation beyond existing middleware/service checks, legacy provider/move-up locking and external refund atomicity remain prior separate concerns.

Next owned batch: retain STF-10's single-refresh and STF-12's single keyboard-operable walk-in combobox while completing evidenced arrival/queue linkage/recovery defects. STF-11 auto-confirm/cancel-ID policy and STF-13 automatic find/create/admit remain subject to their existing reviewed-policy gates; GEN-06/DEN-03 still need actual reproductions. Broader GEN-09 measurements remain outstanding. No unresolved clinical chart, handover, lab or provider policy is invented.

Applied: Tesler (server journal resolves recovery complexity); Postel with strict identity/revision/receipt validation; Zeigarnik (uncertain outcomes remain visible and protected); Jakob (reuse the existing shared booking form). No fake success, urgency, clinical completion or clinic fact.

## Exact changed-file manifest

- `backend/.env.example`
- `backend/app/Http/Controllers/FollowupController.php`
- `backend/app/Services/Appointments/AppointmentService.php`
- `backend/app/Services/Followups/Followups.php`
- `backend/config/clinic.php`
- `backend/routes/api.php`
- `backend/tests/Feature/Followups/SelectedFollowupConcurrencyTest.php`
- `backend/tests/Feature/Followups/SelectedFollowupRecoveryTest.php`
- `backend/tests/Support/local_visit_fixture.php`
- `docs/JAZTIN_CLINICAL_SPRINT_20261115.md`
- `docs/contracts/FOLLOWUP_BOOKING_API_V1.md`
- `scripts/local-system.py`
- `scripts/tests/test_local_system.py`
- `src/api-client.js`
- `src/appointments-api.js`
- `src/pages/Scheduling.jsx`
- `src/pages/ServerFollowups.jsx`
- `tests/aud10-clinical-ui.browser.mjs`
- `tests/aud10-durable-recovery.test.js`
- `tests/fixtures/aud10-clinical-ui.html`
- `tests/local-followup.browser.mjs`
- `tests/yzh-clin-12-followup-lifecycle.test.js`

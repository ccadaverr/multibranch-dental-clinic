# JOE-QA-02 backend integration acceptance

Developer A: Joevan. Authorized reviewer: Yzhekiel. Started 2026-11-02, Asia/Manila.

**Final disposition: audit evidence available for Yzhekiel's review; overall integration acceptance is not ready for sign-off.** Focused backend acceptance passed (306 tests); the final full backend suite has 38 failures and one error, all independently reproduced on the untouched baseline. Clinical requirement conflicts, Developer B integration work and deployment/policy dependencies remain open. This report separates source findings, synthetic PostgreSQL route tests, simulated provider responses, frontend checks, and deployment acceptance. No production/clinical certification or live provider acceptance is claimed.

## A. Repository baseline

- Workspace: `C:\Users\Joevan Delos Santos\Documents\dental-clinic-a-qa-20261102`.
- Branch: `qa/joevan-backend-20261102`.
- Expected and observed HEAD: `a6a0de5bf36c77a43d948b98f821940bac41df3d`.
- Initial index/worktree: clean, including untracked files. Mandatory preflight executed: `git branch --show-current`, `git rev-parse HEAD`, `git status --porcelain=v1 -uall`, `git diff --stat`, `git diff --check`, `git diff --cached`. `git log --oneline -30` and merge parents inspected.
- Integrated ancestry: `4005d25` integrates backend `cc5e8f6`; `572327d` integrates Patient Portal `714a9a5` and reconciles attendance wording; `a6a0de5` integrates Dentist workspace `3322b8f`.
- `git diff 2b9c891 HEAD -- backend` contains 14 files (551 insertions, 26 deletions). Actual controllers, validators, services, routes and tests inspected. **`git diff cc5e8f6 HEAD -- backend` is empty:** the integrated backend is exactly Developer A's committed backend. This establishes source identity, not compatibility or runtime acceptance.
- AttendancePolicy matches A's complete wording, including dynamic hours/strike/window settings and the distinction between cancellation and refund. There is no unresolved merge conflict in that file and no new attendance-policy implementation is needed.
- Continuation preflight confirmed the same branch/HEAD, nothing staged, and exactly the four newly added acceptance-test files. No external edits were detected. Those files were preserved.
- Historical DEV-A/R1, DEV-B/R1, DEN-UI-02 and QA reports were read as prior evidence. The DEN-UI-02 finding that Waiting could start treatment describes its pre-integration checkout: current R1 already corrects that guard. It was not reimplemented.
- For independent failure comparisons, `git archive 2b9c891` was expanded into `%TEMP%/joe-qa02-baseline-2b9c891`, with its own lockfile-installed dependencies. This is a separate source export, not a new/changed Git worktree. No baseline production source was patched and no existing worktree was switched or reset.

## B. QA traceability

Historical `done` fields and checked primary tasks are retained as historical evidence. They do not certify every literal sentence in the original tracker. Current contradictions are identified explicitly rather than silently rewriting requirements.

| QA ID | Historical status | Actual contract | Verified evidence | New action required |
| --- | --- | --- | --- | --- |
| GEN-05 | Done | No active kiosk surface/route; counter registration remains distinct. Historical migrations/documents are retained. | Source scan of `backend/app`, `backend/routes`, `src` found only the stale `counter QR / kiosk` comment in `src/api-client.js`; no active kiosk implementation found. Frontend suite/smoke/build pass. | No repeated removal. Literal zero-word occurrence is not true; historical exceptions already appear in the tracker. Comment cleanup is Developer B-owned and unnecessary to backend acceptance. |
| STF-14 | Done; claims Waiting/Called/Ready/Away removed and data migrated | Runtime admission still creates Waiting; Call/Ready/Away/Return remain. Clinical start requires Called/Ready; queue Served means start, not completed care. | `QueueEntry`, `QueueService::TRANSITIONS/enqueue/serve`, TreatmentService, frozen CONTRACTS, existing/new treatment regressions. | **Actual contradiction:** Yzhekiel must reconcile the simplified-status QA claim with the clinical contract and retained database vocabulary. No state deletion, migration or historical rewrite in this assignment. |
| STF-15 | Done | Persisted/request `priority` is Normal or Priority; positions sort exact arrival then queue number. Urgent priority is rejected. | QueueEntry constants, QueuePriorityRequest, QueueService::positions, migration `2026_11_16_000500`. | Preserve FIFO implementation. Frozen CONTRACTS still specifies priority ordering; `category: Urgent` and old comments remain. Distinguish a category from persisted priority; reconcile documentation/old tests with the approved decision. |
| STF-20 | Done | Staff inquiry creation derives the profile branch or sole authorized scope; explicit different profile branch is refused. Shared service checks authorization scope. | InquiryController::store/index, InquiryService, InquiryTest. | No reimplementation. Multi-scope staff without a profile branch require explicit context; no arbitrary first-branch fallback. |
| OWN-13 | Done | Owner can filter queue by branch; Staff scope precedes filters; Dentist sees own queue. Owner retains documented operational exceptions, no treatment-start authority. | QueueController, QueueEntry::visibleTo, QueueEntryPolicy, TreatmentPolicy and queue/treatment tests. | State-language acceptance depends on STF-14 reconciliation; do not turn Owner oversight into clinical authority. |
| STF-18 | Done | Payment-method field and real payment methods coexist with Invoice as the canonical billing document/entity. | `src/pages/FinanceCommunication.jsx`, BillingService/PayMongoService, billing/payment tests; no source edit. | Do not globally rename/remove invoices to satisfy the historical literal wording. No new payment method or fee introduced. |
| STF-19 | Done | Managed accepted-HMO records; public results require active + clinic-verified; Owner revision-checked management. | Accepted HMO routes/controller, PublicContentPublicationTest; seed source includes the five requested spellings. | Current deployed list is unverified because no shared/clinic DB was read. Seed comments and historic five/six-provider lists are not proof of deployed clinic content. No seed/data mutation. |
| OWN-11 | Done | Dentist weekly schedules/exceptions constrain booking; Staff basic branch/shift fields are editable through existing reference commands and displayed alongside Dentists. | WorkScheduleController, WorkSchedules, Staff reference update contract, `src/pages/Staffing.jsx`, staffing/reference tests. | Preserve the narrower implemented Staff shift support; do not claim Staff weekly-exception parity or invent leave/coverage policy. |
| GEN-10 | Support unchecked; later presentation acceptance Partial | Account-owned latest 50 notifications, total unread count, read-one/read-all; Manila timestamps. No unread-reset or archive/delete/restore endpoint. | NotificationController/NotificationCenter, PatientPortalApiTest, new NotificationIntegrationTest; A10 presentation evidence is explicitly browser-store only. | **Partial**, not Done. GEN-11 archive/restore semantics and operational-shell server-feed integration remain separate dependencies. |
| STF-05 | Support unchecked; master primary Done | Patient chart GET includes aggregate `summary`; authorized Staff read, Dentist record, Patient safe subset; Owner clinical access denied. | DentalChartController projection and DentalChartTest summary/role tests. | Stale support checkbox: backend summary is implemented; retain limits and do not invent a second endpoint. |
| STF-23 | Support unchecked; later A2 accepted | Scoped conversation/message `q` search; encrypted authorized bodies scanned in bounded chunks, paginated matches, rate limit. | MessageSearchTest, ConversationController; RIC2 acceptance linked in this tracker. | Stale support checkbox; no search rewrite. Large production-history performance/live transport remain unmeasured. |
| OWN-01 | Support unchecked; later A4/A5 accepted | Daily gross collections/refunds/net cash flow; Monday–Saturday histogram, on-demand, not profit or an immutable scheduled report. | AnalyticsController/AnalyticsService, AnalyticsComparisonTest, OWN01_A4/A5 acceptance. | Stale support checkbox. Retired automation-health test failures are separate from revenue acceptance. |
| OWN-02/03 | Support unchecked; later A3 accepted | Owner branch code updates with uniqueness; coordinate pair with Philippine bounds. UI preset list is not a new backend enum. | UpdateBranchRequest; OwnerBranchAcceptanceTest; OWNER_BRANCH_A3 acceptance. | Stale support checkbox for existing update contracts. No branch-creation, geocoding or live map availability claim. |

The original seven-day-plan checkboxes are scheduling history, not a current missing-feature inventory. GEN-10's compound checkbox cannot be completed while archive semantics are absent. Other developers' trackers and FINALS-QA-REVISIONS were not changed.

## C. State-machine reconciliation

### Authority and common command behavior

Approved clinical requirements come from `docs/architecture/CONTRACTS.md` Visit/Queue/Treatment tables and exact encounter ownership, not the historical STF-14 simplification sentence. Runtime source is evidence of what currently happens. The two disagree over vocabulary/order; this report does not rewrite approval history to fit code.

All paths below are `/api/...`, authenticated and account-revalidated. Staff operational authorization uses `user_branch_scopes`; operational assignment alone is insufficient. Dentist clinical authorization currently uses the Visit's responsible Dentist/person and Treatment author, **not a fresh dentist-branch membership check**. Appointment/Visit/queue relationships derive from server records; identity override fields are prohibited. No generic clinical status PATCH exists.

`IdempotentCommand` scopes a key to the account and hashes command + payload. Exact key/payload returns the stored original status/body with `Idempotent-Replayed: true`; changed intent with that key returns 422 `idempotency_key_reused`. Failed transactions retain neither successful command key nor partial clinical mutations. Revision conflicts are 409. Replays are historical command results, so clients must refresh current records rather than treat a replayed revision as the newest state.

### Transition matrix

| Action | Actor / branch / Dentist relationship | Allowed source | Result | Server command | Expected revision | Idempotency / duplicate | Failure | History / audit effect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Book | Patient self/active dependent; scoped Staff or Owner; eligible branch/service/Dentist | No appointment | Confirmed/unpaid, Pending attendance hold, or Pending/payment held | POST `appointments`; AppointmentService::create | None | Optional key; same intent replay; DB overlap exclusion | 401/403 identity, 422 schedule/config, 409 race, 502 provider | appointment.created; confirmation intent only when applicable |
| Confirm attendance hold | Scoped Staff / Owner | Pending, not payment-held | Confirmed | POST `appointments/{id}/confirm` | Appointment | Same target is a no-op; optional key | 403, 409 stale, 422 booking_payment_pending/invalid_transition | appointment.confirmed on change |
| Reschedule | Own/active dependent Patient, scoped Staff / Owner; Patient retains Dentist/branch/service | Pending / Confirmed | Same status; new validated time; payment expiry unchanged | POST `appointments/{id}/reschedule` | Appointment | Optional key; exact unchanged schedule no mutation | 403, 409, 422 schedule/state | appointment.rescheduled, notification intent |
| Cancel before admission | Own/active dependent Patient, scoped Staff / Owner; Patient before start | Pending / Confirmed, no Visit | Cancelled; payment state follows separate refund rules | POST `appointments/{id}/cancel` | Appointment | Already Cancelled no-op; optional key | 403, 409, 422 admitted/started/terminal | appointment.cancelled; attendance/financial events as applicable |
| No-show | Scoped Staff / Owner; same clinic day; no Visit | Pending / Confirmed | No-show | POST `appointments/{id}/no-show` | Appointment | Target no-op; optional key | 403, 409, 422 not_today/admitted/state | appointment.no_show, attendance strike, paid deposit forfeiture event |
| Scheduled check-in | Scoped Staff / Owner; today; appointment determines exact Patient/branch/Dentist | Appointment Pending / Confirmed; no existing Visit/active Patient Visit | Appointment Checked In, Visit Checked In r1, queue Waiting r1 | POST `visits/check-in`; VisitService::checkInScheduled | Appointment | Required key; existing Visit conflict | 403, 409 duplicate/stale, 422 date/state | appointment.checked_in, visit.checked_in, queue.entered/entered_late |
| Walk-in admission | Scoped Staff / Owner; selected branch, eligible optional Dentist | No active Patient Visit | Visit Checked In r1; Waiting queue if Dentist resolved; no appointment | POST `visits/walk-in`; VisitService::walkIn | None | Required key; duplicate active Visit guarded | 403, 409 active Visit, 422 eligibility | visit.checked_in; queue.entered if assigned |
| Call | Scoped Staff / Owner, or queue's own Dentist | Waiting | Called | POST `queue/{id}/call`; QueueService::transition | Queue entry | Required key; already Called returns current entry before revision check | 403, 409 stale, 422 invalid_transition/not_today/unavailable | queue.called |
| Ready | Scoped Staff / Owner | Called | Treatment Ready | POST `queue/{id}/ready` | Queue entry | Required key; target no-op | 403, 409 stale, 422 state/date | queue.ready |
| Away | Scoped Staff / Owner | Waiting / Called / Treatment Ready | Temporarily Away | POST `queue/{id}/away` | Queue entry | Required key; target no-op | 403, 409 stale, 422 state/date | queue.away |
| Return | Scoped Staff / Owner | Temporarily Away | Waiting; original arrival retained | POST `queue/{id}/return` | Queue entry | Required key; target no-op | 403, 409 stale, 422 state/date | queue.returned |
| Priority metadata | Scoped Staff / Owner | Checked In Visit; nonclosed, not Called/Ready | Status unchanged; Normal/Priority; FIFO unchanged | POST `queue/{id}/priority` | Queue entry | Required key; identical metadata no-op | 403, 409 stale, 422 invalid priority/already_called | queue.priority_changed history + administrative audit |
| Restore late flag | Scoped Staff / Owner | Checked In, nonclosed, today, late flag set | Same queue state; late flag false | POST `queue/{id}/late-order` | Queue entry | Required key; already restored no-op | 403, 409 stale, 422 date/state/reason | queue.late_order_restored + administrative audit; FIFO currently ignores late flag |
| Start treatment | Responsible Dentist only; server Visit/appointment context | Visit Checked In; appointment Checked In if linked; queue Called/Ready; no Treatment for Visit; no other active Treatment for Dentist | Queue Served + Visit In Treatment + appointment In Treatment + one Treatment In Treatment r1, atomic | POST `visits/{id}/treatment`; TreatmentService::start → QueueService::serve → VisitService::applyClinical | **Visit**, not queue | Required key; same-key replay 201; new-key duplicate 409 treatment_exists | 403 wrong actor; 404 unknown Visit; 409 stale/dentist_busy; 422 queue_not_ready/appointment_mismatch/invalid_transition | queue.served, visit.treatment_started, appointment.treatment_started, treatment.started; minimal clinical audit |
| Save documentation | Authoring Dentist still responsible for Visit | Treatment In Treatment | Same state; documentation/lines and revision change | POST `treatments/{id}/document` | Treatment | Required key; identical document no new revision/history | 403 author; 409 stale; 422 completed/invalid procedures | treatment.documented immutable snapshot; no clinical text in general audit |
| Complete | Authoring Dentist still responsible; valid branch/service/Dentist procedure lines | Treatment/Visit/appointment In Treatment; summary + at least one line | Treatment/Visit/appointment Completed; queue stays Served | POST `treatments/{id}/complete` | Treatment | Required key; already Completed no-op before revision check | 403, 409 stale, 422 encounter mismatch/summary/lines | treatment.completed + visit/appointment completion histories; minimal audit; existing requested follow-up task creation |

### Database and clinical boundary findings

- One Visit per appointment, one active Visit per Patient, one queue entry per Visit, one Treatment per Visit, and one active Treatment per Dentist are database-backed constraints. ConcurrentTreatmentStartTest races separate PHP/PostgreSQL connections and checks commit-time consistency. Treatment/history/completed-procedure immutability triggers remain intact.
- Visit states are only Checked In / In Treatment / Completed. Cancellation/no-show after admission has no approved Visit transition; do not invent one. A cancelled appointment cannot legitimately create a new Visit through check-in; an inconsistent linked cancelled/completed appointment is refused at treatment start.
- Current queue domain accepts both legacy clinical-flow values and In Queue / In Treatment / Done / Cancelled / No-show. Only the Waiting/Called/Ready/Away/Served path has runtime transition commands. **In Queue cannot be Called or started through the present commands.** Existing rows in those alternate states require a reviewed reconciliation, not a client-side rename.
- Migration `2026_11_16_000500` maps old queue rows into alternate states but retains both vocabularies in the constraint. Its `up()` also issues new-value UPDATEs before replacing the old status constraint. This is a **source-only populated-migration risk**, not an executed repair or proof about any existing clinic rows. Fresh-schema test migrations do not prove a populated upgrade is safe.
- `TreatmentPolicy::start/author`, QueueEntryPolicy::ownQueue and TreatmentService do not recheck a removed Dentist branch assignment. `QueueService::serve` checks the linked queue's status but does not compare its queue branch/Dentist/date against the Visit. Admission creates canonical links and there is no public generic rewrite command; that is not proof of revocation or malformed persisted-link refusal. These are explicit acceptance limits for Yzhekiel, not new silently imposed clinical policies.
- Frozen queue priority-order wording conflicts with current FIFO and the historical STF-15 decision. Priority/order changes are outside this correction batch.

**Proposed lead resolution:** retain Called/Ready as server prerequisites and Served as queue departure at clinical start; correct STF-14's historical completion claim and presentation-language mapping through reviewed documentation. Separately decide how legacy alternate-state rows, revoked Dentist assignments, and historical clinic dates are handled. Approve a data-preserving transition plan before any migration; never map queue Served to completed treatment merely by label.

### Executed clinical acceptance coverage

All entries below passed in the focused PostgreSQL run: **44 Treatment tests / 734 assertions**. Queue operation calls used real routes, not direct calls to the implementation under test; deliberately invalid persisted states are explicitly fixture setup. Separate-process tests exercise committed constraints.

| Required case | Executable evidence | Observed contract |
| --- | --- | --- |
| Waiting / In Queue start | ClinicalIntegrationAcceptanceTest::test_unready_queue_states_cannot_start_or_write_clinical_history | 422 queue_not_ready, no Treatment/history/audit or lifecycle mutation |
| No check-in | ClinicalIntegrationAcceptanceTest::test_no_check_in_means_no_visit_to_start; linked-appointment data provider | 404 absent Visit; 422 appointment_mismatch for a non-Checked-In linked appointment |
| Wrong Dentist / wrong branch / direct Visit ID | ClinicalIntegrationAcceptanceTest::test_direct_foreign_visit_and_forged_branch_do_not_bypass_authorization; TreatmentTest::test_only_the_responsible_dentist_starts_and_other_roles_and_identifiers_are_refused | Same-branch other Dentist, other-branch Dentist, Staff, Owner and foreign Patient refused; client branch override 422. This does not cover revoked assignment or corrupt canonical links. |
| Stale revision | TreatmentTest::test_start_refusals_leave_everything_unchanged | 409 stale_revision, no Treatment |
| Duplicate start | ClinicalIntegrationAcceptanceTest ready-state cases; TreatmentTest::test_duplicate_start_replays_or_conflicts_and_never_creates_a_second_treatment | Same key replays one 201 result; new key 409 treatment_exists; altered payload with same key 422 |
| Concurrent same Visit / second active Treatment | ConcurrentTreatmentStartTest::test_two_tabs_starting_the_same_visit_create_one_treatment; test_one_dentist_cannot_start_two_treatments_at_once_and_real_commits_stay_consistent | One committed Treatment per Visit; one active Treatment per Dentist; losing request conflicts |
| After cancellation/completion | ClinicalIntegrationAcceptanceTest unready and appointment-mismatch providers; TreatmentTest::test_a_completed_treatment_is_closed_to_every_command_and_the_database_agrees | Cancelled/No-show queue refuses start; Cancelled/Completed linked appointment refuses inconsistent start; completed clinical evidence immutable |
| Valid Called / Treatment Ready | ClinicalIntegrationAcceptanceTest::test_call_and_ready_start_once_with_exact_state_revision_and_audit_propagation | Staff Call/Ready succeeds, assigned Dentist creates exactly one Treatment; Served queue, In Treatment Visit/appointment, correct revisions and one start audit |
| Completion propagation / rollback | TreatmentTest::test_completion_requires_summary_and_a_line_then_completes_visit_and_appointment; test_a_failure_while_starting_rolls_back_queue_visit_appointment_and_treatment | Atomic progression/rollback; completion requires documented performed care; no clinical or financial inference from a queue label |

There is no generic queue Serve/Complete/Cancel/No-show endpoint: the retired paths are 404 in QueueTest. Clinical completion is exclusively a Treatment command. This is an authoritative description of current executable behavior, subject to the documented requirement contradictions above.

## D. Confirmed defects and corrections

No production application source has been changed. R1's already integrated corrections are preserved. New backend tests add missing negative/positive evidence without changing existing assertions:

- `ClinicalIntegrationAcceptanceTest.php`: Waiting/In Queue/Away/Cancelled/No-show refusal; Called and Ready propagation and replay; non-Checked-In appointment mismatch; foreign direct Visit/branch injection; missing check-in.
- `BookingSessionAcceptanceTest.php`: real login and guard refresh, account suspension, dependent revocation after search/create, and unlinked/other-role quotation denial.
- `RefundIntegrationAcceptanceTest.php`: pending/processing/failed refund truth, reference reuse, wrong reference/amount/status refusal and unchanged clinical state, using only fake HTTP.
- `NotificationIntegrationTest.php`: identity isolation across all four roles, read retry semantics, duplicate event deduplication, Manila midnight dates, savepoint failure isolation.

All four new files passed together: **26 tests, 241 assertions**. Frontend mismatches are assigned to Developer B in section F; no frontend file or other QA tracker is modified.

### Account-recovery test harness correction

`backend/tests/Feature/Auth/AccountRecoveryTest.php::test_a_code_replaced_before_its_job_ran_is_not_sent` launched a long-running worker inside PHPUnit without an explicit memory budget or exit assertion. Laravel's worker default is 128 MB, while `phpunit.xml` permits 1024 MB. The full process exceeded the worker budget: after consuming the obsolete job, the worker exited before consuming the replacement job. The failed mail status assertion was valid; the assumed worker completion was not.

- Before correction, the complete isolated class passed **23 tests / 195 assertions**. The unmodified full suite failed with `['superseded', 'pending']` instead of `['superseded', 'logged_only']`.
- A temporary subclass allocated 144 MB of synthetic memory and subscribed to `WorkerStopping`. The same single test failed with the same pending message. The captured event was **exit 12, reason memory, one job processed, 208 MB used, 128 MB limit**.
- Correction: give this in-process worker `--memory=1024`, matching PHPUnit; assert successful exit and assert both jobs and failed_jobs are empty. Existing status and exactly-one-mail assertions remain unchanged. No authentication, session, queue production configuration, or delivery semantics changed.
- The identical memory-pressure probe then passed **1 test / 7 assertions**, with **exit 0, reason empty, two jobs processed, 208 MB used, 1024 MB limit**. The corrected class passed 23 tests / 198 assertions in the focused run; the target also passed with 7 assertions in the final full suite at 160 MB peak process memory.
- Classification: **test-order/resource-dependent test harness failure**, independently reproduced before correction. Database residue, session/guard caching, fake time, and mock contamination were considered; controlled process memory alone reproduces this failure with fresh application/database setup. This does not prove unrelated tests have no such problems. Existing transactions and mail fakes were retained.

The owner-summary mail-content predicate failed once in the original full run but passed in the baseline selection, current isolated run (1 test / 4 assertions), and final full run. No application defect is established. Its aggregate predicate and randomly generated fixture names make the failed condition ambiguous; it remains a separate unresolved intermittent/order-dependent finding, not a silently changed expectation.

A final temporary diagnostic subclass ran the entire AutomationsTest class: **18 passed / 132 assertions**. The summary predicate's individual conditions were all correct: Owner recipient, expected date, one booking, no synthetic Patient name or email; aggregate data agreed with rendered output. The diagnostic did not reproduce the original failure and does not prove its cause. No automation source/test expectations were changed.

## E. Backend test classification and environment

### Disposable database verification

- Docker initially stopped. Started installed Docker Desktop hidden; existing stopped containers were not started or changed.
- New container: `joe-qa02-scratch-20261102`, ID `8a2abd26d9d77c2fa04d5b34644ab08758ddfdc777a2fed98f9a3f61e8c13f63`, image `postgres:16` (locally installed image ID `1a6ab3f5345e`). `Mounts=[]`; tmpfs `/var/lib/postgresql/data:rw`; host binding only `127.0.0.1:5432`; inspected server address `172.17.0.2` for this run only.
- Before writing tests, Laravel bootstrap + unchanged ScratchDatabaseGuard verified `APP_ENV=testing`, default `pgsql`, no DB URL, actual `dental_clinic_scratch`, actual server address `172.17.0.2`, server port 5432, **zero public tables**. Container identity was checked before connecting; no earlier IP/port was assumed.
- Guard refuses wrong environment, connection, database, host/port, URL, and actual server identity before RefreshDatabase. Database-free guard tests passed **4 tests / 13 assertions**. No guard weakened.
- Ignored local `.env.testing` was newly created with a random synthetic application key, scratch-only connection, array mail/cache, sync queue, null broadcasting, and localhost Sanctum origins. No clinic `.env` exists in this checkout. Credentials/provider/mail/database environment overrides are cleared by the temporary runner; provider tests configure fictional keys/fake HTTP. No secret value is included here.
- Each database suite/replay is serialized. Existing concurrency tests intentionally use child processes against this same verified disposable instance. Migrations/seeding by tests affect synthetic scratch state only. No production/shared/clinic DB, live payment/refund/webhook, real prescription or patient record operation occurred.
- After the last diagnostic, reinspection confirmed the same container ID, empty Mounts, tmpfs-only data and loopback binding; no PHP test process remained. Stopped **only that ID** with `docker stop`; final state exited, code 0. Existing containers remained stopped with their earlier exit ages. The new stopped container is retained; ephemeral synthetic database contents are discarded with tmpfs. Reinspect/recreate a disposable instance before any future test; do not reuse the recorded address blindly.

### Commands and evidence

Temporary runner: `%TEMP%/joe-qa02-test.ps1`, launches `php vendor/bin/phpunit` from this checkout's backend after sanitizing environment. Its process values are `APP_ENV=testing`, `DB_CONNECTION=pgsql`, `DB_HOST=127.0.0.1`, `DB_PORT=5432`, `DB_DATABASE=dental_clinic_scratch`, `DB_USERNAME=postgres`, no DB_URL/password, `TEST_SCRATCH_SERVER_ADDRESS=172.17.0.2`, `PAO_DISABLE=true`, array mail, null broadcasting. Reinspect the container before reusing any command; these recorded values are not permission to connect to an arbitrary listener.

| Check | Result | Evidence kind |
| --- | --- | --- |
| `composer install --no-interaction --prefer-dist --no-scripts` | 135 locked packages installed; Laravel 13.33.0, PHPUnit 12.5.35, PHP 8.3.33 | Tooling only; no Composer application scripts |
| `php vendor/bin/phpunit tests/Unit/GeminiScratchGuardTest.php --colors=never` | 4 passed, 13 assertions | Database-free guard tests |
| `php vendor/bin/phpunit --colors=never --log-junit %TEMP%/joe-qa02-full-before.xml` | **963 tests, 10,497 assertions; 922 passed, 40 failures, 1 error**, exit 2, 16:56.470 | Unmodified integrated backend; PostgreSQL + fakes; not browser E2E |
| `php vendor/bin/phpunit --colors=never --log-junit %TEMP%/joe-qa02-full-final.xml` | **989 tests, 10,741 assertions; 950 passed, 38 failures, 1 error**, exit 2, 14:50.462, peak 160 MB | Final source; all 39 nonpassing cases reproduced on baseline; account recovery and owner summary pass |
| `php vendor/bin/phpunit tests/Feature/Treatments/ClinicalIntegrationAcceptanceTest.php tests/Feature/Appointments/BookingSessionAcceptanceTest.php tests/Feature/Notifications/NotificationIntegrationTest.php tests/Feature/Payment/RefundIntegrationAcceptanceTest.php --colors=never --log-junit %TEMP%/joe-qa02-new.xml` | **26 passed, 241 assertions**, 16.529 seconds | New authenticated kernel-route / synthetic PostgreSQL tests; provider HTTP fake |
| `php vendor/bin/phpunit tests/Feature/Auth/AccountRecoveryTest.php --colors=never --log-junit %TEMP%/joe-qa02-account-isolated.xml` | **23 passed, 195 assertions**, before correction | Isolated class; does not establish full-process equivalence |
| `php vendor/bin/phpunit %TEMP%/AccountRecoveryMemoryProbeTest.php --filter test_a_code_replaced_before_its_job_ran_is_not_sent --colors=never` | Before: **1 failure / 3 assertions**; after: **1 pass / 7 assertions** | Controlled memory-pressure reproduction; worker exit event captured |
| Untouched `2b9c891` export: `php vendor/bin/phpunit --filter $qaFilter --colors=never --log-junit %TEMP%/joe-qa02-baseline-failures.xml` | **41 tests, 118 assertions; 2 passed, 38 failures, 1 error**, exit 2 | Independent baseline replay of all 41 originally failing names |
| `php vendor/bin/phpunit tests/Feature/Automations/AutomationsTest.php --filter test_the_owner_summary_goes_once_at_the_send_time_with_numbers_and_no_patient_names --colors=never` | **1 passed, 4 assertions** | Does not resolve the original full-run failure |
| `php vendor/bin/phpunit %TEMP%/OwnerSummaryDiagnosticTest.php --colors=never` | **18 passed, 132 assertions**, 20.388 seconds | Temporary subclass runs original automation class unchanged and records individual summary predicate conditions |
| `php vendor/bin/phpunit tests/Feature/Treatments tests/Feature/Appointments tests/Feature/Payment tests/Feature/Auth tests/Feature/Notifications --colors=never --log-junit %TEMP%/joe-qa02-focused.xml` | **306 passed, 2,639 assertions**, 3:47.989 | Authenticated Laravel kernel routes, guarded PostgreSQL, fake provider; includes separate-process clinical/booking races |
| `php vendor/bin/phpunit %TEMP%/QueueBackfillTimezoneProbeTest.php --filter test_backfill_uses_server_visits_only_and_is_idempotent_and_reversible --colors=never` | **1 passed, 9 assertions** | Temporary copy changes only raw fixture timestamp serialization, not expectations; no repository test changed |
| `php %TEMP%/joe-qa02-lint.php`: `token_get_all(..., TOKEN_PARSE)` over app/routes/tests | **446 files passed**, repeated after the test-harness correction | PHP parser validation; no application bootstrap/database connection |
| `npm.cmd test` | 1,030 tests: **1,025 passed, 0 failed, 5 skipped** | Frontend unit/fixture checks; existing optional browser skips |
| `npm.cmd run test:smoke` | PASS | Render/workflow smoke; existing React key warning |
| `npm.cmd run build` | PASS | Vite production build; existing chunk-size warning |
| `bash scripts/predefense-check.sh` via Git Bash, APP_ENV=testing, DEMO_DB=dental_clinic_scratch, no --send | **9 FAIL, 3 WARN**, exit 1 | Intentionally absent deployed services/mail/provider/demo records; synthetic scratch read-only snapshot during tests, not stable clinic-data evidence |
| Temporary Node probe importing actual `appointments-api.js`, fetch intercepted | 5 characterization assertions | Confirms dependent search omission and lost explicit false; no backend/network operations |

Logs and JUnit XML are preserved outside Git under `%TEMP%/joe-qa02-*`. No failure is represented as a pass. `$qaFilter` is the parenthesized alternation of the method names from all 41 failing/error JUnit testcases in the original full run, saved in `joe-qa02-failures.txt`; the temporary baseline runner differs only in source-directory selection. The baseline export has its own Composer autoload and dependencies, so child processes cannot accidentally load current application source. Both full runs emitted a Windows native-command path warning while continuing; it did not create an additional JUnit failure. Its originating external helper is not proven here.

### Failure categories and independent baseline comparison

Of the original 41 nonpassing cases, **39 reproduced on untouched 2b9c891**. Their substantive failures agree; the queue-domain diagnostic embeds a generated Visit ID that differs between selections. Account recovery and owner summary passed in the baseline selection. This was an exact-name replay, **not a full baseline-suite run**. The backend is also source-identical to integrated A commit cc5e8f6, as established in A. No newly introduced integration application defect was demonstrated.

| Key | Category | Cases | Evidence / disposition |
| --- | --- | --- | --- |
| A | Previously reproducible baseline; incorrect/obsolete automation-monitor expectations | 19 | Removed monitoring routes return 404, or removed health projections are null. Separate scheduled automations still exist. Reconcile retired scope with its owner; do not restore a monitor or delete assertions to make this assignment green. |
| B | Previously reproducible baseline; feedback retirement/storage mismatch | 14 | Missing `/api/feedback` routes; migration `2026_11_10_000100` removes patient_feedback and its immutability trigger, producing one direct-query error. Scope/data-retention review belongs to the module/migration owners. Do not invent a replacement migration or touch existing data. |
| C | Previously reproducible baseline; queue domain/FIFO expectation contradiction | 5 | In Treatment is now allowed by the DB; Urgent requests fail validation; the prior-day priority test fails on invalid Urgent before service `not_today`; late ordering now follows FIFO. Requires STF-14/STF-15 contract reconciliation. The prior-day Call assertion itself passes. |
| D | Previously reproducible baseline; timezone-sensitive raw test fixture | 1 | `QueueTest` inserts a Carbon timestamp through DB::table, whose binding drops the offset. UTC PostgreSQL interprets 09:20 as UTC; backfill correctly preserves that stored instant as 17:20 Manila. Temporary copied test serializing only that value with `toIso8601String()` passes all 9 unchanged assertions, including exact 09:20 Manila, idempotency and rollback. Production VisitHistory/QueueEntry use an offset-bearing dateFormat. No historical timestamp repair is justified by this fixture failure. Original test remains unchanged for owner review. |
| E | Flaky/test-order-dependent harness resource limit; corrected | 1 | AccountRecovery worker exits at 128 MB before the second job. Controlled reproduction and stronger cleanup/exit assertions are in D. |
| F | Flaky/test-order-dependent, unresolved condition | 1 | Owner summary content predicate failed in original full run; baseline selection/current isolation/final full run pass. No source change or claim of root-cause resolution. |

Environment/configuration failures are also reported separately: deployment preflight has 9 failures/3 warnings because hosted services, worker/scheduler/mail/provider/demo setup are absent. They are not reclassified as passing backend acceptance. No actual newly introduced application defect requiring correction was established; source-only clinical/payment limits remain explicit blockers rather than fabricated regression results.

The final 39 nonpassing cases are exactly categories A-D: **38 failures + one error**, with no newly failing name outside the independently reproduced baseline set. E and F pass in the final suite. The prior R1 audit date-filter failure did **not** reproduce in either full run. That old report ran across a Manila date boundary; this observation does not constitute a fix or erase the historical evidence.

| Original full-run failing test (class::method) | Original | Untouched baseline replay | Category |
| --- | --- | --- | --- |
| `Tests.Feature.Analytics.AnalyticsCorrectionsTest::test_automation_health_is_null_without_actions_and_exact_with_them` | FAIL | FAIL | A |
| `Tests.Feature.Auth.AccountRecoveryTest::test_a_code_replaced_before_its_job_ran_is_not_sent` | FAIL | PASS | E |
| `Tests.Feature.Automation.AutomationControlTest::test_unauthenticated_cannot_access_automation_endpoints` | FAIL | FAIL | A |
| `Tests.Feature.Automation.AutomationControlTest::test_staff_and_dentist_and_patient_are_forbidden_from_automation` | FAIL | FAIL | A |
| `Tests.Feature.Automation.AutomationControlTest::test_owner_can_view_automation_rules_and_snapshot` | FAIL | FAIL | A |
| `Tests.Feature.Automation.AutomationControlTest::test_owner_can_trigger_manual_evaluation_and_audit_is_created` | FAIL | FAIL | A |
| `Tests.Feature.Automation.AutomationControlTest::test_csv_export_neutralizes_formula_injection` | FAIL | FAIL | A |
| `Tests.Feature.Automation.AutomationTruthfulnessTest::test_the_api_marks_every_action_row_as_evaluation_only_and_keeps_historical_text_unchanged` | FAIL | FAIL | A |
| `Tests.Feature.Automation.AutomationTruthfulnessTest::test_manual_dispatch_refuses_clinical_flags_and_every_foreign_field` | FAIL | FAIL | A |
| `Tests.Feature.Automation.AutomationTruthfulnessTest::test_manual_dispatch_validates_each_rule_observation` | FAIL | FAIL | A |
| `Tests.Feature.Automation.AutomationTruthfulnessTest::test_the_manual_message_says_evaluated_not_executed_and_the_event_stores_no_email` | FAIL | FAIL | A |
| `Tests.Feature.Automation.AutomationTruthfulnessTest::test_only_the_owner_may_dispatch_and_authorization_precedes_validation` | FAIL | FAIL | A |
| `Tests.Feature.Automation.AutomationTruthfulnessTest::test_manual_dispatch_is_rate_limited` | FAIL | FAIL | A |
| `Tests.Feature.Automation.AutomationTruthfulnessTest::test_health_is_null_with_no_evaluations_and_exact_otherwise` | FAIL | FAIL | A |
| `Tests.Feature.Automation.AutomationTruthfulnessTest::test_a_genuine_zero_percent_is_not_confused_with_no_data` | FAIL | FAIL | A |
| `Tests.Feature.Automation.AutomationTruthfulnessTest::test_snapshot_branch_uses_the_m2_reference_contract_and_never_silently_widens` | FAIL | FAIL | A |
| `Tests.Feature.Automation.AutomationTruthfulnessTest::test_audit_events_carry_no_event_body_and_the_csv_marks_evaluation_only` | FAIL | FAIL | A |
| `Tests.Feature.Automation.AutomationTruthfulnessTest::test_legacy_descriptions_are_qualified_inside_the_csv_cell_and_in_the_exception_projection` | FAIL | FAIL | A |
| `Tests.Feature.Automation.AutomationTruthfulnessTest::test_repeated_manual_dispatches_are_independent_evaluations_with_no_idempotency_contract` | FAIL | FAIL | A |
| `Tests.Feature.Automation.AutomationTruthfulnessTest::test_manual_dispatch_refuses_unexpected_top_level_fields_too` | FAIL | FAIL | A |
| `Tests.Feature.Automations.AutomationsTest::test_the_owner_summary_goes_once_at_the_send_time_with_numbers_and_no_patient_names` | FAIL | PASS | F |
| `Tests.Feature.Automations.InterviewRoundTwoTest::test_the_5_10_and_15_minute_late_steps` | FAIL | FAIL | C |
| `Tests.Feature.Feedback.ConcurrentFeedbackTest::test_a_double_submitted_request_with_one_key_is_stored_once` | FAIL | FAIL | B |
| `Tests.Feature.Feedback.ConcurrentFeedbackTest::test_separate_legitimate_submissions_racing_are_all_kept` | FAIL | FAIL | B |
| `Tests.Feature.Feedback.FeedbackTest::test_the_feature_is_patient_only_and_owner_staff_dentist_and_guests_are_all_refused_everywhere` | FAIL | FAIL | B |
| `Tests.Feature.Feedback.FeedbackTest::test_owner_can_review_feedback_with_filters` | FAIL | FAIL | B |
| `Tests.Feature.Feedback.FeedbackTest::test_a_patient_submits_free_text_about_their_own_completed_visit_and_the_record_is_minimal_and_server_derived` | FAIL | FAIL | B |
| `Tests.Feature.Feedback.FeedbackTest::test_only_the_patients_own_completed_visits_are_eligible_and_every_other_case_is_one_indistinguishable_refusal` | FAIL | FAIL | B |
| `Tests.Feature.Feedback.FeedbackTest::test_the_text_is_bounded_free_data_and_every_authority_or_policy_field_is_refused` | FAIL | FAIL | B |
| `Tests.Feature.Feedback.FeedbackTest::test_submission_is_idempotent_a_new_key_is_a_separate_submission_and_no_uniqueness_is_invented` | FAIL | FAIL | B |
| `Tests.Feature.Feedback.FeedbackTest::test_a_patient_reads_only_their_own_feedback_newest_first_with_a_cursor_that_reveals_nothing_about_others` | FAIL | FAIL | B |
| `Tests.Feature.Feedback.FeedbackTest::test_submitted_feedback_is_immutable_and_nothing_can_erase_it` | ERROR | ERROR | B |
| `Tests.Feature.Feedback.FeedbackTest::test_m26_is_a_foundation_only_no_rating_category_status_reply_publication_marketing_or_other_module_side_effect` | FAIL | FAIL | B |
| `Tests.Feature.Feedback.FeedbackTest::test_submission_is_rate_limited_per_account_and_explains_itself` | FAIL | FAIL | B |
| `Tests.Feature.Feedback.FeedbackTest::test_patient_can_submit_1_to_5_star_rating_and_low_ratings_auto_create_followup_task` | FAIL | FAIL | B |
| `Tests.Feature.Feedback.FeedbackTest::test_owner_can_review_patient_feedback_with_branch_and_dentist_filters` | FAIL | FAIL | B |
| `Tests.Feature.Queue.QueueTest::test_the_database_enforces_one_entry_per_visit_and_valid_values` | FAIL | FAIL | C |
| `Tests.Feature.Queue.QueueTest::test_order_is_priority_then_exact_arrival_then_queue_number` | FAIL | FAIL | C |
| `Tests.Feature.Queue.QueueTest::test_priority_does_not_reorder_patients_already_called_or_treatment_ready` | FAIL | FAIL | C |
| `Tests.Feature.Queue.QueueTest::test_only_todays_queue_can_be_operated` | FAIL | FAIL | C |
| `Tests.Feature.Queue.QueueTest::test_backfill_uses_server_visits_only_and_is_idempotent_and_reversible` | FAIL | FAIL | D |

## F. Frontend integration contracts

### Booking and identity

- Patient POST `/appointments`: required `branch_ref`, `service_ref`, `date:YYYY-MM-DD`, `start_time:HH:mm`; optional `for_patient_id` public Patient ID, notes, `pay_at_clinic`, optional eligible `dentist_ref`. Integrated Book omits Dentist for auto-assignment. Patient `patient_id`, supplied status/source/revision/internal Dentist ID are prohibited. Actual validator permits an eligible preferred Dentist despite older no-choice comments; the UI currently offers automatic assignment. This was not changed into a new policy.
- Same optional `for_patient_id` must reach availability, calendar, recommendation, branch-options, booking-options and create. Unknown/foreign/revoked dependent returns 403; no patient-existence validation leak for this selector. A fresh create checks guardianship again. Cross-account appointment reads/commands are policy-gated. A missing linked Patient profile is 403; suspended session is revoked (403 `session_revoked`, then 401).
- Availability returns `data.date/branch/service/rules/slots`; slot includes date/start_time/end_time/starts_at/ends_at/dentist. Calendar returns month/today/window/previous_month/next_month/branch/days, with actual day states. These reads reserve nothing. Schedule/leave/hours/branch/service/patient overlaps are revalidated at create; stale availability is 422 `schedule_invalid`, concurrent exclusion can be 409 `schedule_conflict`.
- GET `/appointments/booking-options?branch_ref=...&service_ref=...&date=...&for_patient_id=...`: `data.{branch_ref,service_ref,date,currency,booking_fee_php,online_payment_available,online_payment_unavailable_reason,payment_methods,pay_at_clinic_available,hold_minutes,reserves_slot}`. Fee is decimal string or null; no invented consultation/reference price. Reasons include service_not_bookable_online, payment_not_configured, booking_price_unavailable, amount_too_small. It is a price/configuration snapshot, not schedule validation, price lock or provider uptime proof.
- Explicit `pay_at_clinic:false` fails closed without online configuration (422 payment_not_configured, no appointment); true permits unpaid clinic payment subject to other checks. Omitted/null retains legacy conditional-online behavior. Configured online create is 201 Pending/held with checkout URL/session/expiry. Confirmed/unpaid is not paid. Attendance can leave clinic-payment bookings Pending.
- AppointmentResource returns public ULID `id`, server `code`, exact `status`, integer `revision`, `source`, `assignment_method`, local date/start_time/end_time, offset-bearing starts_at/ends_at, duration_minutes, nested Patient public ID/code/name, and branch/service/Dentist legacy refs. `appointments-api.js::mapAppointment` preserves status/revision and maps those identities without choosing a replacement Patient/Dentist. Booking fee/payment status/method/paid-at/hold expiry map to the corresponding camelCase fields. Raw create/fetch responses also expose checkout_url/checkout_session_id; the generic mapped list does not retain them, so checkout continuation must use canonical detail responses.
- Current appointment statuses are Pending, Confirmed, Checked In, In Treatment, Completed, Cancelled and No-show. The optional history contains event, old/new status, revision, schedule and actor role. Payment status is separate and must never be inferred from Confirmed/Completed. Validation responses carry message/errors, while domain errors additionally carry code; authorization/nonexistent responses are not guaranteed to use a domain code. Existing normalizeFailure handles this distinction and reports 401 session invalidation.

### Concrete handoff to Developer B

| Finding | Reproduction and actual behavior | Required frontend action |
| --- | --- | --- |
| Dependent availability mismatch | Choose a dependent with a cross-branch overlap at 09:00 and a guardian overlap at 10:00. Backend self availability offers 09:00 and excludes 10:00; `for_patient_id=dependent` does the reverse. `src/patient/pages/Book.jsx` passes no dependent prop to BranchStep/BookingCalendar/TimeSlots; `src/appointments-api.js` search adapters omit the selector. Create does send dependent and may correctly refuse the offered slot with 422. | Thread the same dependent public ID through every search; invalidate branch/date/slot/search state when the person changes. Do not pass Patient `patient_id` or substitute guardian/Dentist. Backend R1 already supports this. |
| Explicit online false dropped | Actual `appointments-api.js::createAppointment` writes `pay_at_clinic` only when truthy. The intercepted probe passes false and observes the property omitted. This becomes legacy conditional-online behavior, not explicit fail-closed intent. | Before enabling online initiation, serialize the explicit boolean including false. Keep current disabled online UI until quotation/capability integration is reviewed. |
| Quote not consumed | No current api-client wrapper/caller for booking-options; Book's online option deliberately remains unavailable. Backend endpoint existing in the merge does not itself connect that UI. | Add quote/error/loading integration and consume server fee/methods/hold truth; no guessed fee or silent cash fallback. |
| Clinical retries | Start expects Visit revision; Save/Complete Treatment revision. Same-key response can be historical. Queue Served means started care. | Preserve existing exact encounter ID checks and reload canonical records; never display payment or clinical completion solely from request success/redirect. Existing encounter UI was source-reviewed and frontend tests pass. |
| Notifications | Patient Portal consumes server notifications. Operational A10 notification presentation evidence uses browser store; no backend archive endpoints. | Keep date grouping in Manila using returned offsets. Surface awaited read failures. Do not simulate persistence/archive or mark GEN-11 complete. |

### Payment/refund enforcement and limits

Provider calls in tests are fake. Settlement requires signed raw-body webhook with timestamp/mode checks **and provider read-back**, or authorized server polling with the same read-back checks. Redirect hints do not settle. Matching server-created session, target reference, paid status, exact centavos/currency and event/provider payment identity are checked. Duplicate event IDs and later different event IDs for the same applied booking payment do not reopen completed care. Late captured payment for a cancelled/no-show/nonpayable booking is retained for review.

Hold is 15 minutes in current source; scheduled release cancels/unpays expired holds. Running scheduler is a deployment requirement; expiry alone is not proof release happened. Scheduled check-in currently accepts Pending/Confirmed without checking payment-hold status; this is a source-level policy boundary, not a proven paid-admission requirement. Provider checkout errors roll back creation and permit same-key retry. There is no new failed-card retry endpoint: held checkout continuation and authorized polling use current records.

Paid cancellation at least 24 hours before start attempts refund; late cancellation/no-show forfeits for clinic review. Cancellation may succeed when refund provider fails. Refund pending/processing/failed does not mark refunded; acknowledged refund reference is reused via GET, and only succeeded marks refunded. Unknown transport outcome, provider idempotency retention, absent refund reconciliation worker and absent Patient refund-detail API remain limits. No promise of returned money or automatic retries is justified.

Billing uses completed performed procedures, caps deposit credit at Patient responsibility, and produces existing Payment/Payment Receipt evidence. Excess/partial deposit disposition and post-credit cancellation need approved financial decisions. Paid online settlement currently confirms even an attendance-flagged Patient: this known policy interaction remains unresolved and was not silently changed. Invoice provider-reference uniqueness must not be generalized into a claim of a global cross-appointment booking-payment uniqueness constraint: no such `appointments.booking_payment_ref` unique index was found.

Focused acceptance totals are **106 Appointment tests / 730 assertions**, **70 Payment tests / 509 assertions**, and **83 Auth tests / 597 assertions**. AppointmentAuthorization/Booking/PatientBookingContract cover account/role/branch/eligibility/auto-assignment and rejected identity fields. BookingIntegrationContract covers dependent-specific conflicts, unknown/foreign/revoked selectors, quotation, and provider-failure same-key retry. ConcurrentBooking races separate connections for the same slot. BookingSessionAcceptance uses actual login and explicitly forgets cached guards when changing persisted identity/relationship state. These are authenticated kernel tests, not browser cookies/CSRF/deployment E2E.

PayMongoPaymentTest verifies malformed/wrong/mode-swapped signatures, provider read-back mismatch/failure, duplicate events/captures, invoice ownership and receipts; AppointmentBookingPaymentTest verifies holds, expiration, cancellation timing, deposit credit, polling/webhook replay, no-show late capture, and completed-care preservation. RefundIntegrationAcceptance adds nonfinal/refused provider-result cases. Fake HTTP cannot prove real merchant entitlement, provider uptime, or a production refund result.

### Notifications and remaining operational contracts

`GET /notifications` returns `data[{id,kind,title,body,target:{page,id}|null,created_at,read}]` and `meta.unread`. Read-one and read-all POSTs return the same refreshed projection. All queries use the authenticated recipient ID; query-string user/branch overrides cannot widen access. Three new tests / 69 assertions cover six synthetic role/branch identities, foreign-read 404, idempotent timestamp preservation, duplicate-event suppression, Manila midnight, and an actual database constraint failure isolated in a savepoint.

There is no revision parameter, unread-reset, archive/soft-delete or restore command. A read retry is safe; UI must refresh rather than assume an old count is current. Writes catch/report failures so clinical/financial work can commit, but there is no guaranteed notification-delivery retry mechanism. Date grouping is presentation behavior based on the returned offset, not a grouped backend endpoint. Only the latest 50 are returned, while unread counts all retained rows.

Current notification bodies avoid message contents, diagnoses and clinical notes. They can include appointment service/time/branch, invoice amounts/references, and handover Patient names for selected recipients. Retrieval does **not** reauthorize historical notifications against changed branch membership, role or guardianship; there is no generic branch filter or approved retention/revocation policy. Recipient isolation is proven; retroactive branch/role/content revocation is not. Destination endpoints must still authorize record access. GEN-10 remains Partial and GEN-11 remains a separate policy/implementation dependency.

P1 source and original full-run evidence was revalidated against the actual routes:

| Support item | Backend contract / executed test class | Acceptance limit |
| --- | --- | --- |
| STF-05 | GET `patients/{patient}/chart` includes `data.summary`; GET `me/chart` safe subset; DentalChartTest | Staff gets no notes, Owner 403, unrelated Dentist 404; no new summary endpoint needed |
| STF-23 | Conversation/message `q` search; MessageSearchTest | Existing participant/branch gates, encrypted-body search, literal wildcards, cursors and rate limit; no performance claim for clinic-scale histories |
| OWN-01 | GET `analytics/daily-revenue`, `analytics/weekly-histogram`, executive summary; AnalyticsComparisonTest and AnalyticsTest | Revenue/cash flow, not profit; Monday-Saturday projection is on demand, not a verified scheduled Saturday artifact |
| OWN-02/03 | GET `branches`, PATCH `branches/{branch}`; OwnerBranchAcceptanceTest | Owner-only update; code uniqueness/max length, coordinates paired and bounded. No backend whitelist derived from UI dropdown presets, no geocoding claim |
| OWN-11 | `work-schedules` plus existing Staff reference updates; WorkSchedulesTest/OnDutyStatusTest/reference tests | Dentist schedule overlap/hours/leave enforced; Staff basic shift support is narrower than Dentist weekly schedules/exceptions |

Final full-run class results (included in the 989 total, not additional tests): DentalChart **12/193**, MessageSearch **7/106**, AnalyticsComparison **1/12**, OwnerBranchAcceptance **6/49**, WorkSchedules **7/77**, OnDutyStatus **4/79**, VisitTest **22/192** (tests/assertions; all passed). QueueTest is **20 tests / 211 assertions, 15 passed and 5 failed**, as individually classified above; positive queue transitions also run in the 44 passing Treatment cases.

## G. Remaining blockers

1. Clinical queue-status/legacy-data and FIFO contract reconciliation by Yzhekiel; no migration authorized here.
2. Backend historical failures require owner review; account-recovery worker behavior was reproduced and its test harness corrected. The intermittent owner-summary assertion remains unresolved.
3. Developer B-dependent search propagation and explicit payment intent/quotation integration. No authenticated browser acceptance is inferred from frontend unit results or kernel-route tests.
4. GEN-11 archive/restore policy and operational-shell notification persistence; no new notification policy invented.
5. Clinical branch-revocation/canonical-link revalidation limits described in C; review responsibility continuity before changing authorization semantics.
6. Attendance/payment interaction, approved fees/refunds, unknown refund outcomes, excess deposits and post-credit financial rules remain decisions, not verified clinic facts.
7. No approved deployed QA URL/session or clinic-content records supplied. Public content, real mail, scheduler, hosted sign-in, provider entitlement and live financial lifecycle remain unverified. No attempt to connect to protected systems was made.

No module is promoted based on this assignment. Historical module numbering/runtime identity is preserved. Process-document status should continue to qualify tested backend core separately from integrated browser and deployment acceptance.

## H. Final Git inventory

Original branch/HEAD remain unchanged. Nothing is staged. Two tracked files have intentional unstaged changes; five files are untracked:

| State | File | Purpose |
| --- | --- | --- |
| Modified | `QA-JOEVAN.md` | Append evidence/status reconciliation; update four stale backend support checkboxes with qualified acceptance |
| Modified | `backend/tests/Feature/Auth/AccountRecoveryTest.php` | Explicit in-process worker memory budget, exit and queue-cleanup assertions |
| Untracked | `backend/tests/Feature/Treatments/ClinicalIntegrationAcceptanceTest.php` | 14 clinical regression cases |
| Untracked | `backend/tests/Feature/Appointments/BookingSessionAcceptanceTest.php` | 3 persisted-session/dependent cases |
| Untracked | `backend/tests/Feature/Payment/RefundIntegrationAcceptanceTest.php` | 6 fake-provider refund cases |
| Untracked | `backend/tests/Feature/Notifications/NotificationIntegrationTest.php` | 3 recipient/date/failure-isolation cases |
| Untracked | `docs/JOE_QA_02_BACKEND_ACCEPTANCE_REPORT.md` | This report |

Ignored local setup includes installed backend/vendor, node_modules, build output, framework test/cache output and the newly created synthetic backend/.env.testing; none is staged. Temporary source export, runner/probes and logs are preserved under the current account's TEMP directory. No credentials are included in tracked/untracked changes; changed-file credential-pattern scan returned zero matches, and the fake provider key is explicitly a fixture. `git diff --check` passes.

Final preflight at **2026-11-02 23:07 Asia/Manila** reran branch, HEAD, porcelain status, diff stat/check, cached stat and application/frontend-path inventory. Results: exact expected branch/HEAD; **0 staged, 2 modified tracked, 5 untracked** as listed above; tracked diff **25 insertions / 5 deletions**; no application, route, migration or frontend diff. The stat excludes untracked tests/report, whose inventory is explicit above. No other worktree was modified.

Existing in-progress tests and findings were preserved throughout continuation. No reset, clean, stash, branch switch, rebase, cherry-pick, merge, commit, push or deployment occurred. Production application source, migrations, Developer B source/tests, other QA trackers and protected databases remain untouched. No historical failure assertion was removed or relaxed.

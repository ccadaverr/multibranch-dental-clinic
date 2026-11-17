# Stabilization Sprint01 — executed local acceptance

2026-11-17, Asia/Manila. **Local stabilization advanced; whole-system and deployment acceptance remain open.** No publication, main merge, deployment, grant cutover or held migration execution occurred.

## Git and provenance

- Worktree: `C:\Users\Joevan Delos Santos\Downloads\proj\dentalops-integration-20261117`.
- Branch: `integration/dentalops-fullstack-20261117`.
- Starting HEAD: `0cf24b1f6a1d78d087d238d9573eeb5e02e9d8fc`.
- Operations: `9409b59e769de29ec0e58ab238b11d40fee29b45`; Clinical: `407f0c6b74ce44a7d955d4b897e6100e2bd80a51`.
- Shared baseline: `a0725e645df6f8266c2bc4bebacc9d62dd18e7c1`. Both source histories and all five preceding integration commits are retained. There was no new source merge or conflict resolution this sprint.
- Product/test checkpoint: `540f932bc873ed61ff08968438d6d138ed19f726`. The subsequent documentation commit contains this report, the updated ledger and browser adapter. Final full HEAD and clean-state verification are recorded in the assistant handoff and private `final-git.json`.
- Local commits: `c795c66af9820704dcfc94165fd92689472fb1c0` fixture isolation/quota proofs; `6b60b3a15d705e45959a557cac47cf21ca017d92` queue vertical slice; `3f66390ca3ce9b7bf7948472dfb43713886b4633` exact same-day history identity; `540f932bc873ed61ff08968438d6d138ed19f726` complete2x2 Owner service pages. Documentation/evidence is a separate final commit.

The preserved Round9 Operations bundle verifies complete history and the exact Operations ref. SHA-256: `eb06e1e7f642ee7a7136eadf3e0b82408b9ae9992c2c810ebc20f819758756f7`. No existing bundle was replaced.

## Done

**Queue:** branch-wide arrival FIFO is authoritative for Staff/Owner, while Dentist positions and Patient own-queue privacy remain intact. Scheduled/walk-in classification, late flags and priority metadata do not automatically jump an arrival ahead. Equal persisted instants use immutable Visit ID as the documented internal tie-breaker. The operational UI no longer groups by Dentist name ahead of arrival order.

An explicit current-order/CAS/idempotent Staff move records the reason, previous/new positions and branch/date in append-only audit and queue history. It never edits arrival times, numbers or existing history. Called/Ready Patients cannot be displaced. Current account, role, auth version and branch authority precede receipt replay. New stale same-target commands no longer claim success. Clearing a late flag is truthfully labelled and does not pretend to move the Patient. See [the additive contract](QUEUE_STABILIZATION_CONTRACT_20261117.md).

**History:** two completed encounters for the same Patient/date now display appointment/encounter references and have distinct accessible review labels. The browser selects the exact encounter, rather than choosing the first same-date button. Saved clinical documentation remains read-only; delayed and wrong-Patient payloads remain rejected. This was a defect in the starting integrated UI, not a claim that the source branches' backend tests failed for this reason.

**Owner services:** two columns containing eleven cards did not fully establish the original2x2 requirement. The grid now presents four services per page. Every catalog service remains reachable; keyboard paging and immediate API-backed availability changes preserve selection across pages. The browser restored the exact starting synthetic service availability and weekly hours.

**Regression fixtures:** isolated mocked-provider mode/HTTP, the limiter's captured cache store, stronger audit ACL expectations, explicit timestamp offsets, quota windows for independent prescription races, and deterministic adult identities for ownership tests. Production throttles and permissions were retained. Separate quota and minor-denial tests preserve those substantive behaviors.

## Backend failure reconciliation

| Checkpoint | Tests | Assertions | Failures | Errors | Skips |
| --- | ---: | ---: | ---: | ---: | ---: |
| Starting reviewed cohort |1260|14435|37|1|3|
| First expanded run, capture initially stopped |1268|14542|29|1|3|
| Next consolidated run, random minor fixture exposed |1270|14609|27|1|3|
| Final same reviewed cohort plus explicit new tests |1271|14619|26|1|3|

Final: **1241 passing,26 failures,1 error,3 skips**. Eleven original failures were corrected and eleven new meaningful tests were added. The exact remaining27 case IDs equal the original unresolved cases; no new backend case failed in the final cohort. All132 original regular test files remained included. No failure was silently excluded.

| Original root | Starting cases | Ending |
| --- | ---: | --- |
| Mocked assistant inherited knowledge-only runtime |7 failures|Pass; runtime remains knowledge-only |
| Gemini test captured database quota store |1 failure|Pass with isolated array store and unchanged named limiter |
| Audit ACL denial happened before expected trigger wording |1 failure|Pass; absent TRUNCATE privilege asserted |
| Old late-arrival demotion contradicted approved FIFO |1 failure|Pass; late/reminder/no-show assertions retained |
| Raw timestamp fixture dropped its offset |1 failure|Pass; exact instant/history readback added |
| Retired singular automation monitor endpoints |15 failures|Retained404 failures; no obsolete executor restored |
| Unavailable/conflicting feedback contracts |11 failures+1 error|Retained; no Owner/clinical access expansion or table removal |

Every original failing/error case independently reproduced on **both** exact source snapshots in separately provisioned NEW synthetic targets: Operations87 at loopback55528 and Clinical83 at55529. This identifies inherited backend failures; it does not turn unsupported routes into accepted functionality. Baseline cohort totals also contain additional environment/older-source failures and are not passed integrated counts.

The [38-case failure ledger](STABILIZATION_S01_FAILURE_LEDGER_20261117.json) retains exact names, assertion/error text, source/route contracts, expected/actual behavior, QA links, impact, severity, baseline reproduction and ending status. [Source comparison](STABILIZATION_S01_SOURCE_COMPARISON_20261117.json) retains both failed-case sets.

Additional discoveries were preserved: three stopped-capture prerequisite failures; prescription contention's real429 after sharing a30/min window; a random minor in an ownership fixture; same-day history ambiguity; and the pure-unit execution-profile mistake. Unit mock identities must not be attached to the real-target bootstrap. The corrected pure-unit invocation uses reviewed PHPUnit mocks and no real database connection; the database guard was not weakened.

## Executed functional and security evidence

| Gate | Result |
| --- | --- |
| Queue/old late automation focused batch |38 tests/513 assertions PASS before the additional midnight admission case |
| Capture/quota/queue focused batch |19 tests/305 assertions PASS, including midnight admission, real30/31 quota, recovery and actual loopback capture |
| Dependent ownership/minor refusal |7 tests/50 assertions PASS |
| Pure unit classes |252 tests/1193 assertions PASS;30 PHPUnit notices retained |
| Python runner/provision/entrypoint safety |45 tests PASS |
| Frontend |2005 total:1997 pass,8 skip,0 fail |
| Smoke and production build |PASS; existing >500kB bundle warning retained |
| Syntax and source safety |20 changed/new PHP files and changed JS/MJS checked; diff checks pass; no credential findings; branding assets unchanged |
| Nine contention domains |All final domain results PASS across retained runs; initial prescription failure preserved. Not claimed as one fresh all-green9/9 invocation |
| Extended arrival/queue contention |New clone777ab230:1 test/383 assertions PASS. Different Patients/Dentists check in concurrently; competing moves wait on actual PostgreSQL locks, yield200/409 and one audit/history event; arrivals/history remain unchanged |
| Prescription contention after fixture correction |New clone4126d4dc:1 test/498 assertions PASS; current branch/account revocation and original number/revision assertions retained |
| Isolated worker/restore lab |PASS on NEW clone833e2cdf and restore0ed4a267; no migrations |

Actual browser lanes all passed against React → Sanctum/Laravel → synthetic PostgreSQL:

- Queue movement, committed-response loss, identical-key retry, one persisted history event, unchanged arrival facts, stale snapshot after a new arrival, explicit reload, keyboard focus/Escape and six widths.
- Patient/Staff appointment and ID intake → exact Visit/queue → Dentist call/start/documentation/reload/completion → invoice Draft/Review/Issue → synthetic Cash → one exact receipt after a lost committed response; own Patient real PDF/readback.
- Prescription draft/privacy, stale cross-tab authorization refusal, issue/retry/number, own Patient PDF, immutable Void and distinct subsequent prescription identity.
- Receipt navigation, exact Patient/invoice/Visit linkage, cross-Patient PDF denial, network retry and no extra settlement.
- Completed history with same-day encounters, exact identity, immutable revisions, separately labelled current chart, delayed selection rejection, wrong-Patient refusal and historical receipt continuation/retry without financial writes.
- Workforce request → Owner approval → distinct explicit publication → new-session readback; exceptions, period boundary, response-loss recovery, history and keyboard acceptance.
- Re-executed OWN-02, STF-09, STF-20 and four-role sessions; existing OWN-11 workforce acceptance retained.
- Five additional whole original criteria described below.

Visit/appointment/receipt/availability/calendar disclosure, branch scopes, auth-version/role revocation, historical access, chart CAS/idempotency and prescription/Cash identities retain the final cohort's actual assertions. No permission was relaxed to make a test pass. Broad baseline failures remain visible and prevent a whole-system green claim.

## Database and migration reconciliation

Exact main target: owned Docker container `dentalops-integration-20261117`, manifest `/private/integration/target.json`, loopback `127.0.0.1:55527`; databases **dental_clinic_demo** and **dental_clinic_test**. They are not either developer's existing databases or a grant-profile database.

Both actual applied ledgers match exactly87 selected names. All91 source file checksums match the previously reviewed inventory. The [Sprint schema inventory](STABILIZATION_S01_SCHEMA_20261117.json) records every applied name/hash, object/permission checks and exact provenance. The four additions over Clinical83 are under `backend/database/operations/`:

| Migration | Operations source commit |
| --- | --- |
|2026_11_18_000100_create_notification_archives|34bd2e61d75e577bb30838985be092a00c74783e|
|2026_11_19_000100_create_staff_roster_drafts|268061351d49a92bd63fde768d28835ce1c23adf|
|2026_11_20_000100_add_leave_command_recovery|0fcb4f716d484d2435a2ca2759e5f0fdf062b3d7|
|2026_11_21_000100_publish_staff_rosters|a8768bf772c690a00211260dde9b71314557293b|

These are accepted Operations source and the previously reviewed explicit integration profile, not the four holds. No unknown applied migration was found. No integration-target migration ran this sprint. Only separately reviewed83/87 selections were installed in the NEW disposable source-baseline clusters used for reproduction.

All four held files remain byte-identical and **unapplied**:

1. `2026_11_10_000100_remove_patient_feedback_table.php`
2. `2026_11_15_000400_backfill_tooth_chart_branch.php`
3. `2026_11_15_000500_add_critical_foreign_key_and_analytics_indexes.php`
4. `2026_11_16_000500_update_queue_statuses_and_remove_urgent_priority.php`

`conversation_dentist_grants` remains absent; no88-entry design or cutover was installed. New legacy reassignment remains fail closed. Existing care, workforce, billing and authorized history operate without enabling new grant features. DEN-14/STF-21 remain incomplete; disposable grant evidence is not full acceptance.

The application role remains nonsuperuser, without audit TRUNCATE authority, with60 enabled user triggers. No default migration chain, AUTO_MIGRATE=true, status conversion, trigger disabling, history rewrite, developer/production data mutation or historical job replay occurred.

## Worker, mail, backup and predefense

The disposable runtime lab verified persisted intent, offline transport failure/backoff, interruption before acknowledgement, fresh-claim protection, stale recovery, two due processors observed waiting on a PostgreSQL row, one loopback capture, terminal duplicate suppression and restored private document bytes/key/access. Local capture is not external delivery. A crash after SMTP acceptance can still duplicate transport delivery under at-least-once semantics. Scheduler scope was the existing due-mail frequency, not the full clinical automation chain.

Final `scripts/predefense-check.sh --local-only`: **5 FAIL /6 WARN**, improved from7/6. All failures/warnings were inspected:

- Fail: main demo worker absent; full scheduler absent. The default processors were deliberately not started against existing pending intents. Disposable worker/scheduler proofs do not claim these main processes are running.
- Fail: no unpaid invoice remains because the exercised synthetic workflows settled their invoices. The demo needs a repeatable pre-settlement stage through normal workflows.
- Fail: synthetic branch contact/hours are placeholders, clearly labelled synthetic. No clinic contact fact was invented to satisfy the checker.
- Fail:13 old/new synthetic main-demo outbox items remain pending over10 minutes;13 jobs remain queued. No generic backlog processor ran. The separately identified14 earlier developer intents remain untouched.
- Warn: external email/payment/tunnel checks not executed; missing email for Guiguinto and the synthetic branch; no active assistant answers; queued jobs and pending mail. No external address/provider or unapproved wording was activated.

The prior Vite403 prerequisite was corrected with the local allowed host; actual API/UI probes now pass. Normal synthetic browser prerequisites provide12 Patients. The checklist was not weakened and is still red.

## Original68 QA ledger

Totals remain **25 locally Complete /32 Partial /11 Blocked =68**. Integrated acceptance advances **4 →9**, leaving59 without complete integrated acceptance. Sixteen of the locally Complete records remain inherited provisional evidence.

New whole integrated passes: **GEN-03, STF-10, STF-12, OWN-05, OWN-06**. Existing **OWN-02, STF-09, STF-20, OWN-11** acceptance was preserved/rechecked. Original criterion text and all68 records were retained in [the updated ledger](INTEGRATION_QA_LEDGER_20261117.json).

STF-14/STF-15 remain Blocked despite queue subset proofs; unsafe status/urgent removal was not executed. OWN-13 remains Partial because its referenced whole requirements remain open. GEN-07 still needs the complete Other-field inventory; GEN-09 still needs original before/after click counts across all required flows; GEN-10 still needs its complete notification criterion acceptance. GEN-11 remains policy-blocked. No entire criterion was promoted merely because one workflow stage passed.

## UI/UX and evidence limits

Queue order dialogs, Check-In selector/refresh, notification bell behavior across all four roles, Owner hours/services, receipt and history flows were actually exercised at375,390,430,768,1024 and1440px where recorded. Keyboard operation, focus restoration, stale/error recovery and page overflow were checked. This is targeted acceptance, not a formal WCAG audit or all-screen certification.

Private durable evidence: `C:\Users\Joevan Delos Santos\Downloads\proj\dentalops-s01-evidence-20261117`. Initial Temp browser artifacts were unavailable on a later check, so all nine lanes were rerun and saved in this ACL-restricted sibling directory. Generated support credentials and private runtime files remain outside Git. [Validation JSON](STABILIZATION_S01_VALIDATION_20261117.json) ties outcomes to normalized source hashes; dirty-run starting SHAs are not misrepresented as containing the changes. Existing handoff/bundle history was preserved; older snapshots are historical.

## Next batch and decisions

Highest-value next vertical slice: a fresh repeatable synthetic demo with explicit pre-settlement state and isolated, allowlisted new mail/scheduler fixtures; complete GEN-10's four-role notification/date/archive/retry criterion; then continue the remaining16 provisional Complete records. Relevant domains: `scripts/local-system.py`, `scripts/clinical-runtime-lab.py`, `backend/app/Services/Mail`, `backend/app/Services/Automations`, `backend/app/Console/Commands/DemoCheck.php`, `src/layout.jsx`, `src/patient/Portal.jsx`, notification browser/regression tests. Keep actual approval distinct from workforce publication.

Owner decisions still required: feedback's supported future contract versus retiring conflicting expectations; entity-specific GEN-11 archive/restoration authority; separately reviewed grant installation/cutover; separately reviewed held-migration/status plan preserving Served=treatment START; actual clinic contact/assistant wording confirmation. Publication/deployment require separate authorization. No new source access, main merge or cutover is implied by this report.

Recommended continuation: start from the final verified Sprint01 HEAD, read this report/validation/failure/68-row ledgers, preserve all source refs and holds, build the next synthetic runtime/GEN-10 slice with explicit fixture/job identity and failure recovery, run focused then consolidated gates, and make local commits only. Do not reopen retired unsafe endpoints or claim deployment readiness from these passes.

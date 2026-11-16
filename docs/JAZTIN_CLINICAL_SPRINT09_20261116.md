# Clinical Sprint09 — inherited failures and qualified messaging evidence

2026-11-16 Asia/Manila. Start **`fe66059691ba32ec4caa6803a82e8fd779bb9fd5`**, clean `feature/jaztin-qa-20261115`, `/private/tmp/dentalops-jaztin-qa-20261115`. Published Clinical checkpoint `4cbb1386dbc4fd959b74882a95d370320d2a63e6` is an ancestor. Draft PR #9 is preserved/unmodified. Local commits only; no push, Operations fetch/import, candidate, merge or deployment.

## Preflight and scope

Reviewed original FINALS criteria/tasks, authoritative 68-row ledger, integration handoff/runbook, Batch08 and exact inherited logs/test sources. Current expected Operations tip is **`4703fec9b1119d543478619db40dd53081b1eceb`**, superseding `54a7272`. No authentic source or independent digest received. No GEN-06/DEN-03 reproduction was inferred.

Ordered work: reproduce/classify failures → preserve policy/ownership boundaries → qualify exact chart recovery → repair explicit test-mail configuration and verify real queued capture → add missing local DEN-14 lifecycle evidence → update intake/contracts → consolidated checks and local logical commits. Accepted Family, chart/history, prescription and invoice/receipt workflows were not rebuilt. Patient `Archives.jsx` was not edited.

## Failure classification and disposition

| Failure | Reproduction / exact assertion | Classification | Disposition |
|---|---|---|---|
| Walk-in ordering text | `tests/batch4b-operations.test.js:24` requires `Walk-ins are queued behind scheduled arrivals and must not displace confirmed appointments`. Current `PatientFlow.jsx` says queue order follows recorded arrivals and authorized controls and walk-ins reserve no appointment time. | Contract drift / unresolved queue-policy boundary; not an approved scheduled-first implementation requirement established by this test alone. | Original failing assertion remains unchanged. Do not add unsupported copy or reorder queue/history. Owner/domain decision and authentic Operations contract needed. |
| Chart exception wording | `tests/yzh-clin-09-branch-identity.test.js:247` expects `/Check the chart before retrying/`; prior fallback instead said retry same finding or review history. | Wording/UI-contract drift; existing original-key recovery remains valid. | Fallback now explicitly says check chart before retrying **with different details**, or retry the **same** finding to recover its original result. Original assertion unchanged; Node and rendered React recovery pass. No chart-write algorithm changed. |
| OWN-11 | `tests/staffing.test.js:106` fails `/Staff work schedules/`. Subsequent assertions also require `updateStaffProfile(currentStaff.id`, `Marked available`, no `Available / On-Duty`, and `Weekly roster coverage`. | Operations-owned cross-branch source/contract dependency. Literal label/profile expectations are not proof of published-roster authority. | No Workforce source or assertion edited. Exact evidence/questions prepared for Joevan A via owner-mediated communication. Current Operations implementation cannot be assessed from unavailable source. |
| Three receipt-resend 502s | `BillingDocumentDownloadTest`: recipient-override/audit, rate limit and owning-Patient success expect 200 but receive 502 under target capture with no SMTP listener. Deliberate transport-failure case correctly expects 502. | Environment prerequisite: absent loopback capture; ordinary suite also inherits a target transport different from PHPUnit defaults. | Original assertions retained. Pass with actual guarded capture running, and with explicit array/sync suite profile. Local capture is `logged_only`, never external or inbox delivery. |
| Six Intake mail assertions | Guardian confirmation, claim-code owner, neutral stored-email response, staff-link claim, pending-claim self-service exclusion, and staff-link spam protection expected `Mail::assertSent` but target uses queued delivery. | Queued-target versus synchronous-suite contract drift. A pending encrypted job is not yet a sent mail. | Explicit suite profile matches `phpunit.xml` array/sync defaults; all original tests pass. Actual database-queue capture and account-code activation tested separately. No switch to synchronous production delivery or weaker expectation. |
| Predefense worker/scheduler/fixtures | Worker down, scheduler down, no unpaid invoice, synthetic contact/hours placeholders, 13 aged unsent intents. | Environment/fixture prerequisites. | Still **5 FAIL / 6 WARN**. No fabricated clinic facts/unpaid care or uncontrolled scheduled clinical transitions to make checks green. |

The three frontend failures listed by the prompt include OWN-11 once; it is not a fourth separate failure. Before focused frontend reproduction: 35 tests, 32 pass/3 fail. Full inherited suite before: 1941 pass/3 fail/8 skip.

## Accepted changes

### Chart recovery wording and actual UI state

Only runtime change is the exception fallback sentence in `ToothTimeline.jsx`. It preserves both review-before-different-entry guidance and safe original-finding retry. No revision, branch coercion, idempotency key, chart entry/history, clinical status, encounter or financial mutation changed.

Existing 24 branch/chart-command checks pass with original expectations unchanged. New real React browser harness deliberately rejects the editor callback, verifies uncertainty disables changing fields, retains exact branch/tooth/surfaces/date/note and observed revision, uses keyboard Retry and verifies the second callback receives the exact original payload. Success clears only the accepted fields and retains branch. Both uncertain and resolved states fit 375/390/430/768/1024/1440. This synthetic callback harness does **not** prove a server receipt/key; existing command tests and earlier PostgreSQL receipt/race evidence remain separately scoped. No accepted chart/history behavior rebuilt.

### Explicit mail-test profile, unchanged runtime transport

`scripts/local-system.py --profile test --test-mail-profile suite test <explicit reviewed paths>` opts into the **existing PHPUnit array/sync defaults** that inherited process env otherwise overrides. Default `target` is unchanged: database queue/local SMTP capture. Suite mode is refused before connecting for demo, serve/worker/scheduler, schema and contention lanes. Database identity, reviewed schema, held-file and reset-suite guards are unchanged. The two new safety tests verify exact env changes and refusal boundaries; no credentials are printed.

This profile choice is explicit in commands/results. It is not a queued transport acceptance claim. No application PHP mail/auth/receipt behavior changed.

The existing local mailbox was started only at loopback 1026; its transport and listener reject every recipient outside synthetic `@example.test` and never relay. Actual receipt-resend tests retain authorization, financial audit, rate-limit and deliberate 502 expectations. A new transaction-safe `QueuedLocalCaptureTest` exercises:

* Pending PostgreSQL job/intent with no prior capture; actual worker execution with simulated transport exception → persisted retry/backoff; actual second worker execution → one real MIME capture, `logged_only/local`, no delivery-confirmed timestamp; repeat processing sends nothing and the appointment snapshot stays unchanged.
* New synthetic counter Patient → queued claim code, pending account before worker → actual private MIME capture → wrong-code refusal → received single-use code activates the exact Patient account → replay refused. No hard delete or account credential/code printed; general attempt history contains no code. This does not claim third-party delivery or retry one-time secrets.

### DEN-14 existing workflow evidence

Original `FINALS-QA-REVISIONS.md:906` includes all STF-21–24 plus actual send/receive and long-history checks. Actual owned PostgreSQL/browser evidence adds Staff committed-response loss with same-tick double activation, original-key/body Retry and one persisted message; Dentist receives and replies; Staff polling receives it and auto-scrolls to latest; reload preserves both; foreign Patient read is 403. Existing long thread pages without forcing the reader to latest. Sender/receiver alignment/background and actual body-text contrast pass under OS light/dark preferences at all six widths with keyboard focus. There is no separate app dark palette claim.

Long inbox prerequisites use a guarded demo-only fixture: 28 explicitly synthetic **new closed metadata records**, with required closing actor/state, existing authorized synthetic participants and no content. It does not close or rewrite existing conversations and performs no clinical transition. A backup precedes setup. Initial misuse of a test-only configuration guard correctly refused before writes; final fixture uses explicit demo configuration and actual cluster identity checks while leaving shared guards untouched. A wrong-profile invocation is independently refused with unchanged test-table count. Final long-inbox browser result is recorded in the verification addendum; initial mobile harness attempts are not acceptance.

**DEN-14 remains Partial**: STF-21 active-Dentist switching versus participant-add/history/notification authority is unresolved; all integrated acceptance remains pending. STF-22/24 already had bounded local/historical Complete classification, so new evidence is not additional original closure.

## GEN-07 / GEN-09 reassessment

* **GEN-07 Partial:** original tasks require inventory, required Specify/example, server conditional validation and both values, hide/clear on another option. Supported Family/Join/ID behavior already exists. Optional prescription/follow-up custom strings do not persist a separate category flag; document title remains meaningful under other categories; Workforce source is unavailable. Full compatible contract/schema and per-control evidence remain required. No duplicate fields, unsupported clinical choices or destructive clearing invented.
* **GEN-09 Partial:** complete comparable Check-In/appointment/Patient-record/prescription flow map and before/after counts remain missing. Earlier queue and receipt shortcuts, and source-counted prescription review, remain bounded evidence. No numeric target, time saving or whole-flow completion invented. This sprint's mail and message evidence does not close that criterion.

## Commands and actual results

All PostgreSQL work uses owned `/private/tmp/jaztin-clinical-20261115c/target.json`, loopback port **55493**, demo/test only, **83 reviewed migrations**, four unchanged/unexecuted held sources. No reset/migration operation. Backups/private MIME/screenshots/logs remain outside Git.

| Check | Result / scope |
|---|---|
| Original target `BillingDocumentDownloadTest.php` + `IntakeTest.php`, before capture/profile fix | **29 tests / 592 assertions / 9 failures**, matching the three receipt and six Intake failures. |
| Explicit `--test-mail-profile suite` BillingDocumentDownload + Intake + MailOutbox | **39 tests / 707 assertions passed**. Original assertions unchanged; includes deliberate failure and retry cases. |
| Default target, filtered receipt/capture/worker files with actual mailbox running | **9 tests / 69 assertions passed**; includes receipt and transport failure denials. |
| Final `QueuedLocalCaptureTest.php` default target | **2 tests / 40 assertions passed**, including actual queued claim-code capture/consumption and appointment retry capture. Overlaps the earlier worker test; totals are not summed. |
| Local runner safety | **16 passed**; existing lock-handle ResourceWarnings remain. |
| Branch identity + chart commands | **24 passed**, original assertions retained. |
| Rendered chart exception/recovery | **Passed**, actual React state/synthetic callback, keyboard and six widths in uncertain/resolved states. |
| Actual message lifecycle | Four groups passed before added inbox qualification; final expanded result in addendum. PostgreSQL/Staff/Dentist/foreign Patient/polling, not external transport or switching. |
| Full frontend | **1952 tests: 1942 pass / 2 fail / 8 skip**. Remaining exact failures: walk-in policy text; OWN-11 workforce. No assertion changed/skipped to hide either. |
| Smoke / production frontend build | **Passed**; existing list-key and bundle-size warnings remain. |
| Read-only predefense `--local-only` | **5 FAIL / 6 WARN**, unchanged prerequisites; no external delivery/payment/tunnel acceptance. |
| Scheduler inventory | `schedule:list --json` succeeds; includes mail due processing, automations, intake expiry and payment-hold release. No global scheduler started because those would mutate existing fixtures/appointment state. Inventory is not live scheduler acceptance. |

The full reset-based backend was not run on the held-migration profile. There are no new backend workflow changes requiring a new write-race implementation; actual queue behavior and duplicate terminal processing are tested, **not** represented as a new parallel contention race. Existing owned PostgreSQL race lanes remain prepared for the authentic candidate.

## Intake and Joevan A handoff

Corrected [intake manifest](integration/OPERATIONS_INTAKE_20261116.json) records expected `4703fec`, absent received/actual source, null independent SHA-256 and no candidate. It requests complete authentic history or a verifiable predecessor-plus-delta chain, exact refs/ancestry, authorized delivery, migration inventory/held hashes, shared APIs/routes/navigation, Joevan file/acceptance manifest and side-by-side Patient Archives comparison. Clinical `Archives.jsx` hash is captured; file unchanged. Safe preparation does not import source or execute merged tests.

For **Joevan Codex A, via owner-mediated ChatGPT delivery**:

1. Provide exact OWN-11 source/evidence for Owner setting Staff and Dentist schedules, request → approval → **separate publication** → effective duty, revisions, overlaps and branch denial. Current Mac failure is `tests/staffing.test.js:106`, `/Staff work schedules/`; subsequent profile-based assertions need reconciliation against the authentic published-roster contract. Do not treat the literal missing label as proof your latest code is broken; Jaztin changed neither test nor workforce source.
2. Supply the approved queue-order/vocabulary/history contract. Current frozen model uses authorized operational priority then recorded arrival; the inherited test requires categorical scheduled-first text. Preserve Served as treatment start and four held migrations. No policy/copy substitution by Jaztin.
3. Confirm exact `4703fec` ref and complete-history delivery or predecessor/delta components with independent SHA-256s, source-delivery authorization and deployment-trigger clearance. The old `54a7272` bundle is not assumed to contain the newer tip.
4. Provide `Archives.jsx` plus its Patient/dependent ownership, pagination/error, navigation/PDF/private-read and archive-policy contracts. Compare common baseline → both versions before changes. Include affected routes/API client, notification/audit boundaries and exact acceptance evidence; no competing shared-file edits.

No automatic message or recipient acknowledgement is claimed. Owner-mediated final handoff is the approved communication channel.

## Reconciliation and readiness

Before/after **21 locally Complete / 36 Partial / 11 Blocked = 68**, original owners unchanged, all 68 integrated acceptance pending. No whole original QA newly closed. Chart recovery assertion is repaired; mail failures are environment-qualified with unchanged assertions; DEN-14 has additional local subcriterion evidence. Missing GEN-06/DEN-03 reproduction and admission/cancellation/handover/archive policies remain unfulfilled.

No authentic Operations source, no verified digest, no candidate HEAD. Owner's conditional local integration authorization is preserved, but conditions are not met and no merge is currently authorized. Publication/deployment clearance remains absent. Integration/demo/production readiness is not established. Next highest-value step is authentic source/contract receipt and candidate acceptance; independently, prepare a dedicated synthetic scheduler/backup-restore fixture without activating current clinical automations or changing clinic facts.

## Final verification addendum

* Expanded actual messaging browser journey: **five groups passed**, now including real PostgreSQL-backed inbox pagination beyond 25 rows, contained list scrolling and keyboard reachability for Staff/Dentist at all six widths. Synthetic inbox setup created 28 new closed metadata fixtures; no existing conversation was closed or rewritten. The final script explicitly returns to the inbox on mobile and searches for the intended Patient after reload. Earlier harness failures are not counted as passing evidence.
* Final chart browser passes both uncertainty and resolved states at all six widths, original unchanged branch/tooth/revision payload and keyboard Retry.
* Actual wrong-profile inbox fixture invocation is refused before mutation; the test conversation count is unchanged. Shared test-only guard was not relaxed to permit demo writes; the fixture separately enforces owned demo configuration/actual cluster identity. Both new PHP files pass syntax checks.
* Schema verification: **1 test / 9 assertions passed**, preserving 83 reviewed migrations and four held exclusions. No new/altered migration, application PHP, routes/API client, Workforce or Archives source.
* Full frontend remains **1942 pass / 2 fail / 8 skip**, smoke/build pass, focused 24 chart/branch and 16 runner checks pass. New queued capture suite passes **2/40**; counts overlap the earlier nine-case capture run. All authentic candidate, cross-domain, new parallel race and production/hosted claims remain unestablished.
* Local SMTP capture is running solely as the private test listener; worker execution was bounded inside isolated tests. No global worker/scheduler was started to process existing demo records or clear aged outbox/automation prerequisites.

Final local commit IDs, clean status and final read-only predefense/credential/diff checks are recorded in the delivery report. The current intake uses `4703fec`; no source or digest was fabricated or received.

Local implementation/test commit: **`dcde456e1f003f0ce9f87836c3b5e9c7c747bd73`** (nine files). Final read-only predefense remains **5 FAIL / 6 WARN**; aged unsent intents are now **14**, versus 13 at initial inspection. No claim those messages were delivered. A 15-file changed/new credential scan passed before the implementation commit; protected application PHP/schema/route/API/Workforce/Archives/hosting source diffs are empty. Exact 68-source validation remains 21/36/11. Documentation/intake is committed separately; no publication.

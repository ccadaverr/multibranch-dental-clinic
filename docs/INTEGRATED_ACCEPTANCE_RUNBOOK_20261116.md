# Controlled integrated acceptance — executable runbook

2026-11-16, Asia/Manila. **Prepared, not executed against an integrated candidate.** Local Clinical evidence is recorded separately in Batch08. This document grants no source-transfer, integration, publishing or hosting permission.

## Entry gates and evidence

1. Owner approves the historical template security classification, exact complete-history bundle filename/SHA-256, Jaztin as recipient and private delivery method. Current expected Operations commit: `4703fec9b1119d543478619db40dd53081b1eceb`; the previously reported bundle is not assumed to contain this newer tip. Require a complete authentic export or an independently hashed predecessor-plus-delta chain reaching the exact expected tip. Owner accepted the apparent-template classification subject to scan limits and approved Jaztin recipient. Independent digest/source are still unavailable; GitHub delivery is preferred but deployment-trigger safety remains gated and private fallback is not finalized.
2. After delivery, compute `shasum -a 256 "$APPROVED_BUNDLE"`; compare byte-for-byte with the independently approved hash. Run `git bundle verify "$APPROVED_BUNDLE"` in an isolated repository with the required prerequisites, then `git bundle list-heads "$APPROVED_BUNDLE"`. Do not import if hash, branch tip or prerequisites differ. Complete-history claims require inspection of reachable history, not just the tip tree.
3. Record the Clinical full SHA, Operations full SHA, common ancestor, migration hashes, changed-file lists and inspected route/contracts. Use `git merge-base --is-ancestor "$AGREED_BASE" "$OPERATIONS_SHA"` after approved import. Import into an isolated review repository; do not change main or the existing feature worktree.
4. Owner has conditionally authorized a local isolated integration candidate after authentic source receipt, independent SHA-256/ancestry verification and safe database/migration isolation. Owner explicitly prohibits merging now. Once all those conditions are verified, use that existing authorization; independent QA completion is not a prerequisite. Source-transfer approval alone does not waive any condition. Review conflicts in routes/API client, scheduling authority, Clinical/Patient navigation, journals, notifications, archives and shared controls. Preserve all four held migrations. Do not activate the default-off selected-follow-up feature merely to pass a test.
5. Create an owned private PostgreSQL candidate target using the reviewed migration inventory and synthetic accounts. Existing Clinical target manifests are tied to their exact root/schema hashes; do not reuse or edit one to bypass candidate verification. Agree a new profile when source/migrations differ. Never use production, ambient `.env`, blanket `migrate:fresh` or the real clinic database.

For every acceptance case record: case ID, candidate full SHA, target profile/schema hash, actor/role and synthetic identifiers, Manila date/time, expected/actual state, command/result key and revision where applicable, screenshot/network evidence path, PASS/FAIL/BLOCKED/NOT RUN and original QA IDs. Exclude passwords, tokens, medicine text and clinical notes from shared reports. Keep detailed synthetic browser artifacts private.

## Commands after candidate/profile approval

The variables below must be set to the approved candidate root and its owned manifest, not a hosted URL. Commands are individual steps; failure stops acceptance for the affected lane. These are prepared commands, not passing results.

```bash
cd "$CANDIDATE_ROOT"
git status --short --branch
git rev-parse HEAD
git diff --check
python3 scripts/validate-qa-reconciliation.py
python3 scripts/local-system.py --target "$DENTALOPS_LOCAL_TARGET" status
python3 scripts/local-system.py --target "$DENTALOPS_LOCAL_TARGET" --profile test verify-schema
npm test
npm run test:smoke
npm run build
```

Start the reviewed candidate API/UI in separate terminals using the owned runner's `serve` and `ui` commands. Their established local ports are 8104/5195. Start a worker/scheduler only after verifying the candidate's mail transport points to its private capture service and all external payment/notification delivery is disabled. The original `predefense-check.sh --local-only` must receive the owned runner's environment (see Batch08), not ambient backend credentials. External hosted checks remain a separate authorization gate.

Explicit transaction-safe Clinical regression files supported by the current runner:

```bash
python3 scripts/local-system.py --target "$DENTALOPS_LOCAL_TARGET" --profile test test tests/Feature/Visits/ArrivalRecoveryTest.php tests/Feature/Treatments/EncounterRecoveryTest.php tests/Feature/Treatments/HistoricalTreatmentReadTest.php tests/Feature/Charts/ChartCommandRecoveryTest.php tests/Feature/Prescriptions/PrescriptionTest.php tests/Feature/Prescriptions/PrescriptionRecoveryTest.php tests/Feature/Followups/SelectedFollowupBookingTest.php tests/Feature/Followups/SelectedFollowupRecoveryTest.php tests/Feature/Patients/ProfileSaveRecoveryTest.php tests/Feature/Intake/DependentCreationRecoveryTest.php tests/Feature/Messaging/MessageSearchTest.php tests/Feature/Billing/PatientReceiptNavigationTest.php
```

Operations test paths must be taken from the delivered source/handoff and inspected before execution. Do not guess their unpublished names or count their reports as independent acceptance. Reset-based legacy suites are excluded until a safe disposable profile is explicitly reviewed.

For actual write races, run `clone-test`, record the new target, then run each supported lane (`concurrency`, `arrival-concurrency`, `encounter-concurrency`, `chart-concurrency`, `profile-concurrency`, `dependent-concurrency`, `prescription-concurrency`, `billing-concurrency`) with that clone's manifest and `--profile test`. Observe both workers waiting on PostgreSQL locks; verify final rows, revisions, histories/audits and original receipts. Back up and stop each clone. A sequential retry is not a contention test.

## Four-role browser procedure

Use isolated browser contexts for Patient, Staff, Dentist and Owner. Establish account/branch scopes from the candidate's synthetic fixtures. At **375, 390, 430, 768, 1024 and 1440px**, exercise each role's representative primary workflow below; verify no page overflow, reachable primary actions, keyboard focus/Escape, loading/error/empty states and long content. Capture actual screenshots and logs. Browser scripts below require `PLAYWRIGHT_MODULE`, `DENTALOPS_LOCAL_TARGET` and private `LOCAL_SYSTEM_EVIDENCE` variables and their prerequisite fixture journeys; read each header before running. A missing fixture is BLOCKED, not a passing skipped journey.

| Case | Roles / executable actions | Required assertions and negative cases | Current boundary |
|---|---|---|---|
| I01 Personnel/branches | Owner: create/invite a synthetic employee, set branch scope, revoke access; inspect branch code/map/hours and persistent readback. Staff/Dentist repeat forbidden administrative API requests. | No scope escalation, duplicate code race refused, old session revoked, no Patient/private content in Owner projections. | Operations source and reviewed mail capture required. Branch-creation support must be established from actual source. |
| I02 Schedule publication | Staff request → Owner approval → publish → Staff/Dentist work-hours read → Patient availability. Exercise leave/closure and Manila day boundaries. | Requested/unpublished work must not become clinical availability; approved roster survives reload; overlapping duties and unauthorized branch writes refused. | Joevan source required; do not infer publication semantics from profile fallback hours. Historical OWN-11 remains open. |
| I03 Leave | Staff and Dentist request full/partial-day leave; Owner approves/refuses; inspect affected appointments and retained history. | Exact date/time, branch scope, stale revision and competing decisions; no automatic appointment cancellation. | Operations source required. Balances and unknown coverage policy remain unimplemented unless delivered/approved. |
| I04 Registration/Family | Patient Join/Family Other→Specify→save→reload; blank/whitespace refusal; switch option and clear; lose committed response and retry original key. | One Patient/link/audit for one command; exact guardian recovery, ended/foreign link denial; independent commands remain distinct. | `node tests/local-family-acceptance.mjs`; existing guarded fixture required. No fuzzy identity merge. |
| I05 Booking/Check-In | Patient book and recover exact appointment; Staff ID acknowledgement and scheduled arrival; existing-Patient walk-in. | One appointment/Visit/queue, exact branch/Patient/provider/time, stale/foreign/revoked refusal, no backend confirmation from redirect alone. | `node tests/local-patient-booking.browser.mjs`, `node tests/local-arrival.browser.mjs`; automatic admission/cancellation/unified find-create remain policy blocked. |
| I06 Queue/encounter | Staff queue → Dentist Call and open → explicit Start → save → explicit Complete. | Dentist's own queue; exact queue/Visit/Patient pair and original revisions; lost-response recovery; **Served is start**, never completion; no duplicate treatment. | `node tests/local-encounter.browser.mjs`; status/priority migration gate remains. |
| I07 Chart/history | Dentist record finding, two-tab stale write and original-key retry; Staff redacted chart; Patient own simplified chart; Owner denied; historical encounter/read-only correction evidence. | Mandatory original tooth revision and key, append-only observations, unchanged completed documentation; current chart clearly separate from historical encounter. | `node tests/local-chart.browser.mjs`, `node tests/local-chart-readback.browser.mjs`, `node tests/local-clinical-history.browser.mjs`. Completed-treatment amendment policy remains unresolved. |
| I08 Prescription | Dentist explicit draft→edit→review→issue; stale issue refusal, void with reason, distinct correction prescription; Staff authorized read/PDF, Patient own issued/void view, Owner metadata only. | Exact original/correction IDs/numbers, immutable issued lines, idempotent recovery, current auth/branch, no autonomous medication decision. Completed encounter review is read-only and one action from its exact summary. | `node tests/local-encounter-prescriptions.browser.mjs`; lifecycle backend files above. Browser shortcut creates only a synthetic Draft; it does not certify new integrated issuance/PDF delivery. |
| I09 Follow-up | Dentist decision → task → authorized Patient/Staff selected-task booking → linked appointment completion; cancellation/no-show recovery. | Exact task/Patient/branch/requesting Dentist; one association under contention; clinical need is never auto-decided. | `node tests/local-followup.browser.mjs`; default-off capability must be approved on candidate. If task lacks treatment identity, do not claim exact originating-treatment linkage. |
| I10 Messages | Staff/Dentist/Patient keyword/contact search, literal highlights, empty/search pages, long lists/threads, send/receive, polling after transport loss. | Participant and branch context; no prior-Patient late read; no clinical message content for Owner; sender/receiver contrast, latest auto-scroll versus older history. | `node tests/local-message-search-acceptance.mjs`; live send/receive/worker/Reverb and STF-21 active-Dentist switching/history require candidate source/contract acceptance. |
| I11 Billing/receipt | Completed performed treatment → Staff draft/review/issue → synthetic exact Cash settlement → Patient persisted invoice/receipt and authorized PDF. Retry after committed response loss. | Correct immutable amount/link/revision, no duplicate payment/receipt, historical walk-in null appointment, foreign PDF denied, no payment mutation on read. | `node tests/local-receipt-navigation.browser.mjs`; real gateway and receipt email remain separate. Retain three prior 502 receipt-resend failures until resolved. |
| I12 Reports/notifications/archives | Owner compare scoped totals to synthetic invoice/payment evidence; Staff/Dentist date groups/archive visibility; Patient own historical records. | Exact period/branch totals, per-recipient unread/archive behavior, no global Owner access to clinical/messages, archive/restore audit. | Delivered Operations source required; GEN-11 restore/permanent-remove/Owner-all policy blocked. Report summaries are not profit or immutable scheduled artifacts unless proved. |
| I13 Expiry/revocation | Each role: open pending read/write; expire session or revoke scope/account in second authorized context; attempt original replay and direct resource/PDF read. | Server denial after revocation; no stale content/toast/navigation; recover original result only with current resource authority. | Use actual candidate auth middleware and journals; frontend hidden controls do not establish enforcement. |
| I14 Failure/races | Abort only the response after server commit; retry frozen key/body/revision; reload/new session recovery; real simultaneous conflicting workers. | One durable effect and exact original receipt, explicit stale conflict, no guessing failure from absent receipt/current unchanged state. | Owned contention lanes above; no write guards changed in Batch08. |
| I15 Background delivery | Private captured mail transport + worker/scheduler; schedule a synthetic enabled/wording-approved event; inspect intent→attempt→captured delivery and one retry after simulated transport failure. | No duplicate intent, retry/backoff/status truthful, current recipient, no private content in general logs; polling works if Reverb unavailable. | Not run here. No external recipients/provider configuration or invented approval. Hosted startup/production delivery separate. |

## GEN-07, DEN-14 and GEN-09 closure conditions

GEN-07: enumerate actual options from every integrated form; for each test Other reveal, visible example, blank/whitespace client and server refusal, stored/read-back category/detail, and switch-away clearing. Current known controls: Clinical Sex, Join/Family relationship, CounterIntake ID, follow-up reason, four prescription custom fields, Patient cancellation, document category/description and Workforce leave type. Existing custom-value-only prescription/follow-up contracts do not persist a separate Other flag; a title/private-note field may remain meaningful after another category. Resolve each contract against the full original task before claiming global closure. No extra demographic policy is approved by this list.

DEN-14: apply STF-21–24 on the real Dentist workspace, including actual send/receive, both bubble contrast/alignment, overflowing inbox/thread, latest auto-scroll, older paging and exact keyword/contact search. STF-21 must first define whether “Switch dentist” changes a participant or selected conversation, prior-history access and notification recipients. Renaming an append-participant command is insufficient.

GEN-09: record a comparable start/end and every pointer/keyboard activation for Check-In, appointment booking/management, Patient record lookup/review and prescription creation/review/issuance. Record click and keyboard paths separately; report fixture-dependent selection differences. Preserve explicit clinical/financial confirmations. Batch03 queue Call+Open 2→1 and Batch08 prescription detail 2→1 are bounded source-supported comparisons, not numeric performance targets or full common-flow acceptance. No elapsed-time saving is claimed.

## Exit decision

Candidate can proceed to comprehensive acceptance only after reviewed source/ancestry/migrations, startup/four-role authentication, focused cross-role smoke and safety checks. Every failed, blocked or not-run original task remains unfinished in the 68-row matrix. Keep receipt-mail, Intake, OWN-11 and environment failures separately identified. No main merge, deployment or hosted readiness follows automatically from this runbook.

## Sprint09 local qualification and intake additions

[Current intake manifest](integration/OPERATIONS_INTAKE_20261116.json) records expected `4703fec`, absent source/digest/candidate, the four held-file hashes and required Joevan file/contract/evidence inventory. Prepare a three-way Patient `src/patient/pages/Archives.jsx` comparison from common baseline → Clinical and common baseline → authentic Operations; do not overwrite either version or infer Operations behavior. Retain exact own/dependent scope, complete paging/error semantics, permitted historical content, receipt navigation/PDF identity, no-store and no write side effects.

Explicit transaction-safe synchronous-suite qualification now uses `--profile test --test-mail-profile suite test <reviewed files>`. It deliberately matches existing PHPUnit array/sync assumptions and does not represent a queued worker. Default `target` keeps database queue/local capture. Verify the separate `QueuedLocalCaptureTest.php` and `LocalCaptureTransportTest.php` against a running private loopback capture; do not replace either lane with the other or claim inbox delivery. SMTP capture accepts only synthetic `@example.test` recipients. Never start all demo scheduled tasks merely to turn a process check green: current scheduler also runs clinical/appointment automations and hold release. Review a dedicated synthetic candidate fixture and enabled rules first.

These are local Clinical qualifications and prepared integration steps. Full frontend retains two inherited failures; predefense and integrated readiness remain red/unestablished. All original 68 candidate acceptances, including workload publication, four-role/auth revocation, backup/restore and real write contention, remain to execute after authentic source and isolation gates pass.

## Sprint10 executable isolated runtime prerequisite

Before authentic integration, the independent Clinical lab may run against the exact owned empty test target:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/clinical-runtime-lab.py --target /private/tmp/jaztin-clinical-20261115c/target.json
```

It creates NEW disposable clusters, never resets/migrates the source, exercises source due-mail scheduling/real workers and PostgreSQL contention, then restores exact private document/state/key/access. Successful evidence is private `result.json` and logs. It stops both clusters; retain evidence. If provisioning fails before the cleanup scope, use the printed/created private target and reviewed `local-system.py --profile test stop`; never kill another target's PostgreSQL or delete evidence without cleanup approval. Full application scheduler, four-role integrated flows and all68 acceptance remain NOT RUN until candidate gates clear.

Owner FIFO and conversation-specific grant/revocation decisions are in `CLINICAL_OWNER_POLICY_DECISIONS_20261116.md`. The grant proposal is outside automatic migrations and approved only for testing in a NEW disposable cluster, not existing services. Notification/Archives/workforce comparison remains source-dependent.

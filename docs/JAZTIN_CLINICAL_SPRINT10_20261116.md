# Sprint10 — isolated runtime and recovery checkpoint

2026-11-16 Asia/Manila. Starting HEAD `a60f7816af4e45ccdf811204de7e692e05e91c9e`, clean Clinical feature branch; published Clinical `4cbb1386dbc4fd959b74882a95d370320d2a63e6` and baseline `a0725e645df6f8266c2bc4bebacc9d62dd18e7c1` verified as ancestors. No push, PR change, source import, merge or deployment.

## Accepted runtime slice

`scripts/clinical-runtime-lab.py --target /private/tmp/jaztin-clinical-20261115c/target.json` validates the explicit private manifest, exact loopback server/data-directory/cluster/database identity and all reviewed migration hashes. It refuses missing/foreign manifests, nonempty source fixtures, schema/identity mismatch and regular-runtime conversion. It never resets or migrates a database and never falls back to ambient credentials. It dumps the empty owned test database into a NEW private PostgreSQL cluster. Committed fixtures live outside ordinary PHPUnit feature discovery because they deliberately persist state; only the explicit guarded lab executes them.

The lab commits an actual API booking, an authorized synthetic walk-in Visit and a private PDF linked to the exact Patient/branch/Visit. It persists the mail intent/job before worker execution. A real worker with no SMTP listener records failure and backoff. The source mail schedule runs under a controlled Manila clock before eligibility and while a fresh processing claim is held, without a retry or claim theft. Fault injection kills a worker and its private SMTP server before DATA acknowledgement. Two independent PHP due-mail processors are then observed waiting on the SAME PostgreSQL row lock before release. The stale intent recovers to `logged_only` after exactly one local MIME capture; terminal worker/scheduler retries do not resend. General appointment/clinical automations are deliberately not executed.

The lab uses a private unprivileged loopback SMTP port; the transport still rejects non-example.test recipients, production, remote host syntax and invalid ports. No externally delivered/confirmed state is claimed. Delivery remains at-least-once: a crash AFTER SMTP acceptance but before recording can legitimately duplicate a send. The tested interruption was BEFORE acknowledgement.

Backup/restore uses pg_dump/pg_restore into a SECOND fresh cluster, preserving reviewed schema/triggers and the private test APP_KEY. Private object bytes are copied with symlink refusal and SHA-256 equality. Restored tests verify exact Patient/branch/appointment/Visit/document attributes, decryption witness, authorized Patient/branch Staff/responsible Dentist downloads, private no-store headers, denied foreign Patient/branch/Dentist/Owner access and Staff scope revocation. Invoice/payment/receipt counts do not change. Restore starts no mail/payment service and creates no capture. Both owned clusters stop in finally; evidence is retained privately rather than destructively cleaned up.

Successful final lab evidence: `/private/tmp/contention-0583bb5e/result.json`, source and restore logs beneath that private runtime; restored cluster `/private/tmp/contention-3f1b4bb9`. Earlier harness failures were retained: unloaded console schedule, incomplete pre-refresh model snapshots, wrong test actor guard/403 contract, and too-short contention lock window. These were fixture defects; original functional assertions were not weakened. Final seed/readback phases: **2 tests / 36 assertions**, plus explicit Python persistence, clock, interruption, lock-wait, capture and restore assertions.

## Original QAs and policy boundaries

GEN-07 (`FINALS-QA-REVISIONS.md:613`): every Other dropdown, required Specify/example, conditional server validation with BOTH category/detail, hide/clear on another selection. Existing Clinical inventory is in Batch08. Family/ID contracts already retain both fields; prescription/follow-up/custom strings and cross-role leave/document/category contracts still need compatible representation review. No new clinical category/default or duplicate implementation was invented. Partial.

DEN-14 (`:906`) applies ALL STF-21–24 changes, acceptance “Dentist messages match staff messages.” Prior send/receive/search/history/scroll/six-width evidence remains. Owner has now resolved the switching/history policy and explicitly approved scoped grants; see `CLINICAL_OWNER_POLICY_DECISIONS_20261116.md`. Schema review/testing is separately bounded; approval is not a passing lifecycle. Partial.

GEN-09 (`:821`): map common flows, count/reduce clicks, record comparable before/after; Check-In, appointments, Patient records and prescriptions must improve measurably. Batch08's prescription review shortcut remains the only cited bounded before/after slice. Complete like-for-like workflow/error benchmarks still need execution; no numeric target or invented baseline. Partial.

All **68 exact original rows and owners** remain; before/after **21 locally Complete / 36 Partial / 11 Blocked**. All 68 integrated acceptance pending. GEN-06/DEN-03 reproduction, admission/cancellation/handover and archive privacy decisions remain separate; neither new owner policy authorizes those operations.

## Validation and inherited failures

Focused queued/capture transport: **5 tests / 52 assertions**, including invalid-port refusal, original capture-only contract, real queued failure/backoff and single-use code activation. Database-free runner guard suite **21 pass**; new runtime-lab guard suite **4 pass**. Final frontend **1942 pass / 2 fail / 8 skip** (1952 total), unchanged from Sprint09. Smoke/build pass; existing React key and bundle-size warnings remain. No UI behavior changed in this runtime batch, so prior six-width UI evidence was not rerun or relabeled as new browser acceptance.

Remaining frontend failures: `batch4b-operations.test.js:24` obsolete scheduled-first assertion pending substantive approved FIFO/history acceptance by A; `staffing.test.js:106` OWN-11 source wording/contract discrepancy pending authentic Operations. See portable handoff.

Read-only predefense **local-only: 5 FAIL / 6 WARN**, comparable to Sprint09. Unqualified/default invocation additionally checks external mail/PayMongo/tunnel and reports **8 FAIL / 6 WARN**; those three checks were omitted by local-only, not repaired. No payment transaction or external diagnostic send was performed. Demo still lacks global worker/scheduler, unpaid invoice and confirmed synthetic branch fixture; aged outbox remains. The isolated lab does not turn the demo check green.

Read-only investigation of the original demo: **14 pending retryable intents, zero attempts, 14 jobs**, all referenced recipient accounts synthetic example.test; 9 appointment confirmations, 2 invoice-issued, 2 payment receipts, 1 message alert. Thirteen were older than one hour at initial inspection; all14 were older than the predefense ten-minute threshold. These are persisted synthetic fixtures awaiting processing, not proven external delivery failures. No replay, state edit or deletion was performed.

Logs: `/private/tmp/jaztin-clinical-sprint10-{frontend,mail,runner,lab-guard,runtime-final,smoke,build,predefense,predefense-local,own11,walkin}.log`. No real credentials, MIME, documents or dumps are committed. No broad backend/hosted/four-role integrated acceptance is claimed.

## Integration status

Expected Operations `8de2cf3f37e8ae253ec8d918e3690bdde3a1b1cb`. Reported complete bundle `joevan-source-20261116-192627.bundle`, reported digest `7db4ed03b04f5f5f59d382bd7bf8c218437d85d8f821bb99b7510ce3f632066f`; source received NO, digest receiver-verified NO, ancestry verified NO. Conditional local integration YES; conditions met NO; import/merge now NO; candidate NONE. Latest complete source is preferred; predecessor/delta requires express transfer-scope approval. Shared routing/API/Archives/notification/workforce/clinical/financial/authorization/migration comparisons remain prepared, unexecuted. All four held files remain unchanged/unexecuted.

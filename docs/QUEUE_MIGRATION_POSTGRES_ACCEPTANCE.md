# Deferred PostgreSQL acceptance — queue preservation

Assignment: DENTALOPS-QUEUE-MIGRATION-PRESERVATION-01. Date: 2026-11-12, Asia/Manila.

**Every case below is NOT EXECUTED. No database connection, provisioning, migration or runner is authorized.** The decision record selects a hold, not a runnable SQL patch. Source-only tests cannot pass these cases. Start only under a separate technical-lead assignment after policy/cohort decisions, trusted disposable-instance provisioning, runtime identity/privilege verification, external-provider suppression and enforcement at the actual command boundary. A database name, loopback endpoint, offline manifest or published source commit is insufficient.

See [decision record](QUEUE_MIGRATION_PRESERVATION_DECISION.md) for source facts, missing decisions and proposed invariant set. Use only synthetic records on separately approved disposable infrastructure. Never connect to an existing local/shared/clinical database to obtain these fixtures. Do not copy private credentials, production patient records, clinical text or priority reasons into reports/logs.

## Fixture cohorts and comparison protocol

- C0: empty exact predecessor schema; tests installation only.
- C1: populated exact predecessor with all five legacy queue states x all three priorities (15 tuples), legal closure, distinct reasons, NULL/empty reasons where schema permits, multiple Manila days/branches/Dentists and Patient identities. Couple queue/Visit/appointment/Treatment statuses coherently: Served can accompany In Treatment or Completed; Called/Ready are pre-start, not clinical In Treatment. Include both walk-in and appointment-linked Visits, no-Dentist admission, immutable histories, actor links, revisions and command receipts.
- C2: held migration recorded and exact target schema; all ten states x two priorities (20 tuples). Do not claim all tuples are operationally meaningful. Include alternate-state rows with and without complete, independently verified original-value evidence; include legitimate later writes.
- C3: explicit partial/drift cohorts: old/new constraints in mixed combinations, incorrect closure/index/trigger definitions, ledger/source mismatch, unsupported values, absent/incomplete provenance and conflicting identities. Construct such fixtures only under the separate approved setup protocol; their existence is not permission to bypass real protections.

For every case, retain an evidence record containing:

| Field | Required content |
| --- | --- |
| Identity | Approved run/case/policy IDs, exact reviewed application/migration hashes, PostgreSQL version/extensions, independently verified instance/database/role privileges, schema/constraint/index/trigger fingerprints |
| Before | Original synthetic fixture and row IDs/links/status/priority/exact nullable reason/closure/revision/actors/timestamps/counters; history/audit rows and hashes; ledger; prior command receipts |
| Operation | Exact reviewed command or failure injection, actor/scope/key/revision, execution start/end with explicit UTC instant and Manila business day, transaction/deployment boundary |
| Expected | Expected committed rows and refusals; preserved originals and links; legal constraints; exact history/audit effects; expected SQLSTATE/domain code where appropriate |
| Actual | Actual committed state read back after commit/rollback, separately observed constraints/triggers/ledger and history; no reliance solely on HTTP or process exit |
| Comparison | Field-by-field original/provenance comparisons, stable IDs/numbers/counts, closure and branch invariants, no overwritten history; no secret/clinical payload in aggregate evidence |
| Failure/recovery | Actual SQLSTATE and constraint name, transaction outcome, partial durable effects, approved recovery/rerun outcome, later legitimate writes retained; rollback refusal evidence where required |
| Result | PASS/FAIL only after execution and verification; otherwise NOT EXECUTED/BLOCKED with reason and reviewer |

Do not infer rollback success from a transaction wrapper. Validate actual deployed runner semantics and committed state. Missing original evidence must produce explicit unknown/refusal, never a fabricated PASS.

## Populated upgrade and preservation

| ID | Operation / fixture | Required expected outcome |
| --- | --- | --- |
| QP-01 | C0 versus C1: exercise held migration only in a separately approved negative reproduction | Record empty-path behavior separately; populated predecessor exposes source-predicted constraint failure. Capture SQLSTATE/constraint and actual row/schema/history/ledger rollback. No original-migration acceptance. |
| QP-02 | C1 complete 15-tuple matrix under an eventually reviewed replacement | Every tuple explicitly preserved or refused by approved policy; no silent defaults, merging or reason deletion; exact closure and identity comparison. |
| QP-03 | C1 Urgent values with distinct reasons, NULL and empty values | Exact originals remain represented; no reason reconstructed from category or generic timestamp. New-request retirement is tested separately from historical retention. |
| QP-04 | C1 mixed branches/Dentists/days, tied arrivals | IDs, Visit/container links, clinic day, numbers and next_number remain stable; no cross-branch remapping or invented ordering. |
| QP-05 | Existing append-only histories and audits, including mixed vocabularies | Byte/field hashes and counts of existing evidence unchanged; UPDATE/DELETE still refused through the approved role. No trigger disabling. |
| QP-06 | New preservation capture, if approved | Complete immutable originals precede any modifying conversion. Duplicate capture verifies equality; mismatch refuses; no overwrite/upsert that destroys originals. |
| QP-07 | C2 all 20 target-schema tuples | Distinguish schema legality from usable commands; alternate states with unknown meaning refuse automatic legacy recovery. |
| QP-08 | Check coherent queue closure versus Visit/Treatment completion | Served remains treatment-start queue departure under retained-lifecycle policy. No conversion alone creates/completes a Treatment or appointment. |

## Failure, recovery and source provenance

| ID | Failure / cohort | Required expected outcome |
| --- | --- | --- |
| QP-09 | Inject failure before preservation/conversion | No business or preservation changes committed; ledger not fabricated. |
| QP-10 | Inject failure after preservation and before conversion | Observe actual transaction behavior. No unjournaled conversion; approved retry verifies exact captured originals, never overwrites. |
| QP-11 | Inject failure during changed-value DML | Whole approved transaction rolls back, or separately approved partial-state protocol identifies every durable effect. Never assume atomicity. |
| QP-12 | Inject failure after constraint replacement | Validate all old/new constraints, rows, index definitions, histories and ledger after rollback/recovery. |
| QP-13 | Interrupted runner; any separately required nontransactional step | Explicit recovery protocol and actual valid-index/constraint state. No blanket rerun or invented ledger entries. No such step is currently proposed/implemented. |
| QP-14 | Unexpected status/priority or existing invalid closure | Refuse before conversion; preserve original evidence and show discrepancy. No automatic normalization. |
| QP-15 | Recorded applied migration with mismatched schema/source | Refuse despite ledger; compare exact source/constraint/index/trigger identities. Route to approved cohort repair. |
| QP-16 | Unrecorded migration but alternate values/constraints present | Refuse automatic predecessor assumption or ledger synthesis. |
| QP-17 | Incomplete/missing history, backup or original-value provenance | Mark unknown/unrecoverable fields explicitly; no inferred Called/Ready/Away/Urgent reasons. |
| QP-18 | Rerun after verified transactional failure and after partial failure | Distinct cohort handling; deterministic approved results; original journal rows never overwritten; no duplicate conversion events or queue entries. |
| QP-19 | Restore/reverse request after later legitimate queue/treatment changes | Refuse automatic reversal or use approved forward repair retaining later actions. Never overwrite newer revisions with captured old values. |
| QP-20 | Current-only/history-only Cancelled/No-show/unknown rollback inputs | Preserve existing guard/refusal until separately reviewed; do not broaden rollback into destructive QueueBackfill::rollback. |
| QP-21 | New migration source hash or inventory changed/reordered/omitted | Offline gate remains BLOCKED with original holds; new manifest/bytes require independent review, not manufactured approval. |

## Runtime and interoperability

| ID | Command / scope | Required expected outcome |
| --- | --- | --- |
| QP-22 | Scoped Staff/Owner administrative Call, Ready, Away, Return | Legal state transitions/history/revisions; same-target behavior understood; invalid state and historical-day refusals preserved; exact entry selection (no invented Call-next). |
| QP-23 | Own Dentist Call and other Dentist/branch attempts | Own Call permitted where valid; Ready/Away/Return/priority remain Staff/Owner only; cross-branch/other-Dentist and Patient writes refused. Scope revocation/direct service entry need separate enforcement evidence. |
| QP-24 | Priority and late-order controls | Approved new-request vocabulary and reason/verification rules preserved; legacy Urgent evidence retained; actual position behavior matches signed FIFO/priority/late policy. |
| QP-25 | Scheduled check-in, held booking and repeat check-in | Exact appointment creates exactly one Visit/queue and correct history/counter/key; held payment refused; rollback and duplicate behavior preserved. |
| QP-26 | Walk-in with/without responsible Dentist; closed branch/off-shift | No fabricated appointment; assigned Visit gets one queue entry; no-Dentist Visit gets none; ineligible admission refuses atomically. |
| QP-27 | Responsible Dentist treatment start; unavailable/busy/wrong Dentist | Called/Ready -> Served at start with correct timestamp, Visit/appointment/Treatment cascade; forbidden/duplicate/busy/refusal cases leave no partial evidence. |
| QP-28 | Treatment document and complete, including already-completed replay | Served requirement remains satisfied; completion cascades correctly, queue remains terminal as approved, history/audit protected and requested follow-up created once. |
| QP-29 | Appointment cancellation/no-show before versus after Visit creation | Existing pre-arrival lifecycle; after-admission behavior remains refused absent new policy. Follow-up linkage/reopening remains exact. |
| QP-30 | Patient mine, Staff index/show, Dentist own queue, Owner summary | Stable ULIDs/raw status/Visit status/revisions; own/scoped reads; no Patient leakage; list cap/truncation retained. |
| QP-31 | Intake queue load, frontend counts and historical served reporting | Compare same committed fixtures across projections with approved definitions; no absent Patient silently positional, no completed-care inference from queue label, no duplicate Visit tally. |
| QP-32 | Queue-related history events and downstream notification intents | Existing event attribution retained; no invented dispatcher. Appointment/follow-up notices match actual successful transactions; providers suppressed. |
| QP-33 | AUD-10 selected task -> appointment -> admission -> treatment/follow-up | Exact task/appointment proof and identity survive; check-in uses same appointment; no task substitutions or partial linkage. This does not replace the 25 AUD-10 cases/five contention scenarios. |
| QP-34 | Idempotent successful replay, changed payload, stale revision, old receipts at cutover | Original receipt semantics explicit; no same-revision state change behind receipts; changed payload/stale state refused according to reviewed contract. |

## Concurrency and deployment windows

| ID | Competing actions | Required expected outcome |
| --- | --- | --- |
| QP-35 | Simultaneous admissions for same Patient/appointment | At most one valid Visit/entry; consistent failures, no orphan history/keys/counters. |
| QP-36 | Concurrent distinct arrivals into same Dentist/day container | Unique increasing issued numbers; no duplicate container, no reassignment, consistent rollback behavior. Sequence/counter gaps are assessed by actual contract, not guessed. |
| QP-37 | Staff versus Dentist Call/Ready/Away/Return | Legal serial outcome, conflict/stale behavior, attributable events and no duplicate effects. |
| QP-38 | Treatment start versus Away/priority/other queue state change | Appointment -> Visit -> entry/container -> Treatment lock protocol respected; either coherent clinical start or valid refusal; no split encounter state. |
| QP-39 | Cancellation/no-show versus admission | One coherent pre-arrival cancellation/no-show or admitted Visit; no checked-in cancelled appointment with orphan entry. |
| QP-40 | Permitted rolling old/new writers, readers, workers and cached receipts | Either prove compatibility across all versions or enforce an approved maintenance fence. Legacy Urgent-writing clients must not run against a contracted enum. Do not assume schema/application deploy atomically. |
| QP-41 | Writer attempts during capture/constraint/conversion window | Actual enforcement prevents unsafe overlap; post-cutover reads prove identity/provenance/revision consistency before writes resume. Existing standalone library does not provide this fence. |

## Offline coverage disposition for the requested regression list

| Requested cases | Offline evidence now | What remains blocked |
| --- | --- | --- |
| 1-4, 7-9 | Literal source domains/maps extracted; 15 legacy + 10 alternate tuple decisions checked; no runtime mapper implemented | Applying approved mappings and refusing unknown persisted data: QP-02/07/14/17 |
| 5-6, 10 | Synthetic collisions/round trips/reason erasure demonstrated from actual SQL; exact-provenance design documented | Immutable capture, retry and recovery: QP-03/06/18/19 |
| 11-13, 18-19 | Command targets fit union; converted sources fail; serialization/raw status and reporting predicates inspected | Real authorization/transition/projection behavior: QP-22-24/27-32 |
| 14-17, 20 | Stable identity/revision/relationship source paths documented; no production/AUD-10 change | Persisted invariants, races and exact follow-up chain: QP-04/25-30/33-39 |
| 21-27 | Bad ordering and absence of journal identified; no proposed SQL implemented; applied-state tree and rollback restrictions documented | Actual constraints, transaction/failure/recovery/ledger state: QP-01/05-20 |
| 28-30 | Full migration byte/digest pin and original holds verified; tests explicitly source-only | New approved schema policy and runtime authorization remain absent: QP-21 |
| 31-38 | No production permissions changed; Node dependency closure has no application/database/provider/process imports; source-only reads | Runtime authority/audit/branch safety and enforcement still require approved acceptance, not substring assertions |

Passing the offline decision-evidence suite means the source facts and unresolved hazards remain accurately represented. It does not clear a single PostgreSQL case in this document.

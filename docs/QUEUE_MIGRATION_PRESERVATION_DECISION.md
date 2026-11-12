# Queue preservation decision — DENTALOPS-QUEUE-MIGRATION-PRESERVATION-01

Date: 2026-11-12, Asia/Manila. **Implementation verdict: BLOCKED.** This is a source-grounded decision record, proposed patch plan and offline evidence package. No production file or migration is changed. Database access, migration execution, staging, commit, push, merge and deployment are not authorized.

## 1. Checkpoint, evidence and authority

- Repository: `https://github.com/ccadaverr/multibranch-dental-clinic.git`.
- New registered worktree: `scratch/jaztin-queue-preservation-20261112`, branch `feature/jaztin-queue-preservation-20261112`.
- Starting/current HEAD: `15d626c03c97baf7198a7b7ca6dea2bec8f60836`, published UX baseline. Fresh remote references also matched backend `e2654fafb1d30b6e50d3c1e475b2a3c0af227457`, shared frontend `f4749ddb8ec0a93fe88df9dbf0897579371b9718` and gate `431ce91805d546913dcf18cdb9e78b4af0010a8d` before worktree creation. Proposed branch/path were absent; no worktree was overwritten or merged.
- Queue migration, Queue/Visit/Treatment services and queue model/request/controller/policy/resource sources are identical across the baseline and those published checkpoints. The baseline is authoritative for this analysis; AUD-10 additions are inspected separately, not integrated.
- `git log --all -- <migration>` identifies `f4b04f62da2a6dd40655692b75a5f7c13b2ba373` (2026-10-28, subject `QA: tested and implemented QA list`) as the source introduction of the target migration. A November filename is not proof of a future/unapplied migration. Git contains source history, not a deployment ledger.
- Exact inspected-source fingerprints and all 25 supported legacy/alternate status-priority tuples are in [review-manifest.json](../qa/queue-preservation/review-manifest.json). They identify bytes; they certify neither policy nor database state.

Evidence labels: **source fact** means inspected code; **proposal** means an engineering recommendation; **decision required** means authority/evidence is missing. Historical QA checkboxes and historical test reports are not fresh runtime acceptance.

`FINALS-QA-REVISIONS.md:55,94-95` and `QA-JOEVAN.md:142,274-292` request simplified labels and removal of Urgent. Frozen `docs/architecture/CONTRACTS.md:315-339` requires distinct queue states and defines Served at treatment start; its priority wording conflicts with current FIFO. `QA-JOEVAN.md:12` and `docs/JOE_QA_02_BACKEND_ACCEPTANCE_REPORT.md:27-28,46,78-82` already disclose this unresolved contradiction. This assignment does not choose one policy by rewriting the other.

## 2. Confirmed defects, including corrections to earlier descriptions

| Finding | Exact source evidence | Consequence |
| --- | --- | --- |
| D1: incompatible statement order | Target migration `up():19-21` changes all five legacy states before status check replacement at `35-36`; closed check changes only at `39-40`. Predecessor create migration `53-56` permits five legacy states and requires closure exactly for Served. | Any populated, conforming predecessor queue has at least one row that one of the first three updates attempts to give an illegal status. Served -> Done also conflicts with the old closure predicate. This is a source prediction; SQLSTATE/actual atomic rollback are unexecuted. Empty-table installation can hide it. |
| D2: runtime source-state incompatibility | `QueueService::TRANSITIONS:31-36`, `serve():83-93`; `TreatmentService::assertActiveEncounter:226-233`. | Converted entries lose legal Call/Ready/Away/Return/start paths; converted Served -> Done blocks active treatment document/complete. **Correction:** retained named-command target states are accepted by the migration's union check. The problem is converted source-state meaning and command eligibility, not blanket rejection of all command targets by the final constraint. |
| D3: many-to-one loss | Target `19-20,86-87`. | Waiting/Away both become In Queue; Called/Ready both become In Treatment. `down()` chooses Waiting and Treatment Ready, so it cannot reconstruct the originals. |
| D4: reason erasure | Target `24`, no original-value journal anywhere in `up()`. | Every Urgent reason becomes NULL and Urgent becomes Normal, indistinguishable from pre-existing Normal without independent evidence. |
| D5: no conversion provenance | Target changes status/priority/closure only; no revision increment, actor, updated timestamp, history event, command-key coordination or preservation journal. | A current row may disagree with history and cached command receipts at the same revision. A timestamp alone cannot reconstruct the lost distinctions. |
| D6: closure/index/report mismatch | Target `40`, predecessor partial index `58`, `AnalyticsService:145-150`, `src/queue-counts.js:14-34`. | Cancelled/No-show are command-closed yet require NULL closed_at under the target. Old `status <> 'Served'` index also includes Done/Cancelled/No-show. Served-only reporting loses converted rows; frontend counts omit In Queue despite server positions including it. Index mismatch is not proof of an incorrect query plan/result. |
| D7: priority/order contract split | `QueueEntry::PRIORITIES`, `QueuePriorityRequest:26-29`, `QueueService::positions:215-229`, `PatientFlow.jsx:369-400`. | Stored/request Urgent is retired in current model/request, but category/UI/comments still mention it. Actual position SQL is arrival then queue number, without priority, Called/Ready precedence or late flag. Do not infer policy from comments or silently restore old sorting. |

The target migration does **not** rewrite queue history or disable its trigger. That preservation is valuable but does not make current-value conversion lossless. The older `QueueBackfill::rollback:69-83` separately disables the append-only trigger and deletes marked entries/history; broad rollback must not be used as cleanup or recovery.

## 3. Schema vocabulary and identities

Source chain: `2026_10_01_000100_create_queue_tables.php` -> `2026_10_01_000200_backfill_queue_entries_from_visits.php` -> `2026_10_28_000200_create_arrival_and_freed_slot_tables.php:95` (late_arrival only) -> held `2026_11_16_000500_update_queue_statuses_and_remove_urgent_priority.php`. Repository-wide migration search found no intervening queue check replacement.

| Contract | Predecessor | Target migration, if it completes |
| --- | --- | --- |
| Queue statuses | Waiting, Called, Treatment Ready, Temporarily Away, Served | In Queue, In Treatment, Done, Cancelled, No-show **plus all five legacy states** |
| Priority | Normal, Priority, Urgent | Normal, Priority |
| Closure | closed_at nonnull iff status = Served | closed_at nonnull iff status in Done/Served |
| Number | queue_number >= 1; unique within dentist_queue_id | Unchanged |
| Container | unique branch + Dentist + clinic_date; counter starts at zero | Unchanged |
| Entry identity | Unique public_id; unique visit_id; required Visit/container foreign keys with RESTRICT deletion | Unchanged |
| Patient/branch/appointment | Derived from Visit and container; not independent queue columns | Unchanged |
| History | Required queue_entry_id, to_status, to_priority, revision and event time; optional from values/actor/reason; no status enum checks | Unchanged; append-only UPDATE/DELETE trigger retained |

`QueueEntry.php:17-22` exposes the ten-state union, four positional states (In Queue/Waiting/Called/Ready), and two writable priorities. A model constant or read filter is not proof of a usable command for every listed state. No producer for queue Cancelled/No-show or generic queue status writer was found. Appointment No-show is a distinct pre-admission process.

## 4. Legacy-to-target preservation decision

**Proposal:** preserve persisted queue lifecycle and distinguish display phase from clinical state. No conversion is authorized. If simplified display labels are approved, derive them from queue **and Visit/Treatment context**, retaining raw state; do not relabel Called as a clinical treatment start. No frontend change is included here.

| Original status | Source meaning / available actions | Observed unsafe target | Proposed retained representation | Loss / reverse issue |
| --- | --- | --- | --- | --- |
| Waiting | Admitted to assigned Dentist queue; Call or Away | In Queue | Waiting, original closure/revision/links | Collides with Away; original distinction lost |
| Called | Exact Patient called; Ready, Away or responsible-Dentist treatment start | In Treatment | Called | Collides with Ready; down chooses Ready; calling is not clinical start |
| Treatment Ready | Prepared for Dentist; Away or treatment start | In Treatment | Treatment Ready | Collides with Called; readiness distinction lost |
| Temporarily Away | Entry retained without position; Return | In Queue | Temporarily Away | Collides with Waiting and incorrectly restores presence; down chooses Waiting |
| Served | Left waiting queue at treatment START; no more queue transitions; Visit may be In Treatment or Completed | Done | Served, original closed_at | Status mapping is one-to-one for this original group, but Done does not establish completed care and breaks Served prerequisites/reporting |

All three predecessor priorities can accompany all five predecessor statuses: **15 combinations**, no cross-column status/priority constraint. `review-manifest.json.legacyCombinations` explicitly enumerates them. The status table applies independently to each priority below:

| Original priority | Observed unsafe conversion | Proposed preservation | Current new HTTP request | Historical meaning / reversibility |
| --- | --- | --- | --- | --- |
| Normal | Normal, reason retained | Preserve value and exact nullable reason | Permitted with reason/revision | Operational flag; no semantic normalization |
| Priority | Priority, reason retained | Preserve value and exact nullable reason | Permitted with reason/revision | Operational classification, optional category/verification text; not medical triage |
| Urgent | Normal, reason NULL | Preserve original Urgent and exact reason in original row until an approved retirement design exists | Rejected by priority enum; category Urgent is separately permitted | Historically operational priority. Pre-f4b04f6 source sorted it first; free-text reasons are not proof of clinical urgency. Conversion also collides with Normal; no inverse from destination alone |

The five alternate-only states times two current priorities add **10 combinations** under the target schema. They are explicitly inventoried and **refused automatic recovery**, even if current readers display them:

| Existing alternate status | Proposed disposition |
| --- | --- |
| In Queue | Do not guess Waiting versus Away; require original evidence and current encounter reconciliation |
| In Treatment | Do not guess Called versus Ready or assume a clinical Treatment exists |
| Done | Do not infer completed Visit/Treatment; verify original Served evidence and encounter context |
| Cancelled | Preserve unchanged; post-admission cancellation/closure/actor policy unresolved |
| No-show | Preserve unchanged; do not reinterpret as appointment pre-arrival No-show |

Unknown statuses/priorities, malformed links, mismatched closure or unsupported combinations require refusal and reviewed reconciliation, never a default. A target-schema Urgent row is drift, not permission to normalize. Identity retention is a design recommendation, not a new transformation routine. Current commands need not operate on every legacy historical row (for example a past clinic day); preservation does not expand authority.

## 5. Runtime command compatibility matrix

Paths below are under `backend/app/` unless stated. The normal HTTP route/controller policy boundary remains authoritative; QueueService does not independently reauthorize current actor scope under its locks. That existing enforcement-placement limitation remains open; this task adds no permissions or direct-service path.

| Command / method | Actor and inputs | Legal source -> target | Revision, relationships, evidence, order and errors |
| --- | --- | --- | --- |
| `VisitService::checkInScheduled:45-89` via VisitController | Scoped Staff or existing Owner front-desk exception; appointment ULID, expected revision, required key | Pending/Confirmed appointment -> Checked In; new Checked In Visit; optional queue Waiting/Normal | Today Manila, no held booking payment, no active Visit/duplicate appointment Visit; appointment history + Visit history + queue entry/history in shared transaction. Exact Patient/branch/Dentist from appointment. 409 stale/duplicate; 422 invalid/held/not today. |
| `VisitService::walkIn:91-113` / `open:192-209` | Same front-desk authority; exact Patient/branch, optional service/Dentist; key | New Checked In Visit, appointment NULL; assigned Dentist -> Waiting/Normal; no Dentist -> no queue | Branch hours, service/Dentist eligibility/shift, no active Visit. No fake appointment. Same transaction/history; no client queue number. 422 walk_in_invalid; 409 active_visit_exists. |
| `QueueService::allocate:64-76` / `enqueue:43-55` | Internal admission/backfill helper, no public queue-create permission | Counter upsert + next_number; new Waiting/Normal/revision 1 | Partition branch/Dentist/Manila day. Unique per Visit/number/container constraints. Original late flag recorded as queue.entered_late or queue.entered. Actual concurrency unexecuted. |
| `transition:109-132`, command Call | Scoped Staff/Owner exception or queue's own Dentist; entry ULID, expected_revision, key | Waiting -> Called (`queue.called`) | No automatic Call-next selector: exact entry chosen by human. Refuses unavailable Dentist. Converted In Queue is not an allowed source. |
| Same, Ready | Scoped Staff/Owner exception | Called -> Treatment Ready (`queue.ready`) | Converted In Treatment is not an allowed source. |
| Same, Away | Scoped Staff/Owner exception | Waiting/Called/Ready -> Temporarily Away (`queue.away`) | Removes position by status; original arrival/number stay. Converted sources are rejected. |
| Same, Return | Scoped Staff/Owner exception | Temporarily Away -> Waiting (`queue.returned`) | Retains original arrival/number. Converted In Queue cannot Return. |
| `priority:135-183` | Scoped Staff/Owner exception; Normal/Priority, reason, revision/key; optional category/verification | State unchanged; active Waiting/Away mutable; Called/Ready refused | Reason required by request, optional eligibility label appended; revision+1 and history + administrative audit. Current FIFO positions do not use this flag. Urgent request rejected; no triage inference. |
| `restoreOrder:188-203` | Scoped Staff/Owner exception; reason, revision/key | late_arrival true -> false, status unchanged | History/audit append. Actual FIFO SQL ignores late flag, so no guaranteed position movement. No-op if flag already false after lock checks. |
| `TreatmentService::start:49-103` -> `QueueService::serve:83-93` | Responsible Dentist only; Visit ULID, Visit revision/key | Queue Called/Ready -> Served; Visit + optional appointment Checked In -> In Treatment; new Treatment In Treatment | Exact encounter link checks, no existing Treatment, one active Treatment/Dentist, lock appointment -> Visit -> queue/container -> Treatment. Queue closed_at set NOW at start, queue revision+1/history; Visit/appointment/Treatment histories and audit in one transaction. 409 stale/duplicate/busy, 422 queue_not_ready/mismatch, 403 wrong Dentist. |
| `TreatmentService::document:113-154` | Responsible authoring Dentist; Treatment revision/key and permitted documentation | Treatment remains In Treatment; queue must remain Served | No queue rewrite. Converted Done fails encounter_mismatch; entry identity mismatch refused. Revision/history snapshots remain protected. |
| `TreatmentService::complete:156-196` | Responsible authoring Dentist; Treatment revision/key; valid summary/procedure lines | Treatment + Visit + optional appointment -> Completed; queue stays Served | Active encounter requires Served. Histories/audit append; requested follow-up task created once via Followups::fromTreatment. Completed replay/no-op guarded by author locks. Conversion to Done can prevent completion and therefore follow-up creation. |
| `QueueController::index/show`, `patientCurrent` | Scoped Staff, own Dentist, Owner oversight; Patient mine from session only | Read only, actual serialized status and separate Visit status | Index cap 500 with truncation metadata. No status translation/write authority. Patient phase prefers real Visit In Treatment; otherwise Waiting/In Queue/Called/Ready/Away lookup. |
| Cancellation / No-show | Appointment pre-arrival Staff/Owner or existing Patient cancellation rules; not a queue command | Appointment only, before a Visit exists | `AppointmentService::cancel:193-198`, `assertNoShowAllowed` refuse admitted Visit. No queue Cancelled/No-show producer or post-check-in leave policy is implemented. |

For the four named transitions, lock validates exact Visit/container branch, responsible Dentist, clinic date and arrival date (`QueueService:281-312`); it rejects closed entries and non-Checked-In Visits before same-target no-op. Expected queue revision is required for a real state change (`314-325`), while same-target no-op may return before revision comparison. History captures entry ID, event, from/to status/priority, revision, actor and clock (`328-342`). Idempotency stores/replays response per account/key (`Support/IdempotentCommand.php`); changed payload is 422, stale revision/concurrency 409, business rule 422, authorization 403, missing resources normally 404. Actual effects are source facts, not persisted acceptance.

All retained command status targets fit both predecessor and final union status domains. Current request priorities Normal/Priority also fit both. Supporting alternate reads does not repair converted-source transitions. Prior Urgent-writing code cannot coexist with the target two-priority constraint in a rolling deployment. Current code continues producing legacy Waiting/Served after the held migration.

## 6. Reporting, notifications and AUD-10 dependencies

- `Analytics/AnalyticsService:77-85` counts current POSITIONAL states on Manila day; historical served query `145-150` counts only Served, by created_at window. It is not a count of completed treatment. `src/queue-counts.js` only tallies Waiting/Called/Ready/Away. Away -> In Queue thus gains a server position while disappearing from frontend counts; Called/Ready -> In Treatment disappears from waiting counts. Both must be reconciled before conversion, without broad analytics rewrites here.
- `Services/Intake/IntakeService:174-175` uses In Queue/Waiting/Called/Ready to select queue load. `Automations/OwnerSummaryData:33-35` counts queue.entered_late history through stable Visit links, including later late-order restoration. Keep those rows attributable and count each Visit once per approved metric.
- No queue call/ready/serve notification dispatcher was found in the inspected queue service/controller, Events or notification service graph; do not invent one. Appointment/follow-up notification intents follow their own workflows; no providers were invoked.
- `src/queue-api.js:11-47` retains real status/priority/revision/ULIDs and derives display phase from Visit only for Served. `src/encounter.js:31` permits Start only for Called/Ready and Checked In Visit. PatientFlow exposes Call for In Queue as well as Waiting, despite backend Call accepting Waiting only; its Urgent form submits a request rejected by the backend. These are existing interface conflicts, not authorized frontend corrections.
- Published backend R2 adds exact `followup_task_id` + revision, Staff authorization, scoped task lookup, appointment/slot-before-task lock order and response proof (`git show e2654faf:backend/app/Services/Followups/Followups.php`, methods selectedForBooking/validateSelectedBooking/bookSelected; AppointmentService::create). These additions do not change queue services, Visit creation or queue identity.
- Subsequent check-in still derives Visit Patient/branch/appointment/Dentist from that exact appointment. A queue conversion never may remap appointment/task/Visit/Treatment IDs. Broken queue treatment prerequisites can indirectly block appointment completion and the next requested follow-up; they do not invalidate already committed selected-booking linkage. Cancellation before arrival reopens linked Booked tasks; admitted cancellation remains refused. No AUD-10 file changed; its 25 PostgreSQL workflow cases and five contention scenarios remain unexecuted.

## 7. Preservation and provenance requirements for any future conversion

If the lead selects a persisted lifecycle replacement rather than the recommended retained lifecycle, first approve a per-entry, append-only preservation design. Do not implement these proposed fields without that review:

1. Trusted run/source/approved-policy identity and actual verified schema fingerprint; exact entry ID/public_id, Visit/container ID, Patient/branch/Dentist/day context; original status, priority, **exact nullable priority_reason**, closed_at, late_arrival, revision, created_at/updated_at and actor links. Preserve original NULL versus empty reason. Store original values before any conversion.
2. A unique run+entry identity with insert-only semantics. Retry may verify exact prior capture and resume under an approved state machine; it must not overwrite originals through an upsert. Changed context/revision/schema or partial journal requires refusal. Hashes alone cannot recover original values.
3. Restricted reason access at least as strict as the original data. Existing free text may contain sensitive content; do not copy it to broad administrative audit/email/logs. Journal is not a new Owner clinical-read permission. Privacy/retention review remains needed.
4. Separately attributable conversion evidence with original revision and resulting revision, exact policy version/target, outcome and actual verified time; no fake clinician actor or fabricated migration-ledger row. Preserve existing histories byte-for-byte. Any new domain event/revision protocol must be reviewed with commands, cached idempotent receipts and clients first.
5. Restore only from verified originals when no subsequent legitimate command has advanced state and identity/schema still match. Otherwise refuse automatic reversal and route to approved forward reconciliation. Never restore all Done to Served or all In Treatment to Ready based on a label.

History may help an already-converted environment, but it is not guaranteed to contain every exact pre-conversion reason/closure/status. Latest recorded event is not automatically migration-time truth: missing/imported/manual writes, later legitimate transitions and same-revision conversion matter. Backup/journal completeness, cutover time and row linkage must be independently established. If proof is missing, mark information **unknown/unrecoverable from available evidence**; never fabricate it.

## 8. Four strategy evaluation and selected decision

| Strategy | Preservation / runtime | Transactions, retries, failures and rollback | Applied-state / sequencing decision |
| --- | --- | --- | --- |
| A: correct historical source | Can retain original lifecycle/priority evidence if a replacement is explicitly approved; SQL-order-only edit is insufficient | New content hash must be reviewed; exact preconditions, postconditions and failure tests required. Destructive down is not recovery | Only after authoritative inventory proves it never applied in any relevant environment and release owners approve historical-byte change. Unknown now; do not edit it. |
| B: additive capture then controlled conversion | Can preserve exact originals; does not define clinical meanings or make commands compatible | Capture before mutations, immutable originals, coherent constraints, transaction and exclusive-write fence. Retry verifies prior capture, not overwriting. Recovery conditional on later writes | A new later migration does not run before a failing pending predecessor. Backdating a filename is not a solution for databases that already passed it. Needs reviewed upgrade lanes and policy. Not ready. |
| C: forward-only corrective migration | Preserves applied history; can repair compatible schema and only evidence-proven rows | Verify actual ledger + constraints + data independently. One reviewed transaction where supported; fail closed on drift; no blind down. Nontransactional steps require separate recovery protocol | Appropriate for known applied installations, but cannot recover erased data or bypass a pending broken predecessor. Different installation cohorts need separate release routing. Not ready. |
| D: explicitly hold conversion | Preserves every current byte and existing command vocabulary; does not add mappings or authority | No SQL, no rollback, no ledger manipulation. Existing migration remains dangerous if invoked outside unenforced gate | **Selected now.** Deliver decision package, await policy resolution and separately authorized applied-state inventory. Gate and external-command execution holds remain active. |

No option authorizes running anything. A future preservation-first retain-lifecycle source patch may be smallest for a proven never-applied cohort. A verified applied cohort instead needs forward-only reconciliation; these cannot be silently treated as the same upgrade.

## 9. Applied/unapplied/failure decision tree

| Observed installation state (future evidence) | Required disposition |
| --- | --- |
| Not applied; exact predecessor schema | Hold original migration. Decide retained lifecycle versus redesign. Review A or coordinated B path before any runner. No fake skipped/applied ledger row. |
| Recorded applied; exact target schema and complete provenance | Use C after original-value/encounter review; preserve historical migration bytes. New policy must support currently legitimate post-migration writes. |
| Failed under verified transactional PostgreSQL migrator | Verify actual rollback of row/schema/history/ledger changes; do not assume from exit code. If verified, classify as predecessor cohort; prior successful migrations remain applied. |
| Partial/manual/nontransactional failure | Freeze affected writes under separately authorized operations; inventory actual schema/data/ledger, preserve observed evidence, classify rows individually. Do not rerun up/down blindly. |
| Ledger says applied but schema differs, or ledger absent with target values | Refuse automatic remediation; ledger is not schema proof. Capture constraint/index/trigger hashes and deployment source identities. |
| Conversion erased originals without complete backup/journal/history evidence | No automatic lossless inverse. Preserve available evidence, explicitly record gaps and seek approved recovery/manual reconciliation. Do not infer from generic timestamps or UI state. |

This checkout has no backend/vendor directory; no application/vendor bootstrap was run. The migration inherits framework defaults and contains no explicit transaction or withinTransaction=false. Laravel/PostgreSQL transaction behavior is a **future runner acceptance prerequisite**, not an atomicity guarantee established here. CHECK compatibility must hold at each modifying statement; wrapping invalid intermediate states in a transaction is not a correction. No claim is made about any actual database's migration status.

## 10. Proposed patch sequence after decisions (not implemented)

1. Lead signs persisted state meanings, closure semantics, priority retirement versus historical retention, FIFO/late/Called precedence, and post-admission Cancelled/No-show policy (or explicitly leaves those unsupported). Recommend distinct legacy queue lifecycle and separate encounter display phase.
2. Separately authorized infrastructure owner inventories all relevant migration cohorts, schemas, source versions and original evidence without touching clinical records beyond approved access. No access is authorized by this document.
3. Select A only with never-applied proof; otherwise design C plus a separately reviewed path for pending predecessors. Do not solve sequencing by ledger invention, trigger disabling, constraint bypass or broad rollback.
4. Before each production-file change, record repaired invariant, behavior retained, historical-byte impact and offline/persisted test plan. Exact future file manifest depends on the selected cohort/policy; do not add speculative migrations or adapters now.
5. If conversion is approved, capture originals, fence all writers/workers/clients, validate the source domain, replace/expand all incompatible status/closure checks coherently **before** changed-value DML, append reviewed evidence and validate constraints/identities. Keep original values/constraints until all old/new readers and writers are compatible; only then consider contraction. No FK or history-trigger bypass. No concurrent CREATE INDEX is required by this unimplemented design; any such later step requires a separate nontransactional plan.
6. Use a maintenance window unless rolling compatibility is actually proven for each writer and receipt. Preserve exact IDs/counters, do not re-number or replay clinical commands to manufacture history. Verify postconditions before resuming writes. Rollback requires verified restore/forward repair with post-cutover changes accounted for; code rollback alone changes no data.

## 11. Safety invariants and deferred PostgreSQL acceptance

Required: same entry/Visit/Patient/branch/Dentist/appointment/Treatment links; stable public IDs/numbers/counters and clinic day; one entry per Visit; exact history attribution and protection; reconstructible required originals; no expanded actors; legal command targets remain representable; invalid commands remain refused; revision/idempotency behavior remains explainable; treatment start and completion stay atomic with Visit/appointment; one Visit is not double-counted across mutually exclusive report states. All are requirements, not live acceptance.

The detailed [PostgreSQL acceptance matrix](QUEUE_MIGRATION_POSTGRES_ACCEPTANCE.md) covers populated upgrades, failure/recovery, runtime, concurrency, source drift, audit/history and preserved evidence. **All cases are NOT EXECUTED.** Other destructive/nontransactional migrations remain held. No environment name is disposability proof.

## 12. Offline verification and scope

New files only:

- This decision record.
- `docs/QUEUE_MIGRATION_POSTGRES_ACCEPTANCE.md` — deferred matrix and evidence protocol.
- `qa/queue-preservation/review-manifest.json` — data-only source fingerprints, observed mappings and per-combination refusal decisions.
- `qa/queue-preservation/source-contract.test.mjs` — Node builtins only, reads source as text, extracts exact literal domains/maps/commands, checks collisions and source-based constraint predicates using synthetic tuples. Never imports/includes PHP, Laravel, a migration or an application client. It is a **decision-evidence suite**, not a repaired-migration acceptance suite; asserting known hazards remain observable does not make them pass acceptance.

Executed from the isolated worktree, Node v22.19.0:

```bash
env -i PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node --permission --allow-fs-read=/Users/glesielynalcantara/Documents/dentalops-integrated-review/scratch/integration-abc-20261111/scratch/jaztin-queue-preservation-20261112 --test --experimental-test-isolation=none qa/queue-preservation/source-contract.test.mjs
env -i PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node --check qa/queue-preservation/source-contract.test.mjs
git diff --check
```

Result: **73 tests passed; zero failed/skipped**, syntax passed. Node received no filesystem-write, child-process, worker or native-addon permission; test isolation none avoids test-file subprocesses. Output redirection by the audit shell writes evidence only outside the repository. No application code is loaded, so no network/database/provider entry point exists in this dependency closure. This is not an OS network-isolation certification.

Evidence directory: `/private/tmp/queue-preservation-bumbkmc4/` (`preflight.json`, `baseline-files.json`, `source-contract.tap`, final integrity evidence). Explicit no-index whitespace checks cover the four untracked files; final integrity checks compare all 1,886 baseline tracked files and preserve other heads/configuration and Clinical UI/gate fingerprints. Existing SourceContracts PHP tests have historical expected failures (reported seven tests: three pass/four fail); they were read, not executed. No Composer install, PHPUnit, Feature suite, frontend build/smoke or predefense script is permitted/needed for this decision package. No PostgreSQL case passed.

Target migration SHA-256 remains `16b5eaddf6a725791fb74ef9a0d04b25187ba0e006fa885b7cd452df6feaed40`. Full 86-migration ordered path/content digest remains `f565b8e643f41787575f8d54c0be5d0c33b81aeaa35f4844b4527c5ba13ee1ff`. Published gate `431ce918...` is not merged, modified or bypassed. Any future migration-byte change must be explicitly hashed and independently reviewed, retaining the old hold and marking the new chain unreviewed. A changed hash is not safety approval.

## 13. Laws, BPA and ownership

| Issue / implication | Principle | Required action | Priority |
| --- | --- | --- | --- |
| Unsupported states cannot be defaulted into plausible labels | Postel's Law, security/integrity caveat | Strict source-domain validation and refusal; tests enumerate 15 legacy and 10 alternate tuples without pretending to implement recovery | High |
| Display simplification cannot absorb clinical state-machine complexity | Tesler's Law | Keep clinical authorization/transitions in backend domain commands; separate presentation from persisted meaning | High |
| Migration, command and product meanings have drifted | Conway's Law | Lead owns policy resolution, schema/release owner owns cohort/upgrade design, domain owner owns compatibility, independent QA owns evidence; no invented current signatories | High |

Unsafe-operation refusal is a design requirement; this static hold is not a runtime circuit breaker. Ethics: no fake recovery, invented clinical triage or misleading migration-readiness badge.

BPA trigger: scheduled check-in, walk-in or human-selected named operation. Actor: authorized existing Staff/Dentist (and preserved Owner administrative exceptions). Inputs: exact public identity, canonical Visit/container/Patient/branch links and required revision/key. Existing automated behavior: admission/number allocation, validated transitions, append-only history, treatment/Visit/appointment cascade, follow-up creation when requested on completed treatment. Human decisions: call, ready, away/return, treatment start/completion and permitted operational prioritization. Exceptions: invalid source state, stale revision, wrong day/context, unavailable/busy Dentist, competing command or unresolved migration state; refuse without invented repair. Completion: correct attributable encounter state, not merely a renamed status string. Proposed migration preservation is not implemented; persisted/concurrent effects require future PostgreSQL evidence. No automated diagnosis or triage is introduced.

## 14. Decision boundary and next assignment

Decision required: (1) retain the five persisted queue states and use separate presentation phases, or explicitly commission a full lifecycle redesign; (2) preserve historical Urgent/reasons while deciding future requests/order/categories; (3) keep post-admission Cancelled/No-show unsupported until explicit policy; (4) authorize a separate trusted applied-state inventory and immutable provenance design before choosing historical versus forward remediation.

Recommendation: **technical-lead decision on these precise semantics and cohort-evidence requirements**, then a narrow independently reviewed source patch. Do not begin infrastructure/provisioning or rewrite the old migration merely to pass empty-database tests.

DONE: isolated source checkpoint, full domain/constraint/command investigation, preservation/refusal design and offline evidence tests. IN PROGRESS: policy/applied-state decisions block production implementation. REMAINING: reviewed correction, independent review/publication, trusted isolation, actual upgrade/runtime/concurrency acceptance and synthetic simulation. OPEN: unsafe queue and other held migrations; unverified runtime/provisioner; unenforced database entry points; conflicting test profile; 25 AUD-10 workflow + five contention cases; fail-closed clinical activation; inherited frontend/HMO failures. Runtime M9 migration compatibility remains **Partial**; M8/M5/M6/M20/reporting classifications are not promoted by this analysis. No process-document implementation status should claim completed queue remediation.

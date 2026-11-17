# Queue stabilization contract — 2026-11-17

Additive integration contract for the owner's Sprint01 arrival/FIFO policy. The four held migrations and the frozen clinical identities remain unchanged.

## Facts and projections

`visits.arrived_at` is the arrival instant, persisted with its offset through the model's date format. `clinic_date` is the Asia/Manila business date. Neither a Staff move nor clearing a late flag edits either fact, a queue number, or an earlier history event. Equal arrival instants use the immutable Visit bigint ID as the deterministic internal tie-breaker; internal IDs are not exposed.

`position` remains the eligible position within the Patient's Dentist queue. The additive `branch_position` is the eligible position across Dentists in one branch/day and is returned to authorized Staff/Owner only. Dentist reads remain scoped to their own queue; the Patient own-queue projection remains identity-specific. Operational lists sort by branch position rather than Dentist name. Scheduled, walk-in, priority metadata and late flags do not automatically displace an earlier arrival.

Waiting/In Queue, Called and Treatment Ready retain positions. Temporarily Away and terminal entries do not. `Served` continues to mean treatment START, with `closed_at` recording departure from the waiting queue. It never means completed treatment or paid billing.

## Explicit operational moves

- `GET /api/queue/{entryId}/order`: authorized Staff branch scopes or the existing Owner administrative exception only. Returns `{data:{revision,entries}}` for the complete eligible branch/day cohort, capped at500. Foreign/missing targets both return404; Dentist/Patient roles are refused before this lookup.
- `POST /api/queue/{entryId}/reorder`: same authority, required `Idempotency-Key`, `expected_revision`, SHA-256 `order_revision`, nullable `before_entry_id`, and trimmed operational `reason` (3–300 characters). Null anchor moves the Patient to the end. Only waiting Patients/anchors from that branch/day may be selected. Called/Ready Patients cannot be pushed backward. A changed arrival, eligibility state, revision or order invalidates the reviewed snapshot. Oversized queues fail closed.
- Each actual movement increments the target revision and appends `queue.reordered` to queue history and immutable audit history. The branch-scoped audit payload contains the clinic date, target/anchor public identifiers, previous/new branch positions, reason, previous order hash, entry revision and payload version1. It contains no clinical findings. Same-position moves are acknowledged without inventing movement history.
- Repeating the exact key/payload returns the original receipt without a second movement. Current account status, auth version, role and branch permission are checked before a command receipt can be replayed. A new stale same-target transition is refused; it is not confused with a retry of the original command.
- The compatibility `late-order` command only clears the late flag and records its existing history event. Its UI now states that arrival order is unchanged.

## Concurrency and history

Live admissions, queue transitions, treatment start and reordering acquire a transaction-scoped branch/day PostgreSQL advisory lock before locking the Dentist queue counter. Existing Visit/queue locks and unique numbering constraints are retained. Queue commands lock/revalidate the actor before receipt replay. There is no new table, migration, schema grant or permission cutover.

The default cohort is ordered by arrival then Visit ID. Explicit movements are replayed by immutable audit ID against the **entire retained branch/day cohort**, including away/terminal anchors, before filtering eligibility. If an anchor subsequently starts treatment, the earlier movement therefore remains effective for the Patients still waiting. The projection excludes inconsistent Visit/queue branch, Dentist or clinic-date links instead of repairing them or widening access.

The browser freezes the reviewed move/key for uncertain-response retry, protects role/session ownership, refuses stale snapshots and offers explicit reload. Arrival timestamps remain visible facts. A receipt confirms the recorded move; current positions can subsequently change as Patients arrive or are called.

## Executed evidence

`QueueFifoAcceptanceTest`, `QueueTimestampSemanticsTest`, the existing `QueueTest`, real arrival/encounter contention lanes and `tests/stabilization-queue.browser.mjs` cover mixed scheduled/walk-in arrivals, equal instants, late arrivals, branch isolation, admission idempotency, stale/revoked requests, explicit moves, Called displacement refusal, treatment start, retained history, midnight and lost committed responses. Exact results are recorded in the Sprint01 acceptance report. These subsets do not close the held whole-QA status/urgent-removal requirements.

# BE-01: Queue migration safety and service compatibility

Audit date: November 10, 2026, Asia/Manila. Development cutoff: November 11, 2026, 02:00 Asia/Manila.

**Recommendation: do not execute the target migration.** Its SQL order conflicts with the preceding schema, and its conversions conflict with active command and clinical contracts. Reordering constraints alone is insufficient. No workflow simplification is approved by this audit.

## Repository and scope

- Verified branch: `feature/joevan-staff-p0-be-20261110`.
- Verified HEAD: `d3cafc882725f07b2f067a8b133a10f92f1d41df`, `fix(staff): preserve branch scopes on unchanged assignments`, November 10, 2026, 21:35:13 +08:00.
- Working tree was clean before this audit. Earlier commits and work are preserved. `git log --follow` identifies `f4b04f6` as the target migration's source commit; this audit examines the file at current HEAD, not a remote deployment.
- React/Vite frontend and Laravel 13/PostgreSQL/Sanctum backend are present. Composer requires Laravel `^13.17` and PHP `^8.3`.
- No database connection, migration execution, Laravel application boot, schema reset, production query, or database-backed test was performed. Applied migration ledgers, actual deployed constraints, populated data and deployment state are **unverified**.
- No production code, target migration, frontend, clinical code, secrets or existing tests were modified. No commit, push or merge was made.
- Handoff section 8 is historical: prescription, follow-up and chart services/tests now exist; their runtime acceptance was not rerun here. Hosting and unrelated handoff bundle refresh are outside this explicit audit scope.

## Chronological migration and constraint analysis

All paths below are relative to the repository root. Migration filenames determine the chronology, not today's calendar date.

| Order | Source | Effect relevant to this audit |
| --- | --- | --- |
| 1 | `backend/database/migrations/2026_10_01_000100_create_queue_tables.php` | Creates `dentist_queues`, `queue_entries`, `queue_entry_history`, checks, relationships, indexes and append-only trigger. |
| 2 | `backend/database/migrations/2026_10_01_000200_backfill_queue_entries_from_visits.php` | Calls `QueueBackfill::run()`: Checked In visits become Waiting; In Treatment visits become Served using treatment-start history. Completed visits are skipped. No status/priority constraint change. Uses current service source when executed. |
| 3 | `backend/database/migrations/2026_10_28_000200_create_arrival_and_freed_slot_tables.php` | Adds `queue_entries.late_arrival` boolean, default false. Does not widen queue status/priority/closed checks. |
| 4 | `backend/database/migrations/2026_11_16_000500_update_queue_statuses_and_remove_urgent_priority.php` | Updates statuses and priority before replacing checks. Leaves history intact. Adds a union of legacy/new statuses, not a new-only vocabulary. |

Repository-wide migration search found no other queue-table constraint alterations before the target. Immediately before it, a database faithfully migrated through the preceding files has:

| Contract | Definition |
| --- | --- |
| `queue_entries_status_check` | Waiting, Called, Treatment Ready, Temporarily Away, Served only |
| `queue_entries_priority_check` | Normal, Priority, Urgent only |
| `queue_entries_closed_check` | `(status = 'Served') = (closed_at IS NOT NULL)` |
| `queue_entries_number_check` | `queue_number >= 1` |
| Identity/number uniqueness | One entry per visit; unique public ULID; unique `(dentist_queue_id, queue_number)`; unique container `(branch_id, dentist_profile_id, clinic_date)` |
| Relationships | Restrict deletion of referenced Visit, container, branch and Dentist; actor user links nullable on user deletion |
| `queue_entries_active_by_queue` | Nonunique partial index on container where `status <> 'Served'` |
| History | No status enum check; `to_status` and `to_priority` required, corresponding `from_*` nullable. BEFORE UPDATE OR DELETE row trigger raises an exception. |

The target retains number/identity/FK contracts. Its final status check allows all ten statuses below; priority becomes Normal/Priority; `closed_at` is required exactly for Done/Served. Thus Cancelled/No-show must have null `closed_at`, despite being treated as closed by command code. The old partial index remains unchanged and includes Done/Cancelled/No-show: its definition no longer describes operationally active entries. This is a confirmed index-predicate mismatch, not proof of incorrect query results or measured performance impact.

PostgreSQL checks CHECK constraints immediately on row modification; a transaction or `SET CONSTRAINTS ... DEFERRED` cannot postpone them. See [PostgreSQL CHECK documentation](https://www.postgresql.org/docs/current/ddl-constraints.html) and [SET CONSTRAINTS](https://www.postgresql.org/docs/current/sql-set-constraints.html).

Consequently, on the preceding schema, matching Waiting/Away rows reject the first UPDATE; otherwise matching Called/Ready rows reject the second; otherwise matching Served rows reject the third. Every legal legacy queue status is covered. Any nonempty queue table conforming to that schema therefore cannot complete the forward conversion. Served -> Done also violates the old closed check because the retained closed timestamp accompanies a non-Served status. An empty queue table can avoid these row failures and hide the populated-upgrade defect. Actual PostgreSQL failure/error ordering was not exercised.

## Active queue-status compatibility matrix

Sources: `app/Models/QueueEntry.php`, `app/Services/Queue/QueueService.php`, `QueueBackfill.php`, `app/Services/Treatments/TreatmentService.php`, `app/Services/Intake/IntakeService.php`, `app/Services/Analytics/AnalyticsService.php` under `backend/`.

“Accepted” differs between a model vocabulary, a reader and a named command. No generic status-write API exists. List filtering accepts a string but does not establish write support.

| Status | Before / after schema | Active service behavior | Target conversion and compatibility |
| --- | --- | --- | --- |
| Waiting | Yes / Yes | Enqueue/backfill produce it; call/away accept it; position and patient waiting phase | -> In Queue; call/away no longer accept converted entry |
| Called | Yes / Yes | call produces; ready/away and treatment start accept; holds position | -> In Treatment; loses ready/away and treatment-start eligibility |
| Treatment Ready | Yes / Yes | ready produces; away and treatment start accept; holds position | -> In Treatment; loses away and treatment-start eligibility |
| Temporarily Away | Yes / Yes | away produces; return accepts; no position; patient away phase | -> In Queue; silently re-enters positional counts; return fails |
| Served | Yes / Yes | Treatment start and backfill produce; terminal queue state; required for active treatment writes/completion; counted by served analytics | -> Done; active treatment encounter check rejects it; served analytics excludes converted rows |
| In Queue | No / Yes | Model, positions, intake shortest-queue count, analytics live count and patient waiting phase recognize it; no normal producer or named transition source | Preserved if already present; cannot call through current transition table |
| In Treatment | No / Yes | Model recognizes; no named producer/source; no position; patient phase derives actual Visit status | Preserved; not accepted by `serve()`; a queue label cannot start a Visit/Treatment |
| Done | No / Yes | Model and command closed-state guard recognize; not produced by treatment completion, which leaves queue Served | Preserved; not equivalent to the active treatment requirement Served |
| Cancelled | No / Yes | Model and closed-state guard recognize; no queue cancellation producer found | Preserved; rollback explicitly refuses; admitted cancellation policy unresolved |
| No-show | No / Yes | Model and closed-state guard recognize; no queue no-show producer found | Preserved; rollback explicitly refuses; appointment no-show is a separate lifecycle |

`QueueEntry::STATUSES` matches the widened check, but `QueueService::TRANSITIONS` still uses only the five legacy states. `serve()` accepts Called/Ready and writes Served with a timestamp at treatment START. `TreatmentService::assertActiveEncounter()` requires Served for an active treatment. `AnalyticsService` historical served count queries only Served. These are source-confirmed incompatibilities, with runtime impact conditional on a conversion actually succeeding after remediation or on a widened/drifted database.

## Priority, ordering and semantic loss

- `QueueEntry::PRIORITIES` and request validation allow Normal/Priority, excluding Urgent. Request `category` still allows Senior Citizen, PWD and Urgent; category is not the stored priority enum. Removal of the Urgent enum does not remove that category.
- Current `QueueService::positions()` orders solely by Visit `arrived_at`, then queue number, partitioned by container. It includes In Queue/Waiting/Called/Ready. Priority and `late_arrival` do not affect that SQL. Controller list order is container then queue number; returned position is computed separately.
- Comments and `docs/architecture/CONTRACTS.md` still describe priority ordering, Called/Ready protection and/or late ordering. `restoreOrder()` changes the late flag and records history/audit, but cannot change this SQL's ordering. Existing queue Feature tests include older priority expectations; they were inspected, not executed. Policy must decide which ordering is intended before code or requirements change.
- Away -> In Queue erases absence and restores a place; Called/Ready -> In Treatment merges operational steps with a clinical label before the Dentist starts treatment. Served -> Done confuses queue departure at treatment start with completed care. None updates the linked Visit, appointment or Treatment.
- The forward SQL changes all historical entries too, without a clinic-date or active-only restriction. This is not just a live-display rename.
- Urgent -> Normal clears the current reason. History may contain earlier priority-change evidence, but this migration neither guarantees it exists for every row nor records exact originals for recovery. Rollback restores permission to store Urgent, not original priority/reason values.

## Audit history, idempotency, transactions and rollback

The target migration contains no history UPDATE/DELETE, trigger disable/drop, or history status constraint replacement. Mixed historical vocabularies remain representable. Trigger enforcement on an actual instance is unverified. Source preservation is valuable, but the migration emits no history/audit conversion event, saves no original-value journal, increments no revision, and changes no actor/updated timestamp. Current state can therefore diverge from the latest history at the same revision. Historical rows alone are not proof of a reversible projection or complete reason recovery.

The earlier **backfill rollback** is a separate hazard: `QueueBackfill::rollback()` disables the history trigger, deletes all history for entries with the `queue.backfilled` marker (including potentially later operational events), deletes entries and empty containers. A broad batch rollback can reach this older migration. Do not run it as a recovery shortcut; it conflicts with this task's preservation boundary.

The target inherits Laravel's `Migration::$withinTransaction = true`. Installed `Migrator::runMigration()` wraps execution when the connection grammar supports schema transactions, and installed `PostgresGrammar` sets that capability true. Normal PostgreSQL migrator execution should therefore roll back failed DML/DDL together. This source finding does **not** make invalid intermediate rows valid. Direct/manual SQL or a custom runner without that transaction can leave partial changes on an already widened schema. Deployment runner, locks, SQLSTATE and rollback atomicity remain unverified.

The migration has no explicit transaction, application maintenance fence, row revision coordination or command-key conversion. Laravel's migration ledger ordinarily prevents a successful up from running twice; predicate-based updates usually become no-ops after conversion on a widened schema. This is not a reversible or concurrency-safe command protocol. Services continue creating legacy Waiting/Served rows after migration; a manual rerun could convert those too. Status updates can race active commands absent a coordinated deployment. Existing cached idempotent command responses may report pre-conversion states at unchanged revisions.

Queue commands use `IdempotentCommand` transaction/key storage, expected revisions, Visit -> entry -> container locks and canonical branch/Dentist/day checks. Arrival and treatment start enlist queue work in their parent transactions. The migration bypasses those safeguards. Actual concurrent acceptance is unverified.

`down()` checks both current/history status columns before mutation and refuses Cancelled, No-show and unknown statuses. Good fail-closed behavior, but not lossless rollback:

- Away -> In Queue -> Waiting loses absence.
- Called -> In Treatment -> Treatment Ready loses the called/ready distinction.
- Urgent priority/reason are not restored.
- History stays unchanged; new-only vocabulary may survive in history after legacy constraints return (history never had a corresponding enum constraint).
- The history guard conservatively refuses even if the only Cancelled/No-show occurrence is historical, although the history table itself could store it. Whether to retain that restriction is an approval decision, not a defect to bypass.
- On an already widened database, unchanged `closed_at` data can cause failure while replacing checks: the new status check is added before the old closed check is removed. Both invariant transitions need deliberate ordering and validation.

## Authorization and branch scope

Routes require authenticated role middleware. Index uses `QueueEntry::visibleTo()`; show/commands use `QueueEntryPolicy` through Gate. Staff read/operate via `user_branch_scopes`, not Staff assignment. Dentists read their own person-linked Dentist queue and may call only their own entry. Ready/away/return/priority/late-order require scoped Staff or the documented Owner operational exception. Owner has global queue oversight/operational access, not treatment authority. Patient `/queue/mine` derives identity from the session and returns only their own active encounter.

Under lock, commands validate Visit/container branch, responsible Dentist, clinic day and arrival date; closed-state and revision guards apply. However `QueueService` itself does not recheck actor policy/scope inside the locked callback: HTTP authorization occurs before command execution (and before a possible idempotency replay). This is a source-confirmed enforcement placement gap against the shared-command rule, with race/direct-invocation exploitability **unverified**. Do not expand service permissions to fix migration compatibility. Preserve `d3cafc8` Staff scope behavior and test scope changes/concurrency separately.

## Confirmed defects versus approval decisions

Confirmed source defects/hazards: incompatible UPDATE-before-check-replacement order; converted states lacking command paths; active treatment requiring Served after conversion to Done; served analytics exclusion; many-to-one rollback loss; reason erasure without recovery journal; conversion without history/revision evidence; stale active-index predicate; contradictory ordering documentation and implementation. A successful empty-database installation does not clear them.

Technical-lead approval is required for:

1. Are new labels presentation-only, or a replacement persisted lifecycle? Must Waiting/Called/Ready/Away remain distinct?
2. Does queue closure mean treatment started or care completed? Which aggregate and timestamps may use Done?
3. Is FIFO intended to override operational priority, Called/Ready precedence and late-arrival handling? What remains of Urgent category and historical reasons?
4. Are Cancelled/No-show legitimate post-admission queue states? Who may apply them and what happens to Visit, appointment and clinical records? What are their close-time semantics?
5. Must original per-entry statuses, priority, reason and closure evidence be recoverable exactly? Approve a minimal immutable conversion journal and rollback refusal rules before conversion.
6. Which databases have already applied this migration, and what maintenance window, backup/restore evidence and deployment coordination are required? Determine this only with separately approved access.

## Safe strategy options (planning only)

| Option | Benefit / limits |
| --- | --- |
| A. Preserve persisted lifecycle; use reviewed presentation labels | Safest recommendation. Avoids conversion and preserves current clinical contracts. Does not authorize frontend changes in this task. Handling the existing migration file still requires review and applied-ledger knowledge. |
| B. Expand compatibility without converting existing rows | Widen status/closed checks coherently before any compatible writes; preserve original values/reasons and history. Adding vocabulary alone does not provide a workflow for it. Do not remove legacy checks/values until all readers and writers are reviewed. |
| C. Approved coordinated lifecycle redesign | Define transitions and invariants first; implement all affected services/readers together in a separate task; preserve originals in an immutable journal and append conversion evidence with revision handling; align index/analytics; test before contracting legacy support. Reordering today's statements is insufficient. |

If already deployed, prefer a separately reviewed forward remediation after a safe ledger/data inventory; do not rewrite applied history or blindly roll back. If never applied, review a corrected approach before execution. No option was implemented here.

## Tests authored and executed

New file: `backend/tests/SourceContracts/QueueMigrationCompatibilityTest.php`. It extends PHPUnit's base TestCase, reads source and class constants, and never includes/executes the migration or boots Laravel. The parser intentionally recognizes only this migration's literal status-UPDATE shape and fails if its expected three statements change. It is **outside** configured Unit/Feature suites so expected audit failures do not silently enter routine suite discovery.

Run from repository root:

```powershell
php -l backend/tests/SourceContracts/QueueMigrationCompatibilityTest.php
php backend/vendor/bin/phpunit --no-configuration --bootstrap backend/vendor/autoload.php --do-not-cache-result backend/tests/SourceContracts/QueueMigrationCompatibilityTest.php
php backend/vendor/bin/phpunit --no-configuration --bootstrap backend/vendor/autoload.php --do-not-cache-result backend/tests/Unit
git diff --check
```

Results: syntax PASS. Isolated source audit: **7 tests, 39 assertions, 3 passed, 4 failed**, exit 1 as expected. Failures expose constraint ordering, six broken named-command source cases, two lossy status round trips and Urgent reason erasure. Passing checks establish only source-level target-vocabulary alignment, absence of target history mutation/bypass text, and rollback guard placement. Existing database-free Unit directory: **11 tests, 45 assertions, all passed**, including six existing rollback-safety tests. Their substring assertions do not prove that updates satisfy constraints despite their names. No new production regression was introduced; existing hazards remain unresolved.

Full database-backed backend suites/RefreshDatabase tests were intentionally not run. Frontend tests/smoke/build were not applicable to these source-test/document additions and were not run. `scripts/predefense-check.sh` was inspected but not run: it boots `artisan demo:check` and performs database/service diagnostics, outside this database-free task. No runtime migration, PostgreSQL constraints, authorization enforcement or concurrency is claimed verified.

## Separate disposable PostgreSQL acceptance requirements

Do not execute these steps as part of this audit. First obtain explicit approval for an isolated instance and any migration execution/workflow policy. Use a separate disposable PostgreSQL server/container with only a newly created `dental_clinic_test` database and a dedicated user unable to access real/shared databases; never repoint the current checkout's shared environment. Match deployment PostgreSQL major version and relevant extensions. Use synthetic data only, Asia/Manila clock, separate checkout/environment, null broadcast/mail and no external workers/integrations. Record server identity and `current_database()` before authorized setup. Existing `phpunit.xml` targets `dental_clinic_scratch`; do not assume it identifies the approved instance or reuse it blindly. Any change to test guards/configuration needs review.

Required cases and evidence:

1. Build the schema strictly through the predecessor migration; capture `pg_constraint`, indexes and trigger definitions. Seed every legacy status with legal closed times, all priorities/reasons, late flags, multiple branches/Dentists/days, history and active/completed Visit/Treatment combinations.
2. On a disposable snapshot, demonstrate current migration failure with SQLSTATE/constraint name and prove rows, schema, history and migration ledger remain unchanged after failed normal runner execution. Separately test the empty-table path; do not mistake it for an upgrade test.
3. Exercise any approved replacement under the actual deployment runner. Compare IDs, numbers, container/Visit links, timestamps, reasons, revisions and history row hashes/counts; verify UPDATE/DELETE on history still fail. Assert closure invariants and index predicate meaning.
4. Run arrival, call, ready, away, return, priority, late-order, treatment start/document/complete, patient-current, intake shortest queue and analytics before/after. Check all four roles, out-of-scope branches, another Dentist, forged IDs and revoked scopes.
5. Verify idempotent replay, changed payload rejection, stale revision, concurrent arrival/number allocation and migration/command fencing. Capture transaction rollback on injected intermediate failure.
6. Test down refusal for current-only/history-only Cancelled/No-show and unknown statuses. Require exact approved recovery of distinct states and Urgent reasons; test forward/backward/retry without history rewrites. Never broaden rollback into the destructive old backfill path.

## Changed-file inventory and next action

Exactly two added files:

1. `backend/tests/SourceContracts/QueueMigrationCompatibilityTest.php`
2. `docs/QUEUE_MIGRATION_SAFETY_BE_01_2026_11_10.md`

Next: technical lead reviews the six policy questions and chooses preservation/presentation (recommended) or a coordinated lifecycle redesign. Then authorize the isolated PostgreSQL acceptance task and a concrete remediation patch. Leave the target migration and production services untouched until that review. M9 remains **Partial for migration compatibility** in this audit; no other module status is promoted. Historical module classifications remain historical and were not rewritten.

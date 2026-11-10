# BE-CLIN-RECEIPT-01: Clinical mutation identity and recovery audit

Audit date: November 10, 2026, Asia/Manila. Development cutoff: November 11, 02:00 Asia/Manila.

Branch: `feature/joevan-staff-p0-be-20261110`.
Inspected HEAD: `7a4c5dc22d7e925e8e1af4517490e836f1de7c72` (`test(backend): verify database preflight handoff integrity`).
The preceding BE-DB-PREFLIGHT-02 commit contains its exact three reviewed files. The tree was clean at audit start; prior commits remain in ancestry.

## Verdict and evidence meaning

**GO for controlled documentation-only commit review. Clinical uncertain-outcome recovery remains PARTIAL.** No permission to retry mutations, implement production changes, run database tests or execute migrations follows from this audit.

- **CONFIRMED** means the inspected source explicitly implements the stated contract. It does not mean a real HTTP/PostgreSQL acceptance test passed in this session.
- **PARTIAL** means a narrower safeguard exists, with the missing guarantee identified.
- **MISSING** means the inspected route/controller/service/schema path does not implement the guarantee.
- **UNVERIFIED** means deployment state, database isolation/locking, runtime behavior or real races were not exercised.

Technical findings below are implementation observations and engineering recommendations, not clinic policy. The frontend's decision to avoid automatic retry of uncertain clinical commands remains appropriate: state guards are not request receipts.

## Source map

Paths below are relative to the repository root; line references identify this HEAD.

| Source | Relevant locations |
| --- | --- |
| `backend/routes/api.php` | Authenticated group at 69; follow-up routes 210-213; prescription routes 219-229 |
| `backend/app/Http/Controllers/FollowupController.php` | `index`, `forPatient`, `store`, `update`, `branchIds`, `audit`, `view` |
| `backend/app/Services/Followups/Followups.php` | `fromTreatment`, `booked`, `cancelled` (automatic lifecycle hooks, distinct from manual create) |
| `backend/app/Http/Controllers/PrescriptionController.php` | Void 155-169; exact read 172-179; branch authorization 212-228; read authorization 231-244; audit 260-263; response 266-281 |
| `backend/app/Models/FollowupTask.php`, `backend/app/Models/Prescription.php` | Public ULID route keys, relationships and integer revision casts |
| `backend/database/migrations/2026_10_31_000200_create_followup_tasks.php` | Revision default 1, public ID uniqueness, treatment-only unique index, status/closure constraints, no-delete trigger |
| `backend/database/migrations/2026_10_31_000100_create_prescriptions.php` | Revision default 1, unique public ID/number, void evidence columns, immutable issued/void guards |
| `backend/app/Services/Audit/AuditService.php` | `recordAdministrative` delegates to required synchronous `record`; save/refresh failures propagate |
| `backend/app/Http/Middleware/EnsureAccountAccess.php`, `EnsureUserHasRole.php` | Fresh account/session-version checks and route role checks |
| `backend/app/Policies/PatientPolicy.php` | Staff full-profile permission used by follow-up creation/patient panel |
| `backend/app/Models/User.php`, `backend/app/Http/Controllers/Auth/AuthenticatedSessionController.php` | Authentication version changes, credential/token revocation, login regeneration and logout |
| `backend/app/Support/IdempotentCommand.php` | Existing shared replay mechanism; not called by these target mutations |

No dedicated FollowupTask or Prescription policy is invoked by these controllers. Their workflow-specific authorization is inline; Staff follow-up creation/patient read additionally calls Patient `viewProfile`.

## Mutation contract matrix: identity and authorization

Every route below has the `/api` prefix, `auth:sanctum` and `EnsureAccountAccess`. Throttling bounds request rate; it does not deduplicate a command.

| Mutation / route / implementation | Authorization boundary | Request identity | Successful response identity |
| --- | --- | --- | --- |
| Create: `POST /followups`; `FollowupController::store`; throttle 30/min | **CONFIRMED:** Staff/Dentist only; resolve patient public ID and branch legacy ref; check current actor's branch membership inside transaction. Staff also requires Patient `viewProfile`. Dentist uses branch membership, not a generic Patient policy grant. | **CONFIRMED:** `patient_id`, `branch_ref`, `reason`, `due_on`; optional `service_ref`, `assign_to_me`. Actor comes from authentication. **MISSING:** client operation ID, accepted idempotency key or expected revision. | **CONFIRMED:** HTTP 201 `{data}` with task public `id`, `patient.id`, `branch.id` (legacy ref), `status`, integer `revision`, due date, source and permitted details. Initial revision comes from database default, not a generated command receipt. |
| Contacted: `PATCH /followups/{followupTask}` with `action=contacted`; `FollowupController::update`; throttle 60/min | **CONFIRMED:** Staff/Dentist only; reload by internal key with row lock, authorize the locked row's current branch using current scope queries. No additional Patient `viewProfile` check in update. | **CONFIRMED:** task public ULID route key and action; optional note validates but Contacted does not persist it. **MISSING:** operation ID/key and expected revision comparison. | **CONFIRMED:** HTTP 200 `{data}` with task/patient/branch/status/revision; accepted Open -> Contacted increments revision and stores contacted time/actor. |
| Close: same PATCH, `action=close`; same implementation/throttle | **CONFIRMED:** same locked-row branch authorization. Any non-Closed state may close; without linked appointment a trimmed nonempty note is required. | **CONFIRMED:** task ULID, action, optional note subject to closure rule. **MISSING:** operation ID/key and expected revision comparison. | **CONFIRMED:** HTTP 200 with task/patient/branch/status/revision, close note and optional appointment identity; increments revision and stores closure time/actor. Closure time/actor are not exposed by the current view. |
| Void: `POST /prescriptions/{prescription}/void`; `PrescriptionController::void`; throttle 30/min | **PARTIAL:** Dentist role and a linked DentistProfile at route-bound prescription branch; any dentist at that branch, not solely author/treating dentist. `dentistAt` runs before transaction; locked row is not reauthorized. | **CONFIRMED:** prescription public ULID and required reason (3-300 chars). **MISSING:** operation ID/key and expected revision comparison. Draft edit/Issue require `expected_revision`; Void does not inherit it. | **PARTIAL:** HTTP 200 `{data}` has exact prescription ID, number, patient ID, visit ID, Void status, revision and `voided.at/reason`. Branch is a display name only, not stable branch identity; voiding actor/operation ID are not returned. |

## Mutation contract matrix: transactions, idempotency and recovery

| Mutation | Transaction / locking / audit | Duplicate behavior | Revision / operation receipt | Recovery and remaining uncertainty |
| --- | --- | --- | --- | --- |
| Manual follow-up create | **CONFIRMED (source):** task creation, required audit and fresh response model load are in one `DB::transaction`; no deduplication lock/unique request record. **UNVERIFIED:** real commit/rollback. | **MISSING:** replay/deduplication. Every accepted call creates a new ULID/task/audit. Patient+branch+reason+date are not a uniqueness key; supplying the same header cannot enable absent replay wiring. | **PARTIAL:** durable task identity/revision once committed. **MISSING:** operation receipt, original-response replay and lookup by request ID. | **PARTIAL:** lists can find a known task ID. If creation response/ID is lost, matching clinical fields cannot prove which request created a task or establish safe retry; list absence is not proof of noncommit. |
| Contacted | **CONFIRMED (source):** transaction + `lockForUpdate` on target; validate locked Open state; write and synchronous minimal audit together; loaded accepted model returned. **UNVERIFIED:** actual contention/atomic rollback. | **PARTIAL:** repeat after Contacted/Booked/Closed is 422 `errors.action`, without another write/audit. No successful replay. After a later reopen to Open, an old command can apply again because no operation identity is stored. | **PARTIAL:** incremented row revision returned. **MISSING:** submitted-revision enforcement, operation receipt and request-correlated readback. | **PARTIAL:** find exact ID in authorized list and inspect current status/revision. Later state does not establish who contacted, whether this attempt succeeded, or what history occurred between observations. |
| Close | **CONFIRMED (source):** same row lock/transaction/required audit; reject already Closed before modifying its note/revision. **UNVERIFIED:** actual concurrency. | **PARTIAL:** repeated closure against Closed is 422, preserving first closure. Concurrent Contacted/Close commands serialize by row in intended PostgreSQL execution; outcome depends on order. No original-response replay. | **PARTIAL:** revision advances, but no optimistic precondition or request receipt. | **PARTIAL:** explicit Closed-list/patient-list readback of known ID. Default active list excludes the successful closure. Current Closed state/revision does not identify the particular command or actor that closed it. |
| Prescription Void | **CONFIRMED (source):** transaction + row lock; only locked Issued state accepts; mutation and required audit in same transaction. Intended second contender sees Void and rejects. **UNVERIFIED:** real two-connection Void race and rollback. | **PARTIAL:** repeat Void returns 422 `errors.status`; no second accepted write/audit or replacement reason. This is duplicate-effect prevention, not successful-response idempotency. | **PARTIAL:** durable `voided_at`, `voided_by_user_id`, `void_reason`, revised row; prescription number identifies prescription, not Void operation. **MISSING:** request receipt/replay and expected-revision enforcement. | **PARTIAL:** exact authorized GET can confirm current Void identity/state/reason/time/revision without resubmitting. It cannot establish that the uncertain request caused it; no void actor/operation correlation in response. A failed read can mean lost access/session, not noncommit. |

In normal HTTP execution these controllers return after their transaction completes; response formatting/network delivery can still fail after commit. The view is constructed from the accepted model, not a second post-commit task/prescription `fresh()` that deliberately adopts a newer revision. Related values or derived flags are not a universal immutable receipt. An enclosing outer transaction would also change when final durability is established; the helper transaction alone cannot promise an outer commit.

## Authoritative reads and safe interpretation

| Read route / implementation | Available evidence | Important boundary |
| --- | --- | --- |
| `GET /api/followups`; `index` | **CONFIRMED:** current authorized task rows, task ID, branch ref, status/revision and, for Staff/Dentist, patient identity; optional branch/status/due filters. Owner receives metadata only. | **PARTIAL:** limit 300, ordered due date then internal ID, no paging or exact task-ID filter. Default `active` includes only Open/Contacted. `status=Closed` or `status=Booked` must be requested separately when reconciling those states. Counts are separate queries, not a single atomic list snapshot. |
| `GET /api/patients/{patient}/followups`; `forPatient` | **CONFIRMED:** patient public ID route key, branch-scoped rows of all statuses; Staff needs `viewProfile`, Dentist branch filtering remains. | **PARTIAL:** latest 50 by due date, no pagination. No `GET /followups/{id}` endpoint exists. Missing row is inconclusive. |
| `GET /api/prescriptions/{prescription}`; `show` | **CONFIRMED:** exact public ID lookup; current state/revision, patient/visit and void evidence for authorized content readers. Dentist branch membership; Staff branch scope and non-Draft; Patient/guardian own non-Draft; Owner non-Draft metadata only. | **PARTIAL:** current-state evidence, not request outcome receipt. Branch ref/void actor absent. Staff show additionally writes a viewed audit; a read failure need not mean the earlier Void failed. |
| `GET /api/prescriptions`; `index`; `GET /api/me/prescriptions`; `mine` | **CONFIRMED:** role-scoped list alternatives; patient list includes own/guardian Issued and Void. | **PARTIAL:** generic list capped at 200 and filtered; exact show is preferable for known prescription ID. Owner cannot use metadata access to retrieve clinical details. |

A complete successful mutation response with expected entity identities confirms that accepted state at that response's revision. A timeout, aborted browser request, connection loss or later 5xx does not establish rollback. A repeat's 422 says the current state cannot accept the action, not that this client's earlier attempt committed. Readback establishes current state, not causal ownership of an uncertain command. Keep uncertain operations pending for explicit reconciliation; do not infer permission to retry from this report.

## Audit and notification consistency

- **CONFIRMED (source):** manual follow-up create/update and prescription Void synchronously call required AuditService inside their mutation transactions. Audit errors are not swallowed. Their models/audit model use the default connection; in this inspected path write and audit share it. Default-connection atomicity and trigger installation are **UNVERIFIED** at runtime.
- Follow-up payload: task public ID, resulting status, due date, branch ref. Prescription payload: public ID, number, branch ref, resulting status, line count. Actor is server authenticated; target is Patient. Neither emitter includes reason, close note or medication text. Event category is currently `administrative`, not `clinical`. No task/prescription revision or request ID is included in these payloads, and audit row ID is not returned as a receipt.
- **CONFIRMED (source):** Void has no notification/email call. Manual follow-up create/Contacted/Close also have none. This is absent behavior, not a guarantee of notification delivery or a proposal to add notices without review.
- Prescription **Issue**, a different command, schedules ready notice/mail work with `DB::afterCommit`; no such callback should be attributed to Void. NotificationCenter deduplicates its own rows and catches failures; Issue's mail enqueue also catches failures. These post-commit effects are not atomic delivery with issuance, and successful issuance need not imply delivery. Void does not retract a previously queued ready notice in this path.

## Cross-session, branch and concurrent-update findings

| Guarantee | Classification and source finding |
| --- | --- |
| Authentication on each new request | **CONFIRMED (source):** Sanctum auth, fresh User lookup, Active/person/Patient-email checks, current role middleware. Missing/expired authentication is rejected before controller by authentication middleware; exact expiry handling/configuration is **UNVERIFIED** in this audit. `config/session.php` defaults to database sessions and 120 minutes, but environment values were not read and deployment settings are not asserted. |
| Stale session version | **CONFIRMED (source):** web-session `auth_version` is compared with fresh User; mismatch invalidates session and returns `session_revoked` (403 for these clinical routes, 401 for `/api/me`). Login regenerates session and records version. User status/password/email/role updates through model hooks increment version and revoke stored sessions/tokens. Bulk/raw writes bypassing model hooks are outside that guarantee. |
| Authentication replacement / in-flight cancellation | **PARTIAL:** request uses authenticated server actor, not client actor fields. **MISSING:** expected actor/session-generation bound to these commands or returned in their receipts. Middleware does not cancel an already-authorized in-flight command when another tab logs out/switches account; later account/role changes are not locked/revalidated immediately at commit. Token access is not governed by a web-session version comparison, although model hooks delete tokens. |
| Branch authorization changes | **PARTIAL:** memberships/scopes are queried rather than trusted from frontend. Follow-up transitions authorize the locked task branch. Prescription Void authorizes the route-bound branch before locking and does not check it again. Scope/profile membership rows themselves are not locked against concurrent revocation. Source supports a timing gap, not a demonstrated exploit or a newly permitted transfer. |
| Concurrent target updates | **PARTIAL:** row locks serialize targeted transition/void writes in intended PostgreSQL transactions. No real isolation/race was tested. Manual create lacks a shared request-key lock. Separate follow-up automatic hooks must not be assumed to have identical locking. |
| Stale revision submission | **MISSING** for these four mutations: revisions are emitted/incremented but not accepted as preconditions. Extra `expected_revision` fields cannot enforce a comparison that is absent. **CONFIRMED (source)** only for separate prescription draft update/Issue, which validate and compare that field under lock. |
| Duplicate request receipt | **MISSING:** no target path invokes `ReadsIdempotencyKey`/`IdempotentCommand`, persists request fingerprint/result, or supplies an operation lookup endpoint. The existing shared helper elsewhere does not automatically protect these routes. |

Automatic follow-up lifecycle boundaries, inspected for context:

- `Followups::fromTreatment`: **PARTIAL** deduplication via treatment/source query and partial unique treatment index, with 23505 caught around a savepoint. It does not deduplicate manual creation. The audit runs after that helper's inner transaction, relying on the TreatmentService caller's outer command transaction for atomicity; standalone helper use is not equivalent. Index installation/real duplicate races are **UNVERIFIED**.
- `Followups::booked`: locks the selected open task and increments revision; transaction ownership is in callers such as AppointmentService and PayMongoService. No helper-level once-per-appointment receipt/uniqueness: a standalone repeat may consume another open task if one exists. Call-site replay protections must be assessed separately.
- `Followups::cancelled`: selects Booked tasks then updates/reopens them and increments revisions without its own row lock or conditional status update at write time. An overlapping close/reopen therefore needs separate PostgreSQL acceptance; the controller's lock alone does not prove every writer honors the same transition contract. No race was run or production behavior changed.

## Validation and database acceptance holds

No new regression tests were added. The material missing guarantees concern persistent request identity, locking, transaction rollback and HTTP authorization. A mocked transaction cannot establish those PostgreSQL guarantees. Existing behavioral Feature suites already cover important paths; arbitrary source-string tests were not added as substitute acceptance.

Inspected existing tests, **not executed**:

- `tests/Feature/Followups/Follow02AtomicTransitionsTest.php`: audit rollback, duplicate rejection, locked-row branch/state, role checks and opt-in concurrent Contacted/Close. Uses DatabaseMigrations; race additionally needs `FOLLOW02_RUN_CONCURRENCY=1`.
- `tests/Feature/Followups/Follow03RevisionResponseTest.php`: revision/identity, rollback, repeats and Owner redaction. Uses RefreshDatabase.
- `tests/Feature/Prescriptions/Rx01PrescriptionAuditAtomicityTest.php`: required audit rollback, repeated Void, read privacy, Issue after-commit and opt-in **Issue** races. Uses DatabaseMigrations; `RX01_RUN_CONCURRENCY=1` does not add a concurrent Void test.
- `tests/Feature/Prescriptions/Rx02AcceptedDraftRevisionTest.php`: separate accepted draft-response contract, not Void receipt acceptance.
- `tests/Feature/Prescriptions/PrescriptionTest.php`, `ConcurrentPrescriptionTest.php` and auth/scope feature tests remain unexecuted. ConcurrentPrescriptionTest explicitly calls destructive migration reset in setup/teardown and must not be run under this authorization.

Future persisted acceptance requires separate technical-lead approval of a verified disposable isolated PostgreSQL instance, exclusive use, the complete migration chain (queue migration is still blocked), the actual test lifecycle and any concurrency opt-in. The guard's `dental_clinic_scratch` at `127.0.0.1:5432` is not proof of disposability. Do not substitute another name or run RefreshDatabase/reset/provisioning here. Additional tests should cover concurrent Void, manual-create duplicate submissions, lost-response readback, stale revision, scope revocation/route snapshot drift and overlapping follow-up close/reopen.

Executed from repository root with XML configuration disabled and result caching disabled:

```text
php backend/vendor/bin/phpunit --no-configuration --bootstrap backend/vendor/autoload.php --do-not-cache-result backend/tests/Unit/PreflightHandoffEvidenceTest.php
php backend/vendor/bin/phpunit --no-configuration --bootstrap backend/vendor/autoload.php --do-not-cache-result backend/tests/Unit
```

Results: focused preflight suite **30 passed / 325 assertions**; complete database-free Unit suite **168 passed / 1,017 assertions**. Both commands exited 0 with all cases passing. These preserve existing database-free evidence; they are not clinical HTTP/transaction acceptance. PHP syntax passed for the two inspected clinical controllers, Followups, AuditService and both access middleware files. Tracked/staged whitespace checks and a separate new-document whitespace/secret-pattern check passed; the new document was also reviewed for accidental clinical data or credentials. The final manifest contains only this document.

No database, migration, seeder, provisioning, real provider or application bootstrap was executed. Frontend smoke/build and predefense scripts were not run in this documentation-only validation scope; a full backend Feature run would violate the database execution hold.

## Recommended implementation priorities (approval required before code)

1. **P1: manual follow-up creation identity.** Review actor-scoped request key, payload fingerprint, durable original-result receipt and authorized recovery lookup. Preserve intentional multiple clinical tasks; do not deduplicate by reason/date text. Reuse of existing replay infrastructure requires review of clinical privacy, current authorization on replay, key lifetime and schema/contract ownership.
2. **P1: complete readback contract.** Review exact authorized follow-up GET by public ID and request-key recovery when create ID is lost. Add stable branch identity to prescription response and define minimum entity/revision/operation evidence. Keep Owner redaction and clinical access restrictions.
3. **P1: stale intent and authorization timing.** Review expected-revision preconditions for Contacted/Close/Void and reauthorization of the locked prescription row. Define concurrent scope-revocation expectations; a row lock is not a global authorization lock. Do not silently change repeat 422 responses into success without a reviewed replay contract.
4. **P1: every follow-up writer.** Review cancelled/booked helper transaction ownership and close/reopen ordering before claiming lifecycle-wide serialization. Validate accepted audit state and revision together under approved PostgreSQL races.
5. **P2: operation evidence and delivery boundaries.** Review minimal revision/request correlation in audit/receipts without clinical text, session replacement semantics and post-commit notice behavior. Define operational recovery instead of treating retries or notifications as proof of success.

Affected official modules: M14 Prescription Management and M15 Follow-Up Management. Their process-document status should retain the existing module classification and qualify it with: "Development source implements row-locked state transitions, revisions and required transactional audits; request-correlated clinical operation receipts and complete uncertain-outcome recovery are not established; PostgreSQL acceptance remains deferred." No module promotion or DOCX edit is made.

## Exact change manifest and handoff

Only added: `docs/BE_CLIN_RECEIPT_01_CONTRACT_AUDIT_2026_11_10.md`.
No production controllers/services/routes/policies, migrations, environment files, frontend files or existing tests changed. No staging, commit, push, merge or deployment was performed by this audit.

The queue migration remains blocked. All 10 Staff P0 database regressions remain unexecuted. Developer B owns clinical frontend handling; Developer C/Jaztin owns frontend integration. This report supplies evidence and recommended contracts, not authorization to overwrite either developer's work.

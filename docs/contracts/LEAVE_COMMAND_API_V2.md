# Leave command API v2 — implemented locally, awaiting integration

Supersedes the missing revision/replay portions of `LEAVE_AUTHORITY_RECOVERY_V1.md`. All product callers in `Staffing.jsx` now use this contract. Existing states/eligibility/approval policy and clinical effects are preserved. No consumer may auto-refresh a revision and resend a refused action.

## Routes

- `GET /api/leave/mine`: existing linked Staff/Dentist requester, own records.
- `GET /api/leave`: existing authorized Owner/front-desk collection; existing filters remain.
- **New** `GET /api/leave/{public_id}`: exact current resource, requester or currently authorized approver only. Foreign branches and roles denied. No Patient access.
- `POST /api/leave`: existing Staff/Dentist creation payload plus `expected_revision:0` and lowercase UUID `operation_id`. Returns201, including on exact replay.
- `POST /api/leave/{public_id}/decide`: `{decision:"approve"|"decline",expected_revision:<observed positive integer>,operation_id:<lowercase UUID>}`. Returns200.
- `POST /api/leave/{public_id}/cancel`: `{expected_revision:<observed positive integer>,operation_id:<lowercase UUID>}`. Returns200.

Existing leave rows now include integer `revision`: imported existing rows start at1, creation1, each successful approve/decline/cancel increments once. States remain Pending/Approved/Declined/Cancelled. Lifecycle revision excludes the separate existing patient-notify timestamp; that clinical notice action and its contract are untouched.

Response `{data:<exact existing leave DTO plus revision>,meta:{operation_id,replayed}}`. Decision DTO still includes the existing affected appointments list. Dates/times retain the original Asia/Manila interval representation and encrypted private note visibility. GET collections/exact read expose `meta.commands_available`; absent optional schema means false and null/unavailable revision, never fabricated authority. Writes then return503 `leave_recovery_unavailable`. UI is read-only until capability is available.

## Concurrency and recovery

Both preconditions are required for all lifecycle writers. Valid old requests missing both return409 `leave_precondition_required`; malformed/partial pair422 `{message,errors}`. Actual application consumers have migrated. External legacy clients must observe the resource and send the pair; leaving them unguarded would permit a silent stale approval/cancellation.

Actor-unique operation identity binds action, target and normalized validated payload, including original revision. Same actor/operation/exact command returns the first encrypted persisted receipt, with `replayed:true`, before comparing current revision or state. This works after later transitions and after a creation date has passed. Same operation changed action/target/body:409 `leave_operation_conflict`. New operation with stale revision:409 `leave_revision_conflict`. All409 responses `{code,message}`. Illegal transitions with a current revision, overlaps or invalid dates/times retain422. Unauthorized401, wrong/revoked authority403, missing resource404.

Authorization is rechecked **before replay**, against current account/auth revision/role/Person and current requester/approver/branch/Owner-setting authority. Actor `FOR NO KEY UPDATE` precedes the resource lock: it serializes account revocation while allowing FK key-share locks needed for notices/receipts, avoiding a requester-versus-approver lock cycle. Staff request creation is serialized on the requester. Exact actor-operation uniqueness is also enforced by PostgreSQL.

The receipt describes the original command, potentially older than the current resource. Explicit GET gives current authority. After a conflict, users explicitly reload/review before issuing a new intent. Unknown responses retain one exact command, freeze fields/filter context and expose bounded manual retry. No automatic save loop, revision replacement, optimistic success or private-note localStorage is used. Obsolete role/session/filter/read results are ignored.

## Persistence and automation

Opt-in additive `backend/database/operations/2026_11_20_000100_add_leave_command_recovery.php`: positive lifecycle revision plus `leave_command_receipts`. Receipts contain encrypted DTOs, keyed HMAC fingerprints, exact actor/operation/leave/audit IDs and original HTTP status. DB append-only update/delete/truncate guards, actor-operation uniqueness, audit uniqueness and restrictive FKs protect recovery history. Private notes never enter audit metadata or plain journal fields. Populated receipt rollback refuses to discard history.

State, audit, encrypted receipt, in-app notice and approved-wording mail-outbox intents commit together. Leave uses a new strict notice-write method; other domains retain existing best-effort notification behavior. Replay creates no second effect. Transport delivery retains existing outbox semantics; no real delivery/provider acceptance is claimed. A failed audit/notice/outbox write rolls back the leave command. No new balances, coverage decisions, automatic cancellation, Staff roster publication or booking eligibility policy is added.

Fresh private provisioning: `--operations --roster-drafts --leave-recovery` selects86 reviewed migrations, retaining all four holds. Existing83/84/85 manifests and hashes are unchanged; never repin them. Local guard recognizes only ordered subsets of the three explicitly reviewed operation filenames, with exact selected paths and source hashes.

## Integration handshake

Jaztin: shared changes are the single GET route, narrowly scoped API-client signatures, existing leave screen, leave controller/model and additive recovery schema. `decideLeave(id,decision,command,beforeDispatch)` and `cancelLeave(id,command,beforeDispatch)` now carry required preconditions. Shared notification service adds strict leave-only intent writing without changing other callers. Preserve your unrelated changes during later integration. Doctor `/api/work-schedules`, appointments, prescriptions and Patient contracts remain untouched. Draft Staff rosters remain unpublished and must never supply clinical availability.

# Operations scheduling contract v1 — Joevan, 2026-11-15

Source implementation on `feature/joevan-qa-20261115`. PostgreSQL acceptance is pending a verified Joevan-owned Linux runtime. This is an integration handshake for Jaztin, not a deployed capability claim.

## Existing Doctor duty (unchanged)

`GET /api/work-schedules`, authenticated Owner/Staff/Dentist. Response is `{data:{dentists,staff,branches,weekdays,exceptions,duty:{date,as_of,rows}}}`. Doctor duty rows retain `dentist_id`, `branch_id`, names, `on_duty_today`, `working_now`, `working_minutes`, `estimated`. The date is the current Manila date; this endpoint does **not** accept an arbitrary effective date. Staff Doctor rows are limited to authorized branches, Dentists to their own profile; Owner sees all. Profile-hours fallback is estimated. No clinical scheduling contract changed.

## Existing Staff profiles with comparison/replay extension

`GET /api/staff` and `GET /api/work-schedules` provide flat Staff profiles, **not** dated duty. IDs are existing `legacy_ref` values. Staff reads remain branch-scoped. Both responses now include an opaque 64-character lowercase hexadecimal `revision`. Work-schedule Staff rows return stored `shift_start`/`shift_end` as `HH:mm` or null, without substituted hours. Assignment and `available` are not attendance or effective duty.

`PATCH /api/staff/{legacy_ref}`, Owner only:

```json
{
  "shift_start": "09:00",
  "shift_end": "17:00",
  "expected_revision": "<observed 64-character revision>",
  "operation_id": "<lowercase UUID>"
}
```

Existing optional `title`, `available` (boolean), `branch_ref` retain their meanings. Omit `branch_ref` for shift-only edits. An explicit changed assignment retains existing linked Staff scope replacement behavior; null reassignment policy is unresolved and is not added to the editor. Identity fields remain immutable. The complete resulting interval must end after it starts, including a single-field PATCH.

Response: `{data:{id,userId,personId,name,title,branchId,branch,shiftStart,shiftEnd,available,revision},meta:{operation_id,replayed}}`. Times in the mutation receipt retain existing PostgreSQL `HH:mm:ss` format. The receipt describes the exact committed operation; on replay it may precede a later edit. Refresh GET for the current profile. A subsequent command must use the newly observed current revision.

The comparison/replay pair is required together. Reusing the same operation ID with the exact validated body, actor and Staff target returns the original receipt with `replayed:true`, before checking the old revision. Changed body with that ID: HTTP409 `staff_operation_conflict`. Stale revision with a new ID: HTTP409 `staff_revision_conflict`. Conflict body: `{code,message}`. Invalid fields: HTTP422 `{message,errors:{field:[message]}}`. Unauthorized:401; non-Owner/revoked actor:403; missing Staff:404. Actor authority/auth revision is rechecked under a transaction lock. No unbounded automatic retries.

Operations are serialized by actor/profile locks; the existing append-only audit table holds durable receipts atomically with the profile/scope change. Every controller write, including legacy writes, advances the audit sequence used by the revision. No migration is introduced. Comparison values include persisted state and sequence so a revert cannot restore an earlier controller-issued revision. Direct database writes are outside this API contract.

Compatibility: older personnel clients omitting **both** comparison fields retain the original last-writer behavior. They do not gain optimistic concurrency or retry guarantees. The updated Work schedules editor requires the comparison capability and keeps its exact operation for uncertain-response recovery. Do not claim universal revision enforcement while legacy clients remain.

## Missing dated Staff contract

No Staff weekday/exception tables or dated-duty route exist. Do not feed flat profile availability into booking as dated duty. Owner editing, recurrence periods, date override precedence, overlap policy, leave effect, and historical publication semantics await the exact decisions recorded in `QA_STAFF_SCHEDULING_CONTRACT_DECISIONS.md`. Shift requests are not implemented by this PATCH and never become approved duty implicitly. OWN-11 remains partial. STF-07 retains its Doctor-duty criterion.

## Acceptance still required before integration

Run `StaffShiftRecoveryTest`, existing Staff scope preservation/atomicity/audit tests, and real separate-connection races on the owned PostgreSQL profile. Prove lost-response replay, fresh-session readback, revocation while waiting, and browser recovery at all requested widths. Database-free and synthetic browser checks do not close those gates.

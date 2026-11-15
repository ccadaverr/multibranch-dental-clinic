# Dated Staff preparation API v1

Implemented on Joevan's feature branch; not deployed or integrated. This is preparation infrastructure under M3, **not effective duty or publication**. Source: M3 Owner-defined dated shifts and revision/history requirements in `MODULE_IPO_BLUEPRINT.md`, original OWN-11 and OWN-10 in `FINALS-QA-REVISIONS.md`. These original QAs remain partial.

## Routes and authority

Batch06 adds `GET /api/staff-roster-drafts?branch_ref={legacy_ref}&date=YYYY-MM-DD&before={draft_public_id}`. Owner-only current preparation collection, exact branch/date filter, newest ID first, maximum50, public cursor. Response `{data:[<existing Draft DTO plus staff_name>],meta:{branch_ref,date,next_before,publication_available:false}}`. Unknown/numeric branch substitution or malformed date422; non-Owner403; a cursor outside the selected branch/date404. Closed branches remain readable for historical preparation; saving still requires an open branch. Inserts after the first page do not shift older traversal. A moved anchor requires explicit collection reload. No effective-duty or attendance interpretation is added.

All draft date inputs now require exactly four-digit ISO years0001–9999, excluding PostgreSQL's invalid year zero and expanded-year strings. This is a storage/protocol boundary, not a clinic scheduling horizon or recurrence policy. Past-date history remains readable. The Owner interface lists branch/date drafts, opens the exact Staff/date in the existing editor, refreshes the collection after a confirmed save and loads older immutable revisions beyond50. Old branch/date/session responses are discarded; drafts stay unpublished.

- `GET /api/staff/{legacy_ref}/roster-draft?date=YYYY-MM-DD`
- `PUT /api/staff/{legacy_ref}/roster-draft`
- `GET /api/staff/{legacy_ref}/roster-draft/history?date=YYYY-MM-DD&before={revision_public_id}`

Authenticated active Owner only; Staff, Dentist and Patient cannot read unpublished preparation or mutate it. Staff identity is the existing profile legacy reference, branch identity the existing branch legacy reference. Numeric primary keys are not accepted as substitutes. Proposed branch does not change Staff account scopes, assignment, availability, leave, profile hours, booking or Doctor duty.

## Save and readback

```json
{"date":"2026-11-16","branch_ref":"b1","start_time":"10:00","end_time":"16:00","expected_revision":0,"operation_id":"00000000-0000-4000-8000-000000000001"}
```

Same-date interval only, end strictly after start, inside the existing open branch's operating calendar. Strict padded dates/HH:mm. No fallback hours. Revision zero means observed absence. Existing drafts require their observed positive integer revision. No recurrence, effective period, leave exception or publication input is supported. Those explicit intent fields are rejected rather than silently interpreted.

```json
{"data":{"id":"public-ulid","staff_ref":"s1","branch_ref":"b1","branch_name":"Branch name","date":"2026-11-16","start_time":"10:00","end_time":"16:00","revision":1,"status":"Draft","published":false},"meta":{"operation_id":"00000000-0000-4000-8000-000000000001","replayed":false,"publication_available":false}}
```

GET returns the same resource or explicit `data:null`; metadata always identifies Staff/date, current revision (zero for absence), and `publication_available:false`. History returns newest-first immutable `{id,revision,saved_at,draft}` snapshots, at most50, plus Staff/date, `next_before` and publication capability. Timestamps explicitly use Asia/Manila. History cursors must belong to that exact draft/date; foreign or unknown anchors return404.

## Concurrency, recovery and failures

Actor then Staff locks serialize first creation and edits, with a unique Staff/date constraint. Save, immutable revision snapshot and audit receipt commit together. The actor's current role, Active state and authentication revision are rechecked after locking. All writes require `expected_revision` and lowercase UUID `operation_id`.

Exact actor/operation/body/Staff retry returns the original receipt with `replayed:true`, even after a later edit. Changed reuse:409 `staff_roster_operation_conflict`. A stale new operation:409 `staff_roster_revision_conflict`. Both return `{code,message}`. Never replace the observed revision automatically. Original receipts may precede the current resource; explicit GET is current authority.

Malformed or unsupported input:422 `{message,errors}`. Unauthorized401; wrong/revoked role403; absent Staff or history cursor404; missing optional schema503 `{code:"staff_roster_drafts_unavailable",message}`. No bounded or unbounded automatic save loop is introduced. UI retains exact uncertain commands, freezes edits until retry recovery, and retains conflicting entries until explicit discard/reload.

## Schema and integration

Additive opt-in `backend/database/operations/2026_11_19_000100_create_staff_roster_drafts.php`: current Draft row plus immutable revision snapshots; no deletes/truncates; immutable history also rejects update. Rollback refuses populated tables. PostgreSQL uniqueness/interval/status/revision/JSON checks protect basic integrity. Audits use `staff_roster.draft_saved` and exact durable receipts.

Fresh private provisioning requires `--roster-drafts`; together with `--operations`, selected preservation migrations increase from84 to85. Existing83/84 manifests remain unchanged and exclude this capability. Do not repin hashes on existing manifests. Four held originals remain excluded.

For Jaztin: **do not use these drafts as availability**. Existing `GET /api/work-schedules` Doctor-duty response is unchanged. No published Staff-duty endpoint exists yet. No clinical consumer change is required. Shared edits are the three narrow routes, three API-client functions, explicit-null response normalization, and the Owner Staff schedules component entry.

Unresolved decisions blocking effective duty: Staff recurrence/effective periods, no-duty semantics, exception/closure/approved-leave precedence, multiple or overnight intervals, shift request decision authority, coverage requirements, publication and impacted-booking consent. Draft persistence settles none of those policies.

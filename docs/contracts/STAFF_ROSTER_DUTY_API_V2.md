# Staff roster and duty API v2 — implemented locally

Project-owner design approval: November15,2026, Asia/Manila, policies R1–R10. These are project decisions, not clinic interview facts. Source implementation extends `staff_roster_drafts` and its immutable history; no competing Staff/profile or clinical scheduling authority. Not deployed or integrated.

## Actual routes

All require an active authenticated account. Staff/branch references are existing **legacy references**, not internal database IDs; date inputs are strict four-digit ISO dates with year0001–9999. All date/time evaluation uses Asia/Manila; intervals are half-open and same-day.

| Method/path | Authority and input |
| --- | --- |
| `GET /api/staff-rosters?branch_ref=b1&date=2026-11-23&before=<public cursor>` | Owner: established all-clinic branch authority. Staff: own requests/versions only within current branch scopes. Current rows whose effective period includes the date or whose preparation key equals the date; newest ID first,50 plus continuation cursor. Scope precedes bound and cursor resolution. |
| `GET /api/staff/{staff_ref}/roster?date=2026-11-23` | Owner or exact linked Staff requester within current branch scope; current preparation/approval/publication state or explicit null. Date remains the original preparation identity, even when recurrence spans other dates. |
| `PUT /api/staff/{staff_ref}/roster` | Owner saves Draft; exact linked Staff in authorized branch submits Pending. Full content plus observed integer revision and operation UUID. |
| `POST /api/staff/{staff_ref}/roster/approve` | Current Owner only. Draft/Pending → Approved. No duty change. |
| `POST /api/staff/{staff_ref}/roster/publish` | Current Owner only. Approved → Published. Serializes against all publications/requests for this Staff, validates combined assignments and atomically switches this preparation record's publication pointer. |
| `GET /api/staff/{staff_ref}/roster/history?date=2026-11-23&before=<revision cursor>` | Owner or exact linked Staff; newest50 immutable versions plus continuation. Staff history excludes snapshots from revoked branches **before** pagination. Foreign cursor404. |
| `GET /api/staff/{staff_ref}/duty?branch_ref=b1&date=2026-11-23` | Owner or Staff authorized for the requested branch. Optional paired `from=09:00&until=12:00` asks whether one remaining interval covers that entire range. No mutation. |

The old dated-preparation routes remain. Old saves cannot overwrite an Approved/Published, recurring or previously published aggregate:409 `staff_roster_workflow_required`. Unextended private/deployed schemas retain the legacy preparation UI; `GET /api/work-schedules` adds only `staff_roster_publication_available` and each Staff row's `can_request_roster`. Its Doctor projection and all clinical consumers are unchanged.

## Content, states and exact receipts

Save example:

```json
{"date":"2026-11-23","branch_ref":"b1","kind":"weekly","weekdays":[1,2,3],"effective_from":"2026-11-23","effective_until":"2026-11-27","start_time":"09:00","end_time":"17:00","exceptions":[{"date":"2026-11-24","kind":"custom_hours","start_time":"10:00","end_time":"16:00"},{"date":"2026-11-25","kind":"day_off","start_time":null,"end_time":null}],"expected_revision":0,"operation_id":"00000000-0000-4000-8000-000000000001"}
```

- `kind`: weekly, custom_hours or day_off. Weekly requires a nonempty unique ISO weekday list1–7 and explicit **inclusive** effective boundaries. Missing hours are never invented. No overnight intervals.
- A top-level custom_hours/day_off row is date-specific: effective boundaries equal its preparation date, weekdays/exceptions empty. Day off has null start/end. Custom hours end after start.
- Weekly versions may contain up to100 distinct dated exceptions within the period (technical request bound, not clinic policy). Supported inline exceptions are day_off and custom_hours at this roster's branch. No arbitrary assignment, clinical duties, breaks, replacement personnel or new exception types. A separate dated custom-hours record may specify its own branch; simultaneous competing exceptions are rejected as ambiguous. Inline branch transfers are not supported.
- Saving an existing version records a new Draft/Pending revision and invalidates its prior approval, while retaining the last immutable publication as effective duty. There is no unpublish, rollback, restore, hard delete, decline or withdrawal command introduced by this contract.
- Approval and publication each increment the current revision once and retain immutable version/audit evidence. The same Owner may perform the two explicit operations. An approved version never changes duty implicitly.

Transition bodies contain only `{date,expected_revision,operation_id}`. All responses200. Mutation response:

```json
{"data":{"id":"public-roster-ulid","staff_ref":"s1","branch_ref":"b1","branch_name":"Branch name","date":"2026-11-23","kind":"weekly","weekdays":[1,2,3],"effective_from":"2026-11-23","effective_until":"2026-11-27","start_time":"09:00","end_time":"17:00","exceptions":[],"revision":3,"status":"Published","published":true,"publication_id":"public-publication-ulid","published_revision":3},"meta":{"operation_id":"00000000-0000-4000-8000-000000000001","replayed":false}}
```

DTOs retain all saved content. `published` describes **this current revision**; a newer Draft can have `published:false` with an earlier `publication_id`/`published_revision` still effective. GET roster metadata identifies Staff/date/current revision (zero for absence) and `workflow_available:true`. Collection metadata identifies branch/date/next_before/workflow availability. History metadata identifies Staff/date/next_before. History snapshots, including original pre-extension Draft snapshots, remain retained.

## Effective duty

One backend `StaffDuty` resolver loads only immutable snapshots reached by current publication pointers. It resolves matching effective dates and weekdays, then published date exceptions, then current Approved leave. Pending/Declined/Cancelled leave is ignored. Branch operating hours/closures clip availability; revoked/inactive linked Staff accounts are unavailable. Flat profile hours/availability and branch membership never fabricate a duty interval.

Duty DTO: `{staff_ref,branch_ref,date,timezone,scheduled,available,windows,approved_leave,publications,warnings,as_of}`. `windows` contains `{branch_ref,start_time,end_time,source_id,revision,publication_id}`. Leave evidence contains only `{id,revision,from_minute,until_minute}`; no private reason. Publication references are limited to the requested branch. No hours is explicit `windows:[],available:false`. `scheduled` reports a matching published assignment before closure/leave clipping; it is not attendance. `warnings` explains approved-leave reduction without inventing a staffing minimum or assigning cover.

The projection describes the current published versions for a requested date, not an as-of-time reconstruction of an older publication. Older exact published versions remain in history. No automatic Patient admission, booking eligibility, Dentist availability, appointment, queue, visit, prescription, billing or Patient portal change. Jaztin can later consume this independent projection only through reviewed integration.

## Atomicity, locks and recovery

Existing Staff profile row is the shared publication gate, covering cross-branch assignments and first creation. Owner commands lock current actor, Staff, linked account, then branch; current actor role/status/auth revision and target Staff role/status are checked under locks. Staff self-requests acquire the profile gate before their own account, avoiding an account/profile cycle with existing Owner personnel writers. Scope replacement serializes on the account. Branch status is refetched under lock. FK key-share is compatible with NO KEY UPDATE account locks used for notices/audits.

Publication checks conflicting effective intervals across all current assignments, including date boundaries, exceptions and adjacent intervals. It checks recurring pattern intersections plus finite exception dates without imposing an invented schedule horizon. Approved leave does not authorize otherwise conflicting published work assignments. A rejected publication preserves the previously effective snapshots/pointers.

State, immutable history/publication, audit receipt and strict recipient notification intents commit together. Pending requests notify active Owners; saved/approved/published changes notify the linked Staff account. Notices carry branch/preparation date and route to Work schedules, no private leave or clinical content. Exact replay creates no second effect.

Actor/operation identity binds action, exact Staff/date, observed revision and normalized validated body. The existing append-only audit journal holds a compact `receipt_ref` to the existing immutable revision snapshot, plus operation fingerprint/status/revision/publication metadata. Full100-exception receipts cannot overflow the audit logger's8KB bound. Earlier compact inline receipts remain replayable. Same command returns original data with `replayed:true`, even after later changes; it is not a claim that the resource is still current. React verifies exact Staff/date/branch/revision/operation and publication identity, then separately reads current authority. Unknown outcomes retain/freeze one original command for manual retry. A conflict retains entries until explicit discard/reload; no automatic revision substitution or retry loop.

Actual failures:401 unauthenticated;403 wrong/revoked actor, foreign requester or branch scope, changed target role;404 missing Staff/branch/read resource or foreign history/collection cursor;422 `{message,errors}` for invalid/unsupported content, illegal state, reversed/overnight intervals or overlapping/ambiguous publication;409 `{code,message}` with `staff_roster_revision_conflict` or `staff_roster_operation_conflict`;503 unavailable schema. Unknown/server responses are never represented as completed publication.

## Schema and private runtime

Opt-in additive `database/operations/2026_11_21_000100_publish_staff_rosters.php` extends existing draft content/lifecycle; preserves old history bytes; adds immutable `staff_roster_publications`, publication/source/version uniqueness, restrictive Staff/branch/source/actor FKs, exact current-publication/source composite FK, status/date/time/JSON checks and update/delete/truncate guards on publication evidence. It adds only `staff_roster` to the installed notification-kind constraint, preserving all prior kinds. Rollback refuses history destruction.

Fresh provisioning requires `--operations --roster-drafts --leave-recovery --roster-publication`:87 selected/applied entries, all four held original migrations still excluded. No existing manifest was repinned. Final acceptance target `/private/roster11b/target.json`; earlier experimental profiles are retained, not schema acceptance targets. This optional schema is not inserted into the production default migration chain; no production database permission or deployment is implied.

# Staff scheduling QA — supported contract and remaining decisions

Scope: OWN-11 (Joevan / Richmon), STF-07 (Jaztin / Celin). Original definitions are in `FINALS-QA-REVISIONS.md` revisions OWN-11 and STF-07. Source inspection and synthetic frontend tests establish the behavior below; no database, deployed backend or persisted acceptance was executed.

## Supported now

- `GET /api/work-schedules`, roles Staff/Owner/Dentist: Dentist weekly rows, dated exceptions, branches, weekdays and `duty: {date, as_of, rows}`. Each duty row identifies `dentist_id`, `branch_id`, names, `on_duty_today`, `working_now`, `working_minutes` and `estimated`. Staff receives scoped Dentist/branch rows. Duty accounts for branch hours, closure, approved leave and the existing profile-hours fallback; `estimated` distinguishes that fallback from a weekday roster. Working now and having duty hours today are different facts.
- The same response supplies **flat Staff profiles**, not dated Staff rosters: `id`, name/title, assigned branch, `shift_start`, `shift_end`, `available`. Missing hours can be substituted by the server with 09:00–18:00; the response does not identify which values were substituted. Profile availability is not duty/attendance evidence.
- `PATCH /api/staff/{legacy_ref}`, Owner only: optional `title`, `branch_ref`, `shift_start`, `shift_end`, `available`. Receipt uses `StaffProfileResource` camel-case `id`, `branchId`, `branch`, `shiftStart`, `shiftEnd`, `available`. Identity fields are prohibited. There is no exposed revision, expected version or idempotency contract. A database row lock serializes writes but does not compare the version the Owner reviewed.
- A shift-only edit omits `branch_ref`. An explicit changed branch assignment can replace a linked account's branch scopes. This is **not** a shift/leave request. No null-assignment policy or new reassignment workflow is introduced here.
- Dentist weekly hours, profile-hour copy and dated exceptions already have their own established endpoints under `/api/work-schedules/{dentistProfile}` and `/api/work-schedule-exceptions/{id}`. Their request/response and authorization contracts are unchanged. Owner edits remain as before in this frontend. The backend additionally permits scoped Front Desk edits when its existing setting allows them; this batch does not expand frontend mutation permissions.
- Leave requests remain `/api/leave` with their own authorization, identity and receipt rules; they are not roster writes or branch assignments.

STF-07 asks for **Doctor** duty per branch. That contract already exists independently of a Staff weekday roster. Full OWN-11 Staff roster functionality must not be presented as a prerequisite for showing the supported Doctor duty projection.

## Decision table

| Operation | Existing behavior | Missing request / response | Authority and concurrency | Day/exception semantics and history | Decision owner / status |
|---|---|---|---|---|---|
| Read flat Staff profile | Existing GET above, scoped assignment and shift interval | No dated rows; defaults not distinguished; no profile revision | Staff reads scoped profiles; Owner reads profiles. No optimistic version | No weekday/exception coverage or attendance inferred | Joevan / Richmon: supported; runtime persistence acceptance pending |
| Edit flat Staff shift | Existing Owner PATCH above; exact ID/hours/branch receipt | No expected revision or durable operation/readback identity | Owner only; row lock is not compare-and-set. Client rejects observed context/auth changes | Existing profile write; branch-scope audit only when explicit assignment changes | Joevan / Richmon: supported subset; concurrency/unknown-outcome contract still required for stronger guarantees |
| Read/write Staff weekday roster | No Staff roster endpoint/model exists in this checkout | Endpoint and schema undecided; stable row ID, Staff/branch binding, weekday/interval and authoritative version/receipt need approval | Editor roles and scope rules, stale/conflicting write behavior undecided | Weekly recurrence, days off, multiple intervals/branches, overlap policy and retained history undecided | Joevan / Richmon with scheduling/backend owner: **DECISION REQUIRED** |
| Staff date exception | Existing exceptions are Dentist-specific, not interchangeable | No approved Staff exception endpoint or date/kind/body/receipt | Exact Staff/branch/date identity and version checks undecided | Manila date, precedence over recurrence, leave and closures; audited change/removal semantics undecided | Joevan / Richmon; Jaztin / Celin for duty integration: **DECISION REQUIRED** |
| Staff duty from roster | Only a flat availability flag exists; it is not evidence of dated duty | No authoritative Staff dated duty projection | Read visibility and authoritative roster/leave source undecided | Do not infer seven working days from shift start/end | OWN-11 owners with STF-07 owners if Staff duty is required: **DECISION REQUIRED**; not the original Doctor-duty requirement |
| Doctor duty per branch | Existing dated projection and scheduling service | Nothing new required for source rendering | Server-derived, Staff scoped; frontend refuses wrong date, malformed/duplicate evidence and obsolete session | Existing branch/closure/leave logic; profile fallback explicitly estimated | Jaztin / Celin: source improvements implemented; database acceptance still **BLOCKED** |

No endpoint path, business policy, migration, persisted roster row or successful unsupported operation was fabricated. Original OWN-11 acceptance remains partial; its broader existing regression is retained rather than weakened to claim complete Staff scheduling.

## Source references

`backend/routes/api.php`; `WorkScheduleController`; `Scheduling/WorkSchedules`; `StaffProfileController`; `UpdateStaffProfileRequest`; `Reference/StaffProfileResource`; `StaffProfile`; existing Staff-profile and Dentist schedule migrations; `backend/tests/Feature/Staffing/{WorkSchedulesTest,OnDutyStatusTest,Scope01WorkScheduleVisibilityTest,Scope03WorkScheduleProjectionTest}.php`.

The backend tests use database fixtures and were inspected only. All 86 migration sources remain unchanged. Integration, deployed capability and PostgreSQL acceptance are separate milestones.

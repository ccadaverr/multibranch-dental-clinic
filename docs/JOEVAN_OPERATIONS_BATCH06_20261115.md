# Batch06 — unpublished Staff preparation collection and complete history review

Continued after locally committing leave recovery as0fcb4f7. Previous eight commits preserved; same feature branch, no integration/publication. Original source: OWN-11 “Work schedule can be set for dentists and staff”, OWN-10 “Work schedule matches the agreed staff changes”, M3 Owner-defined dated shift preparation/history in `MODULE_IPO_BLUEPRINT.md`. **Both original QAs remain partial** because recurrence/effective duty/publication policy is unresolved. GEN-11 benefits from scoped operational history access; broad archive policies remain blocked. No new full-QA closure count.

## Complete policy-neutral slice

- New actual Owner-only `GET /api/staff-roster-drafts`, required exact branch/date, bounded public cursor pages. Returns persisted Draft rows, IDs/revisions and canonical Staff names only. No inferred duty from assignments or empty results. Closed branches remain readable for preparation history; mutation still requires existing open-branch calendar validation.
- Owner Staff schedules now includes branch/date draft review, linked to the exact Staff/date editor. Re-reviewing the same record restores its date even after the editor date changes. Collection refresh follows authoritative saved receipts. Pending/uncertain mutations lock context controls. Obsolete branch/date/auth responses cannot replace current results.
- Existing draft history UI now loads older immutable revisions beyond50 and retains history/retry on failures, with duplicate-read protection. No competing schedule model, approval state or publication route.
- Unified strict draft date input excludes PostgreSQL-invalid year zero and expanded years; exact four-digit0001–9999 storage/protocol bound, no invented scheduling horizon. Invalid filters return422, foreign cursor404, non-Owner403. Existing profile branches and account scopes remain unchanged.

Files: `StaffRosterDraftController.php` index/date rules; `StaffRosterDraft.php` canonical Staff relationship; one `api.php` route; `api-client.js` collection helper; new `StaffRosterDraftCollection.jsx`; existing `StaffRosterDraft.jsx` paginated history/initial context and `Staffing.jsx` Owner entry. Existing fixtures explicitly return empty unpublished collections; no runtime fake data. No schema/held-migration change; same verified86 private profile from batch05.

## Executed focused checks

```text
docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/leave-batch5/target.json --profile test test tests/Feature/Staffing/StaffRosterDraftCollectionTest.php tests/Feature/Staffing/StaffRosterDraftTest.php
# 8 tests / 465 assertions passed after shared date validation changed.
node --test tests/api-client.test.js tests/staff-roster-draft.test.js tests/sched01-staff-roster.test.js
# 25 passed.
node tests/roster-collection-postgres.browser.mjs <Playwright index.mjs>
# real Owner React/Laravel/PostgreSQL: saved draft appears in exact branch/date; review opens exact Staff/date;51 immutable revisions loaded across pages; repeated review restores selected date; delayed obsolete branch response ignored; profile unchanged, published false.
npm run build
npm run test:smoke
git diff --check
```

Backend acceptance prepares51 distinct synthetic Staff drafts through actual authorized API calls, traverses50+1 during a newer insert, rejects wrong branch/date cursor, validates missing/invalid/numeric filters, reads closed-branch preparation and denies Staff/Dentist/Patient access. Real browser additionally verifies all375/390/430/768/1024/1440 widths and keyboard review. It creates only private synthetic preparation/history; no duty, booking, clinical or financial state is changed. Existing draft revision/replay/immutability tests rerun only because their shared date validation changed.

Build/smoke retain inherited chunk-size/Table-key warnings. Full cross-module suites remain Phase3. Inherited incomplete OWN-11 test remains unchanged; new draft terminology does not pretend to satisfy weekly/published-duty acceptance. Batch05's five predefense prerequisite gaps remain explicitly unverified, not relabeled.

## Contract, policy and integration

Updated [Staff roster draft v1](contracts/STAFF_ROSTER_DRAFT_API_V1.md) documents actual collection route, metadata, cursor failure/reload, closed-branch reads and technical date bounds. Jaztin must not consume any preparation collection as availability. Existing Doctor-duty contract is unchanged. Shared changes are narrow `api.php`, `api-client.js`, `Staffing.jsx`; preserve his unrelated edits at later integration.

Still required: approved weekday recurrence/effective boundaries; date exceptions versus recurring assignments; approved leave precedence; overlap/coverage/overnight rules; approval/publication authority and whether separate states; effective publication/booking impact. No answer is invented. Broader GEN-11 private-record visibility/restore/retention and GEN-06/DEN-03 reproduction remain unavailable. Next independent candidate is leave approver collection authorization before row bounds, since its existing implementation filters after a global300-row limit.

Publication remains blocked by actual hosting dashboard exclusions under `TEAM_DEVELOPMENT_SETUP.md`: Vercel preview isolation from the existing Render proxy; connected Render/Railway production deployment exclusions. No push, PR, merge, hosting change or cross-branch integration. Private demo/test/clone snapshots retained and owned services stopped at completion.

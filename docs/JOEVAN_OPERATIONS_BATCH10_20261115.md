# Batch10 — original-criterion comparison and remaining draft refresh controls

Continued from `93aa13a5ff4afd4fe1e0c65db98680e8cf9965e2` on `feature/joevan-qa-20261115`, clean working tree, exactly13 commits after published baseline `a0725e645df6f8266c2bc4bebacc9d62dd18e7c1`. Verified the requested HEAD ancestry and the complete-history `../dentalops-local-backups/joevan-qa-20261115-225316.bundle`. No reset, branch recreation, remote publication, integration or deployment.

This is a **small GEN-13 follow-up**, not the requested multi-feature substantial closure batch. The narrow comparison found no additional independently specified substantive gap in the named Operations criteria: the previously accepted candidates remain preserved, while Staff effective roster and unrestricted archive behavior require the decisions below. No claim that all68 original requirements are implemented or accepted.

## Original criteria and disposition

Sources: actual revision elements and Q1/Q2/Q4 defaults in `FINALS-QA-REVISIONS.md`; prior evidence in Batches02–09, `OWNER_BRANCH_A3_ACCEPTANCE.md`, `QA_STAFF_SCHEDULING_CONTRACT_DECISIONS.md`, `MODULE_DEVELOPMENT_READINESS.md` and the domain contracts. Historical checkboxes are not closure evidence.

| ID | Exact original acceptance / relevant task | Completed functionality and evidence | Disposition |
| --- | --- | --- | --- |
| GEN-02 | `"X" appears everywhere clear-filter existed; clicking resets filters; no text "Clear filters" remains.` Task: tooltip/aria label; only show when active. | Batch09 verified actual Owner audit seven-filter reset and account search/role reset; owned archive/leave filters already use shared controls. No demonstrated regression or repeat fix here. | Owned portions locally acceptance-ready, awaiting shared integration; global all-dashboard criterion remains partial. |
| GEN-13 | `No text refresh buttons remain; icon triggers refresh with visible loading state.` Task: tooltip + aria-label. | Two live Staff draft views still rendered text reload buttons. Both now use existing `RefreshButton`, preserving their exact reads. Live browser proves keyboard, icon-only content, labels, busy/spin/disabled state, pending duplicate suppression, read failure/retry, identical authoritative response and six widths. Batch09 personnel/leave controls retained. | Changed owned controls locally acceptance-ready, awaiting shared integration. Global requirement remains partial until combined-role verification. |
| GEN-10 | `Notifications grouped under date headers; each can be removed (archived); button looks consistent and outline-free.` Tasks include badge, grouped/sorted endpoint, soft archive, optional read/clear-all. | Existing recipient-only active/archived pagination, exact receipt/replay, date groups and shared shell controls from earlier batches. Their PostgreSQL/contention/Owner-Staff-Dentist browser evidence is retained in Batches01–02 and `contracts/NOTIFICATION_HISTORY_API_V1.md`. No rewrite here. | Locally acceptance-ready, awaiting shared integration for the operational shell. This does not resolve universal GEN-11 archive policy or extend another recipient's inbox access. |
| GEN-11 | `No record is permanently deleted by normal users; each role sees only permitted archives; Dr Dana sees all.` Tasks additionally request archive actor/time/role, server list/view/restore and Owner permanent removal. | Existing recipient notification archival and operational audit metadata, Staff/branch resource scope and Batch09 current branch-authority contention safeguards preserved. Broad Owner access conflicts with retained private notification/clinical/message boundaries; permanent removal conflicts with later no-hard-delete instructions. | Partial; entity-specific archive visibility/restore policy blocked. No universal access, restore or deletion implemented. |
| OWN-01 | `Both charts hoverable; values match billing data to the peso; histogram appears on Saturdays.` Tasks include daily revenue, exact date/amount, Mon–Sat summary, billing reconciliation, loading/empty/error/responsive states. | Batch08 mounts authoritative charts on the actual Executive dashboard.30 focused Node passes, PostgreSQL5/84 and1/44 aggregate evidence, component replay and actual private-app browser evidence retained. Saturday is existing on-demand current-Manila-date rendering, not a new scheduled snapshot. | Locally acceptance-ready, awaiting shared integration under documented on-demand semantics. No repeat implementation. |
| STF-08 | `Partial-day leave saves correct dates and times.` Tasks: single date/correct hours, Until not before From; hardening timezone/overlap/past dates. | Shared leave form and existing Laravel checks; Batches05–07 revision-safe commands, exact replay, review/decision/cancellation and real PostgreSQL/browser evidence retained. | Locally acceptance-ready, awaiting shared integration. |
| OWN-12 | `Owner leave requests match staff behavior.` Task: apply Staff leave changes to Owner Leave requests. | Shared leave component, authorized review, date filters and authoritative recovery from Batches05–07; Batch09 refresh control retained. | Locally acceptance-ready, awaiting shared integration for existing authorized Owner review; no invented Owner self-request entitlement. |
| OWN-10 | `Work schedule matches the agreed staff changes.` Q1 default reuses Staff schedule/leave logic and manages both roles. | Existing Doctor schedule/duty and shared leave behavior; flat Staff shifts and unpublished dated preparation supported. No approved Staff recurrence/publication contract located in original criteria. | Partial; corresponding Staff effective roster behavior blocked on policy. |
| OWN-11 | `Work schedule can be set for dentists and staff.` Tasks: Staff option beside Dentist, schedules for both, feed Doctor-duty status; permissions/overlap hardening. | Existing Doctor schedules, Staff selector, revision-safe flat profile writes and unpublished dated drafts/history. Drafts are explicitly not authoritative duty. Original broader failing Node assertion remains unchanged. | Partial; not fully closed by flat profiles or this refresh change. |

OWN-02/03 existing branch dropdown/duplicate prevention/map persistence evidence and OWN-04/05/06 historical acceptance are preserved. No new closure counted. OWN-07/08/09 and clinical appointment/arrival/queue/message/prescription criteria stay with Jaztin; GEN-06/DEN-03 still lack exact reproduction. This is not a broad audit of those modules.

## Compact roster decision table

The original OWN-10/11 wording specifies outcomes but does **not** choose the following policies. Existing Dentist weekly schedules/exceptions are not approval to apply those rules to Staff. Recommendations below are proposals only, never clinic facts or activated defaults.

| Decision required | Existing supported behavior | Recommended safe default pending approval | Exact functionality blocked |
| --- | --- | --- | --- |
| Weekday recurrence and effective period, including inclusive end dates | Flat Staff profile interval; exact dated unpublished preparation. Dentist recurrence is separate. | Keep Staff drafts date-specific and unpublished; require explicit weekday/date boundaries before publication. | Recurring Staff schedule editor and bounded effective roster. |
| Date exception kinds and precedence | Dentist exceptions only; Staff dated drafts do not override duty. | Require explicit Staff exception semantics; display proposed changes without altering effective duty. | Staff day-off/override changes and exception evaluation. |
| Approved leave precedence and later withdrawal/cancellation | Leave decisions persist; existing Dentist availability uses established leave semantics. | Treat unresolved Staff leave/draft conflict as publication requiring review; no inferred active shift. | Authoritative Staff duty across leave and later leave changes. |
| Shift overlaps, multiple branches, overnight work and minimum coverage | Flat same-day intervals; revision-safe preparation. No approved Staff coverage calculation. | Require explicit resolution of a proposed overlap; do not invent staffing minimums or overnight splitting. | Effective overlap/coverage validation, multi-shift publication and cross-branch duty. |
| Who approves/publishes, whether separate states, and revocation behavior | Owner-only preparation; saved status Draft, published false. | Keep Owner preparation permission; leave publication disabled until actors and states are approved. | Approval/publication commands and permitted transitions. |
| When publication affects duty and booking | Doctor duty projection is independent; Staff drafts never affect booking/access. | Keep established Doctor-duty/booking contract; integrate Staff duty only through a reviewed contract. | Authoritative effective Staff duty and any consumer integration. |

## GEN-11 decisions and domain boundaries

For each entity proposed for Archives, approve: eligible archived states; who may list and inspect which fields; whether permission follows creator role, exact creator, branch scope or current resource permission; behavior after role/branch revocation; restore actors, allowed transitions, reference conflicts and audit evidence. Private notification content remains recipient-only, including for Owner. Owner operational archive metadata is not inbox access. Clinical documents/messages/history retain their existing restricted authority; Jaztin owns any approved clinical transition. No retention interval or permanent-delete permission can be inferred from the historical general wording.

No API, schema, Laravel controller, migrations, audit writes, role authority or clinical/financial behavior changed. Existing authorized draft GETs still validate Owner/resource/date context; response validation and error recovery remain intact. There is no assignment/transition/follow-on mutation for a refresh: authoritative completion is the matched current server response. Ordinary reloads use labelled icons; the consequential **Discard entries and reload draft** action retains explanatory text. Unknown save outcomes still expose only their established exact retry flow.

## Verification actually executed

```text
node --test tests/staff-roster-draft.test.js tests/staff-shift-command.test.js
# 4 passed, 0 failed/skipped.

node tests/operations-draft-refresh.browser.mjs <installed Playwright index.mjs>
# Passed: actual React + private Laravel/PostgreSQL, two controls,
# keyboard, busy/single request, failed-read retry, identical readback,
# widths375/390/430/768/1024/1440, >=44px targets, no page overflow/errors.

docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/leave-batch5/target.json --profile test verify-guard
# PostgreSQL migration guard: 1 test / 14 assertions passed.

npm run test:smoke
npm run build
git diff --check
# Passed. Existing Table-key and Vite chunk-size warnings retained.
```

Before reads, inspected exact owned runtime image/user/mounts/loopback port binding; started only that existing container and private55492 cluster. Guarded status verifies `dental_clinic_demo`, owned cluster identity,86 selected/applied migrations and unchanged four holds. No schema edits, migration execution, test resets, provider calls, Patient messages or financial operations. Read-only browser compares successful GET bodies before/after retry. It does not create a new persistence/concurrency claim; accepted write suites were not repeated for two control substitutions.

No introduced test failure. The known inherited OWN-11 broader assertion was neither altered nor rerun. Full Node/PHP/browser suites and predefense are deferred per this session's selective-testing instruction; this is not comprehensive system acceptance. Prior private-runtime predefense prerequisites remain unverified.

## Integration, Git and next work

Changed shared files are only `src/pages/StaffRosterDraft.jsx` and `src/pages/StaffRosterDraftCollection.jsx`, plus the new bounded browser script and this report. Jaztin has no API consumer migration; preserve the shared icon substitutions and existing draft/clinical boundaries during integration. New work does not depend on his clinical source.

Commit this verified GEN-13 follow-up locally and refresh/verify a complete-history bundle. Back up the owned demo/test via the guarded runner, stop only owned runtime services, retain private volumes/evidence. Publication remains blocked by missing authoritative Vercel preview isolation and connected Render/Railway deployment exclusions; checked-in configuration is not dashboard confirmation. No push/PR/merge/deployment.

Highest-impact next implementation is approved OWN-10/11 Staff effective scheduling, followed by entity-specific GEN-11 lifecycle permissions. Existing OWN-01, GEN-10 and STF-08/OWN-12 candidates are ready for later combined acceptance, not repeated implementation. If broader Operations work is requested before those decisions, identify another exact original criterion with a demonstrated gap first; do not create speculative infrastructure or claim this small follow-up meets the requested multi-feature batch objective.

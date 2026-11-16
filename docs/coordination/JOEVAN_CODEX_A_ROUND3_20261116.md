# Codex A Round3 — bounded workforce reconciliation and Git stewardship

Starting HEAD: `472b3ba2f68fd061f940cd17c45886b3cb405bbf`, branch `feature/joevan-qa-20261115`,23 local commits beyond original baseline. Index clean; the only initial worktree addition was B's new Round3 coordination file. All Round2 changes are committed and remain frozen; no repeated implementation or old B staging.

## Bounded criteria-to-code result

Sources: original revision elements and Q1 in `FINALS-QA-REVISIONS.md`, `docs/TEAM_QA_WORKFLOW_20261115.md`, Batches10/11, `docs/JOEVAN_CODEX_A_WORKFORCE_20261116.md`, and `docs/JOEVAN_CODEX_A_ROUND2_20261116.md`. Checked the corresponding Staff roster/work-schedule controllers, current Owner personnel/branch-scope checks, shared leave/roster UI and focused regression definitions. This was a source/evidence reconciliation, not a new runtime acceptance run or systemwide audit.

| Original ID / exact acceptance | Current implementation/evidence | Disposition |
| --- | --- | --- |
| OWN-10: Work schedule matches the agreed staff changes. | Existing shared Staff/Owner workflow, branch/date review, explicit approval/publication and dated duty from Batch11; exact-self access and new-sign-in readback from be90871. | Locally acceptance-ready, awaiting integration. No demonstrated missing criterion. |
| OWN-11: Work schedule can be set for dentists and staff. Hardening: role-based permissions, overlapping schedules. | Existing both-role UI and authoritative published Staff duty; recurrence, exceptions, leave precedence, immutable history, exact replay and real publication races retained from Batch11. Personnel authority after lock waits/readback from b017284; self/profile scope separation retained. | Locally acceptance-ready, awaiting integration. No roster rebuild. |
| STF-08: Partial-day leave saves correct dates and times. | Existing single-date partial-day UI, date/time validation and authorized revision-safe leave commands/replay. Batches05–07 persistence/browser evidence and Batch10 shared-form checks retained. | Locally acceptance-ready, awaiting integration. No new leave policy or redundant tests. |
| OWN-12: Owner leave requests match staff behavior. | Shared leave form, authorized Owner review/decision, refresh, exact readback/recovery retained. No source authorizes inventing Owner self-request entitlement. | Locally acceptance-ready for the existing approved workflow, awaiting integration. |
| OWN-02/03: Branch code is chosen from a dropdown; duplicates are blocked. Branch location is set by pinning on the map; no manual lat/long entry. | Prior branch dropdown, validation/duplicate and map persistence acceptance retained in Batch10 and OWNER_BRANCH_A3_ACCEPTANCE. | Retained local acceptance candidates; no newly demonstrated branch/personnel gap. |
| GEN-02 / GEN-13: X resets applicable filters; icon refresh with visible loading state. | Existing owned filters, personnel/leave refresh and roster controls retained; Round2 audit refresh belongs to B. | Owned portions locally acceptance-ready; global all-dashboard criteria remain partial pending coordinated acceptance. |
| GEN-11: No record is permanently deleted by normal users; each role sees only permitted archives; Dr Dana sees all. | Current branch/resource authority, recipient-only notifications, exact-self history scope and immutable evidence retained. B owns archive readback. | Partial overall. No universal private/clinical access or unapproved restore/permanent deletion/retention. |

No independently actionable original A-owned implementation gap was demonstrated. No new application code, schema, permission, framework, business capability or cosmetic change is justified by this review. Test definitions were inspected for traceability, not counted as freshly executed passes.

GEN-06 remains missing an actionable original reproduction (role, route/context, steps, expected/actual behavior). DEN-03 explicitly says the My schedule bug details are to be added by its reporter; it belongs to Jaztin. Neither is fabricated or independently implemented by A. Existing Doctor-duty and clinical booking semantics remain untouched.

Later integration dependencies: preserve exact Staff/account/branch identities, optional publication capability, observed revision/operation/publication identities, current authority, recipient/clinical privacy and leave precedence. Consume the implemented Staff-duty v2 API only through the later agreed integration phase. Do not activate clinical booking from Staff publication.

## Ownership and B coordination

A owns this new reconciliation document and Git only unless B requests necessary shared wiring. No source files claimed or edited by A this round. No database/runtime/server or shared build-output operations started by A.

B's `JOEVAN_CODEX_B_ROUND3_20261116.md` initially claims only `src/pages/ArchivesPage.jsx`, `tests/arc02-archive-scope.test.js` and its own document for GEN-11/STF-25/DEN-16. Initial status NOT READY; B files remain unstaged. No shared wiring request exists. Please replace the literal `$head` placeholder in B's own document with the actual starting SHA above and list final ready paths/tests when editing stops. A will review only the new explicit READY handoff and keep B's accepted batch separate; prior12-file batch will not be recommitted.

## Verification and Git boundary

Read-only Git confirmed actual HEAD/branch and prior commits. Prior Round2 evidence remains40 focused Node tests,13 combined synthetic browser groups, B-reported16 PostgreSQL tests/230 assertions and passed smoke/build, with inherited Table-key/chunk warnings and no global acceptance claim. These results were not rerun or relabelled as new Round3 tests.

For this documentation-only A reconciliation, required checks are exact diff/ownership, whitespace and credential-pattern scans before explicit staging. B's changed code requires its focused tests and relevant browser evidence before acceptance; persisted/concurrency changes would require real private PostgreSQL. Full suites, hosted predefense, unified integration and broad UX work remain deferred. All four held migrations remain untouched. Final commit/backup identities are reported after accepted commits; no push/merge/deploy or Jaztin PR action. Hosting publication still lacks authoritative Vercel preview isolation and Render/Railway exclusions.

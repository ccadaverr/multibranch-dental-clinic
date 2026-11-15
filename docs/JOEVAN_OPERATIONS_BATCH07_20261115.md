# Batch07 — authorized leave review before collection bounds

Continued after local commits0fcb4f7 andf402359, same feature branch and preserved eight earlier commits. The explicit collaboration fetch still resolves to a0725e645df6f8266c2bc4bebacc9d62dd18e7c1. No integration/publication.

## Source-supported correction

Actual defect: `LeaveController::index` selected the earliest300 global records before filtering permissions and requested branch in PHP. With301 earlier requests from another branch, an authorized branch request disappeared and the UI falsely showed an empty result. This is existing operational review functionality, not a new approval policy or module.

Applied existing requester/self, approver and branch rules in the database before bounding rows. The SQL preserves the existing `branchIds` precedence exactly: Dentist assignments first; otherwise assigned Staff branch; otherwise retained requester account scopes. A Staff profile assigned elsewhere does not gain visibility from unrelated fallback scopes. Soft-archived requester history remains available under its existing retained scopes. Existing post-read permission guard remains defense in depth. No private-record permission is widened.

Branch filters now validate exact existing legacy identities; unknown/internal numeric substitution422. Existing from/to day-overlap filters reject reversed ranges422. Deterministic start-time/ID ordering,301-row probe and `meta.has_more`/`limit:300` expose bounded results truthfully. Owner/configured-front-desk UI now exposes those existing date filters, keeps status/branch controls, includes closed branches for historical filtering, clears obsolete rows for invalid ranges, and explains truncation. No permanent deletion, restore, clinical state or mutation contract change.

Original criteria sources remain `FINALS-QA-REVISIONS.md`: OWN-12 shared Owner/Staff leave behavior and OWN-10 corresponding Staff workflow changes. GEN-11's permitted operational history is a related authorization invariant, not a claim that its universal Owner/archive/restore wording is resolved. **Implemented awaiting integration; no new original-QA closures.** OWN-11 effective duty remains policy-blocked only for the affected recurrence/publication paths. GEN-10's earlier status unchanged.

Files: `LeaveController.php` collection query/filter validation; `Staffing.jsx` date controls/closed-branch read filter/truncation feedback; new `LeaveCollectionScopeTest.php`; extended real browser acceptance; [leave v2 contract](contracts/LEAVE_COMMAND_API_V2.md) additive collection metadata. No routes, migrations, held-source, dependencies, original QA assertions, clinical contracts or Patient files changed in this batch.

## Executed focused verification

```text
docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/leave-batch5/target.json --profile test test tests/Feature/Staffing/LeaveCollectionScopeTest.php tests/Feature/Staffing/LeaveTest.php
# 9 tests / 138 assertions passed.
node tests/leave-recovery-postgres.browser.mjs <Playwright index.mjs>
# Real React/Laravel/PostgreSQL recovery flow still passed; added inclusive date filtering, reversed-range error/obsolete-row suppression, Owner and Staff widths375/390/430/768/1024/1440. Existing committed-response-loss, exact retry, stale conflict, explicit review, new-session readback, rapid filters and failed-load recovery remain accepted.
npm run build
npm run test:smoke
git diff --check
```

New PostgreSQL tests prove301 earlier foreign records cannot hide the authorized record; Owner branch filter is applied before the bound; actual truncation metadata is true; assignment-over-fallback isolation holds; synthetic requester soft archive preserves authorized history; invalid/open-ended date ranges and unauthorized roles are handled correctly. Initial new fixture lacked the mandatory Staff/Dentist linkage; it was corrected to a real unassigned Staff profile with retained scopes, preserving the database constraint. No test was weakened. Private synthetic data only, within the identity/hash-verified86-migration profile; no provider traffic or production data.

Comprehensive Node/PHP/browser acceptance remains Phase3. Existing full OWN-11 failure is not altered. Build/smoke retain inherited Table-key/chunk-size warnings. The five prior local predefense prerequisites remain explicitly unverified; this sprint did not fabricate clinical/financial records or start external delivery to clear them.

## Remaining and handoff

Shared leave controller/screen changes must be preserved alongside Jaztin's unrelated later integration edits. No consumer migration beyond batch05's required leave commands is needed for this additive read metadata/filter exposure. Source/API contract documents are ready locally; no external message was sent.

Unresolved Staff policies remain recurrence/effective boundaries; exception/leave precedence; overlap/coverage/overnight intervals; approval/publication authority and states; effective duty/booking impact. Drafts stay unpublished. GEN-11 entity-specific private archive visibility/restore/retention remains unresolved; GEN-06/DEN-03 reproduction remains unavailable. Do not count partial implementations as closed originals.

Publication remains blocked under `TEAM_DEVELOPMENT_SETUP.md` by missing authoritative Vercel preview isolation from existing Render proxy and connected Render/Railway production-deployment exclusions. No push, PR, merge, force-push, deployment or hosting changes. Private profiles/clones are backed up and stopped at completion, retaining volumes and recovery evidence.

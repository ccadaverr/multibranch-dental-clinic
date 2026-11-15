# Leave authority continuation — 2026-11-15, Asia/Manila

Continued immediately after the user's request to continue. Earlier batch03 preserved in local commits2680613 (dated preparation), b48de39 (Owner audit review) and062b4bf (leave audit atomicity/report). Prior four commits remain ancestors; baseline unchanged. No integration or publication.

## Concrete correction

`LeaveController.php` previously authorized decision/cancellation before waiting on the resource lock. It could use stale account/branch/approval authority after another transaction revoked access. Request creation already locked a user but never checked the freshly locked authority. Added one shared locked-actor check for all three mutations and repeat existing decision/cancellation permissions against the current locked resource. Current Active state, authentication revision, role and Person must still match. Staff/Dentist profiles for new requests are resolved again after that check. No permission or clinical rule is widened.

Actual original criteria sources: STF-08 partial-day date/time saves; OWN-12 Owner leave matches Staff behavior; OWN-10 shared agreed Staff changes in root `FINALS-QA-REVISIONS.md`. GEN-11 role-bound record permissions is relevant only as a supporting security invariant, not a broad archive closure. These remain **partial/awaiting integration**, with no new closure count. This correction implements requested lock-time role/branch enforcement; it does not claim missing Staff publication or request revision/replay functionality exists.

[Leave authority/recovery contract](contracts/LEAVE_AUTHORITY_RECOVERY_V1.md) records unchanged POST routes, Pending/Approved/Declined/Cancelled states,403 after lock-time revocation, preserved422 state guards, atomic audit and the remaining legacy retry limitations. No new client fields, migrations or frontend edits. Patient-notify, clinical booking logic and email wording remain untouched.

## Focused verification actually executed

Private target `/private/roster-batch4/target.json`, test database dental_clinic_test, internal127.0.0.1:55491, identity/hash-verified PostgreSQL18.7. Original migrations/holds unchanged. Prefix commands with `docker exec dentalops-joevan-ops-20261115` from `/workspace`:

```text
python3 scripts/local-system.py --target /private/roster-batch4/target.json --profile test test tests/Feature/Staffing/LeaveAuditAtomicityTest.php tests/Feature/Staffing/LeaveTest.php
# 8 tests / 118 assertions passed after the authority change.
python3 scripts/local-system.py --target /private/roster-batch4/target.json --profile test clone-test
# fresh empty clone /private/contention-e3d9a7c3/target.json, no reused contention fixtures.
python3 scripts/local-system.py --target /private/contention-e3d9a7c3/target.json --profile test leave-authority-contention
# 1 test / 316 observed assertions passed;5 scenarios,2 independent authenticated workers actually blocked on PostgreSQL locks each time.
python3 -m unittest scripts.tests.test_operations_profile scripts.tests.test_local_system
# 13 passed; inherited runner lock-file ResourceWarnings remain.
git diff --check
```

Scenarios: Owner account revoked during decision; requester revoked during cancellation; requester revoked during creation; configured front desk's branch scope moved away; Owner setting changed back to Owner-only while the front desk waits. All return403 after release, preserve the exact pending leave and produce no leave completion audit. Original current-authority, partial-day, note privacy, authorization and existing booking-effect checks continue to pass in `LeaveTest`.

Fresh-clone-only lane `leave-authority-contention` and narrowly allowlisted private worker endpoints were added. New Python refusal test proves regular targets cannot launch this committed contention lane. No environment credentials or tokens enter Git/output; worker tokens travel private process stdin only. Public data/clinical provider communications were not used.

Latest frontend build/smoke and36 focused Node checks already passed on the final unchanged frontend for batch03; no repeated full frontend/backend suite here. Real and synthetic browser results from batch03 remain applicable; backend-only authority changes were verified through real concurrent HTTP workers. Full integration acceptance remains Phase3. Local-only predefense still has the five fresh-runtime prerequisites documented in batch03; no claim of full-system acceptance.

Shared integration files now include `LeaveController.php`, the private worker and guarded local runner, plus batch03's three Staff draft routes/client entry and Owner audit UI/helper. No API consumer changes required for this batch. Jaztin must preserve the lock-time checks and atomic audit when integrating changes around shared Dentist/Staff leave code.

Remaining high-value work: approved Staff recurrence/effective dates/date exceptions/leave precedence/publication; leave resource revisions and exact operation recovery with migrated clients; entity-specific GEN-11 visibility/restore/retention decisions. GEN-06/DEN-03 reproduction remains missing. None is silently closed by these safety fixes.

Publication remains blocked: Vercel feature-preview exclusion/isolation from the existing Render proxy, and connected Render/Railway confirmation that feature pushes cannot deploy production. `TEAM_DEVELOPMENT_SETUP.md` explicitly requires actual dashboard confirmation; no new evidence is available. All work is local; no push, PR, merge or hosting changes. Owned clusters/clones are backed up/stopped with volumes retained at batch completion.

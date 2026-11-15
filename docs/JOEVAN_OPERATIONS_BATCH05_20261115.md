# Batch05 — leave lifecycle revision and durable recovery

Continued clean `feature/joevan-qa-20261115` at ba4e362fc0ccbc604608fd9a8fc8d4d725142e29. All eight earlier local commits and baseline a0725e645df6f8266c2bc4bebacc9d62dd18e7c1 preserved. No reset, merge, cross-branch integration or publication.

## Implemented vertical slice and original criteria

Original exact criteria remain in `FINALS-QA-REVISIONS.md`: STF-08 “Partial-day leave saves correct dates and times”; OWN-12 “Owner leave requests match staff behavior”; OWN-10 “Work schedule matches the agreed staff changes”; OWN-11 “Work schedule can be set for dentists and staff”; GEN-11 permitted archives/no ordinary-user permanent removal. Leave date/time behavior and Owner/Staff shared interfaces now have revision/retry/authority/atomic follow-on acceptance. **Implementation awaiting integration**, no new full original-QA closures. OWN-10/OWN-11 recurring/effective Staff duty remain partial. GEN-11 is improved only for exact authorized leave reads and private recovery evidence, not universal Owner archive access. GEN-10's previous awaiting-integration status remains untouched.

Two actual product callers were found: requester submission/cancellation and Owner/configured-front-desk decision/cancellation, all in `Staffing.jsx`. Migrated both end to end; no unsafe unguarded legacy lifecycle writer remains. Legacy external requests without both preconditions receive409; partial/malformed pair422. State enums/eligibility and existing Dentist booking effects remain unchanged. No Patient/clinical module implementation changes.

Each leave exposes positive integer lifecycle revision. New/imported leave starts1; approve/decline/cancel increments exactly once. Every command carries its original observed revision and actor-unique operation UUID; creation observes0. Structured stale/contradictory409 responses never replace the caller's revision. Exact replay returns the first persisted HTTP status/DTO even after later transitions or a now-past creation date. New exact GET provides current readback separately.

Added minimal encrypted append-only `leave_command_receipts`, linked to exact actor/operation/leave/audit. HMAC command fingerprint; private note/affected-appointment receipt fields are encrypted, hidden from model serialization and never added to audit metadata. Transactions commit leave, audit, journal, in-app notices and approved-wording mail-outbox intents together. Replay has no repeated audit/notification/outbox effect. A strict leave-only notification method preserves all other domains' best-effort behavior. Actual transport delivery remains the existing outbox's at-least-once responsibility, not a new delivery claim.

Actor lock uses PostgreSQL `FOR NO KEY UPDATE`, then current leave lock. Account/auth revision/role/Person and current branch/approver-setting authority are revalidated before mutation **and replay**. No-key locking serializes revocation without blocking another actor's notice/receipt FK key-share locks; real requester-versus-approver contention verifies no deadlock.

React preserves original command and form values through uncertainty, freezes edits/filter context, offers explicit retry and validates exact target/status/revision/operation before success. Stale conflicts remain blocked until explicit reload/review. Current collections refresh only after confirmed success or explicit review, never as an automatic stale-write rebase. Late account/filter/read results are ignored; list failures have explicit retry. Partial-day single-date handling is retained. Staff decisions no longer claim to publish Staff booking availability. Existing layout/confirmation components are reused.

Files: `LeaveController.php`, `LeaveRequest.php`, new `LeaveCommandReceipt.php`/`Services/Scheduling/LeaveCommands.php`; opt-in recovery migration; narrow `api.php` exact GET; notification strict-write method; `Staffing.jsx`, `api-client.js`, new `leave-command.js`/`use-leave-command.js`; focused Feature/contention/browser/Node/guard tests. Existing sequential leave tests now explicitly supply observed revisions/UUIDs through `ObservedLeaveCommands`; their original assertions remain. Dedicated stale/replay/race tests use fixed commands, never that convenience helper.

## Contract and migration handoff

[Leave command API v2](contracts/LEAVE_COMMAND_API_V2.md) is the implemented handshake for Jaztin: actual GET/POST routes, required fields, DTO/meta,403/409/422/503, integer lifecycle revision and replay/current-read distinction. Old v1 limitations are historical, linked to v2. Separate patient-notify route/body and Doctor `/api/work-schedules` are unchanged. No automatic Staff duty publication.

New additive opt-in migration `2026_11_20_000100_add_leave_command_recovery.php` lives in `database/operations`, not the frozen original directory. Fresh private profile `/private/leave-batch5/target.json`, internal127.0.0.1:55492, demo/test databases only, selects86 migrations with `--operations --roster-drafts --leave-recovery`. Source hashes/identity verified, snapshots before/after, all four holds excluded. Existing83/84/85 manifests untouched; retained85 profile verified explicit capability-unavailable behavior. No PostgreSQL host port published. Migration guard accepts only canonical ordered subsets of exactly the three reviewed extension filenames and rejects unknown/duplicate/reordered selections.

## Focused verification actually executed

Backend commands below use `docker exec dentalops-joevan-ops-20261115`, cwd `/workspace`:

```text
python3 scripts/local-system.py --target /private/leave-batch5/target.json --profile test test tests/Feature/Staffing/LeaveRecoveryTest.php tests/Feature/Staffing/LeaveTest.php tests/Feature/Staffing/LeaveAuditAtomicityTest.php
# 14 tests / 186 assertions passed.
python3 scripts/local-system.py --target /private/contention-b7657391/target.json --profile test leave-recovery-contention
# 1 test / 406 observed assertions passed;6 real lock-wait scenarios.
python3 scripts/local-system.py --target /private/contention-9825201a/target.json --profile test leave-authority-contention
# 1 test / 284 observed assertions passed;5 current-authority revocation scenarios under the new contract.
python3 scripts/local-system.py --target /private/roster-batch4/target.json --profile test test tests/Feature/Staffing/LeaveRecoveryCapabilityTest.php
# 1 test / 5 assertions passed, retained85 profile: read capability false; write503, no mutation.
python3 -m unittest scripts.tests.test_operations_profile scripts.tests.test_local_system
# 15 passed; inherited lock-file ResourceWarnings remain.
cd backend
php vendor/bin/phpunit tests/Unit/LocalMigrationProfileTest.php
# 12 tests / 25 assertions passed; no database.
node --test tests/batch04-scheduling.test.js tests/sched01-staff-roster.test.js tests/api-client.test.js tests/leave-command.test.js
# 60 passed.
node --test --test-name-pattern='STF-08 / DEN-13 / OWN-12|leave requester' tests/staffing.test.js
# 2 relevant tests passed. Inherited incomplete OWN-11 test unchanged, not reinterpreted as accepted.
node tests/leave-recovery-postgres.browser.mjs <Playwright index.mjs>
# Real React/Laravel/PostgreSQL accepted partial-day creation, approve and cancel with response lost after each commit; exact retry, retained stale revision, explicit review, older replay after later transition, new-session current read, obsolete filter suppression and failed-list recovery.
npm run build
npm run test:smoke
git diff --check
```

Contention covers duplicate create/replay, different overlapping creates, duplicate approval, different authorized approvers approve-versus-decline, requester cancellation-versus-approval, duplicate cancellation. Two independent authenticated HTTP workers actually wait on PostgreSQL locks in each case. Exactly one mutation/audit/journal wins; stale competing action409, overlap422, identical retry exact receipt. The five separate revocation cases retain account, branch and Owner approval-setting protection. Private receipt ciphertext, immutable journal SQL guards and notice-failure rollback verified.

Browser runs use generated synthetic credentials in memory only, block external origins and export no cookies/traces/secrets. Requested375/390/430/768/1024/1440 widths fit; retry works with keyboard and alerts/status announcements. No real communications, payment operations or real Patient data. Initial browser required-label locator and obsolete API-test calling convention were corrected; revision/CSRF assertions were strengthened, not weakened. No remaining focused regression. Build/smoke retain inherited chunk-size/Table-key warnings. Comprehensive full-system suites remain Phase3; predefense's five known synthetic-runtime prerequisites are not rerun or relabeled.

## Remaining and publication

Roster policy still needed: weekly recurrence/effective boundaries, default/exception precedence, approved leave precedence, overlap/coverage/overnight rules, approval/publication authority and states, effective publication/booking impact. Existing dated drafts remain explicitly unpublished. GEN-11 broad Owner restore/private-record/retention decisions remain open; no destructive deletion is added. GEN-06/DEN-03 reproduction unavailable.

Shared integration files are narrow `api.php`, `api-client.js`, `Staffing.jsx`, leave controller/model, notification service and private migration/runner guard. Jaztin must preserve his unrelated changes and migrate any future leave client to v2; current production application callers are migrated. No integration initiated.

Publication still blocked by `TEAM_DEVELOPMENT_SETUP.md` Publication gate: actual Vercel preview isolation from existing Render proxy and connected Render/Railway production-deployment exclusions are unconfirmed. No push, PR, merge or hosting changes. Meaningful local commit preserves this complete leave batch before further independent implementation.

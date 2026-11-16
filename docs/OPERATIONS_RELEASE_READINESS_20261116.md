# Operations release readiness — November16,2026

Starting accepted HEAD `ca9074a878870400a48b6c93763f4e4cdc432675`, feature/joevan-qa-20261115,25 commits beyond a0725e6. Clean index/tree and complete-history bundle `joevan-qa-20261116-131304.bundle` verified before work. No production changes, push, merge, deployment or clinical integration. Workforce QA remains frozen. This document separates executed local evidence from later acceptance instructions.

## Publication gate: BLOCKED

`TEAM_DEVELOPMENT_SETUP.md` requires actual hosting exclusions and preview isolation before even a feature push. Browser inventory returned **browser access host unavailable**; no authenticated hosting dashboard configuration was observed. No dedicated hosting connector was exposed in the tool inventory. Repository configuration is source evidence only, not proof of installed GitHub Apps or live settings.

Actual origin was verified against the intended repository without printing credentials. No vercel/railway/render/gh CLI was found on PATH and no `.vercel/project.json` link exists in this checkout. No hosting settings, hooks or live resource configurations were read successfully; no dashboard result is inferred. A's restored test clone was snapshotted after validation and stopped, followed by only A's source cluster/container; B's runtime was untouched.

Owner must provide dated, secret-free evidence identifying project/service and connected repository for EVERY connected Vercel, Render and Railway environment:

1. Vercel: production branch, feature-branch preview trigger rules, ignored-build rules and any deploy hooks. Confirm this exact feature branch cannot deploy production. Confirm preview API rewrites/environment variables point exclusively to a separate non-production API/database/storage, with external mail/payment/automation disabled, OR prove previews for this branch are disabled. Inspect effective preview rewrites, not just VITE_API_BASE_URL: `vercel.json` currently routes `/api`, `/sanctum` and `/broadcasting` to `https://multibranch-dental-clinic.onrender.com`. Its live environment classification is unknown; a frontend preview can reach that API without deploying the API.
2. Render: enumerate all connected API/worker/cron/preview/blueprint services. Show each tracked branch, auto-deploy setting, preview/pull-request behavior, build filters and deploy-hook/workflow triggers. Positively exclude the feature branch from every production service. Confirm no wildcard trigger or downstream automation turns its push into a production deploy.
3. Railway: enumerate project environments and every connected service; show source repository/branch, automatic triggers, PR/preview environments, watch rules and deploy hooks/workflows. Confirm feature pushes cannot trigger production services and any preview has separate non-production resources. If none connected, record authoritative account/repository integration inventory showing that fact.
4. GitHub: verify actual origin matches the intended repository and inspect installed Apps, Actions, webhooks and external hooks for branch-triggered deployment. Absence of tracked workflows does not prove disconnected hosting.

Do not change settings or push as a probe. Once all evidence is positively accepted, recheck clean Git state, exact origin, current SHA and credential scan; the user's conditional authorization permits only normal `git push origin HEAD:refs/heads/feature/joevan-qa-20261115`. No force push, PR/merge or production deployment. Until then use the verified full-history bundle as a potential owner-approved offline transfer: Jaztin verifies it and imports only into a new local review reference, without resetting or merging her branch. Bundles exclude untracked runtime secrets but are still private project source; agree delivery/access separately.

## Runtime inventory

| Area | Existing implementation / dependency | Evidence, gap and required acceptance |
| --- | --- | --- |
| Database | PostgreSQL PDO; private manifest identity, restricted application role and separate admin migration role in local-system.py | Private profile verified;87 selected migrations. Hosted DB host/database/SSL/pooler/credentials unknown. Never adopt dental_clinic or an ambient .env. Confirm identity with status before every action. |
| Environment | Provisioner creates private mode600 profile files, independent APP_KEY, loopback DB, Manila timezone, local_capture mail and blank provider credentials | Preserve APP_KEY separately with encrypted-data backups. Names required: APP_ENV/APP_DEBUG/APP_KEY/APP_URL/FRONTEND_URL/APP_TIMEZONE, DB_CONNECTION/HOST/PORT/DATABASE/USERNAME/PASSWORD/SSLMODE, SESSION_DRIVER/DOMAIN/SECURE_COOKIE, SANCTUM_STATEFUL_DOMAINS, CACHE_STORE, QUEUE_CONNECTION, DB_QUEUE_RETRY_AFTER, MAIL_MAILER/HOST/PORT/FROM_ADDRESS, LOG_CHANNEL and storage settings. Never paste values into evidence. |
| Startup/deployment | render.yaml declares one Docker web service, /up health check; Docker Supervisor runs nginx/FPM/worker/scheduler/Reverb | Actual Render/Railway deployment is unverified. Blueprint APP_ENV=local and DB_DATABASE=postgres do not prove safe hosting. Entrypoint formerly ran default migrate --force with ignored failure when AUTO_MIGRATE=true; now refuses that flag before any startup side effect. Release migrations must be explicit and backed up. Existing remote services are unchanged. |
| Worker | Supervisor queue:work --queue=mail,default --tries=3 --timeout=600; local runner has demo-only worker | Database queue retry_after defaults90, shorter than Supervisor timeout600: require verified DB_QUEUE_RETRY_AFTER greater than600 (e.g.660) or reviewed shorter job timeout before service acceptance. No remote value assumed. Ensure memory/process capacity and graceful shutdown; do not run duplicate scheduler/worker installations accidentally. |
| Scheduler | schedule:work; backend/routes/console.php invokes mail processing and approved automations | Local predefense reports scheduler unavailable in this session. Validate profile-specific PID plus durable recent-run timestamps; process-name detection alone is not full proof. Keep unapproved automation wording off. |
| Outbox/notifications | Durable mail_dispatches, claim/retry lifecycle; recipient-specific notification archive and exact replay | Current private demo: no queued jobs, failed jobs, pending mail or >10-minute aged outbox. Historical failures are not silently cleared or replayed. Local capture is not external delivery. Inspect actual status/attempt/receipt and private capture; transport acceptance is not proof of inbox delivery. |
| Session/Sanctum | Database sessions, cookie CSRF, explicit stateful hosts, current role/auth-version validation | Verify HTTPS cookie domain/secure attributes and credential CORS against actual proxy topology; test sign-in/reload/logout and revocation. APP_KEY must remain stable. Do not infer session isolation merely from a working frontend URL. |
| Storage/PDF | private local disk with serve=false; public symlink only for public disk; authorized document/PDF routes; optional S3 configuration | Ephemeral container storage is not durable backup. Confirm persistent volume/object storage, writable paths and role/record-isolated PDF retrieval. Back up private objects plus metadata and encryption keys; test restoring them separately. No object restore performed this session. |
| Logs/health | stderr/stack logging, Supervisor process logs, /up route | /up is liveness, not proof of worker/scheduler/database/SMTP readiness. APP_DEBUG=false; do not dump secrets/clinical content. Retain private diagnostic logs, status counts and release SHA; verify alerts and restart behavior during later acceptance. |
| Resource dependencies | PHP8.3+ and locked extensions, Composer/vendor, Node/Vite for UI, PostgreSQL tools, Python/POSIX runner, optional Reverb and local SMTP capture | Docker private runtime PHP8.3.6 executed focused checks; another hosted image needs its own platform preflight. SMTP capture script uses Python3.9–3.11 smtpd; validate installed version. Keep local ports8104/5195/1026 distinct from other developers. |

## Executed non-production evidence

Only A-owned container `dentalops-joevan-ops-20261115` was started. Existing `/private/roster11b/target.json` was verified; no shared .env/cache modifications or migrations. Existing runner `clone-test` created `/private/contention-f9b2ad26/target.json`, performed pg_dump/pg_restore into a NEW loopback cluster and replaced only its isolated identity marker. It did not overwrite the original database.

Executed on that restored target:

```text
python3 scripts/local-system.py --target /private/contention-f9b2ad26/target.json --profile test verify-guard
# 1 test,14 assertions passed.
python3 scripts/local-system.py --target /private/contention-f9b2ad26/target.json --profile test test tests/Feature/Staffing/StaffRosterPublicationTest.php
# 12 tests,189 assertions passed after actual restore.
python3 -m unittest scripts.tests.test_entrypoint_safety
# 2 passed; AUTO_MIGRATE=true exits1 before startup mutations; shell syntax valid.
```

This is real restored-schema/application evidence, not a complete demo/encrypted-record/object-store/disaster-recovery rehearsal. Retain source APP_KEY and object data for such a rehearsal. No external communication or payment occurred.

Local-only predefense was executed through the verified manifest environment (TEAM_DEVELOPMENT_SETUP section5), exit1: **4 FAIL,3 WARN**. Failures: API8104 unavailable, frontend5195 unavailable, worker unavailable, scheduler unavailable. Data prerequisites already pass:5 synthetic Patients; Issued unpaid invoice INV-2026-000003;11 branding settings;3 branches with phone/hours; queue empty; no failed/stuck/pending outbox; automation rows present and unapproved wording disabled. Warnings: external provider/tunnel acceptance skipped, branch3 email absent,9 draft assistant answers. These are not corrected with fake contacts, invented wording or weakened checks. Legacy predefense suggestions to run default migrations/demo-start must NOT override the guarded migration profile.

## Reproducible synthetic acceptance / recovery procedure

Use `LOCAL_FULLSTACK_DEVELOPMENT.md`, `TEAM_DEVELOPMENT_SETUP.md` and the implemented provisioner/runner, not a new framework. Create a NEW private runtime outside Git on a free loopback port with `provision-local-system.py --operations --roster-drafts --leave-recovery --roster-publication` plus explicit runtime/port/php/pg-bin arguments. Inspect --help and source for platform paths. Generated credentials stay private. Confirm status and intended database before migrate; only explicit profile migration selection is permitted. Expect87 applied entries and four genuinely pending holds. Do not repin hashes or fake migration rows.

On a newly provisioned A-owned demo only: use guarded `seed`, inspect richer `seed-demo` before opting in, and `visit-fixture` for synthetic booking prerequisites. Never reseed an accepted existing demo merely to satisfy counters. For an unpaid presentation invoice, use the existing supported synthetic Staff treatment/invoice journey; never insert an invented payment success. Preserve existing valid five-Patient/unpaid-invoice data found here.

Start verified-profile API, local UI, local-only SMTP capture, worker and scheduler as separate owned processes using TEAM_DEVELOPMENT_SETUP section4. Validate local_capture and blank provider keys before processing any queued job. Do not enable external messaging/payments or clear old failures. Run predefense --local-only through runner.environment, then inspect statuses and actual receipts. The four service failures above remain unexecuted startup acceptance, not code-test failures.

Backup: runner `backup` uses pg_dump -Fc into mode600 private files after target identity verification. `clone-test` is the implemented new-cluster restore drill for test profiles; use --exit-on-error and verify destination identity, migration ledger/guards, schema and focused application reads/writes. Fresh demo recovery must likewise restore to a separately provisioned target, never overwrite the source; preserve/review ownership, role grants, identity marker and APP_KEY privately. Default migrations/rollback/fresh/wipe remain prohibited. On migration failure: stop release, retain logs/source/hash/partial ledger, keep failed target for diagnosis, restore last good snapshot into a NEW target and verify before any controlled switch. A source-code rollback cannot undo a committed schema or restore encrypted files.

All four holds remain: remove_patient_feedback_table; backfill_tooth_chart_branch; add_critical_foreign_key_and_analytics_indexes; update_queue_statuses_and_remove_urgent_priority. Served means treatment START. No destructive queue/tooth-chart conversion is authorized.

## Executable later-acceptance lanes (NOT run here unless listed above)

Use `python3 scripts/local-system.py --target "$TARGET" --profile test test <explicit files>`; one suite per profile. Existing files:

- Role/cross-branch/foreign-resource denial: tests/Feature/Appointments/AppointmentAuthorizationTest.php, Reference/ReferenceDataAuthorizationTest.php, Notifications/NotificationArchiveTest.php.
- Revision, replay, rollback and current personnel identity: Staffing/WorkforceSelfAccessTest.php, PersonnelUpdateReadbackTest.php, StaffRosterPublicationTest.php; use existing Node workforce/leave command tests and browser scripts for lost responses/new sessions. Observe exact persisted IDs/revisions/audit counts, not only HTTP200.
- Contention: fresh clone-test target, then roster-publication-contention or leave-recovery-contention; never reuse committed fixtures. PersonnelAuthorityContentionTest.php also requires a fresh clone. Observe actual lock waits and one permitted outcome/no duplicate side effects.
- Mail: tests/Feature/Mail/MailOutboxTest.php and Notifications/NotificationArchiveTest.php; controlled worker stop/restart only in isolated local_capture demo. Compare pending/claimed/retry/attempt/receipt and captured message count before/after; do not queue:retry all blindly.
- Scheduler: start profile schedule:work, observe actual recorded due run and outbox transition; stop it and observe missing heartbeat, restart and ensure replay creates no duplicate effects. This operational exercise remains pending.
- PDF/private files: Documents/DocumentManagementTest.php, Billing/BillingDocumentDownloadTest.php, Prescriptions/PrescriptionTest.php; verify foreign account403/404 and matching authorized PDF identity/content. No real patient data.
- Sessions: Appointments/BookingSessionAcceptanceTest.php plus real sign-in/reload/revocation browser checks; invalidate current authority while request waits and verify no stale completion.
- Release rollback: new restored target and last-good image/SHA, verify /up plus authenticated reads, roster publication pointer/history, private PDF and local capture. Switch no hosted traffic until separately authorized. Full deployed rollback remains untested.

## Integration preparation, not integration

Accepted implementation anchor is ca9074a; review the complete history from a0725e6. Existing full handoff is alongside the verified bundle: OPERATIONS_IMPLEMENTATION_HANDOFF_20261116_ca9074a.md. Staff duty v2, dated draft v1, leave command v2/authority recovery v1 and notification history v1 are in docs/contracts. Optional Operations schema is additive, guarded and not automatically in the production chain. Published-only Staff duty, separate Owner approval/publication, immutable versions, exact replay and approved leave precedence remain intact.

Potential shared collisions: backend/routes/api.php; src/pages/Admin.jsx, Staffing.jsx, src/reference-data-bridge.js and shared api-client helpers; exact migration profile/orchestration. Resolve semantic identities, scope, receipt/error shapes and capability flags before mechanical conflicts. Do not replace Doctor availability/clinical booking with Staff duty. Preserve operational audit filters/cursors and recipient-only inboxes.

Retain OWN-10/11, STF-08/OWN-12, OWN-01 and operational GEN-10 candidates; STF-25/DEN-16 ready only for verified archive-detail scope. GEN-11 and global GEN-02/13 remain partial; GEN-06/DEN-03 need original reproductions. Prior focused tests/browsers/build are historical evidence, not production readiness. Unified integration, comprehensive system tests, provider delivery, storage recovery and deployed rollback remain deferred. No68/68 claim.

## Runtime acceptance follow-up — November16 (starting23cf477)

Demonstrated configuration correction: Supervisor timeout600 exceeded database retry_after90 and equalled the outbox claim lease600. Supervisor now uses60, matching the established local/Laravel default; local-system worker explicitly declares the same60. Effective demo configuration was read through Laravel: database dental_clinic_demo, queue database, retry_after90, outbox claim600. LocalCaptureTransport already has a5-second socket timeout. The ordering60<90 and60<600 permits the worker to exit before another reservation/stale claim is eligible. A regression test reads these versioned defaults and asserts the ordering. Future operators MUST inspect effective overrides and job-specific timeout properties: reserve/claim leases must exceed the maximum running-job timeout. Linux/POSIX signal support is required. Do not increase worker timeout for a slow job without reviewing both leases. The earlier recommendation to override retry_after for a600-second worker is superseded by this correction. No production settings changed.

The private Docker toolchain lacked GD, producing a real dompdf failure. Added php8.3-gd to its versioned Dockerfile and installed the distribution package only inside A's existing container. No application/PDF authorization change. Three initial outbox failures were caused by running tests that expect sync/array under the demo-style database/local_capture defaults; explicit test-process MAIL_MAILER=array and QUEUE_CONNECTION=sync restore their intended baseline. Tests explicitly selecting database queue still exercise it. Neither runtime .env nor assertions were changed.

Executed focused checks after correction:

- Python startup/configuration safety3/3 passed; AUTO_MIGRATE=true refusal remains enforced.
- Real PostgreSQL MailOutboxTest, BillingDocumentDownloadTest and BookingSessionAcceptanceTest:20tests/135assertions passed. Covers actual database worker processing after commit, transient retry/backoff, exhaustion, duplicate intents/jobs, held/stale claims, rollback, append-only attempts, one-time non-retryable mail, PDF ownership and session rules. Mail is faked/array in these tests; no delivery claim.
- All five services started in A's verified profile: PostgreSQL, API8104, frontend5195, database queue worker, scheduler. Frontend points explicitly to API8104; container-loopback5195 bridges to the host frontend for diagnostics. No B process/database/cache changed.
- Exactly one local-only predefense run with services up passed ALL required checks,0FAIL/3WARN. Warnings remain external integration skipped, missing branch3 email and9 draft assistant answers. Five Patients and unpaid invoice already existed; no speculative seeding needed. This run does not exercise SMTP capture or validate process identity merely from its global process-name check.
- Actual schedule:run executed mail:process-due, automations:run and expired-hold release successfully on synthetic demo data. Existing scheduler process also ran; no business rule changes or provider activation.
- Actual owned demo worker was terminated and restarted, with new PID and explicit timeout60. A separate isolated runtime-probe queue in A's test database exercised SIGKILL while a synthetic job was executing, then simulated expiry ONLY on its reservation (rather than waiting90seconds). Restart exposed one failed job; a replacement synthetic idempotent operation left one effect marker. Fixture source/logs remain private under /private/roster11b. This proves real process interruption/restart/failure visibility plus fixture idempotency; it is not proof of exactly-once SMTP delivery.
- Actual Chrome Owner sign-in, reload and exact /api/me identity survived an API stop/restart after waiting for /up. Early probe setup omitted the sign-in hash/Origin and later reloaded before readiness; corrected harness passed without changing auth code. Session persistence is backed by the existing database and unchanged APP_KEY.

Python3.12 in the private image lacks smtpd/asyncore required by the existing Python3.9–3.11 capture script. Live local-capture delivery remains environment-blocked, even though required predefense passes with an empty outbox; provision the documented compatible capture process before a real local mail journey. Never infer delivery from that check. Encrypted/private-object restoration and hosted rollback remain unexecuted. The existing MailOutbox contract explicitly permits at-least-once delivery after a crash between transport acceptance and recorded outcome; timeout correction does not remove that ambiguity. No old failures were deleted or blindly replayed. Probe failure evidence is retained in the test database.

### Offline transfer: technically possible, credential review BLOCKED

Scanned3,864 reachable historical text blobs across all Git refs with private-key, provider-token and credential-URL patterns. One candidate was found in historical `.agents/mcp_config.json`, object d062dc45729e44cb500c090026dd70a1409faf19, introduced in f4b04f6. It contains a loopback PostgreSQL credential URL whose password is not a recognized placeholder. The value was never printed or added to this report; validity and reuse are unknown. Metadata-only scan report is in the private backup directory. This heuristic scan is not proof that no other secret exists (binary/encoded credentials and unrecognized formats need further review).

Do NOT transfer/publish the complete-history bundle as credential-cleared. Owner must privately review the historical value, determine affected systems and rotate/revoke it if valid/reused before sharing, and approve secure delivery to Jaztin. Preserve the current25+ commits; do not silently rewrite/remove history. Encryption protects transfer/storage but does not neutralize a credential present in the bundle. No bundle was sent.

After credential review and an approved private channel, Jaztin can verify/import without touching her work:

```bash
git bundle verify /private/path/joevan-qa-TIMESTAMP.bundle
git init /private/new-operations-review
git -C /private/new-operations-review fetch /private/path/joevan-qa-TIMESTAMP.bundle refs/heads/feature/joevan-qa-20261115:refs/heads/joevan-review
git -C /private/new-operations-review rev-parse refs/heads/joevan-review
# Compare the full accepted SHA from Joevan's final report; inspect history/contracts here.
# Do not merge, reset, replace credentials, or import runtime/mail/database files into Jaztin's branch.
```

The hosting evidence list above still applies: actual Vercel preview API isolation/branch triggers, every Render/Railway production service exclusion and GitHub App/webhook/workflow triggers. No credentials or secret screenshots are requested. No push/merge/deploy is authorized until that gate is satisfied. Existing dump/restore evidence was retained and not repeated.

# TEAM-UAT-01

Use one local synthetic environment per teammate. The UI-R01 source anchor is *4ee9ef51e5839a5f7876834fc414e904275aba9a*, descended from A16 *87f41696561872fc24d399901b25d16e5afa1dce*.

## Get the source

This branch is published at the source anchor above. Use:

~~~sh
git clone --single-branch --branch feature/ui-r01-anti-slop https://github.com/ccadaverr/multibranch-dental-clinic.git dentalops-team-uat-01
cd dentalops-team-uat-01
git rev-parse HEAD
git status --short --branch
git merge-base --is-ancestor 87f41696561872fc24d399901b25d16e5afa1dce HEAD
~~~

For offline source recovery, the owner can provide the source-only *UI-R01-source.bundle*. Its recorded SHA-256 is *cdca0841c2c547bd0b7940f7e3d86fd2c1c5784a3d1ddf6b75649defd9418d96*. Verify it with PowerShell *Get-FileHash* or macOS *shasum -a 256*, then use the bundle path in place of the GitHub URL. The bundle clone was checked at the exact source anchor. If the remote later carries documentation commits, compare its exact SHA with the owner before testing.

## Windows with Docker Desktop

Use Docker Desktop in Linux-container mode and host Node.js. Verification used Windows PowerShell, Node 24, the tracked Ubuntu toolchain, PHP 8.3 with GD and PDO PostgreSQL, Composer 2.9.5, Python 3.12 and PostgreSQL 18. Run from the checkout root. Ensure localhost ports 5481 and 8481 and container name *dentalops-team-uat-01* are free. An existing container with that name should be inspected before reuse. For macOS see below.

~~~powershell
$uat = 'dentalops-team-uat-01'
$archive = Join-Path $env:TEMP 'dentalops-team-uat-source.tar'
docker build --tag dentalops-team-uat-toolchain:local scripts/local-runtime
docker run -d --name $uat -p 127.0.0.1:8481:8105 dentalops-team-uat-toolchain:local
git archive --format=tar --output=$archive HEAD
docker cp $archive "${uat}:/tmp/dentalops-source.tar"
docker exec $uat tar -xf /tmp/dentalops-source.tar -C /workspace
docker exec $uat sh -c 'set -e; cd /tmp; curl -fsSLO https://getcomposer.org/download/2.9.5/composer.phar; curl -fsSLO https://getcomposer.org/download/2.9.5/composer.phar.sha256sum; sha256sum -c composer.phar.sha256sum'
docker exec -w /workspace/backend $uat php /tmp/composer.phar install --no-interaction --prefer-dist
docker exec -w /workspace/backend $uat php /tmp/composer.phar check-platform-reqs
docker exec $uat python3 scripts/provision-local-system.py --runtime /private/uat --port 55498 --php /usr/bin/php --pg-bin /usr/lib/postgresql/18/bin --operations --roster-drafts --leave-recovery --roster-publication
docker exec $uat python3 scripts/local-system.py --target /private/uat/target.json --profile test migrate
docker exec $uat python3 scripts/local-system.py --target /private/uat/target.json --profile test status
docker exec $uat python3 scripts/synthetic-demo-runtime.py prepare --source /private/uat/target.json --api-port 8104 --frontend-url http://127.0.0.1:5481
~~~

Stop on any error. Status must show *owned isolated development*, 87 selected/applied migrations and all four held files. The *test* database remains the clean template for resets and transactional suites. *prepare* prints the new synthetic demo manifest. Copy only that path into the variable below. Repeat the *uat* and *demo* assignments in any separate PowerShell terminal.

~~~powershell
$demo = '/private/contention-REPLACE/target.json'
docker exec -d $uat socat TCP-LISTEN:8105,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:8104
docker exec -d $uat python3 scripts/synthetic-demo-runtime.py run --target $demo
npm.cmd ci
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8481'
$env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = 'host.docker.internal'
npm.cmd exec -- vite --host 127.0.0.1 --port 5481 --strictPort
~~~

Open [http://127.0.0.1:5481](http://127.0.0.1:5481). From a second terminal, confirm the API health endpoint and run:

~~~powershell
docker exec $uat python3 scripts/synthetic-demo-runtime.py check --target $demo --frontend-probe-url http://host.docker.internal:5481
docker exec $uat python3 scripts/local-system.py --target $demo --profile demo visit-fixture
~~~

The frontend and Sanctum origins must use the exact 127.0.0.1 URLs above. The backend environment, database credentials, private storage and app key are generated inside the container. The worker consumes only the mail queue. The scheduler runs only local mail capture on loopback SMTP; mail never relays to a provider. Keep backend/.env out of the shared checkout. Keep Vite/API bindings on loopback and leave real provider credentials unset.

### Accounts and fixtures

| Role | Base account | Supplemental Sprint 02 account |
| --- | --- | --- |
| Owner | owner@example.test | Same |
| Staff | staff.reception@example.test | sprint02.staff@example.test |
| Dentist | dentist@example.test | sprint02.dentist@example.test |
| Patient | patient@example.test | sprint02.patient@example.test |

The generated password stays in the private file *demo-login-password* next to the runtime manifest. Use *docker cp* to copy only that file from the demo manifest’s directory to a private OS account folder outside Git. Open it privately and enter it in the browser. Do not share that file. Use separate browser profiles for each role. Use captioned synthetic files for document uploads. The demo seeder provides multiple branches and synthetic bookings, completed Visits, paid and unpaid invoices, payments and receipts. *visit-fixture* adds the scoped Sprint 02 branch and accounts. Use the checklist to produce a new issued prescription and published duty through application commands.

### Resume and reset

Stop the demo supervisor with *docker exec $uat python3 scripts/synthetic-demo-runtime.py stop --target $demo*. The owned PostgreSQL cluster and Laravel/worker/scheduler stop together. Allow old loopback sockets to clear; use *run* with the same manifest to resume. After a container stop, restart it and its single relay before *run*. Ctrl+C stops only the Vite terminal.

For new fixtures, stop the old demo and run *prepare* again from the same verified empty *test* profile. Use the new returned manifest and re-run *visit-fixture*. Keep the old demo and its private key. Never use broad Artisan migrations, reset, wipe, rollback, provider scripts or the frozen presentation database. Containers hold the private data in their writable layer in this setup. For a durable private snapshot use *local-system.py --target $demo --profile demo backup* and retain the matching app key and private files separately.

### macOS

The branch and bundle clone commands above are portable. This current 87-migration runtime was verified from a Windows host, with the backend in Linux on Docker Desktop. For macOS, use Docker Desktop and the same Linux toolchain; the Docker subcommands and URLs are unchanged. Use shell variables *uat=dentalops-team-uat-01*, *archive="$(mktemp)"*, *demo=/private/contention-REPLACE/target.json*, *npm ci* and *VITE_API_BASE_URL=http://127.0.0.1:8481 __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=host.docker.internal npm exec -- vite --host 127.0.0.1 --port 5481 --strictPort*. This host flow, including Apple Silicon, was not executed here. The older [macOS development guide](LOCAL_FULLSTACK_DEVELOPMENT.md) records a previous native profile. Do not substitute its 83-migration commands for this lane. The synthetic supervisor uses Linux process metadata.

## Manual UAT

Capture the same Patient, appointment, Visit, invoice and receipt references at handoff. Use Manila dates. For each test record PASS, FAIL or BLOCKED, role, branch, public reference and evidence. Run at 375, 430, 768, 1024, 1440 and 1920 px. Verify tab order and visible focus, keyboard dialogs and return focus, reduced motion, and retry affordances. Horizontal scrolling should be confined to deliberately scrollable tables.

| Area | Exercise and expected result |
| --- | --- |
| Patient booking | From Book a visit choose a supported service, branch and valid available time, then Pay at clinic. Confirm the booking in My visits after reload. On the appointment’s Manila clinic date, use the same record for cross-role UAT. A separately booked same-day Staff appointment can exercise admission immediately. |
| Patient care | Add a synthetic dependent in Family Records. Confirm exact person switching and isolation. Upload an approved synthetic PDF through Documents, check consent and authorized retrieval, and retry a failed read. Verify an issued prescription and its PDF, then a paid invoice and exact receipt PDF. Confirm drafts and foreign records are hidden. |
| Staff front desk | Find the exact appointment, read lifecycle and booking payment independently, confirm ID and Check-In. Register a separate synthetic walk-in, admit it and check the persisted Visit. Call the first eligible queue entry. Check Patient Record access within branch scope and scoped Archives. Cancel a separate unarrived appointment with a reason and read back the result after a simulated failure. Read and archive an actual notification, then reload. |
| Dentist | Open the assigned Visit from My Queue and confirm Patient and branch. Search the Dental Chart through authorized Visits, record a synthetic finding with a named surface and check history. Start, document and complete treatment. Save, edit and issue a prescription for that Visit. Confirm an unrelated Dentist cannot write. Verify Patient Records, wording preview retry, approval receipt and historical readback. |
| Owner | Filter Analytics by branch and Manila date, compare exact Cash figures with chart and CSV. Inspect the read-only receipt and Audit Log, check loaded-event counts and retry keyboard focus. Review Staff/Dentist access using synthetic accounts. Approve a Staff duty request, confirm approval alone leaves duty ineffective, publish it separately, then confirm the effective assignment in a fresh Staff session. |
| Cross-role workflow | Patient-created appointment → Staff discovery and arrival → populated Waiting queue → FIFO Call → same Dentist Visit and treatment → issued prescription → Staff invoice review and Cash settlement → Patient PDF receipt → Owner matching report. Served means treatment started. Book ahead for the Patient-origin path and use it on its scheduled day. |
| Negative and recovery | Check unauthenticated access, wrong Patient, foreign branch and unrelated Dentist. Try a stale revision. On the disposable target only, simulate a lost committed response, reload and read authoritative state before retrying the original action. Confirm one Visit, Call, issue, settlement and receipt. Verify both a failed read and a recovered reload. |

## Known limits

- Provider refunds with uncertain outcomes, credit disposition and post-issue HMO corrections need reconciliation or policy decisions. Do not use real providers here.
- Selected clinical permissions and held schema changes remain excluded. Mail-only scheduling does not exercise automated clinical/financial jobs.
- The unchanged Audit CORS assertion expects an exact exposed-header list without the existing X-Document-Id. Do not remove that header or broaden origins to make the assertion pass.
- Failed-login audit severity remains the persisted backend value. Use connection, environment health and data states when triaging; booking and invoice settlement are separate concepts.

## Verified on the fresh source

- The fresh local clone and the GitHub clone resolve to the same commit and tree. The GitHub tracked-source archive was byte-identical to the archive used for the isolated backend and browser tests. Its SHA-256 was *252829a0d4e525f9df5a089d4c7437f96bfecbae002e91d8eb3af3c1a59104de3*.
- Windows with Docker Desktop installed clean frontend and backend dependencies. The empty test profile applied exactly 87 approved migrations. The replacement demo target reproduced that profile without additional migrations or A16 data.
- Frontend suite passed 2,059 tests and skipped eight. All 17 smoke groups passed. Production build passed with the existing chunk-size warning. Runtime predefense reported 0 failures and five warnings. The mail worker and scheduler restarted and captured one local message without replaying a historical job.
- Focused Laravel/PostgreSQL ran 52 tests and 660 assertions. There were 51 passes and one known Audit CORS assertion mismatch. Live responses preserved the exact Vite origin and exposed X-Document-Id. A request from a different origin received no matching allow-origin value.
- A Patient created a Pay at clinic booking, APT-2026-000005, which Staff found without a linked Visit. It was left for its scheduled Manila date. Separate same-day appointment APT-2026-000006 went through authorized Check-In, populated Live Queue, FIFO Call, the linked Dentist Visit, issued prescription RX-2026-000001, Cash invoice INV-2026-000004 and Patient receipt RCT-2026-000003. Owner chart and CSV matched the PHP 1,000 settlement. Stale arrival produced no Visit. Replayed Call and issuance used their original commands.
- Browser checks confirmed scoped Staff document upload and replay, exact Dentist Visit attachment, a byte-identical authorized Patient download, masked foreign document and record reads, and revoked access after sign-out. Staff scheduling passed separate approval and publication, response replay and effective-duty readback in a fresh session.
- Seven UI-R01 screens passed browser checks at the six listed widths, for 42 captures. Coverage includes appointment and booking-payment columns, notifications with read/archive, Walk-in Admission with keyboard dismissal and return focus, Dentist Patient Records and Chart, Owner Audit Trail and exact read-only receipt details. The remaining manual checklist cases are for teammate UAT.

## Bug report template

~~~text
Source SHA / platform / browser / viewport:
Role / synthetic branch / Manila date and time:
Public appointment, Visit, invoice or receipt reference:
Setup precondition:
Steps:
Expected:
Actual and persisted state after reload:
Recovery attempt and result:
Redacted screenshot or log:
~~~

Exclude credentials, cookies, app keys, reset codes, mailbox captures and private documents from reports.

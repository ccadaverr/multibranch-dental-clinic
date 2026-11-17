# A09 presentation checkpoint

The Windows integration checkout started clean on `integration/dentalops-fullstack-20261117` at `ece49f51e6056aa28834a2bdf4ce9e46b94ca58d`. A08's fifteen integrated passes remain. B09–B11 and Jaztin J01/J02 were already in the ancestry. Neither J03 nor J04 was present as a local object. No approved remote source or exact J05 checkpoint was supplied.

B12 integrated at `6487b44198c1b217cbdb7ec1dbb7fa314634f78c`. Both handoff checksum inventories and the six dependency patches matched. B12 adds a single Owner change and its six-width browser probe. A meaningful new query brings back all result types while retaining the branch. The patch SHA-256 is `63420dcba328ffe7c9983db652b262f0dc26b85c1fb87cd1a989e5fb26839ffc`.

B14 integrated at `5bacbb58e3559c76f144c378d09abe63898d379a`. Its supplied patch SHA-256 is `90b46a139def5f14fd063dc27df650489040ab493952b1dbfd2b39296c1dcc70`. The Owner archive now queries the authorized Paid invoice history for the branch selected on screen. Incomplete results have an explicit status and a retry. The fixture runner takes a snapshot before writing. It verifies ownership and exact server identity before setup, and the PHP fixture rechecks the cluster marker under the restricted application role. The changed-file inventory is available from the two integration commits.

| GEN-09 comparison | Longer path | Shortcut |
| --- | --- | --- |
| Staff scheduled Check-In | 4 activations | 3 activations |
| Staff booking from exact Patient Record | 6 activations and one search input | 4 activations |
| Staff opening exact Patient Record | 2 activations | 1 activation |
| Dentist issuing an existing saved Draft | 4 activations | 3 activations |

The authenticated probes read back the exact appointment, Patient, branch and Visit, require ID confirmation, and deny Patient access to Draft prescriptions. Lost issuance response replay returned the original issue result. The prescription rerun waited for the signed-in shell after reload and selected the newest test Draft; its persisted identity was independently checked against the ID created by that iteration. GEN-09 remains Partial/Pending. The comparison does not cover blank composition through issue or the remaining appointment management and historical review maps.

## Verified workflows

- The live Staff-created appointment continued through ID confirmation, Check-In, an exact Call, Dentist start and documentation, explicit completion, Staff invoice review and issue, Cash, Patient receipt and Owner scoped cash reporting. It retained the same appointment, Patient, Visit and Treatment identities. A separate Patient-created booking recovered its original reference after response loss. Staff read the same exact appointment after restart, including Patient, Dentist, branch and service. The Patient-created appointment was for November 19 and was not admitted early for this rehearsal.
- The live workforce request stayed out of effective duty through approval, became visible after explicit publication and retained its exact receipt across a lost response. A fresh Staff session confirmed the published date and hours. The scenario checks a Staff request. Dentist duty-request publication was not rehearsed.
- Restart readback verified the Served queue, completed Treatment, issued prescription, Paid invoice, exact receipt, protected document and published duty. A failed document download produced an error and retry returned the same bytes. Staff Call and Message retries produced one durable effect. The Owner report and archive browser probe verified failed-read recovery, branch exclusion and exact saved data at six widths.
- A separate pristine synthetic target verified one durable mail intent, local capture, duplicate suppression and worker/scheduler restarts. Its predefense result was zero failures and four warnings. The populated rehearsal has one branch-contact failure and five warnings after warm-up. Its temporary branch is explicitly labelled synthetic. The previously settled receipts and a separate newly seeded unpaid invoice are available together.

The full frontend suite passed 2,023 tests with 8 existing skips. Smoke passed 17 groups and the production build passed with the existing Vite chunk warning. The Check-In browser fixture passed 38 cases, including stale selection, late responses, duplicate clicks and exact retry. The focused PostgreSQL regression passed 116 tests and 1,049 assertions. The final reviewed backend run had 1,309 tests and 15,341 assertions. Its 26 failures and one error matched the exact A08 test identities, with three skips. Unit tests passed all 252 with 30 notices. Python passed all 53 using the committed bytes of the hash-pinned proposal fixture. The proposal was not installed.

## Restart and rehearse

Open `http://127.0.0.1:5399/#sign-in` for the A09 synthetic frontend. The previous port 5198 did not respond at the start of A09. The A09 container publishes only the loopback API port 8399. PostgreSQL and mail capture stay within the container. Demo credentials remain in the private target. The verified profiles use exactly 87 reviewed schema entries and preserve the four holds.

Use the existing [private runtime adapter](../scripts/local-runtime/README.md) for a new machine or a lost container. Use its locked vendor tree and a Git snapshot of the chosen full integration SHA. On Windows, use `git -c core.autocrlf=false archive` so the Linux execution copy receives the committed line endings for shell scripts and hash-pinned files. The A09 local container is `dentalops-a09-20261118`. Preserve its private volume with the target manifest, APP_KEY, storage and snapshots together. The two targets below compete for the same internal ports. Stop the active supervisor before starting the other one.

| A09 target within the container | Use |
| --- | --- |
| `/private/contention-0040b5ff/target.json` | Populated rehearsal with verified arrivals, completed Treatment, issued prescriptions, protected document, Cash evidence and published Staff duty |
| `/private/contention-1bb2ff55/target.json` | Minimal Owner archive and reporting fixture plus two distinct synthetic Patient records for a fresh rehearsal |

```powershell
$container = 'dentalops-a09-20261118'
$target = '/private/contention-0040b5ff/target.json'
docker start $container
docker exec -d $container python3 scripts/synthetic-demo-runtime.py run --target $target
docker exec -d $container socat TCP-LISTEN:8105,fork,reuseaddr TCP:127.0.0.1:8104
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8399'
npm.cmd exec -- vite --host 127.0.0.1 --port 5399 --strictPort
```

Run the Docker start and forwarding steps only when resuming a stopped container. To switch an already running target, use `synthetic-demo-runtime.py stop --target <current-target>`, then its `run` command for the other target.

To reproduce the exact Owner verification on a fresh disposable target, use `synthetic-demo-runtime.py prepare --source <owned-empty-test-target> --reference-data-only` with the selected API/frontend ports. Run `presentation-fixtures.py --target <new-target>` before starting its supervisor. The Owner report probe uses a single Cash example and therefore expects the reference-data-only profile. The default populated profile preserves its other synthetic financial examples.

- For a completed care walkthrough, open Staff Appointments or Check-In, then the Dentist's completed encounter and issued prescriptions. Open the same synthetic Patient's Billing and Documents in an independent Patient session. Use the separate Owner login for Analytics and Archives. The completed treatment, invoice and receipt were checked against the same Visit, and Owner cash totals increased by the exact scoped amount.
- For workforce, open Staff Work Schedules and use a future date. The Owner approves first and publishes separately. Staff reopens My Duty to see the confirmed effective schedule. Approval alone leaves duty unchanged.
- For the final handoff, read the full source SHA with `git rev-parse HEAD`. Use the preserved bundle and private snapshot if the workstation or branch needs recovery. A source bundle alone cannot restore the demo's persisted records.

The synthetic scheduler covers mail only and routes through local capture. Presentation does not require PayMongo, external mail or a hosted deployment. The fixture branch remains explicitly unconfirmed clinic data.

# Repeatable synthetic runtime

This is local-only infrastructure. It does not deploy, migrate, install grants/GEN-07 columns, process a copied demo backlog or prove external delivery. Linux/POSIX PHP/PostgreSQL/Python tools are required; the existing toolchain Docker image is suitable. Source and locked Composer dependencies must be present in the execution checkout. Credentials, captures, storage and logs stay outside Git in private owned directories.

## Prepare a NEW demo

Use a private `local-system.py` target manifest whose transactional test database is independently verified empty. The preparation command checks the actual server identity, all87 selected migration names and source hashes, then refuses any Patient, User, job, mail intent or document in that source. It holds the source test lock while taking the snapshot. It never copies the populated demo database and never resets an existing target.

```powershell
# Run inside the owned Linux execution environment; substitute the explicit private source manifest.
python3 scripts/synthetic-demo-runtime.py prepare --source /private/integration/target.json --api-port 8104 --capture-port 1027 --frontend-url http://127.0.0.1:5198
```

The command prints a NEW random `/private/contention-.../target.json`. It clones only the empty reviewed schema into a separate PostgreSQL cluster/port, creates its demo database, generates independent private demo credentials/key/cache/storage paths, and runs the existing DatabaseSeeder and DemoClinicSeeder. The seeders create actual synthetic accounts/care/billing records through existing services, including an issued unpaid invoice; they do not fabricate settlements or modify accepted transactions. Confirmed clinic reference contacts come from the existing RealBranchSeeder. No synthetic contact is presented as newly confirmed clinic information. Base demo seed intents remain superseded, not sent.

No migration executes. The four held files remain excluded, the87 ledger is retained and grants/GEN-07 proposal stay absent. A nonempty test source or a changed migration inventory fails closed. Keep the printed manifest; never reprovision/adopt its directory.

## Start, check and stop

First ensure the chosen API/capture ports are free. Never kill an ambient listener. Stop an existing owned API only after checking its exact command and target environment; do not interrupt another developer. Use the source worktree's matching frontend:

```powershell
# Windows host example: Node resolves dependencies from this checkout; runtime-dir is an owned private Vite cache/env directory.
$env:VITE_API_BASE_URL='http://127.0.0.1:8124'
node scripts/local-ui.mjs <private-vite-runtime-dir> 5198
```

Vite is a separate caller-owned foreground process; Ctrl+C stops it. Port8124 is the existing Docker loopback adapter to container API8104. For native Linux without the adapter, use API8104 directly. No unrestricted hosts or public ingress is required. If using the container-to-host diagnostic probe, allow only `host.docker.internal` on the local Vite server as documented in `scripts/local-runtime/README.md`.

```powershell
# Substitute the NEW printed target in all commands below.
python3 scripts/synthetic-demo-runtime.py run --target /private/contention-.../target.json
# In another terminal:
python3 scripts/synthetic-demo-runtime.py check --target /private/contention-.../target.json --frontend-probe-url http://host.docker.internal:5198
python3 scripts/synthetic-demo-runtime.py stop --target /private/contention-.../target.json
```

`run` owns the API, local SMTP capture, mail-queue worker and schedule worker. The exact target marker, actual database identity, private storage, local mail transport and schema hashes are checked. The schedule contains **mail:process-due only**; appointment release, intake expiry and clinical/financial automations are not registered in this opt-in profile. Normal profiles retain their original four scheduled commands. Health verifies owned PIDs/start ticks, actual argv, target/database environment and runnable process state; a worker belonging to another target cannot satisfy this synthetic check. No secret environment value is logged.

The supervisor permits at most three restarts per child, has one exclusive target lock, and fails closed after repeated service failures. SIGTERM/Ctrl+C stops its process groups and its NEW PostgreSQL cluster, retaining data and private evidence. `stop` verifies the supervisor PID/start time/target before signalling it; repeat stop is harmless. `run` restarts that same owned cluster and existing records, never reseeds or drops them. For a prepared-only cluster which has not yet run, use `local-system.py --target <new-manifest> stop` to stop PostgreSQL. There is no destructive cleanup command.

Existing non-synthetic profiles are now refused by `local-system.py worker/scheduler`; do not bypass this with generic Artisan backlog commands. Their historical jobs remain held. A successful local check still warns that providers and non-mail business automations were not accepted; do not describe it as deployment readiness.

## Windows resume after Docker has stopped

The API loopback adapter is a separate container process and does not survive a container restart. A04 verified the following explicit recovery on the existing owned integration container and synthetic target; no reprovisioning, reseeding or migration is needed. Run from the integration worktree. Keep these three services in separate terminals.

1. Inspect `docker ps -a` and `docker inspect dentalops-integration-20261117 --format '{{json .HostConfig.PortBindings}}'`. The adapter must remain published only at `127.0.0.1:8124` to container8105. Start the container with `docker start dentalops-integration-20261117` if stopped. Inspect `docker exec dentalops-integration-20261117 ps -eo pid,args` before starting an adapter; an existing exact owned socat process needs no second launch. Refuse an unknown listener rather than terminating it.

   ```powershell
   docker exec dentalops-integration-20261117 socat TCP-LISTEN:8105,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:8104
   ```

2. Resume the retained synthetic target, which checks its marker/cluster/source hashes and reuses persisted records. This example is the S03/A04 target, not the protected original profile:

   ```powershell
   docker exec dentalops-integration-20261117 python3 scripts/synthetic-demo-runtime.py run --target /private/contention-50cf2b13/target.json
   ```

3. Start the matching frontend with the exact API and approved browser origin. A different Vite port may fail CORS/session bootstrap; changing the origin requires a reviewed target configuration. Use a private caller-owned directory outside Git for the Vite cache/env.

   ```powershell
   $env:VITE_API_BASE_URL='http://127.0.0.1:8124'
   $env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS='host.docker.internal'
   node scripts/local-ui.mjs <private-vite-runtime-dir> 5198
   ```

Then run the existing `check --target /private/contention-50cf2b13/target.json --frontend-probe-url http://host.docker.internal:5198` command through `docker exec`. A04 observed zero failures/four warnings, four real login/reload/logout sessions, receipt-confirmed notification archival and separate Staff roster approval/publication after this container restart. The synthetic mail-only schedule still excludes clinical/financial automations and external delivery. Stop the target using its guarded `stop` command, then Ctrl+C only the adapter/Vite terminals you own. Retain private credentials, storage and snapshots; never print the generated password or put it in this document.

## Acceptance and recovery

```powershell
python3 scripts/synthetic-demo-acceptance.py --target /private/contention-.../target.json
# Separate committed-fixture recovery lab, cloning the EMPTY source test profile into its own clusters:
python3 scripts/clinical-runtime-lab.py --target /private/integration/target.json
```

The synthetic acceptance pauses its own worker, proves a new committed intent/job is pending, resumes it, verifies one local capture with no delivery confirmation, repeats the same intent key and restarts worker/scheduler without a duplicate effect. Its exact registered schedule is asserted. The independent recovery lab additionally covers actual offline retry, interrupted execution before SMTP acknowledgment, fresh-claim refusal, two real PostgreSQL contenders recovering a stale claim, duplicate suppression and private-document/key/access-boundary restore to another new cluster. A crash **after** transport acknowledgment can cause at-least-once delivery duplication; this system does not claim exactly-once external delivery.

All acceptance commands write only disposable synthetic targets. A failed test is not permission to run a generic backlog processor, default migration chain, schema cutover or external mail/payment integration.

A06 replaces the retired Python `asyncore`/`smtpd` capture with a standard-library loopback receiver compatible with Python 3.12. The existing command and ports remain valid. Only synthetic `example.test` recipients are accepted; an entire mixed-recipient transaction is refused. Messages are private and flushed before acknowledgment; there is no relay. The disposable recovery lab still tests interruption before acknowledgment. Preserve LF when copying shell scripts into Linux, and use the explicit Vite allowed-host environment above for a container-to-host frontend probe.

The optional `visit-fixture` creates an explicitly labelled synthetic all-day branch for after-hours admission tests. Its intentionally unconfirmed contact/hours data produces a predefense branch-placeholder failure and an additional missing-email warning. Do not replace these with invented clinic facts or run that fixture on the accepted port-5198 demo. A06 used a separate container, API 8129, frontend 5208 and private target for these writes; the accepted demo remained 0 failures / 4 warnings.

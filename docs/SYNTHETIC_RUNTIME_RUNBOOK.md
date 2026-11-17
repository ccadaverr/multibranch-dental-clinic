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

## Acceptance and recovery

```powershell
python3 scripts/synthetic-demo-acceptance.py --target /private/contention-.../target.json
# Separate committed-fixture recovery lab, cloning the EMPTY source test profile into its own clusters:
python3 scripts/clinical-runtime-lab.py --target /private/integration/target.json
```

The synthetic acceptance pauses its own worker, proves a new committed intent/job is pending, resumes it, verifies one local capture with no delivery confirmation, repeats the same intent key and restarts worker/scheduler without a duplicate effect. Its exact registered schedule is asserted. The independent recovery lab additionally covers actual offline retry, interrupted execution before SMTP acknowledgment, fresh-claim refusal, two real PostgreSQL contenders recovering a stale claim, duplicate suppression and private-document/key/access-boundary restore to another new cluster. A crash **after** transport acknowledgment can cause at-least-once delivery duplication; this system does not claim exactly-once external delivery.

All acceptance commands write only disposable synthetic targets. A failed test is not permission to run a generic backlog processor, default migration chain, schema cutover or external mail/payment integration.

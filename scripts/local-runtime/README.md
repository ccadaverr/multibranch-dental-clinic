# Joevan private Operations runtime

This is a toolchain adapter for Windows Docker Desktop, verified in this continuation with PHP8.3.6, PostgreSQL18.7, Python3.12 and the locked Composer dependencies. It runs the existing POSIX provisioning/identity/hash/held-migration guards inside a NEW Linux container. It does not adopt existing containers, clusters, passwords or another developer's environment. OS packages are installed using Ubuntu24.04 and the [official PostgreSQL Ubuntu repository instructions](https://www.postgresql.org/download/linux/ubuntu/).

Verified names on Joevan's machine:

- Image `dentalops-joevan-ops-runtime:20261115` (toolchain only; no source/secrets).
- Container `dentalops-joevan-ops-20261115`; user `joevan` uid1001.
- Volumes `dentalops-joevan-ops-private-20261115` and `dentalops-joevan-ops-source-20261115`.
- Private manifest `/private/ops/target.json`, PostgreSQL loopback55489 **inside this container**, databases `dental_clinic_demo`/`dental_clinic_test`. No PostgreSQL port is published to the host. Manifest/files remain private in the owned Linux volume.
- API: guarded runner listens container127.0.0.1:8104; an explicit socat forward on8105 is published only at host127.0.0.1:8104. Frontend uses host127.0.0.1:5195.

Build context is this directory only. Before creating a runtime, inspect Docker names/ports and refuse existing names; do not replace or remove anything. Existing clinic/scratch containers remain untouched. Create new named volumes only, copy a secret-scanned source manifest (exclude actual .env, dumps, captures, credentials, .git), and install/copy the locked vendor tree. Keep source/runtime separate. A source snapshot is not automatically synchronized with later edits; update only reviewed files and run the migration hash checks again. Windows raw-copy shell files may need LF normalization **in the Linux execution copy**; do not modify original migration bytes.

For a NEW source/runtime volume only:

```text
docker build --tag dentalops-joevan-ops-runtime:20261115 scripts/local-runtime
docker run -d --name dentalops-joevan-ops-20261115 --mount type=volume,source=dentalops-joevan-ops-private-20261115,target=/private --mount type=volume,source=dentalops-joevan-ops-source-20261115,target=/workspace -p 127.0.0.1:8104:8105 dentalops-joevan-ops-runtime:20261115
# After the reviewed source/dependency transfer:
docker exec dentalops-joevan-ops-20261115 python3 scripts/provision-local-system.py --runtime /private/ops --port 55489 --php /usr/bin/php --pg-bin /usr/lib/postgresql/18/bin --operations
```

Do not rerun provisioning on the existing `/private/ops`. Resume with `status`/`start`. `--operations` selects exactly the one additive notification-archive migration in `backend/database/operations`; the original87-file base inventory (86 originals + compatibility) stays unchanged, with four holds. Base profile:83 applied entries; opt-in Operations profile:84. Both Python and Laravel guards verify the exact selected paths/hashes. Do not repin an existing manifest to bypass a changed migration. No hosted/production migration command is added.

```text
docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/ops/target.json --profile test status
docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/ops/target.json --profile test migrate
docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/ops/target.json --profile demo migrate
docker exec dentalops-joevan-ops-20261115 python3 scripts/local-system.py --target /private/ops/target.json --profile demo seed
```

Use explicit test files with the existing `test` action. For actual contention, create a fresh `clone-test` from the empty transactional test profile, then pass the returned private manifest to `operations-contention`. This lane refuses the regular runtime or a profile without the archive extension. Its fixtures commit; never rerun it on a used clone. Back up and stop every used clone, retaining its history and private APP_KEY.

Browser prerequisites and acceptance:

The committed Operations contention scenarios each require an empty fixture. Run both with `python3 scripts/operations-contention-suite.py --source /private/ops/target.json` against the empty archive-only test source. The wrapper verifies the source, creates a separate clone per scenario, then backs up and stops each clone even on failure. It never resets the source or reuses a committed fixture.

```text
docker exec dentalops-joevan-ops-20261115 python3 scripts/local-operations-fixture.py /private/ops/target.json
node tests/operations-workforce.browser.mjs <absolute-path-to-playwright/index.mjs>
```

The fixture verifies demo database/cluster identity, holds the profile lock, backs up first and creates new explicitly synthetic notification intents for three demo roles. It writes an ID-only run manifest privately. It never seeds archive completion, care or financial results. Browser acceptance reads the generated password into process memory, never exports credentials/cookies/traces, blocks external browser origins, drops real responses after commit and signs in using new contexts for readback. A fresh fixture run preserves failed/completed prior evidence. No provider/mailbox acceptance is claimed; Python3.12 cannot run the legacy SMTP capture, so use Python3.11 if that separate service is needed.

For Vite's container-origin diagnostic only, set `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=host.docker.internal`; keep the dev server bound to127.0.0.1. Private local-only predefense may use `FRONTEND_URL=http://host.docker.internal:5195` for the diagnostic HTTP check. Normal browser origins remain localhost/127.0.0.1. Do not enable unrestricted hosts or change production hosting.

At completion: back up demo/test and clones via the guarded runner, stop each owned PostgreSQL cluster, and stop only this container. Do not remove containers/volumes or discard private keys/snapshots. Restart the container and then the explicit owned cluster when resuming; no production auto-start policy is installed.

## Dated preparation continuation

The new **separate** target `/private/roster-batch4/target.json` uses internal loopback55491 and the same two allowed database names. It was provisioned with `--operations --roster-drafts`, selecting85 migrations. Existing `/private/ops` remains84 and was used to verify explicit503 capability absence. Do not overwrite either manifest. Failed migration experimentation in `/private/roster-batch3` was backed up and stopped; its hashes were not repinned.

`--roster-drafts` selects exactly `2026_11_19_000100_create_staff_roster_drafts.php`; it enables Owner preparation only, never publication or effective duty. The base profile remains83, archive-only84, draft-only84, combined85. The original87 source files and four held migrations are unchanged.

Use `clone-test` from the empty transactional85 profile, then `roster-draft-contention` with the returned fresh clone manifest. This lane refuses regular targets. Accepted clone `/private/contention-0609eb17` covers actual PostgreSQL lock contention, exact replay, stale/conflicting commands and Owner revocation; failed clone `/private/contention-4901073e` is retained for diagnosis, not reused.

New browser commands (local API/Vite running against the new85 demo profile):

```text
node tests/operations-preparation.browser.mjs <absolute-path-to-playwright/index.mjs>
node tests/roster-draft-postgres.browser.mjs <absolute-path-to-playwright/index.mjs>
```

The first is a synthetic race/recovery fixture. The second authenticates synthetic Owner contexts, saves through real React/Laravel/PostgreSQL, loses a committed response, retries the exact operation and opens a new session for readback. It reads only its explicitly named private generated password into memory. Neither invokes provider services or changes effective duty. Back up/stop all owned targets after acceptance.

Further leave acceptance uses the `leave-authority-contention` lane on a **new** `clone-test` target. Accepted clone `/private/contention-e3d9a7c3` verifies lock-time account, branch-scope and configured approver revocation for creation/decision/cancellation. It changes no migration profile and refuses regular targets; do not rerun its committed fixture on a used clone. Back up and stop it, retaining all evidence.

Batch05 uses separate `/private/leave-batch5/target.json`, internal55492, provisioned with `--operations --roster-drafts --leave-recovery`:86 selected/applied migrations, original holds unchanged. Leave commands require the new recovery schema; older profiles expose `commands_available:false` and refuse writes503. No existing manifest was repinned. Fresh `leave-recovery-contention` clone `/private/contention-b7657391` covers six actual create/replay/decision/cancellation races; separate clone `/private/contention-9825201a` reruns five authority-revocation scenarios with required command preconditions. Never reuse committed clones. Real browser: `node tests/leave-recovery-postgres.browser.mjs <Playwright index.mjs>`, with local API/Vite serving this demo profile. Password remains in private memory. Back up/stop each owned cluster and retain all volume evidence at completion.

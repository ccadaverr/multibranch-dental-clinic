# Joevan + Jaztin shared development setup — 2026-11-15

Shared integration target: `collab/dentalops-qa-20261115` in `https://github.com/ccadaverr/multibranch-dental-clinic`. Its initial source anchor is `df56fda57c640ea772f4d73417a17275657095de` (accepted Sprint03). The final publication SHA may be a documentation/development-setup descendant; record the actual remote SHA reported at publication. A local branch alone is not proof of publication. Never start from an older feature branch.

This guide supplements [the verified local runbook](LOCAL_FULLSTACK_DEVELOPMENT.md), [visit/settlement acceptance](LOCAL_VISIT_SETTLEMENT_SPRINT02.md) and [prescription acceptance](LOCAL_PRESCRIPTION_SPRINT03.md). It does not authorize production deployment, a real clinic database, provider traffic or selected-follow-up activation.

## 1. Start both developers from the same remote SHA

New computer:

```bash
git clone --branch collab/dentalops-qa-20261115 --single-branch \
  https://github.com/ccadaverr/multibranch-dental-clinic.git
cd multibranch-dental-clinic
git fetch origin refs/heads/collab/dentalops-qa-20261115:refs/remotes/origin/collab/dentalops-qa-20261115
git rev-parse origin/collab/dentalops-qa-20261115
git merge-base --is-ancestor df56fda57c640ea772f4d73417a17275657095de origin/collab/dentalops-qa-20261115
# Joevan:
git switch -c feature/joevan-qa-20261115 origin/collab/dentalops-qa-20261115
# Jaztin runs this alternative on her computer:
# git switch -c feature/jaztin-qa-20261115 origin/collab/dentalops-qa-20261115
```

Existing checkout: first require a clean `git status`, fetch only the explicit collaboration ref above, inspect any existing local feature branch and its ancestry, then create the appropriate feature branch. Never reset, overwrite or reuse an unrelated worktree. Compare the complete baseline SHA with each other before the first edits. Neither developer edits the collaboration branch directly. The current controlled integration worktree was reused for publication; no duplicate working directory is needed.

## 2. Prerequisites and locked installs

Verified local versions: PHP8.3.30, Composer2.9.5, Node22.19.0, PostgreSQL18.6. `backend/composer.json` requires PHP^8.3 and Laravel^13.17; the lockfile and Composer platform check decide the actual extension/version requirements. Keep both lockfiles unchanged unless a dependency update is the explicit batch. Required platform capabilities include PostgreSQL PDO, POSIX, DOM/XML, mbstring and the extensions reported by Composer. Do not use `--ignore-platform-reqs`.

The guarded runner uses POSIX ownership/permissions and `fcntl`: use macOS or Linux/WSL2, not native Windows. Windows users should keep checkout/runtime in the WSL Linux filesystem. The local SMTP capture uses Python's `smtpd`/`asyncore`: use Python3.9–3.11 for that process (Python3.12+ removed these modules). Other scripts may use a newer Python3. Git and PostgreSQL client/server binaries must be installed locally; containers/remote endpoints are not adopted by this profile.

```bash
php --version
composer --version
node --version
npm --version
python3 --version
(cd backend && composer install --no-interaction --prefer-dist --no-scripts --no-plugins)
(cd backend && composer check-platform-reqs)
npm ci --ignore-scripts
```

Do not run `composer setup`, broad `artisan migrate`, `migrate:fresh`, reset/refresh/rollback/wipe, `demo-reset.sh` or a blanket backend Feature suite. Those older paths do not establish this guarded83-entry migration profile. Never copy Jaztin's `.env`, runtime manifest, credentials, cache, captured mail or snapshots.

## 3. Joevan-owned PostgreSQL cluster and credentials

`scripts/provision-local-system.py` creates a **new** loopback-only cluster, new local administrator/application passwords, independent APP_KEY values, a generated demo password, private profile files and a protected cluster marker. It refuses an existing runtime, a busy port,5432 and a runtime inside the checkout. It never adopts an existing server or executes migrations/seeds. Preserve failed attempts for diagnosis; choose a new runtime rather than deleting/reinitializing an existing cluster.

Choose a short private path without whitespace, outside Git. Resolve executable paths on Joevan's computer; the example PostgreSQL directory is a placeholder, not Jaztin's installation:

```bash
DENTALOPS_PHP_BIN="$(command -v php)"
DENTALOPS_PG_BIN="/absolute/path/to/postgresql18/bin"
DENTALOPS_RUNTIME="$HOME/.local/share/dentalops/qa-20261115"
python3 scripts/provision-local-system.py \
  --runtime "$DENTALOPS_RUNTIME" --port 55489 \
  --php "$DENTALOPS_PHP_BIN" --pg-bin "$DENTALOPS_PG_BIN"
TARGET="$DENTALOPS_RUNTIME/target.json"
python3 scripts/local-system.py --target "$TARGET" --profile demo status
python3 scripts/local-system.py --target "$TARGET" --profile test status
```

Examples for finding PostgreSQL: Postgres.app's versioned `bin` directory on macOS, a Homebrew PostgreSQL18 `bin`, or `/usr/lib/postgresql/18/bin` on Linux if that installed version exists. Run `"$DENTALOPS_PG_BIN/postgres" --version` first. This exact provisioning path is locally verified with PHP8.3.30/PostgreSQL18.6; another platform/version needs its own preflight, not a compatibility claim.

Passwords and keys stay in mode600 files under the mode700 runtime. Read the generated demo password privately from `demo-login-password`; never paste it into chat, commit it, put it in shell arguments or publish screenshots of it. The application role is not database owner/superuser and cannot rewrite the migration ledger or cluster marker. There is no `dental_clinic` target.

Apply only the runner's reviewed paths, with automatic recoverable snapshots before/after:

```bash
python3 scripts/local-system.py --target "$TARGET" --profile demo migrate
python3 scripts/local-system.py --target "$TARGET" --profile test migrate
python3 scripts/local-system.py --target "$TARGET" --profile test verify-schema
python3 scripts/local-system.py --target "$TARGET" --profile test verify-guard
python3 scripts/local-system.py --target "$TARGET" --profile demo seed
```

The base `seed` creates synthetic four-role/reference prerequisites. `seed-demo` is the separate, explicit richer demo seeder; inspect it first, run only against the owned demo, and never treat seeded clinical/payment results as browser acceptance. Do not seed the transactional test database. See the existing runbook for the real visit fixture and browser journeys.

Expected migrated ledger: **83 entries**,82 original files plus the compatibility preservation migration. These four remain genuinely pending:

- `2026_11_10_000100_remove_patient_feedback_table.php`
- `2026_11_15_000400_backfill_tooth_chart_branch.php`
- `2026_11_15_000500_add_critical_foreign_key_and_analytics_indexes.php`
- `2026_11_16_000500_update_queue_statuses_and_remove_urgent_priority.php`

The original86 migrations are immutable in this collaboration batch. Never fake ledger entries or repin hashes to bypass a hold. Any future additive migration needs both developers' reviewed schema/contract and a new safely tested profile. No broad rollback: back up, restore into a new verified target, verify identities/ledgers/triggers and retain the original APP_KEY separately for encrypted-record recovery.

## 4. Start Laravel, Vite and local background processes

Use separate terminals with the same `TARGET`; check existing listeners/processes first. Provisioning leaves the new cluster running. Use runner `start` only when it is stopped.

```bash
# Terminal A
python3 scripts/local-system.py --target "$TARGET" --profile demo serve
# Terminal B (portable alternative to the existing Mac-specific runner ui action)
VITE_API_BASE_URL=http://127.0.0.1:8104 node scripts/local-ui.mjs "$DENTALOPS_RUNTIME"
# Terminal C: use the installed Python3.9–3.11 executable
python3.11 scripts/local-mailbox.py "$DENTALOPS_RUNTIME"
# Terminal D
python3 scripts/local-system.py --target "$TARGET" --profile demo worker
# Terminal E
python3 scripts/local-system.py --target "$TARGET" --profile demo scheduler
```

UI `http://127.0.0.1:5195`; API `http://127.0.0.1:8104`; local SMTP capture `127.0.0.1:1026`. The existing runner `ui`/`mailbox` actions use `/usr/local/bin/node` and `/usr/bin/python3`; use the portable direct commands above if those paths are unsuitable. Keep fixed loopback ports free on each computer; do not kill unrelated services.

Synthetic logins: `owner@example.test`, `staff.reception@example.test`, `dentist@example.test`, `patient@example.test`, with that developer's generated password. Email capture accepts only `example.test` and never relays. The generated profiles blank external provider credentials, use informational knowledge mode and local/log transports. Captured verification codes are sensitive private runtime data. Sign-in after verification is voluntary; no notification/provider activation is part of onboarding.

Stop only your owned foreground processes with Ctrl+C, then `local-system.py --target "$TARGET" --profile demo stop`. Never broad-kill PostgreSQL or another worktree's processes.

## 5. Focused verification and known baseline

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -v
# Database-free Unit suite, without inheriting DENTALOPS_LOCAL_TARGET:
(cd backend && env -u DENTALOPS_LOCAL_TARGET php vendor/bin/phpunit --bootstrap vendor/autoload.php tests/Unit)
# Explicit guarded API paths; run one suite per test database at a time:
python3 scripts/local-system.py --target "$TARGET" --profile test test \
  tests/Feature/Prescriptions/PrescriptionTest.php \
  tests/Feature/Prescriptions/PrescriptionRecoveryTest.php
node --test tests/prescription-command.test.js tests/prescription-session-api.test.js
npm test
npm run test:smoke
npm run build
git diff --check
```

Only reviewed explicit API files are accepted. Destructive/concurrency suites are not ordinary Feature runs: use fresh `clone-test` manifests and the runner's `concurrency`, `billing-concurrency` or `prescription-concurrency` lane, then back up and stop each clone. See the existing runbook for browser prerequisites/commands and private PDF parsing. Run local predefense under the same verified profile, without printing its environment:

```bash
DENTALOPS_LOCAL_TARGET="$TARGET" python3 - <<'PYCODE'
import os, pathlib, runpy, subprocess
runner = runpy.run_path('scripts/local-system.py')
c, runtime = runner['target'](pathlib.Path(os.environ['DENTALOPS_LOCAL_TARGET']))
runner['verify'](c, runtime, c['demo_database'])
subprocess.run(['bash', 'scripts/predefense-check.sh', '--local-only'],
               env=runner['environment'](c, runtime, 'demo'), check=True)
PYCODE
```

An ordinary shell may load a different `.env` and must not be treated as equivalent. A freshly base-seeded environment can report incomplete demo/worker prerequisites; resolve those exact local prerequisites through the runbook, not invented clinic contacts or external provider setup.

Last accepted Sprint03 results (historical, not rerun for this publication): PHP Unit246; guarded API389/4,983 assertions;10 prescription contention scenarios;21 prepared-clone Rx methods; frontend1,818 passes/one inherited OWN-11 failure/eight skips; actual prescription/PDF journey and25 visibility groups; smoke/build passed. Four held queue-migration source diagnostics still fail. Preserve these failures and fix their actual contracts, not their assertions. A failed newer test remains a regression until explained.

## 6. Batch, publish and integrate

Use [the duo QA plan](TEAM_QA_WORKFLOW_20261115.md). Joevan owns backend/database changes; Jaztin owns frontend/browser/client changes; both review clinical, financial, permission, revision, idempotency and automation contracts before either implementation. Keep frozen `docs/architecture/CONTRACTS.md` changes under the existing team-review rule. API agreement includes exact request/response/error examples and authoritative readback; neither side invents a second workflow.

For each short batch: implement → focused test → next dependent item → one meaningful batch commit. Stage an explicit reviewed manifest; scan every diff for secrets. Publish only the developer's exact feature branch after checking current deployment exclusions:

```bash
# Joevan, after tests and a local accepted batch commit:
git push origin HEAD:refs/heads/feature/joevan-qa-20261115
# Jaztin's alternative:
# git push origin HEAD:refs/heads/feature/jaztin-qa-20261115
```

Open a PR targeting **collab/dentalops-qa-20261115**, never main. Include original QA IDs, exact criteria, source/API/schema changes, focused tests, browser/persistence evidence and unresolved policy. No force-push, direct shared-branch edits, automatic merge or unrelated branch publication.

Before another batch, fetch the explicit collaboration ref. If your feature branch is clean and contains no independent commits, fast-forward it. For an already published branch, integrate the approved collaboration tip with an ordinary reviewed merge commit on the feature branch; never rewrite published history. On unpublished work, a coordinated rebase is permissible, but never rebase the shared branch. Resolve contracts with the other developer before resolving overlapping code mechanically.

The integration owner combines approved PRs into the collaboration target, runs the changed-module cross-role/API/browser tests and required consolidated gates, fixes real conflicts, updates evidence, then publishes the accepted shared tip. Future approved PR integration is a process instruction, not permission for an agent to merge now. Record each accepted SHA and have both developers fetch it. Use separate per-batch evidence files to avoid both editing one ledger; the integration owner reconciles the68-row master matrix at checkpoints without changing original IDs/owners or counting partial fixes as closure.

## Publication gate

Before the first branch push and future feature pushes, verify the actual origin, secret scan and hosting branch exclusions. No checked-in GitHub Actions workflow does not prove disconnected GitHub Apps. Vercel/Render/Railway settings live outside Git. Existing `vercel.json` proxies to Render; a preview that reaches a live backend has not been confirmed harmless by that fact alone. A missing dashboard confirmation remains an explicit publication blocker. Never use a branch push as a probe for production behavior. No changes to hosting settings, main or production are authorized here.

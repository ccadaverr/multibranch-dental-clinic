# Controlled local full-stack development

This profile runs React/Vite, Laravel/Sanctum, PostgreSQL, a queue worker, a scheduler and a **local mail capture**. It is development infrastructure, not deployment or acceptance of all 68 original QA requirements. No AUD-10 activation is enabled.

## Verified tooling and target

- Existing MAMP PHP 8.3.30, Composer 2.9.5; dependencies installed from the unchanged backend composer.lock with `--no-scripts --no-plugins`. Platform requirements pass; no global PHP replacement or platform bypass.
- Existing Postgres.app 18.6. A new cluster was initialized under `$HOME/.local/share/dentalops/fullstack-20261114/postgres`, listening only on 127.0.0.1:55488. It does not use the existing5432 instance or any remote database.
- Separate `dental_clinic_demo` and `dental_clinic_test`; synthetic accounts/data only. Application role `dentalops_app` is not a superuser, database creator or schema owner. A separate local migrator owns tables. The application cannot TRUNCATE tables or rewrite the migration ledger. A protected, read-only identity marker binds tests to the actual cluster.
- `target.json`, credentials, environment files, cache, snapshots and captured mail are private local files outside Git. Integration backend `.env`/`.env.testing` were created only after verifying they did not exist; both are ignored and mode600. Never copy credentials into a report.

The original 86 migration files are unchanged. The reviewed local profile applies 82 original migrations plus `database/compatibility/2026_11_17_000100_preserve_queue_state_vocabulary.php` (83 ledger entries).

Four original files remain pending in the active demo/test databases:

1. `2026_11_10_000100_remove_patient_feedback_table.php` — destructive feedback removal/provenance changes.
2. `2026_11_15_000400_backfill_tooth_chart_branch.php` — append-only trigger bypass.
3. `2026_11_15_000500_add_critical_foreign_key_and_analytics_indexes.php` — separate nontransactional concurrent-index review.
4. `2026_11_16_000500_update_queue_statuses_and_remove_urgent_priority.php` — incompatible/lossy queue conversion.

The compatibility migration changes constraints only. It preserves statuses, priorities/reasons, IDs, links, numbers, revisions, timestamps and all history. Down refuses non-legacy current **or historical** states; it never remaps them. The old queue backfill rollback now refuses deletion of recorded history. Do not use broad rollback as recovery.

## Run the existing local environment

From the integration repository root, set only the manifest path (not credentials):

```bash
TARGET="$HOME/.local/share/dentalops/fullstack-20261114/target.json"
python3 scripts/local-system.py --target "$TARGET" --profile demo status
```

The profile was provisioned on a newly initialized cluster, not adopted from an existing database. Do not fabricate a manifest for an unknown server. `status` checks the actual server identity, private ownership, source root and pinned migration hashes.

If the cluster is stopped, use `start`. In separate foreground terminals, run these actions with the same target:

```bash
python3 scripts/local-system.py --target "$TARGET" --profile demo start
python3 scripts/local-system.py --target "$TARGET" --profile demo mailbox
python3 scripts/local-system.py --target "$TARGET" --profile demo worker
python3 scripts/local-system.py --target "$TARGET" --profile demo scheduler
python3 scripts/local-system.py --target "$TARGET" --profile demo serve
python3 scripts/local-system.py --target "$TARGET" --profile demo ui
```

Already-running services must not be launched twice. Stop owned foreground services with Ctrl+C before `stop` stops the cluster. No broad process killing or other-worktree cleanup is needed.

- UI: http://127.0.0.1:5195
- API: http://127.0.0.1:8104
- SMTP capture: 127.0.0.1:1026; existing macOS Python 3.9 dev-only SMTP module, no relay.
- Synthetic sign-ins: `owner@example.test`, `staff.reception@example.test`, `dentist@example.test`, `patient@example.test`. The generated password stays in the private runtime's `demo-login-password`; it is not printed or committed.
- Captured `.eml` files are a private development mailbox, not application logs. They may contain single-use verification codes. Do not publish, print, commit or bundle them.

The `local_capture` mailer is enabled only in the isolated local/testing environment, hardcodes loopback, rejects recipients outside `example.test` before sending, and is refused in production. Mail dispatch evidence remains `local`/`logged_only`, never proof of external delivery. Ordinary SMTP/provider reserved-recipient protections are unchanged.

`seed` uses the existing base DatabaseSeeder; `seed-demo` explicitly uses the existing DemoClinicSeeder. Each is demo-only and snapshots first. Historical clinic-seeder records are synthetic fixtures, not evidence that a clinical command occurred; persisted workflow acceptance uses actual HTTP/service tests. Do not re-seed a populated environment without reviewing that seeder's update behavior.

## Migrations, snapshots and recovery

`migrate` verifies the target and exact source hashes, snapshots first and applies only the explicit reviewed paths. It does not mark excluded files executed. The application also fences default migration discovery through Laravel's actual migration event, and prohibits fresh/reset/refresh/rollback/wipe commands in this profile. A Symfony command-event listener alone is insufficient: Laravel omits those events during testing.

`backup` creates a private PostgreSQL custom-format dump. Restore a snapshot into a **new** owned database/cluster and verify identity, ledger, counts and triggers before considering a switch. Retain the original private APP_KEY separately for encrypted-data recovery. Never publish it with a dump. Never overwrite a shared target or disable append-only triggers. The original queue conversion's four failing source-audit assertions remain meaningful holds, not tests to weaken.

One guard-development probe exposed the testing-event gap and ran the held files on the then-empty test database. There were zero patients, appointments, visits, queue entries/history or follow-up tasks. That database was preserved as `dental_clinic_test_guard_probe`, with a private dump. The regular test database was restored to the verified 83-entry snapshot. The demo database was unaffected. Final CLI and command-boundary tests verify refusal in both local and testing environments. Recovery evidence is in the sprint handoff; this incident is not represented as a clean first attempt.

## Tests

```bash
python3 scripts/local-system.py --target "$TARGET" --profile test test tests/Feature/Followups/SelectedFollowupBookingTest.php
python3 scripts/local-system.py --target "$TARGET" --profile test verify-schema
python3 scripts/local-system.py --target "$TARGET" --profile test verify-guard
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -v
```

The test bootstrap independently verifies the actual cluster marker and exact migration ledger. It uses normal test transactions against the preprovisioned schema; it does **not** execute RefreshDatabase's fresh/reset path. A per-database file lock prevents overlapping suites/schema/seed operations. Unreviewed explicit concurrency/reset test files are refused.

`clone-test` restores a schema snapshot into a new private cluster with fresh database credentials and an independent marker/port. Run `concurrency` only with the returned clone manifest. Committed contention fixtures remain there; regular test/demo data are untouched. Back up and stop the clone after verification. The retained R2 worker harness now forwards its already-guarded endpoint instead of hardcoding5432/scratch.

Real browser tests: `tests/local-system.browser.mjs` and `tests/local-registration.browser.mjs`. Set `DENTALOPS_LOCAL_TARGET`, `PLAYWRIGHT_MODULE` to an existing Playwright installation, and optionally `LOCAL_SYSTEM_EVIDENCE` to a private evidence directory. They use actual loopback APIs/PostgreSQL, block external origins, and never log passwords/codes. Synthetic fixture browser suites remain a separate evidence category.

The original `scripts/predefense-check.sh --local-only` performs local checks without contacting SMTP providers, payment providers or tunnels. Omitted external checks are warnings, never passes. Run it under the verified profile environment. Default hosted checks retain their behavior.

## Supported progress and remaining decisions

- Actual persisted booking/auth/replay, visits/queue/treatment, prescription/follow-up/record authorization and supported schedule/branch operations can now be tested locally. The local browser journey covers all roles' sessions, Staff booking/reload/replay, patient ownership, and registration/local-code verification/voluntary sign-in.
- OWN-11 still lacks a full dated Staff roster. Existing Dentist schedules and Staff profile shifts are separate contracts. Original owners remain OWN-11 Joevan/Richmon and STF-07 Jaztin/Celin. Required decisions: who publishes Staff duties, recurrence/exception dates, branch assignment boundaries, revisions/conflicts, and historical/audit semantics. Do not reinterpret a shift request as reassignment.
- GEN-06/DEN-03 original reproductions, broader GEN-09 benchmarks, archival/privacy and handover decisions remain outstanding. Do not infer QA closure from unrelated passing tests.
- Historical queue values remain preserved; STF-14/STF-15's destructive “remove everywhere” wording is not claimed complete. Active FIFO and unsupported Urgent-command refusal are tested.
- External inbox/payment/provider acceptance, PostgreSQL production-version/deployment compatibility and broader concurrency remain separate milestones. AUD-10 also needs trusted deployed capability and durable reload/unknown-outcome recovery before activation.
- No push, deployment, real patient data or external provider dispatch is authorized by this local profile.

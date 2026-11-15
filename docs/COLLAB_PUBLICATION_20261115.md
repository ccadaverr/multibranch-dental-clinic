# Collaboration publication preparation — 2026-11-15

**READY — BLOCKED BY UNVERIFIED HOSTING BRANCH SETTINGS.** This is a local preparation record, not a claim that a GitHub branch has been published. The owner's publication instruction explicitly requires verified absence of an unintended production deployment before pushing.

## Source and Git boundary

- Verified repository: `https://github.com/ccadaverr/multibranch-dental-clinic`, GitHub repository1376182874, public, default branch `main`. Effective origin is the same repository.
- Accepted integration source: `df56fda57c640ea772f4d73417a17275657095de`, parent `820510b74e8131e9f3a130eec063b56b74e2f611`; initially clean registered controlled worktree.
- Accepted visit/settlement `820510b`, isolated full-stack/queue preservation `2b68c76`, controlled QA integration `6c42880` and cumulative corrections are ancestors of this source. Provenance of applied AUD-10 feature deltas remains in the existing integration report; unrelated feature branches are not publication targets.
- `collab/dentalops-qa-20261115` was absent locally and remotely, then created locally at **exactly df56fda** in that same worktree. No duplicate worktree was created. The original integration ref remains at df56fda; other protected refs/worktrees remain intact.
- A meaningful onboarding/development-setup commit on the collaboration branch is a descendant of that exact accepted source. Its actual SHA is obtained from Git and reported at handoff; this file cannot contain its own commit hash. No commit history was rewritten.
- No push, main merge, external deployment, GitHub issue/comment or developer message was sent during blocked preparation. The remote branch must not be presented as available to clone until a successful exact push and remote SHA readback occur.

## Publication security review

Gitleaks8.30.1 was downloaded from its official GitHub release and its release SHA-256 verified. Scans used redacted output and remained private. Newly publishable accepted history:13 commits relative to reachable remote heads. Full reachable accepted history was also scanned, including archive scanning. The raw results were one new-history match and three full-history matches, triaged as:

1. An explicitly synthetic provider credential in `SelectedFollowupBookingTest.php`, with provider traffic mocked/refused.
2. English prose in `docs/M1_PRODUCTION_HARDENING.md`, not a credential assignment.
3. A browser localStorage namespace in `tests/phase4b2-loyalty.test.js`, not an authentication key.

No real credential was identified. An additional exact comparison against actual private development/test keys/passwords found no match across1,994 current/new-history blobs. New setup/docs files passed a separate Gitleaks stdin scan. Private values were never printed. No scanner rule or meaningful test was weakened. This is a bounded scan result, not a guarantee against all possible secrets.

Tracked path inspection found no private `.env`/`.env.testing`, target manifest, pgpass, generated login password, installed vendor/node_modules, database dump or runtime snapshot. Only example environment templates are tracked. New bootstrap credentials, APP_KEY values, PostgreSQL data, snapshots, logs and mailbox remain outside Git in developer-owned private storage. Historic source acceptance reports refer to private evidence paths; those private files are not bundled for publication.

## Exact deployment blocker

Authenticated GitHub metadata inspection returned:

- Repository hooks:0.
- Repository Actions workflows:0; no tracked `.github/workflows` deployment workflow was found.
- Existing environments: `Preview`, `Production`, `diplomatic-enchantment / production`, `wonderful-heart / production`. Their GitHub deployment-branch policy fields were null.
- Deployment history includes Vercel previews and production-labelled environments; GitHub App connections therefore cannot be inferred disconnected merely from zero repository webhooks.
- Checked-in `vercel.json` rewrites `/api`, `/sanctum` and `/broadcasting` to the existing Render backend. `render.yaml` defines a backend but does not establish the current dashboard branch or auto-deploy configuration. No Railway branch configuration is tracked.
- No usable local Vercel/Railway/Render CLI connection store or API credential was available to inspect their current dashboard settings. GitHub deployment records do not prove their present source-branch rules.

**Needed to release the push:** the owner or hosting administrator confirms the actual connected project/service production branches and that `collab/dentalops-qa-20261115` plus both dated developer feature branches cannot trigger production deployment, or confirms the corresponding integrations are disconnected. Any automatic preview must also be confirmed harmless: the current Vercel proxy can reach Render, so calling something Preview is insufficient to establish backend/database isolation. No secrets need to be shared. No hosting settings were changed by this assignment.

A clarification was requested while preparation continued. Silence is not confirmation. Do not substitute an assumption that production uses main, nor a post-push check, for this pre-push gate.

Once the gate is satisfied, recheck origin, clean status, current shared SHA, remote branch conflicts, hooks, latest secret-scan coverage and accepted-source ancestry, then push only:

```bash
git push origin refs/heads/collab/dentalops-qa-20261115:refs/heads/collab/dentalops-qa-20261115
git ls-remote --heads origin refs/heads/collab/dentalops-qa-20261115
```

Compare the full remote SHA with `git rev-parse collab/dentalops-qa-20261115`. If the remote now exists, inspect ancestry and coordinate; never overwrite it or force-push. Verify that no deployment was unexpectedly created. Never publish all branches/tags, merge main or deploy.

## Onboarding and delivery preparation

[TEAM_DEVELOPMENT_SETUP.md](TEAM_DEVELOPMENT_SETUP.md) includes exact clone/fetch/feature commands, locked dependencies, PHP/Node/PostgreSQL requirements, new independent private cluster creation, guarded migrations/seeding, local services, focused/API/browser test entry points, recovery and exact feature pushes.

The existing runbook previously required a privately generated initial manifest. `scripts/provision-local-system.py` closes that setup gap by creating a fresh loopback cluster and independent credentials. It refuses existing/inside-checkout/busy/shared targets; it never adopts a database and runs no migrations or seeders itself. Existing guarded migration/test commands remain the authority. Python POSIX/SMTP-version limitations are explicit. No application module or accepted clinical/financial source behavior changed.

[TEAM_QA_WORKFLOW_20261115.md](TEAM_QA_WORKFLOW_20261115.md) routes all68 original QA IDs exactly once, preserving original ownership/status. Joevan's first backend batch strengthens existing Staff shift revision/retry/persistence and captures the full dated-roster contract's missing decisions. Jaztin's parallel first batch completes actual Doctor-duty/work-hours/leave integration using established APIs. Contract review and a cross-role integration checkpoint precede further shared publication. Subsequent functional batches cover walk-in intake, exact follow-up booking/recovery, queue preservation and entity-specific notification/document/history workflows. AUD-10 activation remains closed.

## New validation for setup changes

This publication task did not rerun the entire system-wide suite. The accepted Sprint03 report remains the full-system baseline, including its inherited OWN-11 failure and four held diagnostics.

- 13 Python boundary tests passed, including five new refusal checks.
- A new owned loopback cluster on55489 was provisioned without adopting or reading the existing clinic/shared server. Independent demo/test databases each reached83 reviewed migration entries; all four held files remained pending.
- Base synthetic seeding passed. Test transactions rolled back to an empty test fixture set.
- Preservation schema guard1 test/9 assertions and privilege/migration guard1/14 passed.
- Fresh-target infrastructure and prescription API checks:11 tests/175 assertions passed.
- Smoke17 groups and production build passed, retaining existing optional OCR/large-chunk/Table-key warnings.
- `scripts/predefense-check.sh --local-only` on the existing verified accepted environment passed required checks with3 existing warnings. No external mail/payment/provider call occurred.
- Markdown links,68-ID uniqueness, syntax, secret scans and `git diff --check` were checked. The new setup cluster was backed up and stopped; the accepted local stack was retained.

Private validation/reference/scan evidence is outside Git. No dump, password, cookie or database connection credential is in this publication record.

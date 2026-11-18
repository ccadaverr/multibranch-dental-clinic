# J09 controlled publication plan — prepared, not executed

This plan does not authorize publication. Review the J09 report, frozen bundle/package checksums, cumulative diff and hosting settings first. A normal feature push may trigger previews: GitHub has historical Preview deployments and hosting filters/webhooks were not fully visible. Local source has zero Actions workflows, but that does not disable Git-integrated hosting.

## Owner review gates

1. Confirm Vercel Preview branch policy and environment API/storage targets. Current vercel.json proxies to an existing hosted Render API. A preview must not exercise A12 or other populated clinical services.
2. Confirm Render/Railway connected branches, deploy hooks and worker/scheduler services do not follow this feature branch. Preserve the offline reviewed migration profile; never set AUTO_MIGRATE=true or execute held migrations.
3. Confirm the exact final SHA from the delivery manifest, source manifest checksums and proposed branch. The existing published Jaztin branch remains at J02. No force push or moving WIP tip is approved by this plan.
4. Review A13 compatibility: retain its chart authorization, prescription author/assignment enforcement and follow-up concurrency fixes. Local regression success is not proof those issues are resolved.

## Local verification and read-only refresh

Run from the Jaztin repository. Replace the package path with the verified controlled-transfer location; these Bash commands read the exact final SHA from that immutable artifact. `PUBLISH_COMMANDS.txt` in the package also contains the literal full-SHA push command generated after the report commit.

```bash
J09_DELIVERY=/private/tmp/jaztin-j09-delivery-20261118
J09_RELEASE_SHA=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["final_j09"])' "$J09_DELIVERY/DELIVERY.json")
J09_RELEASE_BRANCH=feature/jaztin-j08-unslop-20261118
test "$(git branch --show-current)" = "$J09_RELEASE_BRANCH"
test "$(git rev-parse HEAD)" = "$J09_RELEASE_SHA"
test -z "$(git status --porcelain)"
test "$(git remote get-url origin)" = https://github.com/ccadaverr/multibranch-dental-clinic.git
test "$(git remote get-url --push origin)" = https://github.com/ccadaverr/multibranch-dental-clinic.git
git merge-base --is-ancestor 53b0e2e1cea0a1c4db1c498eb80b8fb3e81d77da "$J09_RELEASE_SHA"
git bundle verify "$J09_DELIVERY/jaztin-j03-j09.bundle"
git ls-remote --heads origin main feature/jaztin-fullstack-qa-20261117 "$J09_RELEASE_BRANCH"
git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main refs/heads/feature/jaztin-fullstack-qa-20261117:refs/remotes/origin/feature/jaztin-fullstack-qa-20261117
```

Expected: exact current branch/final SHA, clean tree, correct fetch/push URL, valid bundle with J02 prerequisite, and published older Jaztin branch at J02. Main may have advanced; fetching it does not integrate it. The proposed branch was absent at preflight. If it exists at approval time, stop and inspect/fetch its exact ref; do not overwrite someone else's changes. Stop on any ancestry/checksum/remote mismatch. These read-only checks are not a substitute for the hosting review above.

## Publication — only after separate explicit owner authorization

```bash
git push origin "$J09_RELEASE_SHA:refs/heads/$J09_RELEASE_BRANCH"
J09_REMOTE_SHA=$(git ls-remote --heads origin "refs/heads/$J09_RELEASE_BRANCH" | cut -f1)
test "$J09_REMOTE_SHA" = "$J09_RELEASE_SHA"
```

Expected: one normal new feature-branch publication, or the server's normal non-forced fast-forward acceptance if separately reviewed. No tag push, main merge, PR, history rewrite, deployment command or branch deletion. The literal full-SHA command in the external package avoids accidentally publishing a later tip. If deployment settings cannot be verified safe, retain the frozen source/bundle for controlled transfer and do not run the push.

## Joevan A fetch/review — separate from presentation integration

After approved source publication, Joevan can fetch the exact feature branch without merging it:

```bash
git fetch --no-tags origin refs/heads/feature/jaztin-j08-unslop-20261118:refs/remotes/origin/jaztin-j09-review
git show --no-patch --format=fuller refs/remotes/origin/jaztin-j09-review
git diff --stat 53b0e2e1cea0a1c4db1c498eb80b8fb3e81d77da refs/remotes/origin/jaztin-j09-review
```

Verify the fetched full SHA equals DELIVERY.json. Compare against the actual Windows source; no assumption is made about which prior handoffs have already landed. Preserve A12 and create a separate review branch from Joevan's own frozen current A13 checkpoint:

```text
git switch -c review/a13-with-jaztin-j09 <JOEVAN_FROZEN_A13_SHA>
git apply --check <verified-path-to-j09-only-two-commits.patch>
```

Use the J09-only patch if prior Clinical work is already incorporated. Otherwise review the cumulative J03–J09 patch and its ordered SHAs, with J03 document API/CORS and J04 chart authorization reconciled semantically. Check only one integration lane; do not apply both full cumulative and per-sprint patches. `git apply --check` may identify expected overlap; it does not authorize replacing newer files. Resolve changes on that review branch with A13 controls intact, then run current combined authorization/CAS/idempotency/clinical identity tests, browser workflows, six widths, full frontend, relevant PostgreSQL, smoke and build. Joevan alone chooses integration into his authoritative presentation branch after review.

No local Windows branch name or policy is invented here. Publishing the Jaztin source neither changes presentation acceptance nor permits merging main. DEN-14/STF-21 grants and all migration holds remain in force.

## Recovery

The incremental `jaztin-j03-j09.bundle` contains the complete linear unpublished history and requires the exact published J02 object. It was verified and fetched into a separate local bare verification repository, with the recovered tip/tree checked against the final SHA. Cumulative ZIP sources and all patches have SHA-256 manifests; J03–J08 archives remain unchanged.

To recover in a **new isolated directory**, obtain the existing repository containing J02, verify the bundle, then fetch its feature ref into a new recovery branch. Do not reset/clean an existing working tree or restore over active databases. Recovery does not require workers, migrations or historical jobs. If a publication later needs to be withdrawn, preserve its exact SHA and request a separately authorized owner action; this plan performs no remote deletion or forced rollback.

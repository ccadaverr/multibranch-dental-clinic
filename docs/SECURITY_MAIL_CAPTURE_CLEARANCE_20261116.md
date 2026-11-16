# Security review and isolated mail capture — November16,2026

Starting checkpoint047ce1f76a1e63d0c5f5de6261981d0d9714344c; feature/joevan-qa-20261115;27 commits beyond collaboration baseline. Clean at start. No credential was printed, used to connect, sent externally or rotated. No push, transfer, merge, deployment or history rewrite. This report corrects the earlier narrow placeholder heuristic; it does not claim universal secret absence.

## Redacted historical finding

- Path `.agents/mcp_config.json`, object d062dc45729e44cb500c090026dd70a1409faf19; introduction f4b04f62da2a6dd40655692b75a5f7c13b2ba373. Service: PostgreSQL MCP command argument, loopback host, example development database. Password and database names have explicit `your_…` template markers. The prior check recognized only a small fixed set and incorrectly treated this example as a non-placeholder candidate. **Current classification: apparent example configuration, no actual live secret demonstrated.** Value remains withheld.
- Current tracked file has the identical object, so it is not merely a removed historical occurrence. The example was not replaced with an unsupported environment-interpolation syntax or connected to any database. Actual A application credentials remain in private untracked runtime files, not this example MCP argument.
- Examined348 reachable commits; exactly138 trees reference this object at that path. A metadata-only commit list is retained privately at `dentalops-local-backups/security-scope-20261116.json`. This is the exact-occurrence list, rather than assuming every descendant retains a removed file.
- Introduction is an ancestor of both local feature HEAD and published collaboration baseline a0725e645df6f8266c2bc4bebacc9d62dd18e7c1. Read-only `git ls-remote` confirmed the live collaboration branch still has that SHA; the feature branch is absent. Main reports d972ebd9f20890593ce7c218fe7b28315b3b1221, but its content was not fetched/reviewed; no main clearance claim. Unknown external forks, clones, prior downloads and caches are not enumerated.
- Wider scan examined3,868 reachable text blobs. Exact template text appears in one unique blob/path; no additional private-key, provider-token or literal APP_KEY patterns matched. Binary/encoded/unrecognized secret formats are outside that heuristic. No credential content was included in metadata reports.
- A new **local bare audit repository** imported the existing135619 bundle's feature ref and confirmed the object exists there with `git cat-file -e`. This was local inspection only, not transfer to Jaztin or integration. The original feature branch/index was unchanged.

Owner action: privately review this redacted classification and confirm whether the template was ever replaced/reused as an actual credential in another configuration. Do not send the value in chat. If any actual credential was committed or this literal was used as a password, rotate/revoke the affected account immediately through its authorized administrator, inspect use/access logs and evaluate all published refs/forks/clones. Rotation does not wait for Git-history cleanup. No rotation is justified solely by an unmistakable example value, and no unknown database connection was attempted to determine validity.

History proposal: retain current shared ancestry. A harmless example does not require destructive rewriting. If a real secret is confirmed, first rotate, then agree a separately reviewed history-remediation plan with both developers and repository owner; enumerate branches/tags/PR refs/backups and coordinate all clones before any rewrite. Deleting a current file or adding .gitignore cannot clear old objects. Existing full-history bundles must remain private; encryption protects a transfer channel, not against an embedded active credential.

**Transfer status: withheld during this task.** The finding itself is now classified as a template; broader clearance still requires owner acceptance of scan scope/classification and an approved delivery channel. No inference of hosting safety. After approval, receiver verifies the bundle in a fresh isolated repository, compares full accepted SHA and ancestry, inspects source/contracts, and does not merge or execute the code automatically. Exact verification/import commands are in OPERATIONS_RELEASE_READINESS_20261116.md. No credentials, runtime manifests, captured mail, APP_KEY files or database dumps accompany source.

## Prevention check

`python scripts/check-credential-urls.py` examines tracked working files; `--staged` examines staged file contents and reports only path/line numbers. Non-template PostgreSQL password URLs are rejected, explicit example/environment-reference text is distinguished, and three focused tests verify rejection, template recognition and mixed-file detection. This is a focused guard, not a comprehensive DLP tool or automatic Git hook. Run it alongside broader provider-key/private-key/diff review before commits. Current tracked scan passed. Python bytecode/cache artifacts are now ignored; no already tracked history was removed. The existing example MCP file remains unchanged because no live credential was established.

## Mailpit acceptance (owned non-production only)

Used official image `axllent/mailpit@sha256:aef2aacc11f075ec0fb6874275ee4a421e688e11a96ebb296134d1735c7761ce` after reviewing official Docker, runtime-options and relay documentation at mailpit.axllent.org. No obsolete Python module was installed.

Reproducible creation, only after verifying A's existing container and free loopback ports:

```text
docker start dentalops-joevan-ops-20261115
docker run -d --name dentalops-a-mailpit-20261116 --network container:dentalops-joevan-ops-20261115 --read-only --mount type=volume,source=dentalops-a-mailpit-private-20261116,target=/data -e MP_DATABASE=/data/mailpit.db -e MP_SMTP_BIND_ADDR=127.0.0.1:1026 -e MP_UI_BIND_ADDR=127.0.0.1:8025 -e MP_DISABLE_VERSION_CHECK=true -e MP_MAX_MESSAGES=0 -e MP_QUIET=true axllent/mailpit@sha256:aef2aacc11f075ec0fb6874275ee4a421e688e11a96ebb296134d1735c7761ce
# On later runs reuse/start this exact owned container instead of recreating it.
```

SMTP and API listen only on A's container loopback; inspect confirmed no published ports. A separate capture volume retains the synthetic message. No SMTP relay/release configuration or credentials were supplied; version checking is disabled. No UI was exposed to another machine or used to fetch message links/assets. Existing LocalCaptureTransport restricts recipients to example.test and bounds socket waits at5seconds. Production SMTP and application .env were unchanged.

Actual PostgreSQL/app-to-capture test: a private acceptance script under `/private/roster11b/mailpit_acceptance.php` used the existing confirmed synthetic appointment and exact revision, with a fresh mailpit_acceptance dedupe key. Stopping capture caused a real TransportException and durable retry_scheduled/attempt1. Restarting capture and advancing only that PHP test clock61seconds past the established60-second backoff yielded logged_only/attempt2. A duplicate process call returned null. Mailpit API confirmed exactly one captured message, synthetic recipients only and a nonempty Message-ID. No external delivery was confirmed. The setup initially used an ambiguous unqualified email column in the private fixture query; qualifying users.email corrected the harness, with no application query/clinical modification.

No message body, code, recipient address or historical credential value was printed. A combined orchestration command was rejected by automatic review with the generic reason 'blocked by policy'; separate bounded service and application-test commands succeeded without bypassing the denied command. The actual persisted receipt and capture count, not a unit-test fake, establish SMTP capture/retry behavior. The outbox's established at-least-once ambiguity after a crash following transport acceptance remains; capture is not internet inbox delivery.

## Retained readiness and remaining gates

Did not repeat prior full service/session/worker/GD/database restore drills. Their accepted60-second worker,90-second reservation,600-second claim, scheduler/session and zero-failure local predefense evidence remains historical. Four held migrations, Staff-duty/clinical contracts, workforce QA and production services remain unchanged. New tests:3 credential-URL guard tests; actual capture outage/retry/duplicate scenario and tracked/index scans. Encrypted-object recovery and hosted rollback remain unverified.

Hosting evidence still required: Vercel project production branch/feature preview triggers and effective preview API isolation (current repository rewrites target Render); every connected Render and Railway service/environment branch, auto-deploy/PR-preview/watch/hook exclusions; GitHub installed Apps, Actions/webhooks/deploy hooks. Owner provides dated, secret-free configuration evidence, never tokens or secret values. No push is authorized in this task. Offline transfer is not performed or silently approved by a hosting assumption.

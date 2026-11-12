# QA-ISOLATION-GATE-01 — offline safety foundation

Date: 2026-11-12, Asia/Manila. Evidence timestamps use explicit UTC instants; no clinical clock or environment is changed.

**Candidate: CONDITIONAL for external independent source review. Database provisioning and execution: BLOCKED.**

This is a non-executing library and a read-only source observer. It is not a database runner, a trusted provisioning service, a signer, a runtime attestation service, an approval authority or an enforcement boundary for existing commands. No database-capable operation can be launched by it. Existing Laravel/bootstrap/Artisan/Composer/worker paths are unchanged and remain independently invocable. A future runner must establish and own its boundary before bootstrap; this candidate is not wired into those paths.

## Verified checkpoint and scope

Repository: `https://github.com/ccadaverr/multibranch-dental-clinic.git`.
New branch: `feature/jaztin-qa-isolation-gate-20261112`.
Registered worktree: `/Users/glesielynalcantara/Documents/dentalops-integrated-review/scratch/integration-abc-20261111/scratch/jaztin-qa-isolation-gate-20261112`.
Original/current HEAD: `15d626c03c97baf7198a7b7ca6dea2bec8f60836` (published UX baseline).
Fresh remote backend/shared frontend: `e2654fafb1d30b6e50d3c1e475b2a3c0af227457` / `f4749ddb8ec0a93fe88df9dbf0897579371b9718`.

The baseline contains all needed PHP preflight references, so neither feature merge nor a different parent was necessary. Existing refs, fetch configuration, backend and the five-file uncommitted Clinical UI candidate are preserved. No staging, commit, push, merge, dependency install, service startup, database connection, migration or seeder execution is authorized or performed. Only the seven additions below belong to this task.

| File | Purpose |
| --- | --- |
| `qa/clinic-simulation/preflight.mjs` | Strict offline assessment, fixed refusal boundary and descriptor/source/policy consistency checks; optional observation wrapper. |
| `qa/clinic-simulation/run-manifest.schema.json` | Declarative strict contract for untrusted requests, provisioning declarations, approval declarations and source observations. |
| `qa/clinic-simulation/strict-json.mjs` | Bounded parser rejecting decoded duplicate keys, prototype keys, malformed/oversized/deep JSON; canonical data serialization. |
| `qa/clinic-simulation/schema-validation.mjs` | Small implementation of the exact JSON Schema subset used here; unknown schema vocabulary and external references are unsupported. |
| `qa/clinic-simulation/workspace-snapshot.mjs` | Read-only public-source hashes, complete migration inventory, conservative risk indicators and path/environment/cache metadata. |
| `qa/clinic-simulation/preflight.test.mjs` | Database-free adversarial cases, synthetic filesystem fixtures, non-execution traps and dependency checks. |
| `docs/QA_DATABASE_ISOLATION_GATE_ACCEPTANCE.md` | Design, trust limits, evidence, coverage and handoff. |

Three helpers supplement the four proposed paths to keep JSON parsing, schema mechanics and filesystem observations separately reviewable. No existing source, guard, migration, defaults, bootstrap, package, production configuration or test was modified.

## Plan recorded before implementation

A. Current risk: `Tests\TestCase` calls parent application creation before `ScratchDatabaseGuard`. Existing workers bootstrap their kernels before the guard. Some Feature tests use `RefreshDatabase`, while concurrency tests invoke `migrate:fresh`. Composer scripts and demo/reset/predefense scripts invoke Artisan and/or providers independently. A new standalone module cannot intercept these existing paths.

B. Trust: operator request, provisioner declaration, source observation, runtime identity and technical-lead authorization are separate. None of the JSON issuers/signatures is authenticated in this version. Git checks performed during this assignment do not turn future caller-supplied source metadata into trusted observations.

C. Threats: wrong local/shared target; forged or substituted manifests; stale/backdated evidence; aliases/read/write/direct/URL overrides; cache drift; inherited database/provider secrets; source/migration changes; shell/Composer/worker bypass; traversal/symlinks; cleanup ownership substitution; a caller interpreting structural validity as permission.

D. Validation: strict primitive JSON inputs, bounded duplicate-aware parsing and exact schema; read-only public file hashing and complete ordered migration inventory; comparison of separately declared target/configuration/source/approval/evidence/operation/ownership data. No database, Laravel or external trust resolver is loaded.

E. Refusals: static codes/messages and known schema locations; no supplied values, unknown keys, raw parser excerpts, credentials, request bodies or command text in diagnostics. Unknown fields/options refuse. There is no permissive override.

F. Files: the seven additions above; PHP infrastructure read-only.

G. Tests: all required negative categories plus actual public migration inspection, filesystem escape cases and forbidden-side-effect instrumentation. Consistent synthetic declarations must still return BLOCKED. No test uses PostgreSQL, Docker, PHP, Artisan or an external provider.

## Trust boundary

| Category | Current treatment | What remains missing |
| --- | --- | --- |
| Requested configuration | Operator-supplied untrusted JSON; strict proposed profile and binding checks | Effective configuration inside a fresh approved application process |
| Provisioning evidence | Issuer/reference/run/resource/lifetime declarations; provenance explicitly `unverified-declaration` | Trusted provisioner, independent instance/volume/network identity and credentials origin |
| Source | Migration bytes/path inventory observed read-only; source origin/commit/branch explicitly caller-declared and compared with baseline | Authenticated Git/worktree/build provenance and complete execution-source identity |
| Runtime identity | Always `not-checked` | Separately authorized server/database/role/privilege/isolation/emptiness checks |
| Lead approval | Exact scope declarations checked for consistency; remains unverified | An approved, independently verified authorization mechanism and revocation/lifetime policy |
| Cleanup | Run/resource ownership declarations bound together; `authorized:false` required | Separate authorization for exact disposable resources and teardown |

No trust anchors, signing keys, verification callbacks, approved migration registry, leases, handoff tokens or real infrastructure attestations exist in this implementation. A correctly shaped object, a matching hash or a caller-selected clock never proves disposability. An attacker can forge observation JSON; the result still grants no authority.

The proposed target descriptor is deliberately narrow: testing environment; `pgsql`; `127.0.0.1:5432`; database `dental_clinic_test`; public search path; no URL; one connection alias; no read/write/direct/socket overrides. This is a **proposal**, not an approved endpoint or inference that the name is safe. Existing PHP configuration still uses `dental_clinic_scratch` and multiple connection definitions. Do not repoint anything or bypass an existing guard to match this proposal. Endpoint/profile reconciliation requires separate review.

## Public interface and result

`assessOffline(manifestJson, snapshotJson, nowIso?)` accepts serialized data only. No executable objects, callbacks, arbitrary schemas, credentials or execution options. Extra positional arguments are refused. `nowIso` is a deterministic observation clock for offline comparisons; an untrusted caller can backdate it. It is not a trusted authorization clock.

Every result has:

```json
{
  "status": "BLOCKED",
  "executionAllowed": false,
  "provisioningAllowed": false,
  "checks": {"descriptorValid": false, "snapshotValid": false, "consistent": false},
  "trust": {"sourceIdentity": "declared-only", "provisioning": "unverified", "approval": "unverified", "runtime": "not-checked"},
  "refusals": []
}
```

The example shows the fixed result shape only: actual results always include permanent boundary refusals, and may include specific input/policy refusals. Shape/consistency booleans can become true for synthetic internally consistent data. **No boolean is execution permission.** Results are recursively frozen to reduce accidental mutation, not to defend against hostile JavaScript running in the same process.

Permanent refusals preserve source-identity uncertainty, unverified provisioning/approval, absence of approved schema policy, missing runtime identity, missing execution-boundary integration and lack of execution capability. There is no `execute`, `run`, dispatch callback, command builder or approval-token API.

Direct `node qa/clinic-simulation/preflight.mjs`, with or without `--force` or other arguments, emits only a fixed BLOCKED message and exits 2. It does not parse a command or act as a runner.

`inspectWorkspace(root, inspectionJson)` optionally observes public source using Node filesystem reads. It returns a frozen observation or refusal with both permission fields false. Its root must be absolute and canonical. Paths are bounded relative paths without traversal, encoding, backslashes or symlinks. Only migration files and explicitly allowed PHP test/support/seeder artifacts are read; QA resource paths are inspected without deletion. `.env` files and configuration-cache files are checked for presence only, never opened. Ambient environment variable **names only** are inspected for database/provider/preload/sensitive overrides; values are never read or logged.

The observer does not read Git internals, contact a server, evaluate/include PHP, load Laravel, fetch schemas, initialize providers or write files. Read descriptors cannot supply executable callbacks or relax path checks.

## Policy and integrity checks

- Exact request/observation source identity; baseline commit pin; exact workspace/target/configuration declarations.
- One proposed SQL alias only; URLs, alternate drivers, aliases, read/write splits and unknown options rejected by schema.
- Missing/invalid/expired evidence, duplicate evidence identities and approval/operator/lane/target/resource mismatches refused.
- Normalized UTC calendar timestamps; no future issuance; provisioning declaration lifetime at most 15 minutes; lead/schema declarations at most 30 minutes; source observation age at most five minutes. These are offline technical limits, not an approved runtime policy.
- Explicit operation catalog: feature tests, full migration manifest, schema reset, reference seeder, contention worker and outbox worker. These are **descriptor categories**, not runnable commands. Category/lane/artifact/capability bindings are checked. Raw commands/argv, Composer, predefense, direct migration invocation and arbitrary scheduler commands are unsupported.
- Feature source mentioning schema reset cannot be described as an ordinary workflow lane. Capability indicators are conservative whole-file text checks, not a complete transitive PHP capability analysis. Future source review remains necessary.
- Application credential declarations must deny superuser, role/database creation, RLS bypass, protected-table ownership and DDL. The separate schema-owner declaration permits DDL/ownership only in the schema lane. No role is created or inspected. A declaration is not proof of privileges.
- Cleanup owner/run/resource identity must agree; cleanup authorization cannot be set true.
- Path observations must cover exactly the requested resources/artifacts with matching canonical relative paths.

## Migration blocker preserved

Observed baseline: **86 migration files**. Ordered path/content SHA-256 digest:

`f565b8e643f41787575f8d54c0be5d0c33b81aeaa35f4844b4527c5ba13ee1ff`

The digest is SHA-256 of canonical JSON for the ordered `{path,sha256}` entries. Risk flags are compared independently against observations; they are not safety certificates.

Content-addressed holds include:

| Migration | Hold |
| --- | --- |
| `2026_11_16_000500_update_queue_statuses_and_remove_urgent_priority.php` | Incompatible conversion order, unsupported command sources, collapsed states, erased reasons and no lossless journal |
| `2026_11_10_000100_remove_patient_feedback_table.php` | Destructive feedback removal/provenance changes |
| `2026_11_15_000400_backfill_tooth_chart_branch.php` | Append-only trigger bypass/backfill |
| `2026_11_15_000500_add_critical_foreign_key_and_analytics_indexes.php` | Non-transactional concurrent index creation |

Full inventory, unique paths, exact order, file hashes, source commit, digest and risk metadata must agree. Renaming held content retains its hold. Any added, omitted, reordered, modified or rehashed chain is not admitted by simply supplying a new manifest. There is **no approved schema registry**, even for the pinned chain. A caller's `decision:approved`/`reviewed-per-file` declaration cannot remove this block. No migration is skipped, executed, changed or marked applied.

The old queue backfill rollback and other rollback trigger changes remain hazards outside this module. Filename/risk pattern scanning alone is insufficient semantic migration review. A future approved policy must review the actual whole chain and operational semantics.

## Testing and evidence

Node: **22.19.0**, existing installation. No dependencies installed. Evidence directory: `/private/tmp/qa-isolation-gate-6wrfyqnr/`.

Focused command actually executed (substitute the exact reviewed checkout/output roots only):

```bash
QA_ISOLATION_TEST_TMP=/private/tmp/qa-isolation-gate-6wrfyqnr node --permission --allow-fs-read=/Users/glesielynalcantara/Documents/dentalops-integrated-review/scratch/integration-abc-20261111/scratch/jaztin-qa-isolation-gate-20261112 --allow-fs-read=/private/tmp/qa-isolation-gate-6wrfyqnr --allow-fs-write=/private/tmp/qa-isolation-gate-6wrfyqnr --test --experimental-test-isolation=none qa/clinic-simulation/preflight.test.mjs
```

The directory is allocated outside source before testing. Tests retain all synthetic fixtures and symlinks; no cleanup/deletion occurs. Node child-process, worker/addon permissions are not granted. Test isolation is `none`, so the test runner does not spawn test-file child processes. Write permission is limited to the explicitly allocated evidence directory, not Git or repository paths. This permission model does not establish network isolation; runtime traps and a production dependency-closure review separately challenge network/process behavior.

| Check | Evidence/result |
| --- | --- |
| Focused database-free suite | **144 passed, zero failed/skipped**; `focused-accepted.tap` |
| Direct invocation with `--force` under read-only permissions | Exit 2, fixed BLOCKED line; `direct-invocation.log` |
| Module/test syntax | `node --check` passed for all five `.mjs` files; `integrity-final.json` |
| Whitespace, including untracked additions | `git diff --check` and explicit no-index checks passed for all seven additions; `integrity-final.json` |
| Credential patterns, dependency/dispatch checks, exact scope | No real credential candidates or production dispatch imports; integrity evidence |
| Implementing-session source challenge | Read-only pass after implementation; not external independent sign-off |

Coverage of the requested matrix:

| Cases | Executed boundary |
| --- | --- |
| 1–10: target/source/provisioning | Missing identities/target/provenance, wrong name/host, expiry, SHA/digest/profile mismatches, complete current migration inventory |
| 11–19: configuration drift | Aliases, URLs, read/write/direct/socket overrides, cache state/provenance, inherited credentials/preload/provider names, private environment files and empty values |
| 20–27: commands | Typed category/lane checks, reset-capable source, seeder/worker lanes, raw `migrate:fresh`, Composer/predefense/direct migration/scheduler descriptors; no dispatcher |
| 28–39: evidence integrity | Missing/expired/mismatched approval, unknown flags, duplicate/escaped JSON keys, conflicting identities, actual traversal and root/ancestor/leaf symlink fixtures, ownership and migration review declarations |
| 40–48: non-execution | Network/process/destructive-FS traps, read-only public PHP hashing without include, diagnostic sentinels, protected write permissions, no cleanup, repeated consistent results still BLOCKED |

Additional cases include trailing LF/CRLF identifiers, nonregular files, bounded parser depth/size, 100 deterministic malformed-target mutations, fake clock backdating, renamed held content, fully rehashed changes, all six internally consistent operation categories and absence of a lease/token/handoff API. Tests use synthetic claims; no structurally valid fixture is represented as real infrastructure.

Initial diagnostic runs are preserved: the first exposed two test-harness expectation/mock errors; a later run exposed one expected-code mismatch for replacing an existing field with an invalid type. Assertions were corrected to distinguish stronger duplicate/type refusal from unknown-field refusal; no production validation was relaxed to satisfy them.

NOT EXECUTED: Laravel/PHP tests, database Feature suites, contention workers, migrations, seeders, Docker/PostgreSQL, frontend suites/smoke/build, Composer scripts and `scripts/predefense-check.sh`. They are unnecessary or outside this strictly offline scope; predefense boots `artisan demo:check`. Historical backend/frontend results are not claimed as this assignment's execution.

## Adversarial source challenge and limits

- No operator-controlled manifest authenticates a provisioner, issuer or approval. No signing mechanism is invented.
- Inspection JSON can be forged by the caller; public hashes prove only the bytes that the observer read, not infrastructure ownership or a complete Git/build identity. Source metadata is explicitly declared-only.
- The baseline pin is a review checkpoint, not an approved database schema. Any future source/profile change requires new review.
- File checks use canonical paths, ancestor/leaf symlink rejection, read-only/no-follow/nonblocking opens, regular-file checks and post-read metadata checks. They are not atomic against hostile concurrent filesystem replacement/ABA. A future runner needs controlled immutable source/resources and OS-level isolation; no execution lease is produced here.
- Object/schema comparisons cannot observe hidden application managers, alternate direct PDO/network connections, cached state inside a future process, changes restored between observations, different workers or later deployment changes.
- Caller-supplied times can be backdated. Freshness checks are deterministic consistency checks, not authenticated revocation or trusted-clock verification.
- Same-process hostile JavaScript, modified validator code/schema or a malicious OS is outside this library's trust boundary. Recursive freezing is an accidental-mutation safeguard only.
- Existing scripts/tests can bypass the library by never calling it. No existing command is made safe or blocked globally by these additions.
- No full runtime circuit breaker, disposable instance, role verification, schema safety, application activation or PostgreSQL acceptance is established.

## UX/backend laws and ethics

Read installed `ux-backend-laws/SKILL.md` and `references/laws.md`.

| Principle | Concrete application | Observable evidence/limit |
| --- | --- | --- |
| Postel's Law | Validate security-relevant fields strictly; reject unknown overrides and ambiguous commands | Duplicate-aware parser, strict schema, exact bindings and negative tests; no claim that permissive target handling is safe |
| Tesler's Law | Collect safety comparisons in one future-boundary foundation rather than operator memory | One assessment contract with stable refusal categories; real execution-boundary wiring remains unimplemented |
| Conway's Law | Separate provisioning declarations, source observation, runtime identity and lead approval | Distinct contracts and permanent trust refusals; no invented signing or provisioning owner |

Circuit-breaker-style refusal is only an analogy here, not an implemented runtime circuit breaker. No clinical screen psychology is applied. Ethics: no misleading GO, fake trust badge, inferred disposability, invented clinic rule, hidden execution, secret diagnostic or automatic cleanup.

## BPA handoff

Future approved trigger: a QA operator requests one explicitly authorized lane for a specific run/source/schema. Inputs are the request, independently obtained provisioning/source evidence, approval and later runtime identity. Automated offline decisions produce specific refusals or consistency findings. Human lead/provisioning responsibilities remain explicit. Refusal data can later support sanitized audit records, but this module writes no audit or run state.

Current stop: **BLOCKED** before application bootstrap or command handoff. A future runner must authenticate provenance/approval, establish immutable source and process/network/credential isolation, perform separately authorized runtime checks, revalidate at its real execution boundary, enforce lane-specific cleanup ownership and record actual outcomes. There is no current controlled-execution handoff to call.

## Remaining gates and next recommendation

Unsafe queue migration; unapproved disposable infrastructure; missing runtime identity/privilege checks; conflicting PHP testing profile; unexecuted 25 AUD-10 workflow cases and five contention scenarios; broader clinical/financial acceptance; 17 inherited frontend failures and HMO smoke failure; clinical activation/reload recovery all remain unresolved.

DONE: correct isolated baseline, offline contract/observer, strict refusals, migration holds and database-free tests. IN PROGRESS: external source review only after handoff. REMAINING: independent review, trusted evidence/approval/profile design, migration preservation decision, separately approved provisioning, runtime runner/lane integration, database acceptance and simulation. OPEN ISSUES: the trust/runtime limits above.

Next smallest assignment: external read-only source review of this gate and its non-execution boundary. Then review the source/provisioner/approval provenance contract and profile reconciliation. Do not introduce a runner, connect or provision merely because these tests pass.

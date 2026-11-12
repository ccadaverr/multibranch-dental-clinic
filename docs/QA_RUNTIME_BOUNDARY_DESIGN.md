# Runtime QA contracts — implemented offline milestone

2026-11-12, Asia/Manila. Comparison timestamps are explicit UTC instants; no clinical clock changes.

**Candidate: ready for independent source review, with runtime execution and provisioning BLOCKED.**

This implements request, development-policy, provisioning, approval, runtime-observation and proposed lifecycle contracts. It does not implement a controller, infrastructure authentication, database verification, process launch, state persistence, an execution lease or teardown. The published offline gate remains unchanged.

## Source checkpoint and exact scope

Repository: `https://github.com/ccadaverr/multibranch-dental-clinic.git`.
Branch: `feature/jaztin-qa-runtime-contracts-20261112`.
Parent/current HEAD: `431ce91805d546913dcf18cdb9e78b4af0010a8d` (published offline gate).
The underlying application/migration review checkpoint remains `15d626c03c97baf7198a7b7ca6dea2bec8f60836`; this pin is not an approved executable schema. AUD-10 and queue decision branches are not merged here.

Four additions only:

| File | Actual responsibility |
| --- | --- |
| `qa/runtime-boundary/contracts.mjs` | Two exported offline assessments; fixed-shape validation, identity comparisons and proposed lifecycle checks |
| `qa/runtime-boundary/policy.json` | Untrusted development vocabulary, mandatory constraints, baseline migration identity and unconfigured external installation |
| `qa/runtime-boundary/contracts.test.mjs` | Deterministic production-API, parser, lifecycle, source-integrity and non-execution regressions |
| `docs/QA_RUNTIME_BOUNDARY_DESIGN.md` | Implementation contract, evidence, limitations and future integration |

No helper or dependency was added. No application source, existing QA implementation, migration, environment, CI definition or Clinical UI file was changed. No staging, commit, publication or deployment is included.

## Public API

```js
assessPolicy(policyJson)
assessRuntimeContracts(bundleJson, policyJson, nowIso)
```

Both functions are named exports from `contracts.mjs`. Input documents must be primitive serialized JSON strings. Arity is exact; extra arguments, executable objects, callbacks, schemas, trust adapters and overrides are refused. `nowIso` is mandatory for runtime-contract comparison and remains caller-supplied, untrusted time.

Both functions always return a recursively frozen assessment:

```json
{
  "status": "BLOCKED",
  "executionAllowed": false,
  "provisioningAllowed": false,
  "checks": {
    "structures": {"policy": true, "request": true, "provisioning": null, "approval": null, "runtime": null, "transition": null},
    "consistent": true,
    "transitionPlausible": null
  },
  "trust": {
    "policy": "unauthenticated", "source": "declared-only",
    "provisioning": "unauthenticated", "approval": "unauthenticated",
    "runtime": "unverified", "replay": "unverified", "clock": "caller-supplied"
  },
  "refusals": [{"code": "OFFLINE_ONLY", "location": "", "stage": "boundary", "message": "Offline contracts cannot launch operations or grant execution or provisioning permission."}]
}
```

This is an abbreviated example: actual results include **all twelve permanent boundary refusals**, plus any input/comparison failures. Structure checks are `null` when that contract is absent/not assessed, `false` when its structure fails, or `true` for a well-shaped declaration. Policy pin comparisons and other semantic failures are separate from structure.

`consistent` means no structural/comparison failure was found. `transitionPlausible` is `null` without an assessed transition and can be `true` only when the graph, revisions and all assessed comparisons agree. Neither boolean authenticates evidence or permits an operation. The module returns no next state, credential, lease, token or executable handle.

## Working synthetic input example

Run from the repository root in a separately permitted offline Node context. These hashes are deliberately synthetic declarations, not approved builds or images:

```js
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {assessRuntimeContracts} from './qa/runtime-boundary/contracts.mjs'
import {canonicalJson, parseStrictJson} from './qa/clinic-simulation/strict-json.mjs'

const policyText = readFileSync('qa/runtime-boundary/policy.json', 'utf8')
const policy = parseStrictJson(policyText)
const synthetic = 'a'.repeat(64)
const request = {
  version: 1, requestId: 'qa-request-example', runId: 'qa-run-example',
  source: {
    repository: policy.source.repository, commit: policy.source.reviewedCommit,
    dependencyLockDigest: synthetic, buildDigest: synthetic, controllerDigest: synthetic,
  },
  policy: {...policy.identity, digest: createHash('sha256').update(canonicalJson(policy)).digest('hex')},
  migration: {
    id: policy.migrations.id, sourceCommit: policy.migrations.sourceCommit,
    count: policy.migrations.count, orderedDigest: policy.migrations.orderedDigest,
  },
  operation: {
    category: 'assess-request', lane: 'offline', phase: 'assessment',
    scopes: ['source-observation'], artifactDigest: synthetic,
  },
  resources: {
    generation: 1, ownerRunId: 'qa-run-example', instanceId: null, containerId: null,
    volumeId: null, networkId: null, imageDigest: 'sha256:' + synthetic,
  },
  issuedAt: '2026-11-12T04:00:00Z', expiresAt: '2026-11-12T04:05:00Z',
}
const result = assessRuntimeContracts(JSON.stringify({
  request, provisioning: null, approval: null, runtime: null, transition: null,
}), policyText, '2026-11-12T04:00:00Z')
// result.checks.consistent === true; result.executionAllowed === false.
```

The module itself does not load policy from disk. Its production dependency closure is the published strict parser/canonicalizer and Node crypto/path/URL builtins. Import performs no application I/O. Direct CLI invocation, including `--force`, prints a fixed refusal and exits 2; there is no CLI dispatcher or runner.

## Fixed contract shapes

All fields in the following records are required; unknown properties are refused recursively. No arbitrary schema document is accepted. Full synthetic evidence fixtures are in `contracts.test.mjs` and exercise the real exported functions.

| Record | Fields and comparisons |
| --- | --- |
| Bundle | `request`, `provisioning`, `approval`, `runtime`, `transition`; last four may be `null` |
| Request | `version`, `requestId`, `runId`, `source`, `policy`, `migration`, `operation`, `resources`, `issuedAt`, `expiresAt` |
| Source | `repository`, `commit`, `dependencyLockDigest`, `buildDigest`, `controllerDigest`; repository/commit pinned, build digests only structurally checked and cross-bound because approved values are unconfigured |
| Policy reference | `id`, `revision`, `digest`; SHA-256 of canonical JSON for the complete supplied policy, not a signature |
| Migration reference | `id`, `sourceCommit`, `count`, `orderedDigest`; exact held baseline required |
| Operation | `category`, `lane`, `phase`, `scopes`, `artifactDigest`; exact planned scope and cross-bound artifact digest; no commands, paths or argv |
| Resources | `generation`, `ownerRunId`, `instanceId`, `containerId`, `volumeId`, `networkId`, `imageDigest`; owner equals run, resource IDs distinct, generation positive integer; resource IDs must all be null before allocation and non-null thereafter |
| Provisioning | `receiptId`, `authorityId`, `runId`, `source`, `policy`, `migration`, `resources`, `credentials`, `issuedAt`, `expiresAt`; resources/source/policy/migration equal request; credentials contain distinct `applicationRef`, `schemaRef`, `verifierRef` identifiers only |
| Approval | `approvalId`, `authorityId`, `requestId`, `runId`, `source`, `policy`, `migration`, `operation`, `resources`, `expectedGeneration`, `provisioningReceiptId`, `credentialRole`, `nonce`, `revoked`, `used`, `issuedAt`, `expiresAt`; exact bindings, expected role and lifetime coverage required |
| Runtime | `evidenceId`, `authorityId`, `runId`, `source`, `policy`, `migration`, `resources`, `provisioningReceiptId`, `observedAt`, `identity`, `checks`; exact bindings and credential reference required |
| Runtime identity | `systemIdentifier` as a positive decimal uint64 string, integer `serverVersionNum`, fixed `databaseName: dental_clinic_test`, `roleRef`, `tlsPeerDigest`; these values do not prove instance identity or version compatibility |
| Runtime checks | Boolean `privateNetwork`, `ownedFreshVolume`, `privilegesMatch`, `configurationMatches`, `sourceImmutable`, `schemaMatches` must be declared true; `unexpectedContent` false. These remain unverified claims |
| Transition | `transitionId`, `runId`, `expectedGeneration`, `from`, `to`, `expectedRevision`, `nextRevision`, `previousTransitionId`, `seenTransitionIds`, `seenApprovalIds`, `revokedApprovalIds`, `cleanup` |
| Cleanup | Null outside teardown; teardown requires exact `ownerRunId` and all four `resourceIds`, with no additional resource or arbitrary path |

Provisioning and approval authority identifiers must be distinct. Receipt, approval and runtime evidence identifiers must be distinct. These checks detect contradictions, not real separation of authority. Allocation approval binds the request/generation with null resources/receipt; it cannot pretend that resources already exist.

IDs use bounded ASCII identifiers; run IDs require the `qa-run-` prefix. SHA-1 commit and SHA-256 fields require exact lowercase hexadecimal lengths; image digests require `sha256:` plus 64 lowercase hexadecimal characters. Every unquoted numeric token must now use canonical nonnegative decimal integer notation (`0|[1-9][0-9]*`) and fit the exact safe-integer range **before** Number conversion; existing field-specific limits still apply. Negative values, negative zero, fractional notation and exponent notation are refused. The correction and complete numeric inventory are documented below. Canonical timestamps are real UTC calendar instants in `YYYY-MM-DDTHH:mm:ssZ` form. Fractional seconds, local timestamps and offset variants are unsupported in v1.

Hard comparison bounds are 3,600 seconds per request, 1,800 per approval, 900 per provisioning receipt and 300 for runtime-observation freshness. They are development contract ceilings, not approval lifetimes. Approval cannot predate its request or expire before the requested phase deadline. Runtime observation cannot predate the receipt. Boundary refusals persist even when a caller backdates the comparison clock.

## Proposed lifecycle graph, never executed

| Category | Lane / phase | Declared edge | Exact scopes / credential class |
| --- | --- | --- | --- |
| `assess-request` | offline / assessment | requested → assessed | source-observation / none |
| `allocate-instance` | infrastructure / allocation | assessed → allocated | resource-create / infrastructure |
| `verify-instance` | infrastructure / verification | allocated → identity-verified | identity-read / verifier |
| `initialize-schema` | schema / schema | identity-verified → schema-initialized | schema-ddl / schema-owner |
| `transactional-feature-tests` | transactional / execution | schema-initialized → execution-finished | database-dml / application |
| `committed-contention-tests` | contention / execution | schema-initialized → execution-finished | database-dml, bounded-workers / application |
| `synthetic-simulation` | simulation / execution | schema-initialized → execution-finished | database-dml, bounded-workers / application |
| `browser-qa` | browser / execution | schema-initialized → execution-finished | database-dml, private-http, bounded-workers / application |
| `fence-run` | infrastructure / containment | allocated, identity-verified, schema-initialized or execution-finished → fenced | process-stop, credential-revoke / infrastructure |
| `teardown-run` | teardown / teardown | fenced → torn-down | resource-delete / infrastructure |

Assessment needs no provisioning/approval/runtime declaration. Allocation needs approval. All later categories need provisioning and approval; verification, schema and execution also need runtime observations to support their proposed state recording. Infrastructure verification itself must eventually receive separate controller approval before collecting observations; this library neither connects nor performs that action.

A proposed transition must retain run/generation, increment revision exactly once and retain a predecessor except at revision zero (`requested`). Known consumed/revoked approvals and repeated transition IDs refuse. The three history lists are caller declarations, not a complete ledger. The module is stateless: repeating a forged unused approval with empty lists remains blocked, rather than magically detecting real reuse. A future controller must verify approval IDs/nonces, revocation, predecessor state and generation against durable authenticated state.

Containment does not require favorable runtime claims; an uncertain owned run may need fencing. Teardown still requires exact ownership and scoped approval. No failure path automatically deletes resources, rolls back schema or infers ownership from a name.

## Refusal and diagnostic contract

Permanent `boundary` codes on every assessment:

`OFFLINE_ONLY`, `POLICY_UNAUTHENTICATED`, `SOURCE_UNAUTHENTICATED`, `PROVISIONER_UNAUTHENTICATED`, `APPROVAL_UNAUTHENTICATED`, `RUNTIME_UNVERIFIED`, `REPLAY_LEDGER_REQUIRED`, `TRUSTED_CLOCK_REQUIRED`, `CONTROLLER_UNIMPLEMENTED`, `INSTALLATION_UNCONFIGURED`, `BUILD_POLICY_UNCONFIGURED`, `MIGRATION_CHAIN_HELD`.

Additional codes, grouped by actual behavior:

| Group | Codes |
| --- | --- |
| Input/shape | `INVALID_JSON_INPUT`, `INVALID_INTEGER_TOKEN`, `MALFORMED_JSON`, `JSON_LIMIT_EXCEEDED`, `DUPLICATE_JSON_KEY`, `UNSUPPORTED_FIELD`, `UNKNOWN_FIELD`, `MISSING_FIELD`, `INVALID_VALUE`, `DUPLICATE_VALUE`, `UNSUPPORTED_ARGUMENTS`, `INVALID_CLOCK`, `ASSESSMENT_FAILED` |
| Policy/source/migrations | `POLICY_MISMATCH`, `SOURCE_MISMATCH`, `MIGRATION_MISMATCH`, `MIGRATION_HOLD_MISMATCH` |
| Operation/ownership | `OPERATION_UNKNOWN`, `OPERATION_DENIED`, `OPERATION_SCOPE_MISMATCH`, `OWNERSHIP_MISMATCH`, `AUTHORITY_CONFLICT`, `RESOURCE_PHASE_MISMATCH` |
| Evidence | `PROVISIONING_BINDING_MISMATCH`, `APPROVAL_BINDING_MISMATCH`, `RUNTIME_BINDING_MISMATCH`, `RUNTIME_CHECK_FAILED`, `EVIDENCE_REQUIRED`, `INVALID_LIFETIME`, `STALE_EVIDENCE` |
| Lifecycle/replay | `APPROVAL_REPLAY_DECLARED`, `APPROVAL_REVOKED_DECLARED`, `TRANSITION_BINDING_MISMATCH`, `ILLEGAL_TRANSITION`, `REVISION_MISMATCH`, `TRANSITION_REPLAY_DECLARED`, `TEARDOWN_SCOPE_MISMATCH` |

Refusals use fixed messages and known contract locations, with stages `structure`, `consistency` or `boundary`. No supplied values, unknown property names, raw parser excerpts, exception messages, passwords, environment values or patient payloads are returned. Results contain at most 64 unique code/location pairs; diagnostics can be truncated without removing permanent refusal or turning consistency true. Do not treat code order or a complete error listing as an authorization protocol.

The reused parser bounds each document to 1 MiB, depth 24 and 25,000 nodes; rejects decoded-equivalent duplicate keys, malformed Unicode/JSON, nonfinite numbers and prototype-related keys. New fixed-shape validators reject unknown fields and unsupported schema constructs. The old schema helper is **not imported or expanded**: its documented boolean-schema and `$ref` sibling limitations remain a follow-up before broader reuse.

## Development policy and migration holds

`policy.json` is deliberately `development-untrusted`, with both permission flags false. It contains vocabulary and mandatory constraints, not an approved infrastructure installation. All host/controller/provisioner/approver/image/profile identities and approved build digests remain **null/unconfigured**. Fabricated configured values fail this fixed v1 contract. A future authenticated runtime policy needs separate review/versioning and installation outside the application checkout; no supplied signature or authority flag upgrades this policy.

The full 86-migration ordered digest remains:

`f565b8e643f41787575f8d54c0be5d0c33b81aeaa35f4844b4527c5ba13ee1ff`

The four exact path/content holds are in policy and independently pinned in code:

- Queue status/priority conversion: preserve all five operational states, Served-at-treatment-start meaning and historical Urgent reasons; no approved conversion or recovery exists.
- Feedback deletion: historical feedback and follow-up provenance remain held.
- Tooth-chart backfill: protected-history trigger changes/provenance remain held.
- Concurrent critical indexes: nontransactional initialization and partial failure remain held.

Removing, renaming or changing a hold refuses. Matching migration count/digest is only a comparison of declarations; this module reads no migration source. Tests independently hash the actual held bytes and the unchanged offline suite checks the full inventory. No chain is approved, migration skipped or ledger entry fabricated. Empty-database success cannot clear a hold. Queue applied/unapplied/partial/mismatched/lost-original cohorts still require trustworthy evidence and separate remediation decisions.

## Future controller integration and trust limits

The future external controller must obtain immutable source/build provenance, administrator-installed policy, actual engine resource creation records, private-network containment, per-run credentials, effective pre-provider Laravel configuration, PostgreSQL identity/privileges and separate scoped approval. Use these contracts for refusal/consistency diagnostics only. It must never map `consistent` or `transitionPlausible` to permission or add an override callback to these functions.

Controller state must own generation/revision/replay transitions atomically. Validate observed resources against protected ledger records, not uploaded JSON. Retain the same immutable source/resource generation between verification and execution; drift requires fencing. Application DML, schema initialization, committed contention and browser processes need separate reviewed capabilities. Existing host-level Artisan/Composer/PHPUnit scripts remain outside enforcement; this milestone does not make them safe.

No database endpoint, PostgreSQL version profile, authentic approver, disposable instance, network firewall, role grant, runtime observer or source observer is created here. Matching decimal system IDs, image hashes, resource names, TLS fingerprints or `checks: true` declarations establish none of those facts. Same-process malicious code, modified module code or a compromised OS is outside this pure library's boundary. Recursive freezing prevents accidental mutation, not a hostile host.

Postel's security caveat: refuse ambiguous/unknown integrity-critical evidence. Tesler: centralize comparisons instead of operator memory. Conway: distinguish policy, infrastructure, runtime and independent QA ownership. No clinic policy, permission, automated triage or product-module status is changed.

BPA implemented: serialized QA request/evidence → deterministic offline contract checks → sanitized blocked assessment. Planned: authenticated request → provisioner → runtime isolation/identity → scoped approval → bounded execution → audit → owned teardown. Proposed stages are not claimed implemented.

## Regression evidence and execution boundary

Node **22.19.0**, no dependencies installed. Evidence (temporary, not committed):

`/private/var/folders/r3/d09_14x17h91r2nd70qvhdsc0000gn/T/qa-runtime-contracts-bxz8ls0b/`

| Initial milestone check (historical; correction results below) | Actual result / evidence |
| --- | --- |
| New focused suite | **124 passed**, zero failed/skipped; `focused-final.tap` |
| Exhaustive graph check within focused suite | **640 pairs: 13 legal declarations, 627 illegal edges**; every outcome BLOCKED |
| Unchanged offline-gate suite | **144 passed**, zero failed/skipped; `offline-gate.tap` |
| Separate implementation-session challenge | **27 checks passed**, including 200 deterministic malformed-generation cases; `independent-challenge.mjs`, `independent-results.json`; not an external independent review |
| Static/CLI/example checks | Two new `.mjs` syntax checks, four direct CLI variants refusing with exit 2, four explicit untracked-file whitespace checks and the working documentation example passed; `static-checks-final.json` |
| Diagnostic/source scan | Zero conflict markers or recognized credential-pattern candidates; synthetic sentinels are intentional. Pattern matching is not proof that arbitrary secrets cannot exist |

Focused command, actually executed from this worktree with an empty inherited environment:

```bash
qa_contract_node=$(command -v node)
env -i PATH=/usr/bin:/bin "$qa_contract_node" --permission \
  --allow-fs-read="$PWD" --test --experimental-test-isolation=none \
  qa/runtime-boundary/contracts.test.mjs
```

The actual run redirects TAP into the evidence directory using the invoking shell. Node has no filesystem-write, child-process, worker or addon permission. Test isolation `none` prevents test-file subprocess launches. Node's permission model here is not a network firewall: inspected import closure and runtime network/process/write traps separately exercise non-execution. The new suite writes no fixtures. The unchanged old suite was separately granted writes only under `/private/tmp/qa-isolation-gate-runtime-regression-ibwqgaz8/` for synthetic filesystem fixtures; no cleanup is performed.

Initial evidence is retained: `initial-red.tap` shows the expected absent-module failure before implementation. `focused-first.tap` had 112/114 passing, with a stale-observation fixture that actually predated its receipt and an overbroad read-open trap that blocked ESM loading. Tests were corrected to isolate stale evidence and permit read-only loader opens; no production control was weakened. `focused-second.tap` passed 122 tests before authority/identifier checks were added. The temporary standalone challenge initially encountered a Node permission refusal for the `/var` symlink; its successful run used the canonical `/private/var` path, without broadening access.

Source hashes, exact scope, protected-worktree/configuration comparisons and final status are recorded in `integrity-final.json`. Initial static scanning treated Git's normal `--no-index` added-file difference exit (1 with no whitespace diagnostics) as a harness failure; `static-checks-final.json` records the corrected interpretation. Historical project test reports are not claimed as current execution.

NOT EXECUTED: PostgreSQL, Docker, Laravel/bootstrap, Artisan, Composer scripts, database-backed PHPUnit, migrations, seeders, workers, provider requests, browser backend processes, broad frontend suites/build and predefense. All 41 queue PostgreSQL cases, 25 AUD-10 workflow cases, five AUD-10 contention scenarios and the clinic simulation remain unexecuted. Runtime network/privilege/isolation acceptance requires separate authorization and newly verified disposable infrastructure.

## Review handoff and next milestone

DONE: four-file offline implementation, strict contracts, permanent refusals, lifecycle comparisons and database-free regressions. IN PROGRESS: focused independent source acceptance. REMAINING: controlled publication only after authorization, then a separately scoped **non-executing controller core** for authenticated-record interfaces and durable state/replay planning with fake adapters. No engine/database/process adapter should be introduced in that core milestone.

OPEN: unauthenticated policy/provisioning/approval/runtime claims, unconfigured infrastructure/build policy, all migration holds, conflicting Laravel test profiles, unenforced external commands, unexecuted persisted/contention acceptance, Clinical UI activation and inherited frontend/HMO failures. Stop after source-review handoff; no commit, push or next assignment begins here.

## Raw integer correction — DENTALOPS-QA-RUNTIME-CONTRACTS-FIX-01

The independent source review blocked publication after reproducing a precision-loss defect. The published general JSON parser converts numeric literals with `Number()`. The original runtime-contract `Number.isSafeInteger()` predicate saw the converted value: `1.0000000000000001` had already become `1`. One request generation could therefore appear consistent with other declarations of generation `1`. Authorization remained BLOCKED; the defect was in strict validation, not an established execution bypass.

The correction changes only `contracts.mjs`, `contracts.test.mjs` and this document relative to the reviewed candidate. `policy.json`, the published parser/gate, Laravel, migrations, Clinical UI and other worktrees remain unchanged. No additional file or dependency was needed.

### Numeric inventory and representation decision

The fixed schema has **25 numeric locations** in a complete policy/bundle fixture, all integer-only:

| Document | Actual fields |
| --- | --- |
| Bundle: 18 | `request.version`; `{request,provisioning,approval,runtime}.policy.revision`; `{request,provisioning,approval,runtime}.migration.count`; `{request,provisioning,approval,runtime}.resources.generation`; `approval.expectedGeneration`; `runtime.identity.serverVersionNum`; `transition.expectedGeneration`, `transition.expectedRevision`, `transition.nextRevision` |
| Policy: 7 | `version`, `identity.revision`, `migrations.count`, `limits.requestSeconds`, `limits.approvalSeconds`, `limits.receiptSeconds`, `limits.observationSeconds` |

There is no numeric sequence field. Request/approval lifetimes use timestamp strings; only the policy's duration ceilings are numeric. The uint64 `runtime.identity.systemIdentifier` remains a string with its existing exact BigInt check; it is not constrained to JavaScript's Number range.

Consequently a global numeric-token gate is sound **for this fixed contract only**. Accepted numeric syntax is `0|[1-9][0-9]*`, with no sign, decimal point or exponent, and a raw magnitude no larger than `9007199254740991`. The existing field bounds are stricter (at most 1,000,000,000). Zero is lexically accepted but valid only where the field/context permits it, such as the initial transition revision. Negatives and `-0` are excluded because no existing numeric field needs a negative value. `1.0` and `1e0` are intentionally refused even though their mathematical value is an integer.

The private `assertCanonicalIntegerTokens()` runs before **either** policy or bundle reaches `parseStrictJson()`. It bounds primitive input length/UTF-8 size, walks raw text, skips quoted strings with escape-aware quote/backslash handling, and recognizes numeric tokens with a sticky JSON-number pattern. It checks canonical syntax and compares decimal digit strings by length/lexical magnitude, without Number or BigInt conversion of those tokens. Every token that reaches the published parser can therefore be represented exactly. A very long integer fails without numeric conversion.

This guard does not decode or rewrite strings, repair input, interpret schemas or replace JSON grammar validation. The existing strict parser still checks syntax, string escapes, Unicode, duplicate decoded keys, depth and node limits. On malformed input a numeric refusal can precede a syntax refusal; neither path accepts the document. `INVALID_INTEGER_TOKEN` uses a static message and document location only, never the rejected token. Any future schema with fractional numeric fields requires a separately reviewed, field-aware change rather than casually reusing this global gate.

### Before/after and regression evidence

The reviewer's exact raw replacement is retained in the suite, without constructing the token as a JavaScript number:

```js
const altered = originalBundleJson.replace(
  '"generation":1',
  '"generation":1.0000000000000001'
)
```

| Observation | Before | After |
| --- | --- | --- |
| Structure/comparison | All structures true; `consistent: true`, `transitionPlausible: true` | Bundle parsing refuses `INVALID_INTEGER_TOKEN`; `consistent: false`, `transitionPlausible: null`; bundle substructures unassessed |
| Authorization | BLOCKED / false / false | BLOCKED / false / false |

Current correction evidence directory: `/private/tmp/runtime-integer-fix-1argng_l/`. It is temporary and outside source. Commands use the same sanitized, restricted Node 22.19.0 setup described above, with no runtime launcher or database capability.

| Current-session check | Actual result / evidence |
| --- | --- |
| Pre-fix original review harness | Defect reproduced: 23 passed / 1 failed; `before-challenge.json` |
| New regressions against original source | **130 passed / 46 failed**, demonstrating the tests catch the defect; `regression-red.tap` |
| Final focused suite | **178 passed**, zero failed/skipped; `focused-final.tap` |
| Unchanged published offline suite | **144 passed**, zero failed/skipped; `offline-gate.tap`; synthetic writes confined to `/private/tmp/qa-isolation-gate-integer-fix-629zfmcn/` |
| Original review harness after correction | **24 passed**, zero failed; `after-challenge.json` |
| Separate implementing-session challenge | **18 checks passed**, including 500 quoted-string mutations and 25 escape-boundary cases; `session-challenge.mjs`, `session-results.json` |

Raw-token cases include every requested fraction/exponent/underflow/unsafe-integer example, every one of the 25 numeric field locations, all matching generation bindings, policy limits/counts, nested arrays/objects, the global exact-integer boundary, existing field bounds, zero, huge tokens and numeric text inside strings. Valid canonical fixtures, the 640-pair lifecycle matrix, sanitized errors, immutability and non-execution checks still pass. The two existing tests for an unsafe integer and a nonfinite exponent now expect `INVALID_INTEGER_TOKEN` because refusal happens before the old Number-based check; no validation was weakened.

### Related published-gate exposure — read-only follow-up

The published gate's fixed schema has numeric constants at `version` (1) and `$defs.target.port` (5432), rather than additional general integer fields. Read-only synthetic probes confirmed rounding exposure at all five manifest locations:

- `version`: raw `1.0000000000000001` satisfies the constant 1 after conversion.
- `request.target.port`.
- `request.configuration.connections.pgsql.port`.
- `provisioningEvidence.target.port`.
- `approval.target.port`.

For each port location, raw `5432.0000000000000001` satisfies 5432 and can match the other integer declarations. Each probe returned `descriptorValid: true`, `consistent: true`, but **status BLOCKED, executionAllowed false, provisioningAllowed false**, with known migration holds present. The issue affects strict serialized constant validation; it does not remove the gate's permanent refusal or establish a database execution path.

Record a separately scoped follow-up for the published gate's raw numeric handling before future reuse/expansion. Its parser, schema and implementation were not modified here. This correction's fresh independent re-review remains required, followed by publication only if accepted and separately authorized. No staging, commit, push, merge or next assignment is performed in this correction session.

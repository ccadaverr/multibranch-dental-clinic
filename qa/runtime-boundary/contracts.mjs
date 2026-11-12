import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {canonicalJson, DescriptorError, parseStrictJson} from '../clinic-simulation/strict-json.mjs'

// Fixed development contracts, not an extensible schema interpreter or an authorization engine.
// The caller supplies serialized JSON only. No trust callbacks, credentials or runtime handles.
const BASELINE = '15d626c03c97baf7198a7b7ca6dea2bec8f60836'
const GATE = '431ce91805d546913dcf18cdb9e78b4af0010a8d'
const REPOSITORY = 'https://github.com/ccadaverr/multibranch-dental-clinic.git'
const CHAIN = 'f565b8e643f41787575f8d54c0be5d0c33b81aeaa35f4844b4527c5ba13ee1ff'
const POLICY_ID = 'dentalops-qa-runtime-contracts'
const PHASES = ['assessment', 'allocation', 'verification', 'schema', 'execution', 'containment', 'teardown']
const STATES = ['requested', 'assessed', 'allocated', 'identity-verified', 'schema-initialized', 'execution-finished', 'fenced', 'torn-down']
// [lane, phase, exact scopes, credential class, legal source states, proposed target state]
const OPERATIONS = {
  'assess-request': ['offline', 'assessment', ['source-observation'], 'none', ['requested'], 'assessed'],
  'allocate-instance': ['infrastructure', 'allocation', ['resource-create'], 'infrastructure', ['assessed'], 'allocated'],
  'verify-instance': ['infrastructure', 'verification', ['identity-read'], 'verifier', ['allocated'], 'identity-verified'],
  'initialize-schema': ['schema', 'schema', ['schema-ddl'], 'schema-owner', ['identity-verified'], 'schema-initialized'],
  'transactional-feature-tests': ['transactional', 'execution', ['database-dml'], 'application', ['schema-initialized'], 'execution-finished'],
  'committed-contention-tests': ['contention', 'execution', ['database-dml', 'bounded-workers'], 'application', ['schema-initialized'], 'execution-finished'],
  'synthetic-simulation': ['simulation', 'execution', ['database-dml', 'bounded-workers'], 'application', ['schema-initialized'], 'execution-finished'],
  'browser-qa': ['browser', 'execution', ['database-dml', 'private-http', 'bounded-workers'], 'application', ['schema-initialized'], 'execution-finished'],
  'fence-run': ['infrastructure', 'containment', ['process-stop', 'credential-revoke'], 'infrastructure', ['allocated', 'identity-verified', 'schema-initialized', 'execution-finished'], 'fenced'],
  'teardown-run': ['teardown', 'teardown', ['resource-delete'], 'infrastructure', ['fenced'], 'torn-down'],
}
const DENIED = ['raw-shell', 'arbitrary-process', 'schema-reset', 'unreviewed-migration', 'provider-request', 'ledger-rewrite', 'global-cleanup', 'force-override']
const REQUIRED = ['source-build-provenance', 'authenticated-policy', 'controller-resource-record', 'scoped-approval', 'runtime-identity', 'effective-configuration', 'network-isolation', 'role-privileges', 'durable-replay-ledger', 'teardown-ownership']
const CONSTRAINTS = ['exclusiveResources', 'freshVolume', 'privateNetworkOnly', 'noHostMounts', 'separateRoles', 'authenticatedControllerRequired', 'trustedClockRequired', 'durableReplayLedgerRequired', 'immutableSourceRequired', 'noOverrides']
const LIMITS = {requestSeconds: 3600, approvalSeconds: 1800, receiptSeconds: 900, observationSeconds: 300}
const HOLDS = [
  {id: 'queue-preservation', path: 'backend/database/migrations/2026_11_16_000500_update_queue_statuses_and_remove_urgent_priority.php', sha256: '16b5eaddf6a725791fb74ef9a0d04b25187ba0e006fa885b7cd452df6feaed40'},
  {id: 'feedback-preservation', path: 'backend/database/migrations/2026_11_10_000100_remove_patient_feedback_table.php', sha256: '3c8af7cb8126866af3d67107bdd792960b5389922c762a09f6c08781db5b6df9'},
  {id: 'tooth-chart-provenance', path: 'backend/database/migrations/2026_11_15_000400_backfill_tooth_chart_branch.php', sha256: '36f0fa951bc7c612f87ba47e40307729e96e8d222d6fcc019dd7acb2dd249181'},
  {id: 'nontransactional-indexes', path: 'backend/database/migrations/2026_11_15_000500_add_critical_foreign_key_and_analytics_indexes.php', sha256: '921a1dcfdfd321569ebcff08dcd72a069e32fb50bddc9c360af3ca795809711f'},
]
const MESSAGES = {
  OFFLINE_ONLY: 'Offline contracts cannot launch operations or grant execution or provisioning permission.',
  POLICY_UNAUTHENTICATED: 'Checkout policy is not authenticated administrator policy.',
  SOURCE_UNAUTHENTICATED: 'Source and build identities remain declarations, not verified provenance.',
  PROVISIONER_UNAUTHENTICATED: 'Resource records do not authenticate infrastructure ownership.',
  APPROVAL_UNAUTHENTICATED: 'Approval declarations are not authenticated authority.',
  RUNTIME_UNVERIFIED: 'Runtime observations and isolation claims have not been independently verified.',
  REPLAY_LEDGER_REQUIRED: 'A trusted durable replay and revocation ledger is required.',
  TRUSTED_CLOCK_REQUIRED: 'The supplied comparison clock is not an authenticated authorization clock.',
  CONTROLLER_UNIMPLEMENTED: 'A trusted controller and enforced process boundary are not implemented.',
  INSTALLATION_UNCONFIGURED: 'Infrastructure, image and authority policy remain unconfigured.',
  BUILD_POLICY_UNCONFIGURED: 'Dependency, build and controller digests are not approved by this development policy.',
  MIGRATION_CHAIN_HELD: 'The migration chain remains held; no schema approval or migration skipping is permitted.',
  INVALID_JSON_INPUT: 'Provide bounded serialized JSON, not executable values.',
  MALFORMED_JSON: 'JSON syntax is invalid; input excerpts are omitted.',
  JSON_LIMIT_EXCEEDED: 'JSON nesting or node limits were exceeded.',
  DUPLICATE_JSON_KEY: 'A decoded object key occurs more than once.',
  UNSUPPORTED_FIELD: 'An unsafe JSON property name is unsupported.',
  UNKNOWN_FIELD: 'An undocumented field or schema construct is unsupported.',
  MISSING_FIELD: 'A required contract field is missing.',
  INVALID_VALUE: 'A field has an unsupported type, representation or value.',
  INVALID_INTEGER_TOKEN: 'Unquoted numbers must be canonical nonnegative decimal integers within the exact safe range.',
  DUPLICATE_VALUE: 'Identifiers or scopes that must be unique are duplicated.',
  UNSUPPORTED_ARGUMENTS: 'The public interface does not accept extra arguments or overrides.',
  INVALID_CLOCK: 'Provide a canonical UTC comparison instant; it remains untrusted.',
  POLICY_MISMATCH: 'Policy identity, vocabulary or digest differs from this fixed development contract.',
  SOURCE_MISMATCH: 'Source declarations differ from the reviewed development identity.',
  MIGRATION_MISMATCH: 'Migration declarations differ from the complete held baseline inventory.',
  MIGRATION_HOLD_MISMATCH: 'Every original migration hold and its identity must be preserved.',
  OPERATION_UNKNOWN: 'The operation category is unknown; no default is selected.',
  OPERATION_DENIED: 'This operation is explicitly denied by the contract.',
  OPERATION_SCOPE_MISMATCH: 'The lane, phase or exact capability scope does not match the operation.',
  OWNERSHIP_MISMATCH: 'Declared ownership does not match the requested run.',
  AUTHORITY_CONFLICT: 'Provisioning and approval must declare distinct authority identities.',
  RESOURCE_PHASE_MISMATCH: 'Resource identities are inconsistent with the requested lifecycle phase.',
  PROVISIONING_BINDING_MISMATCH: 'The provisioning declaration does not bind the exact request identities.',
  APPROVAL_BINDING_MISMATCH: 'The approval declaration does not cover the exact request and resources.',
  RUNTIME_BINDING_MISMATCH: 'Runtime declarations do not bind the exact source, role and resources.',
  RUNTIME_CHECK_FAILED: 'A required runtime safety observation is declared unsuccessful.',
  EVIDENCE_REQUIRED: 'This planned phase requires additional evidence declarations.',
  INVALID_LIFETIME: 'Evidence has an invalid, future, overlong or inconsistent lifetime.',
  STALE_EVIDENCE: 'A declared lifetime or observation has expired.',
  APPROVAL_REPLAY_DECLARED: 'The supplied declarations identify a previously consumed approval.',
  APPROVAL_REVOKED_DECLARED: 'The supplied declarations identify a revoked approval.',
  TRANSITION_BINDING_MISMATCH: 'The proposed transition does not match the run and resource generation.',
  ILLEGAL_TRANSITION: 'The proposed transition skips or violates the required phase order.',
  REVISION_MISMATCH: 'A transition must retain its predecessor and advance exactly one revision.',
  TRANSITION_REPLAY_DECLARED: 'The supplied declarations repeat a transition identity.',
  TEARDOWN_SCOPE_MISMATCH: 'Cleanup must explicitly match only the exact run-owned resources.',
  ASSESSMENT_FAILED: 'Contract assessment failed safely; internal exception details are omitted.',
}
const PERMANENT = ['OFFLINE_ONLY', 'POLICY_UNAUTHENTICATED', 'SOURCE_UNAUTHENTICATED', 'PROVISIONER_UNAUTHENTICATED',
  'APPROVAL_UNAUTHENTICATED', 'RUNTIME_UNVERIFIED', 'REPLAY_LEDGER_REQUIRED', 'TRUSTED_CLOCK_REQUIRED',
  'CONTROLLER_UNIMPLEMENTED', 'INSTALLATION_UNCONFIGURED', 'BUILD_POLICY_UNCONFIGURED', 'MIGRATION_CHAIN_HELD']
const same = (left, right) => canonicalJson(left) === canonicalJson(right)
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
const matches = (value, pattern) => typeof value === 'string' && pattern.exec(value)?.[0] === value
const instant = value => matches(value, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/)
  && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value.replace('Z', '.000Z')

// Private fixed-shape combinators. Callers cannot supply schemas or validator functions.
const scalar = predicate => (value, path, add) => { if (!predicate(value)) add('INVALID_VALUE', path, 'structure') }
const exact = value => scalar(candidate => candidate === value)
const text = scalar(value => typeof value === 'string' && value.length > 0 && value.length <= 240)
const identifier = scalar(value => matches(value, /^[a-z][a-z0-9-]{2,79}$/))
const runId = scalar(value => matches(value, /^qa-run-[a-z0-9-]{3,48}$/))
const sha = scalar(value => matches(value, /^[a-f0-9]{64}$/))
const commit = scalar(value => matches(value, /^[a-f0-9]{40}$/))
const image = scalar(value => matches(value, /^sha256:[a-f0-9]{64}$/))
const timestamp = scalar(instant)
const integer = (min = 1, max = 1000000000) => scalar(value => Number.isSafeInteger(value) && value >= min && value <= max)
const member = values => scalar(value => typeof value === 'string' && values.includes(value))
const nullable = validator => (value, path, add) => { if (value !== null) validator(value, path, add) }
const record = fields => (value, path, add) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { add('INVALID_VALUE', path, 'structure'); return }
  if (Object.keys(value).some(key => !Object.hasOwn(fields, key))) add('UNKNOWN_FIELD', path, 'structure')
  for (const [key, validate] of Object.entries(fields)) {
    if (!Object.hasOwn(value, key)) add('MISSING_FIELD', path + '/' + key, 'structure')
    else validate(value[key], path + '/' + key, add)
  }
}
const list = (validate, max = 128) => (value, path, add) => {
  if (!Array.isArray(value) || value.length > max) { add('INVALID_VALUE', path, 'structure'); return }
  if (new Set(value.map(canonicalJson)).size !== value.length) add('DUPLICATE_VALUE', path, 'structure')
  value.forEach((item, index) => validate(item, path + '/' + index, add))
}
const sourceShape = record({repository: text, commit, dependencyLockDigest: sha, buildDigest: sha, controllerDigest: sha})
const policyRefShape = record({id: identifier, revision: integer(), digest: sha})
const migrationShape = record({id: identifier, sourceCommit: commit, count: integer(1, 500), orderedDigest: sha})
const operationShape = record({category: identifier, lane: identifier, phase: identifier, scopes: list(identifier, 8), artifactDigest: sha})
const resourceFields = nullableIds => ({generation: integer(), ownerRunId: runId,
  ...Object.fromEntries(['instanceId', 'containerId', 'volumeId', 'networkId'].map(key => [key, nullableIds ? nullable(identifier) : identifier])), imageDigest: image})
const resourceShape = record(resourceFields(false))
const lifetimeFields = {issuedAt: timestamp, expiresAt: timestamp}
const requestShape = record({version: exact(1), requestId: identifier, runId, source: sourceShape, policy: policyRefShape,
  migration: migrationShape, operation: operationShape, resources: record(resourceFields(true)), ...lifetimeFields})
const provisioningShape = record({receiptId: identifier, authorityId: identifier, runId, source: sourceShape, policy: policyRefShape,
  migration: migrationShape, resources: resourceShape, credentials: record({applicationRef: identifier, schemaRef: identifier, verifierRef: identifier}), ...lifetimeFields})
const approvalShape = record({approvalId: identifier, authorityId: identifier, requestId: identifier, runId, source: sourceShape,
  policy: policyRefShape, migration: migrationShape, operation: operationShape, resources: nullable(resourceShape), expectedGeneration: integer(),
  provisioningReceiptId: nullable(identifier), credentialRole: member(['none', 'infrastructure', 'verifier', 'schema-owner', 'application']),
  nonce: identifier, revoked: scalar(value => typeof value === 'boolean'), used: scalar(value => typeof value === 'boolean'), ...lifetimeFields})
const runtimeShape = record({evidenceId: identifier, authorityId: identifier, runId, source: sourceShape, policy: policyRefShape,
  migration: migrationShape, resources: resourceShape, provisioningReceiptId: identifier, observedAt: timestamp,
  identity: record({systemIdentifier: scalar(value => matches(value, /^[1-9][0-9]{0,19}$/) && BigInt(value) <= 18446744073709551615n),
    serverVersionNum: integer(100000, 999999), databaseName: exact('dental_clinic_test'), roleRef: identifier, tlsPeerDigest: sha}),
  checks: record(Object.fromEntries(['privateNetwork', 'ownedFreshVolume', 'privilegesMatch', 'configurationMatches', 'sourceImmutable', 'schemaMatches', 'unexpectedContent']
    .map(key => [key, scalar(value => typeof value === 'boolean')]))),
})
const transitionShape = record({transitionId: identifier, runId, expectedGeneration: integer(), from: member(STATES), to: member(STATES),
  expectedRevision: integer(0, 999999999), nextRevision: integer(), previousTransitionId: nullable(identifier),
  seenTransitionIds: list(identifier), seenApprovalIds: list(identifier), revokedApprovalIds: list(identifier),
  cleanup: nullable(record({ownerRunId: runId, resourceIds: list(identifier, 4)}))})
const bundleShape = record({request: requestShape, provisioning: nullable(provisioningShape), approval: nullable(approvalShape),
  runtime: nullable(runtimeShape), transition: nullable(transitionShape)})
const policyShape = record({version: exact(1), identity: record({id: identifier, revision: integer()}), classification: exact('development-untrusted'),
  source: record({repository: text, reviewedCommit: commit, offlineGateCommit: commit, dependencyLockDigest: exact(null), buildDigest: exact(null), controllerDigest: exact(null)}),
  migrations: record({id: identifier, sourceCommit: commit, count: integer(1, 500), orderedDigest: sha, decision: exact('held'),
    holds: list(record({id: identifier, path: text, sha256: sha}), 4)}),
  vocabulary: record({phases: list(identifier, 16), states: list(identifier, 16), operations: list(identifier, 16)}),
  constraints: record(Object.fromEntries(CONSTRAINTS.map(key => [key, exact(true)]))),
  limits: record(Object.fromEntries(Object.entries(LIMITS).map(([key, value]) => [key, exact(value)]))),
  deniedOperations: list(identifier, 16), requiredEvidence: list(identifier, 16),
  installation: record({state: exact('unconfigured'), hostIdentity: exact(null), controllerIdentity: exact(null),
    provisionerAuthority: exact(null), approvalAuthority: exact(null), postgresImageDigest: exact(null), profileDigest: exact(null)}),
  executionAllowed: exact(false), provisioningAllowed: exact(false)})

function context() {
  const refusals = [], checks = {structures: {policy: null, request: null, provisioning: null, approval: null, runtime: null, transition: null}, consistent: false, transitionPlausible: null}
  const add = (code, location = '', stage = 'consistency') => {
    if (refusals.length < 64 && !refusals.some(item => item.code === code && item.location === location)) {
      refusals.push({code, location, stage, message: MESSAGES[code] || MESSAGES.ASSESSMENT_FAILED})
    }
  }
  PERMANENT.forEach(code => add(code, '', 'boundary'))
  const finish = () => {
    checks.consistent = !refusals.some(item => item.stage !== 'boundary')
    if (checks.transitionPlausible !== null && !checks.consistent) checks.transitionPlausible = false
    return freeze({status: 'BLOCKED', executionAllowed: false, provisioningAllowed: false, checks,
      trust: {policy: 'unauthenticated', source: 'declared-only', provisioning: 'unauthenticated', approval: 'unauthenticated', runtime: 'unverified', replay: 'unverified', clock: 'caller-supplied'}, refusals})
  }
  return {add, finish, checks}
}
// Every numeric field in this fixed contract is integer-only. Inspect raw tokens BEFORE
// parseStrictJson converts them to Number; post-conversion isSafeInteger is insufficient.
// This is only a quote-aware lexical gate. The existing parser still validates JSON grammar,
// escapes, duplicate keys and structural bounds. Strings are never decoded or rewritten here.
function assertCanonicalIntegerTokens(text) {
  if (typeof text !== 'string' || text.length > 1048576 || !text.isWellFormed() || Buffer.byteLength(text, 'utf8') > 1048576) throw new DescriptorError('INVALID_JSON_INPUT')
  const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y
  const largestExactInteger = '9007199254740991'
  for (let at = 0; at < text.length;) {
    if (text[at] === '"') {
      at++
      while (at < text.length) {
        const ch = text[at++]
        if (ch === '\\') at++ // Skip an escaped character, including a quote or backslash.
        else if (ch === '"') break
      }
      continue
    }
    number.lastIndex = at
    const token = number.exec(text)?.[0]
    if (token === undefined) { at++; continue }
    // Compare digit strings without converting even an unsafe/very long token to Number.
    if (!matches(token, /^(?:0|[1-9][0-9]*)$/) || token.length > largestExactInteger.length
      || (token.length === largestExactInteger.length && token > largestExactInteger)) throw new DescriptorError('INVALID_INTEGER_TOKEN')
    at = number.lastIndex
  }
}
function parse(text, path, c) {
  try {
    assertCanonicalIntegerTokens(text)
    return parseStrictJson(text)
  } catch (error) { c.add(error instanceof DescriptorError ? error.code : 'ASSESSMENT_FAILED', path, 'structure'); return undefined }
}
function validate(shape, value, path, c) {
  let valid = true
  shape(value, path, (code, location, stage) => { valid = false; c.add(code, location, stage) })
  return valid
}
function checkPolicy(p, c) {
  c.checks.structures.policy = validate(policyShape, p, '/policy', c)
  if (!c.checks.structures.policy) return
  if (!same(p.identity, {id: POLICY_ID, revision: 1}) || !same(p.vocabulary, {phases: PHASES, states: STATES, operations: Object.keys(OPERATIONS)})
    || !same(p.deniedOperations, DENIED) || !same(p.requiredEvidence, REQUIRED)) c.add('POLICY_MISMATCH', '/policy')
  if (p.source.repository !== REPOSITORY || p.source.reviewedCommit !== BASELINE || p.source.offlineGateCommit !== GATE) c.add('SOURCE_MISMATCH', '/policy/source')
  if (p.migrations.id !== 'baseline-migrations-held' || p.migrations.sourceCommit !== BASELINE || p.migrations.count !== 86 || p.migrations.orderedDigest !== CHAIN) c.add('MIGRATION_MISMATCH', '/policy/migrations')
  if (!same(p.migrations.holds, HOLDS)) c.add('MIGRATION_HOLD_MISMATCH', '/policy/migrations/holds')
}
function lifetime(value, maxSeconds, now, path, c) {
  const issued = Date.parse(value.issuedAt), expires = Date.parse(value.expiresAt)
  if (issued > now || expires <= issued || expires - issued > maxSeconds * 1000) c.add('INVALID_LIFETIME', path)
  else if (expires <= now) c.add('STALE_EVIDENCE', path)
}
const resourceIds = resources => ['instanceId', 'containerId', 'volumeId', 'networkId'].map(key => resources[key])
function distinct(values, path, c) { if (new Set(values).size !== values.length) c.add('DUPLICATE_VALUE', path) }
function bindEvidence(evidence, request, code, path, c) {
  if (evidence.runId !== request.runId || !['source', 'policy', 'migration', 'resources'].every(key => same(evidence[key], request[key]))) c.add(code, path)
}
function checkBundle(b, p, now, c) {
  const r = b.request, receipt = b.provisioning, a = b.approval, runtime = b.runtime, t = b.transition
  const op = Object.hasOwn(OPERATIONS, r.operation.category) ? OPERATIONS[r.operation.category] : null
  if (!op) c.add(DENIED.includes(r.operation.category) ? 'OPERATION_DENIED' : 'OPERATION_UNKNOWN', '/request/operation')
  else if (r.operation.lane !== op[0] || r.operation.phase !== op[1] || !same([...r.operation.scopes].sort(), [...op[2]].sort())) c.add('OPERATION_SCOPE_MISMATCH', '/request/operation')
  if (r.source.repository !== REPOSITORY || r.source.commit !== BASELINE) c.add('SOURCE_MISMATCH', '/request/source')
  const policyDigest = createHash('sha256').update(canonicalJson(p)).digest('hex')
  if (!same(r.policy, {id: POLICY_ID, revision: 1, digest: policyDigest})) c.add('POLICY_MISMATCH', '/request/policy')
  if (!same(r.migration, {id: 'baseline-migrations-held', sourceCommit: BASELINE, count: 86, orderedDigest: CHAIN})) c.add('MIGRATION_MISMATCH', '/request/migration')
  lifetime(r, LIMITS.requestSeconds, now, '/request', c)
  if (r.resources.ownerRunId !== r.runId) c.add('OWNERSHIP_MISMATCH', '/request/resources')
  const preAllocation = ['assess-request', 'allocate-instance'].includes(r.operation.category)
  const ids = resourceIds(r.resources)
  if (preAllocation ? ids.some(id => id !== null) : ids.some(id => id === null)) c.add('RESOURCE_PHASE_MISMATCH', '/request/resources')
  if (!preAllocation) distinct(ids, '/request/resources', c)
  if ((op && !preAllocation && !receipt) || (op && r.operation.category !== 'assess-request' && !a)
    || (op && ['verification', 'schema', 'execution'].includes(op[1]) && !runtime)) c.add('EVIDENCE_REQUIRED')
  if (preAllocation && (receipt || runtime)) c.add('RESOURCE_PHASE_MISMATCH')
  distinct([receipt?.receiptId, a?.approvalId, runtime?.evidenceId].filter(id => id !== undefined), '/evidence', c)
  if (receipt && a && receipt.authorityId === a.authorityId) c.add('AUTHORITY_CONFLICT', '/approval')

  if (receipt) {
    bindEvidence(receipt, r, 'PROVISIONING_BINDING_MISMATCH', '/provisioning', c)
    lifetime(receipt, LIMITS.receiptSeconds, now, '/provisioning', c)
    distinct(Object.values(receipt.credentials), '/provisioning/credentials', c)
    distinct(resourceIds(receipt.resources), '/provisioning/resources', c)
  }
  if (a) {
    const expectedResources = receipt ? r.resources : null
    if (a.runId !== r.runId || a.requestId !== r.requestId || a.expectedGeneration !== r.resources.generation
      || !['source', 'policy', 'migration', 'operation'].every(key => same(a[key], r[key]))
      || !same(a.resources, expectedResources) || a.provisioningReceiptId !== (receipt?.receiptId ?? null)
      || (op && a.credentialRole !== op[3]) || Date.parse(a.expiresAt) < Date.parse(r.expiresAt)) c.add('APPROVAL_BINDING_MISMATCH', '/approval')
    lifetime(a, LIMITS.approvalSeconds, now, '/approval', c)
    if (Date.parse(a.issuedAt) < Date.parse(r.issuedAt)) c.add('INVALID_LIFETIME', '/approval')
    if (a.used) c.add('APPROVAL_REPLAY_DECLARED', '/approval')
    if (a.revoked) c.add('APPROVAL_REVOKED_DECLARED', '/approval')
  }
  if (runtime) {
    bindEvidence(runtime, r, 'RUNTIME_BINDING_MISMATCH', '/runtime', c)
    const roleKey = op?.[3] === 'schema-owner' ? 'schemaRef' : op?.[3] === 'verifier' ? 'verifierRef' : 'applicationRef'
    if (!receipt || runtime.provisioningReceiptId !== receipt.receiptId || runtime.identity.roleRef !== receipt.credentials[roleKey]) c.add('RUNTIME_BINDING_MISMATCH', '/runtime')
    if (Object.entries(runtime.checks).some(([key, value]) => value !== (key !== 'unexpectedContent'))) c.add('RUNTIME_CHECK_FAILED', '/runtime/checks')
    const observed = Date.parse(runtime.observedAt)
    if (observed > now || receipt && observed < Date.parse(receipt.issuedAt)) c.add('INVALID_LIFETIME', '/runtime')
    else if (now - observed > LIMITS.observationSeconds * 1000) c.add('STALE_EVIDENCE', '/runtime')
  }
  if (!t) return
  let plausible = true
  const transitionIssue = code => { plausible = false; c.add(code, '/transition') }
  if (t.runId !== r.runId || t.expectedGeneration !== r.resources.generation) transitionIssue('TRANSITION_BINDING_MISMATCH')
  if (!op || !op[4].includes(t.from) || t.to !== op[5]) transitionIssue('ILLEGAL_TRANSITION')
  if (t.nextRevision !== t.expectedRevision + 1 || (t.from === 'requested' ? t.expectedRevision !== 0 || t.previousTransitionId !== null : t.expectedRevision === 0 || t.previousTransitionId === null)) transitionIssue('REVISION_MISMATCH')
  if (t.seenTransitionIds.includes(t.transitionId) || t.previousTransitionId === t.transitionId) transitionIssue('TRANSITION_REPLAY_DECLARED')
  if (a && t.seenApprovalIds.includes(a.approvalId)) transitionIssue('APPROVAL_REPLAY_DECLARED')
  if (a && t.revokedApprovalIds.includes(a.approvalId)) transitionIssue('APPROVAL_REVOKED_DECLARED')
  if (r.operation.category === 'teardown-run') {
    if (!receipt || !t.cleanup || t.cleanup.ownerRunId !== r.runId || !same([...t.cleanup.resourceIds].sort(), [...ids].sort())) transitionIssue('TEARDOWN_SCOPE_MISMATCH')
  } else if (t.cleanup !== null) transitionIssue('TEARDOWN_SCOPE_MISMATCH')
  c.checks.transitionPlausible = plausible
}

/** assessPolicy(policyJson): validate the fixed development policy. Never authenticate it.
 * All outputs are frozen, sanitized assessments with execution/provisioning permanently false.
 */
export function assessPolicy(policyJson) {
  const c = context()
  if (arguments.length !== 1) { c.add('UNSUPPORTED_ARGUMENTS', '', 'structure'); return c.finish() }
  try {
    const policy = parse(policyJson, '/policy', c)
    if (policy !== undefined) checkPolicy(policy, c)
  } catch { c.add('ASSESSMENT_FAILED', '', 'structure') }
  return c.finish()
}

/** assessRuntimeContracts(bundleJson, policyJson, nowIso): compare UNTRUSTED declarations.
 * Bundle keys: request, provisioning, approval, runtime, transition; the last four may be null.
 * nowIso is an explicit canonical UTC comparison clock, never trusted time. No state is stored,
 * transition performed, evidence authenticated, lease issued or user input echoed in diagnostics.
 */
export function assessRuntimeContracts(bundleJson, policyJson, nowIso) {
  const c = context()
  if (arguments.length !== 3) { c.add('UNSUPPORTED_ARGUMENTS', '', 'structure'); return c.finish() }
  try {
    const policy = parse(policyJson, '/policy', c), bundle = parse(bundleJson, '/bundle', c)
    if (policy !== undefined) checkPolicy(policy, c)
    if (bundle === undefined) return c.finish()
    const valid = validate(bundleShape, bundle, '', c)
    if (bundle && typeof bundle === 'object' && !Array.isArray(bundle)) {
      for (const [key, shape] of Object.entries({request: requestShape, provisioning: provisioningShape, approval: approvalShape, runtime: runtimeShape, transition: transitionShape})) {
        if (Object.hasOwn(bundle, key)) c.checks.structures[key] = bundle[key] === null && key !== 'request' ? null : validate(shape, bundle[key], '/' + key, c)
      }
    }
    if (!instant(nowIso)) { c.add('INVALID_CLOCK', '', 'structure'); return c.finish() }
    if (valid && c.checks.structures.policy) checkBundle(bundle, policy, Date.parse(nowIso), c)
  } catch { c.add('ASSESSMENT_FAILED', '', 'structure') }
  return c.finish()
}

// CLI has no command dispatch, including for --force. Module import has no I/O side effects.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stderr.write('BLOCKED: offline contracts only; no execution or provisioning authority.\n')
  process.exitCode = 2
}

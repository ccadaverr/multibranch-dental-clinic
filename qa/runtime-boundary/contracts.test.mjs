import test, {mock} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {syncBuiltinESMExports} from 'node:module'
import net from 'node:net'
import tls from 'node:tls'
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import cp from 'node:child_process'
import {assessPolicy, assessRuntimeContracts} from './contracts.mjs'
import {canonicalJson, parseStrictJson} from '../clinic-simulation/strict-json.mjs'
import {assessOffline} from '../clinic-simulation/preflight.mjs'

// Read public files only. No application imports, fixture writes, subprocesses or sockets.
const policyText = fs.readFileSync(new URL('./policy.json', import.meta.url), 'utf8')
const policy = parseStrictJson(policyText)
const hash = value => createHash('sha256').update(value).digest('hex')
const copy = value => JSON.parse(JSON.stringify(value))
const NOW = '2026-11-12T04:00:00Z'
const issuedAt = '2026-11-12T03:59:00Z', expiresAt = '2026-11-12T04:09:00Z'
const digest = 'a'.repeat(64)
const policyRef = () => ({...policy.identity, digest: hash(canonicalJson(policy))})
const source = () => ({repository: policy.source.repository, commit: policy.source.reviewedCommit,
  dependencyLockDigest: digest, buildDigest: 'b'.repeat(64), controllerDigest: 'c'.repeat(64)})
const migration = () => ({id: policy.migrations.id, sourceCommit: policy.migrations.sourceCommit,
  count: policy.migrations.count, orderedDigest: policy.migrations.orderedDigest})
const resources = () => ({generation: 1, ownerRunId: 'qa-run-synthetic', instanceId: 'qa-instance-synthetic',
  containerId: 'qa-container-synthetic', volumeId: 'qa-volume-synthetic', networkId: 'qa-network-synthetic', imageDigest: 'sha256:' + digest})
const operations = {
  'assess-request': ['offline', 'assessment', ['source-observation'], 'none', 'requested', 'assessed'],
  'allocate-instance': ['infrastructure', 'allocation', ['resource-create'], 'infrastructure', 'assessed', 'allocated'],
  'verify-instance': ['infrastructure', 'verification', ['identity-read'], 'verifier', 'allocated', 'identity-verified'],
  'initialize-schema': ['schema', 'schema', ['schema-ddl'], 'schema-owner', 'identity-verified', 'schema-initialized'],
  'transactional-feature-tests': ['transactional', 'execution', ['database-dml'], 'application', 'schema-initialized', 'execution-finished'],
  'committed-contention-tests': ['contention', 'execution', ['database-dml', 'bounded-workers'], 'application', 'schema-initialized', 'execution-finished'],
  'synthetic-simulation': ['simulation', 'execution', ['database-dml', 'bounded-workers'], 'application', 'schema-initialized', 'execution-finished'],
  'browser-qa': ['browser', 'execution', ['database-dml', 'private-http', 'bounded-workers'], 'application', 'schema-initialized', 'execution-finished'],
  'fence-run': ['infrastructure', 'containment', ['process-stop', 'credential-revoke'], 'infrastructure', 'execution-finished', 'fenced'],
  'teardown-run': ['teardown', 'teardown', ['resource-delete'], 'infrastructure', 'fenced', 'torn-down'],
}

function fixture(category = 'transactional-feature-tests') {
  const [lane, phase, scopes, credentialRole, from, to] = operations[category]
  const operation = {category, lane, phase, scopes: [...scopes], artifactDigest: digest}
  const beforeAllocation = ['assess-request', 'allocate-instance'].includes(category)
  const expected = resources()
  if (beforeAllocation) for (const key of ['instanceId', 'containerId', 'volumeId', 'networkId']) expected[key] = null
  const request = {version: 1, requestId: 'qa-request-synthetic', runId: 'qa-run-synthetic', source: source(),
    policy: policyRef(), migration: migration(), operation, resources: expected, issuedAt, expiresAt}
  const provisioning = beforeAllocation ? null : {receiptId: 'qa-receipt-synthetic', authorityId: 'qa-authority-forged-provisioner',
    runId: request.runId, source: source(), policy: policyRef(), migration: migration(), resources: resources(),
    credentials: {applicationRef: 'qa-credential-application', schemaRef: 'qa-credential-schema', verifierRef: 'qa-credential-verifier'},
    issuedAt, expiresAt}
  const approval = category === 'assess-request' ? null : {approvalId: 'qa-approval-synthetic', authorityId: 'qa-authority-forged-approver',
    requestId: request.requestId, runId: request.runId, source: source(), policy: policyRef(), migration: migration(),
    operation: copy(operation), resources: provisioning ? resources() : null, expectedGeneration: 1,
    provisioningReceiptId: provisioning?.receiptId ?? null, credentialRole, nonce: 'qa-nonce-synthetic',
    revoked: false, used: false, issuedAt, expiresAt}
  const runtime = provisioning && !['fence-run', 'teardown-run'].includes(category) ? {
    evidenceId: 'qa-evidence-synthetic', authorityId: 'qa-authority-forged-verifier', runId: request.runId,
    source: source(), policy: policyRef(), migration: migration(), resources: resources(),
    provisioningReceiptId: provisioning.receiptId, observedAt: NOW,
    identity: {systemIdentifier: '1234567890123456789', serverVersionNum: 170000, databaseName: 'dental_clinic_test',
      roleRef: provisioning.credentials[credentialRole === 'schema-owner' ? 'schemaRef' : credentialRole === 'verifier' ? 'verifierRef' : 'applicationRef'], tlsPeerDigest: digest},
    checks: {privateNetwork: true, ownedFreshVolume: true, privilegesMatch: true, configurationMatches: true,
      sourceImmutable: true, schemaMatches: true, unexpectedContent: false},
  } : null
  const revision = from === 'requested' ? 0 : 4
  const transition = {transitionId: 'qa-transition-synthetic', runId: request.runId, expectedGeneration: 1,
    from, to, expectedRevision: revision, nextRevision: revision + 1, previousTransitionId: revision ? 'qa-transition-previous' : null,
    seenTransitionIds: [], seenApprovalIds: [], revokedApprovalIds: [], cleanup: category === 'teardown-run'
      ? {ownerRunId: request.runId, resourceIds: ['qa-instance-synthetic', 'qa-container-synthetic', 'qa-volume-synthetic', 'qa-network-synthetic']} : null}
  return {request, provisioning, approval, runtime, transition}
}
const assess = (value, text = policyText, now = NOW) => assessRuntimeContracts(JSON.stringify(value), text, now)
const codes = result => result.refusals.map(item => item.code)
function blocked(result) {
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.executionAllowed, false)
  assert.equal(result.provisioningAllowed, false)
  assert.ok(codes(result).includes('OFFLINE_ONLY'))
}
function refuses(value, code) { const result = assess(value); blocked(result); assert.ok(codes(result).includes(code), `${code}: ${codes(result)}`); return result }

// Inject the token as raw JSON, not as a JS Number that could round before serialization.
function rawNumber(document, path, token) {
  const value = copy(document), keys = path.split('.'), marker = 'RAW_INTEGER_TEST_MARKER'
  let parent = value
  for (const key of keys.slice(0, -1)) parent = parent[key]
  assert.equal(typeof parent[keys.at(-1)], 'number', path)
  parent[keys.at(-1)] = marker
  return JSON.stringify(value).replace(JSON.stringify(marker), token)
}
function integerRefusal(result) {
  blocked(result); assert.equal(result.checks.consistent, false)
  assert.notEqual(result.checks.transitionPlausible, true)
  assert.ok(codes(result).includes('INVALID_INTEGER_TOKEN'), codes(result).join(','))
}

test('original independent-review generation reproduction refuses the actual fractional token', () => {
  const originalBundleJson = JSON.stringify(fixture())
  const altered = originalBundleJson.replace(
    '"generation":1',
    '"generation":1.0000000000000001'
  )
  integerRefusal(assessRuntimeContracts(altered, policyText, NOW))
})
for (const token of ['1.0000000000000001', '1.00000000000000001', '0.00000000000000001', '1e-400', '1e0', '1.0', '-0',
  '9007199254740992', '9007199254740991.00000000000001', '-1', '0e0', '1E+0', '1e400']) {
  test(`raw noncanonical or inexact integer token refuses: ${token}`, () => {
    integerRefusal(assessRuntimeContracts(rawNumber(fixture(), 'request.resources.generation', token), policyText, NOW))
  })
}
const bundleIntegerPaths = [
  'request.version', 'request.policy.revision', 'request.migration.count', 'request.resources.generation',
  'provisioning.policy.revision', 'provisioning.migration.count', 'provisioning.resources.generation',
  'approval.policy.revision', 'approval.migration.count', 'approval.resources.generation', 'approval.expectedGeneration',
  'runtime.policy.revision', 'runtime.migration.count', 'runtime.resources.generation', 'runtime.identity.serverVersionNum',
  'transition.expectedGeneration', 'transition.expectedRevision', 'transition.nextRevision',
]
const policyIntegerPaths = ['version', 'identity.revision', 'migrations.count', 'limits.requestSeconds', 'limits.approvalSeconds', 'limits.receiptSeconds', 'limits.observationSeconds']
test('explicit integer inventory accounts for every numeric policy and bundle field', () => {
  const collect = (value, prefix = '') => typeof value === 'number' ? [prefix] : value && typeof value === 'object'
    ? Object.entries(value).flatMap(([key, child]) => collect(child, prefix ? prefix + '.' + key : key)) : []
  assert.deepEqual(collect(fixture()).sort(), [...bundleIntegerPaths].sort())
  assert.deepEqual(collect(policy).sort(), [...policyIntegerPaths].sort())
})
for (const path of bundleIntegerPaths) test(`raw numeric ingress covers bundle ${path}`, () => {
  for (const token of ['1.0000000000000001', '1e-400', '9007199254740992']) {
    integerRefusal(assessRuntimeContracts(rawNumber(fixture(), path, token), policyText, NOW))
  }
})
for (const path of policyIntegerPaths) test(`raw numeric ingress covers policy ${path}`, () => {
  for (const token of ['1.0000000000000001', '1e-400', '9007199254740992']) {
    const raw = rawNumber(policy, path, token)
    integerRefusal(assessPolicy(raw)); integerRefusal(assessRuntimeContracts(JSON.stringify(fixture()), raw, NOW))
  }
})
test('matching rounded generations in every binding do not bypass the raw gate', () => {
  const raw = JSON.stringify(fixture()).replaceAll('"generation":1', '"generation":1.0000000000000001')
    .replaceAll('"expectedGeneration":1', '"expectedGeneration":1.0000000000000001')
  assert.equal((raw.match(/1\.0000000000000001/g) || []).length, 6)
  integerRefusal(assessRuntimeContracts(raw, policyText, NOW))
})
test('matching fractional policy limits and manifest counts remain rejected', () => {
  const raw = policyText.replace('"count": 86', '"count": 86.0000000000000001')
    .replace('"requestSeconds": 3600', '"requestSeconds": 3600.0000000000001')
  integerRefusal(assessPolicy(raw))
})
test('canonical integer range is exact before field-specific range validation', () => {
  for (const token of ['9007199254740991', '1000000001']) {
    const r = assessRuntimeContracts(rawNumber(fixture(), 'request.resources.generation', token), policyText, NOW)
    blocked(r); assert.equal(r.checks.consistent, false)
    assert.ok(codes(r).includes('INVALID_VALUE')); assert.ok(!codes(r).includes('INVALID_INTEGER_TOKEN'))
  }
  const f = fixture()
  for (const value of [f.request.resources, f.provisioning.resources, f.approval.resources, f.runtime.resources]) value.generation = 1000000000
  f.approval.expectedGeneration = f.transition.expectedGeneration = 1000000000
  const good = assess(f); blocked(good); assert.equal(good.checks.consistent, true)
})
test('canonical zero works only in the existing permitted revision context', () => {
  const good = assess(fixture('assess-request')); blocked(good); assert.equal(good.checks.consistent, true)
  const bad = assessRuntimeContracts(rawNumber(fixture(), 'request.resources.generation', '0'), policyText, NOW)
  blocked(bad); assert.ok(codes(bad).includes('INVALID_VALUE')); assert.ok(!codes(bad).includes('INVALID_INTEGER_TOKEN'))
})
test('very long integer tokens are refused without converting or echoing them', () => {
  const raw = rawNumber(fixture(), 'request.resources.generation', '9'.repeat(100000))
  const r = assessRuntimeContracts(raw, policyText, NOW); integerRefusal(r); assert.ok(JSON.stringify(r).length < 5000)
})
test('oversized numeric documents remain bounded at the existing byte limit', () => {
  const raw = rawNumber(fixture(), 'request.resources.generation', '9'.repeat(1048577))
  const r = assessRuntimeContracts(raw, policyText, NOW); blocked(r); assert.ok(codes(r).includes('INVALID_JSON_INPUT'))
})
test('numeric-looking JSON strings, escaped quotes and backslashes are never numeric tokens', () => {
  for (const value of ['1.0000000000000001', '1e-400', '-0', '9007199254740992',
    'quote " 1e0 then \\ backslash', '\\" 1.0', '\\\\" -0', '\\\\\\" 1e-400']) {
    const r = assessRuntimeContracts(JSON.stringify(value), policyText, NOW)
    blocked(r); assert.ok(codes(r).includes('INVALID_VALUE')); assert.ok(!codes(r).includes('INVALID_INTEGER_TOKEN'))
    const f = fixture(); f.request.source.repository = value
    const nested = assess(f); blocked(nested); assert.ok(codes(nested).includes('SOURCE_MISMATCH'))
    assert.ok(!codes(nested).includes('INVALID_INTEGER_TOKEN'))
  }
  const escaped = String.raw`"\u0031e-400 \" 1.0 \\"`
  const r = assessRuntimeContracts(escaped, policyText, NOW)
  blocked(r); assert.ok(codes(r).includes('INVALID_VALUE')); assert.ok(!codes(r).includes('INVALID_INTEGER_TOKEN'))
})
test('a quoted uint64 system identifier retains its existing exact string contract', () => {
  const f = fixture(); f.runtime.identity.systemIdentifier = '18446744073709551615'
  const r = assess(f); blocked(r); assert.equal(r.checks.consistent, true)
  assert.ok(!codes(r).includes('INVALID_INTEGER_TOKEN'))
})
test('Unicode-escaped quotes and backslashes cannot hide a following numeric token', () => {
  for (const text of [String.raw`["\u005c",1.0]`, String.raw`["\u0022 1e-400",-0]`]) {
    integerRefusal(assessRuntimeContracts(text, policyText, NOW))
  }
})
test('a matching numeric string does not hide the actual invalid numeric binding', () => {
  const f = fixture(); f.request.source.repository = '1.0000000000000001'
  integerRefusal(assessRuntimeContracts(rawNumber(f, 'approval.expectedGeneration', '1.0000000000000001'), policyText, NOW))
})
test('quoted decimal text cannot hide a number after a closing quote', () => {
  for (const text of [String.raw`["escaped \\" ,1.0000000000000001]`, String.raw`["escaped quote \" still inside",1e-400]`]) {
    integerRefusal(assessRuntimeContracts(text, policyText, NOW))
  }
})
test('canonical nested array/object numbers still reach strict shape validation', () => {
  const r = assessRuntimeContracts('{"extra":[0,1,{"nested":1000000000}]}', policyText, NOW)
  blocked(r); assert.ok(codes(r).includes('UNKNOWN_FIELD')); assert.ok(!codes(r).includes('INVALID_INTEGER_TOKEN'))
  integerRefusal(assessRuntimeContracts('{"extra":[0,{"nested":1e-400}]}', policyText, NOW))
})
test('the original strict parser still rejects malformed documents and duplicate keys', () => {
  for (const text of ['{"x":01}', '{"x":1.}', '{"x":1e}', '[1,]', '{"x":}', '"unterminated 1e-400', String.raw`"bad\q 1e-400"`]) {
    const r = assessRuntimeContracts(text, policyText, NOW); blocked(r); assert.ok(codes(r).includes('MALFORMED_JSON'), codes(r).join(','))
  }
  for (const text of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}']) {
    const r = assessRuntimeContracts(text, policyText, NOW); blocked(r); assert.ok(codes(r).includes('DUPLICATE_JSON_KEY'))
  }
})
test('raw integer refusals remain deeply frozen and omit input values', () => {
  const token = '1.0000000000000001', r = assessRuntimeContracts(rawNumber(fixture(), 'request.resources.generation', token), policyText, NOW)
  integerRefusal(r); assert.ok(Object.isFrozen(r)); assert.ok(Object.isFrozen(r.refusals)); assert.ok(Object.isFrozen(r.refusals.at(-1)))
  assert.ok(!JSON.stringify(r).includes(token))
})

test('development policy has valid structure and no authenticated authority', () => {
  const result = assessPolicy(policyText)
  blocked(result); assert.equal(result.checks.structures.policy, true); assert.equal(result.checks.consistent, true)
  assert.ok(codes(result).includes('POLICY_UNAUTHENTICATED')); assert.ok(codes(result).includes('MIGRATION_CHAIN_HELD'))
})
test('complete, self-consistent forged evidence is structurally valid and permanently blocked', () => {
  const result = assess(fixture())
  blocked(result); assert.equal(result.checks.consistent, true); assert.equal(result.checks.transitionPlausible, true)
  assert.deepEqual(Object.values(result.checks.structures), [true, true, true, true, true, true])
  for (const code of ['PROVISIONER_UNAUTHENTICATED', 'APPROVAL_UNAUTHENTICATED', 'RUNTIME_UNVERIFIED', 'REPLAY_LEDGER_REQUIRED', 'TRUSTED_CLOCK_REQUIRED']) assert.ok(codes(result).includes(code))
})
test('request-only assessment accepts nullable evidence without manufacturing it', () => {
  const f = fixture('assess-request'); f.transition = null
  const result = assess(f); blocked(result); assert.equal(result.checks.consistent, true)
  assert.equal(result.checks.structures.provisioning, null); assert.equal(result.checks.transitionPlausible, null)
})
for (const category of Object.keys(operations)) test(`planned ${category} edge is only a blocked declaration`, () => {
  const result = assess(fixture(category)); blocked(result)
  assert.equal(result.checks.consistent, true); assert.equal(result.checks.transitionPlausible, true)
})

const mutations = [
  ['missing run', f => { delete f.request.runId }, 'MISSING_FIELD'],
  ['wrong source', f => { f.request.source.commit = 'd'.repeat(40) }, 'SOURCE_MISMATCH'],
  ['wrong repository', f => { f.request.source.repository = 'https://example.invalid/forged' }, 'SOURCE_MISMATCH'],
  ['wrong policy revision', f => { f.request.policy.revision++ }, 'POLICY_MISMATCH'],
  ['wrong policy digest', f => { f.request.policy.digest = digest }, 'POLICY_MISMATCH'],
  ['wrong migration', f => { f.request.migration.orderedDigest = digest }, 'MIGRATION_MISMATCH'],
  ['wrong migration count', f => { f.request.migration.count-- }, 'MIGRATION_MISMATCH'],
  ['wrong migration source', f => { f.request.migration.sourceCommit = 'd'.repeat(40) }, 'MIGRATION_MISMATCH'],
  ['missing migration', f => { delete f.request.migration }, 'MISSING_FIELD'],
  ['unknown operation', f => { f.request.operation.category = 'unknown' }, 'OPERATION_UNKNOWN'],
  ['destructive operation', f => { f.request.operation.category = 'schema-reset' }, 'OPERATION_DENIED'],
  ['raw shell operation', f => { f.request.operation.category = 'raw-shell' }, 'OPERATION_DENIED'],
  ['unknown lane', f => { f.request.operation.lane = 'unknown' }, 'OPERATION_SCOPE_MISMATCH'],
  ['unknown phase', f => { f.request.operation.phase = 'unknown' }, 'OPERATION_SCOPE_MISMATCH'],
  ['wrong scope', f => { f.request.operation.scopes.push('schema-ddl') }, 'OPERATION_SCOPE_MISMATCH'],
  ['wrong approval scope', f => { f.approval.operation.scopes = ['schema-ddl'] }, 'APPROVAL_BINDING_MISMATCH'],
  ['wrong artifact', f => { f.approval.operation.artifactDigest = 'b'.repeat(64) }, 'APPROVAL_BINDING_MISMATCH'],
  ['wrong receipt source', f => { f.provisioning.source.buildDigest = digest }, 'PROVISIONING_BINDING_MISMATCH'],
  ['wrong receipt generation', f => { f.provisioning.resources.generation++ }, 'PROVISIONING_BINDING_MISMATCH'],
  ['wrong receipt run', f => { f.provisioning.runId = 'qa-run-other' }, 'PROVISIONING_BINDING_MISMATCH'],
  ['wrong owner', f => { f.request.resources.ownerRunId = 'qa-run-other' }, 'OWNERSHIP_MISMATCH'],
  ['conflicting authorities', f => { f.approval.authorityId = f.provisioning.authorityId }, 'AUTHORITY_CONFLICT'],
  ['duplicate evidence identifiers', f => { f.runtime.evidenceId = f.provisioning.receiptId }, 'DUPLICATE_VALUE'],
  ['wrong volume', f => { f.provisioning.resources.volumeId = 'qa-volume-other' }, 'PROVISIONING_BINDING_MISMATCH'],
  ['missing credential', f => { delete f.provisioning.credentials.schemaRef }, 'MISSING_FIELD'],
  ['duplicate credentials', f => { f.provisioning.credentials.schemaRef = f.provisioning.credentials.applicationRef }, 'DUPLICATE_VALUE'],
  ['bad image digest', f => { f.request.resources.imageDigest = 'postgres:latest' }, 'INVALID_VALUE'],
  ['different image', f => { f.provisioning.resources.imageDigest = 'sha256:' + 'b'.repeat(64) }, 'PROVISIONING_BINDING_MISMATCH'],
  ['expired approval', f => { f.approval.issuedAt = '2026-11-12T03:40:00Z'; f.approval.expiresAt = '2026-11-12T03:50:00Z' }, 'STALE_EVIDENCE'],
  ['future approval', f => { f.approval.issuedAt = '2026-11-12T04:01:00Z' }, 'INVALID_LIFETIME'],
  ['replayed approval', f => { f.approval.used = true }, 'APPROVAL_REPLAY_DECLARED'],
  ['seen approval', f => { f.transition.seenApprovalIds.push(f.approval.approvalId) }, 'APPROVAL_REPLAY_DECLARED'],
  ['revoked approval', f => { f.approval.revoked = true }, 'APPROVAL_REVOKED_DECLARED'],
  ['listed revoked approval', f => { f.transition.revokedApprovalIds.push(f.approval.approvalId) }, 'APPROVAL_REVOKED_DECLARED'],
  ['wrong approval role', f => { f.approval.credentialRole = 'schema-owner' }, 'APPROVAL_BINDING_MISMATCH'],
  ['wrong approval generation', f => { f.approval.expectedGeneration++ }, 'APPROVAL_BINDING_MISMATCH'],
  ['wrong approval receipt', f => { f.approval.provisioningReceiptId = 'qa-receipt-other' }, 'APPROVAL_BINDING_MISMATCH'],
  ['wrong runtime generation', f => { f.runtime.resources.generation++ }, 'RUNTIME_BINDING_MISMATCH'],
  ['wrong runtime role', f => { f.runtime.identity.roleRef = 'qa-credential-other' }, 'RUNTIME_BINDING_MISMATCH'],
  ['unsafe runtime check', f => { f.runtime.checks.privateNetwork = false }, 'RUNTIME_CHECK_FAILED'],
  ['unexpected existing content', f => { f.runtime.checks.unexpectedContent = true }, 'RUNTIME_CHECK_FAILED'],
  ['stale runtime', f => { f.provisioning.issuedAt = '2026-11-12T03:53:00Z'; f.provisioning.expiresAt = '2026-11-12T04:08:00Z'; f.runtime.observedAt = '2026-11-12T03:54:59Z' }, 'STALE_EVIDENCE'],
  ['unknown lifecycle state', f => { f.transition.to = 'unknown' }, 'INVALID_VALUE'],
  ['skipped lifecycle phase', f => { f.transition.from = 'allocated' }, 'ILLEGAL_TRANSITION'],
  ['wrong lifecycle generation', f => { f.transition.expectedGeneration++ }, 'TRANSITION_BINDING_MISMATCH'],
  ['wrong lifecycle run', f => { f.transition.runId = 'qa-run-other' }, 'TRANSITION_BINDING_MISMATCH'],
  ['wrong revision', f => { f.transition.nextRevision += 2 }, 'REVISION_MISMATCH'],
  ['missing history revision', f => { f.transition.previousTransitionId = null }, 'REVISION_MISMATCH'],
  ['repeated transition', f => { f.transition.seenTransitionIds.push(f.transition.transitionId) }, 'TRANSITION_REPLAY_DECLARED'],
  ['duplicate transition history', f => { f.transition.seenTransitionIds = ['qa-transition-old', 'qa-transition-old'] }, 'DUPLICATE_VALUE'],
  ['missing provisioning', f => { f.provisioning = null }, 'EVIDENCE_REQUIRED'],
  ['missing approval', f => { f.approval = null }, 'EVIDENCE_REQUIRED'],
  ['missing runtime', f => { f.runtime = null }, 'EVIDENCE_REQUIRED'],
  ['force override', f => { f.force = true }, 'UNKNOWN_FIELD'],
  ['trust override', f => { f.approval.authenticated = true }, 'UNKNOWN_FIELD'],
  ['nested override', f => { f.runtime.identity.password = 'synthetic-secret-sentinel' }, 'UNKNOWN_FIELD'],
  ['command array', f => { f.request.operation.argv = ['php', 'artisan'] }, 'UNKNOWN_FIELD'],
  ['wrong primitive', f => { f.request.resources.generation = '1' }, 'INVALID_VALUE'],
  ['unsafe integer', f => { f.request.resources.generation = Number.MAX_SAFE_INTEGER + 1 }, 'INVALID_INTEGER_TOKEN'],
  ['invalid timestamp', f => { f.approval.expiresAt = '2026-02-30T04:09:00Z' }, 'INVALID_VALUE'],
  ['noncanonical timestamp', f => { f.approval.expiresAt = '2026-11-12T12:09:00+08:00' }, 'INVALID_VALUE'],
  ['newline identifier', f => { f.request.runId += '\n' }, 'INVALID_VALUE'],
  ['schema injection', f => { f.request.$ref = '#/approved' }, 'UNKNOWN_FIELD'],
]
for (const [name, change, code] of mutations) test(name, () => { const f = fixture(); change(f); const r = refuses(f, code); assert.equal(r.checks.consistent, false) })

test('teardown requires exact owned resources and explicit cleanup scope', () => {
  const f = fixture('teardown-run'); f.transition.cleanup.resourceIds[0] = 'qa-instance-other'
  refuses(f, 'TEARDOWN_SCOPE_MISMATCH')
  f.transition.cleanup = null; refuses(f, 'TEARDOWN_SCOPE_MISMATCH')
})
test('cleanup cannot be smuggled into another phase', () => {
  const f = fixture(); f.transition.cleanup = fixture('teardown-run').transition.cleanup
  refuses(f, 'TEARDOWN_SCOPE_MISMATCH')
})
test('allocation approval binds a generation without pretending resources already exist', () => {
  const f = fixture('allocate-instance'); f.request.resources.volumeId = 'qa-volume-existing'
  refuses(f, 'RESOURCE_PHASE_MISMATCH')
})
test('all 640 operation/state pairs preserve the explicit graph and permanent refusal', () => {
  let legal = 0, illegal = 0
  for (const category of Object.keys(operations)) for (const from of policy.vocabulary.states) for (const to of policy.vocabulary.states) {
    const f = fixture(category)
    Object.assign(f.transition, {from, to, expectedRevision: from === 'requested' ? 0 : 4,
      nextRevision: from === 'requested' ? 1 : 5, previousTransitionId: from === 'requested' ? null : 'qa-transition-previous'})
    const expected = to === operations[category][5] && (category === 'fence-run'
      ? ['allocated', 'identity-verified', 'schema-initialized', 'execution-finished'].includes(from) : from === operations[category][4])
    const result = assess(f); blocked(result)
    assert.equal(result.checks.transitionPlausible, expected, `${category}: ${from} -> ${to}`)
    assert.equal(result.checks.consistent, expected)
    if (expected) legal++; else { illegal++; assert.ok(codes(result).includes('ILLEGAL_TRANSITION')) }
  }
  assert.deepEqual([legal, illegal], [13, 627])
})
test('a matching forged resource generation still cannot establish current infrastructure', () => {
  const f = fixture()
  for (const value of [f.request.resources, f.provisioning.resources, f.approval.resources, f.runtime.resources]) value.generation = 444
  f.approval.expectedGeneration = f.transition.expectedGeneration = 444
  const result = assess(f); blocked(result); assert.equal(result.checks.consistent, true)
  assert.equal(result.trust.provisioning, 'unauthenticated')
})
test('policy object key order does not change its canonical binding', () => {
  const reordered = Object.fromEntries(Object.entries(policy).reverse())
  const result = assess(fixture(), JSON.stringify(reordered)); blocked(result); assert.equal(result.checks.consistent, true)
})
test('revocation, failed runtime checks and invalid scopes cannot report a plausible transition', () => {
  for (const change of [f => { f.approval.revoked = true }, f => { f.runtime.checks.configurationMatches = false }, f => { f.request.operation.scopes = [] }]) {
    const f = fixture(); change(f); const result = assess(f); blocked(result)
    assert.equal(result.checks.transitionPlausible, false)
  }
})
test('approval must cover the requested lifetime, and a same-state transition is refused', () => {
  const f = fixture(); f.approval.expiresAt = '2026-11-12T04:01:00Z'; refuses(f, 'APPROVAL_BINDING_MISMATCH')
  f.approval.expiresAt = expiresAt; f.transition.to = f.transition.from; refuses(f, 'ILLEGAL_TRANSITION')
})
test('runtime observation cannot predate its provisioning record', () => {
  const f = fixture(); f.runtime.observedAt = '2026-11-12T03:58:59Z'; refuses(f, 'INVALID_LIFETIME')
})
test('request and approval lifetimes cannot exceed hard contract bounds', () => {
  const f = fixture(); f.request.expiresAt = '2026-11-12T05:30:00Z'; refuses(f, 'INVALID_LIFETIME')
  f.request.expiresAt = expiresAt; f.approval.expiresAt = '2026-11-12T05:30:00Z'; refuses(f, 'INVALID_LIFETIME')
})

for (const [name, change, code] of [
  ['unknown field', p => { p.override = true }, 'UNKNOWN_FIELD'],
  ['unsupported boolean schema', p => { p.$defs = {allow: false} }, 'UNKNOWN_FIELD'],
  ['ref sibling construct', p => { p.$ref = '#/anything'; p.const = true }, 'UNKNOWN_FIELD'],
  ['removed hold', p => { p.migrations.holds.pop() }, 'MIGRATION_HOLD_MISMATCH'],
  ['changed held hash', p => { p.migrations.holds[0].sha256 = digest }, 'MIGRATION_HOLD_MISMATCH'],
  ['renamed held path', p => { p.migrations.holds[0].path = 'backend/database/migrations/renamed.php' }, 'MIGRATION_HOLD_MISMATCH'],
  ['approved chain claim', p => { p.migrations.decision = 'approved' }, 'INVALID_VALUE'],
  ['policy revision change', p => { p.identity.revision++ }, 'POLICY_MISMATCH'],
  ['source change', p => { p.source.reviewedCommit = 'd'.repeat(40) }, 'SOURCE_MISMATCH'],
  ['weakened constraint', p => { p.constraints.privateNetworkOnly = false }, 'INVALID_VALUE'],
  ['forged installation', p => { p.installation.approvalAuthority = 'qa-authority-forged' }, 'INVALID_VALUE'],
  ['changed phase vocabulary', p => { p.vocabulary.phases.push('force') }, 'POLICY_MISMATCH'],
  ['removed denied operation', p => { p.deniedOperations.pop() }, 'POLICY_MISMATCH'],
  ['increased lifetime limit', p => { p.limits.requestSeconds++ }, 'INVALID_VALUE'],
]) test(`policy ${name}`, () => {
  const p = copy(policy); change(p); const result = assessPolicy(JSON.stringify(p)); blocked(result); assert.ok(codes(result).includes(code), codes(result).join(','))
})

const serializedAttacks = [
  ['empty', '', 'MALFORMED_JSON'], ['incomplete', '{', 'MALFORMED_JSON'],
  ['trailing content', JSON.stringify(fixture()) + 'true', 'MALFORMED_JSON'],
  ['duplicate root key', '{"request":null,"request":null}', 'DUPLICATE_JSON_KEY'],
  ['decoded equivalent key', '{"runId":1,"r\\u0075nId":2}', 'DUPLICATE_JSON_KEY'],
  ['nested duplicate', '{"request":{"x":1,"x":2}}', 'DUPLICATE_JSON_KEY'],
  ['prototype key', '{"__proto__":{"approved":true}}', 'UNSUPPORTED_FIELD'],
  ['escaped constructor', '{"constr\\u0075ctor":{}}', 'UNSUPPORTED_FIELD'],
  ['nonfinite number', '{"request":1e400}', 'INVALID_INTEGER_TOKEN'],
  ['invalid escape', '{"request":"\\q"}', 'MALFORMED_JSON'],
  ['unpaired surrogate', '{"request":"\\ud800"}', 'MALFORMED_JSON'],
  ['deep nesting', '['.repeat(26) + '0' + ']'.repeat(26), 'JSON_LIMIT_EXCEEDED'],
  ['oversized document', ' '.repeat(1048577), 'INVALID_JSON_INPUT'],
  ['array root', '[]', 'INVALID_VALUE'], ['primitive root', 'false', 'INVALID_VALUE'],
]
for (const [name, text, code] of serializedAttacks) test(`serialized ${name}`, () => {
  const result = assessRuntimeContracts(text, policyText, NOW); blocked(result); assert.ok(codes(result).includes(code), codes(result).join(','))
})
test('executable inputs, extra arguments and invalid clocks fail without invoking hooks', () => {
  const hostile = {toString() { throw Error('synthetic-secret-sentinel') }}
  for (const value of [hostile, () => {}, Symbol('synthetic-secret-sentinel'), null, undefined]) {
    const result = assessRuntimeContracts(value, policyText, NOW); blocked(result); assert.ok(codes(result).includes('INVALID_JSON_INPUT'))
  }
  const override = assessRuntimeContracts(JSON.stringify(fixture()), policyText, NOW, {force: true})
  blocked(override); assert.ok(codes(override).includes('UNSUPPORTED_ARGUMENTS'))
  assert.ok(codes(assessRuntimeContracts(JSON.stringify(fixture()), policyText, 'not-a-clock')).includes('INVALID_CLOCK'))
  assert.ok(codes(assessPolicy(policyText, true)).includes('UNSUPPORTED_ARGUMENTS'))
})
test('policy parser rejects boolean roots and decoded duplicate authority keys', () => {
  for (const text of ['false', 'true', 'null', '[]']) { const result = assessPolicy(text); blocked(result); assert.ok(codes(result).includes('INVALID_VALUE')) }
  const result = assessPolicy('{"installation":null,"install\\u0061tion":null}')
  blocked(result); assert.ok(codes(result).includes('DUPLICATE_JSON_KEY'))
})
test('node count and string well-formedness remain bounded', () => {
  for (const [text, code] of [['[' + Array(25001).fill('0').join(',') + ']', 'JSON_LIMIT_EXCEEDED'], ['"' + '\ud800' + '"', 'INVALID_JSON_INPUT']]) {
    const result = assessRuntimeContracts(text, policyText, NOW); blocked(result); assert.ok(codes(result).includes(code))
  }
})
test('per-field type refusal applies across request, policy, evidence and lifecycle records', () => {
  for (const key of ['request', 'provisioning', 'approval', 'runtime', 'transition']) for (const value of [false, [], 1, 'synthetic']) {
    const f = fixture(); f[key] = value; refuses(f, 'INVALID_VALUE')
  }
  const result = assessRuntimeContracts(JSON.stringify(fixture()), 'false', NOW); blocked(result); assert.equal(result.checks.consistent, false)
})
test('input values and unknown property names never appear in bounded diagnostics', () => {
  const sentinel = 'SYNTHETIC_SECRET_DO_NOT_EXPORT_7f04'
  const f = fixture(); f.approval[sentinel] = sentinel; f.request.runId = sentinel
  for (const result of [assess(f), assessRuntimeContracts('{"' + sentinel, policyText, NOW), assessPolicy('{"' + sentinel + '":true}')]) {
    blocked(result); assert.ok(!JSON.stringify(result).includes(sentinel)); assert.ok(result.refusals.length <= 64)
  }
})
test('assessments are deterministic, deeply frozen and never consume a real lease', () => {
  const f = fixture(), one = assess(f), two = assess(f)
  assert.deepEqual(one, two); assert.ok(Object.isFrozen(one)); assert.ok(Object.isFrozen(one.checks.structures)); assert.ok(Object.isFrozen(one.refusals[0]))
  assert.throws(() => { one.executionAllowed = true }, TypeError)
  assert.ok(!('lease' in one)); assert.ok(!('token' in one)); assert.ok(!('nextState' in one)); blocked(two)
})
test('old offline assessment remains blocked and original migration bytes match every hold', () => {
  blocked(assess(fixture('initialize-schema')))
  const old = assessOffline('{}', '{}', NOW)
  assert.equal(old.status, 'BLOCKED'); assert.equal(old.executionAllowed, false); assert.equal(old.provisioningAllowed, false)
  for (const hold of policy.migrations.holds) assert.equal(hash(fs.readFileSync(new URL('../../' + hold.path, import.meta.url))), hold.sha256)
  const oldSource = fs.readFileSync(new URL('../clinic-simulation/preflight.mjs', import.meta.url), 'utf8')
  for (const hold of policy.migrations.holds) assert.ok(oldSource.includes(hold.sha256))
})
test('production import closure contains only fixed parser, crypto, URL and path builtins', () => {
  const code = fs.readFileSync(new URL('./contracts.mjs', import.meta.url), 'utf8')
  const imports = [...code.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map(match => match[1]).sort()
  assert.deepEqual(imports, ['../clinic-simulation/strict-json.mjs', 'node:crypto', 'node:path', 'node:url'].sort())
  const parser = fs.readFileSync(new URL('../clinic-simulation/strict-json.mjs', import.meta.url), 'utf8')
  assert.ok(!/^import /m.test(parser)); assert.ok(!/\bimport\s*\(|\brequire\s*\(|\beval\s*\(|\bFunction\s*\(/.test(code + parser))
  assert.ok(!/process\.env|bootstrap\/app\.php|artisan|fetch\s*\(/.test(code))
})
test('module import and all public assessments cannot launch, connect or mutate files', async () => {
  const traps = [[cp, ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']],
    [net, ['connect', 'createConnection', 'createServer']], [tls, ['connect', 'createServer']],
    [http, ['request', 'get', 'createServer']], [https, ['request', 'get', 'createServer']],
    [dns, ['lookup', 'resolve']], [fs, ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'unlinkSync', 'renameSync', 'truncateSync']]]
  let effects = 0
  const originalOpen = fs.openSync
  try {
    for (const [object, names] of traps) for (const name of names) mock.method(object, name, () => { effects++; throw Error('forbidden effect') })
    // The ESM loader may read source. Deny write/create/truncate opens, not those loader reads.
    mock.method(fs, 'openSync', (...args) => {
      const flags = args[1]
      if (typeof flags === 'number' ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) !== 0 : !['r', 'rs'].includes(flags)) {
        effects++; throw Error('forbidden write open')
      }
      return originalOpen(...args)
    })
    mock.method(globalThis, 'fetch', () => { effects++; throw Error('forbidden effect') })
    syncBuiltinESMExports()
    const module = await import('./contracts.mjs?nonexecution-probe')
    blocked(module.assessPolicy(policyText)); blocked(module.assessRuntimeContracts(JSON.stringify(fixture()), policyText, NOW))
    blocked(module.assessRuntimeContracts('invalid', policyText, NOW)); assert.equal(effects, 0)
  } finally { mock.restoreAll(); syncBuiltinESMExports() }
})

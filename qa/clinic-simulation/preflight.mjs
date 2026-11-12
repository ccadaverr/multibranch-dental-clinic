import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {canonicalJson,DescriptorError,parseStrictJson} from './strict-json.mjs'
import {assertSchemaVocabulary,schemaIssues} from './schema-validation.mjs'
import {allowedArtifactPath,fileListDigest,observeWorkspace,safeRelativePath} from './workspace-snapshot.mjs'

// Importing this module reads this one public schema only. No main/CLI dispatcher, hooks or execution callback.
const schema = parseStrictJson(readFileSync(new URL('./run-manifest.schema.json',import.meta.url),'utf8'))
assertSchemaVocabulary(schema)
const BASELINE = '15d626c03c97baf7198a7b7ca6dea2bec8f60836'
const BASELINE_CHAIN = 'f565b8e643f41787575f8d54c0be5d0c33b81aeaa35f4844b4527c5ba13ee1ff'
// Source-reviewed holds, content-addressed as well as full-chain pinned. Renaming cannot remove a hold.
const HELD_CONTENT = new Set([
  '16b5eaddf6a725791fb74ef9a0d04b25187ba0e006fa885b7cd452df6feaed40', // queue conversion
  '3c8af7cb8126866af3d67107bdd792960b5389922c762a09f6c08781db5b6df9', // feedback deletion
  '36f0fa951bc7c612f87ba47e40307729e96e8d222d6fcc019dd7acb2dd249181', // chart trigger bypass
  '921a1dcfdfd321569ebcff08dcd72a069e32fb50bddc9c360af3ca795809711f', // concurrent indexes
])
const operations = Object.freeze({
  'feature-tests':{lanes:['workflow','schema'],prefix:'backend/tests/Feature/',capabilities:['database']},
  'migration-manifest':{lanes:['schema'],prefix:null,capabilities:['database','ddl']},
  'schema-reset':{lanes:['schema'],prefix:null,capabilities:['database','ddl','reset']},
  'reference-seeder':{lanes:['seed'],prefix:'backend/database/seeders/',capabilities:['database','seed']},
  'contention-worker':{lanes:['contention'],prefix:'backend/tests/Support/',capabilities:['database','multiple-processes']},
  'outbox-worker':{lanes:['outbox'],prefix:'backend/tests/Support/',capabilities:['database','background-jobs']},
})
const messages = Object.freeze({
  INVALID_JSON_INPUT:'Provide bounded JSON text, not executable objects or oversized input.',
  MALFORMED_JSON:'JSON syntax is invalid; input excerpts are deliberately omitted.',
  JSON_LIMIT_EXCEEDED:'JSON nesting or item limits were exceeded.',
  DUPLICATE_JSON_KEY:'A decoded JSON property occurs more than once.',
  DUPLICATE_EVIDENCE:'Duplicate evidence is not accepted.',
  UNSUPPORTED_FIELD:'An undocumented field or override is not supported.',
  MISSING_EVIDENCE:'Required evidence is missing.',
  INVALID_EVIDENCE:'An evidence field has an unsupported shape or value.',
  SOURCE_MISMATCH:'Source declarations do not match the reviewed baseline and observation.',
  TARGET_MISMATCH:'Database target declarations conflict.',
  CONFIGURATION_DRIFT:'Connection configuration does not exactly match the proposed profile.',
  PATH_UNSAFE:'A resource path is unsupported, traverses outside its scope or resolves through a symlink.',
  PATH_UNOBSERVED:'Every requested path needs its own matching read-only observation.',
  OWNERSHIP_MISMATCH:'Run and cleanup resource ownership declarations conflict.',
  INFRASTRUCTURE_IDENTITY_MISSING:'Explicit run-owned instance, volume and network identifiers are required.',
  PROVENANCE_MISSING:'Distinct evidence references and issuer provenance are required.',
  INVALID_LIFETIME:'Evidence times are invalid, future-dated or exceed the permitted offline lifetime.',
  STALE_EVIDENCE:'Evidence or its observation has expired.',
  APPROVAL_SCOPE_MISMATCH:'Approval declarations do not cover this exact source, target, operator, lane and operation.',
  COMMAND_UNSUPPORTED:'Only explicit typed operation descriptors are supported; raw commands are refused.',
  COMMAND_AMBIGUOUS:'The descriptor combines unsupported command capabilities.',
  LANE_MISMATCH:'The operation is not supported in this declared lane.',
  CAPABILITY_MISMATCH:'Declared capabilities do not exactly match the inspected operation.',
  PRIVILEGE_BOUNDARY_MISSING:'The declared credential privilege class is incompatible with the lane.',
  ENVIRONMENT_UNSAFE:'Inherited sensitive variables or private application environment files are present.',
  CACHE_PROVENANCE_UNKNOWN:'Configuration-cache absence has not been observed.',
  LEGACY_PROFILE_CONFLICT:'Existing Laravel test configuration disagrees with this proposed isolated profile.',
  MIGRATION_INVENTORY_INVALID:'The migration inventory is incomplete, duplicated, unordered or contains an unsupported path.',
  MIGRATION_MANIFEST_MISMATCH:'Migration source, content hashes, risk metadata or digest differs from the observation.',
  UNREVIEWED_MIGRATION_CHAIN:'This migration inventory differs from the source-reviewed baseline; new review is required.',
  KNOWN_MIGRATION_HOLD:'The observed inventory contains a content-addressed migration safety hold; do not skip it.',
  MIGRATION_APPROVAL_MISSING:'An explicitly reviewed per-file schema policy has not even been declared.',
  WORKSPACE_OBSERVATION_FAILED:'The read-only workspace observation could not be completed.',
  SOURCE_FILE_UNSAFE:'A public source resource is not a bounded regular file.',
  SOURCE_CHANGED_DURING_READ:'A source resource changed while it was being inspected.',
  SOURCE_IDENTITY_DECLARED_ONLY:'Git identity fields remain declarations; this module does not authenticate a commit/worktree.',
  PROVISIONING_PROVENANCE_UNVERIFIED:'No trusted provisioning mechanism is registered; a manifest is not disposability proof.',
  APPROVAL_PROVENANCE_UNVERIFIED:'Approval declarations are not independently authenticated authorization.',
  SCHEMA_POLICY_UNAPPROVED:'There is no approved schema/migration registry in this candidate.',
  RUNTIME_IDENTITY_REQUIRED:'Actual server identity, privileges, isolation and emptiness remain unverified.',
  BOOTSTRAP_BOUNDARY_UNINTEGRATED:'A separately reviewed execution boundary and runtime handoff are not implemented.',
  NO_EXECUTION_CAPABILITY:'This offline component cannot provision, launch commands or grant execution permission.',
})
const permanent = ['SOURCE_IDENTITY_DECLARED_ONLY','PROVISIONING_PROVENANCE_UNVERIFIED','APPROVAL_PROVENANCE_UNVERIFIED','SCHEMA_POLICY_UNAPPROVED','RUNTIME_IDENTITY_REQUIRED','BOOTSTRAP_BOUNDARY_UNINTEGRATED','NO_EXECUTION_CAPABILITY']
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze);Object.freeze(value) } return value }
const same = (a,b) => canonicalJson(a) === canonicalJson(b)
const sameSet = (a,b) => same([...a].sort(),[...b].sort())
function instant(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test(value)) return NaN
  const stamp = Date.parse(value)
  return Number.isFinite(stamp) && new Date(stamp).toISOString() === value.replace('Z','.000Z') ? stamp : NaN
}

/** Strict offline consistency assessment of UNTRUSTED JSON. A true consistency check is never permission.
 * No dependency injection callbacks, trust override, command string, credentials or runtime handles are accepted.
 */
export function assessOffline(manifestJson,snapshotJson,nowIso = new Date().toISOString().replace(/\.\d{3}Z$/,'Z')) {
  const findings = [], add = (code,location='',stage='consistency') => findings.push({code,location,stage,message:messages[code]})
  for (const code of permanent) add(code,'','boundary')
  const checks = {descriptorValid:false,snapshotValid:false,consistent:false}
  const finish = () => freeze({status:'BLOCKED',executionAllowed:false,provisioningAllowed:false,checks,
    trust:{sourceIdentity:'declared-only',provisioning:'unverified',approval:'unverified',runtime:'not-checked'},
    refusals:findings.filter((x,i,a) => a.findIndex(y => y.code === x.code && y.location === x.location) === i)})
  if (arguments.length > 3) { add('UNSUPPORTED_FIELD','','shape');return finish() }
  let manifest,snapshot
  try { manifest = parseStrictJson(manifestJson);snapshot = parseStrictJson(snapshotJson) }
  catch (e) { add(e instanceof DescriptorError?e.code:'INVALID_JSON_INPUT','','shape');return finish() }
  const m = schemaIssues(manifest,schema), s = schemaIssues(snapshot,{$ref:'#/$defs/snapshot'},schema)
  checks.descriptorValid = m.length === 0;checks.snapshotValid = s.length === 0
  for (const issue of m) add(issue.code,'/manifest'+issue.location,'shape')
  for (const issue of s) add(issue.code,'/snapshot'+issue.location,'shape')
  if (m.length || s.length) return finish()
  const r = manifest.request, p = manifest.provisioningEvidence, a = manifest.approval, ma = manifest.migrationApproval
  const now = instant(nowIso)
  if (!Number.isFinite(now)) { add('INVALID_LIFETIME');return finish() }
  const lifetime = (e,maxSeconds,location) => {
    const issued = instant(e.issuedAt), expires = instant(e.expiresAt)
    if (![issued,expires].every(Number.isFinite) || issued > now || expires <= issued || expires-issued > maxSeconds*1000) add('INVALID_LIFETIME',location)
    else if (expires <= now) add('STALE_EVIDENCE',location)
  }
  lifetime(p,900,'/provisioningEvidence');lifetime(a,1800,'/approval');lifetime(ma,1800,'/migrationApproval')
  const captured = instant(snapshot.capturedAt)
  if (!Number.isFinite(captured) || captured > now) add('INVALID_LIFETIME','/snapshot/capturedAt')
  else if (now-captured > 300000) add('STALE_EVIDENCE','/snapshot/capturedAt')
  if (!same(r.source,snapshot.source) || r.source.commit !== BASELINE) add('SOURCE_MISMATCH')
  if (r.workspaceRoot !== snapshot.workspaceRoot || !r.workspaceRoot.startsWith('/') || r.workspaceRoot.includes('/../') || r.workspaceRoot.includes('/./')) add('PATH_UNSAFE')
  if (!same(r.target,p.target)) add('TARGET_MISMATCH')
  if (r.configuration.default !== 'pgsql' || !same(r.configuration.connections,{pgsql:r.target})) add('CONFIGURATION_DRIFT')
  if (!/^qa-run-[a-z0-9-]+$/.test(r.runId) || !/^qa-instance-[a-z0-9-]+$/.test(p.instanceId) || !/^qa-volume-[a-z0-9-]+$/.test(p.volumeId) || !/^qa-network-[a-z0-9-]+$/.test(p.networkId)) add('INFRASTRUCTURE_IDENTITY_MISSING')
  const resources = [p.instanceId,p.volumeId,p.networkId]
  if (p.runId !== r.runId || r.cleanup.ownerRunId !== r.runId || !sameSet(resources,r.cleanup.resourceIds)) add('OWNERSHIP_MISMATCH')
  const evidenceIds = [p.provenance.evidenceId,a.provenance.evidenceId,ma.provenance.evidenceId]
  if (new Set(evidenceIds).size !== evidenceIds.length) add('PROVENANCE_MISSING')
  if (snapshot.environment.inheritedSensitiveNames.length || snapshot.environment.privateFilesPresent.length) add('ENVIRONMENT_UNSAFE')
  if (snapshot.cache.state !== 'absent') add('CACHE_PROVENANCE_UNKNOWN')
  if (snapshot.legacyProfileConflict) add('LEGACY_PROFILE_CONFLICT','','policy')

  const inventoryValid = entries => {
    const paths = entries.map(f => f.path)
    return new Set(paths).size === paths.length && same(paths,[...paths].sort()) && paths.every(path => safeRelativePath(path) && /^backend\/database\/migrations\/[0-9]{4}_[0-9]{2}_[0-9]{2}_[0-9]{6}_[a-z0-9_]+\.php$/.exec(path)?.[0] === path)
  }
  const chain = r.migrationManifest
  if (!inventoryValid(chain.entries) || !inventoryValid(snapshot.migrationEntries)) add('MIGRATION_INVENTORY_INVALID')
  if (chain.sourceCommit !== r.source.commit || !same(chain.entries,snapshot.migrationEntries) || chain.digest !== snapshot.migrationDigest || chain.digest !== fileListDigest(chain.entries) || snapshot.migrationDigest !== fileListDigest(snapshot.migrationEntries)) add('MIGRATION_MANIFEST_MISMATCH')
  if (snapshot.migrationDigest !== BASELINE_CHAIN) add('UNREVIEWED_MIGRATION_CHAIN','','policy')
  if (snapshot.migrationEntries.some(f => HELD_CONTENT.has(f.sha256))) add('KNOWN_MIGRATION_HOLD','','policy')
  if (ma.sourceCommit !== r.source.commit || ma.digest !== chain.digest || ma.schemaVersion !== chain.schemaVersion) add('MIGRATION_MANIFEST_MISMATCH','/migrationApproval')
  if (ma.decision !== 'approved' || ma.transactionPolicy !== 'reviewed-per-file') add('MIGRATION_APPROVAL_MISSING','/migrationApproval','policy')

  const op = operations[r.operation.category], declaredArtifacts = r.operation.artifacts
  const artifactPaths = declaredArtifacts.map(f => f.path), observedPaths = snapshot.artifacts.map(f => f.path)
  if (new Set(artifactPaths).size !== artifactPaths.length || new Set(observedPaths).size !== observedPaths.length) add('DUPLICATE_EVIDENCE')
  if (!op || !op.lanes.includes(r.operation.lane)) add('LANE_MISMATCH')
  if (op.prefix === null ? declaredArtifacts.length !== 0 : declaredArtifacts.length === 0 || declaredArtifacts.some(f => !allowedArtifactPath(f.path) || !f.path.startsWith(op.prefix))) add('COMMAND_UNSUPPORTED')
  if (!same(declaredArtifacts,snapshot.artifacts.map(({path,sha256}) => ({path,sha256})))) add('SOURCE_MISMATCH','/request/operation/artifacts')
  const requiredCapabilities = new Set(op.capabilities)
  if (snapshot.artifacts.some(f => f.flags.includes('schema-reset'))) {
    requiredCapabilities.add('reset');requiredCapabilities.add('ddl')
    if (r.operation.lane !== 'schema') add('LANE_MISMATCH')
  }
  if (snapshot.artifacts.some(f => f.flags.includes('process-dispatch')) && r.operation.category !== 'contention-worker') add('COMMAND_AMBIGUOUS')
  if (!sameSet([...requiredCapabilities],r.operation.capabilities)) add('CAPABILITY_MISMATCH')
  const schemaLane = r.operation.lane === 'schema'
  if (r.credentials.roleClass !== (schemaLane?'schema-owner':'application') || r.credentials.ddlAllowed !== schemaLane || r.credentials.ownsProtectedTables !== schemaLane) add('PRIVILEGE_BOUNDARY_MISSING')
  const expectedApproval = {runId:r.runId,operatorId:r.operatorId,sourceCommit:r.source.commit,profile:r.profile,target:r.target,migrationDigest:chain.digest,provisioningEvidenceId:p.provenance.evidenceId,lane:r.operation.lane,operation:r.operation.category,artifactDigest:fileListDigest(declaredArtifacts),capabilities:r.operation.capabilities,credentialRole:r.credentials.roleClass,cleanupOwnerRunId:r.runId,resourceIds:r.cleanup.resourceIds}
  if (Object.entries(expectedApproval).some(([key,value]) => !same(a[key],value))) add('APPROVAL_SCOPE_MISMATCH')
  const wantedPaths = [...new Set([...r.resourcePaths,...artifactPaths])]
  if (r.resourcePaths.some(path => !safeRelativePath(path) || !(path === 'qa/clinic-simulation' || path.startsWith('qa/clinic-simulation/'))) || snapshot.pathChecks.some(c => !safeRelativePath(c.path) || c.path !== c.canonicalRelativePath)) add('PATH_UNSAFE')
  if (new Set(snapshot.pathChecks.map(c=>c.path)).size !== snapshot.pathChecks.length || !sameSet(wantedPaths,snapshot.pathChecks.map(c=>c.path))) add('PATH_UNOBSERVED')
  checks.consistent = !findings.some(f => ['shape','consistency'].includes(f.stage))
  return finish()
}

/** Optional read-only observer. Source metadata is still DECLARED; no Git command or PHP bootstrap occurs. */
export function inspectWorkspace(workspaceRoot,inspectionJson) {
  const finish = observed => freeze({...observed,executionAllowed:false,provisioningAllowed:false,refusals:observed.refusals.map(f=>({...f,message:messages[f.code] || messages.WORKSPACE_OBSERVATION_FAILED}))})
  if (arguments.length > 2) return finish({status:'REFUSED',snapshot:null,refusals:[{code:'UNSUPPORTED_FIELD'}]})
  try {
    const inspection = parseStrictJson(inspectionJson)
    const issues = schemaIssues(inspection,{$ref:'#/$defs/inspection'},schema)
    if (issues.length) return finish({status:'REFUSED',snapshot:null,refusals:issues})
    return finish(observeWorkspace(workspaceRoot,inspectionJson))
  } catch (e) { return finish({status:'REFUSED',snapshot:null,refusals:[{code:e instanceof DescriptorError?e.code:'WORKSPACE_OBSERVATION_FAILED'}]}) }
}

// Refusal only. Direct invocation, including --force/command arguments, never acts as a successful runner.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stderr.write('BLOCKED: offline library only; no database execution or provisioning is authorized.\n')
  process.exitCode = 2
}

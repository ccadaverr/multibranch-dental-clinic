import test,{mock} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,readFileSync,lstatSync,readdirSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import cp from 'node:child_process'
import net from 'node:net'
import tls from 'node:tls'
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import {syncBuiltinESMExports} from 'node:module'
import {assessOffline,inspectWorkspace} from './preflight.mjs'
import {canonicalJson,parseStrictJson} from './strict-json.mjs'
import {fileListDigest,sha256,safeRelativePath} from './workspace-snapshot.mjs'
import {assertSchemaVocabulary,schemaIssues} from './schema-validation.mjs'

const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,'')
const scratch=process.env.QA_ISOLATION_TEST_TMP
if (!scratch?.startsWith('/private/tmp/qa-isolation-gate-') || !lstatSync(scratch).isDirectory()) throw Error('An explicitly allocated test-output directory is required; no cleanup is automatic.')
const source={origin:'https://github.com/ccadaverr/multibranch-dental-clinic.git',commit:'15d626c03c97baf7198a7b7ca6dea2bec8f60836',branch:'feature/jaztin-qa-isolation-gate-20261112'}
const inspection={source,artifacts:[],resourcePaths:['qa/clinic-simulation']}
const actual=inspectWorkspace(root,JSON.stringify(inspection))
assert.equal(actual.status,'OBSERVED_OFFLINE')
const clone=x=>JSON.parse(JSON.stringify(x))
const NOW='2026-11-12T04:00:00Z'
const provenance=n=>({evidenceId:'qa-evidence-'+n,issuerId:'qa-issuer-'+n,method:'unverified-declaration',reference:'qa-review-'+n})
function fixture(){
  // Deliberately SYNTHETIC observations/declarations. These edits to data are never real verification.
  const snapshot=clone(actual.snapshot)
  snapshot.capturedAt=NOW;snapshot.environment.inheritedSensitiveNames=[];snapshot.environment.privateFilesPresent=[];snapshot.legacyProfileConflict=false
  const target={driver:'pgsql',host:'127.0.0.1',port:5432,database:'dental_clinic_test',searchPath:'public',url:null,sslmode:'prefer'}
  const resourceIds=['qa-instance-one','qa-volume-one','qa-network-one']
  const manifest={version:1,request:{runId:'qa-run-one',operatorId:'qa-operator-one',source:clone(source),profile:'isolated-postgres-v1-proposal',environment:'testing',workspaceRoot:root,target:clone(target),configuration:{default:'pgsql',connections:{pgsql:clone(target)}},credentials:{reference:'qa-credential-one',source:'future-ephemeral-secret',roleClass:'schema-owner',superuser:false,createDatabase:false,createRole:false,bypassRls:false,ownsProtectedTables:true,ddlAllowed:true},operation:{category:'migration-manifest',lane:'schema',artifacts:[],capabilities:['database','ddl'],reviewRef:'qa-operation-review'},migrationManifest:{sourceCommit:source.commit,schemaVersion:'full-chain-v1-proposal',digest:snapshot.migrationDigest,entries:clone(snapshot.migrationEntries)},resourcePaths:['qa/clinic-simulation'],cleanup:{ownerRunId:'qa-run-one',resourceIds:[...resourceIds],strategy:'owned-resources-only',authorized:false}},provisioningEvidence:{runId:'qa-run-one',instanceId:resourceIds[0],volumeId:resourceIds[1],networkId:resourceIds[2],disposableClaim:true,target:clone(target),issuedAt:'2026-11-12T03:55:00Z',expiresAt:'2026-11-12T04:05:00Z',provenance:provenance('provisioner')},approval:{runId:'qa-run-one',operatorId:'qa-operator-one',sourceCommit:source.commit,profile:'isolated-postgres-v1-proposal',target:clone(target),migrationDigest:snapshot.migrationDigest,provisioningEvidenceId:'qa-evidence-provisioner',lane:'schema',operation:'migration-manifest',artifactDigest:fileListDigest([]),capabilities:['database','ddl'],credentialRole:'schema-owner',cleanupOwnerRunId:'qa-run-one',resourceIds:[...resourceIds],issuedAt:'2026-11-12T03:55:00Z',expiresAt:'2026-11-12T04:10:00Z',provenance:provenance('lead')},migrationApproval:{sourceCommit:source.commit,schemaVersion:'full-chain-v1-proposal',digest:snapshot.migrationDigest,decision:'approved',transactionPolicy:'reviewed-per-file',issuedAt:'2026-11-12T03:55:00Z',expiresAt:'2026-11-12T04:10:00Z',reviewRef:'qa-schema-review',provenance:provenance('schema')}}
  return {manifest,snapshot}
}
const assess=(f,now=NOW)=>assessOffline(JSON.stringify(f.manifest),JSON.stringify(f.snapshot),now)
const codes=result=>result.refusals.map(f=>f.code)
function blocked(result){assert.equal(result.status,'BLOCKED');assert.equal(result.executionAllowed,false);assert.equal(result.provisioningAllowed,false);assert.equal(result.trust.runtime,'not-checked');assert.ok(codes(result).includes('NO_EXECUTION_CAPABILITY'));assert.ok(codes(result).includes('SCHEMA_POLICY_UNAPPROVED'))}
function refuses(name,change,expected){test(name,()=>{const f=fixture();change(f);const r=assess(f);blocked(r);assert.ok(codes(r).includes(expected),JSON.stringify(codes(r)))})}

test('consistent synthetic evidence is not trusted infrastructure, migration approval or execution permission',()=>{
  const r=assess(fixture());blocked(r);assert.deepEqual(r.checks,{descriptorValid:true,snapshotValid:true,consistent:true})
  for(const code of ['PROVISIONING_PROVENANCE_UNVERIFIED','APPROVAL_PROVENANCE_UNVERIFIED','SOURCE_IDENTITY_DECLARED_ONLY','KNOWN_MIGRATION_HOLD','BOOTSTRAP_BOUNDARY_UNINTEGRATED'])assert.ok(codes(r).includes(code))
  assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.checks));assert.ok(Object.isFrozen(r.refusals))
})
const cases=[
  ['missing run identity',f=>{delete f.manifest.request.runId},'MISSING_EVIDENCE'],
  ['missing database target',f=>{delete f.manifest.request.target},'MISSING_EVIDENCE'],
  ['target mismatch',f=>{f.manifest.provisioningEvidence.target.database='different'},'INVALID_EVIDENCE'],
  ['unapproved database name',f=>{f.manifest.request.target.database='dental_clinic'},'INVALID_EVIDENCE'],
  ['unknown instance identity',f=>{f.manifest.provisioningEvidence.instanceId='unknown'},'INFRASTRUCTURE_IDENTITY_MISSING'],
  ['stale provisioning evidence',f=>{f.manifest.provisioningEvidence.issuedAt='2026-11-12T03:40:00Z';f.manifest.provisioningEvidence.expiresAt='2026-11-12T03:50:00Z'},'STALE_EVIDENCE'],
  ['missing provisioning provenance',f=>{delete f.manifest.provisioningEvidence.provenance},'MISSING_EVIDENCE'],
  ['different source SHA',f=>{f.manifest.request.source.commit='a'.repeat(40)},'SOURCE_MISMATCH'],
  ['different observed branch',f=>{f.snapshot.source.branch='integration/other'},'SOURCE_MISMATCH'],
  ['different repository',f=>{f.manifest.request.source.origin='https://example.invalid/other.git'},'INVALID_EVIDENCE'],
  ['different migration digest',f=>{f.manifest.request.migrationManifest.digest='a'.repeat(64)},'MIGRATION_MANIFEST_MISMATCH'],
  ['unsupported schema profile',f=>{f.manifest.request.profile='production'},'INVALID_EVIDENCE'],
  ['unknown schema version',f=>{f.manifest.request.migrationManifest.schemaVersion='unknown'},'INVALID_EVIDENCE'],
  ['alternate connection alias',f=>{f.manifest.request.configuration.connections.reporting=f.manifest.request.target},'UNSUPPORTED_FIELD'],
  ['DATABASE_URL conflict',f=>{f.manifest.request.configuration.DATABASE_URL='postgres://private-fixture-secret'},'UNSUPPORTED_FIELD'],
  ['DB_URL conflict',f=>{f.manifest.request.target.url='postgres://private-fixture-secret'},'INVALID_EVIDENCE'],
  ['cached configuration present',f=>{f.snapshot.cache.state='present'},'CACHE_PROVENANCE_UNKNOWN'],
  ['unknown cache state',f=>{f.snapshot.cache.state='unknown'},'CACHE_PROVENANCE_UNKNOWN'],
  ['unproven cache provenance',f=>{f.snapshot.cache.provenance='operator-says-safe'},'INVALID_EVIDENCE'],
  ['unexpected default connection',f=>{f.manifest.request.configuration.default='sqlite'},'INVALID_EVIDENCE'],
  ['read split',f=>{f.manifest.request.configuration.connections.pgsql.read={host:'elsewhere'}},'UNSUPPORTED_FIELD'],
  ['write split',f=>{f.manifest.request.configuration.connections.pgsql.write={host:'elsewhere'}},'UNSUPPORTED_FIELD'],
  ['direct endpoint override',f=>{f.manifest.request.configuration.connections.pgsql.direct='elsewhere'},'UNSUPPORTED_FIELD'],
  ['inherited DB credentials',f=>{f.snapshot.environment.inheritedSensitiveNames=['DB_PASSWORD']},'ENVIRONMENT_UNSAFE'],
  ['inherited provider credential',f=>{f.snapshot.environment.inheritedSensitiveNames=['PAYMONGO_SECRET_KEY']},'ENVIRONMENT_UNSAFE'],
  ['inherited Node preload',f=>{f.snapshot.environment.inheritedSensitiveNames=['NODE_OPTIONS']},'ENVIRONMENT_UNSAFE'],
  ['private environment file present',f=>{f.snapshot.environment.privateFilesPresent=['backend/.env.testing']},'ENVIRONMENT_UNSAFE'],
  ['unexpected host',f=>{f.manifest.request.target.host='localhost'},'INVALID_EVIDENCE'],
  ['unexpected socket',f=>{f.manifest.request.target.socket='/private/valuable.sock'},'UNSUPPORTED_FIELD'],
  ['string port representation',f=>{f.manifest.request.target.port='5432'},'INVALID_EVIDENCE'],
  ['empty mandatory host',f=>{f.manifest.request.target.host=''},'INVALID_EVIDENCE'],
  ['missing approval',f=>{delete f.manifest.approval},'MISSING_EVIDENCE'],
  ['expired approval',f=>{f.manifest.approval.issuedAt='2026-11-12T03:40:00Z';f.manifest.approval.expiresAt='2026-11-12T03:50:00Z'},'STALE_EVIDENCE'],
  ['approval source mismatch',f=>{f.manifest.approval.sourceCommit='a'.repeat(40)},'APPROVAL_SCOPE_MISMATCH'],
  ['approval lane mismatch',f=>{f.manifest.approval.lane='seed'},'APPROVAL_SCOPE_MISMATCH'],
  ['approval operator mismatch',f=>{f.manifest.approval.operatorId='qa-operator-two'},'APPROVAL_SCOPE_MISMATCH'],
  ['approval target mismatch',f=>{f.manifest.approval.target.port=5433},'INVALID_EVIDENCE'],
  ['approval operation mismatch',f=>{f.manifest.approval.operation='schema-reset'},'APPROVAL_SCOPE_MISMATCH'],
  ['approval manifest mismatch',f=>{f.manifest.approval.migrationDigest='a'.repeat(64)},'APPROVAL_SCOPE_MISMATCH'],
  ['approval provisioning reference mismatch',f=>{f.manifest.approval.provisioningEvidenceId='qa-evidence-other'},'APPROVAL_SCOPE_MISMATCH'],
  ['approval resource mismatch',f=>{f.manifest.approval.resourceIds[0]='qa-instance-other'},'APPROVAL_SCOPE_MISMATCH'],
  ['unsupported force flag',f=>{f.manifest.force=true},'UNSUPPORTED_FIELD'],
  ['unsupported trust flag',f=>{f.manifest.provisioningEvidence.verified=true},'UNSUPPORTED_FIELD'],
  ['unsupported signature claims',f=>{f.manifest.approval.signature='fixture-not-trusted'},'UNSUPPORTED_FIELD'],
  ['duplicate evidence id',f=>{f.manifest.approval.provenance.evidenceId=f.manifest.provisioningEvidence.provenance.evidenceId},'PROVENANCE_MISSING'],
  ['path traversal',f=>{f.manifest.request.resourcePaths=['qa/clinic-simulation/../../backend']},'PATH_UNSAFE'],
  ['symlink observation',f=>{f.snapshot.pathChecks[0].symlink=true},'INVALID_EVIDENCE'],
  ['unexpected resolved path',f=>{f.snapshot.pathChecks[0].canonicalRelativePath='backend'},'PATH_UNSAFE'],
  ['unobserved resource path',f=>{f.snapshot.pathChecks=[]},'INVALID_EVIDENCE'],
  ['resource outside QA scope',f=>{f.manifest.request.resourcePaths=['backend']},'PATH_UNSAFE'],
  ['cleanup owner mismatch',f=>{f.manifest.request.cleanup.ownerRunId='qa-run-other'},'OWNERSHIP_MISMATCH'],
  ['cleanup resource mismatch',f=>{f.manifest.request.cleanup.resourceIds[0]='qa-instance-other'},'OWNERSHIP_MISMATCH'],
  ['cleanup authorization override',f=>{f.manifest.request.cleanup.authorized=true},'INVALID_EVIDENCE'],
  ['missing migration approval',f=>{delete f.manifest.migrationApproval},'MISSING_EVIDENCE'],
  ['unapproved migration declaration',f=>{f.manifest.migrationApproval.decision='unapproved'},'MIGRATION_APPROVAL_MISSING'],
  ['unreviewed transaction policy',f=>{f.manifest.migrationApproval.transactionPolicy='unreviewed'},'MIGRATION_APPROVAL_MISSING'],
  ['different migration approval source',f=>{f.manifest.migrationApproval.sourceCommit='a'.repeat(40)},'MIGRATION_MANIFEST_MISMATCH'],
  ['migration omitted',f=>{f.manifest.request.migrationManifest.entries.pop()},'MIGRATION_MANIFEST_MISMATCH'],
  ['migration duplicated',f=>{f.manifest.request.migrationManifest.entries.push(clone(f.manifest.request.migrationManifest.entries[0]))},'DUPLICATE_EVIDENCE'],
  ['migration order changed',f=>{f.manifest.request.migrationManifest.entries.reverse()},'MIGRATION_INVENTORY_INVALID'],
  ['migration content modified',f=>{f.manifest.request.migrationManifest.entries[0].sha256='a'.repeat(64)},'MIGRATION_MANIFEST_MISMATCH'],
  ['nontransactional risk omitted',f=>{const row=f.manifest.request.migrationManifest.entries.find(x=>x.flags.includes('nontransactional'));row.flags=[]},'MIGRATION_MANIFEST_MISMATCH'],
  ['migration traversal',f=>{f.manifest.request.migrationManifest.entries[0].path='backend/database/migrations/../secret.php'},'MIGRATION_INVENTORY_INVALID'],
  ['missing privilege classification',f=>{delete f.manifest.request.credentials.roleClass},'MISSING_EVIDENCE'],
  ['superuser claim',f=>{f.manifest.request.credentials.superuser=true},'INVALID_EVIDENCE'],
  ['schema role lacks ownership boundary',f=>{f.manifest.request.credentials.ownsProtectedTables=false},'PRIVILEGE_BOUNDARY_MISSING'],
  ['credential value supplied',f=>{f.manifest.request.credentials.password='fixture-secret-must-not-leak'},'UNSUPPORTED_FIELD'],
  ['credential class mismatch',f=>{f.manifest.request.credentials.roleClass='application'},'PRIVILEGE_BOUNDARY_MISSING'],
  ['future-dated evidence',f=>{f.manifest.provisioningEvidence.issuedAt='2026-11-12T04:01:00Z'},'INVALID_LIFETIME'],
  ['overlong provisioning lifetime',f=>{f.manifest.provisioningEvidence.expiresAt='2026-11-12T05:00:00Z'},'INVALID_LIFETIME'],
  ['invalid calendar date',f=>{f.manifest.provisioningEvidence.issuedAt='2026-02-30T00:00:00Z'},'INVALID_LIFETIME'],
  ['expired observation',f=>{f.snapshot.capturedAt='2026-11-12T03:54:59Z'},'STALE_EVIDENCE'],
  ['future observation',f=>{f.snapshot.capturedAt='2026-11-12T04:00:01Z'},'INVALID_LIFETIME'],
  ['unknown operation',f=>{f.manifest.request.operation.category='migrate:fresh'},'INVALID_EVIDENCE'],
  ['raw command string',f=>{f.manifest.request.operation='php artisan migrate:fresh'},'INVALID_EVIDENCE'],
  ['argv bypass',f=>{f.manifest.request.operation.argv=['php','artisan','migrate:fresh']},'UNSUPPORTED_FIELD'],
  ['seeder outside seed lane',f=>{f.manifest.request.operation.category='reference-seeder'},'LANE_MISMATCH'],
  ['worker outside contention lane',f=>{f.manifest.request.operation.category='contention-worker'},'LANE_MISMATCH'],
  ['outbox outside outbox lane',f=>{f.manifest.request.operation.category='outbox-worker'},'LANE_MISMATCH'],
  ['scheduler descriptor',f=>{f.manifest.request.operation.category='schedule:work'},'INVALID_EVIDENCE'],
  ['Composer script descriptor',f=>{f.manifest.request.operation.category='composer-script'},'INVALID_EVIDENCE'],
  ['predefense script descriptor',f=>{f.manifest.request.operation.category='predefense'},'INVALID_EVIDENCE'],
  ['direct migration invocation',f=>{f.manifest.request.operation.category='single-migration'},'INVALID_EVIDENCE'],
  ['reset capability in workflow lane',f=>{f.manifest.request.operation.category='schema-reset';f.manifest.request.operation.lane='workflow'},'LANE_MISMATCH'],
  ['extra unsupported capability',f=>{f.manifest.request.operation.capabilities.push('network')},'INVALID_EVIDENCE'],
  ['capability dropped',f=>{f.manifest.request.operation.capabilities=['database']},'CAPABILITY_MISMATCH'],
]
for(const [name,change,expected] of cases)refuses(name,change,expected)

test('a rehashed/renamed queue migration still encounters its content hold',()=>{
  const f=fixture(),row=f.snapshot.migrationEntries.find(x=>x.path.includes('update_queue_statuses'))
  row.path='backend/database/migrations/2026_12_01_000100_renamed.php'
  f.snapshot.migrationEntries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)
  f.snapshot.migrationDigest=fileListDigest(f.snapshot.migrationEntries)
  f.manifest.request.migrationManifest.entries=clone(f.snapshot.migrationEntries);f.manifest.request.migrationManifest.digest=f.snapshot.migrationDigest
  f.manifest.approval.migrationDigest=f.snapshot.migrationDigest;f.manifest.migrationApproval.digest=f.snapshot.migrationDigest
  const r=assess(f);blocked(r);assert.ok(codes(r).includes('KNOWN_MIGRATION_HOLD'));assert.ok(codes(r).includes('UNREVIEWED_MIGRATION_CHAIN'))
})
test('a modified fully rehashed chain is not silently admitted by a new manifest',()=>{
  const f=fixture();f.snapshot.migrationEntries[0].sha256='a'.repeat(64);f.snapshot.migrationDigest=fileListDigest(f.snapshot.migrationEntries)
  f.manifest.request.migrationManifest.entries=clone(f.snapshot.migrationEntries);f.manifest.request.migrationManifest.digest=f.snapshot.migrationDigest;f.manifest.approval.migrationDigest=f.snapshot.migrationDigest;f.manifest.migrationApproval.digest=f.snapshot.migrationDigest
  const r=assess(f);blocked(r);assert.ok(codes(r).includes('UNREVIEWED_MIGRATION_CHAIN'))
})
test('actual legacy profile conflict is retained alongside current migration holds',()=>{
  const f=fixture();f.snapshot.legacyProfileConflict=actual.snapshot.legacyProfileConflict
  const r=assess(f);blocked(r);assert.ok(codes(r).includes('LEGACY_PROFILE_CONFLICT'));assert.ok(codes(r).includes('KNOWN_MIGRATION_HOLD'))
})
for(const [name,text,expected] of [
  ['malformed','{"x":','MALFORMED_JSON'],['duplicate','{"x":1,"x":2}','DUPLICATE_JSON_KEY'],['escaped duplicate','{"x":1,"\\u0078":2}','DUPLICATE_JSON_KEY'],['nested duplicate','{"a":{"x":1,"x":2}}','DUPLICATE_JSON_KEY'],['prototype','{"__proto__":{}}','UNSUPPORTED_FIELD'],['infinite number','1e400','MALFORMED_JSON'],['bad escape','"\\q"','MALFORMED_JSON'],['oversize',' '.repeat(1048577),'INVALID_JSON_INPUT'],['deep nesting','['.repeat(26)+'0'+']'.repeat(26),'JSON_LIMIT_EXCEEDED']
])test('strict parser refuses '+name,()=>{const r=assessOffline(text,'{}',NOW);blocked(r);assert.ok(codes(r).includes(expected))})
test('strict parser agrees with JSON for ordinary nested values and rejects trailing input',()=>{
  for(const x of [null,true,false,0,-2.5,'a\\b\n"c\u001f',[1,null,{x:'y'}],{b:1,a:[{},[]]}])assert.equal(canonicalJson(parseStrictJson(JSON.stringify(x))),canonicalJson(x))
  assert.throws(()=>parseStrictJson('{} {}'),{code:'MALFORMED_JSON'})
})
test('object input cannot execute an accessor while pretending to be JSON',()=>{
  let reads=0;const input={get secret(){reads++;throw Error('not allowed')}}
  blocked(assessOffline(input,'{}',NOW));assert.equal(reads,0)
})
test('diagnostics never echo secret values, unknown keys or raw parser excerpts',()=>{
  const f=fixture(),secret='SYNTHETIC_PRIVATE_SENTINEL_DO_NOT_ECHO'
  f.manifest.request.credentials.password=secret;f.manifest[secret]=secret
  assert.equal(JSON.stringify(assess(f)).includes(secret),false)
  assert.equal(JSON.stringify(assessOffline('{"'+secret+'":', '{}',NOW)).includes(secret),false)
})
for(const suffix of ['\n','\r\n',' ','\0'])refuses('absolute field validation rejects source suffix '+JSON.stringify(suffix),f=>{f.manifest.request.source.commit+=suffix},'INVALID_EVIDENCE')
for(const path of ['../x','/x','qa//x','qa/./x','qa/../x','qa\\x','qa/%2e%2e/x','qa/x\n','qa/x\0'])test('path grammar rejects '+JSON.stringify(path),()=>assert.equal(!!safeRelativePath(path),false))

function temporaryWorld(){
  const dir=mkdtempSync(join(scratch,'fixture-'))
  for(const path of ['backend/database/migrations','backend/bootstrap/cache','qa/clinic-simulation','backend/tests/Feature','backend/tests/Support','backend/database/seeders'])mkdirSync(join(dir,path),{recursive:true})
  writeFileSync(join(dir,'backend/phpunit.xml'),'<phpunit/>')
  writeFileSync(join(dir,'backend/database/migrations/2026_01_01_000100_qa.php'),'<?php // synthetic source only, never included')
  return dir
}
function inspect(dir,artifacts=[],resourcePaths=['qa/clinic-simulation']){return inspectWorkspace(dir,JSON.stringify({source,artifacts,resourcePaths}))}
test('read-only observation hashes public bytes, declares Git metadata and never imports PHP',()=>{
  const dir=temporaryWorld(),x=inspect(dir)
  assert.equal(x.status,'OBSERVED_OFFLINE');assert.equal(x.snapshot.sourceObservation,'caller-declared');assert.equal(x.snapshot.migrationEntries[0].sha256,sha256('<?php // synthetic source only, never included'))
  assert.equal(x.snapshot.cache.state,'absent')
})
for(const mode of ['root-symlink','migration-symlink','artifact-symlink','ancestor-symlink','resource-symlink'])test('filesystem observation refuses '+mode,()=>{
  const dir=temporaryWorld(),outside=temporaryWorld();let target=dir,artifacts=[],paths=['qa/clinic-simulation']
  if(mode==='root-symlink'){target=join(scratch,'alias-'+sha256(dir).slice(0,12));symlinkSync(dir,target)}
  if(mode==='migration-symlink')symlinkSync(join(outside,'backend/phpunit.xml'),join(dir,'backend/database/migrations/2026_01_01_000200_link.php'))
  if(mode==='artifact-symlink'){artifacts=['backend/tests/Feature/Linked.php'];symlinkSync(join(outside,'backend/phpunit.xml'),join(dir,artifacts[0]))}
  if(mode==='ancestor-symlink'){symlinkSync(outside,join(dir,'backend/tests/Feature/linked'));artifacts=['backend/tests/Feature/linked/backend/database/migrations/2026_01_01_000100_qa.php']}
  if(mode==='resource-symlink'){paths=['qa/clinic-simulation/linked'];symlinkSync(outside,join(dir,paths[0]))}
  const r=inspect(target,artifacts,paths);assert.equal(r.status,'REFUSED');assert.equal(r.snapshot,null);assert.equal(r.refusals[0].code,'PATH_UNSAFE')
})
test('missing resources, unknown migration files and unsafe paths are refusals, not repair operations',()=>{
  const dir=temporaryWorld();assert.equal(inspect(dir,[],['qa/clinic-simulation/missing']).status,'REFUSED')
  assert.equal(inspect(dir,[],['../outside']).status,'REFUSED')
  writeFileSync(join(dir,'backend/database/migrations/unknown.sql'),'not executed');assert.equal(inspect(dir).status,'REFUSED')
})
test('private env/cache metadata is reported without opening their contents',()=>{
  const dir=temporaryWorld(),secret='SYNTHETIC_SECRET_NOT_READ'
  writeFileSync(join(dir,'backend/.env'),secret);writeFileSync(join(dir,'backend/bootstrap/cache/config.php'),secret)
  const originalOpen=fs.openSync
  const open=mock.method(fs,'openSync',(path,...args)=>{assert.ok(!String(path).endsWith('/.env')&&!String(path).endsWith('/config.php'));return originalOpen(path,...args)})
  syncBuiltinESMExports()
  try{const r=inspect(dir);assert.deepEqual(r.snapshot.environment.privateFilesPresent,['backend/.env']);assert.equal(r.snapshot.cache.state,'present');assert.equal(JSON.stringify(r).includes(secret),false)}finally{open.mock.restore();syncBuiltinESMExports()}
})
test('RefreshDatabase source cannot be described as a safe workflow without reset capabilities',()=>{
  const dir=temporaryWorld(),path='backend/tests/Feature/Reset.php';writeFileSync(join(dir,path),'<?php use RefreshDatabase;')
  const observed=inspect(dir,[path]);assert.ok(observed.snapshot.artifacts[0].flags.includes('schema-reset'))
  const f=fixture();f.snapshot.artifacts=observed.snapshot.artifacts;f.snapshot.pathChecks.push({path,canonicalRelativePath:path,symlink:false})
  f.manifest.request.operation={category:'feature-tests',lane:'workflow',artifacts:observed.snapshot.artifacts.map(({path,sha256})=>({path,sha256})),capabilities:['database'],reviewRef:'qa-code-review'}
  const r=assess(f);blocked(r);assert.ok(codes(r).includes('LANE_MISMATCH'));assert.ok(codes(r).includes('CAPABILITY_MISMATCH'))
})
test('Composer, shell/provider scripts, env files and direct migrations are never command artifacts',()=>{
  for(const path of ['backend/composer.json','scripts/predefense-check.sh','backend/.env','backend/artisan','backend/database/migrations/2026_01_01_000100_qa.php'])assert.equal(inspect(root,[path]).status,'REFUSED')
})
test('unknown schema vocabulary is refused and security-specific fields reject alternate encodings',()=>{
  assert.throws(()=>assertSchemaVocabulary({type:'string',format:'unimplemented'}))
  assert.equal(schemaIssues('abc\n',{type:'string',pattern:'^[a-z]+$'}).length,1)
  assert.equal(schemaIssues([{a:1,b:2},{b:2,a:1}],{type:'array',uniqueItems:true,items:{type:'object'}})[0].code,'DUPLICATE_EVIDENCE')
})
test('all missing top-level fields and undocumented execution overrides refuse',()=>{
  for(const key of Object.keys(fixture().manifest)){const f=fixture();delete f.manifest[key];assert.ok(codes(assess(f)).includes('MISSING_EVIDENCE'))}
  for(const key of ['execute','dispatch','callback','allowUnsafe','skipGuard','trustAnchor','approvedSchemas']){const f=fixture();f.manifest[key]=true;assert.ok(codes(assess(f)).includes('UNSUPPORTED_FIELD'))}
})
test('deterministic malformed descriptor mutations never grant permissions or throw',()=>{
  let seed=20261112
  for(let n=0;n<100;n++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0
    const f=fixture(),values=[null,[],{},true,17,'unexpected'];f.manifest.request.target=values[seed%values.length]
    blocked(assess(f))
  }
})
test('non-execution: network, child process, destructive FS and Laravel/PHP paths have no call site',()=>{
  const traps=[]
  const trap=(object,method)=>{if(typeof object[method]==='function')traps.push(mock.method(object,method,()=>assert.fail('Forbidden side effect')))}
  for(const [object,names] of [[cp,['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork']],[net,['connect','createConnection','createServer']],[tls,['connect']],[http,['request','get']],[https,['request','get']],[dns,['lookup','resolve']],[fs,['writeFileSync','appendFileSync','renameSync','unlinkSync','rmSync','rmdirSync','truncateSync','mkdirSync','symlinkSync']]])for(const name of names)trap(object,name)
  trap(globalThis,'fetch');syncBuiltinESMExports()
  try{
    const f=fixture();blocked(assess(f));blocked(assessOffline('invalid','{}',NOW));assert.equal(inspect(root).status,'OBSERVED_OFFLINE')
    for(const t of traps)assert.equal(t.mock.calls.length,0)
  }finally{for(const t of traps)t.mock.restore();syncBuiltinESMExports()}
  // Audit the complete production dependency closure. Only read-only Node builtins and these local helpers.
  const allowed=new Set(['node:fs','node:path','node:url','node:crypto','./strict-json.mjs','./schema-validation.mjs','./workspace-snapshot.mjs'])
  for(const name of ['preflight.mjs','workspace-snapshot.mjs','strict-json.mjs','schema-validation.mjs']){
    const text=readFileSync(join(root,'qa/clinic-simulation',name),'utf8')
    for(const match of text.matchAll(/^import .* from '([^']+)'/gm))assert.ok(allowed.has(match[1]),name)
    assert.doesNotMatch(text,/\b(?:eval|require|Function)\s*\(|\bimport\s*\(|process\.env\s*\[|process\.env\.[A-Za-z_]+\s*=/)
  }
})

test('all four known migration risk files and complete baseline inventory remain observed',()=>{
  assert.equal(actual.snapshot.migrationEntries.length,86)
  assert.equal(actual.snapshot.migrationDigest,'f565b8e643f41787575f8d54c0be5d0c33b81aeaa35f4844b4527c5ba13ee1ff')
  const rows=actual.snapshot.migrationEntries
  assert.ok(rows.find(x=>x.path.includes('000500_add_critical')).flags.includes('nontransactional'))
  assert.ok(rows.find(x=>x.path.includes('backfill_tooth')).flags.includes('trigger-bypass'))
  assert.ok(rows.find(x=>x.path.includes('remove_patient_feedback')).flags.includes('drop-data'))
  assert.ok(rows.find(x=>x.path.includes('update_queue_statuses')).flags.includes('data-rewrite'))
})

test('caller backdating an offline assessment cannot authenticate an expired real approval',()=>{
  const f=fixture()
  assert.ok(codes(assess(f,'2026-11-12T04:11:00Z')).includes('STALE_EVIDENCE'))
  const backdated=assess(f,NOW);assert.equal(backdated.checks.consistent,true);blocked(backdated)
  assert.equal(backdated.trust.approval,'unverified')
})
test('missing provenance fields, future trust adapters and schema URLs are not accepted',()=>{
  for(const field of ['issuerId','evidenceId','reference']){const f=fixture();delete f.manifest.provisioningEvidence.provenance[field];assert.ok(codes(assess(f)).includes('MISSING_EVIDENCE'))}
  const f=fixture();f.manifest.$schema='https://example.invalid/never-fetch';assert.ok(codes(assess(f)).includes('UNSUPPORTED_FIELD'))
  f.manifest.request.configuration.connections.pgsql['sticky']=true;assert.ok(codes(assess(f)).includes('UNSUPPORTED_FIELD'))
})
test('repeated offline calls create no lease, reusable approval token or handoff capability',()=>{
  const f=fixture(),first=assess(f),second=assess(f)
  assert.deepEqual(first,second);blocked(first);blocked(second)
  assert.equal('token' in first,false);assert.equal('execute' in first,false);assert.equal('handoff' in first,false)
})
test('read descriptors can neither substitute private paths nor supply undocumented options',()=>{
  const r=inspectWorkspace(root,JSON.stringify({...inspection,skipGuard:true}))
  assert.equal(r.status,'REFUSED');assert.equal(r.executionAllowed,false);assert.equal(r.provisioningAllowed,false)
  assert.ok(r.refusals.some(f=>f.code==='UNSUPPORTED_FIELD'))
  assert.equal(inspectWorkspace(root,'{"source":1,"source":2}').refusals[0].code,'DUPLICATE_JSON_KEY')
})
test('non-regular migration resources and incomplete path observations are rejected',()=>{
  const dir=temporaryWorld();mkdirSync(join(dir,'backend/database/migrations/2026_01_01_000200_directory.php'))
  assert.equal(inspect(dir).refusals[0].code,'SOURCE_FILE_UNSAFE')
  const f=fixture();f.snapshot.pathChecks[0].path='qa/clinic-simulation/other';f.snapshot.pathChecks[0].canonicalRelativePath=f.snapshot.pathChecks[0].path
  assert.ok(codes(assess(f)).includes('PATH_UNOBSERVED'))
})
test('network endpoint, provider, command and cleanup value injections remain non-disclosing refusals',()=>{
  for(const key of ['connectionUrl','credentials','command','cleanupCommand','provider']){
    const f=fixture();f.manifest.request[key]='SYNTHETIC_SECRET_WITH_COMMAND_PAYLOAD'
    const r=assess(f);blocked(r);assert.ok(codes(r).includes(key==='credentials'?'INVALID_EVIDENCE':'UNSUPPORTED_FIELD'));assert.equal(JSON.stringify(r).includes('SYNTHETIC_SECRET_WITH_COMMAND_PAYLOAD'),false)
  }
})

refuses('expired migration approval',f=>{f.manifest.migrationApproval.issuedAt='2026-11-12T03:40:00Z';f.manifest.migrationApproval.expiresAt='2026-11-12T03:50:00Z'},'STALE_EVIDENCE')
test('extra positional options cannot supply callbacks or override refusals',()=>{
  const f=fixture();let called=false
  const r=assessOffline(JSON.stringify(f.manifest),JSON.stringify(f.snapshot),NOW,{force:true,execute:()=>{called=true}})
  blocked(r);assert.ok(codes(r).includes('UNSUPPORTED_FIELD'));assert.equal(called,false)
  assert.equal(inspectWorkspace(root,JSON.stringify(inspection),{force:true}).refusals[0].code,'UNSUPPORTED_FIELD')
})
for(const [category,lane,capabilities,path] of [
  ['feature-tests','workflow',['database'],'backend/tests/Feature/Synthetic.php'],
  ['migration-manifest','schema',['database','ddl'],null],
  ['schema-reset','schema',['database','ddl','reset'],null],
  ['reference-seeder','seed',['database','seed'],'backend/database/seeders/Synthetic.php'],
  ['contention-worker','contention',['database','multiple-processes'],'backend/tests/Support/Synthetic.php'],
  ['outbox-worker','outbox',['database','background-jobs'],'backend/tests/Support/Synthetic.php'],
])test('even internally consistent '+category+' declarations stay blocked',()=>{
  const f=fixture(),r=f.manifest.request,a=f.manifest.approval
  const artifacts=path?[{path,sha256:sha256('synthetic, never executed')}]:[]
  r.operation={category,lane,artifacts,capabilities,reviewRef:'qa-operation-review'}
  const schemaLane=lane==='schema';r.credentials.roleClass=schemaLane?'schema-owner':'application';r.credentials.ddlAllowed=schemaLane;r.credentials.ownsProtectedTables=schemaLane
  f.snapshot.artifacts=artifacts.map(x=>({...x,flags:['database-capable']}))
  if(path)f.snapshot.pathChecks.push({path,canonicalRelativePath:path,symlink:false})
  Object.assign(a,{lane,operation:category,artifactDigest:fileListDigest(artifacts),capabilities,credentialRole:r.credentials.roleClass})
  const result=assess(f);blocked(result);assert.equal(result.checks.consistent,true)
})

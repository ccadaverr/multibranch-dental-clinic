import {constants,closeSync,fstatSync,lstatSync,openSync,readFileSync,readdirSync,realpathSync} from 'node:fs'
import {isAbsolute,join,relative,resolve,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {DescriptorError,canonicalJson,parseStrictJson} from './strict-json.mjs'

export const sha256 = text => createHash('sha256').update(text).digest('hex')
export const fileListDigest = files => sha256(canonicalJson(files.map(({path,sha256}) => ({path,sha256}))))
export const safeRelativePath = path => typeof path === 'string' && path.length <= 240 && /^[A-Za-z0-9_./-]+$/.exec(path)?.[0] === path && !path.split('/').some(part => !part || part === '.' || part === '..') && !isAbsolute(path)

const fail = code => { throw new DescriptorError(code) }
function inspectPath(root, path) {
  if (!safeRelativePath(path)) fail('PATH_UNSAFE')
  const full = join(root,path)
  let cursor = root
  for (const part of path.split('/')) {
    cursor = join(cursor,part)
    if (lstatSync(cursor).isSymbolicLink()) fail('PATH_UNSAFE')
  }
  const actual = realpathSync(full), rel = relative(root,actual)
  if (rel.startsWith('..'+sep) || rel === '..' || isAbsolute(rel) || actual !== full) fail('PATH_UNSAFE')
  return full
}
function readPublicFile(root,path) {
  const full = inspectPath(root,path)
  // Nonblocking avoids hanging on a FIFO raced into place. No create/write flags, no executable imports.
  const fd = openSync(full,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = fstatSync(fd)
    if (!before.isFile() || before.size > 1048576) fail('SOURCE_FILE_UNSAFE')
    const bytes = readFileSync(fd)
    const after = fstatSync(fd), current = lstatSync(inspectPath(root,path))
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== current.ino || after.dev !== current.dev) fail('SOURCE_CHANGED_DURING_READ')
    return bytes
  } finally { closeSync(fd) }
}
export function sourceFlags(text, path) {
  // Conservative whole-file indicators, including down(). Not a PHP/SQL semantic safety audit.
  const flags = []
  if (/withinTransaction\s*=\s*false|CREATE\s+INDEX\s+CONCURRENTLY/i.test(text)) flags.push('nontransactional')
  if (/DISABLE\s+TRIGGER|DROP\s+TRIGGER/i.test(text)) flags.push('trigger-bypass')
  if (/dropIfExists|Schema::drop|\bTRUNCATE\b|DELETE\s+FROM|->delete\(/i.test(text)) flags.push('drop-data')
  if (/\bUPDATE\s+[a-z_]+\s+SET\b/i.test(text)) flags.push('data-rewrite')
  if (/RefreshDatabase|migrate:fresh|migrate:refresh|db:wipe/i.test(text)) flags.push('schema-reset')
  if (/proc_open|new\s+Process\b|shell_exec|exec\(/i.test(text)) flags.push('process-dispatch')
  if (/bootstrap\/app\.php|kernel->bootstrap|autoload\.php/i.test(text)) flags.push('bootstrap')
  if (path.startsWith('backend/tests/') || path.startsWith('backend/database/seeders/')) flags.push('database-capable')
  return flags.sort()
}
const artifactPath = path => safeRelativePath(path) && /^(?:backend\/tests\/(?:Feature|Support)\/[A-Za-z0-9_/-]+\.php|backend\/database\/seeders\/[A-Za-z0-9_/-]+\.php)$/.exec(path)?.[0] === path
export const allowedArtifactPath = artifactPath

/** Read public source and metadata only. Never reads .env/cache contents, Git internals or credentials.
 * source is explicitly a caller declaration; this function cannot verify a Git commit or an infrastructure issuer.
 * Paths/files are observations at read time, not an atomic execution lease against concurrent replacement.
 */
export function observeWorkspace(workspaceRoot, inspectionJson) {
  try {
    if (typeof workspaceRoot !== 'string' || !isAbsolute(workspaceRoot) || resolve(workspaceRoot) !== workspaceRoot || realpathSync(workspaceRoot) !== workspaceRoot || lstatSync(workspaceRoot).isSymbolicLink()) fail('PATH_UNSAFE')
    const request = parseStrictJson(inspectionJson)
    // Public module wrapper applies the schema before reaching this reader.
    if (!request || !Array.isArray(request.artifacts) || !Array.isArray(request.resourcePaths) || request.artifacts.length > 20 || request.resourcePaths.length > 20) fail('INVALID_EVIDENCE')
    const migrationDir = 'backend/database/migrations'
    const directory = inspectPath(workspaceRoot,migrationDir)
    const names = readdirSync(directory).sort()
    if (names.length < 1 || names.length > 500 || names.some(n => !/^[0-9]{4}_[0-9]{2}_[0-9]{2}_[0-9]{6}_[a-z0-9_]+\.php$/.test(n))) fail('MIGRATION_INVENTORY_INVALID')
    const observe = path => { const bytes = readPublicFile(workspaceRoot,path); return {path,sha256:sha256(bytes),flags:sourceFlags(bytes.toString('utf8'),path)} }
    const migrationEntries = names.map(n => observe(migrationDir+'/'+n))
    const artifacts = request.artifacts.map(path => { if (!artifactPath(path)) fail('COMMAND_UNSUPPORTED'); return observe(path) })
    const paths = [...new Set([...request.resourcePaths,...request.artifacts])]
    const pathChecks = paths.map(path => { inspectPath(workspaceRoot,path); return {path,canonicalRelativePath:path,symlink:false} })
    const present = path => {
      // Even a dangling symlink is present and unsafe. Do not follow or read private files.
      try { lstatSync(join(workspaceRoot,path)); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e }
    }
    inspectPath(workspaceRoot,'backend/bootstrap/cache')
    const inheritedSensitiveNames = Object.keys(process.env).filter(k => /^(?:DB_|PG|DATABASE_URL$|APP_|LARAVEL_|REDIS_|MAIL_|QUEUE_|SESSION_|CACHE_|BROADCAST_|PAYMONGO_|AWS_|GEMINI_|ANTHROPIC_|ASSISTANT_|ALLOW_CLINIC_DATABASE$|TEST_SCRATCH_|NODE_OPTIONS$|NODE_PATH$)|(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY)/i.test(k)).sort()
    const xml = readPublicFile(workspaceRoot,'backend/phpunit.xml').toString('utf8')
    return {status:'OBSERVED_OFFLINE',snapshot:{workspaceRoot,source:request.source,sourceObservation:'caller-declared',capturedAt:new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),migrationEntries,migrationDigest:fileListDigest(migrationEntries),artifacts,pathChecks,environment:{inspection:'names-only',inheritedSensitiveNames,privateFilesPresent:['backend/.env','backend/.env.testing'].filter(present)},cache:{state:present('backend/bootstrap/cache/config.php')?'present':'absent',provenance:'read-only-filesystem'},legacyProfileConflict:xml.includes('dental_clinic_scratch')},refusals:[]}
  } catch (error) {
    return {status:'REFUSED',snapshot:null,refusals:[{code:error instanceof DescriptorError?error.code:'WORKSPACE_OBSERVATION_FAILED'}]}
  }
}

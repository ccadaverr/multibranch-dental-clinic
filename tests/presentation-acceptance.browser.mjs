import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const suite = process.argv[2]
assert.ok(['owner', 'gen09', 'all'].includes(suite), 'Select owner, gen09 or all.')
const { DENTALOPS_LOCAL_TARGET, LOCAL_SYSTEM_BASE, LOCAL_SYSTEM_API, LOCAL_SYSTEM_EVIDENCE } = process.env
assert.ok(DENTALOPS_LOCAL_TARGET && LOCAL_SYSTEM_BASE && LOCAL_SYSTEM_API && LOCAL_SYSTEM_EVIDENCE,
  'Set the private target, explicit loopback origins and separate evidence directory.')
for (const origin of [LOCAL_SYSTEM_BASE, LOCAL_SYSTEM_API]) {
  const url = new URL(origin)
  assert.equal(url.origin, origin)
  assert.equal(url.protocol, 'http:')
  assert.equal(url.hostname, '127.0.0.1')
  assert.ok(Number(url.port) >= 1024, 'Use a dedicated loopback port.')
}
const root = resolve(LOCAL_SYSTEM_EVIDENCE)
assert.ok(!existsSync(root), 'Use a new evidence directory for each run.')
mkdirSync(root, { recursive: true, mode: 0o700 })
const results = []
const run = (name, filename, extra = {}) => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(filename, import.meta.url))], {
    env: { ...process.env, LOCAL_SYSTEM_EVIDENCE: resolve(root, name), ...extra },
    stdio: 'inherit',
    timeout: 300_000,
  })
  results.push({ name, status: result.status === 0 ? 'passed' : 'failed', exitCode: result.status })
}

if (suite === 'owner' || suite === 'all') run('owner', './presentation-owner.browser.mjs')
if (suite === 'gen09' || suite === 'all') {
  // Ship B13's verified probes unchanged. A copied probe still resolves the repository's existing session helper.
  for (const [file, hash] of [
    ['b13-authenticated-staff.mjs', '00d02c84f71d90b46ec1f93e3579f883395e9ed23ec67c91f8f57599ad4109f6'],
    ['b13-authenticated-prescription.mjs', 'e5e70b124cd4d993423fa88731cbc2f8846e78fee9d19ff1eb161f9ba64ea1a5'],
  ]) {
    const bytes = readFileSync(new URL(file, import.meta.url))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, 'Use the frozen B13 browser probe.')
  }
  // Verify the actual API session can read the exact synthetic IDs before the
  // frozen probes issue any mutation.
  run('gen09-target', './presentation-owner.browser.mjs', { PRESENTATION_TARGET_ONLY: '1' })
  if (results.at(-1).status === 'passed') {
    run('staff', './b13-authenticated-staff.mjs', { B13_MANUAL_CHECKIN: '0' })
    if (results.at(-1).status === 'passed') {
      run('dentist', './b13-authenticated-prescription.mjs', { LOCAL_SYSTEM_EVIDENCE: resolve(root, 'staff') })
    } else {
      results.push({ name: 'dentist', status: 'blocked', reason: 'Staff Visit prerequisite failed' })
    }
    run('staff-manual', './b13-authenticated-staff.mjs', { B13_MANUAL_CHECKIN: '1' })
  }
}
writeFileSync(resolve(root, 'presentation-results.json'), JSON.stringify({ suite, results }, null, 2))
assert.ok(results.every(r => r.status === 'passed'), 'A presentation probe failed. See the scoped results.')

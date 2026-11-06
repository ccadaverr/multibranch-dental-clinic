import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Deferred synthetic-controller and markup coverage; no authenticated/backend acceptance.
const require = createRequire(import.meta.url)
const bundle = await build({ entryPoints: ['src/pages/Hmo.jsx'], bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.css': 'empty' }, plugins: [{ name: 'react', setup(b) { b.onResolve({ filter: /^react$/ }, () => ({ path: pathToFileURL(require.resolve('react')).href, external: true })) } }] })
const { createMembershipLookup, createHmoCommandRunner, createHmoAttemptKeys, captureHmoCase, hmoOperationIsStale, refreshHmoView, HmoPage } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { resolve, promise } }
const visit = id => ({ id: `visit-${id}`, patientPublicId: `patient-${id}` })
const membership = (id, number = `SYNTHETIC-${id}`) => ({ patient: { id: `patient-${id}` }, active: { id: `membership-${id}`, provider_name: 'Synthetic provider', member_number: number }, history: [] })
function runnerFixture(refresh = async () => ({ ok: true })) {
  const output = { busy: [], feedback: [], allowed: true, after: 0 }
  const runner = createHmoCommandRunner({ allowed: () => output.allowed, refresh, onBusy: value => output.busy.push(value), onFeedback: (...args) => output.feedback.push(args) })
  runner.start()
  return { runner, output }
}

test('HMO-01 Visit A -> B -> A discards both earlier lookup lifetimes', async () => {
  const requests = [], states = []
  const lookup = createMembershipLookup(id => { const pending = deferred(); requests.push({ id, ...pending }); return pending.promise }, state => states.push(state))
  const firstA = lookup.select(visit('a')), b = lookup.select(visit('b')), nextA = lookup.select(visit('a'))
  assert.equal(states.at(-1).membership, null)
  requests[2].resolve({ ok: true, membership: membership('a', 'LATEST-A') }); await nextA
  const count = states.length
  requests[0].resolve({ ok: true, membership: membership('a', 'OLD-A') }); await firstA
  requests[1].resolve({ ok: true, membership: membership('b', 'PRIVATE-B') }); await b
  assert.equal(states.length, count)
  assert.equal(states.at(-1).membership.active.member_number, 'LATEST-A')
  lookup.dispose()
})

test('HMO-01 a foreign Patient response never displays a member number', async () => {
  const states = []
  const lookup = createMembershipLookup(async () => ({ ok: true, membership: membership('b', 'PRIVATE-B') }), state => states.push(state))
  assert.equal(await lookup.select(visit('a')), false)
  assert.equal(states.at(-1).membership, null)
  assert.ok(states.at(-1).error)
  lookup.dispose()
})

test('HMO-01 membership save completion cannot update a different Visit', async () => {
  const states = [], pending = deferred()
  const lookup = createMembershipLookup(async id => ({ ok: true, membership: membership(id.slice(-1)) }), state => states.push(state))
  await lookup.select(visit('a'))
  const lifetime = lookup.capture()
  const { runner, output } = runnerFixture()
  const saving = runner.run({ command: () => pending.promise, message: 'Membership saved.', current: () => lookup.current(lifetime), after: result => lookup.adopt(lifetime, result.membership) })
  await lookup.select(visit('b'))
  pending.resolve({ ok: true, membership: membership('a', 'SAVED-A') })
  assert.equal(await saving, false)
  assert.equal(states.at(-1).membership.patient.id, 'patient-b')
  assert.equal(output.feedback.length, 0)
  runner.stop(); lookup.dispose()
})

test('HMO-01 lookup unmount rejects late results and adoption', async () => {
  const pending = deferred(), states = []
  const lookup = createMembershipLookup(() => pending.promise, state => states.push(state))
  const loading = lookup.select(visit('a')), lifetime = lookup.capture()
  lookup.dispose()
  pending.resolve({ ok: true, membership: membership('a') })
  assert.equal(await loading, false)
  assert.equal(states.length, 1)
  assert.equal(lookup.adopt(lifetime, membership('a')), false)
})

for (const operation of ['provider response', 'withdrawal', 'requirement']) {
  test(`HMO-01 duplicate ${operation} is blocked before a React render`, async () => {
    const pending = deferred(), { runner, output } = runnerFixture()
    let calls = 0
    const command = () => { calls++; return pending.promise }
    const first = runner.run({ command, message: 'Externally recorded change.' })
    assert.equal(await runner.run({ command, message: 'Duplicate' }), false)
    assert.equal(calls, 1)
    assert.equal(runner.pending(), true)
    pending.resolve({ ok: true }); assert.equal(await first, true)
    assert.deepEqual(output.busy, [true, false])
    runner.stop()
  })
}

test('HMO-01 recoverable same-case failure keeps form state and unchanged retry key', async () => {
  const { runner, output } = runnerFixture()
  const form = { note: 'Synthetic retained draft' }, owner = {}, keys = createHmoAttemptKeys(() => 'new-key')
  const key = keys(owner, form, 'original-key')
  let cleared = false
  assert.equal(await runner.run({ command: async () => ({ ok: false, kind: 'validation', message: 'Synthetic refusal' }), message: 'Recorded', after: () => { cleared = true } }), false)
  assert.equal(cleared, false)
  assert.equal(form.note, 'Synthetic retained draft')
  assert.equal(keys(owner, form), key)
  assert.equal(output.feedback.at(-1)[1], 'warning')
  runner.stop()
})

test('HMO-01 server success and failed refresh remain distinct', async () => {
  const { runner, output } = runnerFixture(async () => ({ ok: false }))
  assert.equal(await runner.run({ command: async () => ({ ok: true }), message: 'External response recorded.', after: () => { output.after++ } }), true)
  assert.equal(output.after, 1)
  assert.match(output.feedback[0][0], /server confirmed this change.*could not be reloaded/)
  assert.equal(output.feedback[0][1], 'warning')
  assert.equal(output.feedback[0][2], true)
  runner.stop()
})

test('HMO-01 superseded, missing and thrown refreshes never claim a current view', async () => {
  assert.equal(await refreshHmoView(async () => ({ ok: true, superseded: true })), false)
  assert.equal(await refreshHmoView(undefined), false)
  assert.equal(await refreshHmoView(async () => { throw Error('Synthetic failure') }), false)
})

test('HMO-01 removal, revision, cycle or selected-context changes invalidate an open dialog', () => {
  const h = { id: 'case-a', server: true, revision: 4, submissionCycle: 1, patientPublicId: 'patient-a', branchId: 'b1', visitId: 'visit-a' }
  const operation = { caseSnapshot: captureHmoCase(h) }
  assert.equal(hmoOperationIsStale(operation, h, h.id), false)
  for (const changed of [{ revision: 5 }, { submissionCycle: 2 }, { patientPublicId: 'patient-b' }, { branchId: 'b2' }, { visitId: 'visit-b' }, { server: false }]) assert.equal(hmoOperationIsStale(operation, { ...h, ...changed }, h.id), true)
  assert.equal(hmoOperationIsStale(operation, null, h.id), true)
  assert.equal(hmoOperationIsStale(operation, h, 'case-b'), true)
  h.revision = 9
  assert.equal(operation.caseSnapshot.revision, 4)
})

for (const loss of ['role', 'unmount', 'selection']) {
  test(`HMO-01 ${loss} loss suppresses late feedback and form clearing`, async () => {
    const pending = deferred(), { runner, output } = runnerFixture()
    let selected = true
    const saving = runner.run({ command: () => pending.promise, message: 'Recorded', current: () => selected, after: () => { output.after++ } })
    if (loss === 'role') output.allowed = false
    if (loss === 'unmount') runner.stop()
    if (loss === 'selection') selected = false
    pending.resolve({ ok: true })
    assert.equal(await saving, false)
    assert.equal(output.after, 0)
    assert.equal(output.feedback.length, 0)
    runner.stop()
  })
}

test('HMO-01 unchanged retries reuse keys; edited payloads and new revisions rotate keys', () => {
  let count = 0
  const keys = createHmoAttemptKeys(() => `key-${++count}`), a = {}, b = {}
  const first = keys(a, { revision: 1, note: 'Draft' }, 'initial-a')
  keys(b, { reason: 'Different operation' })
  assert.equal(keys(a, { revision: 1, note: 'Draft' }), first)
  const changed = keys(a, { revision: 1, note: 'Edited' }, 'initial-a')
  assert.notEqual(changed, first)
  assert.notEqual(keys(a, { revision: 2, note: 'Edited' }), changed)
})

test('HMO-01 Owner oversight has no membership or command controls', () => {
  const state = { users: [{ id: 'owner', personId: 'person', role: 'Owner / Admin', status: 'Active', permissions: ['all'] }], persons: [{ id: 'person' }], hmo: [], patients: [], branches: [], clock: { timestamp: '2026-11-06T08:00:00+08:00' } }
  const html = renderToStaticMarkup(React.createElement(HmoPage, { role: 'owner', store: { state, session: { userId: 'owner', serverUserId: 'server-owner', role: 'owner', active: true }, toast() {} } }))
  assert.match(html, /read-only/)
  assert.doesNotMatch(html, /Patient HMO membership|Open HMO case|Record Provider Response|Withdraw \(self-pay\)/)
})

test('HMO-01 source preserves history and locks captured fields with accessible feedback', () => {
  const source = readFileSync('src/pages/Hmo.jsx', 'utf8')
  assert.match(source, /staff=\{staff && selected.server\}/)
  assert.match(source, /Earlier browser records.*read-only history, not used for billing/)
  assert.match(source, /No provider is contacted by this application/)
  assert.match(source, /<PatientHmoPage store=\{store\} context=\{context\}/)
  assert.match(source, /disabled=\{busy \|\| operationStale \|\| reloadNeeded\}/)
  assert.match(source, /disabled=\{busy \|\| stale\}/)
  assert.match(source, /key=\{`\$\{visit.id\}:\$\{visit.patientPublicId\}`\}/)
  assert.match(source, /role="alert" tabIndex=\{0\}/)
})

test('HMO-01 an old runner generation cannot clear a newer pending operation', async () => {
  const old = deferred(), next = deferred(), { runner, output } = runnerFixture()
  const oldRun = runner.run({ command: () => old.promise, message: 'Old' })
  runner.stop(); runner.start()
  const nextRun = runner.run({ command: () => next.promise, message: 'New' })
  old.resolve({ ok: true }); await oldRun
  assert.equal(runner.pending(), true)
  assert.deepEqual(output.busy, [true, true])
  next.resolve({ ok: true }); await nextRun
  assert.deepEqual(output.busy, [true, true, false])
  runner.stop()
})

test('HMO-01 Staff cannot render stale server cases or claim decisions outside current branch scopes', () => {
  const state = { users: [{ id: 'staff', personId: 'person', role: 'Staff', status: 'Active', branchId: 'b1', permissions: ['hmo'] }], persons: [{ id: 'person' }], staff: [{ userId: 'staff', personId: 'person', branchId: 'b1' }], hmo: [{ id: 'foreign', server: true, patientName: 'PRIVATE FOREIGN CASE', branchId: 'b2' }], claimDecisions: [{ visitId: 'foreign-visit', patientName: 'PRIVATE FOREIGN DECISION', branchId: 'b2' }], visits: [], patients: [], branches: [], clock: { timestamp: '2026-11-06T08:00:00+08:00' } }
  const html = renderToStaticMarkup(React.createElement(HmoPage, { role: 'staff', store: { state, session: { userId: 'staff', serverUserId: 'server-staff', role: 'staff', active: true, branchId: 'b1', branchScopes: ['b1'] }, toast() {} } }))
  assert.doesNotMatch(html, /PRIVATE FOREIGN CASE|PRIVATE FOREIGN DECISION/)
})

test('HMO-01 selected historical browser records remain non-authoritative and read-only', () => {
  const state = { users: [{ id: 'owner', personId: 'person', role: 'Owner / Admin', status: 'Active', permissions: ['all'] }], persons: [{ id: 'person' }], hmo: [{ id: 'history', legacy: true, patientId: 'patient', branchId: 'b1', status: 'Approved', requirements: [] }], patients: [{ id: 'patient', name: 'Synthetic historical Patient' }], branches: [], clock: { timestamp: '2026-11-06T08:00:00+08:00' } }
  const html = renderToStaticMarkup(React.createElement(HmoPage, { role: 'owner', context: { hmoCaseId: 'history' }, store: { state, session: { userId: 'owner', serverUserId: 'server-owner', role: 'owner', active: true }, toast() {} } }))
  assert.match(html, /not a server HMO case and never affects billing/)
  assert.doesNotMatch(html, /Record Provider Response|Check HMO Card|Withdraw \(self-pay\)/)
})

import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { setClockSource } from '../src/clock.js'
import { createLatestGate, ACTIVE_STATUSES, AWAITING_STATUSES, SERVER_QUEUE_ROW_CAP, countQueue, isTruncatedQueueResponse, queueVisibility } from '../src/queue-counts.js'
import * as queueApi from '../src/queue-api.js'
import { __resetCsrfCacheForTests } from '../src/api-client.js'

// M9 live-queue truthfulness: the clinic-server views show only factual, labelled tallies of existing queue statuses.
// No wait estimate, workload percentage, capacity threshold or Healthy/Attention label is presented as clinic policy.

setClockSource(() => new Date('2026-09-19T02:08:00Z')) // 10:08 Asia/Manila, clinic day 2026-09-19
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const entry = (status, fields = {}) => ({ id: `q-${Math.random()}`, status, clinicDate: '2026-09-19', branchId: 'b1', branch: 'Dr. Dana Roxas Dental Clinic', ...fields })
const server = { serverUserId: 'u1', role: 'staff' }

test('combined counts: awaiting = Waiting + Called + Treatment Ready; active adds Temporarily Away; Served and closed states are excluded', () => {
  assert.deepEqual(AWAITING_STATUSES, ['Waiting', 'Called', 'Treatment Ready'])
  assert.deepEqual(ACTIVE_STATUSES, ['Waiting', 'Called', 'Treatment Ready', 'Temporarily Away'])
  const queue = [entry('Waiting'), entry('Waiting'), entry('Called'), entry('Treatment Ready'), entry('Temporarily Away'), entry('Served'), entry('Completed'), entry('Cancelled'), entry('No-show')]
  assert.deepEqual(countQueue(queue), { waiting: 2, called: 1, treatmentReady: 1, away: 1, awaiting: 4, active: 5 })
})

test('counts cover the current Asia/Manila clinic day only and respect the branch filter', () => {
  const queue = [entry('Waiting'), entry('Waiting', { clinicDate: '2026-09-18' }), entry('Waiting', { clinicDate: '2026-09-20' }), entry('Waiting', { branchId: 'b2', branch: 'Roxas - Cardinal Dental Center' }), entry('Called', { branchId: 'b2', branch: 'Roxas - Cardinal Dental Center' })]
  assert.equal(countQueue(queue).active, 3) // Waiting b1, Waiting b2, Called b2 on 2026-09-19
  assert.equal(countQueue(queue, { branchId: 'b1' }).waiting, 1)
  assert.deepEqual([countQueue(queue, { branchId: 'b2' }).waiting, countQueue(queue, { branchId: 'b2' }).called], [1, 1])
  assert.equal(countQueue(queue, { branchId: 'b3' }).active, 0)
  // 00:30 on the next Manila day is already tomorrow's clinic day, although UTC still says the 19th.
  setClockSource(() => new Date('2026-09-19T16:30:00Z'))
  assert.equal(countQueue(queue).waiting, 1) // only the 2026-09-20 entry
  setClockSource(() => new Date('2026-09-19T02:08:00Z'))
  assert.deepEqual(countQueue(null), { waiting: 0, called: 0, treatmentReady: 0, away: 0, awaiting: 0, active: 0 })
})

test('zero is shown only after a successful, complete response for today; every other state is not-a-number', () => {
  const ready = { date: '2026-09-19', truncated: false }
  assert.equal(queueVisibility({ session: server, status: 'ready', snapshot: ready }).mode, 'ready')
  assert.equal(queueVisibility({ session: server, status: 'loading', snapshot: null }).mode, 'loading')
  assert.equal(queueVisibility({ session: server, status: 'idle', snapshot: null }).mode, 'loading')
  assert.equal(queueVisibility({ session: server, status: 'error', snapshot: ready }).mode, 'error') // a failed refresh never leaves old numbers looking current
  assert.equal(queueVisibility({ session: server, status: 'ready', snapshot: { date: '2026-09-18', truncated: false } }).mode, 'stale') // after midnight
  assert.equal(queueVisibility({ session: server, status: 'ready', snapshot: { date: '2026-09-19', truncated: true } }).mode, 'incomplete')
  assert.equal(queueVisibility({ session: { role: 'owner' }, status: 'ready', snapshot: ready }).mode, 'demo') // offline demo has no server queue
  assert.equal(queueVisibility({ session: null, status: 'ready', snapshot: ready }).mode, 'demo')
})

test('the queue client flags a response at the server row cap as possibly truncated', async () => {
  const oldFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = oldFetch; __resetCsrfCacheForTests() })
  const reply2 = body => { globalThis.fetch = async url => (String(url).includes('csrf') ? new Response(null, { status: 204 }) : new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })) }
  const reply = rows => { globalThis.fetch = async url => (String(url).includes('csrf') ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ data: rows }), { status: 200, headers: { 'Content-Type': 'application/json' } })) }
  reply(Array.from({ length: SERVER_QUEUE_ROW_CAP - 1 }, (_, i) => ({ id: String(i) })))
  assert.equal((await queueApi.loadQueue('2026-09-19')).truncated, false)
  reply(Array.from({ length: SERVER_QUEUE_ROW_CAP }, (_, i) => ({ id: String(i) })))
  assert.equal((await queueApi.loadQueue('2026-09-19')).truncated, true)
  assert.equal(isTruncatedQueueResponse(null), false)
  assert.equal(SERVER_QUEUE_ROW_CAP, 500) // mirrors QueueController::LIST_LIMIT
  assert.match(read('backend/app/Http/Controllers/QueueController.php'), /LIST_LIMIT = 500;/)
  // the server's own flag wins when present: a full page that the server says is complete is complete
  reply2({ data: Array.from({ length: SERVER_QUEUE_ROW_CAP }, (_, i) => ({ id: String(i) })), meta: { limit: 500, returned: 500, truncated: false } })
  assert.equal((await queueApi.loadQueue('2026-09-19')).truncated, false)
  reply2({ data: [{ id: 'x' }], meta: { limit: 500, returned: 1, truncated: true } })
  assert.equal((await queueApi.loadQueue('2026-09-19')).truncated, true)
})

// Hook-using shared controls must use the same React instance as renderToString.
// An absolute external URL also resolves from the data: bundle below.
const bundle = await build({ stdin: { contents: "export * from './src/pages/QueueCounts.jsx'; export { setClockSource as setBundledClock } from './src/clock.js'", resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{name:'single-renderer-react',setup(b){b.onResolve({filter:/^react$/},()=>({path:import.meta.resolve('react'),external:true}))}}],
})
const ui = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
ui.setBundledClock(() => new Date('2026-09-19T02:08:00Z')) // the bundle carries its own clock module
const branches = [{ id: 'b1', name: 'Dr. Dana Roxas Dental Clinic' }, { id: 'b2', name: 'Roxas - Cardinal Dental Center' }]
const store = (queue, vis = {}) => ({ state: { queue, branches }, session: server, appointmentsStatus: 'ready', queueSnapshot: { date: '2026-09-19', truncated: false }, appointmentFlow: { refresh() {} }, ...vis })
const html = el => renderToString(el)

test('rendered server counts are labelled, and zero appears only from a complete response', () => {
  const s = store([entry('Waiting'), entry('Called'), entry('Temporarily Away')])
  const ready = html(React.createElement(ui.QueueStatusCounts, { store: s, activeBranch: 'All Branches', vis: ui.queueVisibilityFor(s) }))
  for (const text of ['Waiting', 'Called', 'Treatment Ready', 'Temporarily Away', 'Waiting + Called + Treatment Ready', 'Served patients are not counted']) assert.ok(ready.includes(text), text)
  assert.doesNotMatch(ready, /min\b|workload|Healthy|Attention|%/)
  const empty = store([])
  assert.match(html(React.createElement(ui.QueueStatusCounts, { store: empty, activeBranch: 'All Branches', vis: ui.queueVisibilityFor(empty) })), /stat-value">0</)
  for (const bad of [{ appointmentsStatus: 'loading', queueSnapshot: null }, { appointmentsStatus: 'error' }, { queueSnapshot: { date: '2026-09-19', truncated: true } }, { queueSnapshot: { date: '2026-09-18', truncated: false } }]) {
    const t = store([], bad)
    const out = html(React.createElement(ui.QueueStatusCounts, { store: t, activeBranch: 'All Branches', vis: ui.queueVisibilityFor(t) }))
    assert.doesNotMatch(out, /stat-value/, JSON.stringify(bad)) // no number, so no false zero
  }
})

test('the by-branch view tallies each branch separately and filters by the active branch', () => {
  const s = store([entry('Waiting'), entry('Waiting', { branchId: 'b2', branch: 'Roxas - Cardinal Dental Center' }), entry('Treatment Ready', { branchId: 'b2', branch: 'Roxas - Cardinal Dental Center' })])
  const all = html(React.createElement(ui.QueueByBranch, { store: s, activeBranch: 'All Branches', vis: ui.queueVisibilityFor(s) }))
  assert.match(all, /Dr. Dana Roxas Dental Clinic[\s\S]*1 awaiting/); assert.match(all, /Roxas - Cardinal Dental Center[\s\S]*2 awaiting/)
  const one = html(React.createElement(ui.QueueByBranch, { store: s, activeBranch: 'Roxas - Cardinal Dental Center', vis: ui.queueVisibilityFor(s) }))
  assert.doesNotMatch(one, /Dr. Dana Roxas Dental Clinic/)
})

test('the offline demo has no server visibility and keeps its labelled estimates; server views drop them', () => {
  assert.equal(ui.queueVisibilityFor({ session: { role: 'staff' }, appointmentsStatus: 'ready', queueSnapshot: null }).mode, 'demo')
  const flow = read('src/pages/PatientFlow.jsx')
  assert.match(flow, /\.\.\.\(demo\?\[\{key:'wait',label:'Est\. wait \(demo\)'/) // estimate column exists only in the demo
  assert.match(flow, /if\(vis\.mode!=='demo'\)return <>[\s\S]*Live Queue by Branch[\s\S]*<\/>/) // server Capacity page returns before any estimator
  const dash = read('src/pages/Dashboards.jsx')
  assert.match(dash, /serverQueue\?<div className="top-gap"><QueueByBranch/)
  assert.match(dash, /serverQueue\?<QueueByBranch/)
  assert.match(dash, /\(serverQueue\?\[\]:branchData\.filter\(c=>c\.overloaded\)\)/)
  assert.doesNotMatch(read('src/pages/QueueCounts.jsx'), /branchCapacity|queueWaitEstimate|Progress/)
})

test('the Patient queue screen and Owner financial reporting are untouched by this slice', () => {
  assert.doesNotMatch(read('src/pages/PatientVisits.jsx'), /queue-counts|QueueCounts/)
  assert.match(read('src/pages/Dashboards.jsx'), /Recorded demo transactions/) // revenue stat stays as it was
})

test('overlapping refreshes: only the latest request may apply, and sign-out/session change invalidates everything in flight', () => {
  const gate = createLatestGate()
  const first = gate.begin(), second = gate.begin()
  assert.equal(gate.isCurrent(first), false) // a slow older response arriving after a newer one is dropped
  assert.equal(gate.isCurrent(second), true)
  gate.invalidate()
  assert.equal(gate.isCurrent(second), false) // response from a signed-out/changed session
  assert.equal(gate.isCurrent(gate.begin()), true)
  const store = read('src/store.jsx')
  assert.match(store, /const token=refreshGate\.begin\(\)/)
  // the gate is checked after the awaits and BEFORE any failure or success is applied
  assert.ok(store.indexOf('refreshGate.isCurrent(token)') < store.indexOf('const failed=[result,visits,queue'))
  assert.ok(store.indexOf('refreshGate.isCurrent(token)') < store.indexOf('setQueueSnapshot(operational'))
  assert.match(store, /refreshGate\.invalidate\(\)\},\[session\?\.serverUserId,session\?\.role\]/)
})

test('a response that started on one Manila day and finished on the next is out of date, not shown', () => {
  // snapshot.date is the day the request was SENT; midnight 2026-09-20 00:00 Manila = 2026-09-19T16:00Z
  const snapshot = { date: '2026-09-19', truncated: false }
  assert.equal(queueVisibility({ session: server, status: 'ready', snapshot, today: '2026-09-19' }).mode, 'ready')
  assert.equal(queueVisibility({ session: server, status: 'ready', snapshot, today: '2026-09-20' }).mode, 'stale')
})

test('server sessions label the capacity navigation "Live Queue by Branch"; the offline demo keeps its labels', () => {
  const layout = read('src/layout.jsx')
  assert.match(layout, /serverSession&&key==='capacity'\?'Live Queue by Branch':label/)
  assert.match(layout, /navGroups\(role,!!session\?\.serverUserId\)/)
  assert.match(read('src/data.js'), /\['capacity','Capacity & Workload'\]/) // demo label unchanged
})

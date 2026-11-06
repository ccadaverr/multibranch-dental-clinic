import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

// Authored, NOT EXECUTED. These drive the real detail controller and its public
// published output. The companion browser file exercises component wiring/focus.
// No backend transition/concurrency or real delivery acceptance is claimed.
let modulePromise
const ui = () => modulePromise ??= (async () => {
  const require = createRequire(import.meta.url)
  const bundle = await build({ entryPoints: ['src/pages/Handovers.jsx'], bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.css': 'empty' },
    plugins: [{ name: 'hnd-ui02-react', setup(b) { b.onResolve({ filter: /^react$/ }, () => ({ path: pathToFileURL(require.resolve('react')).href, external: true })) } }],
  })
  return import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
})()
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { resolve, promise } }
const ok = data => ({ ok: true, data })
const failure = { ok: false, kind: 'network', message: 'Synthetic detail retrieval failure.' }
const conflict = { ok: false, kind: 'conflict', message: 'Another actor changed this handover.' }
const row = (patch = {}) => ({
  id: 'handover-a', patient: { id: 'patient-a', name: 'Synthetic Patient A' },
  from: { branch: { id: 'a', name: 'Synthetic sending branch' } }, to: { branch: { id: 'b', name: 'Synthetic receiving branch' } },
  side: 'receiving', status: 'Sent', can_acknowledge: true, can_cancel: false,
  summary: 'PRIVATE SUMMARY', notes: 'PRIVATE NOTES', documents: [{ id: 'document-a', title: 'PRIVATE DOCUMENT' }], ...patch,
})
async function fixture(options = {}) {
  const { createHandoverDetailLifecycle } = await ui()
  const states = [], feedback = [], calls = { get: 0, ack: 0, cancel: 0, changed: 0 }
  let canonical = row(options.record)
  const controller = createHandoverDetailLifecycle({ id: options.id || 'handover-a', patientId: options.patientId || 'patient-a', clinical: options.clinical ?? true,
    allowed: options.allowed || (() => true), publish: state => states.push(structuredClone(state)), feedback: (...args) => feedback.push(args), changed: () => { calls.changed++ },
    api: {
      get: () => { calls.get++; return options.get ? options.get(calls.get) : Promise.resolve(ok(canonical)) },
      ack: () => { calls.ack++; if (options.ack) return options.ack(calls.ack); canonical = row({ status: 'Acknowledged', can_acknowledge: false }); return Promise.resolve(ok(canonical)) },
      cancel: () => { calls.cancel++; if (options.cancel) return options.cancel(); canonical = row({ ...options.record, status: 'Cancelled', can_cancel: false, can_acknowledge: false }); return Promise.resolve(ok(canonical)) },
    },
  })
  return { controller, states, feedback, calls, latest: () => states.at(-1) }
}

test('HND-UI-02 1: first authorized Sent open acknowledges only after successful detail GET', async () => {
  const get = deferred(), entered = deferred(), ack = deferred()
  const f = await fixture({ get: () => get.promise, ack: () => { entered.resolve(); return ack.promise } })
  const opening = f.controller.start()
  assert.equal(f.calls.ack, 0); assert.equal(f.latest().data, null)
  get.resolve(ok(row())); await entered.promise
  assert.equal(f.latest().data.status, 'Sent'); assert.equal(f.feedback.length, 0)
  ack.resolve(ok(row({ status: 'Acknowledged', can_acknowledge: false }))); await opening
  assert.equal(f.latest().data.status, 'Acknowledged'); assert.equal(f.calls.ack, 1)
  f.controller.stop()
})
test('HND-UI-02 2: initial GET failure exposes retrieval error without acknowledgment', async () => {
  const f = await fixture({ get: async () => failure })
  assert.equal(await f.controller.start(), false)
  assert.equal(f.latest().data, null); assert.match(f.latest().error, /retrieval failure/)
  assert.equal(f.calls.ack, 0); f.controller.stop()
})
test('HND-UI-02 3: first successful Retry after failed opening performs the required auto-ack', async () => {
  const f = await fixture({ get: async n => n === 1 ? failure : ok(row()) })
  await f.controller.start(); assert.equal(await f.controller.recover(), true)
  assert.equal(f.calls.get, 2); assert.equal(f.calls.ack, 1)
  assert.equal(f.latest().data.status, 'Acknowledged')
  assert.deepEqual(f.feedback, [['Handover acknowledged.', 'success']]); f.controller.stop()
})
test('HND-UI-02 4: synchronous pending guard blocks repeated auto-ack, retry and cancellation', async () => {
  const entered = deferred(), ack = deferred()
  const f = await fixture({ ack: () => { entered.resolve(); return ack.promise } })
  const first = f.controller.start(); await entered.promise
  assert.equal(await f.controller.recover(), false)
  assert.equal(await f.controller.reload(), false)
  assert.equal(await f.controller.retryAcknowledgment(), false)
  assert.equal(await f.controller.cancel(), false)
  assert.equal(f.calls.ack, 1); assert.equal(f.calls.cancel, 0)
  ack.resolve(ok(row({ status: 'Acknowledged', can_acknowledge: false }))); await first; f.controller.stop()
})
for (const [number, status] of [[5, 'Acknowledged'], [6, 'Cancelled']]) {
  test(`HND-UI-02 ${number}: Retry finding ${status} adopts server state without an acknowledgment`, async () => {
    const f = await fixture({ get: async n => n === 1 ? failure : ok(row({ status, can_acknowledge: false, can_cancel: false })) })
    await f.controller.start(); await f.controller.recover()
    assert.equal(f.latest().data.status, status); assert.equal(f.calls.ack, 0)
    assert.equal(f.feedback.length, 0); f.controller.stop()
  })
}
test('HND-UI-02 7: denied receiver cannot read or acknowledge, including explicit recovery', async () => {
  const f = await fixture({ allowed: () => false })
  await f.controller.start(); await f.controller.recover(); await f.controller.retryAcknowledgment()
  assert.deepEqual(f.calls, { get: 0, ack: 0, cancel: 0, changed: 0 }); f.controller.stop()
})
test('HND-UI-02 8: Owner detail strips clinical fields, titles and both transition permissions', async () => {
  const f = await fixture({ clinical: false })
  await f.controller.start(); await f.controller.recover()
  for (const key of ['summary','notes','pending_treatment','documents']) assert.equal(Object.hasOwn(f.latest().data, key), false)
  assert.equal(f.latest().data.can_acknowledge, false); assert.equal(f.latest().data.can_cancel, false)
  assert.equal(f.calls.ack, 0); assert.equal(await f.controller.cancel(), false); f.controller.stop()
})
test('HND-UI-02 9: sending-side opening and explicit retry cannot acknowledge', async () => {
  const f = await fixture({ record: { side: 'sending', can_acknowledge: false, can_cancel: true } })
  await f.controller.start(); assert.equal(await f.controller.retryAcknowledgment(), false)
  assert.equal(f.calls.ack, 0); assert.equal(f.latest().data.side, 'sending'); f.controller.stop()
})
test('HND-UI-02 10: pending A→B→A GETs cannot publish into a replacement lifetime', async () => {
  const oldA = deferred(), oldB = deferred()
  const a = await fixture({ get: () => oldA.promise }), b = await fixture({ id: 'handover-b', patientId: 'patient-b', get: () => oldB.promise })
  const first = a.controller.start(); a.controller.stop()
  const second = b.controller.start(); b.controller.stop()
  const current = await fixture(); await current.controller.start()
  const snapshots = [a.states.length, b.states.length, current.states.length]
  oldA.resolve(ok(row({ notes: 'OBSOLETE A' }))); oldB.resolve(ok(row({ id: 'handover-b', patient: { id: 'patient-b' }, notes: 'OBSOLETE B' })))
  await first; await second
  assert.deepEqual([a.states.length, b.states.length, current.states.length], snapshots)
  assert.equal(current.latest().data.status, 'Acknowledged')
  assert.equal(a.calls.ack + b.calls.ack, 0); current.controller.stop()
})
test('HND-UI-02 11: account replacement during acknowledgment suppresses adoption, toast and stale list refresh', async () => {
  const ack = deferred(), entered = deferred()
  const old = await fixture({ ack: () => { entered.resolve(); return ack.promise } })
  const pending = old.controller.start(); await entered.promise; old.controller.stop()
  const current = await fixture({ record: { can_acknowledge: false } }); await current.controller.start()
  const count = old.states.length
  ack.resolve(ok(row({ status: 'Acknowledged' }))); assert.equal(await pending, false)
  assert.equal(old.states.length, count); assert.deepEqual(old.feedback, [])
  assert.equal(old.calls.changed, 0); current.controller.stop()
})
test('HND-UI-02 12: scope revocation while pending suppresses every late publication and feedback', async () => {
  const ack = deferred(), entered = deferred(); let allowed = true
  const f = await fixture({ allowed: () => allowed, ack: () => { entered.resolve(); return ack.promise } })
  const pending = f.controller.start(); await entered.promise
  allowed = false; const count = f.states.length
  ack.resolve(ok(row({ status: 'Acknowledged' }))); await pending
  assert.equal(f.states.length, count); assert.equal(f.feedback.length, 0); assert.equal(f.calls.changed, 0)
  f.controller.stop()
})
test('HND-UI-02 13: concurrent acknowledgment/cancellation conflict reloads terminal truth without false success', async () => {
  for (const status of ['Acknowledged','Cancelled']) {
    const f = await fixture({ get: async n => ok(row(n === 1 ? {} : { status, can_acknowledge: false, can_cancel: false })), ack: async () => conflict })
    await f.controller.start()
    assert.equal(f.latest().data.status, status); assert.equal(f.calls.ack, 1)
    assert.match(f.latest().transitionError, /Automatic acknowledgment was not confirmed/)
    assert.match(f.latest().message, new RegExp(`Latest server status: ${status}`))
    assert.deepEqual(f.feedback, []); await f.controller.recover(); assert.equal(f.calls.ack, 1)
    f.controller.stop()
  }
})
test('HND-UI-02 14: failed acknowledgment and failed reconciliation recover Sent without retrying the transition automatically', async () => {
  const f = await fixture({ get: async n => n === 2 ? failure : ok(row()), ack: async n => n === 1 ? conflict : ok(row({ status: 'Acknowledged', can_acknowledge: false })) })
  await f.controller.start(); assert.equal(f.latest().data, null)
  await f.controller.recover()
  assert.equal(f.latest().data.status, 'Sent'); assert.equal(f.calls.ack, 1)
  assert.match(f.latest().transitionError, /not confirmed/); assert.equal(f.feedback.length, 0)
  assert.equal(await f.controller.retryAcknowledgment(), true); assert.equal(f.calls.ack, 2)
  f.controller.stop()
})
test('HND-UI-02 15: repeated Retry clicks share a single pending GET and acknowledgment', async () => {
  const get = deferred()
  const f = await fixture({ get: n => n === 1 ? Promise.resolve(failure) : get.promise })
  await f.controller.start()
  const pending = f.controller.recover()
  assert.equal(await f.controller.recover(), false); assert.equal(await f.controller.recover(), false)
  assert.equal(f.calls.get, 2)
  get.resolve(ok(row())); await pending
  assert.equal(f.calls.ack, 1); assert.equal(f.latest().data.status, 'Acknowledged'); f.controller.stop()
})
test('HND-UI-02 16: ordinary refresh after success or failure never restarts acknowledgment', async () => {
  for (const reject of [false,true]) {
    const f = await fixture(reject ? { ack: async () => conflict } : {})
    await f.controller.start(); await f.controller.reload(); await f.controller.recover(); await f.controller.start()
    assert.equal(f.calls.ack, 1); f.controller.stop()
  }
})
test('HND-UI-02 17: cancellation uses sending permission and cannot transition an Acknowledged record', async () => {
  const f = await fixture({ record: { side: 'sending', can_cancel: true, can_acknowledge: false } })
  await f.controller.start(); assert.equal(f.calls.cancel, 0)
  assert.equal(await f.controller.cancel(), true); assert.equal(f.latest().data.status, 'Cancelled')
  assert.equal(await f.controller.cancel(), false); assert.equal(f.calls.cancel, 1); f.controller.stop()
  const terminal = await fixture({ record: { side: 'sending', status: 'Acknowledged', can_cancel: true, can_acknowledge: false } })
  await terminal.controller.start(); assert.equal(await terminal.controller.cancel(), false)
  assert.equal(terminal.calls.cancel, 0); terminal.controller.stop()
})
test('HND-UI-02 18: success feedback contains no clinical notes or notification-delivery claim', async () => {
  const f = await fixture(); await f.controller.start()
  assert.deepEqual(f.feedback, [['Handover acknowledged.', 'success']])
  assert.doesNotMatch(JSON.stringify(f.feedback), /PRIVATE|notified|delivered|receiving team was told/i)
  f.controller.stop()
})
test('HND-UI-02 19: foreign Patient, handover ID, route or side never adopts as transition success', async () => {
  for (const patch of [
    { id: 'handover-b' }, { patient: { id: 'patient-b', name: 'PRIVATE B' } },
    { to: { branch: { id: 'c', name: 'Changed route' } } }, { side: 'sending' },
  ]) {
    const f = await fixture({ ack: async () => ok(row({ ...patch, status: 'Acknowledged' })) })
    await f.controller.start()
    assert.equal(f.latest().data.patient.id, 'patient-a'); assert.equal(f.latest().data.id, 'handover-a')
    assert.equal(f.latest().data.status, 'Sent'); assert.equal(f.feedback.length, 0)
    f.controller.stop()
  }
})
// Case 20 and explicit destructive confirmation/Escape/focus wiring live in the
// companion rendered browser scenarios, authored but not run.
test('HND-UI-02 20: component recovery, keyboard/focus and confirmation (explicit browser opt-in)', { skip: !process.env.HND_UI02_BROWSER_BASE_URL, timeout: 180000 }, async t => {
  const { chromium } = await import('playwright')
  const { runHndUi02Recovery } = await import('./hnd-ui-02-recovery.browser.mjs')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    await runHndUi02Recovery(page, process.env.HND_UI02_BROWSER_BASE_URL, (name, body) => t.test(name, body))
  } finally { await browser.close() }
})

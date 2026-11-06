import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Authored but not executed. Synthetic responses exercise frontend lifecycle guards only.
const require = createRequire(import.meta.url)
const bundle = await build({ entryPoints: ['src/pages/Handovers.jsx'], bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.css': 'empty' }, plugins: [{ name: 'react', setup(b) { b.onResolve({ filter: /^react$/ }, () => ({ path: pathToFileURL(require.resolve('react')).href, external: true })) } }] })
const { createHandoverResource, createHandoverDetailLifecycle, createHandoverSubmission, handoverRows, handoverDetail, handoverReferences, handoverAccess, HandoversPage } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { resolve, promise } }
const row = (id = 'a', overrides = {}) => ({ id: `handover-${id}`, patient: { id: `patient-${id}`, name: `Synthetic Patient ${id}`, code: id }, from: { branch: { id: 'b1', name: 'Synthetic sending branch' } }, to: { branch: { id: 'b2', name: 'Synthetic receiving branch' } }, status: 'Sent', can_acknowledge: true, can_cancel: false, summary: `PRIVATE SUMMARY ${id}`, notes: `PRIVATE NOTES ${id}`, documents: [{ id: `doc-${id}`, title: `PRIVATE TITLE ${id}` }], ...overrides })
const response = data => ({ ok: true, data })
const refused = { ok: false, kind: 'validation', errors: { status: ['Synthetic transition refusal'] } }
function lifecycle(overrides = {}) {
  const states = [], feedback = [], calls = { ack: 0, cancel: 0, changed: 0 }
  let canonical = row()
  const controller = createHandoverDetailLifecycle({ id: 'handover-a', patientId: 'patient-a', allowed: overrides.allowed || (() => true), clinical: overrides.clinical ?? true,
    api: { get: overrides.get || (async () => response(canonical)), ack: async id => { calls.ack++; if (overrides.ack) return overrides.ack(id); canonical = row('a', { status: 'Acknowledged', can_acknowledge: false }); return response(canonical) }, cancel: async id => { calls.cancel++; if (overrides.cancel) return overrides.cancel(id); canonical = row('a', { status: 'Cancelled', can_acknowledge: false, can_cancel: false }); return response(canonical) } },
    publish: state => states.push(state), feedback: (...args) => feedback.push(args), changed: () => { calls.changed++ },
  })
  return { controller, states, feedback, calls }
}

test('HND-UI-01 successful inbox, confirmed empty and error are distinct', async () => {
  const states = []
  let result = response([row()])
  const list = createHandoverResource(async () => result, handoverRows, state => states.push(state))
  list.start(); assert.equal(await list.reload(), true)
  assert.equal(states.at(-1).status, 'ready'); assert.equal(states.at(-1).data.length, 1)
  result = response([]); await list.reload()
  assert.deepEqual(states.at(-1).data, []); assert.equal(states.at(-1).status, 'ready')
  result = { ok: false, kind: 'network', message: 'Synthetic retrieval failure' }; await list.reload()
  assert.equal(states.at(-1).status, 'error'); assert.equal(states.at(-1).data, null)
  list.stop()
})

test('HND-UI-01 older inbox refreshes cannot replace a newer response', async () => {
  const requests = [], states = []
  const list = createHandoverResource(() => { const d = deferred(); requests.push(d); return d.promise }, handoverRows, state => states.push(state))
  list.start(); const old = list.reload(), next = list.reload()
  requests[1].resolve(response([row('b')])); await next
  requests[0].resolve(response([row('a')])); assert.equal(await old, false)
  assert.equal(states.at(-1).data[0].id, 'handover-b'); list.stop()
})

test('HND-UI-01 Patient A -> B -> A creates fresh lifetimes for lists and reference documents', async () => {
  const requests = [], events = []
  const create = patient => createHandoverResource(() => { const d = deferred(); requests.push(d); return d.promise }, data => handoverRows(data, `patient-${patient}`), state => events.push({ patient, state }))
  const a = create('a'); a.start(); const oldA = a.reload(); a.stop()
  const b = create('b'); b.start(); const oldB = b.reload(); b.stop()
  const nextA = create('a'); nextA.start(); const latest = nextA.reload()
  requests[2].resolve(response([row('a')])); await latest
  const count = events.length
  requests[1].resolve(response([row('b')])); requests[0].resolve(response([row('a', { notes: 'OLD PRIVATE A' })]))
  await oldA; await oldB
  assert.equal(events.length, count); assert.equal(events.at(-1).state.data[0].notes, 'PRIVATE NOTES a')
  assert.throws(() => handoverRows([row('b')], 'patient-a'))
  assert.throws(() => handoverReferences({ branches: [], dentists: [], docs: [{ id: 'b', status: 'Active', title: 'PRIVATE B', patient: { id: 'patient-b' } }] }, 'patient-a'))
  nextA.stop()
})

test('HND-UI-01 detail A -> B drops the original A response and validates the selected ID', async () => {
  const a = deferred(), statesA = [], statesB = []
  const first = createHandoverDetailLifecycle({ id: 'handover-a', patientId: 'patient-a', api: { get: () => a.promise }, publish: s => statesA.push(s) })
  const old = first.start(); first.stop()
  const next = createHandoverDetailLifecycle({ id: 'handover-b', patientId: 'patient-b', api: { get: async () => response(row('b', { can_acknowledge: false })) }, publish: s => statesB.push(s) })
  await next.start(); a.resolve(response(row('a'))); await old
  assert.equal(statesA.at(-1).data, null); assert.equal(statesB.at(-1).data.id, 'handover-b')
  assert.throws(() => handoverDetail(row('a'), 'handover-b', 'patient-b'))
  next.stop()
})

test('HND-UI-01 eligible open automatically acknowledges once; ordinary reload does not repeat it', async () => {
  const { controller, states, calls, feedback } = lifecycle()
  assert.equal(await controller.start(), true)
  await controller.reload()
  assert.equal(calls.ack, 1); assert.equal(states.at(-1).data.status, 'Acknowledged')
  assert.equal(await controller.retryAcknowledgment(), false)
  assert.deepEqual(feedback, [['Handover acknowledged.', 'success']]); controller.stop()
})

test('HND-UI-01 pending acknowledgment blocks duplicate acknowledgment and cancellation', async () => {
  const pending = deferred(), entered = deferred()
  const { controller, calls } = lifecycle({ ack: () => { entered.resolve(); return pending.promise } })
  const opening = controller.start(); await entered.promise
  assert.equal(await controller.retryAcknowledgment(), false)
  assert.equal(await controller.cancel(), false)
  assert.equal(calls.ack, 1); assert.equal(calls.cancel, 0)
  pending.resolve(response(row('a', { status: 'Acknowledged', can_acknowledge: false })))
  await opening; controller.stop()
})

test('HND-UI-01 failed automatic acknowledgment exposes error and permits recovery without false acceptance', async () => {
  let attempt = 0
  const { controller, states, feedback, calls } = lifecycle({ ack: async () => ++attempt === 1 ? refused : response(row('a', { status: 'Acknowledged', can_acknowledge: false })) })
  assert.equal(await controller.start(), false)
  assert.equal(states.at(-1).data.status, 'Sent'); assert.match(states.at(-1).transitionError, /not confirmed/)
  assert.equal(feedback.length, 0); assert.equal(calls.ack, 1)
  assert.equal(await controller.retryAcknowledgment(), true)
  assert.equal(states.at(-1).data.status, 'Acknowledged'); assert.equal(calls.ack, 2)
  controller.stop()
})

test('HND-UI-01 rejected acknowledgment reconciles canonical cancellation without acceptance success', async () => {
  let reads = 0
  const { controller, states, feedback } = lifecycle({ get: async () => response(++reads === 1 ? row() : row('a', { status: 'Cancelled', can_acknowledge: false })), ack: async () => refused })
  await controller.start()
  assert.equal(states.at(-1).data.status, 'Cancelled'); assert.equal(feedback.length, 0)
  assert.equal(await controller.retryAcknowledgment(), false); controller.stop()
})

test('HND-UI-01 duplicate cancellation is synchronously blocked and adopts only confirmed state', async () => {
  const pending = deferred()
  const { controller, states, calls, feedback } = lifecycle({ get: async () => response(row('a', { can_acknowledge: false, can_cancel: true })), cancel: () => pending.promise })
  await controller.start(); const cancelling = controller.cancel()
  assert.equal(await controller.cancel(), false); assert.equal(calls.cancel, 1)
  pending.resolve(response(row('a', { status: 'Cancelled', can_acknowledge: false, can_cancel: false })))
  assert.equal(await cancelling, true); assert.equal(states.at(-1).data.status, 'Cancelled')
  assert.deepEqual(feedback, [['Handover cancelled.', 'success']]); controller.stop()
})

test('HND-UI-01 failed cancellation reloads already-acknowledged state without false cancellation feedback', async () => {
  let reads = 0
  const { controller, states, feedback } = lifecycle({ get: async () => response(++reads === 1 ? row('a', { can_acknowledge: false, can_cancel: true }) : row('a', { status: 'Acknowledged', can_acknowledge: false, can_cancel: false })), cancel: async () => refused })
  await controller.start(); assert.equal(await controller.cancel(), false)
  assert.equal(states.at(-1).data.status, 'Acknowledged'); assert.match(states.at(-1).transitionError, /Cancellation was not confirmed/)
  assert.equal(feedback.length, 0); controller.stop()
})

test('HND-UI-01 permission rejection immediately removes detail and clinical titles', async () => {
  const { controller, states, feedback } = lifecycle({ ack: async () => ({ ok: false, kind: 'forbidden' }) })
  await controller.start()
  assert.equal(states.at(-1).data, null); assert.equal(states.at(-1).denied, true)
  assert.equal(feedback.length, 0); controller.stop()
})

test('HND-UI-01 creation captures immutable Patient and payload and blocks duplicate submission', async () => {
  const pending = deferred(), payloads = [], confirmations = []
  const sender = createHandoverSubmission({ patientId: 'patient-a', allowed: () => true, send: body => { payloads.push(body); return pending.promise }, publish() {}, confirmed: h => confirmations.push(h) })
  sender.start()
  const form = { patient_id: 'patient-b', summary: 'Captured draft', from_branch_ref: 'b1', to_branch_ref: 'b2' }, picked = ['doc-a']
  const saving = sender.submit(form, picked)
  form.summary = 'Newer edit'; picked.push('doc-b')
  assert.equal(await sender.submit(form, picked), false)
  assert.equal(payloads.length, 1); assert.equal(payloads[0].patient_id, 'patient-a')
  assert.equal(payloads[0].summary, 'Captured draft'); assert.deepEqual(payloads[0].document_ids, ['doc-a'])
  pending.resolve(response(row())); assert.equal(await saving, true)
  assert.equal(confirmations.length, 1); sender.stop()
})

test('HND-UI-01 failed same-Patient creation retains draft and does not close it', async () => {
  const states = [], form = { summary: 'Retained draft' }
  let closed = false
  const sender = createHandoverSubmission({ patientId: 'patient-a', allowed: () => true, send: async () => refused, publish: s => states.push(s), confirmed: () => { closed = true } })
  sender.start(); assert.equal(await sender.submit(form, []), false)
  assert.equal(form.summary, 'Retained draft'); assert.equal(closed, false)
  assert.ok(states.some(s => s.error)); sender.stop()
})

for (const loss of ['Patient switch', 'unmount', 'permission loss']) {
  test(`HND-UI-01 ${loss} during creation suppresses obsolete success and form closure`, async () => {
    const pending = deferred(); let allowed = true, closed = 0
    const sender = createHandoverSubmission({ patientId: 'patient-a', allowed: () => allowed, send: () => pending.promise, publish() {}, confirmed: () => { closed++ } })
    sender.start(); const saving = sender.submit({ summary: 'Private A' }, [])
    if (loss === 'permission loss') allowed = false
    else sender.stop()
    pending.resolve(response(row())); assert.equal(await saving, false)
    assert.equal(closed, 0); sender.stop()
  })
}

test('HND-UI-01 Owner projection removes clinical notes and document titles even in an unexpected response', () => {
  const metadata = handoverDetail(row(), 'handover-a', 'patient-a', false)
  for (const field of ['summary', 'pending_treatment', 'notes', 'documents']) assert.equal(Object.hasOwn(metadata, field), false)
  assert.equal(metadata.can_acknowledge, false); assert.equal(metadata.can_cancel, false)
})

test('HND-UI-01 document choices contain only Active documents for the actual Patient', () => {
  const refs = handoverReferences({ branches: [], dentists: [], docs: [{ id: 'doc-a', status: 'Active', patient: { id: 'patient-a' }, title: 'Authorized title' }, { id: 'inactive', status: 'Retracted', patient: { id: 'patient-a' } }] }, 'patient-a')
  assert.deepEqual(refs.docs.map(d => d.id), ['doc-a'])
})

test('HND-UI-01 actor access requires the actual active server identity', () => {
  const store = { state: { persons: [{ id: 'person' }], users: [{ id: 'owner', personId: 'person', role: 'Owner / Admin', status: 'Active', permissions: ['all'] }] }, session: { userId: 'owner', serverUserId: 'server-owner', role: 'owner', active: true } }
  assert.equal(handoverAccess(store).enabled, true); assert.equal(handoverAccess(store).clinical, false)
  assert.equal(handoverAccess(store, 'staff').enabled, false)
  assert.equal(handoverAccess({ ...store, session: { ...store.session, active: false } }).enabled, false)
  const html = renderToStaticMarkup(React.createElement(HandoversPage, { store, role: 'owner' }))
  assert.match(html, /Administration/); assert.doesNotMatch(html, /Hand over care|PRIVATE SUMMARY|PRIVATE TITLE/)
})

test('HND-UI-01 obsolete document-reference responses cannot populate a newer Patient form', async () => {
  const pendingA = deferred(), statesA = [], statesB = []
  const a = createHandoverResource(() => pendingA.promise, data => handoverReferences(data, 'patient-a'), state => statesA.push(state))
  a.start(); const old = a.reload(); a.stop()
  const b = createHandoverResource(async () => response({ branches: [], dentists: [], docs: [{ id: 'doc-b', status: 'Active', patient: { id: 'patient-b' }, title: 'PRIVATE TITLE B' }] }), data => handoverReferences(data, 'patient-b'), state => statesB.push(state))
  b.start(); await b.reload()
  pendingA.resolve(response({ branches: [], dentists: [], docs: [{ id: 'doc-a', status: 'Active', patient: { id: 'patient-a' }, title: 'PRIVATE TITLE A' }] }))
  assert.equal(await old, false)
  assert.equal(statesA.at(-1).data, null); assert.equal(statesB.at(-1).data.docs[0].title, 'PRIVATE TITLE B')
  b.stop()
})

test('HND-UI-01 role loss during acknowledgment suppresses clinical adoption and success feedback', async () => {
  const pending = deferred(), entered = deferred(); let allowed = true
  const { controller, states, feedback } = lifecycle({ allowed: () => allowed, ack: () => { entered.resolve(); return pending.promise } })
  const loading = controller.start(); await entered.promise
  const count = states.length; allowed = false
  pending.resolve(response(row('a', { status: 'Acknowledged', notes: 'LATE PRIVATE NOTES' })))
  assert.equal(await loading, false)
  assert.equal(feedback.length, 0)
  assert.equal(states.slice(count).some(s => s.data?.status === 'Acknowledged'), false)
  controller.stop()
})

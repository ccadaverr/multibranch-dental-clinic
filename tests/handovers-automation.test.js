import nodeTest from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToString } from 'react-dom/server'

// STF-06 / DEN-11, reconciled by HND-TEST-01. Authored; execution deferred.
// These synthetic HTTP/controller/SSR checks do not prove backend authorization,
// notification persistence/delivery, or browser effects, focus and layout.
// Run the companion hnd-test-01-contract.browser.mjs for observable dialog/form checks.
// Deferred acceptance sequence:
// 1. node --test tests/handovers-automation.test.js
// 2. node --test tests/hnd-ui-01-handovers.test.js
// 3. After HND-01/HND-02 integration and independent disposable-DB verification,
//    run HandoverTest, Hnd01HandoverTransitionTest, Hnd02HandoverCreateTest and
//    notification regressions; verify real commit/rollback behavior separately.
// 4. Invoke runHndTest01Handovers and runHndUi01Handovers with an isolated page,
//    then check real authenticated Staff/Dentist/Owner/Patient navigation/access,
//    auto-ack/retry, cancellation conflicts, keyboard/focus and long-content
//    layouts at 390, 768, 1024 and 1440px. SSR cannot accept these browser gates.
// Keep these tests serial: each transport fixture owns and restores global fetch.
const test = (name, run) => nodeTest(name, { timeout: 10_000, concurrency: false }, async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  await run(t)
})
const require = createRequire(import.meta.url)
const bundle = await build({
  stdin: { contents: `
    export * from './src/pages/Handovers.jsx';
    export * as api from './src/api-client.js';
    export { NAV } from './src/data.js';
    export { canAccessPage } from './src/safeguards.js';
    export { PORTAL_PAGES, NAV_SECTIONS, portalPageFromHash } from './src/patient/Portal.jsx';
  `, resolveDir: process.cwd(), sourcefile: 'hnd-test-01-entry.js' },
  bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.css': 'empty' },
  plugins: [{ name: 'shared-react-runtime', setup(b) {
    b.onResolve({ filter: /^(?:react|react-dom)(?:\/.*)?$/ }, ({ path }) => ({ path: pathToFileURL(require.resolve(path)).href, external: true }))
  } }],
})
// No cache/report files are written by this harness.
const m = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const ids = {
  handover: '01ARZ3NDEKTSV4RRFFQ69G5FAV', other: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  patient: '01ARZ3NDEKTSV4RRFFQ69G5FAX', otherPatient: '01ARZ3NDEKTSV4RRFFQ69G5FAY', document: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const ok = (data, status = 200) => Response.json({ data }, { status })
const rejection = () => Response.json({ message: 'Synthetic transition refusal.', errors: { status: ['This handover is already Acknowledged.'] } }, { status: 422 })

// Canonical synthetic projection of a server-authenticated account; a role prop
// alone grants nothing. Public Patient/handover/document IDs are distinct from
// branch and Dentist legacy references, as in HandoverController::view.
function actor(role = 'staff', branchId = 'b2') {
  const userId = `fixture-${role}`, personId = `person-${role}`
  const roleName = { staff: 'Staff', dentist: 'Dentist', owner: 'Owner / Admin', patient: 'Patient' }[role]
  const permissions = { staff: ['patient-demographics'], dentist: ['clinical-records', 'schedule'], owner: ['all'], patient: ['patient-portal'] }[role]
  return {
    session: { userId, serverUserId: { staff: 41, dentist: 42, owner: 43, patient: 44 }[role], role, active: true, branchId, branchScopes: [branchId], dentistId: 'fixture-dentist', patientId: ids.patient },
    state: { persons: [{ id: personId }], users: [{ id: userId, personId, role: roleName, roleName, branchId, status: 'Active', accountStatus: 'Active', permissions }],
      staff: [{ userId, personId, branchId }], dentists: [{ id: 'fixture-dentist', userId, personId, branchIds: [branchId] }], patients: [{ id: ids.patient, userId, personId }],
    }, toast() {},
  }
}
function record({ id = ids.handover, patientId = ids.patient, status = 'Sent', side = 'receiving', content = true } = {}) {
  const row = { id, status, side, created_at: '2026-11-06T10:00:00+08:00', patient: { id: patientId, name: 'Synthetic Patient', code: 'SYN-01' },
    from: { branch: { id: 'b1', name: 'Synthetic sending branch' }, dentist: null, by: 'Synthetic sender' },
    to: { branch: { id: 'b2', name: 'Synthetic receiving branch' }, dentist: { id: 'fixture-dentist', name: 'Synthetic Dentist' } },
    acknowledged: status === 'Acknowledged' ? { by: 'Synthetic receiver', at: '2026-11-06T10:05:00+08:00' } : null,
    can_acknowledge: side === 'receiving' && status === 'Sent', can_cancel: side === 'sending' && status === 'Sent',
  }
  if (content) Object.assign(row, { summary: 'PRIVATE SYNTHETIC SUMMARY', pending_treatment: 'PRIVATE SYNTHETIC PENDING', notes: 'PRIVATE SYNTHETIC NOTES', documents: [{ id: ids.document, title: 'PRIVATE SYNTHETIC TITLE', category: 'Synthetic document', date: '2026-11-06' }] })
  return row
}
async function transport(route, run) {
  const original = globalThis.fetch, calls = []
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url), 'http://localhost')
    if (parsed.pathname === '/sanctum/csrf-cookie') return new Response(null, { status: 204 })
    const call = { path: parsed.pathname, query: parsed.searchParams, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, credentials: options.credentials }
    calls.push(call)
    return route(call)
  }
  try { return await run(calls) } finally { globalThis.fetch = original }
}
function detail(store, publish, feedback = () => {}) {
  const access = m.handoverAccess(store)
  return m.createHandoverDetailLifecycle({ id: ids.handover, patientId: ids.patient, clinical: access.clinical,
    allowed: () => m.handoverAccess(store).enabled, api: { get: m.api.handover, ack: m.api.acknowledgeHandover, cancel: m.api.cancelHandover }, publish, feedback,
  })
}

test('STF-06 / DEN-11 creation dispatches directly and confirms the server Sent record without an approval stage', async () => {
  await transport(call => {
    assert.equal(call.path, '/api/handovers'); assert.equal(call.method, 'POST')
    return ok(record({ side: 'sending' }), 201)
  }, async calls => {
    const store = actor('staff', 'b1'), confirmations = [], states = []
    const sender = m.createHandoverSubmission({ patientId: ids.patient, allowed: () => m.handoverAccess(store).clinical,
      send: m.api.createHandover, publish: patch => states.push(patch), confirmed: row => confirmations.push(row),
    })
    sender.start()
    try {
      assert.equal(await sender.submit({ from_branch_ref: 'b1', to_branch_ref: 'b2', to_dentist_ref: 'fixture-dentist', summary: 'Synthetic handover summary' }, [ids.document]), true)
      assert.equal(calls.length, 1)
      assert.deepEqual(calls[0].body, { patient_id: ids.patient, from_branch_ref: 'b1', to_branch_ref: 'b2', to_dentist_ref: 'fixture-dentist', summary: 'Synthetic handover summary', document_ids: [ids.document], pending_treatment: null, notes: null })
      assert.equal(calls[0].credentials, 'include')
      assert.equal(confirmations.length, 1); assert.equal(confirmations[0].status, 'Sent')
      assert.equal(confirmations[0].can_acknowledge, false); assert.equal(confirmations[0].can_cancel, true)
      assert.equal(states.some(s => s.error), false)
    } finally { sender.stop() }
  })
})

for (const role of ['staff', 'dentist']) {
  test(`STF-06 / DEN-11 ${role} opening automatically acknowledges only after eligible detail is confirmed`, async () => {
    const loaded = deferred(), ack = deferred(), ackStarted = deferred(), states = [], feedback = []
    let acknowledged = false
    await transport(call => {
      if (call.method === 'GET') return acknowledged ? ok(record({ status: 'Acknowledged' })) : loaded.promise
      assert.equal(call.path, `/api/handovers/${ids.handover}/acknowledge`)
      ackStarted.resolve(); return ack.promise
    }, async calls => {
      const controller = detail(actor(role), state => states.push(state), (...args) => feedback.push(args))
      const opening = controller.start()
      try {
        assert.equal(calls.filter(c => c.method === 'POST').length, 0)
        loaded.resolve(ok(record())); await ackStarted.promise
        assert.equal(states.at(-1).data.status, 'Sent'); assert.equal(states.at(-1).busy, true)
        assert.equal(feedback.length, 0)
        assert.equal(await controller.retryAcknowledgment(), false)
        assert.equal(await controller.cancel(), false)
        assert.equal(calls.filter(c => c.method === 'POST').length, 1)
        acknowledged = true; ack.resolve(ok(record({ status: 'Acknowledged' })))
        assert.equal(await opening, true)
        assert.equal(states.at(-1).data.status, 'Acknowledged')
        assert.equal(states.at(-1).data.acknowledged.by, 'Synthetic receiver')
        assert.equal(feedback.length, 1); assert.equal(feedback[0][1], 'success')
        await controller.reload()
        assert.equal(calls.filter(c => c.method === 'POST').length, 1)
      } finally { controller.stop() }
    })
  })
}

test('STF-06 / DEN-11 failed acknowledgment retains Sent and retries without false acceptance', async () => {
  let attempts = 0
  const states = [], feedback = []
  await transport(call => {
    if (call.method === 'GET') return ok(record())
    assert.equal(call.path, `/api/handovers/${ids.handover}/acknowledge`)
    return ++attempts === 1 ? Response.json({ message: 'Synthetic recoverable failure.', errors: { status: ['Acknowledgment could not be recorded.'] } }, { status: 422 }) : ok(record({ status: 'Acknowledged' }))
  }, async () => {
    const controller = detail(actor(), state => states.push(state), (...args) => feedback.push(args))
    try {
      assert.equal(await controller.start(), false)
      assert.equal(states.at(-1).data.status, 'Sent'); assert.ok(states.at(-1).transitionError)
      assert.equal(feedback.length, 0)
      assert.equal(await controller.retryAcknowledgment(), true)
      assert.equal(states.at(-1).data.status, 'Acknowledged'); assert.equal(attempts, 2)
      assert.equal(feedback.length, 1)
    } finally { controller.stop() }
  })
})

test('STF-06 / DEN-11 successful HTTP without confirmed acknowledgment cannot claim acceptance', async () => {
  const states = [], feedback = []
  await transport(() => ok(record()), async () => {
    const controller = detail(actor(), state => states.push(state), (...args) => feedback.push(args))
    try {
      assert.equal(await controller.start(), false)
      assert.equal(states.at(-1).data.status, 'Sent'); assert.ok(states.at(-1).transitionError)
      assert.equal(feedback.length, 0)
    } finally { controller.stop() }
  })
})

test('STF-06 / DEN-11 sending-side opening never auto-acknowledges; cancellation adopts confirmed server state', async () => {
  const cancelling = deferred(), states = [], feedback = []
  await transport(call => {
    if (call.method === 'GET') return ok(record({ side: 'sending' }))
    assert.equal(call.path, `/api/handovers/${ids.handover}/cancel`); return cancelling.promise
  }, async calls => {
    const controller = detail(actor('staff', 'b1'), state => states.push(state), (...args) => feedback.push(args))
    try {
      await controller.start(); assert.equal(calls.length, 1)
      const saving = controller.cancel()
      assert.equal(await controller.cancel(), false)
      assert.equal(states.at(-1).data.status, 'Sent'); assert.equal(feedback.length, 0)
      cancelling.resolve(ok(record({ side: 'sending', status: 'Cancelled' })))
      assert.equal(await saving, true)
      assert.equal(states.at(-1).data.status, 'Cancelled')
      assert.equal(calls.filter(c => c.method === 'POST').length, 1)
      assert.equal(feedback.length, 1)
      assert.equal(await controller.cancel(), false)
    } finally { controller.stop() }
  })
})

test('STF-06 / DEN-11 cancellation losing to acknowledgment reconciles canonical state without cancellation success', async () => {
  let reads = 0
  const states = [], feedback = []
  await transport(call => call.method === 'GET' ? ok(record({ side: 'sending', status: ++reads === 1 ? 'Sent' : 'Acknowledged' })) : rejection(), async () => {
    const controller = detail(actor('staff', 'b1'), state => states.push(state), (...args) => feedback.push(args))
    try {
      await controller.start(); assert.equal(await controller.cancel(), false)
      assert.equal(states.at(-1).data.status, 'Acknowledged'); assert.ok(states.at(-1).transitionError)
      assert.equal(feedback.length, 0)
    } finally { controller.stop() }
  })
})

test('STF-06 / DEN-11 API normalizes terminal-state rejection instead of mocking Acknowledged -> Cancelled success', async () => {
  await transport(call => {
    assert.equal(call.path, `/api/handovers/${ids.handover}/cancel`)
    return rejection()
  }, async () => {
    const result = await m.api.cancelHandover(ids.handover)
    assert.equal(result.ok, false); assert.equal(result.kind, 'validation')
    assert.deepEqual(result.errors.status, ['This handover is already Acknowledged.'])
  })
})

test('STF-06 / DEN-11 navigation includes clinic roles, excludes Patient and rejects the Patient handovers hash', () => {
  for (const role of ['staff', 'dentist', 'owner']) {
    const store = actor(role)
    assert.ok(m.NAV[role].some(([page]) => page === 'handovers'))
    assert.equal(m.canAccessPage(store.state, store.session, 'handovers'), true)
  }
  const patient = actor('patient')
  assert.equal(m.NAV.patient.some(([page]) => page === 'handovers'), false)
  assert.equal(m.canAccessPage(patient.state, patient.session, 'handovers'), false)
  assert.equal(m.PORTAL_PAGES.includes('handovers'), false)
  assert.equal(m.NAV_SECTIONS.flatMap(section => section.items).some(([page]) => page === 'handovers'), false)
  assert.equal(m.portalPageFromHash('#p/handovers'), null)
  assert.equal(m.portalPageFromHash('#p/visits'), 'visits')
})

test('STF-06 / DEN-11 authenticated SSR checks the initial loading shell, not unexecuted async records', () => {
  for (const role of ['staff', 'dentist']) {
    const html = renderToString(React.createElement(m.HandoversPage, { store: actor(role), role }))
    assert.match(html, /Patient handovers/); assert.match(html, /To acknowledge/)
    assert.match(html, /role="tablist"/); assert.match(html, /Loading handovers/)
    assert.doesNotMatch(html, /PRIVATE SYNTHETIC/)
  }
})

test('STF-06 / DEN-11 Owner receives metadata only, cannot auto-acknowledge and has no clinical actions', async () => {
  // First the real Owner envelope; then an intentionally unexpected clinical
  // response to verify the frontend projection still hides restricted fields.
  for (const payload of [record({ side: null, content: false }), record()]) {
    const states = []
    await transport(call => { assert.equal(call.method, 'GET'); return ok(payload) }, async calls => {
      const controller = detail(actor('owner'), state => states.push(state))
      try {
        assert.equal(await controller.start(), true)
        const metadata = states.at(-1).data
        assert.equal(metadata.patient.id, ids.patient); assert.equal(metadata.from.branch.id, 'b1')
        for (const field of ['summary', 'pending_treatment', 'notes', 'documents']) assert.equal(Object.hasOwn(metadata, field), false)
        assert.equal(metadata.can_acknowledge, false); assert.equal(metadata.can_cancel, false)
        assert.equal(await controller.retryAcknowledgment(), false); assert.equal(await controller.cancel(), false)
        assert.equal(calls.length, 1)
      } finally { controller.stop() }
    })
  }
  const html = renderToString(React.createElement(m.HandoversPage, { store: actor('owner'), role: 'owner' }))
  assert.match(html, /Administration/); assert.doesNotMatch(html, /To acknowledge|Hand over care|PRIVATE SYNTHETIC/)
})

test('STF-06 / DEN-11 untrusted role props, inactive accounts, demo sessions and Patient sessions do not expose clinical actions', async () => {
  const inactive = actor(), demo = actor(), patient = actor('patient')
  inactive.state.users[0].accountStatus = 'Inactive'
  delete demo.session.serverUserId
  const forged = actor(); assert.equal(m.handoverAccess(forged, 'owner').enabled, false)
  for (const store of [inactive, demo, patient, { toast() {} }]) {
    assert.equal(m.handoverAccess(store).enabled, false)
    const html = renderToString(React.createElement(m.HandoverDialog, { store, id: ids.handover, patientId: ids.patient, onClose() {} }))
    assert.match(html, /cannot open/); assert.doesNotMatch(html, /PRIVATE SYNTHETIC|Cancel handover|Retry automatic acknowledgment/)
    let requests = 0
    const controller = m.createHandoverDetailLifecycle({ id: ids.handover, patientId: ids.patient, allowed: () => m.handoverAccess(store).enabled,
      api: { get() { requests++; return Promise.resolve({ ok: true, data: record() }) } }, publish() {},
    })
    try { await controller.start(); assert.equal(requests, 0) } finally { controller.stop() }
  }
})

test('STF-06 / DEN-11 server access rejection hides detail and never starts acknowledgment', async () => {
  const states = []
  await transport(call => { assert.equal(call.method, 'GET'); return Response.json({ message: 'Synthetic access refusal.' }, { status: 403 }) }, async calls => {
    const controller = detail(actor(), state => states.push(state))
    try {
      assert.equal(await controller.start(), false)
      assert.equal(states.at(-1).data, null); assert.equal(states.at(-1).denied, true)
      assert.equal(calls.length, 1)
    } finally { controller.stop() }
  })
})

test('STF-06 / DEN-11 a newer inbox response wins and foreign-Patient records cannot project into a Patient panel', async () => {
  const old = deferred(), next = deferred(), states = []
  let loads = 0
  await transport(() => ++loads === 1 ? old.promise : next.promise, async () => {
    const list = m.createHandoverResource(m.api.handovers, m.handoverRows, state => states.push(state))
    list.start()
    try {
      const first = list.reload(), second = list.reload()
      next.resolve(ok([record({ id: ids.other, content: false })])); await second
      old.resolve(ok([record({ content: false })])); assert.equal(await first, false)
      assert.equal(states.at(-1).data[0].id, ids.other)
      assert.throws(() => m.handoverRows([record({ patientId: ids.otherPatient })], ids.patient))
    } finally { list.stop() }
  })
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Authored but deferred: synthetic controller, contract and SSR checks; no backend acceptance.
const require = createRequire(import.meta.url)
const bundle = await build({ entryPoints: ['src/patient/Portal.jsx'], bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.css': 'empty' }, plugins: [{ name: 'react', setup(b) { b.onResolve({ filter: /^react$/ }, () => ({ path: pathToFileURL(require.resolve('react')).href, external: true })) } }] })
const { createPatientNotificationFeed: createFeed, patientNotificationIdentity: identity, patientNotificationDestination: destination, patientNotificationSnapshot: parse, NotificationPanel } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const me = { id: 'account-a', role: 'patient', account_status: 'Active', patient: { id: 'patient-a' } }
const row = (read = false) => ({ id: 'notice-a', title: 'Synthetic notice', body: 'Test only', read, created_at: '2026-11-06T08:00:00+08:00' })
const response = (read = false, unread = read ? 0 : 72) => ({ ok: true, data: [row(read)], meta: { unread } })
const fail = { ok: false, kind: 'network', message: 'Synthetic refusal' }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

function fixture(overrides = {}) {
  let listCalls = 0, readCalls = 0, allCalls = 0
  const feed = createFeed({ list: () => { listCalls++; return overrides.list ? overrides.list() : Promise.resolve(response()) }, read: id => { readCalls++; return overrides.read ? overrides.read(id) : Promise.resolve(response(true)) }, readAll: () => { allCalls++; return overrides.readAll ? overrides.readAll() : Promise.resolve(response(true)) } })
  return { feed, calls: () => ({ listCalls, readCalls, allCalls }) }
}

test('NOTIF-02 initial confirmed load preserves total unread beyond the latest window', async () => {
  const { feed } = fixture()
  assert.equal(feed.snapshot().unread, null)
  await feed.start(() => {})
  assert.equal(feed.snapshot().status, 'ready')
  assert.equal(feed.snapshot().unread, 72)
  assert.equal(feed.snapshot().items.length, 1)
  feed.stop()
})

test('NOTIF-02 reads update optimistically, roll back on failure and retry the same operation', async () => {
  const pending = deferred()
  let attempt = 0
  const { feed } = fixture({ read: () => ++attempt === 1 ? pending.promise : Promise.resolve(response(true)) })
  await feed.start(() => {})
  const reading = feed.markRead('notice-a')
  assert.equal(feed.snapshot().items[0].read, true)
  assert.equal(feed.snapshot().unread, 71)
  pending.resolve(fail)
  assert.equal(await reading, false)
  assert.equal(feed.snapshot().items[0].read, false)
  assert.equal(feed.snapshot().unread, 72)
  assert.equal(feed.snapshot().failed.type, 'read')
  assert.equal(await feed.retry(), true)
  assert.equal(feed.snapshot().items[0].read, true)
  assert.equal(feed.snapshot().unread, 0)
  feed.stop()
})

test('NOTIF-02 read-all failure retains confirmed values; success adopts server total rather than forcing zero', async () => {
  let attempt = 0
  const { feed } = fixture({ readAll: () => Promise.resolve(++attempt === 1 ? fail : response(true, 3)) })
  await feed.start(() => {})
  assert.equal(await feed.markAll(), false)
  assert.equal(feed.snapshot().unread, 72)
  assert.equal(feed.snapshot().items[0].read, false)
  assert.equal(feed.snapshot().failed.type, 'all')
  assert.equal(await feed.retry(), true)
  assert.equal(feed.snapshot().items[0].read, true)
  assert.equal(feed.snapshot().unread, 3)
  feed.stop()
})

test('Notification archive rolls back an optimistic removal and verifies the retried archive receipt', async () => {
  const pending = deferred()
  const meta = { collection: 'active', archive_available: true, has_more: false, next_before: null }
  let attempts = 0
  const feed = createFeed({
    list: async () => ({ ok: true, data: [{ ...row(), archived: false }], meta: { ...meta, unread: 1 } }),
    archive: async id => ++attempts === 1 ? pending.promise : ({
      ok: true, data: [], meta: { ...meta, unread: 0, archive_receipt: {
        id, archived: true, replayed: false, archived_at: '2026-11-06T09:00:00+08:00',
      } },
    }),
  })
  await feed.start(() => {})
  const archiving = feed.archive('notice-a')
  assert.deepEqual(feed.snapshot().items, [])
  assert.equal(feed.snapshot().unread, 0)
  pending.resolve(fail)
  assert.equal(await archiving, false)
  assert.equal(feed.snapshot().items[0].id, 'notice-a')
  assert.equal(feed.snapshot().unread, 1)
  assert.equal(await feed.retry(), true)
  assert.deepEqual(feed.snapshot().items, [])
  assert.equal(feed.snapshot().unread, 0)
  feed.stop()
})

test('NOTIF-02 an older reload cannot overwrite a newer read result', async () => {
  const old = deferred()
  let lists = 0
  const { feed } = fixture({ list: () => ++lists === 1 ? Promise.resolve(response()) : old.promise })
  await feed.start(() => {})
  const reload = feed.reload()
  assert.equal(await feed.markRead('notice-a'), true)
  old.resolve(response())
  assert.equal(await reload, false)
  assert.equal(feed.snapshot().items[0].read, true)
  assert.equal(feed.snapshot().unread, 0)
  feed.stop()
})

test('NOTIF-02 polling and repeated mutation clicks do not duplicate in-flight operations', async () => {
  const pending = deferred()
  const { feed, calls } = fixture({ read: () => pending.promise })
  await feed.start(() => {})
  const reading = feed.markRead('notice-a')
  assert.equal(await feed.poll(), false)
  assert.equal(await feed.markRead('notice-a'), false)
  assert.equal(await feed.markAll(), false)
  assert.deepEqual(calls(), { listCalls: 1, readCalls: 1, allCalls: 0 })
  pending.resolve(response(true))
  await reading
  // Already-read operations are idempotent without another request.
  assert.equal(await feed.markRead('notice-a'), true)
  assert.equal(calls().readCalls, 1)
  feed.stop()
})

test('NOTIF-02 A -> B -> A uses distinct epochs and discards old-account completions', async () => {
  const old = deferred(), emissions = []
  const a = fixture({ list: () => old.promise }).feed
  const firstLoad = a.start(value => emissions.push(value))
  a.stop()
  const b = fixture().feed
  await b.start(() => {}); b.stop()
  const nextA = fixture().feed
  await nextA.start(() => {})
  const count = emissions.length
  old.resolve({ ok: true, data: [{ ...row(), title: 'OLD ACCOUNT RESPONSE' }], meta: { unread: 1 } })
  assert.equal(await firstLoad, false)
  assert.equal(emissions.length, count)
  assert.equal(nextA.snapshot().items[0].title, 'Synthetic notice')
  nextA.stop()
})

test('NOTIF-02 unmount during a mutation prevents state publication', async () => {
  const pending = deferred(), emissions = []
  const { feed } = fixture({ read: () => pending.promise })
  await feed.start(value => emissions.push(value))
  const reading = feed.markRead('notice-a')
  feed.stop()
  const count = emissions.length
  pending.resolve(response(true))
  assert.equal(await reading, false)
  assert.equal(emissions.length, count)
})

test('NOTIF-02 failed retrieval is not a successful empty feed; background failure retains valid data', async () => {
  let attempt = 0
  const { feed } = fixture({ list: () => Promise.resolve(++attempt === 1 ? fail : response()) })
  await feed.start(() => {})
  assert.equal(feed.snapshot().status, 'error')
  assert.equal(feed.snapshot().unread, null)
  await feed.retry()
  assert.equal(feed.snapshot().status, 'ready')
  feed.stop()
  const existing = fixture({ list: () => Promise.resolve(++attempt === 3 ? response() : fail) }).feed
  await existing.start(() => {})
  await existing.reload()
  assert.equal(existing.snapshot().confirmed, true)
  assert.equal(existing.snapshot().items[0].read, false)
  assert.ok(existing.snapshot().error)
  existing.stop()
})

test('NOTIF-02 permission failure clears visible account data and retry reloads authorization', async () => {
  const { feed } = fixture({ read: () => Promise.resolve({ ok: false, kind: 'forbidden' }) })
  await feed.start(() => {})
  await feed.markRead('notice-a')
  assert.deepEqual(feed.snapshot().items, [])
  assert.equal(feed.snapshot().unread, null)
  assert.equal(feed.snapshot().failed.type, 'load')
  await feed.retry()
  assert.equal(feed.snapshot().status, 'ready')
  feed.stop()
})

test('NOTIF-02 recognized targets use only their established context type', () => {
  for (const target of [null, { page: 'users' }, { page: 'https://example.com' }]) assert.equal(destination(me, { target }), null)
  assert.equal(destination({ ...me, account_status: 'Inactive' }, { target: { page: 'visits' } }), null)
  assert.equal(identity({ ...me, role: 'staff' }), null)
  assert.notEqual(identity(me), identity({ ...me, id: 'account-b' }))
  const go = (kind, page) => destination(me, { kind, target: { page, id: 'public-record-id' } })
  assert.deepEqual(go('appointment_booked', 'visits'), { page: 'visits', context: { appointmentId: 'public-record-id' } })
  assert.deepEqual(go('invoice_issued', 'billing').context, { invoiceId: 'public-record-id' })
  assert.deepEqual(go('message_received', 'messages').context, { conversationId: 'public-record-id' })
  assert.deepEqual(go('prescription_ready', 'visits'), { page: 'prescriptions', context: { prescriptionId: 'public-record-id' } })
  assert.deepEqual(go('no_show_rebook', 'book'), { page: 'book', context: null })
  assert.equal(go('unknown_kind', 'visits').context, null)
})

test('NOTIF-02 malformed successful responses are rejected', () => {
  for (const result of [{ ok: true, data: [] }, { ok: true, data: [row()], meta: { unread: 0 } }, { ok: true, data: [row(), row()], meta: { unread: 2 } }]) assert.throws(() => parse(result))
})

test('NOTIF-02 error markup exposes retry, announces stale data and suppresses empty success', () => {
  const html = renderToStaticMarkup(React.createElement(NotificationPanel, { notes: { status: 'ready', items: [], unread: 72, confirmed: true, available: true, error: 'Synthetic read failure', failed: { type: 'read' }, retry() {} }, destination: () => null, onClose() {}, onOpen() {} }))
  assert.match(html, /role="alert"/)
  assert.match(html, /Retry mark read/)
  assert.match(html, /last confirmed updates/)
  assert.match(html, /up to 50 notifications/)
  assert.match(html, /aria-modal="true"/)
  assert.doesNotMatch(html, /No recent notifications/)
})

test('NOTIF-02 source guard keeps account eligibility, awaited navigation and keyboard recovery', () => {
  const source = readFileSync('src/patient/Portal.jsx', 'utf8')
  assert.match(source, /session\?\.serverUserId === me.id/)
  assert.match(source, /\[identity, eligible, auth, getAuthGeneration\]/)
  assert.match(source, /return \(\) => feed.stop\(\)/)
  assert.match(source, /!await notes.markRead\(n.id\) \|\| !notes.isCurrent\(\)/)
  assert.match(source, /e.key === 'Tab'/)
  assert.match(source, /e.key === 'Escape'/)
  assert.match(source, /main\.current\?\.focus\(\{ preventScroll: true \}\)/)
})

for(const operation of ['read','all'])test('GEN-10 Patient '+operation+' refuses a successful response that still contains unread evidence',async()=>{
 const {feed}=fixture({read:()=>Promise.resolve(response()),readAll:()=>Promise.resolve(response())});await feed.start(()=>{});assert.equal(await (operation==='read'?feed.markRead('notice-a'):feed.markAll()),false);assert.equal(feed.snapshot().items[0].read,false);assert.equal(feed.snapshot().unread,72);assert.match(feed.snapshot().error,/could not be confirmed/);feed.stop()
})
test('GEN-10 Patient read checks the current auth lifetime at transport and response adoption',async()=>{
 let valid=true,guard;const pending=deferred();const feed=createFeed({isCurrent:()=>valid,list:()=>Promise.resolve(response()),read:(id,current)=>{assert.equal(id,'notice-a');guard=current;return pending.promise}});await feed.start(()=>{});const reading=feed.markRead('notice-a');assert.equal(guard(),true);valid=false;assert.equal(guard(),false);pending.resolve(response(true));assert.equal(await reading,false);assert.deepEqual(feed.snapshot().items,[]);assert.equal(feed.isActive(),false);assert.equal(await feed.markRead('notice-a'),false);feed.stop()
})

test('GEN-10 Patient read-all forwards the same dispatch lifetime guard',async()=>{
 let valid=true,guard;const pending=deferred();const feed=createFeed({isCurrent:()=>valid,list:()=>Promise.resolve(response()),readAll:current=>{guard=current;return pending.promise}});await feed.start(()=>{});const reading=feed.markAll();assert.equal(guard(),true);valid=false;assert.equal(guard(),false);pending.resolve(response(true));assert.equal(await reading,false);assert.deepEqual(feed.snapshot().items,[]);assert.equal(feed.isActive(),false);feed.stop()
})

test('GEN-10 Patient load uses the server cursor and retains exact older records after refusal', async () => {
  const items = [row(), {...row(), id: 'older'}]
  let newNotice = false
  const calls = []
  const feed = createFeed({ list: async (before, collection) => {
    calls.push([before, collection])
    if (before && calls.length === 2) return { ok: false, message: 'Synthetic pagination failure' }
    if (newNotice) return {ok:true,data:[{...items[0],id:'new',archived:false}],meta:{unread:3,collection:'active',archive_available:true,has_more:true,next_before:'new'}}
    return before ? {ok:true,data:[{...items[1],archived:false}],meta:{unread:2,collection:'active',archive_available:true,has_more:false,next_before:null}}
      : {ok:true,data:[{...items[0],archived:false}],meta:{unread:2,collection:'active',archive_available:true,has_more:true,next_before:'notice-a'}}
  }})
  await feed.start(() => {})
  assert.equal(typeof feed.more, 'function', 'the Patient portal supports server pagination')
  assert.equal(await feed.more(), false)
  assert.deepEqual(feed.snapshot().items.map(n => n.id), ['notice-a'])
  assert.equal(feed.snapshot().nextBefore, 'notice-a')
  assert.match(feed.snapshot().error, /Synthetic pagination failure/)
  assert.equal(await feed.retry(), true)
  assert.deepEqual(calls, [[undefined,'active'],['notice-a','active'],['notice-a','active']])
  assert.deepEqual(feed.snapshot().items.map(n=>n.id), ['notice-a','older'])
  assert.equal(feed.snapshot().nextBefore, null)
  newNotice = true
  assert.equal(await feed.poll(), true)
  assert.equal(feed.snapshot().unread, 3)
  assert.deepEqual(feed.snapshot().items.map(n => n.id), ['notice-a', 'older'])
  assert.equal(await feed.reload(), true)
  assert.deepEqual(feed.snapshot().items.map(n => n.id), ['new'])
  feed.stop()
})

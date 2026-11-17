import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as api from '../src/api-client.js'
import * as inquiries from '../src/inquiries-api.js'
import { world } from './support/mock-server-world.js'

// M16 client behaviour: the clinic server is the only inquiry authority in a server session; entry is manual and nothing claims a
// social-platform connection, a delivery or a synchronization.

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: {} })
let calls
function stubFetch(...responses) {
  let i = 0
  globalThis.fetch = async (url, options = {}) => { calls.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, headers: options.headers || {} }); return responses[Math.min(i++, responses.length - 1)] }
}
beforeEach(() => { calls = []; globalThis.document = { cookie: 'XSRF-TOKEN=t' }; api.__resetCsrfCacheForTests() })
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const posts = () => calls.filter(c => c.method === 'POST')
const row = (n, over = {}) => ({ id: `01k00000000000000000000i0${n}`, source: 'Facebook', capture: 'Recorded manually by Staff', contact: { name: 'Maria', detail: '@maria' }, topic: 'Braces', status: 'Open', revision: 1,
  branch: { id: 'b1', name: 'Branch B1' }, assigned: { name: 'Staff' }, patient: null, appointment: null, received_at: '2026-09-28T10:00:00+08:00', responded_at: null, closed_at: null, converted_at: null, ...over })

test('capturing sends only the typed fields with an Idempotency-Key: ownership, status, source system and times are server context', async () => {
  stubFetch(json(200, {}), json(201, { data: row(1) }))
  const result = await inquiries.captureInquiry({ branchId: 'b1', source: 'Instagram', name: '  Maria  ', contact: ' @maria ', topic: ' Braces ' }, 'key-1')
  assert.equal(result.ok, true)
  assert.deepEqual(posts()[0].body, { branch_ref: 'b1', source: 'Instagram', name: 'Maria', topic: 'Braces', contact: '@maria' })
  assert.equal(posts()[0].headers['Idempotency-Key'], 'key-1')
  assert.ok(posts()[0].url.endsWith('/api/inquiries'))
  stubFetch(json(200, {}), json(201, { data: row(2) }))
  api.__resetCsrfCacheForTests()
  await inquiries.captureInquiry({ branchId: 'b1', source: 'Website', name: 'Ana', contact: '  ', topic: 'Hours?' }, 'key-2')
  assert.equal('contact' in posts().at(-1).body, false, 'an empty contact is omitted, not sent')
})

test('commands send expected_revision (and the appointment id for a link) and never a status', async () => {
  const inquiry = inquiries.mapInquiry(row(3, { revision: 4 }))
  stubFetch(json(200, {}), json(200, { data: row(3, { status: 'Responded', revision: 5 }) }))
  await inquiries.respondToInquiry(inquiry, 'k1')
  assert.deepEqual(posts()[0].body, { expected_revision: 4 }); assert.ok(posts()[0].url.endsWith(`/api/inquiries/${inquiry.id}/respond`))
  stubFetch(json(200, {}), json(200, { data: row(3, { status: 'Closed' }) }))
  api.__resetCsrfCacheForTests(); await inquiries.closeInquiry(inquiry, 'k2')
  assert.ok(posts().at(-1).url.endsWith('/close'))
  stubFetch(json(200, {}), json(200, { data: row(3, { status: 'Converted', appointment: { id: '01k0000000000000000000a001', code: 'APT-1' }, patient: { id: 'p', code: 'PAT-1', name: 'A B' } }) }))
  api.__resetCsrfCacheForTests(); const linked = await inquiries.linkInquiryToAppointment(inquiry, '01k0000000000000000000a001', 'k3')
  assert.deepEqual(posts().at(-1).body, { expected_revision: 4, appointment_id: '01k0000000000000000000a001' })
  assert.deepEqual([linked.ok, linked.row.status, linked.row.appointmentCode], [true, 'Converted', 'APT-1'])
})

test('the worklist is read through the server cursor; a failed page is an error, never a shorter list', async () => {
  stubFetch(json(200, { data: [row(1), row(2)], meta: { per_page: 25, next_cursor: 'c1' } }))
  const first = await inquiries.loadInquiries()
  assert.deepEqual([first.ok, first.rows.length, first.nextCursor], [true, 2, 'c1'])
  assert.match(calls.at(-1).url, /per_page=25/)
  stubFetch(json(200, { data: [row(3)], meta: { per_page: 25, next_cursor: null } }))
  const last = await inquiries.loadInquiries('c1')
  assert.match(calls.at(-1).url, /cursor=c1/); assert.equal(last.nextCursor, null)
  stubFetch(json(500, { message: 'boom' }))
  const failed = await inquiries.loadInquiries('c1')
  assert.equal(failed.ok, false); assert.equal(failed.rows, undefined)
  const page = read('src/pages/Inquiries.jsx')
  for (const text of ['Load older inquiries', 'Older inquiries unavailable', 'Older inquiries are available', 'That is all of them', 'Retry']) assert.match(page, new RegExp(text))
})

test('untrusted inquiry text stays a plain string and is rendered only as React text', () => {
  const xss = '<img src=x onerror=alert(1)><script>alert(2)</script> https://evil.example'
  const mapped = inquiries.mapInquiry(row(4, { topic: xss, contact: { name: '<b>x</b>', detail: 'javascript:alert(3)' } }))
  assert.deepEqual([mapped.topic, mapped.name, mapped.contact], [xss, '<b>x</b>', 'javascript:alert(3)'])
  for (const file of ['src/pages/Inquiries.jsx', 'src/inquiries-api.js', 'src/pages/FinanceCommunication.jsx']) {
    assert.doesNotMatch(read(file), /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|document\.write/, file)
  }
  assert.doesNotMatch(read('src/pages/Inquiries.jsx'), /<a\s|href=|window\.open|fetch\(/, 'inquiry content is never turned into a link or fetched')
})

test('the screen never claims a platform connection, delivery, seen or sync, and is honest that capture is manual', () => {
  const page = read('src/pages/Inquiries.jsx')
  const visible = page.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.match(visible, /is not connected to Facebook, Instagram, the website or any other platform/)
  assert.match(visible, /Recorded manually/)
  assert.match(visible, /Replied outside this system/)
  assert.doesNotMatch(visible, /\b(Delivered|Seen|Synced|Synchroni[sz]ed|Real-time|connected to Messenger|Sent to)\b/)
  assert.doesNotMatch(visible + read('src/inquiries-api.js'), /localStorage|sessionStorage|indexedDB/, 'no browser-local inquiry authority')
  const demo = read('src/pages/FinanceCommunication.jsx')
  assert.match(demo, /Offline demo preview: these inquiries exist only in this browser/)
  assert.match(demo, /if\(store\.session\?\.serverUserId\)return <ServerInquiriesPage/)
  assert.doesNotMatch(demo, /would generate reminder tasks/, 'no invented response period')
})

test('in a clinic-server session the local inquiry commands refuse; they remain only for the offline demo', () => {
  const w = world()
  w.session.serverUserId = '01K00000000000000000000010'
  for (const result of [w.actions.createInquiry({ name: 'A B', topic: 'x', source: 'Facebook' }, 'cmd'), w.actions.updateInquiry('inq1', 'Closed'), w.actions.convertInquiry('inq1', 'x')]) {
    assert.equal(result.ok, false)
    assert.match(result.message, /clinic server/)
  }
  assert.equal(w.state.inquiries.some(i => i.name === 'A B'), false)
})

test('inquiry counts come only from the server: failure, loading and unavailable are never shown as zero', async () => {
  stubFetch(json(200, { data: { open: 0, responded: 0, closed: 0, converted: 0, total: 0 } }))
  const zero = await inquiries.loadInquirySummary()
  assert.deepEqual([zero.ok, zero.open], [true, 0], 'a genuine server zero is a zero')
  assert.match(calls.at(-1).url, /\/api\/inquiries\/summary$/)
  for (const response of [json(500, { message: 'boom' }), json(403, { message: 'no' }), json(200, { data: {} }), json(200, { data: { open: 'x' } }), json(200, { data: { open: -1 } })]) {
    stubFetch(response)
    const result = await inquiries.loadInquirySummary()
    assert.equal(result.ok, false, 'a failed or unreadable count is a failure, not zero')
    assert.equal('open' in result, false)
  }
  globalThis.fetch = async () => { throw new TypeError('offline') }
  assert.equal((await inquiries.loadInquirySummary()).ok, false)
})

test('dashboards and analytics: Staff show the server count (or unavailable), Owner and analytics never show an inquiry zero without authority', () => {
  const dash = read('src/pages/Dashboards.jsx')
  assert.match(dash, /loadInquirySummary\(\)\.then\(r=>\{if\(live\)setServerInquiries\(r\.ok\?r\.open:'unavailable'\)\}\)/)
  assert.match(dash, /serverInquiries===null\?'…':serverInquiries==='unavailable'\?'Unavailable':serverInquiries/, 'loading, unavailable and the real count are distinct')
  assert.match(dash, /demoOpenInquiries=session\?\.serverUserId\?\[\]:state\.inquiries/, 'demo inquiries cannot reach a server session')
  assert.match(dash, /inquiryCountKnown/, 'the "everything is on track" claim waits for a known count')
  assert.match(dash, /\{!session\?\.serverUserId && <Card title="Patient communication"><MetricRow label="Open inquiries"/)
  const admin = read('src/pages/Admin.jsx')
  assert.match(admin, /value: 'Unavailable', note: 'No authoritative communication count exists yet/)
  assert.doesNotMatch(admin, /serverUserId \? 0 :/, 'no fabricated zero in a server session')
  const page = read('src/pages/Inquiries.jsx')
  assert.match(page, /Reported source/)
  assert.match(page, /does not mean the clinic has an official account there/)
  assert.doesNotMatch(page, /Channel reported|official (Facebook|Instagram) channel|connected account/i)
})

test('STF-20: social inquiries has no branch dropdown and auto-scopes to the user session branch', async () => {
  const page = read('src/pages/Inquiries.jsx')
  assert.doesNotMatch(page, /<Field label="Branch"/)
  assert.doesNotMatch(page, /Filter inquiries by branch/)
  assert.match(page, /const sessionBranchId = session\?\.branchId && \(!branches\.length \|\| branches\.some\(b => b\.id === session\.branchId\)\) \? session\.branchId : ''/)
  assert.doesNotMatch(page, /branches\[0\]\?\.id/)
  assert.match(page, /if \(!sessionBranchId\) return toast\('Your active branch could not be determined for this session\.', 'warning'\)/)
  assert.match(page, /const scopedForm = \{ \.\.\.form, branchId: sessionBranchId \}/)
  assert.match(page, /if \(!sessionBranchId \|\| i\.branchId !== sessionBranchId\) return false/)
  stubFetch(json(200, {}), json(201, { data: row(5) }))
  const result = await inquiries.captureInquiry({ branchId: '', source: 'Facebook', name: 'Carlos', contact: '', topic: 'Cleaning' }, 'key-stf20')
  assert.equal(result.ok, true)
  assert.deepEqual(posts().at(-1).body, { source: 'Facebook', name: 'Carlos', topic: 'Cleaning' })
})

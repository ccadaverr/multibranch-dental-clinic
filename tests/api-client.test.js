import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as api from '../src/api-client.js'

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

let calls
function mockFetch(sequence) {
  let i = 0
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    const response = sequence[Math.min(i, sequence.length - 1)]
    i++
    return response
  }
}

beforeEach(() => {
  calls = []
  globalThis.document = { cookie: 'XSRF-TOKEN=abc%20123' }
  api.__resetCsrfCacheForTests()
})

test('me() normalizes a successful response to {ok:true, data}', async () => {
  mockFetch([jsonResponse(200, { data: { id: 1, role: 'patient' } })])
  assert.deepEqual(await api.me(), { ok: true, data: { id: 1, role: 'patient' } })
})

test('an absent dated draft preserves explicit null and its authoritative revision metadata', async () => {
  const meta={staff_ref:'s1',date:'2026-11-16',revision:0,publication_available:false}
  mockFetch([jsonResponse(200,{data:null,meta})])
  assert.deepEqual(await api.staffRosterDraft('s1','2026-11-16'),{ok:true,data:null,meta})
  assert.match(calls[0].url,/\/api\/staff\/s1\/roster-draft\?date=2026-11-16$/)
})

test('me() reports 401 as kind unauthenticated, not a crash', async () => {
  mockFetch([jsonResponse(401, {})])
  assert.deepEqual(await api.me(), { ok: false, kind: 'unauthenticated' })
})

test('draft collection GET preserves exact encoded branch/date/cursor context and unpublished capability', async()=>{
  const meta={branch_ref:'b&other',date:'2026-11-16',next_before:null,publication_available:false}
  mockFetch([jsonResponse(200,{data:[],meta})])
  assert.deepEqual(await api.staffRosterDrafts('b&other','2026-11-16','cursor-public'),{ok:true,data:[],meta})
  const url=new URL(calls[0].url)
  assert.equal(url.pathname,'/api/staff-roster-drafts');assert.equal(url.searchParams.get('branch_ref'),'b&other')
  assert.equal(url.searchParams.get('date'),'2026-11-16');assert.equal(url.searchParams.get('before'),'cursor-public')
  assert.equal(calls[0].options.method,'GET')
})

test('login() distinguishes invalid credentials from an inactive account via the backend code field', async () => {
  mockFetch([jsonResponse(200, {}), jsonResponse(422, { message: 'x', errors: { email: ['x'] }, code: 'invalid_credentials' })])
  const invalid = await api.login('a@example.com', 'wrong')
  assert.equal(invalid.ok, false)
  assert.equal(invalid.kind, 'invalid_credentials')

  api.__resetCsrfCacheForTests()
  mockFetch([jsonResponse(200, {}), jsonResponse(422, { message: 'inactive', errors: { email: ['inactive'] }, code: 'inactive_account' })])
  const inactive = await api.login('a@example.com', 'pass')
  assert.equal(inactive.kind, 'inactive_account')
})

test('a network failure never throws — it is reported as kind network', async () => {
  globalThis.fetch = async () => { throw new TypeError('fetch failed') }
  const result = await api.login('a@example.com', 'pass')
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'network')
})

test('a 500 is reported as kind server, not exposed as raw HTTP detail', async () => {
  mockFetch([jsonResponse(200, {}), { ok: false, status: 500, json: async () => ({ message: 'boom' }) }])
  const result = await api.login('a@example.com', 'pass')
  assert.equal(result.kind, 'server')
})

test('a 419 (stale CSRF token) refetches the cookie and retries the same request exactly once', async () => {
  mockFetch([
    jsonResponse(200, {}), // initial csrf-cookie fetch
    { ok: false, status: 419, json: async () => ({}) }, // first attempt: stale token
    jsonResponse(200, {}), // csrf-cookie refetch
    jsonResponse(200, { data: { ok: true } }), // retried attempt succeeds
  ])
  const result = await api.login('a@example.com', 'pass')
  assert.equal(result.ok, true)
  assert.equal(calls.length, 4, 'exactly: csrf, POST(419), csrf, POST(200) — no extra calls')
})

test('two consecutive 419s do not retry a second time (no loop)', async () => {
  mockFetch([
    jsonResponse(200, {}),
    { ok: false, status: 419, json: async () => ({}) },
    jsonResponse(200, {}),
    { ok: false, status: 419, json: async () => ({}) },
  ])
  const result = await api.login('a@example.com', 'pass')
  assert.equal(result.ok, false)
  assert.equal(calls.length, 4, 'never a third POST attempt')
})

test('mutating requests send X-XSRF-TOKEN decoded from the cookie', async () => {
  mockFetch([jsonResponse(200, {}), jsonResponse(200, { data: { ok: true } })])
  await api.login('a@example.com', 'pass')
  const post = calls.find(c => c.options?.method === 'POST')
  assert.equal(post.options.headers['X-XSRF-TOKEN'], 'abc 123')
})

test('GET requests never fetch a CSRF cookie first', async () => {
  mockFetch([jsonResponse(200, { data: {} })])
  await api.me()
  assert.equal(calls.length, 1)
})

test('getVisit exposes identical recovery for out-of-scope and missing Visit 404s', async () => {
  mockFetch([
    jsonResponse(404, { message: 'Visit not found.' }),
    jsonResponse(404, { message: 'Visit not found.' }),
  ])
  const existing = await api.getVisit('protected-visit')
  const missing = await api.getVisit('missing-visit')
  assert.deepEqual(existing, { ok: false, kind: 'not_found', message: 'That record could not be found.' })
  assert.deepEqual(missing, existing)
  assert.equal(calls.length, 2, 'read denials do not retry or fetch CSRF')
})

test('getVisit preserves unauthenticated failures and permits an explicit read retry after network failure', async () => {
  mockFetch([jsonResponse(403, { code: 'session_revoked', message: 'Your session has ended. Sign in again.' })])
  assert.deepEqual(await api.getVisit('visit'), { ok: false, kind: 'unauthenticated' })
  globalThis.fetch = async () => { throw new TypeError('offline') }
  assert.equal((await api.getVisit('visit')).kind, 'network')
  const row = { id: 'visit', patient: { id: 'patient' }, branch: { id: 'branch' }, appointment: { id: 'appointment' } }
  mockFetch([jsonResponse(200, { data: row })])
  assert.deepEqual(await api.getVisit('visit'), { ok: true, data: row })
  assert.equal(calls.at(-1).options.method, 'GET')
})

test('logout() reports backendConfirmed true only on a real 204 from the server', async () => {
  mockFetch([jsonResponse(200, {}), { ok: true, status: 204, json: async () => null }])
  assert.deepEqual(await api.logout(), { ok: true, backendConfirmed: true })
})

test('logout() never claims backendConfirmed on a network failure', async () => {
  globalThis.fetch = async () => { throw new TypeError('offline') }
  const result = await api.logout()
  assert.equal(result.ok, false)
  assert.equal(result.backendConfirmed, false)
  assert.equal(result.kind, 'network')
})

test('register() passes through field-level validation errors (e.g. the duplicate-Patient case)', async () => {
  mockFetch([jsonResponse(200, {}), jsonResponse(422, {
    message: 'x',
    errors: { phone: ['An existing patient record may already match these details.'] },
  })])
  const result = await api.register({ first_name: 'A' })
  assert.equal(result.kind, 'validation')
  assert.deepEqual(result.errors.phone, ['An existing patient record may already match these details.'])
})

test('server-revoked access notifies session invalidation without treating ordinary 403 as logout', async () => {
  let count = 0
  const off = api.onSessionInvalidated(() => { count++ })
  mockFetch([jsonResponse(200, {}), jsonResponse(403, { code: 'session_revoked' })])
  assert.equal((await api.login('a@example.test', 'Password123!')).kind, 'unauthenticated')
  assert.equal(count, 1)
  mockFetch([jsonResponse(403, { message: 'Forbidden.' })])
  assert.equal((await api.me()).kind, 'forbidden')
  assert.equal(count, 1)
  off()
})

test('R23 refund command sends only selected reason, observed revision and stable request key', async () => {
  mockFetch([jsonResponse(200, {}), jsonResponse(202, { data: {
    appointment_id: 'apt_public', booking_payment_status: 'paid', refund_status: 'unconfirmed',
    outcome: 'Reconciliation required',
  } })])
  const result = await api.requestBookingRefund('apt_public', {
    expected_revision: 8, reason: 'requested_by_customer', note: null,
  }, 'r23-stable-intent')
  assert.equal(result.ok, true)
  assert.equal(result.data.refund_status, 'unconfirmed', '202 is not verified settlement')
  const command = calls.find(c => c.options?.method === 'POST')
  assert.ok(command)
  assert.match(command.url, /\/api\/appointments\/apt_public\/booking-refund$/)
  assert.equal(command.options.headers['Idempotency-Key'], 'r23-stable-intent')
  assert.deepEqual(JSON.parse(command.options.body), {
    expected_revision: 8, reason: 'requested_by_customer', note: null,
  })
})

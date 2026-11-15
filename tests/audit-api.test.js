import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as api from '../src/api-client.js'
import { downloadAuditLogsCsv, fetchAuditLog, fetchAuditLogs, mapAuditLog } from '../src/audit-api.js'

// M22 client: the clinic server is the only audit authority; failures throw (callers show Retry), never an empty or demo list.

const json = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: name => headers[name] ?? null }, blob: async () => ({}) })
let calls
function stubFetch(...responses) {
  let i = 0
  globalThis.fetch = async (url, options = {}) => { calls.push({ url, method: options.method || 'GET' }); return responses[Math.min(i++, responses.length - 1)] }
}
beforeEach(() => { calls = []; globalThis.document = { cookie: 'XSRF-TOKEN=t' }; api.__resetCsrfCacheForTests() })

const ROW = { id: '01j0000000000000000000e001', action: 'patient.profile.updated', category: 'clinical', severity: 'info', actor: { id: 'u', name: 'Alyssa Cruz', role: 'staff' }, branch: null, auditable_type: 'Patient', auditable_id: 'p', ip_address: '10.0.0.1', user_agent: 'UA', payload: { fields: ['phone'] }, created_at: '2026-09-28T10:00:00+08:00' }

test('an event without a named actor maps to Anonymous, never a human or "System"', () => {
  assert.deepEqual(mapAuditLog({ ...ROW, actor: { id: null, name: null, role: 'anonymous' } }).actor, { id: null, name: 'Anonymous', role: 'anonymous' })
  assert.deepEqual(mapAuditLog({ ...ROW, actor: undefined }).actor, { id: null, name: 'Anonymous', role: 'anonymous' })
  assert.equal(mapAuditLog(ROW).actor.name, 'Alyssa Cruz')
})

test('a page maps to rows plus the next cursor and sends only the bounded paging parameters', async () => {
  stubFetch(json(200, { data: [ROW], meta: { per_page: 50, next_cursor: '01j0000000000000000000e001' } }))
  const page = await fetchAuditLogs({ category: 'clinical', per_page: 50, cursor: 'abc' })
  assert.deepEqual([page.rows.length, page.nextCursor, page.rows[0].action], [1, '01j0000000000000000000e001', 'patient.profile.updated'])
  assert.match(calls[0].url, /category=clinical/)
  assert.match(calls[0].url, /per_page=50/)
  assert.match(calls[0].url, /cursor=abc/)
  stubFetch(json(200, { data: [], meta: { per_page: 50, next_cursor: null } }))
  assert.equal((await fetchAuditLogs()).nextCursor, null)
})

test('every failure throws a message instead of returning an empty history', async () => {
  for (const [status, kind] of [[403, 'forbidden'], [422, 'validation'], [404, 'not_found'], [500, 'server']]) {
    stubFetch(json(status, {}))
    await assert.rejects(() => fetchAuditLogs(), error => error.ok === false && error.kind === kind && error.message.length > 0)
    stubFetch(json(status, {}))
    await assert.rejects(() => fetchAuditLog('x'), error => error.kind === kind)
  }
  globalThis.fetch = async () => { throw new TypeError('offline') }
  await assert.rejects(() => fetchAuditLogs(), error => error.kind === 'network')
})

test('an event is requested by its encoded public id', async () => {
  stubFetch(json(200, { data: ROW }))
  assert.equal((await fetchAuditLog('a/b?c')).id, ROW.id)
  assert.ok(calls[0].url.endsWith('/api/audit-logs/a%2Fb%3Fc'))
})

test('the export reports truncation and explains refusals', async () => {
  globalThis.window = { URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} } }
  globalThis.document = { cookie: '', createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } }
  stubFetch(json(200, {}, { 'X-Audit-Export-Truncated': 'true', 'X-Audit-Export-Limit': '5000' }))
  assert.deepEqual(await downloadAuditLogsCsv({ category: 'financial', severity: 'all' }), { truncated: true, limit: 5000 })
  assert.match(calls[0].url, /category=financial/)
  assert.doesNotMatch(calls[0].url, /severity/, 'the "all" placeholder is not sent')
  stubFetch(json(200, {}, { 'X-Audit-Export-Truncated': 'false', 'X-Audit-Export-Limit': '5000' }))
  assert.equal((await downloadAuditLogsCsv()).truncated, false)
  for (const [status, message] of [[403, /Owner/], [422, /not valid/], [500, /Failed/]]) {
    stubFetch(json(status, {}))
    await assert.rejects(() => downloadAuditLogsCsv(), message)
  }
  globalThis.fetch = async () => { throw new TypeError('offline') }
  await assert.rejects(() => downloadAuditLogsCsv(), /Could not reach/)
})

test('an export cannot download after its actor/filter context changes or dispatch an obsolete command',async()=>{
  let release,current=true,clicked=false,sent=0
  globalThis.window={URL:{createObjectURL:()=>{throw Error('No stale file URL may be created')},revokeObjectURL(){}}}
  globalThis.document={createElement:()=>({click(){clicked=true},remove(){}}),body:{appendChild(){}}}
  globalThis.fetch=async()=>{sent++;return new Promise(resolve=>{release=resolve})}
  const pending=downloadAuditLogsCsv({action:'notification.archived'},()=>current)
  current=false;release(json(200,{}))
  await assert.rejects(()=>pending,/context changed/)
  assert.equal(clicked,false)
  await assert.rejects(()=>downloadAuditLogsCsv({},()=>false),/context changed/)
  assert.equal(sent,1)
})

test('the audit screen shows errors with Retry, pages by cursor, never claims tamper-proofing and holds no local audit authority', () => {
  const client = readFileSync(new URL('../src/audit-api.js', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../src/pages/AuditTrail.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(client + page, /localStorage|sessionStorage|INITIAL_AUDIT|state\.audit/)
  assert.doesNotMatch(page, /tamper-resistant|tamper-proof|cannot be altered by anyone/i)
  assert.match(page, /Audit trail unavailable/)
  assert.match(page, />Retry</)
  assert.match(page, /Load older events/)
  assert.match(page, /per_page: 50/)
  assert.match(page, /cursor: nextCursor/)
  assert.match(page, /if \(!live\) return/, 'a response for an older filter set is discarded')
  assert.match(page, /The end date is before the start date/)
  assert.match(page, /Event Payload \(Sanitized\)/)
  assert.doesNotMatch(page, /limit: 100/, 'no unbounded fetch')
  assert.match(page, /Events loaded/, 'counts are labelled as loaded rows, not history totals')
})

test('the Owner navigation actually lists the Audit Trail (it was in NAV but missing from the rendered groups) and no other role does', () => {
  const layout = readFileSync(new URL('../src/layout.jsx', import.meta.url), 'utf8')
  const groups = layout.slice(layout.indexOf('const GROUPS'), layout.indexOf('function navGroups'))
  const line = role => groups.split('\n').find(l => l.trim().startsWith(`${role}:`)) || ''
  assert.match(line('owner'), /'audit'/)
  for (const role of ['patient', 'staff', 'dentist']) assert.doesNotMatch(line(role), /'audit'/)
})

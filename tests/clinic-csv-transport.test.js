import test from 'node:test'
import assert from 'node:assert/strict'
import { requestAnalyticsCsv, downloadAnalyticsCsv } from '../src/analytics-api.js'
import { requestAuditLogsCsv } from '../src/audit-api.js'
import { setClockSource } from '../src/clock.js'

const ownerScope = { branch_id: 'b2', period: 'this week' }
const csv = (headers = {}) => new Response('ID,Action\n1,synthetic', {
  headers: { 'Content-Type': 'text/csv; charset=UTF-8', ...headers },
})

test.beforeEach(t => {
  const saved = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document }
  t.after(() => {
    Object.assign(globalThis, saved)
    setClockSource()
  })
  globalThis.window = { location: { hostname: 'portal.example.test' } }
  globalThis.document = undefined
  setClockSource(() => new Date('2026-11-15T16:01:00Z'))
})

test('analytics fetches the explicit scope at the portal origin and returns a Blob without touching the DOM', async () => {
  const controller = new AbortController()
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/analytics/export?branch_id=b2&period=this+week')
    assert.equal(options.credentials, 'include')
    assert.equal(options.redirect, 'error')
    assert.equal(options.cache, 'no-store')
    assert.equal(options.signal, controller.signal)
    return csv({ 'Content-Disposition': 'attachment; filename="operational-analytics-20261116.csv"' })
  }
  const payload = await requestAnalyticsCsv(ownerScope, { signal: controller.signal })
  assert.equal(payload.filename, 'operational-analytics-20261116.csv')
  assert.equal(await payload.blob.text(), 'ID,Action\n1,synthetic')
})

test('audit preserves exact identity, literal all, dates and bound metadata', async () => {
  globalThis.window.location.hostname = 'localhost'
  const filters = { branch_id: 'b1', target_type: 'UserNotification', target_id: 'fixed/id+%', search: 'all', severity: 'all', date_to: '2026-11-16' }
  globalThis.fetch = async url => {
    const { origin, searchParams } = new URL(url)
    assert.equal(origin, 'http://localhost:8000')
    for (const [key, value] of Object.entries(filters)) {
      assert.equal(searchParams.get(key), key === 'severity' ? null : value)
    }
    return csv({
      'Content-Disposition': "attachment; filename=report.csv; filename*=UTF-8''audit%20%E2%82%B1.csv",
      'X-Audit-Export-Limit': '5000',
      'X-Audit-Export-Truncated': 'true',
    })
  }
  const { filename, truncated, limit } = await requestAuditLogsCsv(filters)
  assert.deepEqual({ filename, truncated, limit }, { filename: 'report.csv', truncated: true, limit: 5000 })
})

test('analytics rejects a successful response with an empty CSV body', async () => {
  globalThis.fetch = async () => new Response('', { headers: { 'Content-Type': 'text/csv' } })
  await assert.rejects(() => requestAnalyticsCsv(ownerScope), /report file was empty/i)
})

test('filename metadata supports encoded names and falls back for unsafe or absent metadata', async () => {
  globalThis.fetch = async () => csv({ 'Content-Disposition': "attachment; filename*=UTF-8''audit%20caf%C3%A9.csv" })
  assert.equal((await requestAuditLogsCsv()).filename, 'audit caf\u00e9.csv')
  globalThis.fetch = async () => csv({ 'Content-Disposition': 'attachment; filename="../../untrusted.csv"' })
  assert.equal((await requestAnalyticsCsv(ownerScope)).filename, 'operational-analytics-2026-11-16.csv')
  globalThis.fetch = async () => csv()
  assert.equal((await requestAuditLogsCsv()).filename, 'audit_trail_2026-11-16.csv')
})

test('invalid or unresolved scope never falls back and HTTP refusals never retry', async () => {
  let calls = 0
  let status = 403
  globalThis.fetch = async () => {
    calls++
    return new Response('private error body', { status, headers: { 'Content-Type': 'text/csv' } })
  }
  for (const branch_id of [undefined, null, '', '  ', ' all ']) {
    await assert.rejects(() => requestAnalyticsCsv({ ...ownerScope, branch_id }), /Choose a report branch and valid dates or period/)
  }
  await assert.rejects(() => requestAnalyticsCsv({ branch_id: 'b2' }), /Choose a report branch and valid dates or period/)
  await assert.rejects(() => requestAnalyticsCsv({ ...ownerScope, date_from: '2026-11-16' }), /valid dates or period/)
  await assert.rejects(() => requestAnalyticsCsv({ ...ownerScope, date_from: '2026-11-18', date_to: '2026-11-16' }), /valid dates or period/)
  await assert.rejects(() => requestAuditLogsCsv({ target_id: 'exact' }), /both the audit record type and ID/)
  await assert.rejects(() => requestAuditLogsCsv({ target_type: ' ', target_id: ' ' }), /both the audit record type and ID/)
  await assert.rejects(() => requestAuditLogsCsv({ branch_id: ' ' }), /valid audit branch/)
  assert.equal(calls, 0)
  for (const refusal of [401, 403, 404, 409, 422, 500]) {
    status = refusal
    await assert.rejects(() => requestAnalyticsCsv(ownerScope), error => error.status === refusal && !error.message.includes('private error body'))
  }
  assert.equal(calls, 6)
  globalThis.fetch = async () => new Response('<html>sign-in</html>', { headers: { 'Content-Type': 'text/html' } })
  await assert.rejects(() => requestAnalyticsCsv(ownerScope), /did not return a CSV/)
})

test('pre-abort and in-flight abort use the caller reason and ignore a late successful response', async () => {
  const controller = new AbortController()
  const reason = new Error('Superseded')
  let accept
  let reads = 0
  globalThis.fetch = () => new Promise(resolve => { accept = resolve })
  const pending = requestAnalyticsCsv(ownerScope, { signal: controller.signal })
  controller.abort(reason)
  accept({ ...csv(), ok: true, headers: csv().headers, blob() { reads++ } })
  await assert.rejects(pending, error => error === reason)
  assert.equal(reads, 0)
  globalThis.fetch = () => { assert.fail('Pre-abort made a request') }
  await assert.rejects(() => requestAnalyticsCsv(ownerScope, { signal: controller.signal }), error => error === reason)
})

test('superseding during body consumption discards the body and leaves independent requests usable', async () => {
  const controller = new AbortController()
  let called
  const started = new Promise(resolve => { called = resolve })
  let release
  globalThis.fetch = async (url, options) => {
    if (options.signal !== controller.signal) return csv()
    return {
      ok: true,
      headers: csv().headers,
      blob: () => new Promise(resolve => { release = resolve; called() }),
    }
  }
  const pending = requestAnalyticsCsv(ownerScope, { signal: controller.signal })
  await started
  controller.abort()
  assert.equal(await (await requestAnalyticsCsv({ branch_id: 'all', period: 'all' })).blob.text(), 'ID,Action\n1,synthetic')
  release(new Blob(['late']))
  await assert.rejects(pending, { name: 'AbortError' })
})

test('abort-like fetch and body failures retain their original identity', async () => {
  for (const name of ['AbortError', 'TimeoutError']) {
    const original = new DOMException('Interruption', name)
    globalThis.fetch = async () => { throw original }
    await assert.rejects(() => requestAnalyticsCsv(ownerScope), error => error === original)
    globalThis.fetch = async () => ({ ok: true, headers: csv().headers, async blob() { throw original } })
    await assert.rejects(() => requestAnalyticsCsv(ownerScope), error => error === original)
  }
})

test('the existing AnalyticsPage adapter never downloads a superseded result', async () => {
  let current = true
  let resolve
  globalThis.fetch = () => new Promise(done => { resolve = done })
  const pending = downloadAnalyticsCsv(ownerScope, () => current)
  current = false
  resolve(csv())
  assert.equal(await pending, false)
})

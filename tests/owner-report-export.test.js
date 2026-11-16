import test from 'node:test'
import assert from 'node:assert/strict'
import { downloadAnalyticsCsv } from '../src/analytics-api.js'
import { setClockSource } from '../src/clock.js'

test('Owner CSV uses the portal origin, preserves all-time and branch, and refuses a non-CSV response', async t => {
  const saved = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document }
  t.after(() => {
    Object.assign(globalThis, saved)
    setClockSource()
  })
  setClockSource(() => new Date('2026-11-15T16:05:00Z'))
  const links = []
  const urls = []
  globalThis.window = {
    location: { hostname: 'portal.example.test' },
    URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} },
  }
  globalThis.document = {
    createElement: () => ({ click() {}, remove() {} }),
    body: { appendChild: link => links.push(link) },
  }
  let contentType = 'text/csv; charset=UTF-8'
  globalThis.fetch = async (url, options) => {
    urls.push(url)
    assert.equal(options.credentials, 'include')
    return new Response('synthetic', { headers: { 'Content-Type': contentType } })
  }

  await downloadAnalyticsCsv({ period: 'all', branch_id: 'b1' })
  assert.equal(urls[0], '/api/analytics/export?period=all&branch_id=b1')
  assert.equal(links[0].download, 'operational-analytics-2026-11-16.csv')

  contentType = 'text/html'
  await assert.rejects(downloadAnalyticsCsv(), /did not return a CSV/)
  assert.equal(links.length, 1)
})

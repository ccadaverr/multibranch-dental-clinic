import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { HomeReadDeadlineError, startHomeRead } from '../src/home-read-deadline.js'

const source = path => readFileSync(path, 'utf8')

test('Home read returns the exact confirmed result within the deadline', async () => {
  const data = { collected: '123.45' }
  const task = startHomeRead(async signal => {
    assert.equal(signal.aborted, false)
    return data
  }, { timeoutMs: 30 })
  assert.equal(await task.response, data)
  task.cancel()
})

test('A read that never settles ends with a specific timeout and aborts transport', async () => {
  let requestSignal
  const task = startHomeRead(signal => { requestSignal = signal; return new Promise(() => {}) }, {
    timeoutMs: 8, timeoutMessage: 'Synthetic home read timeout.',
  })
  await assert.rejects(task.response, e => e instanceof HomeReadDeadlineError && e.message === 'Synthetic home read timeout.')
  assert.equal(requestSignal.aborted, true)
})

test('A cancelled session aborts and invalidates its pending read', async () => {
  let requestSignal
  const task = startHomeRead(signal => { requestSignal = signal; return new Promise(() => {}) }, { timeoutMs: 1000 })
  // Allow the read microtask to begin before unmount/cancellation.
  await Promise.resolve()
  task.cancel()
  await assert.rejects(task.response, HomeReadDeadlineError)
  assert.equal(requestSignal.aborted, true)
})

test('The read deadline only accepts positive safe integer budgets', () => {
  for (const value of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => startHomeRead(() => 1, { timeoutMs: value }), TypeError)
  }
})

test('Owner and Dentist Home read paths propagate cancellation and never invent values on failure', () => {
  const dentist = source('src/pages/DentistHome.jsx')
  const owner = source('src/pages/OwnerPerformanceOverview.jsx')
  const api = source('src/api-client.js')
  const analytics = source('src/analytics-api.js')
  assert.match(dentist, /startHomeRead\(/)
  assert.match(dentist, /task\.cancel\(\)/)
  assert.match(dentist, /result\.data\.some\(row => !row\?\.branch/)
  assert.match(dentist, /Retry follow-ups/)
  assert.match(owner, /startHomeRead\(/)
  assert.match(owner, /task\.cancel\(\)/)
  assert.match(owner, /validateRevenueReport\(now/)
  assert.match(owner, /aria-label="Refresh performance overview"/)
  assert.match(api, /export function followups\(filters = \{\}, \{ signal \} = \{\}\)/)
  assert.match(api, /export function getExecutiveSummary\(params, \{ signal \} = \{\}\)/)
  assert.match(api, /export function getDailyRevenue\(params, \{ signal \} = \{\}\)/)
  assert.match(analytics, /api\.getDailyRevenue\(params, \{ signal \}\)/)
})

test('Read-only follow-ups and Owner analytics preserve scope and forward cancellation', async () => {
  const api = await import('../src/api-client.js')
  const signal = new AbortController().signal
  const previousFetch = globalThis.fetch
  const calls = []
  try {
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: new URL(url), signal: options.signal, method: options.method })
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    await api.followups({ branch_ref: 'branch-19', status: 'active', due: 'all' }, { signal })
    await api.getDailyRevenue({ branch_id: 'public-branch', date_from: '2026-11-01', date_to: '2026-11-20' }, { signal })
    await api.getExecutiveSummary({ branch_id: 'public-branch', date_from: '2026-11-01', date_to: '2026-11-20' }, { signal })
    assert.equal(calls.length, 3)
    assert.ok(calls.every(call => call.signal === signal && call.method === 'GET'))
    assert.equal(calls[0].url.pathname, '/api/followups')
    assert.equal(calls[0].url.searchParams.get('branch_ref'), 'branch-19')
    assert.equal(calls[1].url.searchParams.get('branch_id'), 'public-branch')
    assert.equal(calls[2].url.searchParams.get('date_to'), '2026-11-20')
  } finally {
    globalThis.fetch = previousFetch
  }
})

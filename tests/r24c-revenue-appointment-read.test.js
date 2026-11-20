import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fetchAppointment } from '../src/appointments-api.js'
import { fetchDailyRevenue, fetchWeeklyRevenueHistogram } from '../src/analytics-api.js'
import { startHomeRead, HomeReadDeadlineError } from '../src/home-read-deadline.js'
import { validateRevenueReport, validateRevenueScope } from '../src/owner-revenue-data.js'

const source = name => readFileSync(name, 'utf8')
const respond = data => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })

// The existing transport adapter must forward the same signal to every read;
// a timeout with no transport cancellation would waste connections and allow
// old sessions to race against new ones.
test('R24C: Owner daily and weekly reports forward AbortSignal and exact requested filters', async () => {
  const original = globalThis.fetch
  const calls = []
  const controller = new AbortController()
  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: new URL(url, 'http://localhost'), signal: init.signal, method: init.method })
      return respond({ timezone: 'Asia/Manila', days: [] })
    }
    await fetchDailyRevenue({ branch_id: 'branch-7', period: 'this month' }, { signal: controller.signal })
    await fetchWeeklyRevenueHistogram({ branch_id: 'branch-7', date: '2026-11-16' }, { signal: controller.signal })
    assert.equal(calls.length, 2)
    assert.ok(calls.every(call => call.signal === controller.signal && call.method === 'GET'))
    assert.equal(calls[0].url.pathname, '/api/analytics/daily-revenue')
    assert.equal(calls[0].url.searchParams.get('period'), 'this month')
    assert.equal(calls[1].url.pathname, '/api/analytics/weekly-histogram')
    assert.equal(calls[1].url.searchParams.get('date'), '2026-11-16')
    assert.ok(calls.every(call => call.url.searchParams.get('branch_id') === 'branch-7'))
  } finally { globalThis.fetch = original }
})

test('R24C: Dentist exact appointment detail forwards cancellation without modifying the endpoint', async () => {
  const original = globalThis.fetch
  const controller = new AbortController()
  const calls = []
  try {
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: new URL(url, 'http://localhost'), signal: init.signal, method: init.method })
      return respond({ id: 'exact-appointment', patient: { name: 'Test Person' } })
    }
    const result = await fetchAppointment('exact-appointment', { signal: controller.signal })
    assert.equal(result.ok, true)
    assert.equal(result.row.id, 'exact-appointment')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url.pathname, '/api/appointments/exact-appointment')
    assert.equal(calls[0].signal, controller.signal)
    assert.equal(calls[0].method, 'GET')
  } finally { globalThis.fetch = original }
})

test('R24C: a never-settling Owner report fails in finite time, aborting the original read', async () => {
  let signal
  const job = startHomeRead(next => { signal = next; return new Promise(() => {}) }, {
    timeoutMs: 9, timeoutMessage: 'Revenue took too long to load.',
  })
  await assert.rejects(job.response, error => error instanceof HomeReadDeadlineError && error.message === 'Revenue took too long to load.')
  assert.equal(signal.aborted, true)
})

test('R24C: a cancelled Dentist appointment read cannot later claim a valid result', async () => {
  let release
  let signal
  const job = startHomeRead(next => {
    signal = next
    return new Promise(resolve => { release = resolve })
  }, { timeoutMs: 250 })
  await Promise.resolve()
  job.cancel()
  await assert.rejects(job.response, HomeReadDeadlineError)
  assert.equal(signal.aborted, true)
  release({ ok: true, row: { id: 'stale-patient-record' } })
})

test('R24C: wrong branch and unreconciled money still fail closed before Owner renders figures', () => {
  const report = { timezone: 'Asia/Manila', branch: { public_id: 'branch-7' }, days: [
    { date: '2026-11-20', gross_collected_php: '100.00', refunded_php: '0.00', net_cash_flow_php: '100.00', payments_count: 1, refunds_count: 0 },
  ], totals: { gross_collected_php: '100.00', refunded_php: '0.00', net_cash_flow_php: '100.00', payments_count: 1, refunds_count: 0 } }
  assert.equal(validateRevenueScope(validateRevenueReport(report), 'branch-7'), report)
  assert.throws(() => validateRevenueScope(report, ''), /Branch response mismatch/)
  assert.throws(() => validateRevenueReport({ ...report, totals: { ...report.totals, net_cash_flow_php: '99.00' } }), /reconcile/)
})

test('R24C: both screens show honest loading, error, Retry and active Refresh without false empty data', () => {
  const owner = source('src/pages/OwnerRevenueCharts.jsx')
  const dentist = source('src/pages/DentistWorkspace.jsx')
  assert.match(owner, /startHomeRead\(signal => fetcher\(requested, \{ signal \}\)/)
  assert.match(owner, /timeoutMs: 12000/)
  assert.match(owner, /task\.cancel\(\)/)
  assert.match(owner, /validateRevenueScope\(validateRevenueReport\(value, weekly, requested\), branchId\)/)
  assert.match(owner, /error instanceof HomeReadDeadlineError/)
  assert.match(owner, /aria-label=\{`Refresh \$\{weekly \? 'weekly' : 'daily'\} revenue`\}/)
  assert.match(owner, /Retry revenue/)
  assert.match(dentist, /startHomeRead\(signal => fetchAppointment\(id, \{ signal \}\)/)
  assert.match(dentist, /timeoutMs: 12000/)
  assert.match(dentist, /task\.cancel\(\)/)
  assert.match(dentist, /if \(row\.id !== id \|\| !ownDentistRows\(\[row\], store\.state, store\.session\)\.length\)/)
  assert.match(dentist, /const current = read\.scope === scope && scope \? read :/)
  assert.match(dentist, /Refresh details/)
  assert.doesNotMatch(owner, /setResult\(\{ data: \[\] \}\)/)
})

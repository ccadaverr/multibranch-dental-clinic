import test from 'node:test'
import assert from 'node:assert/strict'
import { MODULES } from '../src/data.js'
import * as analyticsApi from '../src/analytics-api.js'

test('Module 21 metadata is marked implemented with backend authority note', () => {
  const m21 = MODULES.find(m => m.no === 21)
  assert.ok(m21, 'Module 21 must exist in MODULES registry')
  assert.equal(m21.implemented, true)
  assert.equal(m21.coverage, 'implemented')
  assert.ok(m21.coverageNote.includes('executive summary'))
  assert.deepEqual(m21.roles, ['owner'])
})

test('analytics-api exports all required communication functions', () => {
  assert.equal(typeof analyticsApi.fetchExecutiveSummary, 'function')
  assert.equal(typeof analyticsApi.fetchBranchPerformance, 'function')
  assert.equal(typeof analyticsApi.downloadAnalyticsCsv, 'function')
})

import { readFileSync } from 'node:fs'

const adminSource = readFileSync(new URL('../src/pages/Admin.jsx', import.meta.url), 'utf8')
const analyticsPage = adminSource.slice(adminSource.indexOf('export function AnalyticsPage'), adminSource.indexOf('export function UsersPage'))

test('M21 page sends a public branch reference and never an internal number', () => {
  assert.match(analyticsPage, /activeBranchRecord\?\.publicId \|\| activeBranchRecord\?\.id/)
  assert.ok(!analyticsPage.includes('b.branch_id'), 'analytics rows are keyed by public_id, never an internal branch_id')
  assert.match(analyticsPage, /key=\{b\.public_id \|\| b\.id\}/)
  assert.match(analyticsPage, /const filters = \{ period: p, branch_id: activeBranchId \}/)
  assert.match(analyticsPage, /fetchExecutiveSummary\(filters\),\s+fetchBranchPerformance\(filters\)/)
})

test('M21 server session never falls back to local demo metrics and shows an explicit unavailable state', () => {
  assert.match(analyticsPage, /isServerSession \? \[\] : clientMetrics/)
  assert.match(analyticsPage, /setServerSummary\(null\)/)
  assert.match(analyticsPage, /Analytics are unavailable right now/)
  assert.match(analyticsPage, /Try again/)
})

test('M21 shows "No data" for null rates and an unconfigured wait estimate, never a fabricated 100%', () => {
  assert.match(analyticsPage, /v === null \|\| v === undefined \? 'No data'/)
  assert.ok(!/health_rate_pct\}%/.test(analyticsPage), 'health rate is formatted through rateText')
  assert.ok(!/completion_rate_pct\}%/.test(analyticsPage), 'completion rate is formatted through rateText')
  assert.match(analyticsPage, /wait estimate not configured/)
})

test('M21 labels the revenue metric as it is calculated (paid invoices created in the period)', () => {
  assert.match(analyticsPage, /Paid invoices created in this period/)
  assert.ok(!analyticsPage.includes('Real collections from'))
})

test('M21 shows no workload percentage in a server session and labels the offline preview', () => {
  assert.match(analyticsPage, /const workload = isServer \? null : branchCapacity/)
  assert.match(analyticsPage, /Capacity not configured/)
  assert.match(analyticsPage, /workload !== null && <Progress/)
  assert.ok(!analyticsPage.includes('capacity_threshold || 80'), 'no invented 80 fallback denominator')
  assert.match(analyticsPage, /Offline demo preview — example capacity values, not clinic data/)
})

import * as api from '../src/api-client.js'

test('OWN-01 analytics API client and wrapper export daily revenue and weekly histogram helpers', () => {
  assert.equal(typeof api.getDailyRevenue, 'function')
  assert.equal(typeof api.getWeeklyRevenueHistogram, 'function')
  assert.equal(typeof analyticsApi.fetchDailyRevenue, 'function')
  assert.equal(typeof analyticsApi.fetchWeeklyRevenueHistogram, 'function')
})

test('OWN-01 fetchDailyRevenue and fetchWeeklyRevenueHistogram use existing request/response and error conventions', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })

  try {
    const dailyPayload = {
      period: 'custom',
      period_label: 'Sep 25, 2026 – Sep 26, 2026',
      timezone: 'Asia/Manila',
      date_basis: { collections: 'payments.recorded_at', refunds: 'invoice_refunds.refunded_at' },
      date_from: '2026-09-25',
      date_to: '2026-09-26',
      branch: { public_id: '01j00000000000000000000b01', name: 'Branch B1' },
      totals: {
        gross_collected_php: '12500.00',
        refunded_php: '500.00',
        net_cash_flow_php: '12000.00',
        payments_count: 2,
        refunds_count: 1,
      },
      days: [
        { date: '2026-09-25', label: 'Sep 25', day_of_week: 5, day_name: 'Fri', gross_collected_php: '0.00', refunded_php: '0.00', net_cash_flow_php: '0.00', payments_count: 0, refunds_count: 0 },
        { date: '2026-09-26', label: 'Sep 26', day_of_week: 6, day_name: 'Sat', gross_collected_php: '12500.00', refunded_php: '500.00', net_cash_flow_php: '12000.00', payments_count: 2, refunds_count: 1 },
      ],
    }

    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET' })
      return jsonResponse(200, { data: dailyPayload })
    }

    const daily = await analyticsApi.fetchDailyRevenue({
      date_from: '2026-09-25',
      date_to: '2026-09-26',
      branch_id: '01j00000000000000000000b01',
    })
    assert.deepEqual(daily, dailyPayload)
    assert.match(calls[0].url, /\/api\/analytics\/daily-revenue\?/)
    assert.match(calls[0].url, /date_from=2026-09-25/)
    assert.match(calls[0].url, /date_to=2026-09-26/)
    assert.match(calls[0].url, /branch_id=01j00000000000000000000b01/)

    const histogramPayload = {
      reference_date: '2026-09-28',
      week_start_date: '2026-09-28',
      week_end_date: '2026-10-03',
      week_label: 'Sep 28 – Oct 03, 2026',
      timezone: 'Asia/Manila',
      date_basis: { collections: 'payments.recorded_at', refunds: 'invoice_refunds.refunded_at' },
      is_finalized: false,
      branch: null,
      totals: {
        gross_collected_php: '6000.00',
        refunded_php: '500.00',
        net_cash_flow_php: '5500.00',
        payments_count: 1,
        refunds_count: 1,
      },
      buckets: [
        { date: '2026-09-28', day_of_week: 1, short_day: 'Mon', gross_collected_php: '6000.00', refunded_php: '500.00', net_cash_flow_php: '5500.00', payments_count: 1, refunds_count: 1 },
        { date: '2026-09-29', day_of_week: 2, short_day: 'Tue', gross_collected_php: '0.00', refunded_php: '0.00', net_cash_flow_php: '0.00', payments_count: 0, refunds_count: 0 },
        { date: '2026-09-30', day_of_week: 3, short_day: 'Wed', gross_collected_php: '0.00', refunded_php: '0.00', net_cash_flow_php: '0.00', payments_count: 0, refunds_count: 0 },
        { date: '2026-10-01', day_of_week: 4, short_day: 'Thu', gross_collected_php: '0.00', refunded_php: '0.00', net_cash_flow_php: '0.00', payments_count: 0, refunds_count: 0 },
        { date: '2026-10-02', day_of_week: 5, short_day: 'Fri', gross_collected_php: '0.00', refunded_php: '0.00', net_cash_flow_php: '0.00', payments_count: 0, refunds_count: 0 },
        { date: '2026-10-03', day_of_week: 6, short_day: 'Sat', gross_collected_php: '0.00', refunded_php: '0.00', net_cash_flow_php: '0.00', payments_count: 0, refunds_count: 0 },
      ],
    }

    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET' })
      return jsonResponse(200, { data: histogramPayload })
    }

    const histogram = await analyticsApi.fetchWeeklyRevenueHistogram({ date: '2026-09-28' })
    assert.deepEqual(histogram, histogramPayload)
    assert.equal(histogram.buckets.length, 6)
    assert.match(calls[1].url, /\/api\/analytics\/weekly-histogram\?date=2026-09-28/)

    // Failures throw normalized error objects rather than fabricating empty or demo data
    globalThis.fetch = async () => jsonResponse(403, { message: 'Executive analytics and reports are restricted to the clinic Owner.' })
    await assert.rejects(
      () => analyticsApi.fetchDailyRevenue({ period: 'today' }),
      err => err.ok === false && err.kind === 'forbidden'
    )

    globalThis.fetch = async () => jsonResponse(422, {
      message: 'Use a real calendar date in YYYY-MM-DD format.',
      errors: { date: ['Use a real calendar date in YYYY-MM-DD format.'] },
    })
    await assert.rejects(
      () => analyticsApi.fetchWeeklyRevenueHistogram({ date: '2026-02-30' }),
      err => err.ok === false && err.kind === 'validation'
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

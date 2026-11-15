import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { build } from 'esbuild'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { mkdirSync, writeFileSync } from 'node:fs'

// 1. Source and Contract Verification
test('OWN-01: Dashboards.jsx exports required helpers and chart components', () => {
  const code = fs.readFileSync('src/pages/Dashboards.jsx', 'utf8')

  // API contract imports
  assert.match(code, /import \{[^}]*fetchDailyRevenue[^}]*\} from '\.\.\/analytics-api\.js'/, 'Must import fetchDailyRevenue')
  assert.match(code, /import \{[^}]*fetchWeeklyRevenueHistogram[^}]*\} from '\.\.\/analytics-api\.js'/, 'Must import fetchWeeklyRevenueHistogram')

  // Exported components and functions
  assert.match(code, /export function formatCurrencyPhp\(/, 'Must export formatCurrencyPhp')
  assert.match(code, /export function isSaturdayManila\(/, 'Must export isSaturdayManila')
  assert.match(code, /export function DailyRevenueChart\(/, 'Must export DailyRevenueChart')
  assert.match(code, /export function WeeklyRevenueHistogram\(/, 'Must export WeeklyRevenueHistogram')
  assert.match(code, /export function OwnerDashboard\(/, 'Must export OwnerDashboard')

  // Responsive SVG charts without external charting libraries
  assert.match(code, /className="revenue-line-chart"/, 'Daily revenue chart must render SVG with revenue-line-chart class')
  assert.match(code, /className="revenue-histogram-chart"/, 'Weekly histogram must render SVG with revenue-histogram-chart class')
  assert.doesNotMatch(code, /from 'chart\.js'/, 'Must not import Chart.js')
  assert.doesNotMatch(code, /from 'recharts'/, 'Must not import Recharts')

  // Accessible tooltips, hover and keyboard focus states
  assert.match(code, /role="button"/, 'Data points and bars must have role="button"')
  assert.match(code, /tabIndex=\{0\}/, 'Data points and bars must be keyboard reachable with tabIndex 0')
  assert.match(code, /onFocus=/, 'Must support keyboard focus')
  assert.match(code, /onBlur=/, 'Must support keyboard blur')
  assert.match(code, /onMouseEnter=/, 'Must support mouse enter hover')
  assert.match(code, /onMouseLeave=/, 'Must support mouse leave')
  assert.match(code, /role="tooltip"/, 'Must include accessible live region tooltip')

  // Regression assertions for date tooltip and keyboard focus indicator
  assert.match(code, /\{activeBucket\.short_day\} • \{activeBucket\.date\}/, 'Weekly histogram tooltip must format day and date cleanly')
  assert.doesNotMatch(code, /• \$\{[a-zA-Z0-9_.]*date\}/, 'Must not have stray $ before date in tooltip')
  assert.match(code, /\.chart-interactive-point:focus-visible/, 'Point must have focus-visible styling')
  assert.match(code, /\.chart-interactive-bar:focus-visible/, 'Bar must have focus-visible styling')
  assert.match(code, /className="chart-focus-indicator"/, 'Must render high-contrast SVG focus indicator when focused')
  assert.doesNotMatch(code, /outline:\s*['"]none['"]/, 'Interactive chart elements must not suppress focus outline without accessible replacement')

  // 4-state contract: loading, empty, error, interactive
  assert.match(code, /aria-busy="true"/, 'Loading skeleton must set aria-busy="true"')
  assert.match(code, /Notice tone="warning"/, 'Error state must render warning notice')
  assert.match(code, /Notice tone="info"/, 'Empty state must render info notice')
  assert.match(code, /Try again/, 'Error state must provide a retry button')

  // Saturday condition logic in OwnerDashboard
  assert.match(code, /const isSaturday = isSaturdayManila\(clinicDate\(\)\)/, 'OwnerDashboard must check if today is Saturday in Manila time')
  assert.match(code, /dashboard showWeekly=\{isSaturday\}/, 'Validated weekly histogram must only appear on Saturdays')
})

// 2. Unit and Component Verification
const bundle = await build({
  stdin: {
    contents: `
      export * from './src/pages/Dashboards.jsx';
      export { setClockSource as setBundledClock } from './src/clock.js';
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  external: ['react', 'react-dom'],
  loader: { '.css': 'empty' },
})

const bundleDir = new URL('../node_modules/.cache/', import.meta.url)
mkdirSync(bundleDir, { recursive: true })
const bundleFile = new URL('own01-dashboard-charts-bundle.mjs', bundleDir)
writeFileSync(bundleFile, bundle.outputFiles[0].text)
const m = await import(bundleFile.href)

test('OWN-01: formatCurrencyPhp formats Philippine Peso with standard symbol and decimals', () => {
  const { formatCurrencyPhp } = m

  assert.equal(formatCurrencyPhp(1234.5), '₱1,234.50')
  assert.equal(formatCurrencyPhp(12500), '₱12,500.00')
  assert.equal(formatCurrencyPhp('500.00'), '₱500.00')
  assert.equal(formatCurrencyPhp(0), '₱0.00')
  assert.equal(formatCurrencyPhp(null), '₱0.00')
  assert.equal(formatCurrencyPhp(undefined), '₱0.00')
})

test('OWN-01: isSaturdayManila accurately evaluates Saturday condition in Asia/Manila', () => {
  const { isSaturdayManila } = m

  // 2026-10-03 is Saturday
  assert.equal(isSaturdayManila('2026-10-03'), true)
  // 2026-09-26 is Saturday
  assert.equal(isSaturdayManila('2026-09-26'), true)

  // Weekdays must return false
  assert.equal(isSaturdayManila('2026-09-28'), false, 'Monday must not be Saturday')
  assert.equal(isSaturdayManila('2026-09-29'), false, 'Tuesday must not be Saturday')
  assert.equal(isSaturdayManila('2026-09-30'), false, 'Wednesday must not be Saturday')
  assert.equal(isSaturdayManila('2026-10-01'), false, 'Thursday must not be Saturday')
  assert.equal(isSaturdayManila('2026-10-02'), false, 'Friday must not be Saturday')
  assert.equal(isSaturdayManila('2026-10-04'), false, 'Sunday must not be Saturday')

  // Empty or invalid inputs fail closed
  assert.equal(isSaturdayManila(''), false)
  assert.equal(isSaturdayManila(null), false)
  try {
    m.setBundledClock(() => new Date('2026-10-03T12:00:00+08:00'))
    assert.equal(isSaturdayManila(undefined), true)
    m.setBundledClock(() => new Date('2026-09-30T12:00:00+08:00'))
    assert.equal(isSaturdayManila(undefined), false)
  } finally {
    m.setBundledClock(null)
  }
})

test('OWN-01: DailyRevenueChart renders initial loading skeleton state with accessible status', () => {
  const html = renderToString(React.createElement(m.DailyRevenueChart, {
    activeBranch: 'All Branches',
    activeBranchId: null,
    isServerSession: true,
  }))

  assert.match(html, /Daily Revenue Trend/)
  assert.match(html, /chart-skeleton/)
  assert.match(html, /role="status"/)
  assert.match(html, /aria-busy="true"/)
  assert.match(html, /Loading daily revenue chart/)
  assert.match(html, /Loading revenue trend/)
})

test('OWN-01: DailyRevenueChart renders populated SVG line chart, grid lines, points, and formatted values', () => {
  const sampleDailyData = {
    period: 'week',
    period_label: 'Sep 25 – Sep 26, 2026',
    timezone: 'Asia/Manila',
    totals: {
      gross_collected_php: '12500.00',
      refunded_php: '500.00',
      net_cash_flow_php: '12000.00',
      payments_count: 2,
    },
    days: [
      { date: '2026-09-25', label: 'Sep 25', day_name: 'Fri', gross_collected_php: '0.00', refunded_php: '0.00', net_cash_flow_php: '0.00' },
      { date: '2026-09-26', label: 'Sep 26', day_name: 'Sat', gross_collected_php: '12500.00', refunded_php: '500.00', net_cash_flow_php: '12000.00' },
    ],
  }

  const html = renderToString(React.createElement(m.DailyRevenueChart, {
    activeBranch: 'Branch B1',
    activeBranchId: '01j00000000000000000000b01',
    isServerSession: true,
    initialData: sampleDailyData,
  }))

  // 1. Title and period subtitle
  assert.match(html, /Daily Revenue Trend/)
  assert.match(html, /Sep 25 – Sep 26, 2026 • Philippine Peso \(PHP\)/)

  // 2. Responsive SVG chart attributes
  assert.match(html, /class="revenue-line-chart"/)
  assert.match(html, /viewBox="0 0 600 220"/)
  assert.match(html, /role="img"/)
  assert.match(html, /aria-label="Daily revenue line chart for Sep 25 – Sep 26, 2026"/)

  // 3. Grid line and axis labels formatted in PHP
  assert.match(html, /class="chart-grid-line"/)
  assert.match(html, /₱12,500\.00/)
  assert.match(html, /₱0\.00/)

  // 4. SVG line path and area gradient
  assert.match(html, /<path[^>]*stroke="var\(--brand, #087c73\)"/)
  assert.match(html, /id="revenue-line-gradient"/)

  // 5. Accessible interactive data points and focus treatment
  assert.match(html, /class="chart-interactive-point"/)
  assert.match(html, /\.chart-interactive-point:focus-visible/)
  assert.doesNotMatch(html, /outline:\s*none/)
  assert.match(html, /role="button"[^>]*tabindex="0"[^>]*aria-label="2026-09-25 \(Fri\): ₱0\.00"/)
  assert.match(html, /role="button"[^>]*tabindex="0"[^>]*aria-label="2026-09-26 \(Sat\): ₱12,500\.00"/)

  // 6. Accessible summary detail strip
  assert.match(html, /Total collections:/)
  assert.match(html, /role="tooltip" aria-live="polite"/)
})

test('OWN-01: DailyRevenueChart renders empty and error states correctly', () => {
  // Empty state
  const emptyHtml = renderToString(React.createElement(m.DailyRevenueChart, {
    activeBranch: 'All Branches',
    initialData: { days: [], totals: {} },
  }))
  assert.match(emptyHtml, /No revenue data/)
  assert.match(emptyHtml, /No revenue transactions recorded for the selected period\./)

  // Error state
  const errorHtml = renderToString(React.createElement(m.DailyRevenueChart, {
    activeBranch: 'All Branches',
    initialError: 'Revenue service timed out.',
    initialLoading: false,
  }))
  assert.match(errorHtml, /Revenue trend unavailable/)
  assert.match(errorHtml, /Revenue service timed out\./)
  assert.match(errorHtml, /Try again/)
})

test('OWN-01: WeeklyRevenueHistogram renders initial loading skeleton state with accessible status', () => {
  const html = renderToString(React.createElement(m.WeeklyRevenueHistogram, {
    activeBranch: 'All Branches',
    activeBranchId: null,
    currentDate: '2026-10-03',
  }))

  assert.match(html, /Saturday Weekly Summary/)
  assert.match(html, /chart-skeleton/)
  assert.match(html, /role="status"/)
  assert.match(html, /aria-busy="true"/)
  assert.match(html, /Loading weekly revenue histogram/)
  assert.match(html, /Loading Saturday weekly summary/)
})

test('OWN-01: WeeklyRevenueHistogram renders populated SVG bar chart for Monday through Saturday', () => {
  const sampleWeeklyData = {
    reference_date: '2026-10-03',
    week_start_date: '2026-09-28',
    week_end_date: '2026-10-03',
    week_label: 'Sep 28 – Oct 03, 2026',
    timezone: 'Asia/Manila',
    totals: {
      gross_collected_php: '6000.00',
      refunded_php: '500.00',
      net_cash_flow_php: '5500.00',
    },
    buckets: [
      { date: '2026-09-28', day_of_week: 1, short_day: 'Mon', gross_collected_php: '6000.00', net_cash_flow_php: '5500.00' },
      { date: '2026-09-29', day_of_week: 2, short_day: 'Tue', gross_collected_php: '0.00', net_cash_flow_php: '0.00' },
      { date: '2026-09-30', day_of_week: 3, short_day: 'Wed', gross_collected_php: '0.00', net_cash_flow_php: '0.00' },
      { date: '2026-10-01', day_of_week: 4, short_day: 'Thu', gross_collected_php: '0.00', net_cash_flow_php: '0.00' },
      { date: '2026-10-02', day_of_week: 5, short_day: 'Fri', gross_collected_php: '0.00', net_cash_flow_php: '0.00' },
      { date: '2026-10-03', day_of_week: 6, short_day: 'Sat', gross_collected_php: '0.00', net_cash_flow_php: '0.00' },
    ],
  }

  const html = renderToString(React.createElement(m.WeeklyRevenueHistogram, {
    activeBranch: 'Branch B1',
    activeBranchId: '01j00000000000000000000b01',
    currentDate: '2026-10-03',
    initialData: sampleWeeklyData,
  }))

  // 1. Title and weekly subtitle
  assert.match(html, /Saturday Weekly Summary/)
  assert.match(html, /Sep 28 – Oct 03, 2026 • Monday–Saturday/)

  // 2. Responsive SVG bar chart attributes
  assert.match(html, /class="revenue-histogram-chart"/)
  assert.match(html, /viewBox="0 0 600 220"/)

  // 3. All 6 days (Mon-Sat) present with labels
  assert.match(html, />Mon</)
  assert.match(html, />Tue</)
  assert.match(html, />Wed</)
  assert.match(html, />Thu</)
  assert.match(html, />Fri</)
  assert.match(html, />Sat</)

  // 4. Accessible buttons with aria-label on each bar, classes, and focus styles
  assert.match(html, /class="chart-interactive-bar"/)
  assert.match(html, /\.chart-interactive-bar:focus-visible/)
  assert.doesNotMatch(html, /outline:\s*none/)
  assert.match(html, /role="button"[^>]*tabindex="0"[^>]*aria-label="Mon \(2026-09-28\): ₱6,000\.00"/)

  // 5. Currency formatting and totals
  assert.match(html, /Saturday week total:/)
  assert.match(html, /₱6,000\.00/)

  // 6. Live region tooltip
  assert.match(html, /role="tooltip" aria-live="polite"/)
})

test('OWN-01: WeeklyRevenueHistogram renders empty and error states correctly', () => {
  // Empty state
  const emptyHtml = renderToString(React.createElement(m.WeeklyRevenueHistogram, {
    activeBranch: 'All Branches',
    initialData: { buckets: [], totals: {} },
  }))
  assert.match(emptyHtml, /No weekly revenue data/)
  assert.match(emptyHtml, /No transactions recorded for the week ending on Saturday\./)

  // Error state
  const errorHtml = renderToString(React.createElement(m.WeeklyRevenueHistogram, {
    activeBranch: 'All Branches',
    initialError: 'Weekly histogram failed to compute.',
    initialLoading: false,
  }))
  assert.match(errorHtml, /Weekly summary unavailable/)
  assert.match(errorHtml, /Weekly histogram failed to compute\./)
  assert.match(errorHtml, /Try again/)
})

test('OWN-01: OwnerDashboard renders WeeklyRevenueHistogram on Saturday and omits it on weekdays', () => {
  const state = {
    branches: [{ id: 'b1', publicId: '01j00000000000000000000b01', name: 'Branch B1', city: 'Manila' }],
    appointments: [],
    queue: [],
    hmo: [],
    invoices: [],
    inquiries: [],
    conversations: [],
    patients: [],
    dentists: [],
    clock: '2026-10-03T08:00:00+08:00',
  }

  const store = {
    state,
    session: { role: 'owner', serverUserId: 'u1' },
  }

  // 1. On Saturday (2026-10-03):
  m.setBundledClock(() => new Date('2026-10-03T08:00:00+08:00'))
  const saturdayHtml = renderToString(React.createElement(m.OwnerDashboard, {
    activeBranch: 'All Branches',
    setPage: () => {},
    state,
    session: store.session,
    store,
  }))

  assert.match(saturdayHtml, /Daily revenue/, 'Daily revenue chart must be present on Saturday')
  assert.match(saturdayHtml, /Monday–Saturday revenue summary/, 'Saturday weekly summary must be present on Saturday')
  assert.match(saturdayHtml, /owner-revenue-grid/, 'Both validated charts must share the existing responsive chart grid')

  // 2. On Wednesday (2026-09-30):
  m.setBundledClock(() => new Date('2026-09-30T08:00:00+08:00'))
  const weekdayHtml = renderToString(React.createElement(m.OwnerDashboard, {
    activeBranch: 'All Branches',
    setPage: () => {},
    state,
    session: store.session,
    store,
  }))

  assert.match(weekdayHtml, /Daily revenue/, 'Daily revenue chart must be present on Wednesday')
  assert.doesNotMatch(weekdayHtml, /Monday–Saturday revenue summary/, 'Saturday weekly summary must NOT be present on Wednesday')
  assert.doesNotMatch(weekdayHtml, /owner-revenue-grid/, 'Must not use a two-chart grid for the daily chart alone')

  // 3. Existing dashboard elements outside charts remain intact
  assert.match(weekdayHtml, /Executive dashboard/)
  assert.match(weekdayHtml, /Appointments today/)
  assert.match(weekdayHtml, /HMO pending/)
  assert.doesNotMatch(weekdayHtml, /Recorded demo transactions/, 'Live Owner must never receive a local-demo revenue KPI')
  assert.match(weekdayHtml, /Scheduling health/)
  assert.match(weekdayHtml, /Patient communication/)
})

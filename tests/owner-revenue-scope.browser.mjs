import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { addDays } from '../src/clock.js'

const [playwright, origin, mode] = process.argv.slice(2)
const { chromium } = await import(pathToFileURL(playwright).href)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const widths = [375, 390, 430, 768, 1024, 1440]
const saturday = '2026-10-31'
const branch = '01j00000000000000000000b01'
const zero = { gross_collected_php: '0.00', refunded_php: '0.00', net_cash_flow_php: '0.00', payments_count: 0, refunds_count: 0 }
const settled = { gross_collected_php: '100.31', refunded_php: '5.02', net_cash_flow_php: '95.29', payments_count: 1, refunds_count: 1 }

try {
  const page = await browser.newPage()
  page.setDefaultTimeout(7500)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let stale = true
  const verifiedRequests = []
  await page.route('**/api/analytics/**', route => {
    const url = new URL(route.request().url())
    const requested = url.searchParams
    const weekly = url.pathname.endsWith('/weekly-histogram')
    if (!weekly && !url.pathname.endsWith('/daily-revenue')) return route.fulfill({ json: { data: null } })
    const exact = weekly || requested.get('date_from') === saturday && requested.get('date_to') === saturday
    if (exact) verifiedRequests.push([weekly ? requested.get('date') : requested.get('date_from'), requested.get('branch_id')])
    const offset = stale && exact ? -7 : 0
    const end = addDays(weekly ? saturday : requested.get('date_to') || saturday, offset)
    const start = weekly ? addDays(end, -5) : addDays(requested.get('date_from') || saturday, offset)
    const totals = exact ? settled : zero
    const rows = []
    for (let date = start; date <= end; date = addDays(date, 1)) {
      const day = new Date(date + 'T00:00:00Z')
      rows.push({ date, day_of_week: day.getUTCDay() || 7, short_day: day.toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' }),
        ...(date === end ? totals : zero) })
    }
    return route.fulfill({ json: { data: { timezone: 'Asia/Manila', period_label: end, branch: { public_id: branch }, totals,
      ...(weekly ? { buckets: rows, week_start_date: start, week_end_date: end, week_label: end, is_finalized: end < saturday } : { days: rows }) } } })
  })

  for (const width of mode === 'baseline' ? [390] : widths) {
    stale = true
    verifiedRequests.length = 0
    await page.setViewportSize({ width, height: 950 })
    await page.goto(origin + '/tests/fixtures/owner-analytics-a5.html')
    await page.getByRole('combobox', { name: 'Report period', exact: true }).selectOption('Custom dates')
    await page.getByLabel('From date', { exact: true }).fill(saturday)
    await page.getByLabel('Through date', { exact: true }).fill(saturday)
    await page.getByRole('button', { name: 'Apply dates', exact: true }).click()
    const region = page.locator('.owner-revenue')
    const reports = [
      region.locator('.card').filter({ has: page.getByRole('heading', { name: 'Daily revenue', exact: true }) }),
      region.locator('.card').filter({ has: page.getByRole('heading', { name: 'Monday–Saturday revenue summary', exact: true }) }),
    ]
    if (mode === 'baseline') {
      for (const report of reports) await report.getByRole('button', { name: /^2026-10-24\. Gross collections/ }).waitFor()
      console.log('Baseline accepted both prior-week responses for October 31')
      continue
    }
    for (const report of reports) {
      await report.getByText('Revenue unavailable', { exact: true }).waitFor()
      assert.equal(await report.locator('svg.owner-revenue-plot').count(), 0)
    }
    stale = false
    for (const report of reports) {
      await report.getByRole('button', { name: 'Retry revenue', exact: true }).press('Enter')
      const point = report.getByRole('button', { name: /^2026-10-31\. Gross collections/ })
      await point.waitFor()
      await point.locator('.owner-revenue-hit').first().hover()
      const tooltip = report.getByRole('tooltip')
      assert.match(await tooltip.innerText(), /₱100\.31/)
      await point.focus()
      await page.keyboard.press('Escape')
      assert.equal(await tooltip.count(), 0)
      await page.keyboard.press('Enter')
      assert.match(await tooltip.innerText(), /₱95\.29/)
    }
    assert.deepEqual(verifiedRequests, Array.from({ length: 4 }, () => [saturday, branch]))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    console.log(`${width}px: two stale reports suppressed, exact date and branch recovered with one keyboard retry each, hover and keyboard tooltips verified`)
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}

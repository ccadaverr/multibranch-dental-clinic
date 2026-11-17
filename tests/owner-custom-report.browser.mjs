import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const [runner, origin, mode] = process.argv.slice(2)
assert.ok(runner && origin && ['baseline', 'changed'].includes(mode))
const changed = mode === 'changed'
const { chromium } = await import(pathToFileURL(runner).href)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu', '--renderer-process-limit=2'] })
const date = '2026-09-28'
const amount = '1260.55'

try {
  const page = await browser.newPage({ timezoneId: 'UTC' })
  page.setDefaultTimeout(8000)
  const errors = []
  const queries = []
  let failSection = false
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  await page.route('**/api/me', route => route.fulfill({
    json: { data: { id: 'synthetic-owner', role: 'owner', account_status: 'Active' } },
  }))
  await page.route('**/api/analytics/**', async route => {
    const url = new URL(route.request().url())
    const endpoint = url.pathname.split('/').pop()
    const branch = url.searchParams.get('branch_id')
    const dates = url.searchParams.has('date_from')
    const exact = url.searchParams.get('date_from') === date && url.searchParams.get('date_to') === date
    queries.push({ endpoint, params: url.searchParams })
    if (dates && !exact) return route.fulfill({ status: 503, json: {} })
    const money = { gross_collected_php: amount, refunded_php: '0.00', net_cash_flow_php: amount, payments_count: 1, refunds_count: 0 }
    if (endpoint === 'export') return route.fulfill({ contentType: 'text/csv', body: 'Branch,Total\nb2,1260.55' })
    if (endpoint === 'daily-revenue') return route.fulfill({ json: { data: {
      timezone: 'Asia/Manila', branch: { public_id: branch }, period_label: date, totals: money, days: [{ date, ...money }],
    } } })
    if (endpoint === 'branch-performance') {
      if (exact && failSection) {
        failSection = false
        return route.fulfill({ status: 503, json: { message: 'Synthetic branch read failure' } })
      }
      return route.fulfill({ json: { data: [{
        public_id: branch, name: 'Synthetic branch figures', active_queue: 0, total_appointments: 1, revenue_collected_php: amount,
      }] } })
    }
    if (endpoint !== 'executive-summary') return route.fulfill({ status: 503, json: {} })
    return route.fulfill({ json: { data: {
      period_label: date,
      financials: { total_collected_php: amount, total_gross_php: amount, paid_invoices_count: 1 },
      scheduling: { total_appointments: 1, completed: 1, cancelled: 0, completion_rate_pct: 100 },
      patient_flow: { total_visits: 1, served_from_queue: 1, current_waiting: 0 },
      hmo: { approved: 0, approved_amount_php: '0.00', pending: 0 },
      automation: { health_rate_pct: null, total_actions: 0, failed: 0 },
    } } })
  })

  const activate = (button, width) => width === 375 ? button.press('Enter') : button.click()
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
  const customReads = () => queries.filter(query => query.params.get('date_from') === date && query.params.get('date_to') === date)
  for (const width of [375, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 950 })
    await page.goto(origin + '/tests/fixtures/arc02-archive-scope.synthetic.html')
    await page.waitForFunction(() => !!window.arc02?.setActor)
    await page.evaluate(() => {
      const fixture = window.arc02
      fixture.setActor('owner')
      fixture.patchState({ invoices: fixture.state.invoices.map(row => ({
        ...row, patientName: undefined, patient: { id: row.patientId, name: 'Synthetic nested name' },
      })) })
    })
    await page.getByLabel('Filter archive by branch').selectOption('a')
    const search = page.locator('.filter-bar-search input')
    await search.fill('Synthetic nested name')
    let archiveActions = 1
    if (!changed) {
      await page.getByText('No matching archive records in this branch scope.', { exact: true }).waitFor()
      await search.fill('RCPT-a')
      archiveActions++
    }
    await activate(page.getByRole('button', { name: 'View details for INV-a', exact: true }), width)
    archiveActions++
    await page.getByRole('dialog').getByText('INV-a', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'View details for INV-b', exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => window.arc02.audits.at(-1).targetId), 'INV-a')
    await page.keyboard.press('Escape')
    assert.equal(await fits(), true)

    queries.length = 0
    await page.goto(origin + '/tests/fixtures/analytics-export-context.html')
    await page.waitForFunction(() => !!window.analyticsContext?.setBranch)
    await page.evaluate(() => window.analyticsContext.setBranch('Synthetic B2'))
    const metric = page.locator('.analytics-value').filter({ hasText: changed ? /^₱1,260\.55$/ : /^₱1,261$/ })
    await metric.waitFor()
    const period = page.getByRole('combobox', { name: 'Report period', exact: true })
    const csv = page.getByRole('button', { name: 'Export Report CSV', exact: true })
    let reportActions = null
    if (!changed) {
      assert.equal(await period.locator('option').filter({ hasText: 'Custom dates' }).count(), 0)
    } else {
      await period.selectOption('Custom dates')
      await page.getByRole('button', { name: 'Apply dates' }).waitFor()
      assert.equal(await csv.isDisabled(), true)
      await page.getByLabel('From date', { exact: true }).fill(date)
      await page.getByLabel('Through date', { exact: true }).fill(date)
      assert.equal(customReads().length, 0)
      failSection = width === 375
      await activate(page.getByRole('button', { name: 'Apply dates' }), width)
      await page.getByText(`Showing ${date} through ${date}.`, { exact: true }).waitFor()
      await metric.waitFor()
      if (width === 375) await activate(page.getByRole('button', { name: 'Retry branch figures' }), width)
      await page.getByText('Revenue: ₱1,260.55', { exact: false }).waitFor()
      const point = page.getByRole('group', { name: 'Daily gross collections line chart' }).getByRole('button').first()
      await point.focus()
      await page.getByRole('tooltip').getByText('₱1,260.55', { exact: true }).first().waitFor()
      const [download] = await Promise.all([page.waitForEvent('download'), activate(csv, width)])
      assert.match(download.suggestedFilename(), /^operational-analytics-/)
      reportActions = 5
      assert.deepEqual(new Set(customReads().map(query => query.endpoint)),
        new Set(['executive-summary', 'branch-performance', 'daily-revenue', 'export']))
      assert.ok(customReads().every(query => query.params.get('branch_id') === 'b2' && !query.params.has('period')))
      const requests = customReads().length
      await page.getByLabel('Through date', { exact: true }).fill('2026-09-27')
      assert.equal(await page.getByRole('button', { name: 'Apply dates' }).isDisabled(), true)
      assert.equal(await csv.isDisabled(), true)
      await metric.waitFor()
      assert.equal(customReads().length, requests)
    }
    assert.equal(await fits(), true)
    console.log(JSON.stringify({ mode, width, archiveActions, reportActions, exactCentavos: changed }))
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}

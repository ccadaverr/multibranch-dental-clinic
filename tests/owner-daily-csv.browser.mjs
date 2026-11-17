import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const [runner, origin, mode] = process.argv.slice(2)
assert.ok(runner && origin && ['baseline', 'changed'].includes(mode))
const changed = mode === 'changed'
const { chromium } = await import(pathToFileURL(runner).href)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu', '--renderer-process-limit=2'] })
const date = '2026-09-28'
const row = `${date},1250.51,70.12,1180.39`

try {
  const page = await browser.newPage({ timezoneId: 'UTC' })
  page.setDefaultTimeout(8000)
  const errors = []
  const requests = []
  let downloads = 0
  let nextExport = 'complete'
  page.on('pageerror', error => errors.push(error.message))
  page.on('download', () => downloads++)
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  await page.route('**/api/me', route => route.fulfill({
    json: { data: { id: 'synthetic-owner', role: 'owner', account_status: 'Active' } },
  }))
  await page.route('**/api/analytics/**', route => {
    const url = new URL(route.request().url())
    const endpoint = url.pathname.split('/').pop()
    const branch = url.searchParams.get('branch_id')
    if (endpoint === 'export') {
      requests.push(url.searchParams)
      const outcome = nextExport
      nextExport = 'complete'
      if (outcome === 'denied') return route.fulfill({ status: 403, json: {} })
      if (outcome === 'empty') return route.fulfill({ contentType: 'text/csv', body: '' })
      const invoice = 'EXECUTIVE OPERATIONAL SUMMARY\nFinancial,Total Revenue Collected,9.99\n'
      const cash = `DAILY CASH FLOW\nDate,Gross Collections (PHP),Refunds (PHP),Net Cash Flow (PHP)\n${row}\n`
      return route.fulfill({ contentType: 'text/csv', body: invoice + (url.searchParams.get('include_daily') === '1' ? cash : '') })
    }
    if (endpoint === 'daily-revenue' && url.searchParams.get('period') === 'today') {
      const money = { gross_collected_php: '1250.51', refunded_php: '70.12', net_cash_flow_php: '1180.39', payments_count: 1, refunds_count: 1 }
      return route.fulfill({ json: { data: {
        timezone: 'Asia/Manila', branch: { public_id: branch }, period_label: date, totals: money, days: [{ date, ...money }],
      } } })
    }
    if (endpoint === 'branch-performance') return route.fulfill({ json: { data: [] } })
    return route.fulfill({ status: 503, json: {} })
  })

  const activate = (button, width) => width === 375 ? button.press('Enter') : button.click()
  const downloadWith = async (button, width) => {
    const [download] = await Promise.all([page.waitForEvent('download'), activate(button, width)])
    await page.getByText('Analytics CSV downloaded.', { exact: true }).waitFor()
    return readFile(await download.path(), 'utf8')
  }
  for (const width of [375, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 950 })
    await page.goto(origin + '/tests/fixtures/analytics-export-context.html')
    await page.waitForFunction(() => !!window.analyticsContext?.setBranch)
    await page.evaluate(() => window.analyticsContext.setBranch('Synthetic B2'))
    const chart = page.getByRole('group', { name: 'Daily gross collections line chart' })
    await chart.waitFor()
    const exportButton = page.getByRole('button', { name: 'Export Report CSV', exact: true })
    let interactions = 0
    if (!changed) {
      const daily = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Daily revenue', exact: true }) })
      await activate(daily.getByText('Exact amounts by date', { exact: true }), width)
      await daily.getByRole('table').getByText('₱1,180.39', { exact: true }).waitFor()
      interactions++
    }
    const csv = await downloadWith(exportButton, width)
    interactions++
    assert.match(csv, /Total Revenue Collected,9\.99/)
    assert.equal(csv.includes(row), changed)
    assert.equal(requests.at(-1).get('branch_id'), 'b2')
    assert.equal(requests.at(-1).get('period'), 'today')
    assert.equal(requests.at(-1).get('include_daily'), changed ? '1' : null)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)

    if (changed && width === 375) {
      const saved = downloads
      nextExport = 'empty'
      await activate(exportButton, width)
      await page.getByRole('status').filter({ hasText: 'The report file was empty. Try again.' }).waitFor()
      assert.equal(downloads, saved)
      const failedScope = requests.at(-1).toString()
      const retry = page.getByRole('button', { name: 'Retry report CSV', exact: true })
      const retryCsv = await downloadWith(retry, width)
      assert.ok(retryCsv.includes(row))
      assert.equal(requests.at(-1).toString(), failedScope)
      nextExport = 'denied'
      await activate(exportButton, width)
      await page.getByRole('status').filter({ hasText: 'This export is restricted to the clinic Owner.' }).waitFor()
      assert.equal(await retry.count(), 0)
      assert.equal(downloads, saved + 1)
    }
    console.log(JSON.stringify({ mode, width, reconciliationInteractions: interactions, dailyCashInCsv: changed }))
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}

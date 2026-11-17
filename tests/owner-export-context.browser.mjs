import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const [runner, origin, mode] = process.argv.slice(2)
assert.ok(runner && origin && ['baseline', 'changed'].includes(mode))
const changed = mode === 'changed'
const { chromium } = await import(pathToFileURL(runner).href)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu', '--renderer-process-limit=2'] })
const date = '2026-11-17'
const filename = changed ? `operational-analytics-brc-b2-${date}-20261118-000000.csv`
  : 'operational-analytics-20261118-000000.csv'

try {
  const page = await browser.newPage({ timezoneId: 'UTC' })
  page.setDefaultTimeout(8000)
  const queries = []
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    window.reportPrints = 0
    window.print = () => { window.reportPrints++ }
  })
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  await page.route('**/api/me', route => route.fulfill({
    json: { data: { id: 'synthetic-owner', role: 'owner', account_status: 'Active' } },
  }))
  await page.route('**/api/analytics/**', route => {
    const url = new URL(route.request().url())
    if (!url.pathname.endsWith('/export')) return route.fulfill({ status: 503, json: {} })
    queries.push(url.searchParams)
    return route.fulfill({
      contentType: 'text/csv',
      headers: {
        'Access-Control-Expose-Headers': 'Content-Disposition',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      body: `Date,Net Cash Flow (PHP)\n${date},125.51\n`,
    })
  })

  const activate = (button, width) => width === 375 ? button.press('Enter') : button.click()
  for (const width of [375, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 950 })
    await page.goto(origin + '/tests/fixtures/analytics-export-context.html')
    await page.waitForFunction(() => !!window.analyticsContext?.setBranch)
    await page.evaluate(() => window.analyticsContext.setBranch('Synthetic B2'))
    await page.getByRole('combobox', { name: 'Report period', exact: true }).selectOption('Custom dates')
    await page.getByLabel('From date', { exact: true }).fill(date)
    await page.getByLabel('Through date', { exact: true }).fill(date)
    await activate(page.getByRole('button', { name: 'Apply dates', exact: true }), width)

    const printControls = page.getByRole('button', { name: changed ? /^Print current view$/ : /^Export Analytics PDF/ })
    assert.equal(await printControls.count(), changed ? 1 : 2)
    await activate(printControls.first(), width)
    assert.equal(await page.evaluate(() => window.reportPrints), 1)

    const exportButton = page.getByRole('button', { name: 'Export Report CSV', exact: true })
    const [download] = await Promise.all([page.waitForEvent('download'), activate(exportButton, width)])
    await page.getByText('Analytics CSV downloaded.', { exact: true }).waitFor()
    assert.equal(download.suggestedFilename(), filename)
    const printedName = page.getByText(filename, { exact: true })
    if (changed) await printedName.waitFor()
    else assert.equal(await printedName.count(), 0)
    assert.equal(queries.at(-1).get('branch_id'), 'b2')
    assert.equal(queries.at(-1).get('date_from'), date)
    assert.equal(queries.at(-1).get('date_to'), date)
    assert.equal(queries.at(-1).get('include_daily'), '1')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await page.evaluate(() => window.analyticsContext.setBranch('Synthetic B1'))
    await page.getByText('Synthetic B1 · Manila time', { exact: true }).waitFor()
    assert.equal(await printedName.count(), 0)
    console.log(JSON.stringify({ mode, width, printChoices: changed ? 1 : 2, printActions: 1, filenameHasScope: changed }))
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}

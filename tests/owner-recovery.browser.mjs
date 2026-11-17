import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const [runner, origin, mode] = process.argv.slice(2)
assert.ok(runner && origin && ['baseline', 'changed'].includes(mode))
const changed = mode === 'changed'
const { chromium } = await import(pathToFileURL(runner).href)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu', '--renderer-process-limit=2'] })

try {
  const page = await browser.newPage({ timezoneId: 'UTC' })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())

  let auditStatus
  const auditQueries = []
  const auditEvent = (id, action) => ({
    id, action, category: 'administrative', severity: 'info',
    branch: { id: 'b1', name: 'Synthetic Branch' },
    auditable_type: 'Invoice', auditable_id: 'invoice-1', created_at: '2026-11-17T03:00:00Z',
  })
  await page.route('**/api/audit-logs?**', route => {
    const q = new URL(route.request().url()).searchParams
    auditQueries.push(q.toString())
    const cursor = q.get('cursor')
    if (cursor && auditStatus) {
      const status = auditStatus
      auditStatus = undefined
      return route.fulfill({ status, json: { message: 'Synthetic older events failure' } })
    }
    return route.fulfill({ json: { data: cursor ? [auditEvent('event-old', 'invoice.older')] :
      [auditEvent('event-head', 'invoice.latest')],
    meta: { next_cursor: cursor ? null : 'cursor-from-server' } } })
  })

  const reportQueries = []
  let branchFailure
  let summaryFailure
  let holdSummary
  let releaseSummary
  await page.route('**/api/analytics/**', async route => {
    const url = new URL(route.request().url())
    const branchId = url.searchParams.get('branch_id')
    reportQueries.push(url)
    if (url.pathname.endsWith('/branch-performance')) {
      if (branchFailure) {
        const status = branchFailure
        branchFailure = undefined
        return route.fulfill({ status, json: { message: 'Synthetic branch figures failure' } })
      }
      return route.fulfill({ json: { data: [{
        public_id: branchId, name: `Scoped figures ${branchId}`, active_queue: 2, total_appointments: 7,
        revenue_collected_php: '25.00', estimated_wait_minutes: null,
      }] } })
    }
    if (!url.pathname.endsWith('/executive-summary')) return route.fulfill({ status: 503, json: {} })
    if (summaryFailure && !url.searchParams.has('date_from')) {
      const status = summaryFailure
      summaryFailure = undefined
      return route.fulfill({ status, json: { message: 'Synthetic summary failure' } })
    }
    if (holdSummary === branchId && url.searchParams.get('period') === 'this week') {
      holdSummary = undefined
      await new Promise(resolve => { releaseSummary = resolve })
    }
    const money = branchId === 'b1' ? '42.00' : '25.00'
    return route.fulfill({ json: { data: {
      period_label: 'Synthetic period',
      financials: { total_collected_php: money, total_gross_php: money, paid_invoices_count: 1 },
      scheduling: { total_appointments: 1, completed: 1, cancelled: 0, completion_rate_pct: 100 },
      patient_flow: { total_visits: 1, served_from_queue: 1, current_waiting: 0 },
      hmo: { approved: 0, approved_amount_php: '0.00', pending: 0 },
      automation: { health_rate_pct: null, total_actions: 0, failed: 0 },
    } } })
  })

  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
  const activate = (button, width) => width === 375 ? button.press('Enter') : button.click()
  const auditRow = action => page.getByRole('row').filter({ hasText: action })
  const sectionReads = () => reportQueries.filter(u => u.searchParams.get('period') === 'today'
    && /\/(executive-summary|branch-performance)$/.test(u.pathname))
  const readCounts = () => ({
    summary: sectionReads().filter(u => u.pathname.endsWith('/executive-summary')).length,
    branches: sectionReads().filter(u => u.pathname.endsWith('/branch-performance')).length,
  })
  const setReportBranch = name => page.evaluate(name => window.analyticsContext.setBranch(name), name)
  for (const width of [375, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 950 })
    await page.goto(origin + '/tests/fixtures/owner-audit-record.html')
    await auditRow('invoice.latest').waitFor()
    await page.getByRole('combobox', { name: 'Branch', exact: true }).selectOption('b1')
    await auditRow('invoice.latest').waitFor()
    await activate(page.getByRole('button', { name: 'Show record history for Invoice invoice-1', exact: true }), width)
    await page.getByText('Record filter: Invoice', { exact: false }).waitFor()
    await auditRow('invoice.latest').waitFor()
    auditQueries.length = 0
    auditStatus = 503
    await activate(page.getByRole('button', { name: 'Load older events', exact: true }), width)
    const recoveryLabel = changed ? 'Retry older events' : 'Load older events'
    const retry = page.getByRole('button', { name: recoveryLabel, exact: true })
    await retry.waitFor()
    if (changed) await page.getByText('Older events could not be loaded.', { exact: false }).waitFor()
    else await page.waitForFunction(() => window.auditMessages.length > 0)
    assert.equal(await auditRow('invoice.latest').count(), 1)
    assert.equal(await page.getByText('End of the matching history.').count(), 0)
    await activate(retry, width)
    await auditRow('invoice.older').waitFor()
    assert.equal(await auditRow('invoice.latest').count(), 1)
    assert.equal(auditQueries.length, 2)
    assert.equal(auditQueries[0], auditQueries[1])
    const auditScope = new URLSearchParams(auditQueries[1])
    assert.equal(auditScope.get('branch_id'), 'b1')
    assert.equal(auditScope.get('cursor'), 'cursor-from-server')
    assert.equal(auditScope.get('target_type'), 'Invoice')
    assert.equal(auditScope.get('target_id'), 'invoice-1')
    assert.equal(await fits(), true)

    if (changed && width === 375) {
      await activate(page.getByRole('button', { name: 'Refresh audit events', exact: true }), width)
      await page.getByRole('button', { name: 'Load older events', exact: true }).waitFor()
      auditStatus = 403
      await activate(page.getByRole('button', { name: 'Load older events', exact: true }), width)
      await page.getByText('Audit access could not be verified.', { exact: false }).waitFor()
      assert.equal(await auditRow('invoice.latest').count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Export Audit Trail (CSV)' }).isDisabled(), true)
    }

    reportQueries.length = 0
    await page.goto(origin + '/tests/fixtures/analytics-export-context.html')
    await page.waitForFunction(() => !!window.analyticsContext?.setBranch)
    branchFailure = 503
    await setReportBranch('Synthetic B2')
    const reportRetry = page.getByRole('button', { name: changed ? 'Retry branch figures' : 'Try again', exact: true })
    await reportRetry.waitFor()
    const summary = page.getByRole('heading', { name: 'Recorded revenue', exact: true })
    if (changed) await summary.waitFor()
    else assert.equal(await summary.count(), 0)
    const beforeRetry = readCounts()
    assert.deepEqual(beforeRetry, { summary: 1, branches: 1 })
    const blendedExports = await page.getByRole('button', { name: 'Export Local Capacity CSV', exact: true }).count()
    assert.equal(blendedExports, changed ? 0 : 1)
    await activate(reportRetry, width)
    await page.getByText('Scoped figures b2', { exact: true }).waitFor()
    await summary.waitFor()
    const afterRetry = readCounts()
    assert.deepEqual(afterRetry, { summary: changed ? 1 : 2, branches: 2 })
    const scopedReads = sectionReads()
    assert(scopedReads.every(url => url.searchParams.get('branch_id') === 'b2' && url.searchParams.get('period') === 'today'))
    assert.equal(await fits(), true)

    if (changed && width === 375) {
      holdSummary = 'b2'
      const lateSummary = request => {
        const url = new URL(request.url())
        return url.pathname.endsWith('/executive-summary') && url.searchParams.get('branch_id') === 'b2'
          && url.searchParams.get('period') === 'this week'
      }
      const pending = page.waitForRequest(lateSummary)
      await page.getByRole('combobox', { name: 'Report period' }).selectOption('This Week')
      await page.waitForFunction(() => document.body.textContent.includes('Loading executive summary'))
      await pending
      await setReportBranch('Synthetic B1')
      await page.getByText('Scoped figures b1', { exact: true }).waitFor()
      const currentValue = page.locator('.analytics-value').filter({ hasText: /^₱42$/ })
      await currentValue.waitFor()
      const lateResponse = page.waitForResponse(lateSummary)
      releaseSummary()
      await (await lateResponse).finished()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await currentValue.count(), 1)
      assert.equal(await page.getByText('Scoped figures b2', { exact: true }).count(), 0)
      const prior = reportQueries.length
      await setReportBranch('Synthetic duplicate')
      await page.getByText('Branch unavailable · Manila time', { exact: true }).waitFor()
      assert.equal(reportQueries.length, prior)
      assert.equal(await summary.count(), 0)
      branchFailure = 403
      await setReportBranch('Synthetic B1')
      await page.getByText('Report access is unavailable.', { exact: false }).waitFor()
      assert.equal(await summary.count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Export Report CSV', exact: true }).isDisabled(), true)
      summaryFailure = 503
      branchFailure = 503
      await setReportBranch('Synthetic B2')
      const retryBoth = page.getByRole('button', { name: 'Retry report figures', exact: true })
      await activate(retryBoth, width)
      await page.getByText('Scoped figures b2', { exact: true }).waitFor()
      await summary.waitFor()
    }
    console.log(JSON.stringify({ mode, width, auditRetryRequests: 1, inlineAuditRetry: changed,
      reportRetryRequests: afterRetry.summary - beforeRetry.summary + afterRetry.branches - beforeRetry.branches,
      preservedSummary: changed, blendedExports }))
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}

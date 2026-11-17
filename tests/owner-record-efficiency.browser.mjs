import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const [runner, origin, mode] = process.argv.slice(2)
assert.ok(runner && origin && ['baseline', 'changed'].includes(mode))
const changed = mode === 'changed'
const { chromium } = await import(pathToFileURL(runner).href)
const browser = await chromium.launch({
  channel: 'chrome', headless: true, args: ['--disable-gpu', '--renderer-process-limit=2'],
})
const widths = [375, 390, 430, 768, 1024, 1440]

try {
  const page = await browser.newPage({ timezoneId: 'UTC' })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort())

  const activate = (button, width) => width === 375 ? button.press('Enter') : button.click()
  const verifyTarget = async button => {
    if (changed) assert.ok((await button.boundingBox()).height >= 44)
  }
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
  const dialogs = () => page.getByRole('dialog')
  const audit = {
    id: 'event-1', action: 'record.updated', severity: 'info', category: 'administrative',
    actor: { name: 'Synthetic Owner', role: 'owner' }, branch: { id: 'b1', name: 'Synthetic Branch' },
    auditable_type: 'SyntheticRecord', auditable_id: 'record-1', created_at: '2026-10-30T17:00:00Z',
  }
  let failAudit = false
  await page.route('**/api/audit-logs**', route => failAudit
    ? route.fulfill({ status: 503, json: { message: 'Synthetic audit failure' } })
    : route.fulfill({ json: { data: [audit], meta: { next_cursor: null } } }))

  const reportRequests = []
  let releaseSummary
  let failWeek = false
  await page.route('**/api/analytics/**', async route => {
    const url = new URL(route.request().url())
    reportRequests.push(url)
    if (url.pathname.endsWith('/executive-summary')) {
      await new Promise(resolve => { releaseSummary = resolve })
      return route.fulfill({ json: { data: {
        period_label: 'Synthetic period',
        financials: { total_collected_php: '25.00', total_gross_php: '25.00', paid_invoices_count: 1 },
        scheduling: { total_appointments: 1, completed: 1, cancelled: 0, completion_rate_pct: 100 },
        patient_flow: { total_visits: 1, served_from_queue: 1, current_waiting: 0 },
        hmo: { approved: 0, approved_amount_php: '0.00', pending: 0 },
        automation: { health_rate_pct: null, total_actions: 0, failed: 0 },
      } } })
    }
    if (url.pathname.endsWith('/branch-performance')) return route.fulfill({ json: { data: [] } })
    if (!url.pathname.endsWith('/weekly-histogram')) return route.fulfill({ status: 503, json: {} })
    if (failWeek) {
      failWeek = false
      return route.fulfill({ status: 503, json: { message: 'Synthetic weekly failure' } })
    }
    const reference = url.searchParams.get('date')
    const monday = reference === '2026-10-31' ? 26 : 12
    const amount = { gross_collected_php: '25.00', refunded_php: '0.00', net_cash_flow_php: '25.00', payments_count: 1, refunds_count: 0 }
    const zero = { gross_collected_php: '0.00', refunded_php: '0.00', net_cash_flow_php: '0.00', payments_count: 0, refunds_count: 0 }
    const buckets = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((short_day, i) => ({
      date: `2026-10-${monday + i}`, short_day, day_of_week: i + 1, ...(i === 5 ? amount : zero),
    }))
    const id = url.searchParams.get('branch_id')
    return route.fulfill({ json: { data: {
      branch: id ? { public_id: id } : null, timezone: 'Asia/Manila', totals: amount, buckets,
      week_start_date: buckets[0].date, week_end_date: buckets[5].date, week_label: reference,
      is_finalized: reference !== '2026-10-31',
    } } })
  })

  for (const width of widths) {
    await page.setViewportSize({ width, height: 950 })
    await page.goto(origin + '/tests/fixtures/arc02-archive-scope.synthetic.html')
    await page.waitForFunction(() => !!window.arc02?.setActor)
    await page.evaluate(() => window.arc02.setActor('owner'))
    const scope = page.getByLabel('Filter archive by branch')
    await scope.selectOption('a')
    const search = page.locator('.filter-bar-search input')
    await search.fill('RCPT-a')
    let archiveActions = 1
    if (!changed) {
      await activate(page.getByRole('button', { name: /^Settled Invoices & Receipts/ }), width)
      archiveActions++
    } else {
      assert.equal(await page.getByRole('button', { name: 'All matches (1)' }).getAttribute('aria-pressed'), 'true')
      await page.getByRole('table', { name: 'Matching archive records' }).getByText('RCPT-a', { exact: true }).waitFor()
    }
    const receipt = page.getByRole('button', { name: 'View details for INV-a', exact: true })
    assert.equal(await page.getByRole('button', { name: 'View details for INV-b', exact: true }).count(), 0)
    await verifyTarget(receipt)
    await activate(receipt, width)
    archiveActions++
    await dialogs().getByText('Synthetic Branch a').waitFor()
    assert.equal(await page.evaluate(() => window.arc02.audits.at(-1).targetId), 'INV-a')
    if (changed) {
      await dialogs().getByText('INV-a', { exact: true }).waitFor()
      await dialogs().getByText('RCPT-a', { exact: true }).waitFor()
      await page.evaluate(() => {
        const fixture = window.arc02
        fixture.patchState({ invoices: fixture.state.invoices.map(row => row.id === 'invoice-a' ? { ...row, branchId: 'b' } : row) })
      })
      await dialogs().waitFor({ state: 'hidden' })
      await search.fill('RX-a')
      await page.getByRole('button', { name: 'View details for RX-a', exact: true }).waitFor()
      assert.equal(await page.getByText(/PRIVATE MEDICINE/).count(), 0)
      await page.evaluate(() => window.arc02.setAppointmentsStatus('error'))
      await page.getByText('Appointment history could not be refreshed.').waitFor()
      await activate(page.getByRole('button', { name: 'Retry historical appointments', exact: true }), width)
      await page.getByText('Appointment history could not be refreshed.').waitFor({ state: 'hidden' })
      assert.equal(await search.inputValue(), 'RX-a')
      await search.fill('')
      assert.equal(await scope.inputValue(), 'a')
      await page.evaluate(() => window.arc02.setActor('patient'))
      await page.getByText('Archive access unavailable', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: /View details for/ }).count(), 0)
    } else {
      // The baseline opened this invoice but displayed the associated appointment code.
      await dialogs().getByText('APT-a', { exact: true }).waitFor()
      await page.keyboard.press('Escape')
    }
    assert.equal(await fits(), true)

    await page.goto(origin + '/tests/fixtures/owner-audit-record.html')
    const row = page.getByRole('row').filter({ hasText: 'record.updated' })
    await row.waitFor()
    const columns = await page.locator('thead th').count()
    assert.equal(columns, changed ? 5 : 8)
    const inspect = row.getByRole('button', { name: 'Inspect' })
    await verifyTarget(inspect)
    await activate(inspect, width)
    await dialogs().getByText('Synthetic Branch', { exact: true }).waitFor()
    if (changed) {
      assert.equal(await dialogs().locator('time').getAttribute('datetime'), audit.created_at)
      assert.match(await dialogs().locator('time').textContent(), /Oct 31, 2026/)
    }
    await page.keyboard.press('Escape')
    failAudit = true
    await activate(page.getByRole('button', { name: 'Refresh audit events' }), width)
    await page.getByText('Audit trail unavailable', { exact: true }).waitFor()
    failAudit = false
    await activate(page.getByRole('button', { name: 'Retry', exact: true }), width)
    await row.waitFor()
    assert.equal(await fits(), true)

    reportRequests.length = 0
    releaseSummary = undefined
    await page.goto(origin + '/tests/fixtures/owner-analytics.html?today=2026-10-31')
    if (changed) await page.getByText('All Branches · Manila time', { exact: true }).waitFor()
    const weekInput = page.getByLabel('Week containing date', { exact: true })
    await weekInput.fill('2026-10-17')
    await page.getByText('Week finalized — Saturday has passed.', { exact: true }).waitFor()
    assert.equal(reportRequests.some(url => url.pathname.endsWith('/branch-performance')), changed)
    assert.ok(releaseSummary)
    releaseSummary()
    await page.getByRole('heading', { name: 'Recorded revenue', exact: true }).waitFor()
    assert.ok(reportRequests.some(url => url.pathname.endsWith('/branch-performance')))

    let dateEdits = 0
    failWeek = true
    if (changed) {
      const currentWeek = page.getByRole('button', { name: 'Current week', exact: true })
      await verifyTarget(currentWeek)
      await activate(currentWeek, width)
      assert.equal(await weekInput.evaluate(input => input === document.activeElement), true)
    } else {
      await weekInput.fill('2026-10-31')
      dateEdits++
    }
    const weekly = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Monday–Saturday revenue summary' }) })
    await activate(weekly.getByRole('button', { name: 'Retry revenue', exact: true }), width)
    await page.getByText(/^Saturday summary .* in progress/).waitFor()
    const requests = reportRequests.filter(url => url.pathname.endsWith('/weekly-histogram'))
    assert.equal(requests.at(-1).search, requests.at(-2).search)
    assert.equal(requests.at(-1).searchParams.get('date'), '2026-10-31')
    assert.equal(await weekInput.inputValue(), '2026-10-31')
    assert.equal(await fits(), true)
    console.log(JSON.stringify({ mode, width, archiveActions, columns, reportDateEdits: dateEdits,
      reportDateActions: 1, parallelReportReads: changed }))
  }
  assert.deepEqual(errors, [])
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await browser.close()
}

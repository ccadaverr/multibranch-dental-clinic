import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const { chromium } = await import(pathToFileURL(process.argv[2]).href)
const base = process.argv[3] || 'http://127.0.0.1:5197'
const browser = await chromium.launch({ channel: 'chrome', headless: true })

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const requests = []
  const downloads = []
  let ownerRole = 'owner'
  let holdExport = false
  let releaseExport
  let startExport
  let finishExport
  page.on('download', file => downloads.push(file.suggestedFilename()))
  await page.addInitScript(() => {
    const originalFetch = window.fetch
    window.exportSignals = []
    window.fetch = (input, options) => {
      if (String(input).includes('/api/audit-logs/export')) window.exportSignals.push(options.signal)
      return originalFetch(input, options)
    }
  })
  await page.route('**/api/me', route => route.fulfill({
    json: { id: 'owner-server', role: ownerRole, account_status: 'Active' },
  }))
  const archived = {
    id: 'audit-1',
    action: 'notification.archived',
    category: 'administrative',
    severity: 'info',
    actor: { name: 'Synthetic staff', role: 'staff' },
    auditable_type: 'UserNotification',
    auditable_id: 'synthetic-recipient-note',
    created_at: '2026-11-16T08:01:00+08:00',
  }
  const other = { ...archived, id: 'audit-2', action: 'unrelated.event', auditable_type: 'AnotherResource' }
  await page.route('**/api/audit-logs**', async route => {
    const url = new URL(route.request().url())
    requests.push(url)
    if (url.pathname.endsWith('/export')) {
      if (holdExport) {
        holdExport = false
        try {
          await new Promise(resolve => { releaseExport = resolve; startExport() })
          await route.fulfill({ contentType: 'text/csv', body: 'late CSV' })
        } catch { /* The browser is allowed to abort the intercepted request. */ }
        finally { finishExport?.() }
        return
      }
      return route.fulfill({ contentType: 'text/csv', body: 'ID,Action\naudit-1,notification.archived' })
    }
    const rows = url.searchParams.has('target_id') ? [archived] : [archived, other]
    return route.fulfill({ json: { data: rows, meta: { next_cursor: null } } })
  })
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(base + '/tests/fixtures/owner-audit-record.html')
    const archiveRow = page.getByRole('row').filter({ hasText: archived.action })
    await archiveRow.getByRole('button', { name: 'Inspect' }).click()
    await page.getByRole('button', { name: 'Filter to this record' }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('status').filter({ hasText: 'Record filter: UserNotification' }).waitFor()
    await archiveRow.waitFor()
    assert.equal(await page.getByText(other.action, { exact: true }).count(), 0)
    assert.equal(await archiveRow.getByText('No branch recorded').count(), 1)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export Audit Trail (CSV)' }).click(),
    ])
    assert.match(download.suggestedFilename(), /^audit_trail_\d{4}-\d{2}-\d{2}\.csv$/)
    const query = requests.at(-1).searchParams
    assert.equal(query.get('target_id'), archived.auditable_id)
    assert.equal(query.get('target_type'), archived.auditable_type)
    await page.getByRole('button', { name: 'Clear record filter' }).click()
    await page.getByText(other.action, { exact: true }).waitFor()
    assert.equal(requests.at(-1).searchParams.has('target_id'), false)
    const refresh = page.getByRole('button', { name: 'Refresh audit events' })
    await refresh.focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('[aria-label="Refresh audit events"]').getAttribute('aria-busy') === 'true')
    await page.getByText(other.action, { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  }
  await page.goto(base + '/tests/fixtures/owner-audit-record.html')
  const exportButton = page.getByRole('button', { name: 'Export Audit Trail (CSV)' })
  const cancelled = page.getByRole('button', { name: 'Cancel audit export' })
  const delayedStarted = new Promise(resolve => { startExport = resolve })
  const delayedFinished = new Promise(resolve => { finishExport = resolve })
  holdExport = true
  await exportButton.click()
  await page.getByText('Preparing audit CSV...', { exact: true }).waitFor()
  await delayedStarted
  await cancelled.click()
  await page.waitForFunction(() => window.auditMessages.includes('Audit export cancelled.'))
  assert.equal(await page.evaluate(() => window.exportSignals[0].aborted), true)

  const [replacement] = await Promise.all([page.waitForEvent('download'), exportButton.click()])
  assert.match(replacement.suggestedFilename(), /^audit_trail_/)
  const count = downloads.length
  releaseExport?.()
  await delayedFinished
  assert.equal(downloads.length, count)

  ownerRole = 'staff'
  await exportButton.click()
  await page.waitForFunction(() => window.auditMessages.some(message => message.includes('Owner access could not be verified')))
  assert.equal(downloads.length, count)
  assert.equal(await cancelled.count(), 0)
  assert.deepEqual(errors, [])
  console.log('Synthetic Owner audit record, keyboard filter, CSV, clear and refresh passed at 390px and 1440px. Pending cancellation, replacement and revoked Owner checks passed.')
} finally {
  await browser.close()
}

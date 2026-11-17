import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const [playwrightPath, base, mode] = process.argv.slice(2)
assert.ok(playwrightPath && base && ['baseline', 'changed'].includes(mode),
  'Pass the Playwright index.mjs path, fixture origin, and baseline or changed.')
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const widths = [375, 390, 430, 768, 1024, 1440]
const today = '2026-11-17'
const weekStart = '2026-11-11'
const target = { auditable_type: 'SyntheticRecord', auditable_id: 'record-1' }
const rows = [
  { id: 'event-1', action: 'record.updated', day: today, branch: { id: 'b1', name: 'Synthetic Branch' }, ...target },
  { id: 'event-2', action: 'record.created', day: weekStart, branch: { id: 'b1', name: 'Synthetic Branch' }, ...target },
  { id: 'event-3', action: 'other.created', day: today, branch: { id: 'b1', name: 'Synthetic Branch' }, ...target, auditable_type: 'OtherRecord' },
  { id: 'event-4', action: 'other.branch', day: today, branch: { id: 'b2', name: 'Other Branch' }, ...target },
  { id: 'event-5', action: 'record.old', day: '2026-11-10', branch: { id: 'b1', name: 'Synthetic Branch' }, ...target },
  { id: 'event-6', action: 'record.without_target', day: today, branch: { id: 'b1', name: 'Synthetic Branch' } },
]

try {
  const page = await browser.newPage({ timezoneId: 'UTC' })
  // The browser is still on Nov 16 while Manila is already on Nov 17.
  await page.clock.setFixedTime(new Date('2026-11-16T17:00:00Z'))
  const requests = []
  const errors = []
  let failNext = false
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.origin === new URL(base).origin ? route.continue() : route.abort()
  })
  await page.route('**/api/audit-logs**', async route => {
    const url = new URL(route.request().url())
    requests.push({ method: route.request().method(), url })
    if (failNext) {
      failNext = false
      return route.fulfill({ status: 503, json: { message: 'Synthetic read unavailable' } })
    }
    const q = url.searchParams
    const matches = rows.filter(row =>
      (!q.has('target_type') || row.auditable_type === q.get('target_type')) &&
      (!q.has('target_id') || row.auditable_id === q.get('target_id')) &&
      (!q.has('branch_id') || row.branch.id === q.get('branch_id')) &&
      (!q.has('date_from') || row.day >= q.get('date_from')) &&
      (!q.has('date_to') || row.day <= q.get('date_to')))
    return route.fulfill({ json: { data: matches.map(row => ({
      ...row, category: 'administrative', severity: 'info', created_at: row.day + 'T08:00:00+08:00',
    })), meta: { next_cursor: null } } })
  })

  const event = action => page.getByRole('row').filter({ has: page.getByText(action, { exact: true }) })
  const recordStatus = page.getByRole('status').filter({ hasText: 'Record filter: SyntheticRecord record-1' })
  const from = page.getByLabel('From:')
  const to = page.getByLabel('To:')
  const lastQuery = () => requests.at(-1).url.searchParams
  const activate = (control, width) => width === 375 ? control.press('Enter') : control.click()
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(base + '/tests/fixtures/owner-audit-record.html')
    await event('record.updated').waitFor()
    await page.getByRole('combobox', { name: 'Branch' }).selectOption('b1')
    await event('other.branch').waitFor({ state: 'hidden' })
    await event('record.without_target').waitFor()
    assert.equal(await event('record.without_target').getByRole('button', { name: /show record history/i }).count(), 0)

    let recordActions = 0
    if (mode === 'baseline') {
      await activate(event('record.updated').getByRole('button', { name: 'Inspect' }), width)
      recordActions++
      await activate(page.getByRole('button', { name: 'Filter to this record' }), width)
      recordActions++
    } else {
      const shortcut = event('record.updated').getByRole('button', { name: 'Show record history for SyntheticRecord record-1' })
      assert.ok((await shortcut.boundingBox()).height >= 40)
      await activate(shortcut, width)
      recordActions++
    }
    await recordStatus.waitFor()
    await event('record.created').waitFor()
    assert.equal(await event('other.created').count(), 0)
    assert.equal(await event('other.branch').count(), 0)
    assert.equal(lastQuery().get('target_type'), target.auditable_type)
    assert.equal(lastQuery().get('target_id'), target.auditable_id)
    assert.equal(lastQuery().get('branch_id'), 'b1')
    if (mode === 'changed') assert.equal(await recordStatus.evaluate(el => document.activeElement === el), true)

    let dateActions = 0
    if (mode === 'baseline') {
      await from.fill(weekStart)
      dateActions++
      await to.fill(today)
      dateActions++
    } else {
      const shortcut = page.getByRole('button', { name: 'Last 7 days', exact: true })
      await activate(shortcut, width)
      dateActions++
    }
    await event('record.created').waitFor()
    assert.equal(await event('record.old').count(), 0)
    assert.equal(await from.inputValue(), weekStart)
    assert.equal(await to.inputValue(), today)
    assert.equal(lastQuery().get('date_from'), weekStart)
    assert.equal(lastQuery().get('date_to'), today)
    assert.equal(lastQuery().get('target_id'), target.auditable_id)
    assert.equal(lastQuery().get('branch_id'), 'b1')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)

    if (mode === 'changed') {
      failNext = true
      await page.getByRole('button', { name: 'Today', exact: true }).click()
      await page.getByText('Audit trail unavailable', { exact: true }).waitFor()
      assert.equal(await event('record.created').count(), 0)
      const failedQuery = lastQuery().toString()
      const activity = page.getByRole('region', { name: 'Activity Log', exact: true })
      await page.getByRole('button', { name: 'Retry', exact: true }).press('Enter')
      await event('record.updated').waitFor()
      assert.equal(await event('record.created').count(), 0)
      assert.equal(await activity.evaluate(el => el === document.activeElement), true)
      assert.equal(lastQuery().toString(), failedQuery)
      assert.equal(lastQuery().get('date_from'), today)
      assert.equal(lastQuery().get('date_to'), today)
    }
    console.log(`${mode} ${width}px: record history ${recordActions} activations, date range ${dateActions} control interactions`)
  }
  assert(requests.every(request => request.method === 'GET'))
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}

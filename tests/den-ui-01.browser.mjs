import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { apiAppointment, today } from './support/den-ui-01-fixture.js'
const require = createRequire(import.meta.url)
if (!process.env.PLAYWRIGHT_MODULE) throw Error('Set PLAYWRIGHT_MODULE to an existing installed playwright package; no automatic downloads.')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const context = await browser.newContext()
const page = await context.newPage()
page.setDefaultTimeout(12000)
const errors = [], mutations = [], results = [], requests = []
page.on('pageerror', e => errors.push(e.message))
let apiMode = 'populated', detailMode = 'normal', delay = null
const statusRows = ['Pending', 'Confirmed', 'Checked In', 'In Treatment', 'Completed', 'Cancelled', 'No-show'].map((status, i) => apiAppointment('a' + i, { status, start_time: String(i + 8).padStart(2, '0') + ':00', end_time: String(i + 8).padStart(2, '0') + ':30' }))
const fixtures = [...statusRows, apiAppointment('tomorrow', { date: '2026-11-02', patient: { id: 'p2', name: 'Illustrative Tomorrow Patient' } }), apiAppointment('past', { date: '2026-10-31', status: 'Completed', patient: { id: 'p3', name: 'Illustrative Past Patient' } }), apiAppointment('other-dentist', { dentist: { id: 'd2' }, patient: { name: 'Excluded Other Dentist Patient' } }), apiAppointment('other-branch', { branch: { id: 'b3' }, patient: { name: 'Excluded Other Branch Patient' } })]
await page.route('**/api/**', async route => {
  const request = route.request(), url = new URL(request.url())
  requests.push({ path: url.pathname, params: Object.fromEntries(url.searchParams) })
  if (request.method() !== 'GET') { mutations.push(request.method() + ' ' + url.pathname); return route.abort() }
  if (url.pathname === '/api/appointments') {
    if (apiMode === 'loading') await delay
    if (apiMode === 'error') return route.fulfill({ status: 503, json: { message: 'Illustrative service unavailable' } })
    let rows = apiMode === 'empty' ? [] : fixtures
    const date = url.searchParams.get('date'), from = url.searchParams.get('from'), to = url.searchParams.get('to')
    rows = rows.filter(a => date ? a.date === date : (!from || a.date >= from) && (!to || a.date <= to))
    return route.fulfill({ json: { data: rows, meta: { current_page: 1, last_page: 1 } } })
  }
  if (url.pathname.startsWith('/api/appointments/')) {
    if (detailMode === 'error') return route.fulfill({ status: 403, json: { message: 'Illustrative permission refusal' } })
    const row = fixtures.find(a => a.id === url.pathname.split('/').pop())
    return route.fulfill({ json: { data: detailMode === 'other' ? apiAppointment(row.id, { dentist: { id: 'd2' }, patient: { name: 'Excluded Detail Patient' } }) : row } })
  }
  if (url.pathname === '/api/followups') {
    return apiMode === 'error' ? route.fulfill({ status: 503, json: { message: 'Illustrative follow-up failure' } }) : route.fulfill({ json: { data: apiMode === 'empty' ? [] : [{ id: 'f1', status: 'Open', due_on: today, branch: { id: 'b1' }, patient: { name: 'Illustrative Follow-up Patient' } }, { id: 'hidden-followup', status: 'Open', due_on: today, branch: { id: 'b3' }, patient: { name: 'Excluded Branch Follow-up Patient' } }], meta: {} } })
  }
  throw Error('Unexpected API request: ' + url.pathname)
})
const url = process.env.DEN_UI_URL || 'http://127.0.0.1:5186/tests/fixtures/den-ui-01.html'
const overflow = async label => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ': horizontal overflow')
const evidence = process.env.QA_EVIDENCE_DIR || 'docs/ui-review/den-ui-01'
await mkdir(evidence, { recursive: true })
try {
  for (const width of [390, 768, 1440, 375, 430, 1024]) {
    console.log(`Checking width ${width}`)
    apiMode = 'populated'
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(url)
    const home = page.getByRole('region', { name: 'Dentist Home', exact: true })
    await home.getByText('Illustrative Follow-up Patient', { exact: true }).waitFor()
    await home.locator('.den-agenda > li').first().waitFor()
    assert.equal(await home.locator('.den-agenda > li').count(), 7)
    assert.equal(await page.getByText(/Excluded /).count(), 0)
    assert.equal(await home.getByText('Illustrative Waiting Patient', { exact: true }).count(), 1)
    await overflow('Home ' + width)
    if ([390, 768, 1440].includes(width)) await page.screenshot({ path: `${evidence}/home-${width}.png`, fullPage: true })
    await home.getByRole('button', { name: 'Continue treatment', exact: true }).click()
    assert.equal((await page.evaluate(() => window.denFixture.getContext())).treatmentId, 't1')
    assert.equal((await page.evaluate(() => window.denFixture.getContext())).visitId, 'v-old')
    await page.evaluate(() => window.denFixture.go('dashboard'))
    await home.getByRole('button', { name: 'My Schedule', exact: true }).click()
    const schedule = page.getByRole('region', { name: 'My Schedule', exact: true })
    await schedule.locator('.den-agenda > li').first().waitFor()
    await schedule.getByText('Illustrative Waiting Patient', { exact: true }).waitFor()
    assert.equal(await schedule.locator('.den-agenda > li').count(), 7)
    assert.equal(await page.getByText(/Excluded /).count(), 0)
    assert.equal(await schedule.locator('.den-month-grid button[aria-pressed="true"]').count(), 1)
    await overflow('Schedule ' + width)
    if ([390, 768, 1440].includes(width)) await page.screenshot({ path: `${evidence}/schedule-${width}.png`, fullPage: true })
    await schedule.getByLabel('Filter schedule by status').selectOption('Pending')
    assert.equal(await schedule.locator('.den-agenda > li').count(), 1)
    await schedule.getByRole('button', { name: 'Clear filters', exact: true }).click()
    await schedule.getByLabel('Find a patient or service').fill('not returned')
    await schedule.getByText('No appointments match these filters.', { exact: true }).waitFor()
    await schedule.getByRole('button', { name: 'Clear filters', exact: true }).click()
    const detailButton = schedule.getByRole('button', { name: /View appointment for/ }).first()
    await detailButton.click()
    const dialog = page.getByRole('dialog', { name: 'Appointment details', exact: true })
    await dialog.getByText('Booked, waiting for confirmation.', { exact: true }).waitFor()
    assert.equal(await dialog.getByText('Pending', { exact: true }).count(), 1)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.ok(await detailButton.evaluate(el => el === document.activeElement), 'detail close restores focus')
    const selectedDay = schedule.locator('.den-month-grid button[aria-pressed="true"]')
    await selectedDay.focus(); await page.keyboard.press('ArrowRight')
    assert.equal(await schedule.getByLabel('Schedule date', { exact: true }).inputValue(), '2026-11-02')
    assert.ok(await schedule.locator('.den-month-grid button[aria-pressed="true"]').evaluate(el => el === document.activeElement && parseFloat(getComputedStyle(el).outlineWidth) >= 2))
    await schedule.getByText('Illustrative Tomorrow Patient', { exact: true }).waitFor()
    assert.equal(await schedule.getByText("Today's walk-in visits", { exact: true }).count(), 0)
    assert.equal(await schedule.locator('.den-agenda > li').count(), 1)
    await schedule.getByRole('button', { name: 'Previous day', exact: true }).focus(); await page.keyboard.press('Enter')
    assert.equal(await schedule.getByLabel('Schedule date', { exact: true }).inputValue(), today)
    await schedule.getByRole('button', { name: 'Previous week', exact: true }).click()
    assert.equal(await schedule.getByLabel('Schedule date', { exact: true }).inputValue(), '2026-10-25')
    await schedule.getByRole('button', { name: 'Next week', exact: true }).click()
    assert.equal(await schedule.getByLabel('Schedule date', { exact: true }).inputValue(), today)
    await schedule.getByRole('button', { name: 'Previous day', exact: true }).click()
    await schedule.getByText('Illustrative Past Patient', { exact: true }).waitFor()
    await schedule.getByLabel('Schedule date', { exact: true }).fill('2026-12-31')
    await schedule.getByRole('button', { name: 'Next day', exact: true }).click()
    assert.equal(await schedule.getByLabel('Schedule date', { exact: true }).inputValue(), '2027-01-01')
    await schedule.getByRole('button', { name: 'Today', exact: true }).click()
    await schedule.locator('.den-agenda > li').first().waitFor()
    assert.equal(await schedule.getByLabel('Schedule date', { exact: true }).inputValue(), today)
    await overflow('Schedule after navigation ' + width)
    results.push({ width, home: 'pass', schedule: 'pass', keyboard: 'pass', overflow: 'pass', detailsAndFocus: 'pass' })
  }
  await page.setViewportSize({ width: 390, height: 900 })
  apiMode = 'error'
  await page.goto(url)
  await page.getByText('Could not load appointments', { exact: true }).waitFor()
  await page.getByText('Follow-ups are unavailable.', { exact: false }).waitFor()
  assert.equal(await page.getByText('No appointments scheduled for this day.', { exact: true }).count(), 0)
  apiMode = 'empty'
  await page.getByRole('button', { name: 'Try again', exact: true }).first().click()
  await page.getByText('No appointments scheduled for this day.', { exact: true }).waitFor()
  await page.evaluate(() => window.denFixture.setMode('empty'))
  await page.getByText('No patients awaiting treatment in your queue.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Continue treatment', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Refresh Home', exact: true }).click()
  await page.getByText('No open follow-ups returned for this branch.', { exact: true }).waitFor()
  await page.evaluate(() => window.denFixture.setMode('clinical-error'))
  await page.getByText('Live queue counts unavailable', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Continue treatment', exact: true }).count(), 0)
  apiMode = 'populated'
  await page.evaluate(() => window.denFixture.go('schedule'))
  await page.locator('.den-agenda > li').first().waitFor()
  detailMode = 'other'
  await page.getByRole('button', { name: /View appointment for/ }).first().click()
  await page.getByText('This appointment is outside your current access.', { exact: false }).waitFor()
  assert.equal(await page.getByText('Excluded Detail Patient').count(), 0)
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.denFixture.setMode('revoked'))
  await page.getByText('Schedule unavailable', { exact: true }).waitFor()
  assert.equal(await page.locator('.den-agenda > li').count(), 0)
  let release
  delay = new Promise(resolve => { release = resolve })
  apiMode = 'loading'
  await page.goto(url)
  await page.getByText('Loading appointments...', { exact: true }).waitFor()
  assert.equal(await page.getByText('No appointments scheduled for this day.', { exact: true }).count(), 0)
  apiMode = 'populated'; release()
  await page.locator('.den-agenda > li').first().waitFor()
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
  await overflow('Reduced motion and OS dark preference')
  assert.equal(await page.locator('.den-current').evaluate(el => getComputedStyle(el).animationName), 'none')
  assert.equal(mutations.length, 0, 'No mutating API calls')
  assert.deepEqual(errors, [], 'No browser page errors')
  await writeFile(`${evidence}/browser-results.json`, JSON.stringify({ results, additionalStates: ['loading', 'empty appointments and clinical work', 'manual Home refresh including follow-ups', 'HTTP error and retry', 'clinical error', 'unauthorized details', 'revoked branch', 'reduced motion'], pageErrors: errors, mutations, requestCount: requests.length, authenticatedAcceptance: false }, null, 2))
  console.log(JSON.stringify({ results, additionalStates: 'pass', pageErrors: errors, mutations, requestCount: requests.length }))
} finally { await browser.close() }

import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { runCal02CalendarScope } from './cal02-calendar-scope.test.js'
import { runOwnerBranchAcceptance } from './owner-branches-rendered.mjs'

// Runs the existing calendar/branch interaction contracts alongside the scoped hardening.
const { chromium } = await import(pathToFileURL(process.argv[2]).href)
const base = process.argv[3] || 'http://127.0.0.1:5180'
test('FE-INT-P1 existing browser compatibility', {timeout:180000}, async t => {
 const browser = await chromium.launch({ headless: true, channel: 'chrome' })
 try {
  let page = await browser.newPage()
  page.setDefaultNavigationTimeout(30000)
  await runCal02CalendarScope(page, base, (name, body) => t.test(`CAL-02 ${name}`, body))
  await page.close()
  page = await browser.newPage()
  await runOwnerBranchAcceptance(page, base)
  console.log('PASS existing Owner branch map, coordinates, hours and catalog acceptance')
  await page.close()
  page = await browser.newPage()
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  for (const role of ['dentist', 'staff', 'owner']) {
    await page.goto(`${base}/tests/den12-work-hours-harness.html?role=${role}`)
    await page.getByRole('heading', { name: 'Weekly hours', exact: true }).or(page.getByRole('heading', { name: 'My rostered weekly hours', exact: true })).waitFor()
    const changes = page.getByRole('button', { name: /^Change Monday/ })
    if (role === 'owner') assert.equal(await changes.count(), 2)
    else assert.equal(await changes.count(), 0)
    assert.equal(await page.evaluate(() => window.den12.calls.length), 0)
    console.log(`PASS existing DEN-12 ${role} read/edit boundary`)
  }
  assert.deepEqual(errors, [])
 } finally { await browser.close() }
})

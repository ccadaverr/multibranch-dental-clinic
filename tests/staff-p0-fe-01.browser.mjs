import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

// Synthetic frontend acceptance only: no clinic API or database is contacted.
export async function runStaffShiftIsolation(page, base = 'http://127.0.0.1:5176') {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const open = () => page.getByRole('button', { name: 'Change shift profile', exact: true })
  const save = () => page.getByRole('button', { name: 'Save shift profile', exact: true })
  const start = () => page.getByLabel('Shift start', { exact: true })
  const end = () => page.getByLabel('Shift end', { exact: true })
  const branch = () => page.getByRole('combobox', { name: 'Assigned branch', exact: true })
  const form = () => page.getByRole('form', { name: /Edit shift for/ })
  const last = () => page.evaluate(() => window.sched01.requests.at(-1))
  const reset = async () => {
    await page.goto(`${base}/tests/fixtures/sched01-staff-roster.html`)
    await open().waitFor()
  }
  const success = async () => {
    await page.getByRole('status').filter({ hasText: 'Shift profile saved for' }).waitFor()
    assert.equal(await open().evaluate(el => el === document.activeElement), true)
  }
  const keyboardOpen = async () => {
    await open().focus(); await page.keyboard.press('Enter')
    assert.equal(await start().evaluate(el => el === document.activeElement), true)
  }
  const hours = { shift_start: '09:15', shift_end: '18:15' }

  await reset(); await keyboardOpen()
  // Required time fields still use native validation and cannot send an empty shift.
  await start().fill(''); await save().click()
  assert.equal(await start().evaluate(el => el.validity.valueMissing), true)
  assert.equal(await page.evaluate(() => window.sched01.requests.length), 0)
  await start().fill(hours.shift_start); await end().fill(hours.shift_end)
  await save().focus(); await page.keyboard.press('Enter'); await success()
  assert.deepEqual((await last()).body, hours, 'hours-only save must omit branch_ref')
  assert.match(await page.locator('dl').innerText(), /Synthetic Branch A/)

  await keyboardOpen()
  await branch().selectOption('b2'); await branch().selectOption('b1')
  await save().click(); await success()
  assert.deepEqual((await last()).body, hours, 'changing back to the original branch is not an assignment instruction')

  await keyboardOpen(); await branch().selectOption('b2')
  await page.evaluate(() => { window.sched01.fail = true })
  await save().click(); await page.getByRole('alert').waitFor()
  assert.deepEqual((await last()).body, { ...hours, branch_ref: 'b2' })
  assert.equal(await start().inputValue(), hours.shift_start)
  assert.equal(await end().inputValue(), hours.shift_end)
  assert.equal(await branch().inputValue(), 'b2')
  assert.equal(await form().getAttribute('aria-describedby'), 'staff-shift-error')
  await page.getByRole('alert').focus(); await page.keyboard.press('Tab')
  assert.equal(await start().evaluate(el => el === document.activeElement), true)

  await page.evaluate(() => { window.sched01.fail = false; window.sched01.hold = true })
  const count = await page.evaluate(() => window.sched01.requests.length)
  await save().click()
  await page.waitForFunction(n => window.sched01.requests.length === n + 1 && window.sched01.release, count)
  assert.equal(await form().getAttribute('aria-busy'), 'true')
  assert.equal(await page.getByRole('combobox', { name: 'Staff member', exact: true }).isDisabled(), true)
  assert.equal(await start().isDisabled(), true)
  await form().evaluate(el => {
    el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  assert.equal(await page.evaluate(() => window.sched01.requests.length), count + 1)
  await page.evaluate(() => { window.sched01.hold = false; window.sched01.release() })
  await success()
  assert.deepEqual((await last()).body, { ...hours, branch_ref: 'b2' })

  // The authoritative saved assignment becomes the comparison point on the next edit.
  await keyboardOpen(); await start().fill('10:15'); await save().click(); await success()
  assert.deepEqual((await last()).body, { shift_start: '10:15', shift_end: '18:15' })
  assert.match(await page.locator('dl').innerText(), /Synthetic Branch B/)

  // Both a null assignment and an assignment missing from the branch catalog stay unchanged.
  for (const [id, reference] of [['s4', ''], ['s5', 'b-unlisted']]) {
    await page.getByRole('combobox', { name: 'Staff member', exact: true }).selectOption(id)
    await keyboardOpen()
    assert.equal(await branch().inputValue(), reference)
    await start().fill('09:15'); await end().fill('18:15'); await save().click(); await success()
    assert.deepEqual((await last()).body, hours)
  }
  await page.getByRole('combobox', { name: 'Staff member', exact: true }).selectOption('s4')
  await keyboardOpen(); await branch().selectOption('b1'); await save().click(); await success()
  assert.deepEqual((await last()).body, { ...hours, branch_ref: 'b1' }, 'explicit assignment from null is retained')

  await reset(); await keyboardOpen(); await start().fill('11:15')
  await page.evaluate(() => { window.sched01.throwSave = true })
  await save().click(); await page.getByRole('alert').waitFor()
  assert.equal(await start().inputValue(), '11:15')
  assert.equal(await save().isEnabled(), true)
  await page.evaluate(() => { window.sched01.throwSave = false; window.sched01.wrongId = true })
  await save().click(); await page.getByRole('alert').filter({ hasText: 'could not be confirmed' }).waitFor()
  assert.equal(await start().inputValue(), '11:15')
  assert.equal(await page.getByRole('status').filter({ hasText: 'Shift profile saved for' }).count(), 0)
  await page.getByRole('button', { name: 'Cancel', exact: true }).focus(); await page.keyboard.press('Enter')
  assert.equal(await open().evaluate(el => el === document.activeElement), true)

  // A delayed save must not update a replacement account/editor or the newly selected profile.
  for (const replacement of ['account', 'role', 'unmount']) {
    await reset(); await keyboardOpen(); await start().fill('11:15')
    await page.evaluate(() => { window.sched01.hold = true })
    await save().click(); await page.waitForFunction(() => window.sched01.release)
    await page.evaluate(kind => {
      if (kind === 'account') window.sched01.setAccount('replacement')
      else if (kind === 'role') window.sched01.setRole('staff')
      else window.sched01.setMounted(false)
    }, replacement)
    if (replacement !== 'unmount') await page.getByRole('combobox', { name: 'Staff member', exact: true }).waitFor()
    else await page.getByText('Fixture unmounted', { exact: true }).waitFor()
    if (replacement === 'account') await page.getByRole('combobox', { name: 'Staff member', exact: true }).selectOption('s2')
    await page.evaluate(() => { window.sched01.hold = false; window.sched01.release() })
    await page.waitForFunction(() => window.sched01.completed === 1)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.getByRole('status').filter({ hasText: 'Shift profile saved for' }).count(), 0, `${replacement}: obsolete success is suppressed`)
    if (replacement !== 'unmount') {
      assert.doesNotMatch(await page.locator('dl').innerText(), /11:15/)
      if (replacement === 'account') {
        await keyboardOpen()
        assert.equal(await start().inputValue(), '10:00', 'replacement profile keeps its own hours')
      } else assert.equal(await open().count(), 0)
    }
  }
  assert.deepEqual(errors, [])
  console.log('PASS STAFF-P0-FE-01: exact payloads, unchanged/reverted/null/unlisted branches, explicit assignment, validation, keyboard/focus, retries, duplicate guards and obsolete results')
}

// Usage: node tests/staff-p0-fe-01.browser.mjs <path-to-playwright/index.mjs> [base-url]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright')
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  try { await runStaffShiftIsolation(await browser.newPage(), process.argv[3]) }
  finally { await browser.close() }
}

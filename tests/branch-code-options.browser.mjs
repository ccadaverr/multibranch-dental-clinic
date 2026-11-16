import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { BRANCH_CODE_OPTIONS } from '../src/branch-codes.js'

const { chromium } = await import(pathToFileURL(process.argv[2]).href)
const base = process.argv[3] || 'http://127.0.0.1:5195'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } })
    const writes = [], errors = []
    let collision = true
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort())
    await page.route('**/sanctum/**', route => route.fulfill({ status: 204 }))
    await page.route('**/api/branches/*', async route => {
      const body = route.request().postDataJSON()
      writes.push(body)
      if (collision) return route.fulfill({ status: 422, json: { message: 'This branch code is already in use. Choose another code.', errors: { branch_code: ['This branch code is already in use. Choose another code.'] } } })
      return route.fulfill({ json: { data: { id: 'b1', ...body } } })
    })
    await page.goto(base + '/tests/fixtures/owner-branches.html')
    const code = page.getByRole('combobox', { name: 'Branch code', exact: true })
    const publish = page.getByRole('button', { name: 'Publish Branch Changes', exact: true })
    await code.waitFor()
    assert.deepEqual(await code.locator('option').evaluateAll(rows => rows.map(row => row.value).filter(Boolean)), BRANCH_CODE_OPTIONS)
    assert.equal(await code.locator('option[value="BRC-B"]').isDisabled(), true)
    assert.equal(await code.locator('option[value=""]').isDisabled(), true)
    await code.evaluate(select => select.add(new Option('Injected invalid code', 'INVALID-INJECTED')))
    await code.selectOption('INVALID-INJECTED')
    await publish.click()
    await page.getByRole('alert').filter({ hasText: 'Choose an allowed branch code.' }).waitFor()
    assert.equal(writes.length, 0)
    await code.selectOption('BRC-D')
    await publish.focus(); await page.keyboard.press('Enter')
    await page.getByRole('alert').filter({ hasText: 'This branch code is already in use.' }).waitFor()
    assert.equal(await code.inputValue(), 'BRC-D')
    assert.deepEqual(await page.evaluate(() => window.ownerBranches.adopted), [])
    assert.equal(writes.length, 1)
    collision = false
    await code.selectOption('BRC-E')
    await publish.focus(); await page.keyboard.press('Enter')
    await page.getByRole('status').filter({ hasText: 'Branch configuration saved.' }).waitFor()
    assert.deepEqual(writes.map(row => row.branch_code), ['BRC-D', 'BRC-E'])
    assert.equal(await code.inputValue(), 'BRC-E')
    assert.equal(await page.evaluate(() => window.ownerBranches.adopted[0].id), 'b1')
    assert.deepEqual(errors, [])
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.close()
    process.stdout.write(`Branch code catalog/rejection/recovery passed at ${width}px\n`)
  }
} finally {
  await browser.close()
}

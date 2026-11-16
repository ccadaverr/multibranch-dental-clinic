import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const { chromium } = await import(pathToFileURL(process.argv[2]).href)
const base = process.argv[3] || 'http://127.0.0.1:5197'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    page.setDefaultTimeout(6000)
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort())
    const dialog = page.getByRole('dialog', { name: 'Notifications' })
    const more = dialog.getByRole('button', { name: 'Load older notifications' })
    const region = dialog.getByRole('region', { name: 'Recent notification history' })
    const open = async () => {
      await page.goto(`${base}/tests/fixtures/notification-history.html`)
      const bell = page.getByRole('button', { name: /^Notifications/ })
      assert.equal(await bell.evaluate(el => getComputedStyle(el).borderTopWidth), '0px')
      assert.equal(await bell.evaluate(el => getComputedStyle(el).outlineStyle), 'none')
      await bell.hover()
      assert.equal(await bell.evaluate(el => getComputedStyle(el).outlineStyle), 'none')
      await bell.focus()
      await page.keyboard.press('Enter')
      await more.waitFor()
      await dialog.getByRole('heading', { name: 'Today', exact: true }).waitFor()
      await dialog.getByRole('heading', { name: 'Yesterday', exact: true }).waitFor()
    }
    await open()
    await page.evaluate(() => {
      const { rows } = window.historyFixture
      for (const row of rows.slice(50)) {
        row.archived = true
        row.archived_at = '2026-11-16T00:05:00+08:00'
      }
    })
    await more.focus()
    await page.keyboard.press('Enter')
    await more.waitFor({ state: 'hidden' })
    assert.equal(await dialog.getByRole('alert').count(), 0)
    assert.equal(await region.locator('li').count(), 50)
    assert.equal(await region.evaluate(el => document.activeElement === el), true)

    await open()
    await page.evaluate(() => { window.historyFixture.failMore = 503 })
    await more.click()
    await dialog.getByRole('alert').first().waitFor()
    assert.equal(await region.locator('li').count(), 50)
    await page.evaluate(() => { window.historyFixture.failMore = false })
    await more.click()
    await page.waitForFunction(() => document.querySelectorAll('.notification-scroll li').length === 100)
    const titles = await region.locator('li b').allTextContents()
    assert.deepEqual(titles.map(title => Number(title.match(/\d+$/)?.[0])), Array.from({ length: 100 }, (_, index) => 120 - index))

    await page.evaluate(() => { window.historyFixture.failMore = 404 })
    await more.click()
    const refresh = dialog.getByRole('button', { name: 'Refresh notifications', exact: true })
    await refresh.focus()
    await page.keyboard.press('Enter')
    await refresh.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.querySelectorAll('.notification-scroll li').length === 50)

    await page.evaluate(() => { window.historyFixture.failMore = 403 })
    await more.click()
    await dialog.getByText('Notifications unavailable', { exact: true }).waitFor()
    assert.equal(await region.locator('li').count(), 0)

    await open()
    await page.evaluate(() => {
      window.historyFixture.dropArchive = true
      window.historyFixture.holdArchive = true
    })
    const archive = dialog.getByRole('button', { name: 'Archive Synthetic notification 120', exact: true })
    await archive.focus()
    await page.keyboard.press('Enter')
    await dialog.getByText('Archiving notification…', { exact: true }).waitFor()
    assert.equal(await archive.isDisabled(), true)
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(() => window.historyFixture.requests.filter(r => r.path.endsWith('/archive')).length), 1)
    await page.evaluate(() => {
      window.historyFixture.holdArchive = false
      window.historyFixture.releaseArchive()
    })
    const retry = dialog.getByRole('button', { name: 'Retry archive' })
    await retry.focus()
    await page.keyboard.press('Enter')
    await retry.waitFor({ state: 'hidden' })
    await dialog.getByRole('button', { name: 'Archived notifications', exact: true }).waitFor()
    assert.equal(await region.evaluate(el => document.activeElement === el), true)
    assert.equal(await archive.count(), 0)
    await dialog.getByRole('button', { name: 'Archived notifications', exact: true }).click()
    await dialog.getByText('Synthetic notification 120', { exact: false }).waitFor()
    assert.deepEqual(await page.evaluate(() => {
      const { rows, requests } = window.historyFixture
      const row = rows[0]
      return [row.read, row.archived, requests.filter(r => r.path === '/api/notifications/synthetic-120/archive').length]
    }), [false, true, 2])
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.close()
    process.stdout.write(`Notification history recovery passed at ${width}px\n`)
  }
} finally {
  await browser.close()
}

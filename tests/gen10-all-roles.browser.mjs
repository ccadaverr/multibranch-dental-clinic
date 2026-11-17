import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const { chromium } = await import(pathToFileURL(process.argv[2]).href)
const base = process.argv[3] || 'http://127.0.0.1:5500'
const browser = await chromium.launch({ channel: 'chrome', headless: true })

try {
  for (const role of ['patient', 'staff', 'dentist', 'owner']) {
    for (const width of [375, 390, 430, 768, 1024, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, timezoneId: 'America/Los_Angeles' })
      try {
        page.setDefaultTimeout(7000)
        await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort())
        await page.goto(base + '/tests/fixtures/notification-history.html?role=' + role)
        const bell = page.getByRole('button', { name: 'Notifications, 120 unread', exact: true })
        await bell.waitFor()
        const style = () => bell.evaluate(el => {
          const css = getComputedStyle(el)
          return [css.borderTopWidth, css.outlineStyle, css.backgroundColor]
        })
        const initial = await style()
        assert.deepEqual(initial.slice(0, 2), ['0px', 'none'])
        await bell.hover()
        const hover = await style()
        assert.deepEqual(hover.slice(0, 2), ['0px', 'none'])
        assert.notEqual(hover[2], initial[2])
        await page.keyboard.press('Tab')
        await bell.focus()
        assert.equal((await style())[1], 'solid')
        await page.keyboard.press('Enter')

        const dialog = page.getByRole('dialog', { name: 'Notifications' })
        await dialog.getByRole('heading', { name: 'Today', exact: true }).waitFor()
        await dialog.getByRole('heading', { name: 'Yesterday', exact: true }).waitFor()
        const panel = await dialog.boundingBox()
        assert.ok(panel.x >= 0 && panel.x + panel.width <= width + 1)
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        assert.equal(await dialog.locator('button [role="button"], button button').count(), 0)
        const more = dialog.getByRole('button', { name: 'Load older notifications' })
        await more.focus()
        await page.keyboard.press('Enter')
        await dialog.getByRole('heading', { name: /Nov 13/ }).waitFor()
        await dialog.locator('li').nth(99).waitFor({ state: 'attached' })
        assert.equal(await dialog.locator('li').count(), 100)
        await more.focus()
        await page.keyboard.press('Enter')
        await dialog.locator('li').nth(119).waitFor({ state: 'attached' })
        const titles = await dialog.locator('li b').allTextContents()
        assert.deepEqual(titles.map(title => Number(title.match(/\d+$/)?.[0])), Array.from({ length: 120 }, (_, index) => 120 - index))

        const archive = dialog.getByRole('button', { name: 'Archive Synthetic notification 120', exact: true })
        await page.evaluate(() => { window.historyFixture.dropArchive = true })
        await archive.focus()
        await page.keyboard.press('Enter')
        const retry = dialog.getByRole('button', { name: 'Retry archive', exact: true })
        await retry.waitFor()
        await retry.focus()
        await page.keyboard.press('Enter')
        await retry.waitFor({ state: 'hidden' })
        await archive.waitFor({ state: 'hidden' })
        assert.equal(await page.evaluate(() => window.historyFixture.requests.filter(r => r.path.endsWith('/archive')).length), 2)
        assert.equal(await page.evaluate(() => window.historyFixture.rows[0].read), false)
        await dialog.getByRole('button', { name: role === 'patient' ? 'Archived' : 'Archived notifications', exact: true }).click()
        await dialog.getByText('Synthetic notification 120', { exact: false }).first().waitFor()
        assert.equal(await archive.count(), 0)
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'hidden' })
        const focused = page.getByRole('button', { name: 'Notifications, 119 unread', exact: true })
        assert.equal(await focused.evaluate(el => document.activeElement === el), true)
        console.log('PASS ' + role + ' ' + width)
      } catch (error) {
        const evidence = await page.evaluate(() => ({
          requests: window.historyFixture?.requests,
          rows: document.querySelectorAll('dialog[open] li, [role="dialog"] li').length,
          alerts: [...document.querySelectorAll('[role="alert"]')].map(item => item.textContent),
        }))
        throw new Error(role + ' ' + width + ': ' + error.message + '\n' + JSON.stringify(evidence), { cause: error })
      } finally {
        await page.close()
      }
    }
  }
} finally {
  await browser.close()
}

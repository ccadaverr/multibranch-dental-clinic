import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const [runner, origin] = process.argv.slice(2)
const { chromium } = await import(pathToFileURL(runner).href)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const width of [375, 390, 430, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(origin + '/tests/fixtures/a13-capacity.html')
    await page.getByRole('heading', { name: 'Live Queue by Branch', exact: true }).waitFor()
    await page.getByText(/No patients matching your filter/).waitFor()
    await page.getByRole('button', { name: 'Load checked-in Visit' }).click()
    const row = name => page.getByRole('row').filter({ hasText: 'Synthetic ' + name })
    await row('arrival').getByText('Waiting', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Load mixed results' }).click()
    await row('called').getByText('Called', { exact: true }).waitFor()
    await row('served').getByText('In Treatment', { exact: true }).waitFor()
    await row('sparse').getByText('Unassigned', { exact: true }).waitFor()
    await row('served').getByRole('button', { name: 'Inspect', exact: true }).press('Enter')
    await page.getByRole('dialog').getByText('In Treatment', { exact: true }).waitFor()
    assert.deepEqual(errors, [])
    console.log(`PASS branch queue at ${width}px`)
    await page.close()
  }
} finally {
  await browser.close()
}

import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const [runner, origin, mode] = process.argv.slice(2)
const { chromium } = await import(pathToFileURL(runner).href)
const browser = await chromium.launch({ channel: 'chrome', headless: true })

try {
  for (const width of mode === 'baseline' ? [390] : [375, 390, 430, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } })
    page.setDefaultTimeout(6500)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(origin + '/tests/fixtures/arc02-archive-scope.synthetic.html')
    await page.waitForFunction(() => window.arc02?.setActor)
    await page.evaluate(() => window.arc02.setActor('owner'))
    const branch = page.getByLabel('Filter archive by branch')
    const search = page.locator('.filter-bar-search input')
    await branch.selectOption('a')
    await search.fill('Synthetic Patient A')
    await page.getByRole('button', { name: 'Prescriptions (1)', exact: true }).click()
    await search.fill('  synthetic patient a  ')
    await page.getByRole('table', { name: 'Archived prescriptions' }).waitFor()

    // Start the comparison with the Owner on an intentionally narrowed result type.
    await search.fill('APT-a')
    const appointment = page.getByRole('button', { name: 'View details for APT-a', exact: true })
    let activations = 0
    if (mode === 'baseline') {
      await page.getByText('No matching prescriptions in the current scope.', { exact: true }).waitFor()
      assert.equal(await appointment.count(), 0)
      await page.getByRole('button', { name: 'All matches (1)', exact: true }).click()
      activations++
    }
    await appointment.press('Enter')
    activations++
    const detail = page.getByRole('dialog')
    await detail.getByText('APT-a', { exact: true }).waitFor()
    assert.equal(await branch.inputValue(), 'a')
    assert.equal(await search.inputValue(), 'APT-a')
    assert.equal(await page.getByRole('button', { name: 'View details for APT-b', exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => window.arc02.audits.at(-1).targetId), 'APT-a')
    await page.keyboard.press('Escape')
    await detail.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)

    // A new query retains the branch boundary even when the reference exists elsewhere.
    await search.fill('APT-b')
    await page.getByText('No matching archive records in this branch scope.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'View details for APT-b', exact: true }).count(), 0)
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ mode, width, queryEdits: 1, activations, branchReselections: 0, exactRecord: 'APT-a' }))
    await page.close()
  }
} finally {
  await browser.close()
}

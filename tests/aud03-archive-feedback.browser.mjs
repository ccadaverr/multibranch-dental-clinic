import assert from 'node:assert/strict'

// Run against the isolated Vite fixture; no API operation is permitted.
export async function runArchiveFeedbackAcceptance(page, base = 'http://127.0.0.1:5185', { diagnostic = false } = {}) {
  const results = [], errors = []
  const onError = error => errors.push(error.message)
  page.on('pageerror', onError)
  const run = async (name, body) => {
    try { await body(); results.push({ name, pass: true }) }
    catch (error) { results.push({ name, pass: false, error: error.message }) }
  }
  const setup = async config => {
    await page.goto(base + '/tests/fixtures/aud03-archive-feedback.html')
    await page.waitForFunction(() => window.aud03?.configure)
    await page.evaluate(value => window.aud03.configure(value), config || {})
  }
  const body = () => page.locator('.archives-page').innerText()
  const retry = () => page.getByRole('button', { name: 'Retry historical appointments', exact: true })
  const complete = result => page.evaluate(value => window.aud03.complete(value), result)
  const noGeneric = async () => assert.equal((await body()).includes('No records found.'), false)
  const isVisible = async locator => { await locator.waitFor({ state: 'visible' }); assert.equal(await locator.isVisible(), true) }
  try {
    for (const width of [375, 430, 768, 1024, 1440]) await run('empty/loading/error/keyboard retry/recovery at ' + width, async () => {
      await page.setViewportSize({ width, height: 900 }); await setup()
      await isVisible(page.getByRole('status').filter({ hasText: 'No historical appointments are available in this archive view.' }))
      await page.evaluate(() => window.aud03.configure({ status: 'loading' }))
      await isVisible(page.getByRole('status').filter({ hasText: 'Loading historical appointments' }))
      assert.equal((await body()).includes('No historical appointments are available'), false)
      await page.evaluate(() => window.aud03.configure({ status: 'error' }))
      await isVisible(page.getByRole('alert').filter({ hasText: 'could not be refreshed' }))
      await retry().focus(); await page.keyboard.press('Enter')
      await isVisible(page.getByRole('button', { name: 'Retrying historical appointments…', exact: true }))
      assert.equal(await page.getByRole('button', { name: 'Retrying historical appointments…', exact: true }).isDisabled(), true)
      await complete({ ok: true, empty: true })
      await isVisible(page.getByRole('status').filter({ hasText: 'No historical appointments are available' }))
      assert.equal(await page.getByRole('alert').count(), 0)
      await page.evaluate(() => window.aud03.configure({ status: 'error', collection: 'rows' }))
      await isVisible(page.getByRole('table', { name: 'Historical appointments' }))
      assert.equal(await page.getByRole('columnheader').count(), 8)
      await page.getByRole('searchbox').focus()
      await page.keyboard.press('Tab')
      assert.equal(await page.getByLabel('Filter archive by branch').evaluate(el => el === document.activeElement), true)
      const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
      assert.ok(size.scroll <= size.width + 1, 'page overflow')
      await noGeneric()
    })
    await run('all three archive categories distinguish empty from unavailable', async () => {
      await setup({ collection: 'unavailable' })
      await isVisible(page.getByText('Historical appointments are unavailable in this view.', { exact: true }))
      await isVisible(retry())
      for (const [key, tab, label] of [
        ['prescriptions', /^Prescriptions/, 'Prescriptions'],
        ['invoices', /^Settled Invoices/, 'Settled financial records'],
      ]) {
        await page.getByRole('button', { name: tab }).click()
        await isVisible(page.getByText('No ' + label.toLowerCase() + ' are available in this archive view.', { exact: true }))
        await page.evaluate(key => window.aud03.patch({ [key]: undefined }), key)
        await isVisible(page.getByText(label + ' are unavailable in this view.', { exact: true }))
        await noGeneric()
      }
    })
    await run('filter misses preserve correct scope feedback', async () => {
      await setup({ collection: 'rows' })
      const search = page.getByRole('searchbox')
      await search.fill('not-a-synthetic-patient')
      await isVisible(page.getByText('No matching historical appointments in the current scope.', { exact: true }))
      assert.equal(await page.getByRole('button', { name: 'Export Archive CSV' }).isDisabled(), true)
      await search.fill('')
      await isVisible(page.getByRole('table', { name: 'Historical appointments' }))
      await noGeneric()
    })
    await run('failed refresh retains labeled rows and read-only detail behavior', async () => {
      await setup({ status: 'error', collection: 'rows' })
      await isVisible(page.getByText('Previously loaded appointments may be out of date.', { exact: true }))
      const details = page.getByRole('button', { name: 'View details for SYN-APT', exact: true })
      await details.focus(); await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog', { name: 'Archived Record Details (Read-Only)', exact: true })
      await isVisible(dialog)
      await page.keyboard.press('Escape')
      assert.equal(await details.evaluate(el => el === document.activeElement), true)
      assert.equal(await page.getByRole('button', { name: 'Retrieve / Restore (unavailable)', exact: true }).isDisabled(), true)
      await isVisible(page.locator('#archive-restore-unavailable'))
    })
    await run('rapid retry actions dispatch once and failed result allows a legitimate retry', async () => {
      await setup({ status: 'error' })
      await retry().evaluate(el => { el.click(); el.click() })
      assert.equal(await page.evaluate(() => window.aud03.refreshes), 1)
      await complete({ ok: false })
      await isVisible(retry())
      await retry().click()
      assert.equal(await page.evaluate(() => window.aud03.refreshes), 2)
      await complete({ ok: true })
      await isVisible(page.getByRole('table', { name: 'Historical appointments' }))
      assert.equal(await page.getByRole('alert').count(), 0)
    })
    await run('thrown read rejection releases pending state and permits recovery', async () => {
      await setup({ status: 'error' }); await retry().click()
      await page.evaluate(() => window.aud03.reject())
      await isVisible(retry())
      assert.equal(await retry().isEnabled(), true)
      await retry().click(); await complete({ ok: true })
      await isVisible(page.getByRole('table', { name: 'Historical appointments' }))
    })
    await run('immediate read rejection does not leave a loading state', async () => {
      await setup({ status: 'error', retry: 'reject-immediately' }); await retry().click()
      await isVisible(retry())
      assert.equal(await retry().isEnabled(), true)
      await isVisible(page.getByRole('alert'))
      await page.evaluate(() => window.aud03.configure({ status: 'error' }))
      await retry().click(); await complete({ ok: true })
      await isVisible(page.getByRole('table', { name: 'Historical appointments' }))
    })
    await run('authorization and financial category restrictions remain unchanged', async () => {
      for (const role of ['owner', 'staff', 'dentist']) {
        await setup({ role, collection: 'rows' })
        await isVisible(page.getByRole('button', { name: 'View details for SYN-APT', exact: true }))
        assert.equal(await page.getByRole('button', { name: /^Settled Invoices/ }).count(), role === 'dentist' ? 0 : 1)
      }
      for (const config of [{ role: 'patient' }, { role: 'staff', scopes: [] }]) {
        await setup({ ...config, status: 'error', collection: 'rows' })
        assert.equal(await retry().count(), 0)
        assert.equal(await page.getByRole('button', { name: 'Export Archive CSV' }).count(), 0)
        assert.equal((await body()).includes('SYN-APT'), false)
      }
    })
    await run('no retry is offered when no refresh API is available', async () => {
      await setup({ status: 'error', retry: false })
      await isVisible(page.getByRole('alert'))
      assert.equal(await retry().count(), 0)
    })
    await run('unmount and ownership replacement ignore obsolete local retry completion', async () => {
      await setup({ status: 'error' }); await retry().click()
      await page.evaluate(() => window.aud03.unmount())
      await complete({ ok: true, superseded: true })
      await isVisible(page.getByText('Fixture unmounted', { exact: true }))
      await setup({ status: 'error' }); await retry().click()
      await page.evaluate(() => window.aud03.setActor('patient'))
      await page.evaluate(() => window.aud03.reject())
      assert.equal((await body()).includes('Archive access unavailable'), true)
      assert.equal(await retry().count(), 0)
    })
    assert.equal(await page.evaluate(() => window.aud03.requests.length), 0, 'fixture must perform no HTTP requests')
    assert.equal(errors.length, 0, 'browser runtime errors: ' + errors.join('; '))
  } finally { page.off('pageerror', onError) }
  const report = { results, errors, passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length }
  if (!diagnostic) assert.equal(report.failed, 0, JSON.stringify(report))
  return report
}

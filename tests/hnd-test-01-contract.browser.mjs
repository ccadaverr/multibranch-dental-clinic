import assert from 'node:assert/strict'

// Authored, NOT RUN. Pass an existing Playwright page with the isolated frontend
// fixture server running. Reuses the unchanged HND-UI-01 synthetic HTTP fixture;
// its stand-in IDs and authenticated-store projection do not prove real API access.
// No new dependencies, real records, accounts or notification delivery are used.
export async function runHndTest01Handovers(page, base = 'http://127.0.0.1:5176') {
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const setup = async ({ role = 'staff', side = 'receiving', mode = 'inbox', ...flags } = {}) => {
    await page.goto(`${base}/tests/fixtures/hnd-ui-01-handovers.html`)
    await page.waitForFunction(() => window.hndUi01?.setRole)
    await page.evaluate(({ role, side, mode, flags }) => {
      const fixture = window.hndUi01
      Object.assign(fixture, flags); fixture.setRole(role); fixture.setSide(side); fixture.setMode(mode)
    }, { role, side, mode, flags })
    if (mode === 'inbox') {
      await page.getByRole('heading', { name: 'Patient handovers', exact: true }).waitFor()
      if (role !== 'owner' && side === 'sending') await page.getByRole('tab', { name: 'All', exact: true }).click()
    }
  }
  const activeDetail = () => page.getByRole('dialog', { name: 'Handover: Synthetic Patient A', exact: true })
  const posts = () => page.evaluate(() => window.hndUi01.requests.map(request => request.path))

  for (const role of ['staff', 'dentist']) {
    await setup({ role, holdMutation: true })
    await page.getByRole('button', { name: 'Open (Auto-accept)', exact: true }).first().focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.hndUi01.release)
    const detail = activeDetail()
    await detail.getByRole('status').filter({ hasText: 'Updating handover status' }).waitFor()
    assert.deepEqual(await posts(), ['/api/handovers/handover-a/acknowledge'])
    assert.equal(await detail.getByRole('button', { name: /^(acknowledge|accept|approve)( handover)?$/i }).count(), 0)
    assert.equal(await detail.getByText('PRIVATE NOTES A', { exact: true }).count(), 1)
    assert.equal(await detail.getByText('PRIVATE NOTES B', { exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => window.hndUi01.feedback.length), 0)
    await page.evaluate(() => window.hndUi01.release())
    await detail.getByRole('status').filter({ hasText: 'Handover acknowledged.' }).waitFor()
    assert.equal((await posts()).length, 1)
    await page.keyboard.press('Escape')
    await detail.waitFor({ state: 'detached' })
    await settle()
    assert.equal(await page.locator('.st-page').evaluate(el => el.contains(document.activeElement)), true)
    await page.getByRole('tab', { name: 'All', exact: true }).click()
    const acknowledgedRow = page.getByRole('listitem').filter({ has: page.getByText('Synthetic Patient A · a', { exact: true }) })
    const openAcknowledged = acknowledgedRow.getByRole('button', { name: 'Open', exact: true })
    await openAcknowledged.waitFor()
    assert.equal(await acknowledgedRow.getByRole('button', { name: 'Open (Auto-accept)', exact: true }).count(), 0)
    await openAcknowledged.focus(); await page.keyboard.press('Space')
    await activeDetail().getByText('PRIVATE NOTES A', { exact: true }).waitFor()
    assert.match(await activeDetail().locator('.au-muted').textContent(), /Acknowledged/)
    assert.equal((await posts()).length, 1)
    await page.keyboard.press('Escape'); await activeDetail().waitFor({ state: 'detached' })
  }

  await setup({ rejectAck: true })
  await page.getByRole('button', { name: 'Open (Auto-accept)', exact: true }).first().click()
  const retry = activeDetail().getByRole('button', { name: 'Retry automatic acknowledgment', exact: true })
  await retry.waitFor()
  assert.equal(await page.evaluate(() => window.hndUi01.feedback.length), 0)
  await page.evaluate(() => { window.hndUi01.rejectAck = false })
  await retry.focus(); await page.keyboard.press('Enter')
  await activeDetail().getByRole('status').filter({ hasText: 'Handover acknowledged.' }).waitFor()
  assert.equal((await posts()).filter(path => path.endsWith('/acknowledge')).length, 2)

  // Opening and dismissing the destructive confirmation must not submit a cancel.
  await setup({ side: 'sending' })
  await page.getByRole('button', { name: 'Open', exact: true }).first().click()
  const senderDetail = activeDetail()
  const cancelAction = senderDetail.getByRole('button', { name: 'Cancel handover', exact: true })
  await cancelAction.click()
  const confirmation = page.getByRole('dialog', { name: 'Cancel patient handover?', exact: true })
  await confirmation.waitFor()
  assert.equal((await posts()).length, 0)
  await page.keyboard.press('Escape'); await confirmation.waitFor({ state: 'detached' })
  assert.equal((await posts()).length, 0)
  await cancelAction.click()
  await confirmation.getByRole('button', { name: 'Cancel handover', exact: true }).click()
  await senderDetail.getByRole('status').filter({ hasText: 'Handover cancelled.' }).waitFor()
  assert.deepEqual(await posts(), ['/api/handovers/handover-a/cancel'])

  await setup({ side: 'sending', rejectCancel: true })
  await page.getByRole('button', { name: 'Open', exact: true }).first().click()
  await activeDetail().getByRole('button', { name: 'Cancel handover', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Cancel handover', exact: true }).click()
  await activeDetail().getByRole('alert').filter({ hasText: 'Cancellation was not confirmed.' }).waitFor()
  assert.equal(await page.evaluate(() => window.hndUi01.feedback.length), 0)
  await activeDetail().getByRole('button', { name: 'Cancel handover', exact: true }).waitFor()

  await setup({ side: 'sending', mode: 'patient' })
  await page.getByRole('button', { name: 'Hand over care', exact: true }).click()
  const form = page.getByRole('form', { name: 'Create Patient handover' })
  await form.getByLabel('From branch', { exact: true }).selectOption('b1')
  await form.getByLabel('To branch', { exact: true }).selectOption('b2')
  await form.getByLabel('Summary', { exact: true }).fill('Synthetic handover summary')
  await form.getByRole('button', { name: 'Send handover', exact: true }).click()
  await page.getByRole('button', { name: 'Hand over care', exact: true }).waitFor()
  assert.deepEqual(await posts(), ['/api/handovers'])
  assert.deepEqual(await page.evaluate(() => window.hndUi01.feedback), [{ message: 'Handover recorded.', tone: 'success' }])
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.getByText(/receiving team was told|recipients? (?:were |was )?notified|notification delivered/i).count(), 0)

  await setup({ role: 'owner' })
  await page.getByText('Synthetic Patient A · a', { exact: true }).waitFor()
  assert.equal(await page.getByText(/PRIVATE NOTES|PRIVATE TITLE|PRIVATE SUMMARY/).count(), 0)
  assert.equal(await page.getByRole('button', { name: /^(Open|Open \(Auto-accept\)|Hand over care|Cancel handover)$/ }).count(), 0)
  assert.equal(await page.getByRole('tab', { name: /To acknowledge/ }).count(), 0)

  // Permission loss hides current content before a delayed mutation completes.
  await setup({ holdMutation: true })
  await page.getByRole('button', { name: 'Open (Auto-accept)', exact: true }).first().click()
  await page.waitForFunction(() => window.hndUi01.release)
  await activeDetail().getByText('PRIVATE NOTES A', { exact: true }).waitFor()
  await page.evaluate(() => window.hndUi01.setActive(false))
  await page.getByRole('status').filter({ hasText: 'active authorized clinic-server session' }).waitFor()
  assert.equal(await page.getByRole('dialog').count(), 0)
  await page.evaluate(() => window.hndUi01.release()); await settle()
  assert.equal(await page.getByText(/PRIVATE NOTES|PRIVATE TITLE|PRIVATE SUMMARY/).count(), 0)
  assert.equal(await page.evaluate(() => window.hndUi01.feedback.length), 0)
}

// Final acceptance also runs the unchanged HND-UI-01 browser scenarios at
// 390/768/1024/1440px, checking long notes/documents, actions, focus and overflow.
// Real authenticated Staff/Dentist/Owner/Patient checks remain a separate gate.

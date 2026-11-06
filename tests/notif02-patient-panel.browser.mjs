import assert from 'node:assert/strict'

// Deferred synthetic-browser checks. Does not certify authenticated backend acceptance.
export async function runNotif02PatientPanel(page, base = 'http://127.0.0.1:5176') {
  let failRead = true, failAll = true, read = false, allRead = false
  const payload = () => ({ data: [
    { id: 'notice-a', title: 'Synthetic appointment', kind: 'appointment_booked', body: 'Synthetic event', read: read || allRead, created_at: '2026-11-06T08:00:00+08:00', target: { page: 'visits', id: 'appointment-a' } },
    { id: 'unknown', title: 'Unknown target', body: null, read: allRead, target: { page: 'unsupported', id: 'x' } },
  ], meta: { unread: allRead ? 0 : read ? 42 : 73 } })
  await page.route('**/sanctum/csrf-cookie', route => route.fulfill({ status: 204 }))
  await page.route('**/api/notifications**', async route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'POST') {
      if (path.endsWith('/read-all')) {
        if (failAll) return route.fulfill({ status: 500, json: {} })
        allRead = true
      } else {
        if (failRead) return route.fulfill({ status: 500, json: {} })
        read = true
      }
    }
    return route.fulfill({ status: 200, json: payload() })
  })
  await page.goto(`${base}/tests/fixtures/notif02-patient-panel.html`)
  await page.waitForFunction(() => window.notif02Snapshot?.unread === 73)
  const bell = page.getByRole('button', { name: 'Open notifications', exact: true })
  await bell.focus(); await page.keyboard.press('Enter')
  const panel = page.getByRole('dialog', { name: 'Notifications' })
  await panel.getByRole('button', { name: 'View update: Synthetic appointment', exact: true }).click()
  await panel.getByRole('alert').waitFor()
  assert.equal(await page.getByTestId('destination').textContent(), '')
  assert.equal(await page.evaluate(() => window.notif02Snapshot.items[0].read), false)
  assert.equal(await page.evaluate(() => window.notif02Snapshot.unread), 73)
  failRead = false
  await panel.getByRole('button', { name: 'Retry mark read', exact: true }).click()
  await page.waitForFunction(() => window.notif02Snapshot.unread === 42)
  await panel.getByRole('button', { name: 'Mark all read', exact: true }).click()
  await panel.getByRole('button', { name: 'Retry mark all read', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.notif02Snapshot.unread), 42)
  failAll = false
  await panel.getByRole('button', { name: 'Retry mark all read', exact: true }).click()
  await page.waitForFunction(() => window.notif02Snapshot.unread === 0)
  assert.equal(await panel.getByRole('button', { name: 'No linked page: Unknown target', exact: true }).isDisabled(), true)
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const close = panel.getByRole('button', { name: 'Close notifications', exact: true })
    await close.focus()
    await page.keyboard.press('Tab')
    assert.equal(await panel.evaluate(el => el.contains(document.activeElement)), true)
    await page.keyboard.press('Shift+Tab')
    assert.equal(await panel.evaluate(el => el.contains(document.activeElement)), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'detached' })
  assert.equal(await bell.evaluate(el => el === document.activeElement), true)
}

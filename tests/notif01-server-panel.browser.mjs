import assert from 'node:assert/strict'

// Deferred controlled-browser cases. API responses are synthetic; not backend acceptance.
export async function runNotif01ServerPanel(page, base = 'http://127.0.0.1:5176') {
  let account = 'a', failList = false, failWrite = false, read = false, holdList = false
  let writes = 0
  const held = []
  let signalHeld
  const firstHeld = new Promise(resolve => { signalHeld = resolve })
  const payload = who => ({ data: [{ id: `notice-${who}`, title: `Account ${who} notice`, body: 'Synthetic event', created_at: '2026-11-06T08:00:00+08:00', read, target: { page: 'handovers', id: 'ambiguous-record-id' } }, { id: `unknown-${who}`, title: 'Unknown destination', body: null, read: true, target: { page: 'unknown', id: 'x' } }], meta: { unread: read ? 0 : 61 } })
  await page.route('**/sanctum/csrf-cookie', route => route.fulfill({ status: 204 }))
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (!path.startsWith('/api/notifications')) return route.fulfill({ status: 200, json: { data: [], meta: { unread: 0 } } })
    if (route.request().method() === 'GET') {
      if (holdList) { held.push({ route, who: account }); signalHeld(); return }
      return route.fulfill(failList ? { status: 503, json: { message: 'Synthetic outage' } } : { status: 200, json: payload(account) })
    }
    writes++
    if (failWrite) return route.fulfill({ status: 403, json: { message: 'Synthetic read refusal' } })
    read = true
    return route.fulfill({ status: 200, json: payload(account) })
  })
  await page.goto(`${base}/tests/fixtures/notif01-server-panel.html`)
  await page.getByRole('button', { name: /Notifications/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Notifications' })
  await dialog.getByText('Account a notice', { exact: true }).waitFor()
  assert.equal(await dialog.getByText('LOCAL DEMO MUST NOT APPEAR').count(), 0)
  assert.equal(await dialog.getByText('61 unread', { exact: true }).count(), 1)
  const unknown = dialog.locator('li').filter({ hasText: 'Unknown destination' })
  assert.equal(await unknown.getByRole('button', { name: 'View update' }).count(), 0)
  failWrite = true
  await dialog.getByRole('button', { name: 'View update' }).click()
  await dialog.getByRole('alert').waitFor()
  assert.equal(await page.getByTestId('destination').textContent(), '')
  await dialog.getByRole('button', { name: 'Retry notifications' }).click()
  await dialog.getByRole('button', { name: 'Mark my notifications read' }).click()
  await dialog.getByRole('alert').waitFor()
  failWrite = false
  await dialog.getByRole('button', { name: 'Retry notifications' }).click()
  await dialog.getByRole('button', { name: 'Mark my notifications read' }).click()
  await dialog.getByText('No unread updates', { exact: true }).waitFor()
  assert.ok(writes >= 2)
  await dialog.getByRole('button', { name: 'View update' }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="destination"]').textContent.includes('handovers'))
  assert.deepEqual(JSON.parse(await page.getByTestId('destination').textContent()), { page: 'handovers', context: null })

  // Delayed A response must not overwrite B after account switching.
  holdList = true
  account = 'old-a'
  await page.evaluate(() => window.notif01Configure({ account: 'old-a' }))
  await firstHeld
  account = 'b'
  holdList = false
  await page.evaluate(() => window.notif01Configure({ account: 'b' }))
  await page.getByRole('button', { name: /Notifications/ }).click()
  await dialog.getByText('Account b notice', { exact: true }).waitFor()
  assert.ok(held.length > 0)
  for (const pending of held.splice(0)) await pending.route.fulfill({ status: 200, json: payload(pending.who) })
  assert.equal(await dialog.getByText('Account old-a notice', { exact: true }).count(), 0)

  failList = true
  account = 'failure'
  await page.evaluate(() => window.notif01Configure({ account: 'failure' }))
  await dialog.getByRole('button', { name: 'Retry notifications' }).waitFor()
  assert.equal(await dialog.getByText('No recent notifications.', { exact: true }).count(), 0)
  failList = false
  await dialog.getByRole('button', { name: 'Retry notifications' }).click()
  await dialog.getByText('Account failure notice', { exact: true }).waitFor()
  await page.evaluate(() => window.notif01Configure({ active: false }))
  assert.equal(await dialog.getByRole('button', { name: 'View update' }).count(), 0)
}

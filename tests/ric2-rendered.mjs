import assert from 'node:assert/strict'

// Run against Vite using Playwright MCP's existing page; no backend or real patient records.
export async function runMessagingAcceptance(page, base = 'http://127.0.0.1:5176') {
  const checks = []
  const queries = []
  const readMarkers = []
  let arrival = 0
  let delivered = 0
  const message = (n, body = `Message ${n}: Please contact the clinic for appointment details. `.repeat(3)) => ({ id: `m${n}`, body,
    sender: { name: n % 2 ? 'Patient Example' : 'Dentist Example', role: n % 2 ? 'Patient' : 'Dentist' }, mine: n % 2 === 0, sent_at: '2026-10-29T10:00:00+08:00' })
  const conversation = n => ({ id: `c${n}`, context: 'Appointment clarification', status: 'Open', revision: 1,
    patient: { id:'synthetic-patient', name: `Patient ${n}`, code: `PAT-${n}` }, branch: { id:'b1', name: 'Test Branch', ref: 'branch-test' }, participants: [{ name: 'Dentist Example', role: 'Dentist' }], unread: 0 })
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    const q = url.searchParams.get('q') || ''
    let body = { data: {}, meta: {} }
    if (url.pathname.endsWith('/read')) readMarkers.push(route.request().postDataJSON()?.up_to)
    if (url.pathname === '/api/conversations') {
      queries.push(q)
      body = { data: q === 'nomatch' ? [] : q ? [conversation(0)] : Array.from({ length: 25 }, (_, n) => conversation(n)), meta: { channels: [], next_cursor: null } }
    } else if (url.pathname.endsWith('/messages')) {
      body = q ? { data: [message(1, 'Old needle <img src=x onerror=alert(1)>')], meta: { next_cursor: null } }
        : url.searchParams.has('after') ? { data: arrival > delivered ? [message(60 + (++delivered))] : [], meta: { more: false } }
        : url.searchParams.has('cursor') ? { data: Array.from({ length: 30 }, (_, n) => message(30 - n)), meta: { next_cursor: null } }
        : { data: Array.from({ length: 30 }, (_, n) => message(60 - n)), meta: { next_cursor: 'm31' } }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.route('**/sanctum/csrf-cookie', route => route.fulfill({ status: 204 }))
  for (const role of ['staff', 'dentist', 'patient']) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      arrival = 0; delivered = 0
      await page.goto(`${base}/tests/fixtures/ric2-messages.html?role=${role}`)
      const first = page.locator('.chat-row').first()
      await first.waitFor()
      const listScrolls = await page.locator('.chat-list ul').evaluate(el => el.scrollHeight > el.clientHeight)
      assert.equal(listScrolls, true, `${role} ${width}: conversation list scrolls`)
      await first.click()
      const log = page.getByRole('log', { name: 'Messages' })
      await log.waitFor()
      const bubbles = await log.evaluate(el => ['mine', 'theirs'].map(kind => {
        const bubble = el.querySelector('.'+kind)
        const bg = getComputedStyle(bubble).backgroundColor.match(/[\d.]+/g).map(Number)
        const luminance = rgb => rgb.slice(0, 3).map(c => { const n = c / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4 }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0)
        return { kind, align: getComputedStyle(bubble).alignSelf, contrast: ['p', 'small'].map(tag => {
          const fg = getComputedStyle(bubble.querySelector(tag)).color.match(/[\d.]+/g).map(Number)
          const alpha = fg[3] ?? 1
          const composite = fg.slice(0, 3).map((c, i) => c * alpha + bg[i] * (1 - alpha))
          const a = luminance(composite), b = luminance(bg)
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
        }) }
      }))
      for (const bubble of bubbles) {
        assert.equal(bubble.align, bubble.kind === 'mine' ? 'flex-end' : 'flex-start')
        assert.ok(bubble.contrast.every(ratio => ratio >= 4.5), `${bubble.kind}: body and metadata contrast pass`)
      }
      assert.equal(await page.getByRole('button', { name: 'Switch dentist', exact: true }).count(), role === 'staff' ? 1 : 0)
      const composer = page.locator('.chat-compose textarea')
      await composer.fill('Keep this draft')
      const before = await log.evaluate(el => { el.scrollTop = 0; return { height: el.scrollHeight, top: el.scrollTop } })
      await page.getByRole('button', { name: 'Load older messages', exact: true }).click()
      await page.waitForFunction(() => document.querySelectorAll('.chat-log .chat-bubble').length === 60)
      await page.waitForTimeout(500)
      const after = await log.evaluate(el => ({ height: el.scrollHeight, top: el.scrollTop }))
      assert.ok(Math.abs(after.top - (before.top + after.height - before.height)) < 80, `${role} ${width}: older page preserves position`)
      if (role === 'staff' && width === 1440) {
        arrival = 1
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
        await page.getByRole('button', { name: 'New messages below' }).waitFor()
        const position = await log.evaluate(el => el.scrollTop)
        assert.ok(Math.abs(position - after.top) < 5, 'incoming message does not pull reader out of history')
        assert.equal(readMarkers.includes('m61'), false, 'offscreen arrival is not marked read')
        await page.getByRole('button', { name: 'New messages below' }).click()
        await page.waitForTimeout(100)
        assert.equal(readMarkers.includes('m61'), true, 'opening the bottom advances the read marker')
        arrival = 2
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
        await page.waitForFunction(() => document.querySelectorAll('.chat-log .chat-bubble').length === 62)
        assert.ok(await log.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 60), 'incoming message follows bottom reader')
      }
      if (width === 390) await page.getByRole('button', { name: 'Back to conversations' }).click()
      const search = page.getByRole('searchbox', { name: 'Search messages or contacts' })
      const beforeQueries = queries.length
      await search.pressSequentially('needle', { delay: 20 })
      await page.waitForFunction(() => document.querySelectorAll('.chat-row').length === 1)
      assert.equal(queries.slice(beforeQueries).filter(q => q === 'needle').length, 1, 'keystrokes produce one debounced search')
      if (width === 390) {
        await page.waitForFunction(() => document.querySelectorAll('.chat-row').length === 1)
        await page.locator('.chat-row').first().click()
      }
      const results = page.getByRole('region', { name: 'Matching messages' })
      await results.getByText('Old needle', { exact: false }).waitFor()
      assert.equal(await results.locator('mark').count(), 1)
      assert.equal(await results.locator('img, script').count(), 0, 'message markup stays inert')
      assert.equal(await composer.inputValue(), 'Keep this draft')
      if (width === 390) await page.getByRole('button', { name: 'Back to conversations' }).click()
      await search.fill('nomatch')
      // On phone the list is intentionally hidden while a thread is open.
      await page.waitForFunction(() => document.body.textContent.includes('No matching messages or contacts'))
      if (width !== 390) assert.equal(await composer.inputValue(), 'Keep this draft', 'selection and draft survive filtered-out conversation')
      await search.fill('')
      await page.waitForFunction(() => !document.querySelector('.chat-search-results'))
      if (width === 390) {
        await page.locator('.chat-row').first().waitFor()
        await page.locator('.chat-row').first().click()
      }
      assert.equal(await composer.inputValue(), 'Keep this draft')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no page-level overflow')
      checks.push(`${role} ${width}: scroll, switch permission, debounce, old match, safe highlight, empty state, draft/selection`)
    }
  }
  return checks
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// CAL-02: authored November 6, 2026; execution deliberately deferred.
// Ordinary node tests below cover SSR/access/source contracts. Populated rendering,
// request races and focus require the opt-in browser cases, not loading-only SSR.
// Later, with a separately started local Vite server and existing Playwright:
// CAL02_BROWSER_BASE_URL=http://127.0.0.1:5176 node --test tests/cal02-calendar-scope.test.js
// No server is started and no dependency is installed by this file.
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const source = read('src/pages/StaffDayCalendar.jsx')
let componentPromise
function component() {
  componentPromise ??= (async () => {
    const require = createRequire(import.meta.url)
    const bundle = await build({
      stdin: { contents: "export { StaffDayCalendar } from './src/pages/StaffDayCalendar.jsx'; export { setClockSource } from './src/clock.js'", resolveDir: process.cwd() },
      bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.css': 'empty' },
      plugins: [{ name: 'cal02-shared-react', setup(builder) {
        builder.onResolve({ filter: /^react$/ }, () => ({ path: pathToFileURL(require.resolve('react')).href, external: true }))
      } }],
    })
    const ui = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
    ui.setClockSource(() => new Date('2026-11-06T02:00:00Z'))
    return ui.StaffDayCalendar
  })()
  return componentPromise
}
async function render(session) {
  return renderToStaticMarkup(React.createElement(await component(), { store: {
    session, state: { branches: [{ id: 'a', name: 'Synthetic A' }, { id: 'b', name: 'Synthetic B' }], appointments: [] },
  } }))
}

test('CAL-02 authenticated Staff with empty or absent scopes fails closed despite assigned Branch A', async () => {
  for (const branchScopes of [[], undefined]) {
    const html = await render({ serverUserId: 'synthetic-staff', role: 'staff', branchId: 'a', branchScopes })
    assert.match(html, /Calendar access unavailable/)
    assert.doesNotMatch(html, /role="grid"|No appointments this month|Create appointment/)
  }
})

test('CAL-02 Owner retains clinic-wide first paint with no Staff scopes', async () => {
  const html = await render({ serverUserId: 'synthetic-owner', role: 'owner', branchScopes: [] })
  assert.match(html, /Loading appointments|Previous month|Next month/)
  assert.match(html, /Synthetic A/)
  assert.match(html, /Synthetic B/)
  assert.doesNotMatch(html, /Calendar access unavailable/)
})

test('CAL-02 sign-out has a truthful offline state; unauthorized roles and inactive accounts have no calendar', async () => {
  assert.match(await render(null), /isn’t available in the offline demo/)
  for (const session of [
    { serverUserId: 'synthetic', role: 'patient', branchScopes: ['a'] },
    { serverUserId: 'synthetic', role: 'dentist', branchScopes: ['a'] },
    { serverUserId: 'synthetic', role: 'staff', branchScopes: ['a'], active: false },
  ]) assert.doesNotMatch(await render(session), /role="grid"|Create appointment/)
})

test('CAL-02 source keeps canonical display names and existing booking/attendance authority', () => {
  assert.doesNotMatch(source, /patientName\(a\.patientName\)/)
  assert.match(source, /const name = appointmentName\(a\)/)
  assert.match(source, /store\.appointmentFlow\.cancel\(a, commandKey\(\)\)/)
  assert.match(source, /store\.appointmentFlow\.noShow\(a, commandKey\(\)\)/)
  assert.match(source, /<AppointmentForm/)
  assert.doesNotMatch(source, /setAppointments|setQueue|setCheckIns|Math\.random|\.status\s*=/)
})

// Uses the repository's real component, real loader, real API adapter and native
// dialogs. The uniquely named fixture intercepts fetch before mounting and refuses
// every write. A supplied Page also permits running these cases from an existing
// browser tool without launching a browser from the ordinary Node suite.
export async function runCal02CalendarScope(page, base, runCase = async (_name, body) => body()) {
  const errors = []
  const onError = error => errors.push(error.message)
  page.on('pageerror', onError)
  const avatar = () => page.locator('.daycal-avatar-badge:not(.daycal-more-avatar)')
  const names = () => avatar().evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))
  const ready = async () => {
    await avatar().first().waitFor()
    await page.waitForFunction(() => !document.body.textContent.includes('Loading appointments'))
  }
  const fresh = async (query = '') => {
    errors.length = 0
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`${base}/tests/fixtures/cal02-calendar-scope.synthetic.html${query ? `?${query}` : ''}`)
    await page.waitForFunction(() => typeof window.cal02?.setSession === 'function')
  }
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const assertHealthy = () => assert.deepEqual(errors, [], 'no populated-component render errors')

  try {
    await runCase('1. populated month renders appointment avatars without crashing', async () => {
      await fresh('all'); await ready()
      assert.equal(await avatar().count(), 2)
      assert.match((await names()).join('|'), /Synthetic Patient A/)
      assertHealthy()
    })

    await runCase('2. absent/blank Patient name and optional display fields have neutral fallbacks', async () => {
      for (const query of ['missing', 'blank']) {
        await fresh(query); await ready()
        const badge = avatar().first()
        assert.match(await badge.getAttribute('aria-label'), /Patient name unavailable/)
        assert.equal(await badge.innerText(), '?')
        if (query === 'missing') {
          const day = page.locator('[data-calendar-date="2026-11-06"]')
          if (await day.getAttribute('aria-expanded') !== 'true') await day.click()
          assert.equal(await page.locator('.daycal-service-name').innerText(), 'Service unavailable')
          assert.equal(await page.locator('.daycal-dentist-name').innerText(), 'Dentist name unavailable')
          assert.equal(await page.locator('.daycal-service-name').getByText('Consultation', { exact: true }).count(), 0)
          await badge.click()
          const dialog = page.getByRole('dialog', { name: 'Appointment details', exact: true })
          await dialog.waitFor()
          assert.match(await dialog.innerText(), /Patient name unavailable/)
        }
        assertHealthy()
      }
    })

    await runCase('3. valid initials, tooltips, labels and exact appointment identity survive', async () => {
      await fresh(); await ready()
      const badge = avatar().first()
      assert.equal(await badge.innerText(), 'SP')
      assert.equal(await badge.getAttribute('title'), 'Synthetic Patient A · 9:00 AM · Synthetic service')
      assert.equal(await badge.getAttribute('aria-label'), 'View appointment details: Synthetic Patient A · 9:00 AM · Synthetic service')
      assert.equal(await badge.getAttribute('aria-haspopup'), 'dialog')
      await badge.click()
      await page.getByRole('dialog', { name: 'Appointment details', exact: true }).waitFor()
      assert.equal(await page.locator('.appt-detail-code-badge').innerText(), 'SYNTHETIC-A')
      assertHealthy()
    })

    await runCase('4. Staff scope A suppresses B rows and summaries even from an overbroad response', async () => {
      await fresh(); await ready()
      assert.deepEqual(await names(), ['View appointment details: Synthetic Patient A · 9:00 AM · Synthetic service'])
      assert.equal(await page.getByText('1 appointment this month', { exact: true }).count(), 1)
      assert.doesNotMatch(await page.locator('main').innerText(), /Synthetic Patient B/)
      assert.equal(await page.getByRole('combobox', { name: 'Branch', exact: true }).count(), 0)
    })

    await runCase('5. empty/absent Staff scopes never borrow the operational assignment or request rows', async () => {
      for (const query of ['empty', 'absent']) {
        await fresh(query)
        await page.getByText('Calendar access unavailable', { exact: true }).waitFor()
        await settle()
        assert.equal(await avatar().count(), 0)
        assert.equal(await page.getByRole('grid').count(), 0)
        assert.deepEqual(await page.evaluate(() => window.cal02.reads), [])
        assert.doesNotMatch(await page.locator('main').innerText(), /No appointments this month/)
      }
    })

    await runCase('6. A→B→A creates a fresh lifetime for lists and capacity; old A never revives', async () => {
      await fresh('hold')
      await page.waitForFunction(() => window.cal02.listRequests.length === 1 && window.cal02.loadRequests.length === 1)
      await page.evaluate(() => window.cal02.setSession({ branchScopes: ['b'] }))
      await page.waitForFunction(() => window.cal02.listRequests.length === 2 && window.cal02.loadRequests.length === 2)
      await page.evaluate(() => window.cal02.setSession({ branchScopes: ['a'] }))
      await page.waitForFunction(() => window.cal02.listRequests.length === 3 && window.cal02.loadRequests.length === 3)
      assert.equal(await avatar().count(), 0)
      await page.evaluate(() => {
        window.cal02.listRequests[2].payload.data[0].patient.name = 'Fresh lifetime A'
        window.cal02.listRequests[2].release(); window.cal02.loadRequests[2].release()
      })
      await page.getByRole('button', { name: /View appointment details: Fresh lifetime A/ }).waitFor()
      await page.evaluate(() => {
        for (const index of [1, 0]) {
          window.cal02.listRequests[index].payload.data[0].patient.name = 'OBSOLETE A'
          window.cal02.loadRequests[index].payload.data.capacity_note = 'OBSOLETE CAPACITY'
          window.cal02.listRequests[index].release(); window.cal02.loadRequests[index].release()
        }
      })
      await settle()
      assert.match((await names()).join('|'), /Fresh lifetime A/)
      assert.doesNotMatch(await page.locator('main').innerText(), /OBSOLETE/)
      assertHealthy()
    })

    await runCase('7. revocation rejects a pending background refresh and cannot resurrect old permissions', async () => {
      await fresh(); await ready()
      await page.evaluate(() => { window.cal02.holdLists = true })
      await page.getByRole('button', { name: 'Refresh', exact: true }).click()
      await page.waitForFunction(() => window.cal02.listRequests.length === 2)
      await page.evaluate(() => window.cal02.setSession({ branchScopes: [] }))
      await page.getByText('Calendar access unavailable', { exact: true }).waitFor()
      await page.evaluate(() => {
        window.cal02.listRequests[1].release()
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await settle()
      assert.equal(await avatar().count(), 0)
      assert.equal(await page.evaluate(() => window.cal02.listRequests.length), 2)
      await page.evaluate(() => window.cal02.setSession({ branchScopes: ['a'] }))
      await page.waitForFunction(() => window.cal02.listRequests.length === 3)
      assert.equal(await avatar().count(), 0, 'regrant waits for a fresh load, not a cached A response')
      await page.evaluate(() => window.cal02.listRequests[2].release())
      await ready()
    })

    await runCase('8. losing selected branch access closes details/confirmation and suppresses late detail resolution', async () => {
      await fresh('all'); await ready()
      await page.getByRole('combobox', { name: 'Branch', exact: true }).selectOption('a')
      await avatar().first().click()
      await page.getByRole('dialog', { name: 'Appointment details', exact: true }).waitFor()
      await page.evaluate(() => window.cal02.setSession({ branchScopes: ['b'] }))
      await ready()
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.match((await names()).join('|'), /Synthetic Patient B/)
      assert.doesNotMatch((await names()).join('|'), /Synthetic Patient A/)
      // A pending detail fetch must not open a cancellation form in the next scope.
      await page.evaluate(() => { window.cal02.holdDetails = true })
      await avatar().first().click()
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.waitForFunction(() => window.cal02.detailRequests.length === 1)
      await page.evaluate(() => window.cal02.setSession({ branchScopes: ['a'] }))
      await ready()
      await page.evaluate(() => window.cal02.detailRequests[0].release())
      await settle()
      assert.equal(await page.getByRole('dialog').count(), 0)
      // Also close an already-resolved confirmation on revocation.
      await page.evaluate(() => { window.cal02.holdDetails = false })
      await avatar().first().click()
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.getByRole('dialog', { name: 'Cancel this appointment?', exact: true }).waitFor()
      await page.evaluate(() => window.cal02.setSession({ branchScopes: [] }))
      assert.equal(await page.getByRole('dialog').count(), 0)
      assertHealthy()
    })

    await runCase('9. session replacement during a pending load rejects prior user rows and capacity', async () => {
      await fresh('hold')
      await page.waitForFunction(() => window.cal02.listRequests.length === 1 && window.cal02.loadRequests.length === 1)
      await page.evaluate(() => window.cal02.setSession({ serverUserId: 'synthetic-replacement' }))
      await page.waitForFunction(() => window.cal02.listRequests.length === 2 && window.cal02.loadRequests.length === 2)
      await page.evaluate(() => {
        window.cal02.listRequests[1].payload.data[0].patient.name = 'Current session A'
        window.cal02.listRequests[1].release(); window.cal02.loadRequests[1].release()
      })
      await ready()
      await page.evaluate(() => {
        window.cal02.listRequests[0].payload.data[0].patient.name = 'PREVIOUS SESSION'
        window.cal02.loadRequests[0].payload.data.capacity_note = 'PREVIOUS CAPACITY'
        window.cal02.listRequests[0].release(); window.cal02.loadRequests[0].release()
      })
      await settle()
      assert.match((await names()).join('|'), /Current session A/)
      assert.doesNotMatch(await page.locator('main').innerText(), /PREVIOUS/)
      await page.evaluate(() => window.cal02.setSession({ serverUserId: null }))
      await page.getByText('Clinic server required', { exact: true }).waitFor()
      assert.equal(await avatar().count(), 0)
      assertHealthy()
    })

    await runCase('10. Owner sees all branches with zero scopes and may filter clinic-wide data', async () => {
      await fresh('owner'); await ready()
      assert.equal(await avatar().count(), 2)
      await page.getByRole('combobox', { name: 'Branch', exact: true }).selectOption('b')
      assert.equal(await avatar().count(), 1)
      assert.match((await names()).join('|'), /Synthetic Patient B/)
      await page.getByRole('combobox', { name: 'Branch', exact: true }).selectOption('all')
      assert.equal(await avatar().count(), 2)
      const requests = await page.evaluate(() => window.cal02.listRequests.length)
      await page.evaluate(() => window.cal02.setSession({ branchScopes: ['b', 'a'] }))
      await settle()
      assert.equal(await page.evaluate(() => window.cal02.listRequests.length), requests, 'Staff scopes do not restrict or reset Owner')
    })

    await runCase('11. CAL-01 keyboard, focus, month navigation and touch targets remain', async () => {
      await fresh('all&many'); await ready()
      const day = page.locator('[data-calendar-date="2026-11-06"]')
      if (await day.getAttribute('aria-expanded') === 'true') await day.click()
      await day.focus(); await page.keyboard.press('Enter')
      assert.equal(await day.getAttribute('aria-expanded'), 'true')
      await page.keyboard.press('Space')
      assert.equal(await day.getAttribute('aria-expanded'), 'false')
      const badge = avatar().first()
      await badge.focus(); await page.keyboard.press('Enter')
      await page.getByRole('dialog', { name: 'Appointment details', exact: true }).waitFor()
      assert.equal(await day.getAttribute('aria-expanded'), 'false', 'avatar does not toggle the day')
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true)
      await page.keyboard.press('Escape')
      assert.equal(await badge.evaluate(node => node === document.activeElement), true)
      const more = page.locator('.daycal-more-avatar')
      await more.focus(); await page.keyboard.press('Space')
      assert.equal(await day.getAttribute('aria-expanded'), 'true')
      assert.equal(await page.locator('.daycal-expanded-card').count(), 4)
      await page.locator('#daycal-day-details').getByRole('button', { name: 'Close', exact: true }).click()
      assert.equal(await day.evaluate(node => node === document.activeElement), true)
      await page.getByRole('button', { name: /^View Today/ }).click()
      assert.equal(await day.getAttribute('aria-expanded'), 'true')
      assert.equal(await day.evaluate(node => node === document.activeElement), true)
      const next = page.getByRole('button', { name: 'Next month', exact: true })
      await next.focus(); await page.keyboard.press('Enter')
      await page.waitForFunction(() => document.querySelector('#daycal-heading').textContent.includes('December 2026'))
      assert.equal(await next.evaluate(node => node === document.activeElement), true)
      await page.getByRole('button', { name: 'Today', exact: true }).click()
      await ready()
      assert.equal(await day.evaluate(node => node === document.activeElement), true)
      const adjacent = page.locator('.daycal-cell.is-outside [data-calendar-date]').first()
      const adjacentDate = await adjacent.getAttribute('data-calendar-date')
      await adjacent.focus(); await page.keyboard.press('Enter')
      await page.waitForFunction(value => document.activeElement?.dataset.calendarDate === value, adjacentDate)
      // Equal membership in a different order is not an authorization change.
      const requests = await page.evaluate(() => window.cal02.listRequests.length)
      await page.evaluate(() => window.cal02.setSession({ branchScopes: ['b', 'a', 'a'] }))
      await settle()
      assert.equal(await page.evaluate(() => window.cal02.listRequests.length), requests)
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.calendarDate), adjacentDate)
      for (const width of [375, 430, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 })
        const size = await page.locator('.daycal-daylink').first().boundingBox()
        // Preserve the existing date sizes (28px at <=768px, 36px otherwise).
        // Toolbar controls retain 44px; CAL-02 does not redesign calendar targets.
        const minimum = width <= 768 ? 28 : 36
        assert.ok(size.width >= minimum && size.height >= minimum, `existing date target at ${width}px`)
        const toolbar = await page.getByRole('button', { name: 'Next month', exact: true }).boundingBox()
        assert.ok(toolbar.height >= 44, `existing toolbar target at ${width}px`)
      }
      assertHealthy()
    })

    await runCase('12. reading/filtering/navigation never fabricates attendance or scheduling writes', async () => {
      await fresh('all'); await ready()
      const before = await page.evaluate(() => structuredClone(window.cal02.rows))
      await page.getByRole('combobox', { name: 'Branch', exact: true }).selectOption('b')
      await avatar().first().click()
      const dialog = page.getByRole('dialog', { name: 'Appointment details', exact: true })
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await page.getByRole('button', { name: 'Next month', exact: true }).click()
      await settle()
      assert.deepEqual(await page.evaluate(() => window.cal02.rows), before)
      assert.deepEqual(await page.evaluate(() => window.cal02.commands), [])
      assert.equal(await page.evaluate(() => window.cal02.reads.every(read => read.method === 'GET')), true)
      assert.equal(await page.getByText('No-show', { exact: true }).count(), 0)
      assertHealthy()
    })
  } finally {
    page.off('pageerror', onError)
  }
}

test('CAL-02 populated browser/scope regressions (explicit local opt-in)', {
  skip: !process.env.CAL02_BROWSER_BASE_URL,
  timeout: 180000,
}, async t => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    await runCal02CalendarScope(page, process.env.CAL02_BROWSER_BASE_URL, (name, body) => t.test(name, body))
  } finally {
    await browser.close()
  }
})

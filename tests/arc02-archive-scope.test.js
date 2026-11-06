import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Authored, NOT EXECUTED. SSR covers observable access/projection output; lifecycle,
// detail and CSV cases need the explicitly enabled browser group below.
// Later: ARC02_BROWSER_BASE_URL=http://127.0.0.1:5176 node --test tests/arc02-archive-scope.test.js
// Requires a separately started Vite server and existing dependencies; installs nothing.
let componentPromise
const component = () => componentPromise ??= (async () => {
  const require = createRequire(import.meta.url)
  const bundle = await build({
    stdin: { contents: "export { ArchivesPage } from './src/pages/ArchivesPage.jsx'; export { setClockSource } from './src/clock.js'", resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.css': 'empty' },
    plugins: [{ name: 'arc02-react', setup(b) { b.onResolve({ filter: /^react$/ }, () => ({ path: pathToFileURL(require.resolve('react')).href, external: true })) } }],
  })
  const ui = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
  ui.setClockSource(() => new Date('2026-11-06T02:00:00Z'))
  return ui.ArchivesPage
})()
function fixture(role = 'staff', scopes = ['a']) {
  const row = id => ({ id: `appt-${id}`, code: `APT-${id}`, patientId: `patient-${id}`, patientName: `Synthetic Patient ${id}`, date: '2026-11-05', status: 'Confirmed', branchId: id, branchName: `Branch ${id}`, dentistId: 'dentist' })
  return {
    session: { userId: role, serverUserId: `server-${role}`, role, active: true, branchId: 'a', branchScopes: scopes, dentistId: 'dentist' },
    state: {
      users: [{ id: role, personId: 'person', role: role === 'owner' ? 'Owner / Admin' : role === 'dentist' ? 'Dentist' : 'Staff', status: 'Active', branchId: 'a', permissions: ['all'] }],
      persons: [{ id: 'person' }], staff: [{ userId: role, personId: 'person', branchId: 'a' }],
      dentists: [{ id: 'dentist', userId: role, personId: 'person', branchIds: ['a','b'], branches: ['Branch a','Branch b'] }],
      branches: ['a','b'].map(id => ({ id, name: `Branch ${id}` })), patients: [], appointments: ['a','b'].map(row),
      prescriptions: ['a','b'].map(id => ({ ...row(id), id: `rx-${id}`, number: `RX-${id}`, lines: [{ medicine: 'PRIVATE MEDICINE' }] })),
      invoices: ['a','b'].map(id => ({ ...row(id), id: `invoice-${id}`, status: 'Paid', invoiceNumber: `INV-${id}`, receiptNumber: `RCPT-${id}` })),
    },
    actions: {}, toast() {},
  }
}
const render = async (store, props = {}) => renderToStaticMarkup(React.createElement(await component(), { store, role: store.session.role, ...props }))

test('ARC-02 1: one Staff scope renders only that branch’s historical rows and category counts', async () => {
  const html = await render(fixture())
  assert.match(html, /APT-a/); assert.doesNotMatch(html, /APT-b/)
  assert.match(html, /Historical Appointments \(1\)/)
  assert.match(html, /Prescriptions \(1\)/)
  assert.match(html, /Settled Invoices &amp; Receipts \(1\)/)
})
test('ARC-02 2: multiple Staff scopes retain all permitted rows', async () => {
  const html = await render(fixture('staff', ['a','b']))
  assert.match(html, /APT-a/); assert.match(html, /APT-b/)
  assert.match(html, /Historical Appointments \(2\)/)
})
test('ARC-02 3: zero Staff scopes reveal no archive records or controls', async () => {
  const html = await render(fixture('staff', []))
  assert.match(html, /No authorized archive branches/)
  assert.doesNotMatch(html, /APT-a|APT-b|Export Archive CSV|View details|<table/)
})
test('ARC-02 4: operational assignment, branch name and activeBranch never replace server scopes', async () => {
  for (const scopes of [[], undefined]) {
    const store = fixture('staff', scopes); store.session.branchScopes = scopes; store.session.branch = 'Branch a'
    const html = await render(store, { activeBranch: 'Branch a' })
    assert.match(html, /No authorized archive branches/)
    assert.doesNotMatch(html, /APT-a|APT-b/)
  }
})
test('ARC-02 11: Staff without the existing billing permission has no financial archive', async () => {
  const store = fixture(); store.state.users[0].permissions = ['appointments']
  const html = await render(store)
  assert.match(html, /APT-a/)
  assert.doesNotMatch(html, /Settled Invoices|INV-a|RCPT-a|financials/)
})
test('ARC-02 12: Dentist retains existing encounter scope and excludes financial records', async () => {
  const html = await render(fixture('dentist', ['a','b']))
  assert.match(html, /APT-a/)
  assert.doesNotMatch(html, /Settled Invoices|INV-a|INV-b|RCPT-a/)
})
test('ARC-02 13: Owner keeps clinic-wide archive oversight with no Staff scopes', async () => {
  const html = await render(fixture('owner', []))
  assert.match(html, /APT-a/); assert.match(html, /APT-b/)
  assert.match(html, /Settled Invoices &amp; Receipts \(2\)/)
  assert.doesNotMatch(html, /No authorized archive branches|PRIVATE MEDICINE/)
})
test('ARC-02 14: missing IDs never gain Staff access by name; missing display names do not invent a branch', async () => {
  const store = fixture()
  store.state.appointments.push({ ...store.state.appointments[0], id: 'name-only', code: 'NAME-ONLY', branchId: null, branch: 'Branch a' })
  store.state.appointments.push({ ...store.state.appointments[0], id: 'contradiction', code: 'CONTRADICTORY', branch: { id: 'b', name: 'Branch a' } })
  const html = await render(store)
  assert.doesNotMatch(html, /NAME-ONLY|CONTRADICTORY/)
  store.state.branches = []; store.state.appointments = [{ ...store.state.appointments[0], branchName: undefined }]
  const unnamed = await render(store)
  assert.match(unnamed, /APT-a/); assert.match(unnamed, /Branch unavailable/)
  assert.doesNotMatch(unnamed, />Main<|Dr\. Reyes/)
})
test('ARC-02 15: empty, no-access and unavailable projections have distinct messages', async () => {
  const store = fixture(); store.state.appointments = []
  const empty = await render(store)
  assert.match(empty, /No historical appointments are available in this archive view/)
  assert.doesNotMatch(empty, /No authorized archive branches/)
  store.state.appointments = undefined
  assert.match(await render(store), /Historical appointments are unavailable in this view/)
  store.session.branchScopes = []
  assert.match(await render(store), /No authorized archive branches/)
})
test('ARC-02 16: ARC-01 restore remains disabled and linked to its keyboard-focusable explanation', async () => {
  const html = await render(fixture())
  const button = html.match(/<button[^>]*aria-describedby="archive-restore-unavailable"[^>]*>[\s\S]*?<\/button>/)?.[0]
  assert.ok(button); assert.match(button, /\bdisabled/); assert.match(button, /Retrieve \/ Restore \(unavailable\)/)
  assert.match(html, /id="archive-restore-unavailable" tabindex="0"/)
  assert.match(html, /Viewing a record does not restore it/)
})
test('ARC-02 18: historical wording includes past Confirmed and future Cancelled appointments without claiming completed care', async () => {
  const store = fixture()
  store.state.appointments.push({ ...store.state.appointments[0], id: 'cancelled', code: 'FUTURE-CANCELLED', date: '2026-12-01', status: 'Cancelled' })
  const html = await render(store)
  assert.match(html, /APT-a/); assert.match(html, /FUTURE-CANCELLED/)
  assert.match(html, /inclusion here does not confirm completed care/)
  assert.doesNotMatch(html, /Completed Visits|Historical Completed Encounters/)
})

export async function runArc02ArchiveScope(page, base, runCase = async (_name, body) => body()) {
  const setup = async () => {
    await page.goto(`${base}/tests/fixtures/arc02-archive-scope.synthetic.html`)
    await page.waitForFunction(() => window.arc02?.setSession)
    await page.getByRole('button', { name: 'View details for APT-a', exact: true }).waitFor()
  }
  const detail = () => page.getByRole('dialog', { name: 'Archived Record Details (Read-Only)', exact: true })
  const setScopes = scopes => page.evaluate(value => window.arc02.setSession({ branchScopes: value }), scopes)
  const text = () => page.locator('.archives-page').innerText()
  const exportText = async () => {
    const count = await page.evaluate(() => window.arc02.downloads.length)
    await page.getByRole('button', { name: 'Export Archive CSV', exact: true }).click()
    await page.waitForFunction(value => window.arc02.downloads.length > value, count)
    return page.evaluate(() => window.arc02.downloads.at(-1).blob.text())
  }
  await runCase('ARC-02 5: A→B replaces records across all archive categories', async () => {
    await setup(); await setScopes(['b'])
    assert.doesNotMatch(await text(), /Synthetic Patient A|APT-a/)
    await page.getByRole('button', { name: 'View details for APT-b', exact: true }).waitFor()
    for (const tab of [/^Prescriptions/, /^Settled Invoices/]) {
      await page.getByRole('button', { name: tab }).click()
      assert.match(await text(), /Synthetic Patient B/); assert.doesNotMatch(await text(), /Synthetic Patient A/)
    }
  })
  await runCase('ARC-02 6: A→B→A creates a fresh selection/filter lifetime', async () => {
    await setup()
    await page.getByRole('button', { name: 'View details for APT-a', exact: true }).click(); await detail().waitFor()
    await setScopes(['b']); await setScopes(['a'])
    assert.equal(await detail().count(), 0)
    assert.match(await text(), /APT-a/); assert.doesNotMatch(await text(), /APT-b/)
  })
  await runCase('ARC-02 7: same-account sign-out/relogin with new scopes never restores old detail', async () => {
    await setup()
    await page.getByRole('button', { name: 'View details for APT-a', exact: true }).click(); await detail().waitFor()
    await page.evaluate(() => window.arc02.logout())
    assert.equal(await detail().count(), 0)
    assert.match(await text(), /Archive access unavailable/)
    await page.evaluate(() => window.arc02.setActor('staff', ['b']))
    assert.doesNotMatch(await text(), /APT-a|Synthetic Patient A/)
    assert.equal(await detail().count(), 0)
  })
  await runCase('ARC-02 8: an unauthorized selected branch is reconciled before rendering/export', async () => {
    await setup(); await setScopes(['a','b'])
    await page.getByLabel('Filter archive by branch').selectOption('Synthetic Branch a')
    await setScopes(['b'])
    assert.equal(await page.getByLabel('Filter archive by branch').inputValue(), 'Synthetic Branch b')
    const csv = await exportText()
    assert.match(csv, /APT-b/); assert.doesNotMatch(csv, /APT-a/)
  })
  await runCase('ARC-02 9: losing record access suppresses its content and controls immediately', async () => {
    await setup()
    await page.getByRole('button', { name: 'View details for APT-a', exact: true }).click(); await detail().waitFor()
    await setScopes([])
    assert.equal(await detail().count(), 0)
    assert.equal(await page.getByRole('button', { name: /View details/ }).count(), 0)
    assert.match(await text(), /No authorized archive branches/)
    assert.doesNotMatch(await text(), /Synthetic Patient A|Synthetic Patient B/)
  })
  await runCase('ARC-02 10: CSV always uses current authorized, searched and branch-filtered rows', async () => {
    await setup(); await setScopes(['a','b'])
    await page.getByPlaceholder('Search by patient, code, number, dentist…').fill('APT-b')
    const searched = await exportText()
    assert.match(searched, /APT-b/); assert.doesNotMatch(searched, /APT-a/)
    await setScopes(['b'])
    for (const tab of [/^Historical Appointments/, /^Prescriptions/, /^Settled Invoices/]) {
      await page.getByRole('button', { name: tab }).click()
      const csv = await exportText()
      assert.match(csv, /Synthetic Patient B/); assert.doesNotMatch(csv, /Synthetic Patient A/)
    }
    await setScopes([])
    assert.equal(await page.getByRole('button', { name: 'Export Archive CSV' }).count(), 0)
    assert.deepEqual(await page.evaluate(() => window.arc02.requests), [])
    await page.evaluate(() => window.arc02.setActor('owner', []))
    await page.getByRole('button', { name: /^Prescriptions/ }).click()
    assert.doesNotMatch(await text(), /PRIVATE MEDICINE/)
    const ownerCsv = await exportText()
    assert.match(ownerCsv, /Synthetic Patient A/); assert.match(ownerCsv, /Synthetic Patient B/)
    assert.doesNotMatch(ownerCsv, /PRIVATE MEDICINE/)
  })
  await runCase('ARC-02 17: reused record IDs and removed financial permission cannot retain another Patient’s detail', async () => {
    await setup()
    await page.getByRole('button', { name: 'View details for APT-a', exact: true }).click(); await detail().waitFor()
    await page.evaluate(() => window.arc02.patchState({ appointments: window.arc02.state.appointments.map(row => row.branchId === 'a' ? { ...row, patientId: 'replacement-patient', patientName: 'Replacement Patient' } : row) }))
    assert.equal(await detail().count(), 0)
    await page.getByRole('button', { name: /^Settled Invoices/ }).click()
    await page.getByRole('button', { name: 'View details for INV-a', exact: true }).click(); await detail().waitFor()
    await page.evaluate(() => window.arc02.patchState({ users: window.arc02.state.users.map(user => user.id === 'staff' ? { ...user, permissions: ['appointments'] } : user) }))
    assert.equal(await detail().count(), 0)
    assert.equal(await page.getByRole('button', { name: /^Settled Invoices/ }).count(), 0)
  })
}

test('ARC-02 browser lifetime, detail and CSV regressions (explicit opt-in)', { skip: !process.env.ARC02_BROWSER_BASE_URL, timeout: 120000 }, async t => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    await runArc02ArchiveScope(page, process.env.ARC02_BROWSER_BASE_URL, (name, body) => t.test(name, body))
  } finally { await browser.close() }
})

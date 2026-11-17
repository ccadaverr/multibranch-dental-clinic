import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { exactPeso } from '../src/owner-revenue-data.js'
import { api, browser, evidence, get, login, privateRead, target } from './local-visit-support.mjs'

const fixture = path => JSON.parse(privateRead(target.runtime + '/' + path))
const widths = [375, 390, 430, 768, 1024, 1440]
const press = locator => locator.press('Enter')
const fit = (page, width) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1).then(ok => assert.ok(ok, 'Page overflow at ' + width))
let owner
const passes = []
const pass = text => { passes.push(text); console.log('PASS ' + text) }

try {
  const staff = await login('sprint02.staff@example.test')
  assert.equal((await get(staff.page, '/api/me')).body.data.role, 'staff')
  const targetOnly = process.env.PRESENTATION_TARGET_ONLY === '1'
  const fixtureNames = ['visit-fixture.json', ...(targetOnly ? ['b13-second-visit-fixture.json'] : [])]
  for (const name of fixtureNames) {
    const expected = fixture(name)
    const patient = await get(staff.page, '/api/patients/' + expected.patientId)
    assert.equal(patient.status, 200, 'Verify the API is connected to this exact synthetic target.')
    assert.equal(patient.body.data.code, expected.patientCode)
  }
  pass('verified dedicated API through the exact synthetic Patient identities as Staff')
  if (targetOnly) {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
    const appointments = await get(staff.page, '/api/appointments?date=' + today + '&per_page=100')
    const patientIds = new Set(fixtureNames.map(name => fixture(name).patientId))
    assert.equal(appointments.status, 200)
    assert.equal(appointments.body.meta.last_page, 1, 'Use the minimal synthetic appointment fixture.')
    assert.ok(appointments.body.data.every(row => !patientIds.has(row.patient.id)),
      'GEN-09 requires a fresh synthetic database. Existing appointment data was left untouched.')
  } else {
    assert.equal((await get(staff.page, '/api/analytics/daily-revenue')).status, 403)
    const finance = fixture('presentation-finance.json')
    const outside = fixture('visit-fixture.json').branch
    const staffInvoices = await get(staff.page, '/api/invoices?status=Paid&branch_id=' + finance.branch.publicId)
    assert.equal(staffInvoices.status, 200)
    assert.ok(staffInvoices.body.data.every(row => row.invoice_number !== finance.invoiceNumber))
    pass('Staff cannot read Owner reporting or the out-of-branch paid invoice')

    owner = (await login('owner@example.test')).page
    assert.equal((await get(owner, '/api/me')).body.data.role, 'owner')
    const invoices = await get(owner, '/api/invoices?status=Paid&branch_id=' + finance.branch.publicId)
    const paid = invoices.body.data.find(i => i.invoice_number === finance.invoiceNumber)
    assert.equal(paid.receipt.number, finance.receiptNumber)
    assert.equal(paid.payment.amount, finance.amount)

    const nav = async name => {
      const destination = owner.getByRole('button', { name, exact: true })
      if (!await destination.isVisible() && await owner.getByRole('button', { name: 'Open navigation' }).isVisible()) {
        await press(owner.getByRole('button', { name: 'Open navigation' }))
      }
      await press(destination)
    }
    const scope = new URLSearchParams({ date_from: finance.date, date_to: finance.date, branch_id: finance.branch.publicId })
    const dailyPath = '/api/analytics/daily-revenue?' + scope
    const daily = await get(owner, dailyPath)
    const summary = await get(owner, '/api/analytics/executive-summary?' + scope)
    const week = await get(owner, '/api/analytics/weekly-histogram?date=' + finance.date + '&branch_id=' + finance.branch.publicId)
    const foreign = await get(owner, '/api/analytics/daily-revenue?' + new URLSearchParams({ date_from: finance.date, date_to: finance.date, branch_id: outside }))
    for (const response of [daily, summary, week, foreign]) assert.equal(response.status, 200)
    assert.equal(daily.body.data.days[0].gross_collected_php, finance.amount)
    assert.equal(summary.body.data.financials.total_collected_php, finance.amount)
    const isSunday = new Date(finance.date + 'T00:00:00Z').getUTCDay() === 0
    assert.equal(week.body.data.buckets.find(d => d.date === finance.date)?.gross_collected_php, isSunday ? undefined : finance.amount)
    assert.equal(foreign.body.data.totals.gross_collected_php, '0.00')

    await nav('Analytics & Reports')
    await owner.locator('.branch-scope select').selectOption({ label: finance.branch.name })
    const chart = owner.getByRole('group', { name: 'Daily gross collections line chart' })
    const exactRead = url => url.pathname === '/api/analytics/daily-revenue' && url.searchParams.get('date_from') === finance.date && url.searchParams.get('date_to') === finance.date
    await owner.route(exactRead, route => route.abort('failed'))
    await owner.getByLabel('Report period').selectOption('Custom dates')
    await owner.getByLabel('From date', { exact: true }).fill(finance.date)
    await owner.getByLabel('Through date', { exact: true }).fill(finance.date)
    await press(owner.getByRole('button', { name: 'Apply dates', exact: true }))
    await owner.getByText('Revenue unavailable', { exact: true }).waitFor()
    await owner.unroute(exactRead)
    await press(owner.getByRole('button', { name: 'Retry revenue', exact: true }))
    const point = chart.getByRole('button', { name: new RegExp(finance.date + '\. Gross collections') })
    await point.focus()
    const exact = exactPeso(finance.amount)
    assert.ok((await owner.getByRole('tooltip').innerText()).includes(exact))
    await point.locator('.owner-revenue-hit').first().hover()
    assert.ok((await owner.getByRole('tooltip').innerText()).includes(exact))
    if (!isSunday) {
      await owner.getByLabel('Week containing date', { exact: true }).fill(finance.date)
      const weekGroup = owner.getByRole('group', { name: 'Monday–Saturday gross collections and net cash flow chart' })
      const preview = owner.getByRole('button', { name: 'Preview in-progress week', exact: true })
      await preview.or(weekGroup).waitFor()
      if (await preview.isVisible()) await press(preview)
      const weeklyPoint = weekGroup.getByRole('button', { name: new RegExp(finance.date + '\\. Gross collections') })
      await weeklyPoint.focus()
      assert.ok((await weekGroup.locator('..').getByRole('tooltip').innerText()).includes(exact))
    }

    const exports = []
    const exportPath = url => url.pathname === '/api/analytics/export'
    owner.on('request', request => {
      const url = new URL(request.url())
      if (exportPath(url)) exports.push(url.searchParams.toString())
    })
    let downloads = 0
    owner.on('download', () => downloads++)
    await owner.route(exportPath, route => route.abort('failed'), { times: 1 })
    await press(owner.getByRole('button', { name: 'Export Report CSV', exact: true }))
    const retryCsv = owner.getByRole('button', { name: 'Retry report CSV', exact: true })
    await retryCsv.waitFor()
    assert.equal(downloads, 0)
    const download = owner.waitForEvent('download')
    await press(retryCsv)
    const attachment = await download
    const csv = await readFile(await attachment.path(), 'utf8')
    assert.ok(csv.includes(`${finance.date},${finance.amount},0.00,${finance.amount}`))
    assert.ok(csv.includes('Invoice creation (Asia/Manila)') && csv.includes('Payments recorded and refunds made (Asia/Manila)'))
    assert.equal(exports.length, 2)
    assert.equal(exports[0], exports[1])
    assert.ok(attachment.suggestedFilename().includes(finance.date))
    for (const width of widths) { await owner.setViewportSize({ width, height: 950 }); await fit(owner, width) }
    pass('actual branch-scoped daily, weekly, invoice summary and CSV amounts; chart and download keyboard retries; six widths')

    const archiveRead = url => url.pathname === '/api/invoices'
    await owner.route(archiveRead, route => route.abort('failed'))
    await nav('Archives & Records')
    const branch = owner.getByLabel('Filter archive by branch')
    await branch.selectOption(finance.branch.id)
    const search = owner.locator('.filter-bar-search input')
    const exactRecord = owner.getByRole('button', { name: 'View details for ' + finance.invoiceNumber, exact: true })
    const searchReceipt = async () => {
      await search.fill(finance.receiptNumber)
      await exactRecord.waitFor({ timeout: 7500 })
    }
    await search.fill(finance.invoiceNumber)
    await owner.getByText('Settled financial records unavailable', { exact: true }).waitFor()
    assert.equal(await exactRecord.count(), 0)
    await owner.unroute(archiveRead)
    await press(owner.getByRole('button', { name: 'Retry financial records', exact: true }))
    await exactRecord.waitFor()
    await press(owner.getByRole('button', { name: /^Historical Appointments \(/ }))
    await searchReceipt()
    await press(exactRecord)
    const detail = owner.getByRole('dialog')
    await detail.getByText(finance.receiptNumber, { exact: true }).waitFor()
    await detail.getByText(finance.invoiceNumber, { exact: true }).waitFor()
    for (const width of widths) { await owner.setViewportSize({ width, height: 950 }); await fit(owner, width) }
    await owner.keyboard.press('Escape')
    await detail.waitFor({ state: 'hidden' })
    await branch.selectOption(outside)
    await owner.getByText('No matching archive records in this branch scope.', { exact: true }).waitFor()
    assert.equal(await exactRecord.count(), 0)
    await owner.reload()
    await nav('Archives & Records')
    await branch.selectOption(finance.branch.id)
    await searchReceipt()
    pass('actual settled receipt search, exact read-only details, branch exclusion and reload; six widths')
  }
} finally {
  await writeFile(evidence + '/owner-results.json', JSON.stringify(passes, null, 2))
  await browser.close()
}

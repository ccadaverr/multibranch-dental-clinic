// Read-only visual comparison against an independently owned synthetic target.
import assert from 'node:assert/strict'
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {browser, login, get, evidence, target, base, api} from './local-visit-support.mjs'

const phase = process.env.J08_PHASE || 'after'
assert.ok(['before', 'after'].includes(phase))
const widths = [375, 390, 430, 768, 1024, 1440]
const clinical = JSON.parse(readFileSync(target.runtime + '/clinical-browser/journey.json', 'utf8'))
assert.equal(clinical.accepted, true, 'Complete the persisted clinical prerequisite first')
const folder = evidence + '/' + phase
mkdirSync(folder, {recursive: true})
const results = {phase, widths, screens: [], keyboard: {}, accepted: false}
let page

async function capture(name, sizes = widths) {
  const metrics = []
  for (const width of sizes) {
    await page.setViewportSize({width, height: 1000})
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
    assert.equal(overflow, false, name + ' page overflow at ' + width)
    metrics.push({width, overflow})
    await page.screenshot({path: folder + '/' + name + '-' + width + '.png', fullPage: true})
  }
  results.screens.push({name, metrics})
}

async function portal(name) {
  await page.goto(base + '/?j08=' + phase + '-' + name + '#p/' + name)
  await page.locator('.pp-shell').waitFor()
  await page.waitForLoadState('networkidle')
}

try {
  const patient = await login('sprint02.patient@example.test')
  page = patient.page
  const ownRx = (await get(page, '/api/me/prescriptions')).body.data
  const familyBefore = (await get(page, '/api/me/dependents')).body.data
  assert.ok(familyBefore.length, 'Use the existing synthetic Family acceptance fixture')
  await portal('home')
  await page.locator('.care-balance').waitFor()
  if (phase === 'after') await page.getByRole('heading', {name: 'Your dental care', exact: true}).waitFor()
  await capture('patient-home')

  await portal('family')
  await page.locator('.pp-family-list>li').first().waitFor()
  await capture('patient-family')
  const add = page.getByRole('button', {name: 'Add a child or dependent', exact: true})
  await add.focus()
  await page.keyboard.press('Enter')
  const form = page.locator('form.care-family-form')
  const first = form.getByRole('textbox', {name: /^First name/})
  await first.waitFor()
  results.keyboard.familyOpensWithFirstFieldFocused = await first.evaluate(el => el === document.activeElement)
  if (phase === 'after') assert.equal(results.keyboard.familyOpensWithFirstFieldFocused, true)
  await first.fill('Synthetic unsaved J08 draft')
  await capture('patient-family-form')
  await form.getByRole('button', {name: 'Cancel', exact: true}).click()
  assert.equal(await add.evaluate(el => el === document.activeElement), true)
  await add.click()
  assert.equal(await first.inputValue(), '')
  await form.getByRole('button', {name: 'Cancel', exact: true}).click()

  await portal('prescriptions')
  const record = page.locator('.pp-rx-list>li').filter({hasText: clinical.issued.number})
  await record.getByText(clinical.issued.lines[0].medicine, {exact: true}).waitFor()
  if (phase === 'after') {
    await record.getByRole('heading', {name: clinical.issued.number, exact: true}).waitFor()
    await record.getByText('Issued', {exact: true}).waitFor()
    const download = record.getByRole('button', {name: 'Download PDF for ' + clinical.issued.number, exact: true})
    await download.focus()
    const pending = page.waitForEvent('download')
    await page.keyboard.press('Enter')
    assert.equal(readFileSync(await (await pending).path()).subarray(0, 4).toString(), '%PDF')
    results.keyboard.prescriptionDownload = true
  }
  await capture('patient-prescriptions')
  if (phase === 'after') {
    await page.route(api + '/api/me/prescriptions', route => route.fulfill({status: 503, json: {message: 'Synthetic J08 read interruption'}}))
    await page.getByRole('button', {name: 'Reload my prescriptions', exact: true}).click()
    await page.getByRole('alert').getByText('Synthetic J08 read interruption', {exact: true}).waitFor()
    assert.equal(await page.locator('.pp-rx-list>li').count(), 0)
    await page.unroute(api + '/api/me/prescriptions')
    await page.getByRole('button', {name: 'Try again', exact: true}).focus()
    await page.keyboard.press('Enter')
    await record.getByText(clinical.issued.lines[0].medicine, {exact: true}).waitFor()
  }
  assert.deepEqual((await get(page, '/api/me/prescriptions')).body.data, ownRx)
  assert.deepEqual((await get(page, '/api/me/dependents')).body.data, familyBefore)

  // Inspect the other requested flows; retain good screens and financial ownership.
  for (const name of ['visits', 'book', 'archives', 'documents', 'billing']) {
    await portal(name)
    await capture('audit-patient-' + name, [390, 1440])
  }
  await patient.context.close()

  const dentist = await login('sprint02.dentist@example.test')
  page = dentist.page
  await capture('audit-dentist-home', [390, 1440])
  const rxBefore = (await get(page, '/api/prescriptions/' + clinical.issued.id)).body.data
  const careBefore = (await get(page, '/api/treatments/' + clinical.treatment.id)).body.data
  await page.getByRole('button', {name: 'My Queue', exact: true}).first().click()
  await page.getByRole('button', {name: 'Continue treatment', exact: true}).first().waitFor()
  await capture('audit-dentist-worklist', [390, 1440])
  await page.getByRole('button', {name: 'Continue treatment', exact: true}).first().click()
  await page.getByRole('textbox', {name: 'Clinical notes', exact: true}).waitFor()
  await capture('audit-dentist-treatment', [390, 1440])
  await page.getByRole('button', {name: 'Open visit prescriptions', exact: true}).click()
  const identity = page.getByRole('region', {name: 'Prescription Patient and Visit', exact: true})
  await identity.waitFor()
  assert.match(await identity.innerText(), new RegExp(clinical.visit.id))
  assert.equal(await page.getByRole('combobox', {name: /^Visit/}).isDisabled(), true)
  const row = page.locator('.fd-list>li').filter({hasText: clinical.issued.number})
  await row.waitFor()
  await capture('dentist-prescriptions')
  await row.getByRole('button', {name: 'Open', exact: true}).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText(clinical.issued.lines[0].medicine, {exact: true}).waitFor()
  await capture('dentist-issued-review')
  await page.keyboard.press('Escape')
  await dialog.waitFor({state: 'hidden'})
  assert.deepEqual((await get(page, '/api/prescriptions/' + clinical.issued.id)).body.data, rxBefore)
  assert.deepEqual((await get(page, '/api/treatments/' + clinical.treatment.id)).body.data, careBefore)
  assert.equal(careBefore.status, 'In Treatment')
  const foreign = await login('patient@example.test')
  assert.ok(!(await get(foreign.page, '/api/me/prescriptions')).body.data.some(row => row.id === clinical.issued.id))
  assert.ok([403, 404].includes((await get(foreign.page, '/api/prescriptions/' + clinical.issued.id)).status))
  results.accepted = true
  console.log('PASS', phase, 'six-width clinical polish, real record identity, keyboard, read-only clinical integrity and Patient isolation')
} catch (error) {
  if (page && !page.isClosed()) {
    writeFileSync(folder + '/failure.txt', await page.locator('body').innerText())
    await page.screenshot({path: folder + '/failure.png', fullPage: true})
  }
  throw error
} finally {
  writeFileSync(folder + '/results.json', JSON.stringify(results, null, 2))
  await browser.close()
}

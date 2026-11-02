import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const before = process.argv.includes('--before')
const evidence = 'docs/ui-review/yzh-qa-02/r2'
const url = process.env.QA_URL || 'http://127.0.0.1:5187/tests/fixtures/yzh-qa-02.html'
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return {promise, resolve} }
const frame = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
const button = (page, name) => page.getByRole('button', {name, exact:true})
const visitSelect = page => page.getByRole('combobox', {name:/^Visit/})
const noteInput = page => page.getByRole('textbox', {name:/^Note \(optional\)/})
const browser = await chromium.launch({channel:'chrome', headless:true})
const results = []
await mkdir(evidence, {recursive:true})

async function fixture(page, heldOperation, failure = false, refuseB = false) {
  const ready = deferred(), release = deferred(), calls = [], records = new Map()
  const row = (id, patient, body) => ({id, visit:'v'+patient, patient:{id:'p'+patient, name:'Synthetic patient '+patient, age:null}, status:'Draft', revision:1, can_edit:true, can_void:false, lines:body.lines, note:body.note, branch:'Synthetic branch', dentist:'Synthetic dentist'})
  await page.route('**/sanctum/**', r => r.fulfill({status:204}))
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    if (req.method() === 'GET') {
      if (path.endsWith('/visits')) return route.fulfill({json:{data:['A','B'].map(id => ({id:'v'+id, patient:{id:'p'+id, name:'Synthetic patient '+id, age:null}, date:'2026-11-02', branch:'Synthetic branch'})), meta:{allergy_notice:'Ask the patient'}}})
      return route.fulfill({json:{data:path === '/api/prescriptions' ? [] : records.get(path.split('/').at(-1)) || []}})
    }
    const body = req.postDataJSON()
    assert.equal(req.method(), 'POST', 'new prescriptions use only explicit create/issue commands')
    assert(path === '/api/prescriptions' || /^\/api\/prescriptions\/rx-[AB]\/issue$/.test(path), 'unexpected mutation '+path)
    calls.push({path, body})
    const patient = path === '/api/prescriptions' ? body.visit_id.slice(1) : path.split('/')[3].slice(-1)
    const held = patient === 'A' && (heldOperation === 'create' ? path === '/api/prescriptions' : path.endsWith('/issue'))
    if (held) { ready.resolve(); await release.promise }
    if (held && failure) return route.fulfill({status:422, json:{message:'Synthetic A refused', errors:{note:['Synthetic A refused']}}})
    if (patient === 'B' && refuseB) return route.fulfill({status:422, json:{message:'Synthetic B refused', errors:{note:['Synthetic B refused']}}})
    const id = 'rx-'+patient
    const record = path.endsWith('/issue') ? {...records.get(id), status:'Issued', can_edit:false, revision:2, number:'RX-'+patient} : row(id, patient, body)
    records.set(id, record)
    return route.fulfill({json:{data:record}})
  })
  await page.goto(url)
  await page.waitForFunction(() => window.qa02)
  await page.evaluate(() => window.qa02.setMode('rx'))
  await visitSelect(page).selectOption('vA')
  return {ready, release, calls, records}
}

async function fill(page, patient) {
  await page.getByLabel('Select medicine 1', {exact:true}).selectOption(patient === 'A' ? 'Paracetamol' : 'Ibuprofen')
  await page.getByLabel('Select dosage 1', {exact:true}).selectOption(patient === 'A' ? '500mg' : '250mg')
  await noteInput(page).fill('Synthetic '+patient+' note')
}

async function issue(page) {
  await button(page, 'Issue prescription').click()
  await page.getByRole('dialog', {name:'Issue and lock prescription?'}).getByRole('button', {name:'Issue prescription', exact:true}).click()
}

async function assertEditor(page, patient) {
  assert.equal(await visitSelect(page).inputValue(), 'v'+patient, 'late A must not reset the active Visit')
  assert.equal(await page.getByLabel('Select medicine 1', {exact:true}).inputValue(), patient === 'A' ? 'Paracetamol' : 'Ibuprofen')
  assert.equal(await page.getByLabel('Select dosage 1', {exact:true}).inputValue(), patient === 'A' ? '500mg' : '250mg')
  assert.equal(await noteInput(page).inputValue(), 'Synthetic '+patient+' note', 'late A must preserve current clinical text')
  assert.equal(await page.getByRole('dialog').count(), 0, 'late A must not navigate to its record')
  assert.equal(await page.getByText('Synthetic A refused', {exact:true}).count(), 0, 'late A must not replace current feedback')
  assert.deepEqual(await page.evaluate(() => window.qa02Toasts), [], 'late A must not report stale success')
}

async function race(page, {operation, failure = false, rapid = false, stage, bError = false}) {
  const heldOperation = stage || (operation === 'save' ? 'create' : 'issue')
  const f = await fixture(page, heldOperation, failure, bError)
  try {
    await fill(page, 'A')
    if (operation === 'issue') await issue(page)
    else await button(page, 'Save draft').click()
    await f.ready.promise
    await visitSelect(page).selectOption('vB')
    if (rapid) await visitSelect(page).selectOption('vA')
    const active = rapid ? 'A' : 'B'
    await fill(page, active)
    if (rapid) await noteInput(page).fill('Fresh A selection')
    if (bError) {
      assert(await button(page, 'Save draft').isEnabled(), 'A does not own B loading state')
      await button(page, 'Save draft').click()
      await page.getByText('Synthetic B refused', {exact:true}).waitFor()
    }
    const finalPath = operation === 'issue' && !(heldOperation === 'create' && failure) ? '/api/prescriptions/rx-A/issue' : '/api/prescriptions'
    const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === finalPath)
    f.release.resolve()
    await (await response).finished()
    await frame(page)
    if (rapid) {
      assert.equal(await noteInput(page).inputValue(), 'Fresh A selection', 'returning to A must not revive an old generation')
      await noteInput(page).fill('Synthetic A note')
    }
    await assertEditor(page, active)
    assert.deepEqual(f.calls[0], {path:'/api/prescriptions', body:{visit_id:'vA', lines:[{medicine:'Paracetamol', dosage:'500mg', frequency:'', duration:'', instructions:''}], note:'Synthetic A note'}}, 'the original command retains the original Visit and clinical payload')
    assert.equal(f.calls.filter(c => c.path === '/api/prescriptions' && c.body.visit_id === 'vA').length, 1, 'selection changes do not resend A')
    assert.equal(f.calls.filter(c => c.path.endsWith('/issue')).length, operation === 'issue' && !(heldOperation === 'create' && failure) ? 1 : 0)
    if (bError) {
      assert.equal(await page.getByText('Synthetic B refused', {exact:true}).count(), 1, 'B retains its own failure feedback')
      assert(await button(page, 'Save draft').isEnabled())
    } else {
      assert.equal(f.calls.filter(c => c.path === '/api/prescriptions' && c.body.visit_id === 'vB').length, 0, 'no automatic B mutation')
      assert(await button(page, 'Save draft').isEnabled(), 'a stale request cannot keep the current editor busy')
      if (!before && !rapid && !stage) await page.screenshot({path:`${evidence}/${operation}-${failure?'failure':'success'}-${page.viewportSize().width}.png`, fullPage:true, animations:'disabled'})
      if (!rapid) {
        const count = f.calls.length
        await button(page, 'Save draft').click()
        await page.getByRole('dialog', {name:/Synthetic patient B/}).waitFor()
        assert.equal(f.calls.length, count+1, 'active B Save is a separate explicit command')
        assert.equal(f.calls.at(-1).body.visit_id, 'vB')
        assert.equal(f.calls.at(-1).body.note, 'Synthetic B note')
        assert.equal(f.calls.at(-1).body.lines[0].medicine, 'Ibuprofen')
        assert.equal(f.calls.at(-1).body.lines[0].dosage, '250mg')
        assert.equal((await page.evaluate(() => window.qa02Toasts)).length, 1)
      }
    }
    return f.calls
  } finally { f.release.resolve() }
}

async function activeIssue(page) {
  const f = await fixture(page, 'none')
  await visitSelect(page).selectOption('vB')
  await fill(page, 'B')
  await button(page, 'Issue prescription').click()
  assert.equal(f.calls.length, 0, 'opening confirmation creates and issues nothing')
  await page.getByRole('dialog').getByRole('button', {name:'Issue prescription', exact:true}).click()
  await page.getByRole('dialog').getByText('Issued', {exact:true}).waitFor()
  await page.getByRole('dialog', {name:/Synthetic patient B/}).waitFor()
  assert.deepEqual(f.calls.map(c => c.path), ['/api/prescriptions', '/api/prescriptions/rx-B/issue'])
  assert.equal(f.calls[0].body.visit_id, 'vB')
  assert.equal(f.calls[0].body.note, 'Synthetic B note')
  assert.equal(f.calls[0].body.lines[0].medicine, 'Ibuprofen')
  assert.equal(f.calls[0].body.lines[0].dosage, '250mg')
  assert.deepEqual(f.calls[1].body, {expected_revision:1})
  assert.equal(f.records.get('rx-B').status, 'Issued')
  assert.equal((await page.evaluate(() => window.qa02Toasts)).length, 1)
  return f.calls
}

async function visitReset(page) {
  await fixture(page, 'none')
  await fill(page, 'A')
  await visitSelect(page).selectOption('vB')
  assert.equal(await noteInput(page).inputValue(), '', 'new Visit never inherits another patient note')
  assert.equal(await page.getByLabel('Select medicine 1', {exact:true}).inputValue(), '')
  assert.equal(await page.getByLabel('Select dosage 1', {exact:true}).inputValue(), '')
  assert(await button(page, 'Save draft').isDisabled())
}

try {
  const cases = [
    ['save-success', p => race(p, {operation:'save'})],
    ['save-failure', p => race(p, {operation:'save', failure:true})],
    ['issue-success', p => race(p, {operation:'issue'})],
    ['issue-failure', p => race(p, {operation:'issue', failure:true})],
    ...before ? [] : [
      ['issue-create-success', p => race(p, {operation:'issue', stage:'create'})],
      ['issue-create-failure', p => race(p, {operation:'issue', stage:'create', failure:true})],
      ['save-A-B-A', p => race(p, {operation:'save', rapid:true})],
      ['save-failure-A-B-A', p => race(p, {operation:'save', rapid:true, failure:true})],
      ['issue-A-B-A', p => race(p, {operation:'issue', rapid:true})],
      ['issue-failure-A-B-A', p => race(p, {operation:'issue', rapid:true, failure:true})],
      ['B-error-survives-A-failure', p => race(p, {operation:'save', failure:true, bError:true})],
      ['active-B-issue', activeIssue],
      ['visit-change-starts-blank', visitReset],
    ],
  ]
  for (const width of before ? [390] : [390,768,1024,1440]) {
    for (const [name, run] of cases) {
      const context = await browser.newContext({viewport:{width, height:1000}}), page = await context.newPage(), errors = []
      page.setDefaultTimeout(5000)
      page.on('pageerror', e => errors.push(e.message))
      try {
        const calls = await run(page)
        assert.deepEqual(errors, [])
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1), 'no horizontal document overflow')
        results.push({width, name, status:'pass', calls})
        console.log('PASS '+width+' '+name)
      } catch (e) {
        results.push({width, name, status:'fail', error:e.message})
        console.log('FAIL '+width+' '+name+': '+e.message)
      } finally { await context.close() }
    }
  }
  const sourceSha256 = createHash('sha256').update(await readFile('src/pages/ServerPrescriptions.jsx')).digest('hex')
  await writeFile(`${evidence}/${before?'before':'after'}-results.json`, JSON.stringify({synthetic:true, authenticatedAcceptance:false, sourceSha256, results}, null, 2), {flag:before?'wx':'w'})
  console.log(JSON.stringify({passed:results.filter(r => r.status === 'pass').length, failed:results.filter(r => r.status === 'fail').length}))
  if (results.some(r => r.status === 'fail')) process.exitCode = 1
} finally { await browser.close() }

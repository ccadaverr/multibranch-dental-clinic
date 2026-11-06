import assert from 'node:assert/strict'
import {mkdtemp, readFile, writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
import os from 'node:os'

const dependencies = process.env.CLIN05_NODE_MODULES
if (!dependencies) throw new Error('CLIN05_NODE_MODULES is required.')
const {chromium} = await import(pathToFileURL(path.join(dependencies, 'playwright/index.mjs')))
const before = process.argv.includes('--before')
const evidence = await mkdtemp(path.join(os.tmpdir(), 'yzh-clin05-' + (before ? 'before-' : 'after-')))
const url = process.env.CLIN05_URL || 'http://127.0.0.1:5196/tests/fixtures/yzh-qa-02.html'
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r}); return {promise, resolve}}
const frames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
const button = (p, name) => p.getByRole('button', {name, exact: true})
const note = p => p.getByRole('textbox', {name: /^Note \(optional\)/})
const visits = p => p.getByRole('combobox', {name: /^Visit/})
const leave = p => p.getByRole('dialog', {name: 'Leave this prescription?', exact: true})
const results = []

async function setup(p, {hold = 'none', failure = false, saved = false} = {}) {
  const ready = deferred(), release = deferred(), calls = []
  const line = {medicine: 'Paracetamol', dosage: '500mg', frequency: '', duration: '', instructions: ''}
  const row = (id, body = {}) => ({id, visit: 'v' + id, patient: {id: 'p' + id, name: 'Synthetic patient ' + id, age: null}, status: 'Draft', can_edit: true, revision: 1, lines: [{...line}], note: '', branch: 'Synthetic branch', dentist: 'Synthetic dentist', ...body})
  const records = new Map(saved ? ['A', 'B'].map(id => [id, row(id)]) : [])
  await p.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await p.route('**/sanctum/**', r => r.fulfill({status: 204}))
  await p.route('**/api/**', async route => {
    const req = route.request(), pathname = new URL(req.url()).pathname
    if (req.method() === 'GET') {
      const data = pathname.endsWith('/visits') ? ['A', 'B'].map(id => ({id: 'v' + id, patient: row(id).patient, date: '2026-11-06', branch: 'Synthetic branch'}))
        : pathname === '/api/prescriptions' ? [...records.values()] : records.get(pathname.split('/').at(-1)) || []
      return route.fulfill({json: {data, meta: {allergy_notice: 'Ask the patient', license_no: ''}}})
    }
    const body = req.postDataJSON()
    assert(['POST /api/prescriptions', 'PUT /api/prescriptions/A', 'PUT /api/prescriptions/B', 'POST /api/prescriptions/A/issue'].includes(req.method() + ' ' + pathname), 'unexpected mutation')
    calls.push({method: req.method(), path: pathname, body})
    const held = hold === 'save' ? !pathname.endsWith('/issue') : hold === 'issue' && pathname.endsWith('/issue')
    if (held) {ready.resolve(); await release.promise}
    if (held && failure === 'network') return route.abort()
    if (held && failure) return route.fulfill({status: 422, json: {message: 'Synthetic refusal', errors: {note: ['Synthetic refusal']}}})
    const id = pathname === '/api/prescriptions' ? body.visit_id.slice(1) : pathname.split('/')[3]
    const record = pathname.endsWith('/issue') ? {...records.get(id), status: 'Issued', number: 'RX-' + id, can_edit: false, revision: 3}
      : row(id, {...body, revision: (records.get(id)?.revision || 0) + 1})
    records.set(id, record)
    return route.fulfill({json: {data: record}})
  })
  await p.goto(url, {timeout: 30000})
  await p.waitForFunction(() => window.qa02, {timeout: 30000})
  await p.evaluate(() => window.qa02.setMode('rx'))
  if (saved) {await button(p, 'Edit draft').first().click(); await p.getByText('Edit draft for Synthetic patient A', {exact: true}).waitFor()}
  else await visits(p).selectOption('vA')
  return {ready, release, calls, records}
}
async function fill(p) {
  await p.getByLabel('Select medicine 1', {exact: true}).selectOption('Paracetamol')
  await p.getByLabel('Select dosage 1', {exact: true}).selectOption('500mg')
  await note(p).fill('Unsaved A note')
}
async function discard(p) {await leave(p).getByRole('button', {name: 'Discard changes and continue', exact: true}).click()}
async function start(p, operation) {
  if (operation === 'save') return button(p, 'Save draft').click()
  await button(p, 'Issue prescription').click()
  await p.getByRole('dialog', {name: 'Issue and lock prescription?', exact: true}).getByRole('button', {name: 'Issue prescription', exact: true}).click()
}
async function dirtyVisit(p) {
  const f = await setup(p); await fill(p)
  await visits(p).selectOption('vB'); await leave(p).waitFor()
  assert.equal(await visits(p).inputValue(), 'vA')
  assert.equal(await p.evaluate(() => document.activeElement.textContent), 'Stay')
  await p.screenshot({path: path.join(evidence, `dirty-visit-${p.viewportSize().width}.png`), fullPage: true, animations: 'disabled'})
  await p.keyboard.press('Escape'); assert.equal(await note(p).inputValue(), 'Unsaved A note')
  await visits(p).selectOption('vB'); await button(leave(p), 'Stay').click()
  assert.equal(await visits(p).inputValue(), 'vA')
  await visits(p).selectOption('vB'); await discard(p)
  assert.equal(await visits(p).inputValue(), 'vB'); assert.equal(await note(p).inputValue(), '')
  assert.equal(await p.getByLabel('Select medicine 1', {exact: true}).inputValue(), '')
  assert.deepEqual(f.calls, [])
}
async function dirtyDraft(p, cancel = false) {
  const f = await setup(p, {saved: true}); await note(p).fill('Unsaved draft A')
  const select = () => cancel ? button(p, 'Cancel').click() : button(p, 'Edit draft').nth(1).click()
  await select(); await leave(p).waitFor(); await button(leave(p), 'Stay').click()
  assert.equal(await note(p).inputValue(), 'Unsaved draft A')
  await select(); await discard(p)
  if (cancel) {assert.equal(await note(p).inputValue(), ''); assert.equal(await visits(p).inputValue(), '')}
  else {await p.getByText('Edit draft for Synthetic patient B', {exact: true}).waitFor(); assert.equal(await note(p).inputValue(), '')}
  assert.deepEqual(f.calls, [])
}
async function dirtyDetail(p) {
  const f = await setup(p, {saved: true}); await note(p).fill('Unsaved draft A')
  await button(p, 'Open').nth(1).click()
  const detail = p.getByRole('dialog', {name: /Synthetic patient B/})
  await detail.getByRole('button', {name: 'Edit draft', exact: true}).click()
  await leave(p).waitFor(); await button(leave(p), 'Stay').click()
  assert.equal(await note(p).inputValue(), 'Unsaved draft A')
  await detail.getByRole('button', {name: 'Edit draft', exact: true}).click(); await discard(p)
  await p.getByText('Edit draft for Synthetic patient B', {exact: true}).waitFor()
  assert.equal(await p.getByRole('dialog').count(), 0)
  assert.notEqual(await p.evaluate(() => document.body.style.overflow), 'hidden', 'closing detail and discard dialogs restores scrolling')
  assert.deepEqual(f.calls, [])
}
async function pending(p, operation, failure = false, saved = false, dialogDecision) {
  const f = await setup(p, {hold: operation, failure, saved})
  try {
    await fill(p); await start(p, operation); await f.ready.promise
    assert(await note(p).isDisabled(), 'a pending command must protect its submitted note')
    for (const name of ['Select medicine 1', 'Select dosage 1', 'Select frequency 1', 'Select duration 1']) assert(await p.getByLabel(name, {exact: true}).isDisabled(), name + ' stays locked')
    assert(await button(p, 'Add another medicine').isDisabled())
    // Native disabled editing cannot create a newer same-Visit clinical revision.
    await assert.rejects(note(p).fill('Unsent replacement', {timeout: 250}))
    assert.equal(await note(p).inputValue(), 'Unsaved A note')
    if (!saved && !failure && !dialogDecision) await p.screenshot({path: path.join(evidence, `pending-${operation}-${p.viewportSize().width}.png`), fullPage: true, animations: 'disabled'})
    if (dialogDecision) {
      if (saved) await button(p, 'Edit draft').nth(1).click()
      else await visits(p).selectOption('vB')
      await leave(p).waitFor()
    }
    const finalPath = operation === 'issue' ? '/api/prescriptions/A/issue' : saved ? '/api/prescriptions/A' : '/api/prescriptions'
    const response = p.waitForResponse(r => new URL(r.url()).pathname === finalPath && r.request().method() !== 'GET')
    f.release.resolve(); await (await response).finished(); await frames(p)
    assert.equal(f.calls[0].body.note, 'Unsaved A note')
    assert.equal(f.calls[0].body.lines[0].dosage, '500mg')
    assert.equal(f.calls[0].path, saved ? '/api/prescriptions/A' : '/api/prescriptions')
    if (!saved) assert.equal(f.calls[0].body.visit_id, 'vA')
    if (operation === 'issue') assert.equal(f.calls.at(-1).path, '/api/prescriptions/A/issue')
    if (dialogDecision) {
      await leave(p).waitFor(); assert.equal(await note(p).inputValue(), 'Unsaved A note')
      assert.deepEqual(await p.evaluate(() => window.qa02Toasts), [], 'confirmation is not replaced by a late result')
      if (dialogDecision === 'discard') {
        await discard(p)
        if (saved) await p.getByText('Edit draft for Synthetic patient B', {exact: true}).waitFor()
        else assert.equal(await visits(p).inputValue(), 'vB')
        assert.equal(await note(p).inputValue(), '')
        assert.deepEqual(await p.evaluate(() => window.qa02Toasts), [])
        return
      }
      await button(leave(p), 'Stay').click()
    }
    if (failure) {
      await p.getByText('Synthetic refusal', {exact: true}).waitFor()
      assert.equal(await note(p).inputValue(), 'Unsaved A note'); assert(await note(p).isEnabled())
      assert(await button(p, 'Save draft').isEnabled())
      assert.deepEqual(await p.evaluate(() => window.qa02Toasts), [])
    } else {
      await p.getByRole('dialog', {name: /Synthetic patient A/}).waitFor()
      assert.equal((await p.evaluate(() => window.qa02Toasts)).length, 1)
    }
  } finally {f.release.resolve()}
}
async function reverted(p) {
  const f = await setup(p, {saved: true})
  await note(p).fill('Temporary'); await note(p).fill('')
  await p.getByLabel('Select dosage 1', {exact: true}).selectOption('250mg')
  await p.getByLabel('Select dosage 1', {exact: true}).selectOption('500mg')
  await button(p, 'Edit draft').nth(1).click(); await p.getByText('Edit draft for Synthetic patient B', {exact: true}).waitFor()
  assert.equal(await leave(p).count(), 0); assert.deepEqual(f.calls, [])
}
async function dirtyField(p, field) {
  const f = await setup(p, {saved: true})
  if (field === 'instructions') await p.getByLabel('Instructions (optional)', {exact: true}).fill('Unsent instruction')
  else if (field === 'line-count') await button(p, 'Add another medicine').click()
  else await p.getByLabel(`Select ${field} 1`, {exact: true}).selectOption({medicine: 'Ibuprofen', dosage: '250mg', frequency: 'Twice daily', duration: '7 days'}[field])
  await button(p, 'Edit draft').nth(1).click(); await leave(p).waitFor(); await button(leave(p), 'Stay').click()
  assert.deepEqual(f.calls, [])
  await p.getByText('Edit draft for Synthetic patient A', {exact: true}).waitFor()
}
async function duplicate(p) {
  const f = await setup(p, {hold: 'save'})
  try {
    await fill(p)
    await note(p).evaluate(el => {el.form.requestSubmit(); el.form.requestSubmit()})
    await f.ready.promise; await frames(p)
    assert.equal(f.calls.length, 1, 'same-tick submission has one owner')
    assert(await note(p).isDisabled())
    const response = p.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/prescriptions')
    f.release.resolve(); await (await response).finished(); await p.getByRole('dialog', {name: /Synthetic patient A/}).waitFor()
    assert.equal(f.calls.length, 1)
  } finally {f.release.resolve()}
}
async function issueRetry(p) {
  const f = await setup(p, {hold: 'issue', failure: true})
  try {
    await fill(p); await start(p, 'issue'); await f.ready.promise
    f.release.resolve(); await p.getByText('Synthetic refusal', {exact: true}).waitFor()
    assert.equal(f.calls.filter(c => c.method === 'POST' && c.path === '/api/prescriptions').length, 1)
    assert.equal(await note(p).inputValue(), 'Unsaved A note')
    await button(p, 'Save draft').click(); await p.getByRole('dialog', {name: /Synthetic patient A/}).waitFor()
    assert.equal(f.calls.at(-1).method, 'PUT'); assert.equal(f.calls.at(-1).path, '/api/prescriptions/A')
    assert.equal(f.calls.at(-1).body.expected_revision, 1)
    assert.equal(f.calls.filter(c => c.method === 'POST' && c.path === '/api/prescriptions').length, 1, 'retry updates the confirmed Draft rather than creating a copy')
  } finally {f.release.resolve()}
}
async function networkFailure(p) {
  const f = await setup(p, {hold: 'save', failure: 'network'})
  try {
    await fill(p); await start(p, 'save'); await f.ready.promise; f.release.resolve()
    await button(p, 'Save draft').waitFor(); await p.waitForFunction(() => !document.querySelector('.rx-line').disabled)
    assert.equal(await note(p).inputValue(), 'Unsaved A note')
    assert(await button(p, 'Save draft').isEnabled()); assert.equal(f.calls.length, 1, 'no automatic retry')
    assert.deepEqual(await p.evaluate(() => window.qa02Toasts), [])
  } finally {f.release.resolve()}
}

const browser = await chromium.launch({channel: 'chrome', headless: true})
try {
  const cases = [
    ['dirty-visit-stay-discard', dirtyVisit], ['dirty-draft-stay-discard', p => dirtyDraft(p)],
    ['dirty-cancel-stay-discard', p => dirtyDraft(p, true)], ['reverted-draft-clean', reverted],
    ['dirty-draft-from-detail', dirtyDetail],
    ...['medicine', 'dosage', 'frequency', 'duration', 'instructions', 'line-count'].map(field => ['dirty-' + field, p => dirtyField(p, field)]),
    ['duplicate-submit', duplicate], ['failed-issue-retry-same-draft', issueRetry], ['network-failure-retains-draft', networkFailure],
    ...['save', 'issue'].flatMap(operation => [
      [`${operation}-same-visit-lock`, p => pending(p, operation)],
      [`${operation}-failure-unlocks`, p => pending(p, operation, true)],
      [`${operation}-existing-draft-lock`, p => pending(p, operation, false, true)],
      ...['stay', 'discard'].flatMap(decision => [
        [`${operation}-pending-dialog-${decision}`, p => pending(p, operation, false, false, decision)],
        [`${operation}-pending-dialog-failure-${decision}`, p => pending(p, operation, true, false, decision)],
        [`${operation}-pending-draft-dialog-${decision}`, p => pending(p, operation, false, true, decision)],
      ]),
    ]),
  ]
  const selectedCase = process.argv.find(arg => arg.startsWith('--case='))?.slice(7)
  for (const width of before ? [390] : [390, 768, 1024, 1440]) for (const [name, run] of before ? cases.filter(([n]) => ['dirty-visit-stay-discard', 'dirty-draft-stay-discard', 'save-same-visit-lock', 'issue-same-visit-lock'].includes(n)) : cases.filter(([n]) => !selectedCase || n === selectedCase)) {
    const context = await browser.newContext({viewport: {width, height: 1000}}), p = await context.newPage(), errors = []
    p.setDefaultTimeout(5000); p.on('pageerror', e => errors.push(e.message))
    try {
      await run(p); assert.deepEqual(errors, [])
      assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      results.push({width, name, status: 'pass'}); console.log('PASS', width, name)
    } catch (error) {results.push({width, name, status: 'fail', error: error.message, pageErrors: errors}); console.log('FAIL', width, name, error.message)}
    finally {await context.close()}
  }
  const sourceSha256 = createHash('sha256').update(await readFile('src/pages/ServerPrescriptions.jsx')).digest('hex')
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify({synthetic: true, authenticatedAcceptance: false, before, sourceSha256, results}, null, 2), {flag: 'wx'})
  console.log(JSON.stringify({evidence, passed: results.filter(r => r.status === 'pass').length, failed: results.filter(r => r.status === 'fail').length}))
  if (results.some(r => r.status === 'fail')) process.exitCode = 1
} finally {await browser.close()}

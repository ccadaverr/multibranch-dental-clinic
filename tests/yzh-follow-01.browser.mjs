// FOLLOW-01: authored for later execution; no real API or database is reachable.
// Exercises real follow-up components. Booking is a callback/identity boundary
// double, NOT acceptance of Scheduling.jsx or backend task-selection semantics.
// Rendered acceptance still needs 390/768/1024/1440px with production styles:
// long names/reasons, wrapped actions, errors/retries, modal containment,
// keyboard/focus, screen-reader announcements, and no page-level overflow.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createServer} from 'node:http'
import {fileURLToPath, pathToFileURL} from 'node:url'
import path from 'node:path'

const dependencies = process.env.FOLLOW01_NODE_MODULES
if (!dependencies) throw new Error('Set FOLLOW01_NODE_MODULES to an existing isolated node_modules directory.')
const require = createRequire(path.join(dependencies, '..', 'package.json'))
const {build} = require('esbuild')
const {chromium} = await import(pathToFileURL(path.join(dependencies, 'playwright/index.mjs')))
const root = fileURLToPath(new URL('..', import.meta.url))
const source = `
import React from 'react'
import {createRoot} from 'react-dom/client'
import {flushSync} from 'react-dom'
import {FollowupPanel, FollowupsServerPage} from './src/pages/ServerFollowups.jsx'
const pending = new Map()
window.follow01 = {
  calls: [], feedback: [],
  request(method, id, body) {
    const index = this.calls.length
    this.calls.push({method, id, body})
    return new Promise(resolve => pending.set(index, resolve))
  },
  respond(index, response) {
    if (!pending.has(index)) throw new Error('Unknown pending request: ' + index)
    pending.get(index)(response); pending.delete(index)
  },
}
function Harness() {
  const [options, setOptions] = React.useState({patient: 'A', mode: 'panel', role: 'staff', session: 'one'})
  window.follow01.set = patch => flushSync(() => setOptions(previous => ({...previous, ...patch})))
  const toast = (...args) => window.follow01.feedback.push(args)
  const branches = [{id: 'b1', name: 'Synthetic branch'}]
  const store = {session: {role: options.role, serverUserId: options.session}, state: {branches}, toast}
  return options.mode === 'hidden' ? null : options.mode === 'panel'
    ? <FollowupPanel patientId={options.patient} branches={branches} toast={toast} store={store} role={options.role}/>
    : <FollowupsServerPage store={store} role={options.role} context={options.mode === 'patient-page' ? {patientId: 'local', patientPublicId: options.patient} : null} setPage={()=>{}}/>
}
createRoot(document.getElementById('root')).render(<Harness/>);
`
const api = `
const call = (method, id, body) => window.follow01.request(method, id, body)
export const patientFollowups = id => call('patient', id)
export const followups = filters => call('list', null, filters)
export const createFollowup = body => call('create', body.patient_id, body)
export const updateFollowup = (id, body) => call('update', id, body)
`
const booking = `
import React from 'react'
// Deliberately delayed callback boundary; it never claims a follow-up was linked.
export function AppointmentForm({prefill, store, onSaved, submitLabel}) {
  const [error, setError] = React.useState('')
  return <><button onClick={async()=>{
    const result = await window.follow01.request('booking', prefill.patientPublicId, prefill)
    if (!result.ok) { setError(result.message); store.toast(result.message, 'warning'); return }
    store.toast('Synthetic appointment confirmed.', 'success'); onSaved(result.record)
  }}>{submitLabel}</button>{error && <p role="alert">{error}</p>}</>
}
`
const session = `export const useClinicalSession = store => store.session.role !== 'dentist' || store.session.serverUserId === 'one'`
const bundle = await build({
  absWorkingDir: root, stdin: {contents: source, resolveDir: root, loader: 'jsx'},
  bundle: true, write: false, format: 'iife', platform: 'browser', nodePaths: [dependencies],
  plugins: [{name: 'follow01-isolation', setup(b) {
    b.onResolve({filter: /(?:api-client\.js|Scheduling\.jsx|use-clinical-session\.js)$/}, args => ({path: args.path, namespace: 'follow01'}))
    b.onLoad({filter: /.*/, namespace: 'follow01'}, args => ({contents: args.path.endsWith('Scheduling.jsx') ? booking : args.path.endsWith('use-clinical-session.js') ? session : api, loader: 'jsx', resolveDir: root}))
  }}],
})
const server = createServer((req, res) => {
  if (req.url === '/harness.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents) }
  else if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script src="/harness.js"></script>') }
  else { res.statusCode = 404; res.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
const completed = []
const task = (patient = 'A', extra = {}) => ({id: 'task-' + patient, patient: {id: patient, name: 'Synthetic ' + patient, code: 'Synthetic code', phone: ''}, branch: {id: 'b1', name: 'Synthetic branch'},
  service: {id: 'svc1', name: 'Synthetic service'}, reason: 'Synthetic reason ' + patient, assignee: 'Synthetic assignee', status: 'Open', due_on: '2026-11-20', revision: 1, can_book: true, can_contact: true, can_close: true, ...extra})
const ok = data => ({ok: true, data})
const failure = {ok: false, kind: 'validation', message: 'Synthetic refusal', errors: {reason: ['Synthetic refusal']}}
const waitCalls = (p, count) => p.waitForFunction(count => window.follow01.calls.length === count, count)
const calls = p => p.evaluate(() => window.follow01.calls)
const respond = async (p, index, response) => {
  await p.evaluate(({index, response}) => window.follow01.respond(index, response), {index, response})
  await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
const change = async (p, patch, count) => { await p.evaluate(patch => window.follow01.set(patch), patch); if (count) await waitCalls(p, count) }
const button = (p, name) => p.getByRole('button', {name, exact: true})
const reason = p => p.getByRole('combobox', {name: /^Follow-up reason/})
const custom = p => p.getByRole('textbox', {name: /^Specify reason/})
const due = p => p.getByLabel(/^Due/)
const double = locator => locator.evaluate(element => { element.click(); element.click() })
async function draft(p, value = 'Synthetic custom reason') {
  await button(p, 'Add a follow-up').click(); await reason(p).selectOption('Other')
  await custom(p).fill(value); await due(p).fill('2026-11-25')
}
async function check(name, run) {
  const p = await browser.newPage(), errors = []
  p.on('pageerror', error => errors.push(error.message))
  await p.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort())
  try {
    await p.goto(origin); await waitCalls(p, 1); await run(p)
    assert.deepEqual(errors, []); completed.push(name)
  } finally { await p.close() }
}
try {
  browser = await chromium.launch({headless: true})
  await check('loading, failure, retry and genuine empty are distinct', async p => {
    assert.equal(await p.getByText('Loading follow-ups…', {exact: true}).count(), 1)
    await respond(p, 0, {ok: false, kind: 'server', message: 'Synthetic outage'})
    assert.equal(await p.getByRole('alert').count(), 1)
    assert.equal(await p.getByText('No follow-ups for this patient.', {exact: true}).count(), 0)
    await button(p, 'Reload follow-ups').click(); await waitCalls(p, 2)
    await respond(p, 1, ok([]))
    assert.equal(await p.getByText('No follow-ups for this patient.', {exact: true}).count(), 1)
  })
  await check('successful patient list and failed context switch hide previous clinical details', async p => {
    await respond(p, 0, ok([task('A')]))
    assert.equal(await p.getByText('Synthetic reason A', {exact: false}).count(), 1)
    await change(p, {patient: 'B'}, 2)
    await respond(p, 1, {ok: false, kind: 'forbidden'})
    assert.equal(await p.getByText('Synthetic reason A', {exact: false}).count(), 0)
    assert.equal(await p.getByRole('alert').count(), 1)
  })
  await check('A to B to A cannot revive old reads or drafts', async p => {
    await change(p, {patient: 'B'}, 2); await change(p, {patient: 'A'}, 3)
    await respond(p, 2, ok([])); await draft(p)
    await respond(p, 0, ok([task('A')])); await respond(p, 1, ok([task('B')]))
    assert.equal(await p.getByText('Synthetic reason A', {exact: false}).count(), 0)
    assert.equal(await custom(p).inputValue(), 'Synthetic custom reason')
    await change(p, {patient: 'B'}, 4); await respond(p, 3, ok([]))
    assert.equal(await custom(p).count(), 0)
  })
  await check('unmounted reads and commands emit no feedback', async p => {
    await change(p, {mode: 'hidden'}); await respond(p, 0, ok([task()]))
    await change(p, {mode: 'panel'}, 2); await respond(p, 1, ok([])); await draft(p)
    await button(p, 'Add follow-up').click(); await waitCalls(p, 3)
    await change(p, {mode: 'hidden'}); await respond(p, 2, ok(task()))
    assert.deepEqual(await p.evaluate(() => window.follow01.feedback), [])
    assert.equal((await calls(p)).length, 3)
  })
  await check('newer filters own rows and counts, including filter A to B to A', async p => {
    await change(p, {mode: 'page'}, 2)
    await p.getByRole('combobox', {name: /^Status/}).selectOption('Closed'); await waitCalls(p, 3)
    await p.getByRole('combobox', {name: /^Status/}).selectOption('active'); await waitCalls(p, 4)
    await respond(p, 3, {ok: true, data: [task('B')], meta: {counts: {open: 7}}})
    await respond(p, 1, {ok: true, data: [task('A')], meta: {counts: {open: 99}}})
    await respond(p, 2, ok([]))
    assert.equal(await p.getByText('Synthetic reason B', {exact: false}).count(), 1)
    assert.equal(await p.getByText('Synthetic reason A', {exact: false}).count(), 0)
    assert.equal(await p.locator('.fu-counts b').first().innerText(), '7')
    assert.deepEqual((await calls(p))[3].body, {status: 'active', due: 'all', branch_ref: ''})
  })
  await check('Create double click, captured payload and same-patient recovery', async p => {
    await respond(p, 0, ok([])); await draft(p, '  Synthetic custom reason  ')
    await double(button(p, 'Add follow-up')); await waitCalls(p, 2)
    assert.equal(await custom(p).isDisabled(), true)
    assert.deepEqual((await calls(p))[1], {method: 'create', id: 'A', body: {patient_id: 'A', reason: 'Synthetic custom reason', branch_ref: 'b1', due_on: '2026-11-25'}})
    await respond(p, 1, failure)
    assert.equal(await custom(p).inputValue(), '  Synthetic custom reason  ')
    assert.equal(await due(p).inputValue(), '2026-11-25')
    await button(p, 'Add follow-up').click(); await waitCalls(p, 3)
    await respond(p, 2, ok(task())); await waitCalls(p, 4); await respond(p, 3, ok([task()]))
    assert.equal(await custom(p).count(), 0)
  })
  await check('late Create cannot clear the new A draft or refresh it', async p => {
    await respond(p, 0, ok([])); await draft(p); await button(p, 'Add follow-up').click(); await waitCalls(p, 2)
    await change(p, {patient: 'B'}, 3); await change(p, {patient: 'A'}, 4); await respond(p, 3, ok([])); await draft(p, 'New A draft')
    await respond(p, 1, ok(task()))
    assert.equal(await custom(p).inputValue(), 'New A draft')
    assert.equal((await calls(p)).length, 4)
    assert.deepEqual(await p.evaluate(() => window.follow01.feedback), [])
  })
  await check('session replacement invalidates the same patient editor', async p => {
    await respond(p, 0, ok([])); await draft(p); await button(p, 'Add follow-up').click(); await waitCalls(p, 2)
    await change(p, {session: 'two'}, 3); await respond(p, 2, ok([]))
    await respond(p, 1, ok(task()))
    assert.equal(await custom(p).count(), 0)
    assert.equal((await calls(p)).length, 3)
    assert.deepEqual(await p.evaluate(() => window.follow01.feedback), [])
  })
  await check('Contacted success refreshes canonical status', async p => {
    await respond(p, 0, ok([task()])); await button(p, 'Contacted').click(); await waitCalls(p, 2)
    const contacted = task('A', {status: 'Contacted', revision: 2, can_contact: false})
    await respond(p, 1, ok(contacted)); await waitCalls(p, 3); await respond(p, 2, ok([contacted]))
    assert.equal(await p.getByText('Contacted', {exact: true}).count(), 1)
    assert.equal(await button(p, 'Contacted').count(), 0)
  })
  for (const action of ['contacted', 'close']) {
    await check('duplicate and stale ' + action + ' command', async p => {
      await respond(p, 0, ok([task()]))
      if (action === 'close') { await button(p, 'Close').click(); await p.getByRole('textbox', {name: /^Why is it closed/}).fill('Synthetic closure note') }
      await double(button(p, action === 'contacted' ? 'Contacted' : 'Close it')); await waitCalls(p, 2)
      assert.equal((await calls(p))[1].id, 'task-A')
      assert.equal((await calls(p))[1].body.action, action)
      await change(p, {patient: 'B'}, 3); await respond(p, 2, ok([task('B')]))
      await respond(p, 1, ok(task('A', {status: action === 'close' ? 'Closed' : 'Contacted', revision: 2})))
      assert.equal((await calls(p)).length, 3)
      assert.deepEqual(await p.evaluate(() => window.follow01.feedback), [])
    })
  }
  await check('Close failure retains the entered note', async p => {
    await respond(p, 0, ok([task()])); await button(p, 'Close').click()
    const note = p.getByRole('textbox', {name: /^Why is it closed/})
    await note.fill('Synthetic closure note'); await button(p, 'Close it').click(); await waitCalls(p, 2)
    await respond(p, 1, failure)
    assert.equal(await note.inputValue(), 'Synthetic closure note')
    assert.equal(await button(p, 'Close it').isEnabled(), true)
  })
  await check('Other required semantics, whitespace, due date and clearing', async p => {
    await respond(p, 0, ok([])); await button(p, 'Add a follow-up').click(); await reason(p).selectOption('Other')
    assert.equal(await custom(p).getAttribute('aria-required'), 'true')
    await custom(p).fill('   '); await custom(p).press('Tab')
    assert.equal(await custom(p).getAttribute('aria-invalid'), 'true')
    assert.equal(await button(p, 'Add follow-up').isDisabled(), true)
    await custom(p).fill('Synthetic reason'); await due(p).fill('')
    assert.equal(await button(p, 'Add follow-up').isDisabled(), true)
    await reason(p).selectOption('Suture Removal'); await reason(p).selectOption('Other')
    assert.equal(await custom(p).inputValue(), '')
  })
  await check('booking callback failure and success preserve identity and await canonical task status', async p => {
    await respond(p, 0, ok([task()])); await button(p, 'Book follow-up').click()
    await button(p, 'Book the follow-up').click(); await waitCalls(p, 2)
    assert.deepEqual((await calls(p))[1].body, {patientPublicId: 'A', patientName: 'Synthetic A • Synthetic code', branchId: 'b1', serviceId: 'svc1', date: '2026-11-20'})
    await respond(p, 1, {ok: false, message: 'Synthetic booking refusal'})
    assert.equal((await calls(p)).length, 2)
    assert.equal(await p.getByText('Open', {exact: true}).count(), 1)
    await button(p, 'Book the follow-up').click(); await waitCalls(p, 3)
    await respond(p, 2, {ok: true, record: {id: 'appointment-A'}}); await waitCalls(p, 4)
    // The server may have linked a different eligible task. Never fabricate Booked here.
    await respond(p, 3, ok([task()]))
    assert.equal(await p.getByText('Open', {exact: true}).count(), 1)
    assert.equal(await p.getByText('Booked', {exact: true}).count(), 0)
  })
  await check('late booking callback cannot toast or refresh another patient', async p => {
    await respond(p, 0, ok([task()])); await button(p, 'Book follow-up').click(); await button(p, 'Book the follow-up').click(); await waitCalls(p, 2)
    await change(p, {patient: 'B'}, 3); await respond(p, 2, ok([task('B')]))
    await respond(p, 1, {ok: true, record: {id: 'appointment-A'}})
    assert.equal((await calls(p)).length, 3)
    assert.deepEqual(await p.evaluate(() => window.follow01.feedback), [])
  })
  await check('Owner redaction and patient-role refusal', async p => {
    await change(p, {mode: 'page', role: 'owner'}, 2)
    // Extra fields deliberately probe the rendering boundary, beyond the normal metadata projection.
    await respond(p, 1, ok([task('A', {close_note: 'Private note', appointment: {code: 'Private appointment', when: 'Private time'}})]))
    for (const text of ['Synthetic A', 'Synthetic reason A', 'Private note', 'Private appointment']) assert.equal(await p.getByText(text, {exact: false}).count(), 0)
    for (const name of ['Contacted', 'Close', 'Book follow-up', 'Add a follow-up']) assert.equal(await button(p, name).count(), 0)
    await change(p, {role: 'patient'})
    assert.equal((await calls(p)).length, 2)
    assert.equal(await p.getByText('Follow-up information is unavailable for this role.', {exact: true}).count(), 1)
  })
  await check('Dentist cannot book and an unavailable clinical session hides follow-ups', async p => {
    await change(p, {mode: 'page', role: 'dentist'}, 2); await respond(p, 1, ok([task()]))
    assert.equal(await button(p, 'Book follow-up').count(), 0)
    assert.equal(await button(p, 'Contacted').count(), 1)
    await change(p, {session: 'expired'})
    assert.equal(await p.getByText('Clinical session unavailable. Follow-up information is hidden.', {exact: true}).count(), 1)
    assert.equal(await p.getByText('Synthetic reason A', {exact: false}).count(), 0)
  })
  await check('patient page uses the authoritative public ID and rejects mismatched data', async p => {
    await change(p, {mode: 'patient-page', patient: 'B'}, 2)
    assert.equal((await calls(p))[1].id, 'B')
    await respond(p, 1, ok([task('A')]))
    assert.equal(await p.getByRole('alert').count(), 1)
    assert.equal(await p.getByText('Synthetic reason A', {exact: false}).count(), 0)
  })
  console.log(JSON.stringify({completed, limits: 'Mocked components only; actual booking API/task linkage, auth enforcement and styled viewport acceptance remain deferred.'}, null, 2))
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}

// CLIN-08: prepared for the final testing phase; not executed during development.
// Uses real CounterIntake/Field components with an entirely in-memory API stub.
// Requires an explicitly supplied dependency directory; never contacts a backend.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createServer} from 'node:http'
import {fileURLToPath, pathToFileURL} from 'node:url'
import path from 'node:path'

const dependencies = process.env.CLIN08_NODE_MODULES
if (!dependencies) throw new Error('Set CLIN08_NODE_MODULES to an existing isolated node_modules directory.')
const require = createRequire(path.join(dependencies, '..', 'package.json'))
const {build} = require('esbuild')
const {chromium} = await import(pathToFileURL(path.join(dependencies, 'playwright/index.mjs')))
const root = fileURLToPath(new URL('..', import.meta.url))
const source = `
import React from 'react'
import {createRoot} from 'react-dom/client'
import {flushSync} from 'react-dom'
import {IdCheck, SelfRegistered} from './src/pages/CounterIntake.jsx'
const pending = new Map()
window.clin08 = {
  calls: [], feedback: [],
  request(method, patientId, body) {
    const index = this.calls.length
    this.calls.push({method, patientId, body})
    return new Promise(resolve => pending.set(index, resolve))
  },
  respond(index, response) {
    if (!pending.has(index)) throw new Error('Unknown pending request: ' + index)
    pending.get(index)(response); pending.delete(index)
  },
}
function Harness() {
  const [patient, setPatient] = React.useState('A')
  const [mode, setMode] = React.useState('id')
  window.clin08.select = id => flushSync(() => setPatient(id))
  window.clin08.mode = value => flushSync(() => setMode(value))
  const toast = (...args) => window.clin08.feedback.push(args)
  return mode === 'id' ? <IdCheck patientId={patient} toast={toast}/>
    : mode === 'review' ? <SelfRegistered toast={toast} store={{state:{}}}/> : null
}
createRoot(document.getElementById('root')).render(<Harness/>);
`
const api = `
const call = (method, patientId, body) => window.clin08.request(method, patientId, body)
export const getPatientRecord = id => call('record', id)
export const verifyPatientId = (id, body) => call('verify', id, body)
export const pendingIntake = () => call('pending')
export const confirmIntake = (id, body) => call('confirm', id, body)
export const offerOnlineAccount = (id, body) => call('offer', id, body)
export const cancelIntake = () => { throw new Error('Unexpected cancel') }
export const requestHandover = () => { throw new Error('Unexpected handover') }
export const branchPosterUrl = () => { throw new Error('Unexpected poster') }
export const intakeCode = () => { throw new Error('Unexpected counter code') }
export const refreshIntakeCode = () => { throw new Error('Unexpected counter refresh') }
`
// The plugin prevents loading the real API client.
const bundle = await build({
  absWorkingDir: root, stdin: {contents: source, resolveDir: root, loader: 'jsx'},
  bundle: true, write: false, format: 'iife', platform: 'browser', nodePaths: [dependencies],
  plugins: [{name: 'clin08-api-isolation', setup(b) {
    b.onResolve({filter: /api-client\.js$/}, () => ({path: 'stub', namespace: 'clin08'}))
    b.onLoad({filter: /.*/, namespace: 'clin08'}, () => ({contents: api, loader: 'js'}))
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
const record = (id, extra = {}) => ({ok: true, data: {id, name: 'Synthetic ' + id, profile_access: 'full', has_online_account: true, id_check: null, ...extra}})
const verified = (type = 'philid', other_details = null) => ({ok: true, data: {id_type: type, other_details, id_verified_at: '2026-11-06T08:00:00+08:00'}})
const calls = p => p.evaluate(() => window.clin08.calls)
const respond = async (p, index, response) => {
  await p.evaluate(({index, response}) => window.clin08.respond(index, response), {index, response})
  await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
const waitCalls = (p, n) => p.waitForFunction(n => window.clin08.calls.length === n, n)
const select = async (p, id, count) => { await p.evaluate(id => window.clin08.select(id), id); await waitCalls(p, count) }
const idType = p => p.getByRole('combobox', {name: /^ID shown/})
const other = p => p.getByRole('textbox', {name: /^Specify ID type/})
const submit = p => p.getByRole('button', {name: 'ID checked', exact: true})
async function check(name, run) {
  const p = await browser.newPage()
  const errors = []
  p.on('pageerror', e => errors.push(e.message))
  await p.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort())
  try {
    await p.goto(origin); await waitCalls(p, 1)
    await run(p)
    assert.deepEqual(errors, [])
    completed.push(name)
  } finally { await p.close() }
}
try {
  browser = await chromium.launch({headless: true})
  await check('late A record never populates B', async p => {
    await select(p, 'B', 2)
    await respond(p, 0, record('A', {id_check: {type: 'senior'}}))
    assert.equal(await p.getByText(/Loading patient ID status/).count(), 1)
    assert.equal(await p.getByText(/ID checked:/).count(), 0)
    await respond(p, 1, record('B'))
    assert.equal(await idType(p).inputValue(), 'philid')
  })
  await check('A to B to A has a fresh lifetime', async p => {
    await select(p, 'B', 2); await select(p, 'A', 3)
    await respond(p, 2, record('A'))
    await idType(p).selectOption('other'); await other(p).fill('Company ID')
    await respond(p, 0, record('A', {id_check: {type: 'pwd'}}))
    await respond(p, 1, record('B', {id_check: {type: 'senior'}}))
    assert.equal(await other(p).inputValue(), 'Company ID')
    assert.equal(await p.getByText(/ID checked:/).count(), 0)
  })
  await check('pending verification retains original identity and cannot affect a new A lifetime', async p => {
    await respond(p, 0, record('A'))
    await idType(p).selectOption('other'); await other(p).fill('  Company ID  ')
    await submit(p).click(); await waitCalls(p, 2)
    await select(p, 'B', 3); await respond(p, 2, record('B'))
    assert.equal(await idType(p).inputValue(), 'philid')
    await select(p, 'A', 4); await respond(p, 3, record('A'))
    await respond(p, 1, verified('other', 'Company ID'))
    assert.equal(await idType(p).inputValue(), 'philid')
    assert.equal(await p.getByText(/ID checked:/).count(), 0)
    assert.deepEqual((await calls(p))[1], {method: 'verify', patientId: 'A', body: {id_type: 'other', other_details: 'Company ID'}})
    assert.deepEqual(await p.evaluate(() => window.clin08.feedback), [])
  })
  await check('unmounted verification emits no feedback', async p => {
    await respond(p, 0, record('A')); await submit(p).click(); await waitCalls(p, 2)
    await p.evaluate(() => window.clin08.mode('hidden'))
    await respond(p, 1, verified())
    assert.deepEqual(await p.evaluate(() => window.clin08.feedback), [])
  })
  await check('mismatched patient record fails closed', async p => {
    await respond(p, 0, record('B'))
    assert.equal(await p.getByRole('alert').count(), 1)
    assert.equal(await submit(p).count(), 0)
  })
  await check('Other required semantics, clearing, duplicate guard and retained retry', async p => {
    await respond(p, 0, record('A')); await idType(p).selectOption('other')
    assert.equal(await other(p).getAttribute('aria-required'), 'true')
    assert.equal(await other(p).getAttribute('required'), '')
    assert.equal(await submit(p).isDisabled(), true)
    await other(p).fill('   '); await other(p).press('Tab')
    assert.equal(await other(p).getAttribute('aria-invalid'), 'true')
    assert.equal(await p.getByText('Specify the ID type.', {exact: true}).count(), 1)
    await other(p).fill('Old detail'); await idType(p).selectOption('passport'); await idType(p).selectOption('other')
    assert.equal(await other(p).inputValue(), '')
    await other(p).fill('  Company ID  ')
    await submit(p).evaluate(button => { button.click(); button.click() })
    await waitCalls(p, 2)
    assert.equal(await idType(p).isDisabled(), true)
    await respond(p, 1, {ok: false, kind: 'validation', errors: {other_details: ['Synthetic field refusal']}, message: 'Check the ID type.'})
    assert.equal(await other(p).inputValue(), '  Company ID  ')
    assert.equal(await other(p).getAttribute('aria-invalid'), 'true')
    assert.equal(await p.getByText('Synthetic field refusal', {exact: true}).count(), 1)
    await other(p).fill('Company ID'); await submit(p).focus(); await p.keyboard.press('Enter'); await waitCalls(p, 3)
    await respond(p, 2, verified('other', 'Company ID'))
    assert.equal(await p.getByText('ID checked: Other valid ID (Company ID).', {exact: true}).count(), 1)
  })
  for (const kind of ['forbidden', 'unauthenticated', 'network', 'not_found']) {
    await check('record failure and explicit reload: ' + kind, async p => {
      await respond(p, 0, {ok: false, kind, message: 'Synthetic record failure'})
      assert.equal(await p.getByRole('alert').count(), 1)
      assert.equal(await submit(p).count(), 0)
      await p.getByRole('button', {name: 'Reload ID status'}).click(); await waitCalls(p, 2)
      await respond(p, 1, record('A')); assert.equal(await submit(p).isEnabled(), true)
    })
  }
  await check('network failure preserves the same-patient values and offers status recovery', async p => {
    await respond(p, 0, record('A')); await idType(p).selectOption('other'); await other(p).fill('Company ID')
    await submit(p).click(); await waitCalls(p, 2)
    await respond(p, 1, {ok: false, kind: 'network', message: 'Synthetic connection failure'})
    assert.equal(await other(p).inputValue(), 'Company ID')
    assert.equal(await submit(p).isEnabled(), true)
    assert.equal(await p.getByRole('button', {name: 'Reload ID status'}).count(), 1)
    assert.deepEqual(await p.evaluate(() => window.clin08.feedback), [])
  })
  await check('verification permission failure and malformed success never acknowledge an ID check', async p => {
    await respond(p, 0, record('A')); await submit(p).click(); await waitCalls(p, 2)
    await respond(p, 1, {ok: false, kind: 'forbidden'})
    assert.equal(await submit(p).isDisabled(), true)
    await p.getByRole('button', {name: 'Reload ID status'}).click(); await waitCalls(p, 3)
    await respond(p, 2, record('A')); await submit(p).click(); await waitCalls(p, 4)
    await respond(p, 3, {ok: true, data: {}})
    assert.equal(await submit(p).isDisabled(), true)
    assert.deepEqual(await p.evaluate(() => window.clin08.feedback), [])
  })
  await check('identity-only records expose no verification controls', async p => {
    await respond(p, 0, {ok: true, data: {id: 'A', profile_access: 'identity'}})
    assert.equal(await p.getByText(/unavailable with your current access/).count(), 1)
    assert.equal(await submit(p).count(), 0)
  })
  await check('minor guardian guidance and verified record remain read-only', async p => {
    await respond(p, 0, record('A', {minor: true, has_online_account: false, guardians: [{name: 'Synthetic guardian'}]}))
    assert.equal(await p.getByText(/For a minor, check the guardian/).count(), 1)
    assert.equal(await p.getByText('Minor: guardian Synthetic guardian', {exact: true}).count(), 1)
    await select(p, 'B', 2)
    await respond(p, 1, record('B', {minor: true, has_online_account: false, guardians: [], id_check: {type: 'passport', by: 'Synthetic staff'}}))
    assert.equal(await submit(p).count(), 0)
    assert.equal(await p.getByText(/Under 18: no online account of their own/).count(), 1)
    assert.equal(await p.getByRole('button', {name: 'Offer online account'}).count(), 0)
  })
  await check('nested account offer cannot emit feedback after a patient switch', async p => {
    await respond(p, 0, record('A', {has_online_account: false, email: 'synthetic@example.invalid', id_check: {type: 'passport'}}))
    await p.getByRole('button', {name: 'Offer online account'}).click()
    await p.getByRole('button', {name: 'Email a one-time link'}).click(); await waitCalls(p, 2)
    await select(p, 'B', 3); await respond(p, 2, record('B'))
    await respond(p, 1, {ok: true, data: {message: 'Synthetic offer result', status: 'transport_accepted'}})
    assert.deepEqual(await p.evaluate(() => window.clin08.feedback), [])
    assert.equal(await submit(p).isEnabled(), true)
  })
  await check('review Other requirement follows the existing ID-checked acknowledgment', async p => {
    await p.evaluate(() => window.clin08.mode('review')); await waitCalls(p, 2)
    await respond(p, 1, {ok: true, data: [{id: 'R', reference: 'Synthetic registration', self: {first_name: 'Synthetic', last_name: 'Patient'}, dependents: [], join_queue: false}], meta: {id_types: {philid: 'PhilID / ePhilID', other: 'Other valid ID'}}})
    await p.getByRole('button', {name: 'Review and confirm'}).click()
    await idType(p).selectOption('other')
    assert.equal(await p.getByRole('button', {name: 'Confirm', exact: true}).isEnabled(), true)
    await p.getByRole('checkbox').check(); await other(p).fill('   '); await other(p).press('Tab')
    assert.equal(await p.getByRole('button', {name: 'Confirm', exact: true}).isDisabled(), true)
    assert.equal(await other(p).getAttribute('aria-required'), 'true')
    await other(p).fill('Company ID'); await idType(p).selectOption('philid'); await idType(p).selectOption('other')
    assert.equal(await other(p).inputValue(), '')
  })
  console.log(JSON.stringify({completed, note: 'Mocked component checks only; no authenticated acceptance or responsive styling proof.'}, null, 2))
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}

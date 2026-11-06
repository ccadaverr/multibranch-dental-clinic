// Authored only; requires separately approved browser execution.
// Reuses CLIN-08's isolated esbuild/Playwright component-harness convention.
// All APIs are in-memory; this cannot establish authenticated acceptance.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createServer} from 'node:http'
import {fileURLToPath, pathToFileURL} from 'node:url'
import path from 'node:path'

const dependencies = process.env.CLIN08_NODE_MODULES
if (!dependencies) throw new Error('Set CLIN08_NODE_MODULES to an existing isolated dependency directory.')
const require = createRequire(path.join(dependencies, '..', 'package.json'))
const {build} = require('esbuild')
const {chromium} = await import(pathToFileURL(path.join(dependencies, 'playwright/index.mjs')))
const root = fileURLToPath(new URL('..', import.meta.url))
const patientId = '01K8R000000000000000000001'
const rows = ['A', 'B'].map((letter, i) => ({
  id: `01K8R00000000000000000000${i + 2}`, reference: `CI-SYNTHETIC-${letter}`, branch_ref: i ? 'b2' : 'b1', channel: 'phone',
  self: {first_name: `Synthetic ${letter}`, last_name: 'Guardian', date_of_birth: '1990-01-01', sex: 'Female', phone: '+639171234567', email: 'synthetic@example.invalid', address: 'Synthetic address', emergency_contact: {name: 'Synthetic emergency contact', phone: '+639181234567'}},
  dependents: [{first_name: `Child ${letter}`, last_name: 'Synthetic', date_of_birth: '2020-01-01', minor: true, relationship: 'Child'}],
  visit_for: 'dependent:0', join_queue: true, id_type: 'philid',
  duplicates: [{patient_id: patientId, name: 'Synthetic existing guardian', code: 'TEST-001', has_account: false, id_verified: false}],
}))
const source = `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
import {SelfRegistered} from './src/pages/CounterIntake.jsx';
const pending = new Map();
window.review = {rows: ${JSON.stringify(rows)}, calls: [], feedback: [], changes: 0,
  request(action, id, body) {const index = this.calls.length; this.calls.push({action,id,body}); return new Promise(resolve => pending.set(index,resolve))},
  respond(index,r) {if(!pending.has(index))throw new Error('Unknown request');pending.get(index)(r);pending.delete(index)},
};
function Harness() {
 const [shown,setShown]=React.useState(true), [actor,setActor]=React.useState('staff-A');
 window.review.show=v=>flushSync(()=>setShown(v)); window.review.actor=v=>flushSync(()=>setActor(v));
 const state={services:[{id:'svc1',name:'Synthetic service',status:'Active'}],branchServices:[{branchId:'b1',serviceId:'svc1',active:true},{branchId:'b2',serviceId:'svc1',active:true}],dentists:[{id:'d1',name:'Synthetic dentist',branchIds:['b1'],serviceIds:['svc1'],available:true}]};
 return shown?<SelfRegistered store={{state,session:{serverUserId:actor,role:'staff',userId:actor,branchId:'b1'}}} toast={(...args)=>window.review.feedback.push(args)} onChanged={()=>window.review.changes++}/>:null;
} createRoot(document.getElementById('root')).render(<Harness/>);
`
const api = `
export const pendingIntake=async()=>({ok:true,data:window.review.rows,meta:{id_types:{philid:'PhilID / ePhilID',other:'Other valid ID'}}});
export const confirmIntake=(id,body)=>window.review.request('confirm',id,body);
export const cancelIntake=id=>window.review.request('cancel',id);
export const getPatientRecord=()=>{throw new Error('Unexpected IdCheck API')};
export const verifyPatientId=getPatientRecord, offerOnlineAccount=getPatientRecord, requestHandover=getPatientRecord, branchPosterUrl=getPatientRecord, intakeCode=getPatientRecord, refreshIntakeCode=getPatientRecord;
`
const bundle = await build({absWorkingDir: root, stdin: {contents: source, resolveDir: root, loader: 'jsx'}, bundle: true, write: false, format: 'iife', platform: 'browser', nodePaths: [dependencies],
  plugins: [{name: 'review-api-isolation', setup(b) {
    b.onResolve({filter: /api-client\.js$/}, () => ({path: 'stub', namespace: 'review'}))
    b.onLoad({filter: /.*/, namespace: 'review'}, () => ({contents: api, loader: 'js'}))
  }}],
})
const server = createServer((req, res) => {
  if (req.url === '/harness.js') {res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents)}
  else if (req.url === '/') {res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><div id="root"></div><script src="/harness.js"></script>')}
  else {res.statusCode = 404; res.end()}
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
const completed = []
const frames = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
const dialog = p => p.getByRole('dialog')
const button = (p, name) => p.getByRole('button', {name, exact: true})
const calls = p => p.evaluate(() => window.review.calls)
const feedback = p => p.evaluate(() => window.review.feedback)
const confirm = p => button(dialog(p), 'Confirm and check in')
const field = (p, name) => dialog(p).getByRole('textbox', {name: new RegExp('^' + name)})
const open = async (p, index = 0) => {await button(p, 'Review and confirm').nth(index).click(); await dialog(p).waitFor()}
const close = async p => {await p.keyboard.press('Escape'); await dialog(p).waitFor({state: 'detached'})}
const result = (index = 0, visit = null) => ({ok: true, data: {reference: rows[index].reference, status: 'confirmed', patient: {id: patientId, code: 'TEST-001', name: 'Synthetic accepted patient'}, visit_id: visit}})
const respond = async (p, index, r) => {await p.evaluate(({index,r}) => window.review.respond(index,r), {index,r}); await frames(p)}
const waitCalls = (p, count) => p.waitForFunction(n => window.review.calls.length === n, count)
async function check(name, run) {
  const p = await browser.newPage(), errors = []
  p.on('pageerror', e => errors.push(e.message))
  await p.route('**/*', r => r.request().url().startsWith(origin + '/') ? r.continue() : r.abort())
  try {await p.goto(origin); await button(p, 'Review and confirm').first().waitFor(); await run(p); assert.deepEqual(errors, []); completed.push(name)}
  finally {await p.close()}
}
try {
  browser = await chromium.launch({headless: true})
  for (const visit of [null, '01K8R000000000000000000010']) await check(`confirmation wording follows accepted admission ${!!visit}`, async p => {
    await open(p); await confirm(p).click(); await waitCalls(p, 1); await respond(p, 0, result(0, visit))
    assert.equal(await dialog(p).count(), 0); assert.equal(await p.evaluate(() => window.review.changes), 1)
    const message = (await feedback(p))[0][0]
    assert.equal(message.includes('checked in'), !!visit); assert.doesNotMatch(message, /queue|notified|delivered/)
  })
  await check('Remove uses accepted cancellation; no admission claim', async p => {
    await open(p); await button(dialog(p), 'Remove').click(); await waitCalls(p, 1)
    assert.equal((await calls(p))[0].action, 'cancel')
    await respond(p, 0, {ok: true, data: {reference: rows[0].reference, status: 'cancelled'}})
    assert.deepEqual(await feedback(p), [['Registration removed.', 'success']]); assert.equal(await dialog(p).count(), 0)
  })
  for (const first of ['confirm', 'cancel']) await check(`same-tick ${first} wins duplicate/conflicting commands`, async p => {
    await open(p)
    await p.evaluate(first => {
      const d = document.querySelector('dialog'), buttons = [...d.querySelectorAll('button')]
      const c = buttons.find(b => b.textContent === 'Confirm and check in'), x = buttons.find(b => b.textContent === 'Remove')
      const a = first === 'confirm' ? c : x, b = first === 'confirm' ? x : c
      a.click(); a.click(); b.click()
    }, first)
    await waitCalls(p, 1); assert.equal((await calls(p))[0].action, first)
    assert.equal(await confirm(p).isDisabled(), true)
    assert.equal(await field(p, 'First name').isDisabled(), true)
  })
  for (const failure of [false, true]) for (const returnToA of [false, true]) await check(`late A ${failure ? 'failure' : 'success'} cannot adopt ${returnToA ? 'new A' : 'B'}`, async p => {
    await open(p); await confirm(p).click(); await waitCalls(p, 1); await close(p)
    await open(p, 1)
    if (returnToA) {await close(p); await open(p, 0)}
    await field(p, 'First name').fill('Replacement name')
    await respond(p, 0, failure ? {ok: false, message: 'Obsolete A error'} : result())
    assert.equal(await dialog(p).count(), 1); assert.equal(await field(p, 'First name').inputValue(), 'Replacement name')
    assert.equal(await p.getByRole('alert').count(), 0); assert.deepEqual(await feedback(p), [])
    assert.equal(await p.evaluate(() => window.review.changes), 0)
  })
  await check('same Patient new review instance cannot adopt old completion', async p => {
    await open(p); await confirm(p).click(); await waitCalls(p, 1); await close(p); await open(p)
    await field(p, 'First name').fill('New lifetime same Patient')
    await respond(p, 0, result()); assert.equal(await field(p, 'First name').inputValue(), 'New lifetime same Patient'); assert.deepEqual(await feedback(p), [])
  })
  await check('late cancelled A cannot close or announce a result for B', async p => {
    await open(p); await button(dialog(p), 'Remove').click(); await waitCalls(p, 1); await close(p); await open(p, 1)
    await field(p, 'First name').fill('B remains open')
    await respond(p, 0, {ok:true,data:{reference:rows[0].reference,status:'cancelled'}})
    assert.equal(await field(p, 'First name').inputValue(), 'B remains open'); assert.deepEqual(await feedback(p), [])
  })
  await check('failed confirmation preserves choice, Other, corrections, service and guardian', async p => {
    await open(p)
    await field(p, 'First name').fill('Corrected guardian')
    await dialog(p).getByRole('combobox', {name: /^Service today/}).selectOption('svc1')
    await dialog(p).getByRole('combobox', {name: /^Dentist/}).selectOption('d1')
    await dialog(p).getByRole('combobox', {name: /^ID shown/}).selectOption('other')
    await field(p, 'Specify ID type').fill('Company ID'); await dialog(p).getByRole('checkbox').check()
    await confirm(p).click(); await waitCalls(p, 1)
    const c = (await calls(p))[0]
    assert.equal(c.id, rows[0].id); assert.equal(c.body.use_patient, null)
    assert.equal(c.body.corrections.first_name, 'Corrected guardian'); assert.equal(c.body.other_details, 'Company ID')
    assert.equal(c.body.service_ref, 'svc1'); assert.equal(c.body.dentist_ref, 'd1')
    assert.equal('branch_id' in c.body, false); assert.equal('branch_ref' in c.body, false)
    assert.equal('dependents' in c.body, false, 'server retains original intake dependent context')
    await respond(p, 0, {ok: false, kind: 'validation', message: 'Synthetic recoverable refusal'})
    assert.equal(await field(p, 'First name').inputValue(), 'Corrected guardian')
    assert.equal(await field(p, 'Specify ID type').inputValue(), 'Company ID')
    assert.equal(await dialog(p).getByRole('combobox', {name: /^Dentist/}).inputValue(), 'd1')
    assert.equal(await dialog(p).getByText(/Child A Synthetic/).count(), 1)
    assert.equal(await p.getByRole('alert').textContent(), 'Synthetic recoverable refusal'); assert.deepEqual(await feedback(p), [])
  })
  await check('existing record remains an explicit choice, never a silent merge', async p => {
    await open(p); await dialog(p).getByRole('radio').first().check(); await confirm(p).click(); await waitCalls(p, 1)
    assert.equal((await calls(p))[0].body.use_patient, patientId); assert.deepEqual((await calls(p))[0].body.corrections, {})
  })
  await check('branch B review submits its own row and available service without branch substitution', async p => {
    await open(p, 1)
    await dialog(p).getByRole('combobox', {name:/^Service today/}).selectOption('svc1')
    assert.equal(await dialog(p).getByRole('combobox', {name:/^Dentist/}).locator('option').count(), 1, 'branch A dentist is not offered for B')
    await confirm(p).click(); await waitCalls(p, 1)
    const c=(await calls(p))[0]
    assert.equal(c.id, rows[1].id); assert.equal(c.body.service_ref, 'svc1'); assert.equal('dentist_ref' in c.body, false); assert.equal('branch_id' in c.body, false)
  })
  await check('result from wrong intake reference is not success', async p => {
    await open(p); await confirm(p).click(); await waitCalls(p, 1); await respond(p, 0, result(1))
    assert.equal(await p.getByRole('alert').count(), 1); assert.equal(await dialog(p).count(), 1); assert.deepEqual(await feedback(p), [])
  })
  for (const replacement of ['unmount', 'actor-A-B-A']) await check(`obsolete request after ${replacement} stays silent`, async p => {
    await open(p); await confirm(p).click(); await waitCalls(p, 1)
    if (replacement === 'unmount') await p.evaluate(() => window.review.show(false))
    else {await p.evaluate(() => window.review.actor('staff-B')); await p.evaluate(() => window.review.actor('staff-A')); await button(p, 'Review and confirm').first().waitFor(); await open(p)}
    await respond(p, 0, result()); assert.deepEqual(await feedback(p), [])
    if (replacement !== 'unmount') assert.equal(await dialog(p).count(), 1)
  })
  console.log(JSON.stringify({completed, evidence: 'Synthetic only; CLIN-08, real auth, queue placement and backend acceptance remain deferred.'}, null, 2))
} finally {await browser?.close(); await new Promise(resolve => server.close(resolve))}

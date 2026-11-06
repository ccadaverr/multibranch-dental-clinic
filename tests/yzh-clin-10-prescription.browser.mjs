// Authored only. Approval is required before running this browser/bundler code.
// Uses actual navigation/provider/components with in-memory APIs, following
// CLIN-08's harness convention. No backend/authenticated integration is claimed.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createServer} from 'node:http'
import {fileURLToPath, pathToFileURL} from 'node:url'
import path from 'node:path'

const dependencies = process.env.CLIN05_NODE_MODULES
if (!dependencies) throw new Error('Set CLIN05_NODE_MODULES to an existing isolated dependency directory.')
const require = createRequire(path.join(dependencies, '..', 'package.json'))
const {build} = require('esbuild')
const {chromium} = await import(pathToFileURL(path.join(dependencies, 'playwright/index.mjs')))
const root = fileURLToPath(new URL('..', import.meta.url))
const source = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {PrescriptionsServerPage} from './src/pages/ServerPrescriptions.jsx';
import {ClinicalNavigation,useClinicalNavigation} from './src/clinical-navigation.jsx';
import {clinicalFixture} from './tests/support/den-ui-02-fixture.js';
const pending=new Map();
window.rx10={calls:[],feedback:[],records:[],failVisits:false,failIssue:false,holdSave:false,holdIssue:false,
 request(command,id,body){const index=this.calls.length;this.calls.push({command,id,body});return new Promise(resolve=>pending.set(index,resolve))},
 respond(index,r){if(!pending.has(index))throw new Error('Unknown request');if(r.ok&&r.data?.id)this.records=[...this.records.filter(p=>p.id!==r.data.id),r.data];pending.get(index)(r);pending.delete(index)}
};
Object.assign(window.rx10,window.rx10Initial||{});
function Harness(){
 const base=clinicalFixture(),[page,setPage]=React.useState('prescriptions'),[owner,setOwner]=React.useState(false);
 window.rx10.owner=setOwner;
 const nav=useClinicalNavigation(owner?'owner':'dentist');
 const store={...base,toast:(...args)=>window.rx10.feedback.push(args)};
 const encounter={treatmentId:'t1',visitId:'visit-A',patientId:'p1',branchId:'b1',dentistId:'d1',appointmentId:null};
 if(window.rx10.returnEncounter){base.state.treatments=[{id:'t1',server:true,author:true,...encounter,status:'In Treatment'}];base.state.visits=[{id:'visit-A',server:true,...encounter,status:'In Treatment'}]}
 if(owner)store.session={...store.session,role:'owner'};
 return <ClinicalNavigation.Provider value={nav.register}>
  <nav aria-label="Sidebar"><button onClick={()=>nav.request(()=>setPage('queue'))}>My Queue</button></nav>
  {page==='prescriptions'?<PrescriptionsServerPage role={owner?'owner':'dentist'} context={window.rx10.returnEncounter?{returnEncounter:encounter}:null} store={store} setPage={next=>nav.request(()=>setPage(next))}/>:<h1>{page==='queue'?'Queue destination':'Encounter destination'}</h1>}
  {nav.dialog}
 </ClinicalNavigation.Provider>
} createRoot(document.getElementById('root')).render(<Harness/>);
`
const api = `
export const onSessionInvalidated=()=>()=>{};
export const prescriptionVisits=async()=>window.rx10.failVisits?{ok:false,message:'Synthetic Visit outage'}:{ok:true,data:['A','B'].map(x=>({id:'visit-'+x,date:'2026-11-06',patient:{id:'patient-'+x,name:'Synthetic '+x,age:null},branch:'Synthetic branch'})),meta:{license_no:'',allergy_notice:'Ask the patient'}};
export const listPrescriptions=async()=>({ok:true,data:window.rx10.records});
export const prescription=async id=>({ok:true,data:window.rx10.records.find(p=>p.id===id)});
const draft=(body,id='rx-A',revision=1)=>({id,status:'Draft',can_edit:true,revision,lines:body.lines,note:body.note,visit:body.visit_id||'visit-A',patient:{id:'patient-A',name:'Synthetic A'}});
const stored=data=>{window.rx10.records=[...window.rx10.records.filter(p=>p.id!==data.id),data];return {ok:true,data}};
export const createPrescription=async body=>window.rx10.holdSave?window.rx10.request('create',null,body):(window.rx10.calls.push({command:'create',body}),stored(draft(body)));
export const updatePrescription=async(id,body)=>window.rx10.holdSave?window.rx10.request('update',id,body):(window.rx10.calls.push({command:'update',id,body}),stored(draft(body,id,body.expected_revision+1)));
export const issuePrescription=async(id,revision)=>{
 if(window.rx10.holdIssue)return window.rx10.request('issue',id,{expected_revision:revision});
 window.rx10.calls.push({command:'issue',id,body:{expected_revision:revision}});
 return window.rx10.failIssue?{ok:false,message:'Synthetic Issue refusal'}:stored({...window.rx10.records.find(p=>p.id===id),status:'Issued',can_edit:false,number:'RX-SYNTHETIC',revision:revision+1});
};
export const savePrescriptionLicense=async()=>({ok:true});
export const voidPrescription=()=>{throw new Error('Unexpected void')};
export const downloadPrescriptionPdf=()=>{throw new Error('Forbidden PDF must never be offered to Owner')};
`
const bundle = await build({absWorkingDir: root, stdin: {contents: source, resolveDir: root, loader: 'jsx'}, bundle: true, write: false, format: 'iife', platform: 'browser', nodePaths: [dependencies], loader: {'.css': 'empty'},
  plugins: [{name: 'clin10-api-isolation', setup(b) {
    b.onResolve({filter: /api-client\.js$/}, () => ({path: 'stub', namespace: 'clin10'}))
    b.onLoad({filter: /.*/, namespace: 'clin10'}, () => ({contents: api, loader: 'js'}))
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
const button = (p, name) => p.getByRole('button', {name, exact: true})
const note = p => p.getByRole('textbox', {name: /^Note \(optional\)/})
const visit = p => p.getByRole('combobox', {name: /^Visit/})
const appLeave = p => p.getByRole('dialog', {name: 'Leave this encounter?', exact: true})
const localLeave = p => p.getByRole('dialog', {name: 'Leave this prescription?', exact: true})
const calls = p => p.evaluate(() => window.rx10.calls)
const feedback = p => p.evaluate(() => window.rx10.feedback)
const waitCalls = (p, n) => p.waitForFunction(n => window.rx10.calls.length === n, n)
const respond = async (p, i, r) => {await p.evaluate(({i,r}) => window.rx10.respond(i,r), {i,r}); await frames(p)}
const saved = {ok: true, data: {id: 'rx-A', status: 'Draft', can_edit: true, revision: 1, patient: {id: 'patient-A', name: 'Synthetic A'}, visit: 'visit-A', lines: [{medicine:'Paracetamol',dosage:'',frequency:'',duration:'',instructions:''}], note: 'Submitted note'}}
const fill = async p => {await visit(p).selectOption('visit-A'); await p.getByLabel('Select medicine 1', {exact: true}).selectOption('Paracetamol'); await note(p).fill('Submitted note')}
const startIssue = async p => {
  await button(p, 'Issue prescription').click()
  await button(p.getByRole('dialog', {name: 'Issue and lock prescription?', exact: true}), 'Issue prescription').click()
}
async function check(name, run, config = {}) {
  const p = await browser.newPage(), errors = []
  p.on('pageerror', e => errors.push(e.message))
  await p.route('**/*', r => r.request().url().startsWith(origin + '/') ? r.continue() : r.abort())
  await p.route('**/harness.js', async route => {
    // Apply configuration before React starts effects, without touching production.
    await route.fulfill({contentType: 'text/javascript', body: `window.rx10Initial=${JSON.stringify(config)};` + Buffer.from(bundle.outputFiles[0].contents).toString()})
  })
  try {await p.goto(origin); await button(p, 'My Queue').waitFor(); await frames(p); await run(p); assert.deepEqual(errors, []); completed.push(name)}
  finally {await p.close()}
}
try {
  browser = await chromium.launch({headless: true})
  await check('dirty sidebar navigation: Stay retains every field; Discard leaves', async p => {
    await fill(p)
    await p.getByLabel('Select dosage 1', {exact: true}).selectOption('500mg')
    await p.getByLabel('Select frequency 1', {exact: true}).selectOption('Twice daily')
    await p.getByLabel('Select duration 1', {exact: true}).selectOption('5 days')
    await p.getByRole('textbox', {name: /^Instructions/}).fill('Synthetic instructions')
    await button(p, 'My Queue').click(); await appLeave(p).waitFor()
    await button(appLeave(p), 'Stay with encounter').click()
    assert.equal(await note(p).inputValue(), 'Submitted note')
    for (const [field, value] of [['medicine','Paracetamol'],['dosage','500mg'],['frequency','Twice daily'],['duration','5 days']]) assert.equal(await p.getByLabel('Select '+field+' 1', {exact:true}).inputValue(), value)
    assert.equal(await p.getByRole('textbox', {name: /^Instructions/}).inputValue(), 'Synthetic instructions')
    await button(p, 'My Queue').click(); await button(appLeave(p), 'Discard unsaved changes and leave').click()
    await p.getByRole('heading', {name: 'Queue destination'}).waitFor(); assert.deepEqual(await calls(p), [])
  })
  await check('beforeunload is prevented only when dirty or busy', async p => {
    const warning = () => p.evaluate(() => {const e = new Event('beforeunload', {cancelable:true}); window.dispatchEvent(e); return e.defaultPrevented})
    assert.equal(await warning(), false); await fill(p); assert.equal(await warning(), true)
  })
  await check('Return to encounter uses the same app-owned draft confirmation', async p => {
    await fill(p); await button(p, 'Return to encounter').click(); await appLeave(p).waitFor()
    await button(appLeave(p), 'Stay with encounter').click(); assert.equal(await note(p).inputValue(), 'Submitted note')
    await button(p, 'Return to encounter').click(); await button(appLeave(p), 'Discard unsaved changes and leave').click()
    await p.getByRole('heading', {name:'Encounter destination'}).waitFor(); assert.deepEqual(await calls(p), [])
  }, {returnEncounter:true})
  await check('pending command blocks app Discard until result; reload warns', async p => {
    await fill(p); await button(p, 'Save draft').click(); await waitCalls(p, 1)
    await button(p, 'My Queue').click(); await appLeave(p).waitFor()
    await button(appLeave(p), 'Discard unsaved changes and leave').click()
    assert.equal(await p.getByRole('heading', {name: 'Queue destination'}).count(), 0)
    assert.equal(await p.evaluate(() => {const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}), true)
    await respond(p, 0, {ok:false,message:'Synthetic Save refusal'})
    await button(appLeave(p), 'Stay with encounter').click(); assert.equal(await note(p).inputValue(), 'Submitted note')
  }, {holdSave:true})
  await check('confirmed Visit A Issue continues after selecting B and cannot clear B', async p => {
    await fill(p); await startIssue(p); await waitCalls(p, 1)
    await visit(p).selectOption('visit-B'); await button(localLeave(p), 'Discard changes and continue').click()
    await note(p).fill('New B note'); await respond(p, 0, saved); await waitCalls(p, 2)
    assert.equal((await calls(p))[0].body.visit_id, 'visit-A')
    assert.deepEqual((await calls(p))[1], {command:'issue',id:'rx-A',body:{expected_revision:1}})
    assert.equal(await note(p).inputValue(), 'New B note'); assert.deepEqual(await feedback(p), [])
  }, {holdSave:true})
  await check('Save success then Issue failure retains Draft ID for explicit recovery', async p => {
    await fill(p); await startIssue(p); await p.getByText('Synthetic Issue refusal', {exact:true}).waitFor()
    assert.equal(await note(p).inputValue(), 'Submitted note'); await button(p, 'Save draft').click(); await waitCalls(p, 3)
    assert.equal((await calls(p))[2].command, 'update'); assert.equal((await calls(p))[2].id, 'rx-A')
  }, {failIssue:true})
  await check('issued result makes no delivery claim', async p => {
    await fill(p); await startIssue(p); await p.waitForFunction(() => window.rx10.feedback.length === 1)
    assert.match((await feedback(p))[0][0], /Issued RX-SYNTHETIC.*delivery is not confirmed/)
  })
  await check('Visit loading failure has retry and differs from no eligible Visits', async p => {
    await p.getByText('Synthetic Visit outage', {exact:true}).waitFor()
    assert.equal(await p.getByText('Loading visits', {exact:false}).count(), 0)
    await p.evaluate(() => {window.rx10.failVisits=false}); await button(p, 'Retry loading visits').click()
    await visit(p).waitFor(); assert.equal(await visit(p).locator('option').count(), 3)
  }, {failVisits:true})
  await check('Owner metadata stays readable and offers no denied PDF', async p => {
    await p.evaluate(() => window.rx10.owner(true))
    await button(p, 'View record').click(); await p.getByRole('dialog').waitFor()
    assert.equal(await button(p, 'Download PDF').count(), 0); assert.equal(await button(p, 'Edit draft').count(), 0)
    assert.equal(await p.getByRole('dialog').getByText(/Synthetic dentist/).count(), 1)
  }, {records:[{id:'rx-meta',number:'RX-SYNTHETIC',status:'Issued',revision:3,date:'2026-11-06',branch:'Synthetic branch',dentist:'Synthetic dentist'}]})
  console.log(JSON.stringify({completed, blocked:['actor A to B pre-Issue','actor A to B to A replacement'], required:['unchanged CLIN-05/R2 suites','real authenticated navigation/reload/PDF acceptance'], evidence:'Synthetic only'}, null, 2))
} finally {await browser?.close(); await new Promise(resolve => server.close(resolve))}

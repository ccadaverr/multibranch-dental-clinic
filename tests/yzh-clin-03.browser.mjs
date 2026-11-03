import {runOdontogramMotionTest} from './playwright-odontogram-motion.js'
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
const before=process.argv.includes('--before')
const selectedCase=process.argv.find(a=>a.startsWith('--case='))?.slice(7)
const url=process.env.CLIN03_URL||'http://127.0.0.1:5188/tests/fixtures/yzh-clin-03.html'
const evidence=process.env.CLIN03_EVIDENCE_DIR||path.join(os.tmpdir(),'yzh-clin-03-'+(before?'before':'after'))
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
const frames=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
const tooth=(p,id)=>p.locator('.od-tooth[data-tooth="'+id+'"]')
const note=p=>p.getByRole('textbox',{name:/^Note \(optional\)/})
const save=p=>p.getByRole('button',{name:'Record finding',exact:true})
const button=(p,name)=>p.getByRole('button',{name,exact:true})
async function discard(p){const dialog=p.getByRole('dialog');if(await dialog.count())await dialog.getByRole('button',{name:'Discard changes and continue',exact:true}).click()}
async function pick(p,id){await tooth(p,id).click();await discard(p)}
function chart(){return {settings:{numbering:'fdi',statuses:['Healthy','Caries','Filled']},current:[{id:'seed18',tooth:'18',status:'Healthy',surfaces:[]},{id:'seed55',tooth:'55',status:'Caries',surfaces:[]}],history:[]}}
async function boot(p,{held=false,failure=false,network=false,role='dentist',throwing=false}={}){
 const ready=deferred(),release=deferred(),calls=[],charts=new Map([['pA',chart()],['pB',chart()]])
 if(throwing)await p.route('**/src/api-client.js*',async r=>{const response=await r.fetch(),original=await response.text(),needle='function recordChartEntry(patientId, body) {';assert(original.includes(needle));await r.fulfill({response,body:original.replace(needle,needle+' if (body.note === "Synthetic throw") return Promise.reject(new Error("Synthetic thrown recording"));')})})
 await p.route('**/sanctum/**',r=>r.fulfill({status:204}))
 await p.route('**/api/**',async r=>{
  const req=r.request(),u=new URL(req.url()),pathname=u.pathname
  if(req.method()==='GET'){
   if(pathname==='/api/prescriptions/visits')return r.fulfill({json:{data:['A','B'].map(x=>({id:'v'+x,patient:{id:'p'+x,name:'Synthetic patient '+x}}))}})
   if(pathname==='/api/me/chart')return r.fulfill({json:{data:chart()}})
   if(/^\/api\/patients\/p[AB]\/chart$/.test(pathname))return r.fulfill({json:{data:charts.get(pathname.split('/')[3])}})
   throw Error('Unexpected read '+pathname)
  }
  assert.equal(req.method(),'POST');assert(/^\/api\/patients\/p[AB]\/chart$/.test(pathname))
  const body=req.postDataJSON(),patient=pathname.split('/')[3];calls.push({patient,body})
  if(held&&calls.length===1){ready.resolve();await release.promise;if(network)return r.abort();if(failure)return r.fulfill({status:422,json:{message:'Synthetic A refused',errors:{note:['Synthetic A refused']}}})}
  const data=charts.get(patient),entry={id:'entry-'+calls.length,...body};data.current=[...data.current.filter(x=>x.tooth!==body.tooth),entry];data.history=[...data.history,entry]
  return r.fulfill({json:{data}})
 })
 await p.goto(url+'?role='+role)
 if(role==='dentist')await p.getByRole('button',{name:/Synthetic patient A/}).click()
 await tooth(p,'18').waitFor()
 return {ready,release,calls,charts}
}
async function fill(p,who='A'){
 await p.getByRole('combobox',{name:'Status',exact:true}).selectOption(who==='A'?'Caries':'Filled')
 await p.getByRole('combobox',{name:/^Clinic Branch/}).selectOption(who==='A'?'2':'1')
 await p.getByRole('checkbox',{name:who==='A'?'M':'D',exact:true}).check()
 await p.getByLabel('Date',{exact:true}).fill(who==='A'?'2020-01-02':'2020-02-03')
 await note(p).fill('Synthetic '+who+' note')
}
async function expectDraft(p,id,who){
 assert.equal(await p.locator('.od-tooth.is-selected').getAttribute('data-tooth'),id)
 assert.equal(await note(p).inputValue(),'Synthetic '+who+' note')
 assert.equal(await p.getByRole('combobox',{name:'Status',exact:true}).inputValue(),who==='A'?'Caries':'Filled')
 assert.equal(await p.getByLabel('Date',{exact:true}).inputValue(),who==='A'?'2020-01-02':'2020-02-03')
 assert(await p.getByRole('checkbox',{name:who==='A'?'M':'D',exact:true}).isChecked())
 assert(!(await p.getByRole('checkbox',{name:who==='A'?'D':'M',exact:true}).isChecked()),'no other tooth surface carried over')
}
async function blank(p,id){
 assert.equal(await p.locator('.od-tooth.is-selected').getAttribute('data-tooth'),id)
 assert.equal(await note(p).inputValue(),'','new tooth must not inherit a clinical note')
 assert.equal(await p.getByRole('combobox',{name:'Status',exact:true}).inputValue(),'Healthy')
 assert.equal(await p.getByRole('combobox',{name:/^Clinic Branch/}).inputValue(),'1')
 assert.notEqual(await p.getByLabel('Date',{exact:true}).inputValue(),'2020-01-02')
 for(const s of ['M','O','D','B','L'])assert(!(await p.getByRole('checkbox',{name:s,exact:true}).isChecked()))
}
async function isolation(p){
 await boot(p);await pick(p,'18');await fill(p)
 await tooth(p,'17').focus();await p.keyboard.press('Enter')
 await p.getByRole('dialog').waitFor()
 await p.getByRole('dialog').getByRole('button',{name:'Stay',exact:true}).click()
 await expectDraft(p,'18','A')
 assert(await tooth(p,'17').evaluate(e=>e===document.activeElement),'Stay restores selection-control focus')
 await pick(p,'17');await blank(p,'17');await pick(p,'18');await blank(p,'18')
}
async function race(p,{failure=false,rapid=false,patient=false,back=false}={}){
 const f=await boot(p,{held:true,failure})
 try{
  await pick(p,'18');await fill(p);await save(p).click();await f.ready.promise
  if(patient){await button(p,'Change patient').click();await discard(p);await p.getByRole('button',{name:/Synthetic patient B/}).click();await tooth(p,'18').waitFor();await pick(p,'18')}
  else if(back){await button(p,'Back to all findings').click();await discard(p)}
  else{await pick(p,'17');if(rapid)await pick(p,'18')}
  if(!back)await fill(p,'B')
  const response=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/patients/pA/chart'));f.release.resolve();await(await response).finished();await frames(p)
  assert.deepEqual(f.calls[0],{patient:'pA',body:{tooth:'18',status:'Caries',surfaces:['M'],note:'Synthetic A note',recorded_on:'2020-01-02',branch_id:2}})
  assert.equal(f.calls.length,1)
  assert.deepEqual(await p.evaluate(()=>window.clin03Toasts),[],'stale success must not own parent toast')
  assert.equal(await p.getByText('Synthetic A refused',{exact:true}).count(),0,'stale failure must not enter active editor')
  if(!back){await expectDraft(p,rapid||patient?'18':'17','B');assert(await save(p).isEnabled(),'active editor unlocks after old operation');if(!patient&&!failure)assert.equal(await p.locator('.od-tooth[data-tooth="18"]').getAttribute('aria-label'),'Tooth 18: Caries');if(!failure&&!patient)assert.equal(f.charts.get('pA').history.length,1,'legitimate A update retained')}
  else assert.equal(await p.locator('.od-record-form').count(),0)
  if(!back){const count=f.calls.length;await save(p).click();await p.waitForFunction(()=>window.clin03Toasts.length===1);assert.equal(f.calls.length,count+1);assert.deepEqual(f.calls.at(-1),{patient:patient?'pB':'pA',body:{tooth:rapid||patient?'18':'17',status:'Filled',surfaces:['D'],note:'Synthetic B note',recorded_on:'2020-02-03',branch_id:1}})}
  return f.calls
 }finally{f.release.resolve()}
}
async function duplicate(p){
 const f=await boot(p,{held:true})
 try{await pick(p,'18');await fill(p);await p.locator('.od-record-form').evaluate(f=>{f.requestSubmit();f.requestSubmit()});await f.ready.promise;await frames(p)
 assert.equal(f.calls.length,1);assert(await p.getByRole('button',{name:/^Saving/}).isDisabled(),'duplicate submit must not release the first request loading state')
 const response=p.waitForResponse(r=>r.request().method()==='POST');f.release.resolve();await(await response).finished();await frames(p);assert.equal(f.calls.length,1);assert.equal(await note(p).inputValue(),'')
 }finally{f.release.resolve()}
}
async function recovery(p,throwing){
 const f=await boot(p,{held:!throwing,network:!throwing,throwing})
 try{await pick(p,'18');await fill(p);if(throwing)await note(p).fill('Synthetic throw');await save(p).click()
 if(!throwing){await f.ready.promise;const response=p.waitForEvent('requestfailed');f.release.resolve();await response}
 await p.getByRole('alert').waitFor();assert(await save(p).isEnabled());assert.notEqual(await note(p).inputValue(),'')
 await note(p).fill('Synthetic retry');await save(p).focus();await p.keyboard.press('Enter')
 await p.waitForFunction(()=>window.clin03Toasts.length===1)
 assert.equal(f.calls.length,throwing?1:2);assert.equal(await note(p).inputValue(),'')
 }finally{f.release.resolve()}
}
async function views(p){await boot(p);await pick(p,'18');await fill(p);await p.getByRole('tab',{name:'Front view',exact:true}).click();await expectDraft(p,'18','A');await p.getByRole('tab',{name:'Top view (Arch)',exact:true}).click();await expectDraft(p,'18','A')}
async function dentition(p){await boot(p);await pick(p,'18');await fill(p);await p.getByRole('tab',{name:'Primary (20)',exact:true}).click();await discard(p);assert.equal(await p.locator('.od-tooth').count(),20);assert.equal(await p.locator('.od-record-form').count(),0,'hidden adult tooth cannot remain editable');await pick(p,'55');await blank(p,'55')}
async function summary(p){await boot(p);await button(p,'Select tooth 55').click();assert.equal(await p.locator('.od-tooth.is-selected').getAttribute('data-tooth'),'55');assert.equal(await p.locator('.od-tooth').count(),20)}
async function readOnly(p,role){await boot(p,{role});await pick(p,'18');assert.equal(await p.locator('.od-record-form').count(),0);assert.equal(await save(p).count(),0);await p.getByRole('tab',{name:'Front view',exact:true}).click();assert.equal(await p.locator('.od-record-form').count(),0)}
async function active(p){const f=await boot(p);await pick(p,'18');await fill(p);await save(p).focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>window.clin03Toasts.length===1);assert.equal(f.calls.length,1);assert.equal(await note(p).inputValue(),'');await p.getByText('Synthetic A note',{exact:true}).waitFor()}
async function patientDirty(p){await boot(p);await pick(p,'18');await fill(p);await button(p,'Change patient').click();await p.getByRole('dialog').waitFor();await p.getByRole('dialog').getByRole('button',{name:'Stay',exact:true}).click();await expectDraft(p,'18','A');await button(p,'Change patient').click();await discard(p);await p.getByRole('button',{name:/Synthetic patient B/}).click();await pick(p,'18');await blank(p,'18')}
async function fieldIsolation(p){await boot(p);await pick(p,'18');await fill(p);await pick(p,'17');await blank(p,'17')}
async function cleanNavigation(p){await boot(p);await pick(p,'18');await tooth(p,'17').click();assert.equal(await p.getByRole('dialog').count(),0);await blank(p,'17')}
async function revertedClean(p){await boot(p);await pick(p,'18');const date=await p.getByLabel('Date',{exact:true}).inputValue();await fill(p);await p.getByRole('combobox',{name:'Status',exact:true}).selectOption('Healthy');await p.getByRole('combobox',{name:/^Clinic Branch/}).selectOption('1');await p.getByRole('checkbox',{name:'M',exact:true}).uncheck();await p.getByLabel('Date',{exact:true}).fill(date);await note(p).fill('');await tooth(p,'17').click();assert.equal(await p.getByRole('dialog').count(),0,'reverted form is clean');await blank(p,'17')}
async function keyboardSelection(p){await boot(p);await pick(p,'18');await p.getByRole('tab',{name:'Front view',exact:true}).click();await tooth(p,'17').focus();await p.keyboard.press('Space');assert.equal(await p.locator('.od-tooth.is-selected').getAttribute('data-tooth'),'17');await p.getByRole('tab',{name:'Primary (20)',exact:true}).click();assert.equal(await p.locator('.od-record-form').count(),0);await tooth(p,'55').focus();await p.keyboard.press('Enter');await blank(p,'55');await p.getByRole('tab',{name:'Top view (Arch)',exact:true}).click();await tooth(p,'54').focus();await p.keyboard.press('Space');await blank(p,'54')}
async function motion(p){await boot(p);await p.evaluate(()=>location.hash='#dental-chart');const results=await runOdontogramMotionTest(p);assert(results.every(r=>r.ok&&r.testedCount===r.expectedTeeth));return results}
const cases=[['clean-navigation',cleanNavigation],['reverted-clean',revertedClean],['keyboard-selection',keyboardSelection],['motion-invariance',motion],['unsaved-fields',fieldIsolation],['unsaved-isolation',isolation],['save-success',p=>race(p)],['save-failure',p=>race(p,{failure:true})],['rapid-success',p=>race(p,{rapid:true})],['rapid-failure',p=>race(p,{rapid:true,failure:true})],['patient-success',p=>race(p,{patient:true})],['patient-failure',p=>race(p,{patient:true,failure:true})],['duplicate-submit',duplicate],['network-retry',p=>recovery(p,false)],['thrown-retry',p=>recovery(p,true)],['view-continuity',views],['dentition-isolation',dentition],['summary-dentition',summary],['staff-read-only',p=>readOnly(p,'staff')],['patient-read-only',p=>readOnly(p,'patient')],['back-pending-success',p=>race(p,{back:true})],['active-save',active],['patient-unsaved',patientDirty]]
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[]
await mkdir(evidence,{recursive:true})
try{
 for(const width of before?[390]:[390,768,1024,1440])for(const[name,run]of cases.filter(([name])=>!selectedCase||name===selectedCase)){
  const context=await browser.newContext({viewport:{width,height:1000}}),p=await context.newPage(),errors=[];p.setDefaultTimeout(2500);p.on('pageerror',e=>errors.push(e.message))
  try{const calls=await run(p);assert.deepEqual(errors,[]);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'document overflow');results.push({width,name,status:'pass',calls});console.log('PASS '+width+' '+name)}
  catch(e){results.push({width,name,status:'fail',error:e.message,pageErrors:errors});console.log('FAIL '+width+' '+name+': '+e.message)}
  finally{await context.close()}
 }
 const hashes={};for(const f of ['src/components/odontogram/Odontogram.jsx','src/components/odontogram/ToothTimeline.jsx','src/pages/DentalChart.jsx'])hashes[f]=createHash('sha256').update(process.env.CLIN03_BASELINE_REPLAY==='1'?execFileSync('git',['show','a6a0de5bf36c77a43d948b98f821940bac41df3d:'+f]):await readFile(f)).digest('hex')
 await writeFile(path.join(evidence,'results.json'),JSON.stringify({synthetic:true,authenticatedAcceptance:false,baselineReplay:process.env.CLIN03_BASELINE_REPLAY==='1',hashes,results},null,2))
 const summary={passed:results.filter(r=>r.status==='pass').length,failed:results.filter(r=>r.status==='fail').length};console.log(JSON.stringify(summary));if(summary.failed)process.exitCode=1
}finally{await browser.close()}

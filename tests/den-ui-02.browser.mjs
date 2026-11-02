import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {visitRow,queueRow,treatmentRow,today} from './support/den-ui-02-fixture.js'
const require=createRequire(import.meta.url)
const {chromium}=require(process.env.PLAYWRIGHT_MODULE)
const browser=await chromium.launch({headless:true,channel:'chrome'})
const page=await browser.newPage();page.setDefaultTimeout(7000)
const errors=[],calls=[],results=[];page.on('pageerror',e=>errors.push(e.message))
let visits,queue,treatments,fail='',delay=0
function reset(){visits=[visitRow(),visitRow('v2','p2')];queue=visits.map((v,i)=>queueRow('q'+(i+1),v));treatments=[];fail=''}
reset()
const fulfill=(route,data,status=200)=>route.fulfill({status,json:status===200?{data}:data})
await page.route('**/api/**',async route=>{
 const req=route.request(),u=new URL(req.url()),p=u.pathname,method=req.method();calls.push({p,method,key:req.headers()['idempotency-key']})
 if(delay)await new Promise(r=>setTimeout(r,delay))
 if(method==='GET'){
  if(p==='/api/queue')return fulfill(route,queue)
  if(p==='/api/visits')return fulfill(route,visits)
  if(p==='/api/treatments')return fulfill(route,treatments)
  if(p.endsWith('/chart'))return fulfill(route,{settings:{numbering:'fdi',statuses:[]},current:[],history:[]})
  if(p==='/api/prescriptions/visits')return fulfill(route,visits.map(v=>({...v,date:today,branch:'Illustrative Central Branch'})))
  if(p==='/api/prescriptions')return fulfill(route,[])
  if(p.endsWith('/followups'))return fulfill(route,[])
  throw Error('Unexpected read '+p)
 }
 const body=req.postDataJSON()
 if(fail){const kind=fail;fail='';if(kind==='network')return route.abort();return fulfill(route,{message:'Illustrative refusal',code:kind==='conflict'?'stale_revision':'refused'},kind==='conflict'?409:kind==='expired'?401:422)}
 if(p==='/api/queue/q1/call'){queue[0].status='Called';queue[0].revision++;return fulfill(route,queue[0])}
 if(p==='/api/visits/v1/treatment'){
  if(!['Called','Treatment Ready'].includes(queue[0].status))return fulfill(route,{message:'Call first'},422)
  if(!treatments.length){visits[0].status='In Treatment';queue[0].status='Served';queue[0].visit.status='In Treatment';treatments=[treatmentRow(visits[0])]}
  return fulfill(route,treatments[0])
 }
 if(p==='/api/treatments/t1/document'){
  const t=treatments[0];if(body.expected_revision!==t.revision)return fulfill(route,{code:'stale_revision'},409)
  Object.assign(t,body,{revision:t.revision+1,procedures:body.procedures.map((l,i)=>({id:'line'+i,service:{id:l.service_ref,name:'Illustrative consultation'},quantity:l.quantity,notes:l.notes}))});return fulfill(route,t)
 }
 if(p==='/api/treatments/t1/complete'){treatments[0].status='Completed';treatments[0].revision++;visits[0].status='Completed';queue[0].visit.status='Completed';return fulfill(route,treatments[0])}
 throw Error('Forbidden fixture mutation '+p)
})
await page.route('**/sanctum/csrf-cookie',r=>r.fulfill({status:204}))
const button=name=>page.getByRole('button',{name,exact:true})
const go=async()=>{await page.goto('http://127.0.0.1:5187/tests/fixtures/den-ui-02.html');await button('Call patient').first().waitFor()}
const noOverflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
await mkdir('docs/ui-review/den-ui-02',{recursive:true})
try{
 for(const width of [390,768,1440]){
  reset();await page.setViewportSize({width,height:1000});await go();await noOverflow()
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`docs/ui-review/den-ui-02/queue-${width}.png`,fullPage:true})
  await button('Review encounter').first().click();await button('Start Treatment').waitFor();assert(await button('Start Treatment').isDisabled())
  await button('My Queue').last().click();await button('Call patient').first().click();await button('Open encounter').click()
  delay=100;await button('Start Treatment').dblclick();await page.getByText('Saved on the clinic server. Revision 1.',{exact:true}).waitFor();delay=0
  assert.equal(calls.filter(c=>c.p==='/api/visits/v1/treatment').length,results.length+1)
  await page.getByLabel('Clinical notes',{exact:true}).fill('Illustrative unsaved note')
  for(const destination of ['queue','patients','chart','prescriptions','followups']){
   await page.evaluate(p=>window.encFixture.go(p),destination);await page.getByRole('dialog',{name:'Leave this encounter?'}).waitFor();await button('Stay with encounter').click();assert.equal(await page.getByLabel('Clinical notes',{exact:true}).inputValue(),'Illustrative unsaved note')
  }
  treatments[0].revision=2;treatments[0].clinical_notes='Illustrative newer server note';await page.evaluate(()=>window.encFixture.refresh());await page.getByText('A newer version was saved',{exact:true}).waitFor()
  assert(await button('Save Treatment Progress').isDisabled());await button('Review latest record').click();await button('Cancel').click();assert.equal(await page.getByLabel('Clinical notes',{exact:true}).inputValue(),'Illustrative unsaved note')
  await button('Review latest record').click();await button('Discard draft and load latest').click();assert.equal(await page.getByLabel('Clinical notes',{exact:true}).inputValue(),'Illustrative newer server note')
  await page.getByLabel('Clinical notes',{exact:true}).fill('Illustrative final note');fail='validation';await button('Save Treatment Progress').click();await page.getByText('Command not confirmed',{exact:true}).waitFor();assert.equal(await page.getByLabel('Clinical notes',{exact:true}).inputValue(),'Illustrative final note')
  await button('Add performed procedure').click();await page.getByLabel('Procedure 1').selectOption('svc1');await page.getByLabel('Procedure / treatment performed',{exact:true}).fill('Illustrative completed consultation')
  await page.getByLabel('Dentist indicates prescription required').check();await page.getByLabel('Dentist indicates follow-up required').check();await page.getByLabel('Follow-up reason',{exact:true}).selectOption('Post-Op Check')
  delay=100;await button('Save Treatment Progress').dblclick();await page.getByText('Saved on the clinic server. Revision 3.',{exact:true}).waitFor();delay=0
  await noOverflow();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`docs/ui-review/den-ui-02/encounter-${width}.png`,fullPage:true})
  fail='validation';await button('Complete Treatment').click();await page.getByRole('dialog').getByRole('button',{name:'Complete Treatment',exact:true}).click();await page.getByText('Command not confirmed',{exact:true}).waitFor();assert(await page.getByLabel('Clinical notes',{exact:true}).isEnabled())
  await button('Complete Treatment').click();await page.getByRole('dialog').getByRole('button',{name:'Complete Treatment',exact:true}).dblclick();await page.getByText('Treatment completion confirmed by the clinic server.',{exact:true}).waitFor();assert(await page.getByLabel('Clinical notes',{exact:true}).isDisabled())
  await page.getByText(/Prescription indicated; clinical review/).waitFor();await page.getByText(/This is not a booking confirmation/).waitFor()
  await button('Open dental chart').click();await page.locator('.od-tooth').first().waitFor();assert.equal((await page.evaluate(()=>window.encFixture.getContext())).patientId,'p1');await button('Return to encounter').click()
  await button('Open visit prescriptions').click();await page.getByText('Prescriptions for this encounter. A Draft has not been issued.').waitFor();await button('Return to encounter').click()
  await button('Open patient follow-ups').click();await page.getByText(/Patient follow-up tasks. A recommendation/).waitFor();await button('Return to encounter').click()
  results.push({width,flow:'passed'});assert.deepEqual(errors,[])
 }
 reset();await go();await button('Call patient').first().click();await button('Open encounter').click();await button('Start Treatment').click();await page.getByText('Saved on the clinic server. Revision 1.',{exact:true}).waitFor();await page.getByLabel('Clinical notes',{exact:true}).fill('Discarded fixture draft')
 await page.evaluate(()=>window.encFixture.go('treatment',{queueEntryId:'q2',visitId:'v2',patientId:'p2',dentistId:'d1',branchId:'b1',appointmentId:null}))
 await button('Discard unsaved changes and leave').click();await page.getByRole('heading',{name:'Illustrative Patient Beatriz',exact:true}).waitFor();assert.equal(await page.getByLabel('Clinical notes',{exact:true}).inputValue(),'')
 await page.evaluate(()=>window.encFixture.expire());await page.getByText('Clinical session unavailable',{exact:true}).waitFor();assert.equal(await page.getByLabel('Clinical notes',{exact:true}).count(),0)
 // Existing local notes stay untouched and never enter the rendered patient summary.
 reset();await go();await page.evaluate(()=>localStorage.setItem('clinic_patient_medical_p1',JSON.stringify({notes:'Synthetic legacy note, not a clinic record'})))
 await page.evaluate(()=>window.encFixture.go('patients',{patientId:'p1'}));await page.getByText('Full patient record not available to Dentists yet',{exact:true}).waitFor()
 assert.equal(await page.getByText('Synthetic legacy note, not a clinic record').count(),0);assert.equal(await button('Save Clinical Summary').count(),0)
 await page.evaluate(()=>window.encFixture.go('patients',{patientId:'p2'}));assert.equal(await page.getByText('Synthetic legacy note, not a clinic record').count(),0)
 await page.evaluate(()=>window.encFixture.sessionChange());await page.getByText('Clinical session unavailable. Patient information is hidden.',{exact:true}).waitFor()
 assert((await page.evaluate(()=>localStorage.getItem('clinic_patient_medical_p1'))).includes('Synthetic legacy note'))
 assert.deepEqual(errors,[])
 // Change chart patient while the earlier read is delayed; the keyed chart must reset selection.
 reset();await go();delay=250
 await page.evaluate(()=>window.encFixture.go('chart',{returnEncounter:{queueEntryId:'q1',visitId:'v1',patientId:'p1',dentistId:'d1',branchId:'b1'}}))
 await page.getByText(/Loading the chart/).waitFor()
 await page.evaluate(()=>window.encFixture.go('chart',{returnEncounter:{queueEntryId:'q2',visitId:'v2',patientId:'p2',dentistId:'d1',branchId:'b1'}}))
 await page.locator('.od-tooth').first().waitFor();delay=0
 assert.equal(await page.getByRole('heading',{name:'Illustrative Patient Alexandra with a long family name',exact:true}).count(),0)
 await page.getByRole('heading',{name:'Illustrative Patient Beatriz',exact:true}).waitFor()
 assert.equal(await page.locator('.od-tooth.is-selected').count(),0)
 // Empty, error and keyboard worklist states.
 reset();await go();await page.getByLabel('Find patient or queue number').fill('no matching synthetic patient');await page.getByText('No patients match this search.',{exact:true}).waitFor()
 await page.getByLabel('Find patient or queue number').fill('');await button('Review encounter').first().focus();await page.keyboard.press('Enter');await button('Start Treatment').waitFor();assert(await button('Start Treatment').isDisabled())
 await page.evaluate(()=>window.encFixture.go('queue'));await page.evaluate(()=>window.encFixture.setStatus('error'));await page.getByText('Live queue counts unavailable',{exact:true}).waitFor();assert(await button('Call patient').first().isDisabled())
 await button('Refresh queue').click();await button('Call patient').first().waitFor();assert(await button('Call patient').first().isEnabled())
 // Unknown/foreign context never substitutes a patient.
 await page.evaluate(()=>window.encFixture.go('treatment',{queueEntryId:'q1',patientId:'p2',visitId:'v1'}));await page.getByRole('heading',{name:'Encounter unavailable',exact:true}).waitFor();assert.equal(await page.getByLabel('Clinical notes',{exact:true}).count(),0)
 assert.deepEqual(errors,[])
 await writeFile('docs/ui-review/den-ui-02/browser-results.json',JSON.stringify({results,errors,requests:calls.length,mutations:calls.filter(c=>c.method!=='GET').length,synthetic:true},null,2))
 console.log(JSON.stringify({results,requests:calls.length,errors}))
}finally{await browser.close()}

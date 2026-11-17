// Actual React → Laravel → PostgreSQL acceptance. Synthetic prerequisites only; no mocked success responses.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {browser,login,get,evidence,base,api,target,privateRead} from './local-visit-support.mjs'
const fixture=JSON.parse(process.env.LOCAL_VISIT_FIXTURE ? readFileSync(process.env.LOCAL_VISIT_FIXTURE,'utf8') : privateRead(target.runtime+'/visit-fixture.json'))
const journal=evidence+'/journey.json',state=existsSync(journal)?JSON.parse(readFileSync(journal,'utf8')):{},results=[]
const save=()=>writeFileSync(journal,JSON.stringify(state,null,2))
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
async function response(page,path,work){const r=page.waitForResponse(r=>r.url()===api+path&&r.request().method()!=='GET');await work();const result=await r;const body=await result.json();if(result.status()>=300)console.log('REFUSAL',result.status(),JSON.stringify(body));assert.ok(result.status()<300);return body.data}
let page
try {
 const staff=await login('sprint02.staff@example.test');page=staff.page
 await page.getByRole('button',{name:'Appointments',exact:true}).click()
 if(!state.appointment){
  await page.getByRole('button',{name:'New appointment',exact:true}).click();const form=page.getByRole('dialog')
  await form.getByRole('textbox',{name:/^Find patient/}).fill(fixture.patientCode);await form.getByRole('combobox',{name:'Patient',exact:true}).selectOption(fixture.patientId)
  await form.getByRole('combobox',{name:'Service',exact:true}).selectOption(fixture.service)
  await form.getByLabel(/^Date/).fill(today)
  await form.getByRole('textbox',{name:'Notes',exact:true}).fill('Synthetic Sprint 02 local acceptance')
  await form.getByRole('group',{name:'Available start times',exact:true}).getByRole('button').first().click()
  state.appointment=await response(page,'/api/appointments',()=>form.getByRole('button',{name:'Confirm appointment',exact:true}).evaluate(b=>{b.click();b.click()}));save()
 }
 assert.equal(state.appointment.patient.id,fixture.patientId);assert.equal(state.appointment.branch.id,fixture.branch)
 await page.reload();assert.equal((await get(page,'/api/appointments/'+state.appointment.id)).body.data.id,state.appointment.id)
 console.log('PASS actual Staff appointment and persisted readback')
 await page.getByRole('button',{name:'Check-In',exact:true}).click()
 if(!state.visit){
  await page.getByRole('combobox',{name:'Today’s appointment'}).selectOption(state.appointment.id)
  await page.getByRole('button',{name:'Confirm arrival',exact:true}).click();await page.getByText(/Confirm that the patient presented a valid ID/).waitFor()
  await page.getByText('Loading patient ID status…',{exact:true}).waitFor({state:'hidden'});
  const idButton=page.getByRole('button',{name:'ID checked',exact:true})
  if(await idButton.count()){
    await page.getByRole('combobox',{name:'ID shown',exact:true}).selectOption('other');await page.getByRole('textbox',{name:'Specify ID type'}).fill('Synthetic Company ID')
    const id=await response(page,'/api/patients/'+fixture.patientId+'/verify-id',()=>idButton.click());state.intake=id;save()
  }
  await page.reload();await page.getByRole('button',{name:'Check-In',exact:true}).click();await page.getByRole('combobox',{name:'Today’s appointment'}).selectOption(state.appointment.id)
  await page.getByRole('checkbox',{name:'Valid ID presented',exact:true}).check()
  state.visit=await response(page,'/api/visits/check-in',()=>page.getByRole('button',{name:'Confirm arrival',exact:true}).evaluate(b=>{b.click();b.click()}));save()
 }
 await page.reload();const visit=await get(page,'/api/visits/'+state.visit.id);assert.equal(visit.body.data.appointment.id,state.appointment.id);assert.equal(visit.body.data.patient.id,fixture.patientId);assert.ok(visit.body.data.queue.id)
 console.log('PASS actual Staff ID intake, mandatory confirmation, Check-In and exact Visit/queue readback')
 const dentist=await login('sprint02.dentist@example.test');page=dentist.page
 await page.getByRole('button',{name:'My Queue',exact:true}).first().click()
 if(!state.treatment){
  const q=page.locator('article.enc-queue-row').filter({hasText:fixture.patientCode}).first();await q.waitFor()
  const call=q.getByRole('button',{name:'Call and open encounter',exact:true})
  if(await call.count()) await response(page,'/api/queue/'+state.visit.queue.id+'/call',()=>call.click())
  else await q.getByRole('button',{name:'Review encounter',exact:true}).click()
  const beforeStart=await get(page,'/api/visits/'+state.visit.id)
  assert.equal(beforeStart.body.data.status,'Checked In');assert.equal(beforeStart.body.data.queue.status,'Called')
  await page.getByRole('button',{name:'Add performed procedure',exact:true}).click()
  await page.getByRole('combobox',{name:'Procedure 1',exact:true}).selectOption(fixture.service)
  await page.getByRole('textbox',{name:'Chief complaint',exact:true}).fill('Synthetic demo: routine examination requested')
  await page.getByRole('textbox',{name:'Treatment plan',exact:true}).fill('Synthetic demo documentation for accepted workflow')
  await page.getByRole('textbox',{name:'Procedure / treatment performed',exact:true}).fill('Synthetic demo cleaning performed')
  await response(page,'/api/visits/'+state.visit.id+'/treatment',()=>page.getByRole('button',{name:'Start Treatment',exact:true}).click())
  await page.getByText(/Saved on the clinic server/).waitFor()
  const treatments=await get(page,'/api/treatments?date='+today);state.treatment=treatments.body.data.find(t=>t.visit_id===state.visit.id || t.visit?.id===state.visit.id);assert.ok(state.treatment);save()
 }
 if(state.treatment.status!=='Completed'){
   // Reload and reopen the authoritative in-progress record before finalizing.
   await page.reload();await page.getByRole('button',{name:'My Queue',exact:true}).first().click();await page.getByRole('button',{name:'Continue treatment',exact:true}).first().click()
   await page.getByRole('textbox',{name:'Chief complaint',exact:true}).waitFor();assert.match(await page.getByRole('textbox',{name:'Chief complaint',exact:true}).inputValue(),/Synthetic demo/)
   await page.getByRole('textbox',{name:'Clinical notes',exact:true}).fill('Synthetic J02 documentation — saved progress, not clinical advice.')
   assert.equal(await page.getByRole('button',{name:'Complete Treatment',exact:true}).isDisabled(),true)
   assert.ok((await page.getByRole('button',{name:'Save Treatment Progress',exact:true}).getAttribute('class')).includes('primary'))
   state.treatment=await response(page,'/api/treatments/'+state.treatment.id+'/document',()=>page.getByRole('button',{name:'Save Treatment Progress',exact:true}).click());save()
   await page.getByText(/Saved on the clinic server/).waitFor()
   for(const width of [375,390,430,768,1024,1440]){
     await page.setViewportSize({width,height:1000})
     await page.getByRole('textbox',{name:'Clinical notes',exact:true}).scrollIntoViewIfNeeded()
     const geometry=await page.evaluate(()=>({header:document.querySelector('.enc-header').getBoundingClientRect().toJSON(),top:document.querySelector('.topbar').getBoundingClientRect().bottom,overflow:document.documentElement.scrollWidth>innerWidth+1}))
     assert.equal(geometry.overflow,false,`encounter overflow ${width}`)
     assert.ok(geometry.header.y>=geometry.top-1,`identity overlap ${width}`)
     assert.ok(geometry.header.y+geometry.header.height<1000,`identity outside viewport ${width}`)
     assert.match(await page.locator('.enc-header').innerText(),new RegExp(fixture.patientCode))
     await page.screenshot({path:evidence+`/j02-encounter-focused-${width}.png`})
     await page.evaluate(()=>window.scrollTo(0,0))
     await page.screenshot({path:evidence+`/j02-encounter-${width}.png`,fullPage:true})
   }
   console.log('PASS J02 dirty-save hierarchy, exact persisted progress and sticky identity at six widths')
   await page.getByRole('button',{name:'Complete Treatment',exact:true}).click();state.treatment=await response(page,'/api/treatments/'+state.treatment.id+'/complete',()=>page.getByRole('dialog').getByRole('button',{name:'Complete Treatment',exact:true}).click());save()
 }
 assert.equal((await get(page,'/api/treatments/'+state.treatment.id)).body.data.status,'Completed');console.log('PASS separate Dentist queue, exact encounter documentation, reload and completion')
 state.accepted=true;save();console.log('PASS J02 actual admission, clinical progress and explicit completion; no settlement')
}catch(error){if(page){await page.screenshot({path:evidence+'/failure.png',fullPage:true});writeFileSync(evidence+'/failure-text.txt',await page.locator('body').innerText())}throw error} finally {await browser.close()}

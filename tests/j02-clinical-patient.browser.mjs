// J02, verified disposable target only. Actual APIs establish all successful states.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {browser,login,get,api,evidence,target,base} from './local-visit-support.mjs'
const f=JSON.parse(readFileSync(target.runtime+'/visit-fixture.json','utf8'))
const prepared=JSON.parse(readFileSync(target.runtime+'/clinical-browser/journey.json','utf8'))
assert.equal(prepared.accepted,true)
const file=evidence+'/journey.json',state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{groups:[]}
state.accepted=false
const save=()=>writeFileSync(file,JSON.stringify(state,null,2)),pass=s=>{if(!state.groups.includes(s))state.groups.push(s);save();console.log('PASS '+s)}
const widths=[375,390,430,768,1024,1440]
async function command(page,name,args){return page.evaluate(async({name,args})=>{const a=await import('/src/api-client.js'),r=await a[name](...args);if(!r.ok)throw Error(JSON.stringify(r));return r.data},{name,args})}
async function matrix(page,name){for(const width of widths){await page.setViewportSize({width,height:1000});await page.evaluate(()=>window.scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow '+width);await page.screenshot({path:evidence+'/'+name+'-'+width+'.png',fullPage:true})}}
async function portal(page,name){await page.goto(base+'/?j02='+Date.now()+'#p/'+name);await page.locator('.pp-shell').waitFor()}
let page
try{
 if(!state.price){const a=await login('owner@example.test');page=a.page;state.price=await command(page,'createServicePrice',[f.service,{branch_ref:f.branch,kind:'priced',amount:'125.50',effective_from:prepared.treatment.clinic_date},'j02-synthetic-price']);save();await a.context.close()}
 if(!state.invoice||state.invoice.status!=='Issued'){
  const s=await login('sprint02.staff@example.test');page=s.page
  if(!state.invoice){state.invoice=await command(page,'createBillingDraft',[prepared.treatment.id,'j02-invoice-draft']);save()}
  if(state.invoice.status==='Draft'){state.invoice=await command(page,'reviewBillingInvoice',[state.invoice.id,{expected_revision:state.invoice.revision},'j02-invoice-review']);save()}
  if(state.invoice.status==='Review'){state.invoice=await command(page,'issueBillingInvoice',[state.invoice.id,{expected_revision:state.invoice.revision},'j02-invoice-issue']);save()}
  assert.equal(state.invoice.status,'Issued');await s.context.close()
 }
 pass('synthetic unpaid invoice established through existing authorized draft, review and issue APIs; no payment')
 const dentist=await login('sprint02.dentist@example.test');page=dentist.page
 if(!state.followup){state.followup=await command(page,'createFollowup',[{patient_id:f.patientId,branch_ref:f.branch,service_ref:f.service,due_on:prepared.treatment.clinic_date,reason:'Synthetic J02 review task'}]);save()}
 await page.getByRole('button',{name:'Prescriptions',exact:true}).first().click()
 const compose=page.locator('details.rx-compose').first();await compose.waitFor();assert.equal(await compose.evaluate(el=>el.open),false)
 await compose.locator(':scope > summary').focus();await page.keyboard.press('Enter');assert.equal(await compose.evaluate(el=>el.open),true)
 await page.getByRole('combobox',{name:/^Visit/}).selectOption(prepared.visit.id)
 await page.getByRole('combobox',{name:'Select medicine 1',exact:true}).selectOption('__other__')
 const medicine=page.getByRole('textbox',{name:'Specify medicine name',exact:true});await medicine.fill('Synthetic retained draft — not clinical advice')
 await compose.locator(':scope > summary').click();await compose.locator(':scope > summary').click();assert.equal(await medicine.inputValue(),'Synthetic retained draft — not clinical advice')
 await page.getByRole('button',{name:'My Queue',exact:true}).first().click()
 await page.getByRole('dialog').getByRole('button',{name:'Stay with encounter',exact:true}).click()
 assert.equal(await medicine.inputValue(),'Synthetic retained draft — not clinical advice')
 pass('prescription progressive disclosure retains draft and existing leave protection; keyboard summary works')
 // Explicitly discard only the unsaved synthetic form through the existing guard.
 await page.getByRole('button',{name:'My Queue',exact:true}).first().click();await page.getByRole('dialog').getByRole('button',{name:'Discard unsaved changes and leave',exact:true}).click()
 await page.getByRole('combobox',{name:'Worklist',exact:true}).selectOption('history')
 const row=page.locator('.enc-queue-row').filter({has:page.locator('.enc-number b').filter({hasText:new RegExp('^'+prepared.visit.queue.queue_number+'$')})})
 await row.getByRole('button',{name:'View completed record',exact:true}).click()
 await page.getByText('Synthetic J02 review task',{exact:false}).waitFor();assert.match(await page.locator('.enc-header').innerText(),new RegExp(prepared.visit.id))
 let release,started;const began=new Promise(r=>started=r),gate=new Promise(r=>release=r)
 const path=api+'/api/patients/'+f.patientId+'/followups'
 await page.route(path,async r=>{const response=await r.fetch();started();await gate;await r.fulfill({response})},{times:1})
 const reload=page.getByRole('button',{name:'Reload care tasks',exact:true});await reload.click();await began;assert.equal(await reload.getAttribute('aria-busy'),'true');assert.equal(await reload.isDisabled(),true);release()
 await page.getByText('Synthetic J02 review task',{exact:false}).waitFor()
 await page.route(path,r=>r.abort('failed'),{times:1});await reload.click();await page.getByText('Loading follow-up tasks…',{exact:true}).waitFor({state:'hidden'});await reload.click();await page.getByText('Synthetic J02 review task',{exact:false}).waitFor()
 await page.route(path,async route=>{const response=await route.fetch(),body=await response.json();body.data[0].patient.id='foreign';body.data[0].reason='FOREIGN SENTINEL';await route.fulfill({response,json:body})},{times:1})
 await reload.click();await page.getByText('Follow-up tasks did not confirm this Patient and branch. Reload to try again.',{exact:true}).waitFor();assert.equal(await page.getByText('FOREIGN SENTINEL',{exact:false}).count(),0)
 await reload.click();await page.getByText('Synthetic J02 review task',{exact:false}).waitFor()
 await matrix(page,'completed-encounter');pass('exact completed encounter, request-owned loading, failed-read recovery and foreign care refusal at six widths')
 const patient=await login('sprint02.patient@example.test');page=patient.page
 const booked=JSON.parse(readFileSync(target.runtime+'/patient-booking/journey.json','utf8')).booked
 await page.getByText(booked.code,{exact:false}).waitFor();await page.locator('.care-balance').getByText('₱125.50',{exact:true}).waitFor()
 await matrix(page,'home');await page.getByRole('button',{name:'View details',exact:true}).click();await page.locator('#visit-'+booked.id+'.is-focus').waitFor()
 pass('Home shows exact persisted next appointment, complete unpaid balance and focused details navigation')
 await portal(page,'home');await page.locator('.care-link').filter({hasText:'Family'}).click();await page.getByRole('button',{name:'Add a child or dependent',exact:true}).click()
 const form=page.locator('form.care-family-form');await form.getByRole('textbox',{name:/First name/}).fill('Synthetic cancelled draft');await form.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await form.count(),0)
 await page.getByRole('button',{name:'Add a child or dependent',exact:true}).click();assert.equal(await form.getByRole('textbox',{name:/First name/}).inputValue(),'');await matrix(page,'family-form');await form.getByRole('button',{name:'Cancel',exact:true}).click()
 await page.route(api+'/api/invoices/mine?*',r=>r.abort('failed'));await portal(page,'home');await page.locator('.care-attention').getByRole('button',{name:'Try again',exact:true}).waitFor();assert.equal(await page.locator('.care-balance').count(),0);await page.unroute(api+'/api/invoices/mine?*');await page.locator('.care-attention').getByRole('button',{name:'Try again',exact:true}).click();await page.locator('.care-balance').getByText('₱125.50',{exact:true}).waitFor()
 pass('Family draft cancellation is reversible without creation; Home failure hides balance and retry restores authoritative total')
 for(const name of ['archives','billing','documents','prescriptions']){await portal(page,name);await page.waitForLoadState('networkidle');await matrix(page,'patient-'+name)}
 pass('treatment history, unpaid invoice, documents and issued prescriptions render at all six widths')
 state.accepted=true;save()
}catch(error){if(page&&!page.isClosed()){writeFileSync(evidence+'/failure-text.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/failure.png',fullPage:true})}throw error}finally{await browser.close()}

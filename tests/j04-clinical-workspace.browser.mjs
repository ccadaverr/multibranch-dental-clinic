// New independently verified synthetic target only. All successful transitions use actual APIs.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {browser,login,get,api,evidence,target} from './local-visit-support.mjs'
const f=JSON.parse(readFileSync(target.runtime+'/visit-fixture.json','utf8'))
const journal=evidence+'/journey.json',state=existsSync(journal)?JSON.parse(readFileSync(journal,'utf8')):{groups:[]};state.accepted=false
const save=()=>writeFileSync(journal,JSON.stringify(state,null,2)),pass=s=>{if(!state.groups.includes(s))state.groups.push(s);save();console.log('PASS '+s)}
async function command(page,name,args){return page.evaluate(async({name,args})=>{const a=await import('/src/api-client.js'),r=await a[name](...args);if(!r.ok)throw Error(JSON.stringify(r));return r.data},{name,args})}
async function response(page,path,work){const pending=page.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()==='POST');await work();const r=await pending;assert.ok(r.status()<300,'command status '+r.status());return (await r.json()).data}
const widths=[375,390,430,768,1024,1440]
const chartLoaded=page=>page.waitForFunction(()=>document.querySelector('[aria-label="Review saved chart"]')?.getAttribute('aria-busy')==='false')
let page
try{
 const staff=await login('sprint02.staff@example.test');page=staff.page
 if(!state.visit){state.visit=await command(page,'walkInVisit',[{patient_id:f.patientId,branch_ref:f.branch,service_ref:f.service,dentist_ref:'sprint02-dentist'},'j04-synthetic-arrival']);save()}
 state.visit=(await get(page,'/api/visits/'+state.visit.id)).body.data
 if(state.visit.queue.status==='Waiting'){await command(page,'queueCommand',[state.visit.queue.id,'call',{expected_revision:state.visit.queue.revision},'j04-synthetic-call']);state.visit=(await get(page,'/api/visits/'+state.visit.id)).body.data;save()}
 assert.equal(state.visit.patient.id,f.patientId);assert.ok(state.treatment?['In Treatment','Served'].includes(state.visit.queue.status)||state.visit.queue.status==='Called':state.visit.queue.status==='Called');await staff.context.close()
 const dentist=await login('sprint02.dentist@example.test');page=dentist.page
 await page.getByRole('button',{name:'My Queue',exact:true}).first().click()
 if(state.treatment?.status==='Completed'){await page.getByRole('combobox',{name:'Worklist',exact:true}).selectOption('history');await page.getByRole('button',{name:'View completed record',exact:true}).click()}
 else if(state.treatment){await page.getByRole('button',{name:'Continue treatment',exact:true}).first().click()}
 else {const q=page.locator('.enc-queue-row').filter({has:page.locator('.enc-number b').filter({hasText:new RegExp('^'+state.visit.queue.queue_number+'$')})});await q.getByRole('button',{name:'Open encounter',exact:true}).click()}
 await page.getByRole('textbox',{name:'Chief complaint',exact:true}).waitFor()
 if(!state.treatment){
  if(!await page.getByRole('combobox',{name:'Procedure 1',exact:true}).count())await page.getByRole('button',{name:'Add performed procedure',exact:true}).click()
  await page.getByRole('combobox',{name:'Procedure 1',exact:true}).selectOption(f.service)
  await page.getByRole('textbox',{name:'Chief complaint',exact:true}).fill('Synthetic J04 examination requested')
  await page.getByRole('textbox',{name:'Procedure / treatment performed',exact:true}).fill('Synthetic J04 documentation fixture')
  state.treatment=await response(page,'/api/visits/'+state.visit.id+'/treatment',()=>page.getByRole('button',{name:'Start Treatment',exact:true}).click());save()
 }
 if(state.treatment.status!=='Completed'){
 await page.getByText(/Saved revision [0-9]+\. Review before completing\./).waitFor()
 const before=await get(page,'/api/treatments/'+state.treatment.id);assert.equal(before.body.data.visit.id,state.visit.id)
 if(!state.receipt){
 const notes=page.getByRole('textbox',{name:'Clinical notes',exact:true});await notes.fill('Synthetic J04 retained treatment draft')
 const preview=page.locator('.enc-chart-preview');await preview.locator('summary').click();await preview.getByRole('button',{name:'Review saved chart',exact:true}).waitFor();await chartLoaded(page)
 assert.equal(await notes.inputValue(),'Synthetic J04 retained treatment draft');assert.equal(await preview.getByRole('button',{name:'Record finding',exact:true}).count(),0);assert.deepEqual((await get(page,'/api/treatments/'+state.treatment.id)).body.data,before.body.data)
 pass('authorized exact Visit start; inline chart review retains unsaved treatment and exposes no chart write')
 state.treatment=await response(page,'/api/treatments/'+state.treatment.id+'/document',()=>page.getByRole('button',{name:'Save Treatment Progress',exact:true}).click());save()
 await page.getByText(/Saved on the clinic server/).waitFor()
 }
 await page.getByRole('button',{name:'Open dental chart',exact:true}).click();await chartLoaded(page)
 const header=page.getByRole('banner',{name:'Current chart Patient and Visit'})
 // The section header is intentionally labelled, independent of landmark nesting rules.
 assert.match(await page.locator('.chart-context').innerText(),new RegExp(state.visit.id));assert.match(await page.locator('.chart-context').innerText(),new RegExp(state.treatment.id))
 const choose=page.getByRole('combobox',{name:'Choose tooth',exact:true});await choose.selectOption('16')
 const submit=page.getByRole('button',{name:'Record finding',exact:true});assert.equal(await submit.isDisabled(),true)
 const tooth=page.locator('svg.od-arch-svg [data-tooth="16"]'),transform=await tooth.getAttribute('transform')
 await tooth.hover();assert.equal(await tooth.getAttribute('transform'),transform)
 await page.getByRole('button',{name:'Front view',exact:true}).click();assert.equal(await choose.inputValue(),'16');await page.getByRole('button',{name:'Top view (Arch)',exact:true}).click();assert.equal(await choose.inputValue(),'16')
 if(!state.receipt){
  await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('Caries');await page.getByRole('checkbox',{name:'O',exact:true}).check();await page.getByRole('textbox',{name:/Note \(optional\)/}).fill('Synthetic J04 private tooth observation')
  const sends=[];page.on('request',r=>{if(r.url()===api+'/api/patients/'+f.patientId+'/chart'&&r.method()==='POST')sends.push({key:r.headers()['idempotency-key'],body:r.postDataJSON()})})
  await page.route(api+'/api/patients/'+f.patientId+'/chart',async route=>{if(route.request().method()!=='POST')return route.continue();const r=await route.fetch();assert.equal(r.status(),201);state.receipt=(await r.json()).meta.chart_receipt;save();await route.abort('failed')},{times:1})
  await submit.evaluate(b=>{b.click();b.click()});const retry=page.getByRole('button',{name:'Retry same finding',exact:true});await retry.waitFor();assert.equal(sends.length,1);assert.equal(await page.getByRole('combobox',{name:'Status',exact:true}).isDisabled(),true)
  await retry.focus();await page.keyboard.press('Enter');await page.getByText(new RegExp('^Finding '+state.receipt.entry_id+' saved for tooth 16, revision 1\\.')).waitFor();assert.equal(sends.length,2);assert.deepEqual(sends[0],sends[1])
 }
 assert.equal(await submit.isDisabled(),true)
 const persisted=(await get(page,'/api/patients/'+f.patientId+'/chart')).body.data;assert.equal(persisted.tooth_revisions['16'],1);assert.equal(state.receipt.visit_id,state.visit.id);assert.equal(state.receipt.treatment_id,state.treatment.id)
 const original=persisted.history.find(e=>e.id===state.receipt.entry_id);assert.equal(original.note,'Synthetic J04 private tooth observation')
 await page.getByRole('region',{name:'Current saved findings',exact:true}).getByText('Caries',{exact:true}).waitFor()
 assert.equal(await tooth.getAttribute('transform'),transform)
 pass('explicit condition choice; same-key committed-response recovery; exact Patient/branch/tooth/Visit/encounter receipt and current/history readback')
 for(const width of widths){
  await page.setViewportSize({width,height:1000});await chartLoaded(page)
  assert.equal(await choose.inputValue(),'16');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  if(width<600){await page.getByRole('button',{name:'Enlarge chart',exact:true}).click();assert.ok((await page.locator('.od-arch-svg').boundingBox()).width>=539);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.getByRole('button',{name:'Fit chart',exact:true}).click();assert.equal(await choose.inputValue(),'16')}
  await page.getByRole('textbox',{name:/Note \(optional\)/}).scrollIntoViewIfNeeded()
  const geo=await page.evaluate(()=>({identity:document.querySelector('.chart-context').getBoundingClientRect().toJSON(),top:document.querySelector('.topbar').getBoundingClientRect().bottom}));assert.ok(geo.identity.y>=geo.top-1);assert.ok(geo.identity.bottom<1000)
  await page.screenshot({path:evidence+'/chart-focused-'+width+'.png'});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:evidence+'/chart-'+width+'.png',fullPage:true})
 }
 pass('six-width selected tooth, stable geometry, local magnification, sticky exact identity and no page overflow')
 let release,started;const began=new Promise(r=>started=r),gate=new Promise(r=>release=r)
 await page.route(api+'/api/patients/'+f.patientId+'/chart',async route=>{if(route.request().method()!=='GET')return route.continue();const r=await route.fetch();started();await gate;await route.fulfill({response:r})},{times:1})
 await page.getByRole('button',{name:'Review saved chart',exact:true}).click();await began;assert.equal(await page.getByRole('button',{name:'Review saved chart',exact:true}).getAttribute('aria-busy'),'true');release();await chartLoaded(page);assert.equal(await choose.inputValue(),'16')
 await page.route(api+'/api/patients/'+f.patientId+'/chart',r=>r.abort('failed'),{times:1});await page.getByRole('button',{name:'Review saved chart',exact:true}).click();await page.getByRole('button',{name:'Retry chart',exact:true}).click();await chartLoaded(page);assert.equal(await choose.inputValue(),'16')
 await page.route(api+'/api/patients/'+f.patientId+'/chart',async route=>{const r=await route.fetch(),body=await r.json();body.data.current[0].tooth='19';await route.fulfill({response:r,json:body})},{times:1});await page.getByRole('button',{name:'Review saved chart',exact:true}).click();await page.getByText('The chart did not confirm this Patient, tooth identities and saved revisions. No findings were adopted.',{exact:true}).waitFor();await page.getByRole('button',{name:'Retry chart',exact:true}).click();await chartLoaded(page)
 pass('actual reload spinner, preserved selection, failed-read retry and malformed FDI refusal')
 const other=await login('sprint02.dentist@example.test'),p2=other.page
 const result=await p2.evaluate(async({patientId,revision,branch,treatment})=>{const a=await import('/src/api-client.js');return a.recordChartEntry(patientId,{tooth:'16',status:'Filled',surfaces:['O'],recorded_on:new Date(Date.now()+8*3600e3).toISOString().slice(0,10),note:'Synthetic J04 newer saved revision',branch_ref:branch,treatment_id:treatment.id,expected_treatment_revision:treatment.revision,expected_revision:revision},'j04-intervening')},{patientId:f.patientId,revision:1,branch:f.branch,treatment:state.treatment});assert.equal(result.ok,true)
 await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('Caries');const note=page.getByRole('textbox',{name:/Note \(optional\)/});await note.fill('Synthetic J04 retained stale draft');await submit.click();await page.getByText('This tooth changed after you reviewed it. Load the current chart before recording another finding.',{exact:true}).first().waitFor();assert.equal(await note.inputValue(),'Synthetic J04 retained stale draft');assert.equal(await submit.isDisabled(),true)
 await page.getByRole('button',{name:'Review saved chart',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await note.inputValue(),'Synthetic J04 retained stale draft')
 await page.getByRole('button',{name:'Review saved chart',exact:true}).click();await page.getByRole('button',{name:'Load saved chart',exact:true}).click();await chartLoaded(page);assert.equal(await choose.inputValue(),'16');await page.getByText('Synthetic J04 newer saved revision',{exact:true}).waitFor()
 const after=(await get(page,'/api/patients/'+f.patientId+'/chart')).body.data;assert.deepEqual(after.history.find(e=>e.id===original.id),original)
 await other.context.close();pass('second-session CAS conflict retains draft; explicit review keeps selected tooth and immutable original history')
 // Primary tooth selection survives a saved-chart reload and preserves FDI storage semantics.
 await page.getByRole('button',{name:'Primary (20)',exact:true}).click();await choose.selectOption('55');await page.getByRole('button',{name:'Review saved chart',exact:true}).click();await chartLoaded(page);assert.equal(await choose.inputValue(),'55');assert.equal(await page.getByRole('button',{name:'Primary (20)',exact:true}).getAttribute('aria-pressed'),'true')
 await page.getByRole('button',{name:'Return to encounter',exact:true}).click();await page.getByRole('textbox',{name:'Clinical notes',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Clinical notes',exact:true}).inputValue(),'Synthetic J04 retained treatment draft')
 await page.getByRole('button',{name:'Complete Treatment',exact:true}).click();state.treatment=await response(page,'/api/treatments/'+state.treatment.id+'/complete',()=>page.getByRole('dialog').getByRole('button',{name:'Complete Treatment',exact:true}).click());save();assert.equal(state.treatment.status,'Completed');await page.getByText('Treatment completion confirmed by the clinic server.',{exact:true}).waitFor()
 }
 const completedBefore=(await get(page,'/api/treatments/'+state.treatment.id)).body.data
 await page.getByRole('button',{name:'All completed Patient encounters',exact:true}).click();await page.getByRole('button',{name:/Review encounter/}).click();await page.getByRole('region',{name:'Historical encounter',exact:true}).waitFor();await page.getByRole('button',{name:'Review current Patient chart',exact:true}).click();await chartLoaded(page);assert.equal(await page.getByRole('button',{name:'Record finding',exact:true}).count(),0);await page.getByRole('combobox',{name:'Choose tooth',exact:true}).selectOption('16');await page.getByText('Synthetic J04 newer saved revision',{exact:true}).waitFor()
 assert.deepEqual((await get(page,'/api/treatments/'+state.treatment.id)).body.data,completedBefore)
 pass('primary selection retained; explicit treatment completion and authorized historical chart remain read-only without mutating completed documentation')
 await page.getByRole('button',{name:'Dental Chart',exact:true}).first().click();await page.getByRole('button',{name:'Reload authorized visits',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="Reload authorized visits"]')?.getAttribute('aria-busy')==='false')
 assert.equal((await get(page,'/api/patients?search=Patient')).status,403)
 await page.getByRole('searchbox',{name:'Search chart Patients',exact:true}).fill(f.patientCode);await page.locator('.patient-picker-list button').filter({hasText:f.patientCode}).click();await chartLoaded(page);assert.match(await page.locator('.chart-context').innerText(),new RegExp(f.patientId))
 if(!state.primaryProof){await page.getByRole('button',{name:'Primary (20)',exact:true}).click();const primary=page.getByRole('combobox',{name:'Choose tooth',exact:true});await primary.selectOption('55');const button=page.getByRole('button',{name:'Record finding',exact:true});assert.equal(await button.isDisabled(),true);await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('Caries');await page.getByRole('textbox',{name:/Note \(optional\)/}).fill('Synthetic J04 explicit primary finding');const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/patients/'+f.patientId+'/chart'&&r.request().method()==='POST');await button.click();const r=await saved;assert.equal(r.status(),201);state.primaryProof=(await r.json()).meta.chart_receipt;save();await page.getByText(new RegExp('^Finding '+state.primaryProof.entry_id+' saved for tooth 55, revision 1\\.')).waitFor();assert.equal(await page.getByRole('combobox',{name:'Status',exact:true}).inputValue(),'');assert.equal(await button.isDisabled(),true);assert.equal(state.primaryProof.tooth,'55');assert.equal(state.primaryProof.treatment_id,null);assert.equal(state.primaryProof.visit_id,null)}
 pass('standalone chart uses authorized Visit search; forbidden directory stays denied; explicit primary finding clears the status to prevent accidental repeat')
 state.accepted=true;save()
}catch(error){if(page&&!page.isClosed()){writeFileSync(evidence+'/failure-text.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/failure.png',fullPage:true})}throw error}finally{await browser.close()}

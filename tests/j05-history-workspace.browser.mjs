// Explicit new synthetic J05 target; historical bulk fixture is read data, transitions below use actual APIs.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {browser,login,get,api,evidence,target} from './local-visit-support.mjs'
const f=JSON.parse(readFileSync(target.runtime+'/visit-fixture.json','utf8')),old=JSON.parse(readFileSync(target.runtime+'/history-fixture.json','utf8'))
const path=evidence+'/j05-state.json',state=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{groups:[]};state.accepted=false;state.run=(state.run||0)+1
const draftText='Synthetic J05 unsaved treatment draft '+state.run
const save=()=>writeFileSync(path,JSON.stringify(state,null,2)),pass=s=>{if(!state.groups.includes(s))state.groups.push(s);save();console.log('PASS '+s)}
async function command(page,name,args){return page.evaluate(async({name,args})=>{const a=await import('/src/api-client.js'),r=await a[name](...args);assertResult(r);return r.data;function assertResult(r){if(!r.ok)throw Error('Synthetic command refused: '+r.kind)}},{name,args})}
const loaded=page=>page.waitForFunction(()=>document.querySelector('[aria-label="Reload authorized visits"]')?.getAttribute('aria-busy')==='false')
const chartLoaded=page=>page.waitForFunction(()=>document.querySelector('[aria-label="Review saved chart"]')?.getAttribute('aria-busy')==='false')
const widths=[375,390,430,768,1024,1440]
let page
try{
 const dentist=await login('sprint02.dentist@example.test');page=dentist.page
 await page.getByRole('button',{name:'Dental Chart',exact:true}).first().click();await loaded(page)
 await page.getByRole('searchbox',{name:'Search chart Patients',exact:true}).fill(old.olderOnlyPatient.code)
 assert.equal(await page.locator('.patient-picker-list button').filter({hasText:old.olderOnlyPatient.code}).count(),0)
 const dates=page.getByRole('form',{name:'Chart Visit dates',exact:true}),requests=[]
 page.on('request',r=>{const u=new URL(r.url());if(u.pathname==='/api/visits')requests.push(u.searchParams.get('page'))})
 await dates.getByLabel('From',{exact:true}).fill('2025-01-01');await dates.getByLabel('To',{exact:true}).fill('2025-01-31')
 await page.route(api+'/api/visits?**',r=>new URL(r.request().url()).searchParams.get('page')==='2'?r.abort('failed'):r.continue(),{times:2})
 await dates.getByRole('button',{name:'Apply dates',exact:true}).click();await page.getByRole('button',{name:'Retry authorized visits',exact:true}).waitFor();assert.equal(await page.locator('.patient-picker-list button').count(),0)
 await page.getByRole('button',{name:'Retry authorized visits',exact:true}).click();await loaded(page);await page.locator('.patient-picker-list button').filter({hasText:old.olderOnlyPatient.code}).waitFor();assert(requests.includes('3'))
 for(const width of widths){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:evidence+'/discovery-'+width+'.png',fullPage:true})}
 await dates.getByLabel('To',{exact:true}).fill('2025-12-31');await dates.getByRole('button',{name:'Apply dates',exact:true}).click();await page.getByRole('alert').filter({hasText:'184 days'}).waitFor();assert.equal(await page.locator('.patient-picker-list button').filter({hasText:old.olderOnlyPatient.code}).count(),1)
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();await loaded(page);assert.equal(await page.getByRole('searchbox',{name:'Search chart Patients',exact:true}).inputValue(),'');assert.equal(await page.getByRole('button',{name:'Clear filters',exact:true}).count(),0)
 let releaseOld,oldStarted;const oldGate=new Promise(r=>releaseOld=r),oldBegan=new Promise(r=>oldStarted=r)
 await page.route(api+'/api/visits?**',async route=>{const r=await route.fetch();oldStarted();await oldGate;await route.fulfill({response:r})},{times:1})
 await dates.getByLabel('From',{exact:true}).fill('2025-01-01');await dates.getByLabel('To',{exact:true}).fill('2025-01-31');await dates.getByRole('button',{name:'Apply dates',exact:true}).click();await oldBegan
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();await loaded(page);const oldResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/visits'&&new URL(r.url()).searchParams.get('from')==='2025-01-01');releaseOld();await oldResponse
 assert.equal(await dates.getByLabel('To',{exact:true}).inputValue(),new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));assert.equal(await page.locator('.patient-picker-list button').filter({hasText:old.olderOnlyPatient.code}).count(),0)
 pass('older-only Patient beyond Visit page 2; complete-page retry, bounded date validation, filter reset and six widths')
 const staff=await login('sprint02.staff@example.test')
 if(!state.visit){state.visit=await command(staff.page,'walkInVisit',[{patient_id:f.patientId,branch_ref:f.branch,service_ref:f.service,dentist_ref:f.dentist},'j05-arrival']);save()}
 const actual=(await get(staff.page,'/api/visits/'+state.visit.id)).body.data
 if(actual.queue.status==='Waiting')await command(staff.page,'queueCommand',[actual.queue.id,'call',{expected_revision:actual.queue.revision},'j05-call'])
 await staff.context.close()
 await page.getByRole('button',{name:'My Queue',exact:true}).first().click()
 if(state.treatment)await page.getByRole('button',{name:'Continue treatment',exact:true}).first().click()
 else {
  const row=page.locator('.enc-queue-row').filter({has:page.locator('.enc-number b').filter({hasText:new RegExp('^'+actual.queue.queue_number+'$')})});await row.getByRole('button',{name:'Open encounter',exact:true}).click()
  await page.getByRole('button',{name:'Add performed procedure',exact:true}).click();await page.getByRole('combobox',{name:'Procedure 1',exact:true}).selectOption(f.service)
  await page.getByRole('textbox',{name:'Chief complaint',exact:true}).fill('Synthetic J05 active history review');await page.getByRole('textbox',{name:'Procedure / treatment performed',exact:true}).fill('Synthetic J05 procedure fixture')
  const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/visits/'+state.visit.id+'/treatment'&&r.request().method()==='POST');await page.getByRole('button',{name:'Start Treatment',exact:true}).click();state.treatment=(await (await pending).json()).data;save()
 }
 const notes=page.getByRole('textbox',{name:'Clinical notes',exact:true});await notes.fill(draftText)
 const before=(await get(page,'/api/treatments/'+state.treatment.id)).body.data,preview=page.locator('.enc-history-preview');await preview.locator(':scope > summary').click();await preview.getByText('Page 1 of 11',{exact:true}).waitFor()
 for(let p=2;p<=11;p++){await preview.getByRole('button',{name:'Older encounters',exact:true}).click();await preview.getByText('Page '+p+' of 11',{exact:true}).waitFor();await preview.getByRole('button',{name:'Reload clinical history',exact:true}).evaluate(b=>b.getAttribute('aria-busy')==='false')}
 const first=old.records[0],second=old.records[1],review=id=>preview.getByRole('button',{name:new RegExp('reference '+id+'$')})
 await page.route(api+'/api/treatments/'+first.id,async route=>{const r=await route.fetch(),body=await r.json();body.data.visit.id=second.visitId;await route.fulfill({response:r,json:body})},{times:1})
 await review(first.id).click();await preview.getByRole('button',{name:'Retry encounter',exact:true}).waitFor();assert.equal(await preview.getByRole('region',{name:'Historical encounter',exact:true}).count(),0);assert.equal(await notes.inputValue(),draftText)
 await preview.getByRole('button',{name:'Retry encounter',exact:true}).click();await preview.getByRole('region',{name:'Historical encounter',exact:true}).waitFor();assert.match(await preview.getByRole('region',{name:'Historical encounter',exact:true}).innerText(),new RegExp(first.visitId))
 let release,started;const gate=new Promise(r=>release=r),began=new Promise(r=>started=r)
 await page.route(api+'/api/treatments/'+first.id,async route=>{const r=await route.fetch();started();await gate;await route.fulfill({response:r})},{times:1})
 await review(first.id).click();await began;await review(second.id).click();await preview.getByRole('region',{name:'Historical encounter',exact:true}).waitFor();release();await preview.getByText('Synthetic J05 historical documentation 2',{exact:true}).waitFor();assert.equal(await preview.getByText('Synthetic J05 historical documentation 1',{exact:true}).count(),0)
 assert.deepEqual((await get(page,'/api/treatments/'+state.treatment.id)).body.data,before);assert.equal(await notes.inputValue(),draftText)
 for(const width of widths){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:evidence+'/inline-history-'+width+'.png',fullPage:true})}
 pass('history page 11 beyond 200, exact wrong-Visit refusal, late detail rejection and unsaved treatment preservation')
 await preview.locator(':scope > summary').click();assert.equal(await notes.inputValue(),draftText)
 const saving=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/treatments/'+state.treatment.id+'/document'&&r.request().method()==='POST');await page.getByRole('button',{name:'Save Treatment Progress',exact:true}).click();const saved=(await (await saving).json()).data;state.treatment=saved;save();assert.equal(saved.clinical_notes,draftText);await page.getByText(/Saved on the clinic server/).waitFor()
 await page.getByRole('button',{name:'Open dental chart',exact:true}).click();await chartLoaded(page);await page.getByRole('combobox',{name:'Choose tooth',exact:true}).selectOption('16')
 const note=page.getByRole('textbox',{name:/Note \(optional\)/});await note.fill('Synthetic J05 retained finding draft')
 const history=page.getByRole('region',{name:'Recorded tooth history',exact:true});assert.equal(await history.locator('.od-history-entry').count(),10);await history.getByRole('button',{name:'Older findings',exact:true}).click();await history.getByText('Page 2 of 3',{exact:true}).waitFor();assert.equal(await note.inputValue(),'Synthetic J05 retained finding draft')
 const entry=history.locator('.od-history-entry').first();await entry.locator('summary').focus();await page.keyboard.press('Enter');await entry.getByRole('button',{name:'Review linked encounter',exact:true}).focus();await page.keyboard.press('Enter')
 const linked=page.getByRole('region',{name:'Linked encounter review',exact:true});await linked.getByRole('region',{name:'Historical encounter',exact:true}).waitFor();assert.equal(await linked.getByRole('button',{name:'Record finding',exact:true}).count(),0);assert.equal(await note.inputValue(),'Synthetic J05 retained finding draft')
 for(const width of widths){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:evidence+'/linked-history-'+width+'.png',fullPage:true})}
 await linked.getByRole('button',{name:'Close encounter review',exact:true}).click();assert.equal(await entry.getByRole('button',{name:'Review linked encounter',exact:true}).evaluate(b=>b===document.activeElement),true);assert.equal(await note.inputValue(),'Synthetic J05 retained finding draft')
 pass('dense original tooth history, local paging, keyboard linked encounter review and finding-draft/focus preservation at six widths')
 state.accepted=true;save()
}catch(error){if(page&&!page.isClosed()){writeFileSync(evidence+'/failure-text.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/failure.png',fullPage:true})}throw error}finally{await browser.close()}

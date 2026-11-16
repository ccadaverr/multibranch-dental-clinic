// Actual clinical workflow on the owned private demo; only explicitly lost responses are intercepted.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
const {browser,login,get,api,evidence,target}=await import('./local-visit-support.mjs')
const f=JSON.parse(readFileSync(target.runtime+'/visit-fixture.json','utf8'))
const arrivals=JSON.parse(readFileSync(target.runtime+'/arrival-browser-batch02/journey.json','utf8'))
const file=evidence+'/journey.json',state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{groups:[]}
const save=()=>writeFileSync(file,JSON.stringify(state,null,2)),pass=name=>{if(!state.groups.includes(name))state.groups.push(name);save();console.log('PASS '+name)}
state.accepted=false;save();let page
try{
 const dentist=await login('sprint02.dentist@example.test');page=dentist.page;page.setDefaultTimeout(45000)
 const open=async(code)=>{
  await page.getByRole('button',{name:'My Queue',exact:true}).first().click()
  const row=page.locator('article.enc-queue-row').filter({hasText:code});await row.waitFor()
  if(await row.getByRole('button',{name:'Call and open encounter',exact:true}).count())await row.getByRole('button',{name:'Call and open encounter',exact:true}).click()
  else await row.getByRole('button',{name:'Open encounter',exact:true}).click()
  await page.getByRole('textbox',{name:'Chief complaint',exact:true}).waitFor()
 }
 if(!state.scheduled){
  await open(f.patientCode);await page.getByRole('textbox',{name:'Chief complaint',exact:true}).fill('Synthetic encounter recovery acceptance')
  const posts=[];page.on('request',r=>{if(r.url()===api+'/api/visits/'+arrivals.visit.id+'/treatment'&&r.method()==='POST')posts.push({body:r.postDataJSON(),key:r.headers()['idempotency-key']})})
  await page.route(api+'/api/visits/'+arrivals.visit.id+'/treatment',async route=>{const r=await route.fetch();assert.equal(r.status(),201);state.scheduled=(await r.json()).data;save();await route.abort('failed')},{times:1})
  await page.getByRole('button',{name:'Start Treatment',exact:true}).evaluate(b=>{b.click();b.click()})
  const retry=page.getByRole('button',{name:'Retry same command',exact:true});await retry.waitFor();await retry.focus();await page.keyboard.press('Enter')
  await page.getByText('Saved on the clinic server. Revision 2.',{exact:true}).waitFor()
  assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);assert.equal(posts[0].body.queue_id,arrivals.visit.queue.id);assert.equal(posts[0].body.expected_queue_revision,2)
  assert.equal(await page.getByRole('textbox',{name:'Chief complaint',exact:true}).inputValue(),'Synthetic encounter recovery acceptance')
  pass('scheduled queue → exact encounter → committed response loss → keyboard same-key retry → original draft saved once')
 }
 let saved=await get(page,'/api/visits/'+arrivals.visit.id+'/treatment');assert.equal(saved.status,200);assert.equal(saved.body.data.id,state.scheduled.id);assert.equal(saved.body.data.patient.id,f.patientId);assert.equal(saved.body.data.appointment.id,arrivals.appointment.id)
 const fresh=await login('sprint02.dentist@example.test');await dentist.context.close();page=fresh.page;page.setDefaultTimeout(45000)
 await page.getByRole('button',{name:'My Queue',exact:true}).first().click()
 if(saved.body.data.status==='In Treatment'){
  await page.getByRole('button',{name:'Continue treatment',exact:true}).click()
  await page.getByText(arrivals.visit.id,{exact:true}).waitFor();await page.getByText('Encounter '+state.scheduled.id,{exact:true}).waitFor()
  pass('new Dentist session continues the same persisted Visit/Patient/queue/encounter without duplicate opening')
  // Explicit synthetic completion only to free this Dentist for the independent walk-in start below.
  if(!saved.body.data.procedures.length){await page.getByRole('button',{name:'Add performed procedure',exact:true}).click();await page.getByRole('combobox',{name:/^Procedure 1/}).selectOption(f.service);await page.getByRole('textbox',{name:'Procedure / treatment performed',exact:true}).fill('Synthetic performed procedure');await page.getByRole('button',{name:'Save Treatment Progress',exact:true}).click();await page.getByText(/Saved on the clinic server\. Revision/).waitFor()}
  await page.getByRole('button',{name:'Complete Treatment',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Complete Treatment',exact:true}).click();await page.getByText('Treatment completion confirmed by the clinic server.',{exact:true}).waitFor()
 }
 if(!state.walkin){
  await open(arrivals.walkPatient.code)
  await page.route(api+'/api/visits/'+arrivals.walkVisit.id+'/treatment',async route=>{const r=await route.fetch();assert.equal(r.status(),201);state.walkin=(await r.json()).data;save();await route.abort('failed')},{times:1})
  await page.getByRole('button',{name:'Start Treatment',exact:true}).click();await page.getByRole('button',{name:'Retry same command',exact:true}).waitFor()
  await page.reload()
 }
 await page.getByRole('button',{name:'My Queue',exact:true}).first().click();await page.getByRole('button',{name:'Continue treatment',exact:true}).click()
 await page.getByText('Encounter '+state.walkin.id,{exact:true}).waitFor();await page.getByText(arrivals.walkVisit.id,{exact:true}).waitFor()
 const walk=await get(page,'/api/visits/'+arrivals.walkVisit.id+'/treatment');assert.equal(walk.status,200);assert.equal(walk.body.data.appointment,null);assert.equal(walk.body.data.status,'In Treatment');assert.equal(walk.body.data.completed_at,null);assert.equal(walk.body.data.visit.queue.id,arrivals.walkVisit.queue.id);assert.equal(walk.body.data.visit.queue.status,'Served')
 pass('walk-in committed start → reload without retry → same encounter, null appointment, Served means treatment started')
 const patient=await login('sprint02.patient@example.test',390);assert.equal((await get(patient.page,'/api/visits/'+arrivals.walkVisit.id+'/treatment')).status,403)
 const staff=await login('sprint02.staff@example.test');assert.equal((await get(staff.page,'/api/visits/'+arrivals.walkVisit.id+'/treatment')).status,403)
 await patient.context.close();await staff.context.close();pass('Patient and Staff cannot use Dentist encounter recovery endpoint')
 if(!state.calledAndOpened){
  await page.getByRole('button',{name:'My Queue',exact:true}).first().click()
  const waiting=page.locator('article.enc-queue-row').filter({hasText:arrivals.retryWalkPatient.code})
  const action=waiting.getByRole('button',{name:'Call and open encounter',exact:true});await action.focus();await page.keyboard.press('Enter')
  await page.getByRole('textbox',{name:'Chief complaint',exact:true}).waitFor();await page.getByText(arrivals.retryWalkVisit.id,{exact:true}).waitFor()
  const called=await get(page,'/api/visits/'+arrivals.retryWalkVisit.id);assert.equal(called.body.data.status,'Checked In');assert.equal(called.body.data.queue.status,'Called')
  assert.equal((await get(page,'/api/visits/'+arrivals.retryWalkVisit.id+'/treatment')).status,404)
  state.calledAndOpened=true;save();pass('GEN-09 Waiting → Called and exact encounter review takes one keyboard action, creates no treatment')
  await page.getByRole('button',{name:'My Queue',exact:true}).first().click();await page.getByRole('button',{name:'Continue treatment',exact:true}).click()
 }
 for(const width of [375,390,430,768,1024,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'overflow at '+width);await page.screenshot({path:evidence+'/encounter-'+width+'.png',fullPage:true})}
 pass('exact encounter recovery is keyboard-operated and renders without horizontal overflow at all six widths')
 state.accepted=true;save()
}catch(e){if(page){writeFileSync(evidence+'/failure-text.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/failure.png',fullPage:true})}throw e}finally{await browser.close()}

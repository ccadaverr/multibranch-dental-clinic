// Real React/Laravel/PostgreSQL admission. Only intentionally lost responses are intercepted.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
const {browser,login,get,api,evidence,target}=await import('./local-visit-support.mjs')
const fixture=JSON.parse(readFileSync(target.runtime+'/visit-fixture.json','utf8'))
const journal=evidence+'/journey.json',state=existsSync(journal)?JSON.parse(readFileSync(journal,'utf8')):{groups:[]}
const save=()=>writeFileSync(journal,JSON.stringify(state,null,2)),pass=name=>{if(!state.groups.includes(name))state.groups.push(name);save();console.log('PASS '+name)}
state.accepted=false;save()
let page
try{
 const staff=await login('sprint02.staff@example.test');page=staff.page;page.setDefaultTimeout(45000)
 if(!state.appointment){
  const current=await page.evaluate(()=>new Date(Date.now()+8*3600e3).toISOString().slice(0,10))
  const availability=await page.evaluate(async args=>(await import('/src/api-client.js')).appointmentAvailability(args),{branch_ref:fixture.branch,service_ref:fixture.service,dentist_ref:fixture.dentist,patient_id:fixture.patientId,date:current})
  assert.equal(availability.ok,true);const slot=availability.data.slots[0];assert.ok(slot,'Synthetic all-day fixture must have a current available slot')
  const created=await page.evaluate(async({body,key})=>(await import('/src/api-client.js')).createAppointment(body,key),{body:{patient_id:fixture.patientId,branch_ref:fixture.branch,service_ref:fixture.service,dentist_ref:fixture.dentist,date:current,start_time:slot.start_time},key:'batch02-scheduled-'+Date.now()})
  assert.equal(created.ok,true,JSON.stringify(created));state.appointment=created.data;save()
 }
 await page.getByRole('button',{name:'Check-In',exact:true}).first().click()
 await page.getByRole('button',{name:'Refresh',exact:true}).first().click()
 const originalPosts=[];page.on('request',r=>{if(r.url()===api+'/api/visits/check-in'&&r.method()==='POST')originalPosts.push({body:r.postDataJSON(),key:r.headers()['idempotency-key']})})
 if(!state.visit){
  await page.getByRole('combobox',{name:'Today’s appointment',exact:true}).selectOption(state.appointment.id)
  await page.getByRole('button',{name:'Confirm arrival',exact:true}).click()
  await page.getByText(/Confirm that the patient presented a valid ID/).waitFor();assert.equal(originalPosts.length,0)
  pass('scheduled arrival requires explicit physical-ID confirmation; no automatic admission')
  const record=await get(page,'/api/patients/'+fixture.patientId)
  if(!record.body.data.id_check){
   await page.getByRole('combobox',{name:'ID shown',exact:true}).selectOption('other')
   const specify=page.getByRole('textbox',{name:/^Specify ID type/})
   await specify.fill('   ');assert.equal(await page.getByRole('button',{name:'ID checked',exact:true}).isDisabled(),true)
   await specify.fill('Synthetic barangay ID')
   await page.route(api+'/api/patients/'+fixture.patientId+'/verify-id',async route=>{const r=await route.fetch();assert.equal(r.status(),200);assert.equal((await r.json()).data.patient_id,fixture.patientId);await route.abort('failed')},{times:1})
   await page.getByRole('button',{name:'ID checked',exact:true}).click()
   await page.getByRole('button',{name:'Reload ID status',exact:true}).click()
   await page.getByText(/ID checked: Other valid ID \(Synthetic barangay ID\)/).waitFor()
  }
  pass('Other ID validates and persisted verification recovers after a committed lost response')
  await page.getByRole('checkbox',{name:'Valid ID presented',exact:true}).check()
  await page.route(api+'/api/visits/check-in',async route=>{const r=await route.fetch();assert.equal(r.status(),201);state.visit=(await r.json()).data;save();await route.abort('failed')},{times:1})
  await page.getByRole('button',{name:'Confirm arrival',exact:true}).evaluate(b=>{b.click();b.click()})
  const retry=page.getByRole('button',{name:'Retry the same arrival',exact:true});await retry.waitFor()
  assert.equal(await page.getByRole('checkbox',{name:'Valid ID presented',exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:'Walk-in admission',exact:true}).isDisabled(),true)
  await retry.focus();await page.keyboard.press('Enter')
  await page.locator('.notice').filter({hasText:'Arrival receipt'}).filter({hasText:state.visit.id}).waitFor()
  assert.equal(originalPosts.length,2);assert.deepEqual(originalPosts[0],originalPosts[1]);assert.equal(originalPosts[0].body.expected_revision,state.appointment.revision);assert.equal(originalPosts[0].body.id_confirmed,true)
  pass('committed scheduled response lost → frozen keyboard retry → same Visit and queue receipt')
 }
 let current=await get(page,'/api/visits/'+state.visit.id)
 assert.equal(current.body.data.appointment.id,state.appointment.id);assert.equal(current.body.data.patient.id,fixture.patientId)
 assert.equal(current.body.data.status,'Checked In');assert.equal(current.body.data.queue.status,'Waiting')
 await page.reload();await page.getByRole('button',{name:'Check-In',exact:true}).first().click()
 const arrivalRow=()=>page.locator('ul.fd-list > li').filter({hasText:fixture.patientCode})
 await arrivalRow().getByRole('button',{name:'Review arrival receipt',exact:true}).click();await arrivalRow().getByText(/Original arrival verified:/).waitFor()
 pass('scheduled visit/appointment/Waiting queue linkage and original receipt survive reload')
 // Same account in a separate authenticated browser session uses durable server evidence, not in-memory keys.
 const fresh=await login('sprint02.staff@example.test');page=fresh.page;page.setDefaultTimeout(45000)
 await page.getByRole('button',{name:'Check-In',exact:true}).first().click()
 await arrivalRow().getByRole('button',{name:'Review arrival receipt',exact:true}).click();await arrivalRow().getByText(/Original arrival verified:/).waitFor()
 pass('new authenticated Staff session recovers the exact original arrival receipt')
 const patient=await login('sprint02.patient@example.test',390)
 assert.equal((await get(patient.page,'/api/appointments/'+state.appointment.id)).body.data.status,'Checked In')
 assert.equal((await get(patient.page,'/api/visits/'+state.visit.id)).status,403)
 const dentist=await login('sprint02.dentist@example.test')
 const seen=await get(dentist.page,'/api/visits/'+state.visit.id);assert.equal(seen.status,200);assert.equal(seen.body.data.queue.status,'Waiting');assert.equal(seen.body.data.status,'Checked In')
 const other=await login('patient@example.test',390);assert.equal((await get(other.page,'/api/appointments/'+state.appointment.id)).status,403)
 await patient.context.close();await dentist.context.close();await other.context.close();await staff.context.close()
 pass('Patient sees own Checked In appointment; other Patient denied; assigned Dentist sees Waiting without treatment completion')
 if(!state.walkPatient){
  const r=await page.evaluate(async body=>(await import('/src/api-client.js')).registerPatient(body,'batch02-patient-'+Date.now()),{first_name:'Walkin'+Date.now(),last_name:'Synthetic Acceptance'})
  assert.equal(r.ok,true);state.walkPatient=r.data;save()
 }
 if(!state.walkVisit){
  await page.getByRole('button',{name:'Walk-in admission',exact:true}).click()
  const search=page.getByRole('combobox',{name:/^Patient/})
  await search.fill(state.walkPatient.code);await page.getByRole('option').filter({hasText:state.walkPatient.code}).waitFor();await search.press('ArrowDown');await search.press('Enter')
  await page.getByRole('combobox',{name:'Requested service',exact:true}).selectOption(fixture.service)
  await page.getByRole('combobox',{name:/^Dentist/}).selectOption(fixture.dentist)
  await page.route(api+'/api/visits/walk-in',async route=>{const r=await route.fetch();assert.equal(r.status(),201);state.walkVisit=(await r.json()).data;save();await route.abort('failed')},{times:1})
  await page.getByRole('button',{name:'Admit walk-in to queue',exact:true}).evaluate(b=>{b.click();b.click()})
  await page.getByRole('button',{name:'Retry the same arrival',exact:true}).waitFor()
  assert.equal(await search.isDisabled(),true);assert.equal(state.walkVisit.appointment,null)
  await page.reload();await page.getByRole('button',{name:'Check-In',exact:true}).first().click()
 }
 const walkRow=()=>page.locator('ul.fd-list > li').filter({hasText:state.walkPatient.code})
 await walkRow().getByRole('button',{name:'Review arrival receipt',exact:true}).click();await walkRow().getByText(/Original arrival verified:/).waitFor()
 assert.equal((await get(page,'/api/visits/'+state.walkVisit.id)).body.data.appointment,null)
 pass('existing-Patient walk-in → committed lost response → reload without retry → exact unbooked Visit/queue receipt')
 if(!state.retryWalkVisit){
  if(!state.retryWalkPatient){const r=await page.evaluate(async body=>(await import('/src/api-client.js')).registerPatient(body,'batch02-retry-patient-'+Date.now()),{first_name:'RetryWalkin'+Date.now(),last_name:'Synthetic Acceptance'});assert.equal(r.ok,true);state.retryWalkPatient=r.data;save()}
  await page.getByRole('button',{name:'Walk-in admission',exact:true}).click()
  const search=page.getByRole('combobox',{name:/^Patient/});await search.fill(state.retryWalkPatient.code)
  await page.getByRole('option').filter({hasText:state.retryWalkPatient.code}).waitFor();await search.press('ArrowDown');await search.press('Enter')
  await page.getByRole('combobox',{name:'Requested service',exact:true}).selectOption(fixture.service)
  await page.getByRole('combobox',{name:/^Dentist/}).selectOption(fixture.dentist)
  const calls=[];page.on('request',r=>{if(r.url()===api+'/api/visits/walk-in'&&r.method()==='POST')calls.push({body:r.postDataJSON(),key:r.headers()['idempotency-key']})})
  await page.route(api+'/api/visits/walk-in',async route=>{const r=await route.fetch();assert.equal(r.status(),201);state.retryWalkVisit=(await r.json()).data;save();await route.abort('failed')},{times:1})
  await page.getByRole('button',{name:'Admit walk-in to queue',exact:true}).evaluate(b=>{b.click();b.click()})
  const retry=page.getByRole('button',{name:'Retry the same arrival',exact:true});await retry.waitFor();assert.equal(await search.isDisabled(),true)
  await retry.focus();await page.keyboard.press('Enter')
  await page.locator('.notice').filter({hasText:'Arrival receipt'}).filter({hasText:state.retryWalkVisit.id}).waitFor()
  assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].body.patient_id,state.retryWalkPatient.id)
  pass('real walk-in committed response loss → keyboard retry sends identical body/key and recovers one Visit/queue')
 }
 if(!state.finalIdEvidence){
  const checked=await page.evaluate(async({id,body})=>(await import('/src/api-client.js')).verifyPatientId(id,body),{id:state.walkPatient.id,body:{id_type:'other',other_details:'Synthetic company ID'}})
  assert.equal(checked.ok,true);assert.equal(checked.data.patient_id,state.walkPatient.id)
  assert.ok(Math.abs(Date.parse(checked.data.id_verified_at)-Date.now())<15000)
  const record=await get(page,'/api/patients/'+state.walkPatient.id)
  assert.equal(Date.parse(record.body.data.id_check.at),Date.parse(checked.data.id_verified_at))
  assert.equal(record.body.data.id_check.other_details,'Synthetic company ID');state.finalIdEvidence=checked.data;save()
  pass('new ID verification retains exact Patient/type and the same actual instant after PostgreSQL reload')
 }
 if(!state.summaryIdEvidence){
  await page.getByRole('button',{name:'Patient Records',exact:true}).first().click()
  await page.getByRole('searchbox',{name:'Search patients',exact:true}).fill(state.retryWalkPatient.code)
  await page.locator('.patient-list-scroll button').filter({hasText:state.retryWalkPatient.code}).click()
  const prior=await get(page,'/api/patients/'+state.retryWalkPatient.id)
  if(!prior.body.data.id_check){
   await page.getByRole('combobox',{name:'ID shown',exact:true}).selectOption('other')
   const specify=page.getByRole('textbox',{name:/^Specify ID type/})
   assert.equal(await specify.getAttribute('required'),'');await specify.fill('   ');await specify.blur()
   assert.equal(await page.getByRole('button',{name:'ID checked',exact:true}).isDisabled(),true)
   await specify.fill('Synthetic staff ID');await page.getByRole('button',{name:'ID checked',exact:true}).click()
  }else assert.equal(prior.body.data.id_check.other_details,'Synthetic staff ID','Resume only this exact synthetic verification')
  await page.getByText(/^ID checked:/).waitFor()
  const record=await get(page,'/api/patients/'+state.retryWalkPatient.id)
  assert.equal(record.body.data.id_check.other_details,'Synthetic staff ID');state.summaryIdEvidence=true;save()
  pass('STF-04 Patient summary Other ID is required, whitespace refused, and exact Patient evidence persists')
  await page.getByRole('button',{name:'Check-In',exact:true}).first().click()
 }
 for(const width of [375,390,430,768,1024,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'overflow at '+width);await page.screenshot({path:evidence+'/arrival-recovery-'+width+'.png',fullPage:true})}
 pass('six-width actual arrival recovery renders without horizontal overflow')
 state.accepted=true;save()
}catch(e){if(page){writeFileSync(evidence+'/failure-text.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/failure.png',fullPage:true})}throw e}finally{await browser.close()}

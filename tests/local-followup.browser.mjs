// Actual React → Laravel → PostgreSQL; only the deliberately lost HTTP response is intercepted.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
const {browser,login,get,api,base,evidence,target}=await import('./local-visit-support.mjs')
const fixture=JSON.parse(readFileSync(target.runtime+'/visit-fixture.json','utf8'))
const state={groups:[]},save=()=>writeFileSync(evidence+'/journey.json',JSON.stringify(state,null,2))
const passed=name=>{state.groups.push(name);save();console.log('PASS '+name)}
let page
try{
 const dentist=await login('sprint02.dentist@example.test');page=dentist.page
 const due=await page.evaluate(()=>new Date(Date.now()+8*3600e3+2*86400e3).toISOString().slice(0,10))
 const create=async reason=>{
  const r=await dentist.page.evaluate(async body=>(await import('/src/api-client.js')).createFollowup(body),{patient_id:fixture.patientId,branch_ref:fixture.branch,service_ref:fixture.service,due_on:due,reason})
  assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.data.dentist.id,fixture.dentist);return r.data
 }
 state.older=await create('Synthetic AUD10 older unselected task '+Date.now())
 state.chosen=await create('Synthetic AUD10 selected review '+Date.now())
 passed('authorized Dentist creation preserves exact task, Patient, branch, service and Dentist')
 const staff=await login('sprint02.staff@example.test');page=staff.page
 await page.getByRole('button',{name:'Follow-Up Tasks',exact:true}).first().click()
 const row=reason=>page.locator('ul.fd-list > li').filter({hasText:reason})
 await row(state.chosen.reason).getByRole('button',{name:'Contacted',exact:true}).click()
 await row(state.chosen.reason).getByText('Contacted',{exact:true}).waitFor()
 state.contacted=(await get(page,'/api/followups/'+state.chosen.id)).body.data
 assert.equal(state.contacted.revision,state.chosen.revision+1)
 passed('Staff Contacted action persists observed revision; task remains distinct from booking')
 const openBooking=async reason=>{
  await row(reason).getByRole('button',{name:'Book follow-up',exact:true}).click()
  const modal=page.getByRole('dialog')
  await modal.getByRole('combobox',{name:/^Dentist/}).waitFor()
  assert.equal(await modal.getByRole('combobox',{name:/^Dentist/}).inputValue(),fixture.dentist)
  assert.equal(await modal.getByRole('combobox',{name:/^Dentist/}).isDisabled(),true)
  await modal.getByRole('group',{name:'Available start times'}).getByRole('button').first().click()
  return modal
 }
 let modal=await openBooking(state.chosen.reason),commands=[],committed
 for(const width of [375,390,430,768,1024,1440]){
  await page.setViewportSize({width,height:1000})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  assert.equal(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true)
  await page.screenshot({path:evidence+'/selected-booking-'+width+'.png',fullPage:true})
 }
 passed('real shared booking form retains requesting Dentist and exact task at six widths')
 page.on('request',r=>{if(r.url()===api+'/api/appointments'&&r.method()==='POST')commands.push({key:r.headers()['idempotency-key'],body:r.postDataJSON()})})
 await page.route(api+'/api/appointments',async route=>{const r=await route.fetch();assert.equal(r.status(),201);committed=await r.json();await route.abort('failed')},{times:1})
 await modal.getByRole('button',{name:'Book the follow-up',exact:true}).evaluate(b=>{b.click();b.click()})
 const retry=modal.getByRole('button',{name:'Retry the same booking',exact:true});await retry.waitFor()
 assert.equal(await modal.getByRole('textbox',{name:'Notes',exact:true}).isDisabled(),true)
 await retry.focus();await page.keyboard.press('Enter');await modal.waitFor({state:'hidden'})
 assert.equal(commands.length,2);assert.deepEqual(commands[0],commands[1]);assert.equal(commands[0].body.followup_task_id,state.chosen.id);assert.equal(commands[0].body.followup_expected_revision,state.contacted.revision)
 state.appointment=committed.data
 await page.getByRole('status').filter({hasText:'Booking receipt'}).getByText(new RegExp('Appointment created: '+state.appointment.code)).waitFor()
 passed('verified appointment reference visible immediately after save with zero further actions')
 const selected=(await get(page,'/api/followups/'+state.chosen.id)).body.data
 assert.equal(selected.appointment.id,state.appointment.id);assert.equal(selected.status,'Booked')
 assert.equal((await get(page,'/api/followups/'+state.older.id)).body.data.status,'Open')
 passed('real committed lost response → keyboard same-key retry → exact selected task; older task untouched')
 await page.reload();await page.getByRole('button',{name:'Follow-Up Tasks',exact:true}).first().click()
 await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('Booked')
 await row(state.chosen.reason).getByRole('button',{name:'Review current task',exact:true}).click()
 await row(state.chosen.reason).getByText(/Original booking confirmed:/).waitFor()
 assert.ok((await row(state.chosen.reason).innerText()).includes(state.appointment.code))
 passed('reload recovers original journal receipt without browser-stored keys or a replacement booking')
 // A new authenticated browser session for the same Staff account recovers the same immutable receipt.
 const newStaff=await login('sprint02.staff@example.test');page=newStaff.page
 await page.getByRole('button',{name:'Follow-Up Tasks',exact:true}).first().click();await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('Booked')
 await row(state.chosen.reason).getByRole('button',{name:'Review current task',exact:true}).click();await row(state.chosen.reason).getByText(/Original booking confirmed:/).waitFor()
 for(const width of [375,390,430,768,1024,1440]){
  await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  await page.screenshot({path:evidence+'/staff-recovered-'+width+'.png',fullPage:true})
 }
 passed('new authenticated Staff session recovers same receipt; six-width rendered recovery has no page overflow')
 state.reloadOnlyTask=await create('Synthetic AUD10 lost-response reload '+Date.now())
 await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('active')
 modal=await openBooking(state.reloadOnlyTask.reason)
 let reloadCommitted, reloadCreates=0
 page.on('request',r=>{if(r.url()===api+'/api/appointments'&&r.method()==='POST')reloadCreates++})
 await page.route(api+'/api/appointments',async route=>{const r=await route.fetch();assert.equal(r.status(),201);reloadCommitted=await r.json();await route.abort('failed')},{times:1})
 await modal.getByRole('button',{name:'Book the follow-up',exact:true}).click()
 await modal.getByRole('button',{name:'Retry the same booking',exact:true}).waitFor()
 // Lose the in-memory command without retrying: only durable server evidence may resolve this outcome.
 await page.reload();await page.getByRole('button',{name:'Follow-Up Tasks',exact:true}).first().click()
 await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('Booked')
 await row(state.reloadOnlyTask.reason).getByRole('button',{name:'Review current task',exact:true}).click()
 await row(state.reloadOnlyTask.reason).getByText(/Original booking confirmed:/).waitFor()
 assert.ok((await row(state.reloadOnlyTask.reason).innerText()).includes(reloadCommitted.data.code))
 assert.equal((await get(page,'/api/followups/'+state.reloadOnlyTask.id)).body.data.appointment.id,reloadCommitted.data.id)
 assert.equal(reloadCreates,1);state.reloadOnlyAppointment=reloadCommitted.data
 passed('committed lost response → reload without retry → original receipt recovered with exactly one create')
 const refreshed=(await get(dentist.page,'/api/followups/'+state.chosen.id)).body.data
 assert.equal(refreshed.appointment.id,state.appointment.id);assert.equal(refreshed.status,'Booked');assert.notEqual(refreshed.status,'Closed')
 passed('Dentist readback shows exact booked appointment without automatic clinical completion')
 await dentist.context.close();await staff.context.close();await newStaff.context.close()
 const patient=await login('sprint02.patient@example.test',390);page=patient.page;page.setDefaultTimeout(60000)
 await page.getByRole('button',{name:'Visits',exact:true}).first().click();await page.getByText(state.appointment.code,{exact:false}).first().waitFor()
 await page.reload();await page.getByText(state.appointment.code,{exact:false}).first().waitFor()
 assert.equal((await get(page,'/api/appointments/'+state.appointment.id)).body.data.patient.id,fixture.patientId)
 assert.equal((await get(page,'/api/followups/'+state.chosen.id)).status,403)
 await page.screenshot({path:evidence+'/patient-appointment-390.png',fullPage:true})
 passed('Patient own appointment visible after reload; clinical task endpoint denied')
 const other=await login('patient@example.test',390)
 assert.equal((await get(other.page,'/api/appointments/'+state.appointment.id)).status,403)
 passed('separate Patient cannot read the resulting appointment')
 state.accepted=true;save()
}catch(e){if(page){writeFileSync(evidence+'/failure-text.txt',(await page.locator('body').innerText()));await page.screenshot({path:evidence+'/failure.png',fullPage:true})}throw e}finally{await browser.close()}

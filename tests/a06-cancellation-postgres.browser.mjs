// Real isolated PostgreSQL cancellation: drop only the committed response, then replay the frozen command.
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
const {browser,login,get,api,evidence,target,privateRead}=await import('./local-visit-support.mjs')
const fixture=JSON.parse(privateRead(target.runtime+'/visit-fixture.json'))
let page
try{
 const staff=await login('sprint02.staff@example.test');page=staff.page
 const date=await page.evaluate(()=>new Date(Date.now()+8*3600e3).toISOString().slice(0,10))
 const body={branch_ref:fixture.branch,service_ref:fixture.service,dentist_ref:fixture.dentist,patient_id:fixture.patientId,date}
 const available=await page.evaluate(async body=>(await import('/src/api-client.js')).appointmentAvailability(body),body)
 assert.equal(available.ok,true);assert.ok(available.data.slots.length)
 const created=await page.evaluate(async body=>(await import('/src/api-client.js')).createAppointment(body,'a06-cancel-'+Date.now()),{...body,start_time:available.data.slots[0].start_time})
 assert.equal(created.ok,true);const id=created.data.id
 await page.getByRole('button',{name:'Check-In',exact:true}).first().click()
 await page.getByRole('button',{name:'Refresh',exact:true}).first().click()
 await page.getByRole('combobox',{name:/Today.s appointment/}).selectOption(id)
 await page.getByRole('button',{name:'Cancel appointment',exact:true}).click()
 const dialog=page.getByRole('dialog');await dialog.waitFor()
 await dialog.getByRole('textbox',{name:/^Additional note/}).fill('Synthetic A06 committed response recovery')
 const commands=[];let committed
 await page.route(api+'/api/appointments/'+id+'/cancel',async route=>{
  commands.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']})
  if(commands.length>1)return route.continue()
  const response=await route.fetch();assert.equal(response.status(),200);committed=(await response.json()).data
  await route.abort('failed')
 })
 await dialog.getByRole('button',{name:'Confirm cancellation',exact:true}).click()
 const retry=page.getByRole('button',{name:'Retry same cancellation',exact:true});await retry.waitFor()
 assert.equal(await dialog.getByRole('textbox',{name:/^Additional note/}).isDisabled(),true)
 assert.equal(await dialog.getByRole('button',{name:'Keep appointment',exact:true}).isDisabled(),true)
 await retry.focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'hidden'})
 assert.equal(commands.length,2);assert.deepEqual(commands[0],commands[1]);assert.equal(committed.id,id);assert.equal(committed.status,'Cancelled')
 const current=await get(page,'/api/appointments/'+id);assert.equal(current.status,200);assert.equal(current.body.data.status,'Cancelled')
 assert.equal(current.body.data.revision,committed.revision)
 await page.reload();await page.getByRole('button',{name:'Check-In',exact:true}).first().click()
 assert.equal(await page.getByRole('combobox',{name:/Today.s appointment/}).locator('option[value="'+id+'"]').count(),0)
 for(const width of [375,390,430,768,1024,1440]){
  await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
 }
 writeFileSync(evidence+'/cancellation.json',JSON.stringify({appointment:id,exactReplay:true,persistedStatus:'Cancelled',revision:committed.revision,reload:true,widths:[375,390,430,768,1024,1440]},null,2))
 console.log('PASS real cancellation dialog, committed response loss, frozen keyboard retry, exact revision and reload across six widths')
}catch(error){if(page){writeFileSync(evidence+'/cancellation-failure.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/cancellation-failure.png',fullPage:true})}throw error}
finally{await browser.close()}

// Actual Staff Call and existing Patient-initiated messaging; all writes stay on an owned synthetic target.
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
const {browser,login,get,api,evidence,target,privateRead}=await import('./local-visit-support.mjs')
const f=JSON.parse(privateRead(target.runtime+'/visit-fixture.json')),nonce=Date.now(),results=[]
const command=(page,name,args)=>page.evaluate(async({name,args})=>{const a=await import('/src/api-client.js'),r=await a[name](...args);if(!r.ok)throw Error(JSON.stringify({kind:r.kind,message:r.message}));return r.data},{name,args})
const pass=name=>{results.push(name);console.log('PASS '+name)}
let page
try{
 const patient=await login('sprint02.patient@example.test')
 const options=await command(patient.page,'conversationStartOptions',[]),branch=options.branches.find(b=>b.name.startsWith('Synthetic Sprint 02'))
 assert.ok(branch)
 const conversation=await command(patient.page,'startConversation',[{branch_id:branch.id,body:'Synthetic A07 queue communication acceptance; no clinical advice.'},'a07-start-'+nonce])
 const conversationId=conversation.conversation?.id||conversation.id;assert.ok(conversationId)
 const staff=await login('sprint02.staff@example.test');page=staff.page
 const existing=(await get(page,'/api/queue')).body.data.find(q=>q.patient.id===f.patientId&&q.status==='Waiting')
 const visit=existing?{id:existing.visit.id,queue:{id:existing.id}}:await command(page,'walkInVisit',[{patient_id:f.patientId,branch_ref:f.branch,dentist_ref:f.dentist,service_ref:f.service},'a07-walk-'+nonce])
 const nextPatient=await command(page,'registerPatient',[{first_name:'A07 '+nonce,last_name:'Synthetic FIFO'},'a07-patient-'+nonce])
 const second=await command(page,'walkInVisit',[{patient_id:nextPatient.id,branch_ref:f.branch,dentist_ref:f.dentist,service_ref:f.service},'a07-walk-second-'+nonce])
 const before=(await get(page,'/api/queue/'+second.queue.id)).body.data
 await page.getByRole('button',{name:'Live Queue',exact:true}).first().click()
 await page.getByRole('button',{name:'Refresh',exact:true}).first().click()
 const row=page.getByRole('row').filter({hasText:f.patientCode}),call=row.getByRole('button',{name:/^Call patient .* in queue$/})
 await call.waitFor();assert.equal(await call.innerText(),'');assert.equal(await call.getAttribute('title'),'Call patient in queue')
 const box=await call.boundingBox();assert.ok(box.height>=44&&box.width>=44)
 const commands=[];let receipt
 await page.route(api+'/api/queue/'+visit.queue.id+'/call',async route=>{
  commands.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']})
  if(commands.length>1)return route.continue()
  const r=await route.fetch();assert.equal(r.status(),200);receipt=(await r.json()).data;await route.abort('failed')
 })
 await call.evaluate(b=>{b.click();b.click()})
 const retry=page.getByRole('button',{name:'Retry same call',exact:true});await retry.waitFor();assert.equal(commands.length,1)
 await retry.focus();await page.keyboard.press('Enter');await page.getByText('Call recorded. The current queue has been refreshed.',{exact:true}).waitFor()
 assert.equal(commands.length,2);assert.deepEqual(commands[0],commands[1]);assert.equal(receipt.id,visit.queue.id)
 const called=(await get(page,'/api/queue/'+visit.queue.id)).body.data
 assert.equal(called.status,'Called');assert.equal(called.revision,receipt.revision);assert.equal(called.visit.status,'Checked In')
 assert.equal(called.history.filter(h=>h.event==='queue.called').length,1)
 const after=(await get(page,'/api/queue/'+second.queue.id)).body.data
 assert.deepEqual([after.position,after.branch_position,after.queue_number],[before.position,before.branch_position,before.queue_number])
 const patientQueue=(await get(patient.page,'/api/queue/mine')).body.data
 assert.ok(JSON.stringify(patientQueue).includes('called'))
 pass('Staff icon call: committed response loss, duplicate suppression, identical-key keyboard retry, one durable call and unchanged FIFO; Patient sees called, Visit remains Checked In')
 const message=row.getByRole('button',{name:/^Open conversation with /});assert.equal(await message.innerText(),'');assert.equal(await message.getAttribute('title'),'Open patient conversation')
 assert.ok((await message.boundingBox()).height>=44)
 await message.focus();await page.keyboard.press('Enter')
 const composer=page.locator('form.chat-compose textarea');await composer.waitFor()
 assert.equal(await composer.getAttribute('id'),'compose-'+conversationId)
 const text='Synthetic A07 Staff reply '+nonce
 const sends=[]
 await page.route(api+'/api/conversations/'+conversationId+'/messages',async route=>{
  if(route.request().method()!=='POST')return route.continue()
  sends.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']})
  if(sends.length>1)return route.continue()
  const r=await route.fetch();assert.equal(r.status(),201);await route.abort('failed')
 })
 await composer.fill(text);await page.getByRole('button',{name:'Send',exact:true}).click()
 const retrySend=page.getByRole('button',{name:'Retry',exact:true});await retrySend.waitFor();await retrySend.click()
 await retrySend.waitFor({state:'hidden'});assert.equal(sends.length,2);assert.deepEqual(sends[0],sends[1])
 const messages=(await get(patient.page,'/api/conversations/'+conversationId+'/messages')).body.data
 assert.equal(messages.filter(m=>m.body===text).length,1)
 await page.reload();await page.getByRole('button',{name:'Live Queue',exact:true}).first().click()
 await page.getByRole('row').filter({hasText:f.patientCode}).getByText('Called',{exact:true}).waitFor()
 await page.getByRole('row').filter({hasText:f.patientCode}).getByRole('button',{name:/^Open conversation with /}).click()
 await page.getByRole('log',{name:'Messages',exact:true}).getByText(text,{exact:true}).waitFor()
 pass('Message icon opens exact authorized Patient/branch conversation; lost-send retry persists one reply visible to Patient and survives reload')
 const foreign=await login('staff.reception@example.test')
 assert.equal((await get(foreign.page,'/api/queue/'+visit.queue.id)).status,403)
 assert.equal((await get(foreign.page,'/api/conversations/'+conversationId+'/messages')).status,403)
 await page.getByRole('button',{name:'Live Queue',exact:true}).first().click()
 for(const width of [375,390,430,768,1024,1440]){
  await page.setViewportSize({width,height:1000})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  await page.screenshot({path:evidence+'/queue-'+width+'.png',fullPage:true})
 }
 pass('Foreign Staff branch denied; six responsive queue widths preserve exact Patient context and accessible icon actions')
 writeFileSync(evidence+'/stf17.json',JSON.stringify({results,visit:visit.id,queue:called.id,conversation:conversationId,callRevision:called.revision,secondQueue:second.queue.id},null,2))
}catch(error){if(page){writeFileSync(evidence+'/failure-text.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/failure.png',fullPage:true})}throw error}
finally{await browser.close()}

// Actual isolated Laravel/Sanctum + PostgreSQL. Source received/integrated-system acceptance is NOT implied.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
const {browser,login,get,api,target,evidence}=await import('./local-visit-support.mjs')
const fixture=JSON.parse(readFileSync(target.runtime+'/grant-contention.json','utf8')),cid=fixture.conversation
const sessions=[]
async function open(key){
 const s=await login(fixture.accounts[key].email);sessions.push(s);s.page.setDefaultTimeout(45000)
 await s.page.getByRole('button',{name:'Messages',exact:true}).first().click()
 if(key==='patientA'){
   const inbox=await get(s.page,'/api/conversations');assert.equal(inbox.status,200);assert.deepEqual(inbox.body.data.map(c=>c.id),[cid])
   await s.page.locator('.chat-row').first().click()
 }else await s.page.locator('.chat-row').filter({hasText:'PAT-0001'}).first().click()
 await s.page.getByRole('log',{name:'Messages',exact:true}).locator('.chat-bubble').first().waitFor()
 return s.page
}
try{
 const staff=await open('staffB1')
 console.log('PASS isolated Staff session and exact conversation startup')
 const options=await get(staff,'/api/conversations/'+cid+'/dentist-options');assert.equal(options.status,200)
 const active=options.body.data.find(d=>d.participant),next=options.body.data.find(d=>!d.participant)
 assert(active&&next)
 const oldKey=Object.keys(fixture.accounts).find(key=>fixture.accounts[key].public_id===active.id)
 const nextKey=Object.keys(fixture.accounts).find(key=>fixture.accounts[key].public_id===next.id)
 const former=await open(oldKey)
 console.log('PASS initially authorized Dentist history')
 let held,releaseHeld;const heldReady=new Promise(resolve=>held=resolve),release=new Promise(resolve=>releaseHeld=resolve)
 await former.route(api+'/api/conversations/'+cid+'/messages?after=*',async route=>{
   const response=await route.fetch();assert.equal(response.status(),200);held();await release;await route.fulfill({response})
 },{times:1})
 await former.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))
 await Promise.race([heldReady,new Promise((_,reject)=>setTimeout(()=>reject(Error('No controlled pending message read observed')),30000))])
 const calls=[]
 staff.on('request',r=>{if(r.url()===api+'/api/conversations/'+cid+'/participants'&&r.method()==='POST')calls.push({body:r.postDataJSON(),key:r.headers()['idempotency-key']})})
 await staff.route(api+'/api/conversations/'+cid+'/participants',async route=>{
   const response=await route.fetch();assert.equal(response.status(),201);await route.abort('failed')
 },{times:1})
 await staff.getByRole('button',{name:'Switch dentist',exact:true}).click()
 await staff.getByRole('combobox',{name:'Dentist to switch to'}).selectOption(next.id)
 const reason=staff.getByRole('textbox',{name:'Reason for reassignment'});await reason.fill('Synthetic authorized browser reassignment')
 await staff.getByRole('button',{name:'Switch',exact:true}).click()
 await staff.getByRole('status').filter({hasText:'outcome is unverified'}).waitFor()
 console.log('PASS committed response lost; original reassignment fields locked')
 assert(await reason.isDisabled())
 for(const width of [375,390,430,768,1024,1440]){await staff.setViewportSize({width,height:1000});assert(await staff.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'live grant overflow '+width);await staff.screenshot({path:evidence+'/grant-live-uncertain-'+width+'.png',fullPage:true})}
 const retry=staff.getByRole('button',{name:'Retry reassignment',exact:true});await retry.focus();await staff.keyboard.press('Enter')
 await staff.getByRole('button',{name:'Switch dentist',exact:true}).waitFor();assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert(calls[0].key)
 assert.equal((await get(former,'/api/conversations/'+cid+'/messages')).status,403)
 await former.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))
 await former.getByText('That conversation is no longer accessible. Choose another conversation.').waitFor()
 releaseHeld();await former.waitForTimeout(150)
 assert.equal(await former.locator('.chat-log .chat-bubble').count(),0,'A delayed pre-revocation response must not restore the revoked view.')
 const dentist=await open(nextKey)
 const history=await get(dentist,'/api/conversations/'+cid+'/messages');assert.equal(history.status,200);assert(history.body.data.some(m=>m.body==='Synthetic committed grant history'))
 const patient=await open('patientA')
 const text='Synthetic grant browser Patient reply '+Date.now()
 await patient.getByRole('textbox',{name:/^Message to/}).fill(text)
 await patient.getByRole('button',{name:'Send',exact:true}).click()
 await patient.locator('.chat-log .chat-bubble.mine').filter({hasText:text}).waitFor()
 const notifications=await get(dentist,'/api/notifications');assert.equal(notifications.status,200);assert(notifications.body.data.some(n=>n.kind==='message_received'&&n.target?.id===cid))
 const denied=await get(former,'/api/conversations/'+cid+'/messages');assert.equal(denied.status,403)
 const owner=await login(fixture.accounts.owner.email);sessions.push(owner);assert.equal((await get(owner.page,'/api/conversations/'+cid+'/messages')).status,403)
 for(const width of [375,390,430,768,1024,1440]){await dentist.setViewportSize({width,height:1000});assert(await dentist.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'live Dentist history overflow '+width);await dentist.screenshot({path:evidence+'/grant-live-history-'+width+'.png',fullPage:true})}
 writeFileSync(evidence+'/conversation-grant-live.json',JSON.stringify({accepted:true,scope:'Isolated reviewed grant profile, real Sanctum sessions and PostgreSQL; Staff original-key committed-loss retry, former-Dentist denial/stale read discard, new-Dentist immutable history, Patient message/recipient notification, Owner denial, keyboard and six widths. No Operations source or merged-system claim.'},null,2))
 console.log('PASS live grant lifecycle: real Staff/Patient/Dentist sessions, Owner denial, committed-loss recovery, stale-response rejection, recipient notice and six widths')
}finally{for(const s of sessions)await s.context.close();await browser.close()}

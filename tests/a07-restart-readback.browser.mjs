import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
const {browser,login,get,target,privateRead}=await import('./local-visit-support.mjs')
const root=process.env.A07_EVIDENCE_ROOT;assert.ok(root)
const read=path=>JSON.parse(readFileSync(resolve(root,path),'utf8'))
const actions=read('stf17/stf17.json'),care=read('clinical-browser/journey.json'),rx=read('prescriptions/search-acceptance.json')
const fixture=JSON.parse(privateRead(target.runtime+'/operations-browser-fixture.json'))
try{
 const staff=await login('sprint02.staff@example.test')
 const queue=(await get(staff.page,'/api/queue/'+actions.queue)).body.data
 assert.equal(queue.status,'Called');assert.equal(queue.revision,actions.callRevision);assert.equal(queue.visit.id,actions.visit)
 assert.equal(queue.history.filter(h=>h.event==='queue.called').length,1);assert.equal(queue.visit.status,'Checked In')
 assert.equal((await get(staff.page,'/api/treatments/'+care.treatment.id)).body.data.status,'Completed')
 await staff.page.getByRole('button',{name:'Live Queue',exact:true}).first().click()
 await staff.page.locator('.queue-live-card').waitFor()
 await staff.page.getByRole('row').filter({hasText:queue.patient.code}).locator('[data-column="careTeam"]').getByText(queue.dentist.name,{exact:true}).waitFor()
 for(const width of [375,390,430,768,1024,1440]){
  await staff.page.setViewportSize({width,height:1000})
  assert.equal(await staff.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  await staff.page.screenshot({path:resolve(root,'stf17/queue-final-'+width+'.png'),fullPage:true})
 }
 await staff.context.close()
 const patient=await login('sprint02.patient@example.test')
 const prescriptions=(await get(patient.page,'/api/me/prescriptions')).body.data
 assert.ok(prescriptions.some(p=>p.id===rx.issued.id&&p.status==='Issued'))
 const messages=(await get(patient.page,'/api/conversations/'+actions.conversation+'/messages')).body.data
 assert.equal(messages.filter(m=>m.body.startsWith('Synthetic A07 Staff reply ')).length,1)
 assert.equal((await get(patient.page,'/api/queue/mine')).body.data.phase,'called')
 await patient.context.close()
 for(const [role,email] of [['patient','patient@example.test'],['staff','staff.reception@example.test'],['dentist','dentist@example.test'],['owner','owner@example.test']]){
  const account=await login(email),notices=await get(account.page,'/api/notifications?collection=archived')
  assert.equal(notices.status,200);assert.ok(notices.body.data.find(n=>n.id===fixture.notification_ids[role])?.archived)
  if(role==='staff'){
   const own=(await get(account.page,'/api/work-schedules')).body.data.staff.find(s=>s.can_request_roster)
   assert.equal((await get(account.page,`/api/staff/${own.id}/duty?branch_ref=${own.branch.id}&date=2026-11-23`)).body.data.available,true)
  }
  if(role==='owner'){
   assert.equal((await get(account.page,'/api/audit-logs?per_page=1')).status,200)
   assert.equal((await get(account.page,'/api/analytics/executive-summary?date_from=2026-11-17&date_to=2026-11-17')).status,200)
  }
  await account.context.close()
 }
 console.log('PASS full isolated runtime restart: exact Call/history, Patient called status, one reply, completed encounter, issued prescription and all four archived notifications persist')
}finally{await browser.close()}

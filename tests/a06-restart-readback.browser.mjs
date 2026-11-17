// Run after an explicit owned-runtime stop/start, with the same retained isolated database.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const {browser,login,get,evidence,target,privateRead}=await import('./local-visit-support.mjs')
const journey=JSON.parse(readFileSync(evidence+'/journey.json','utf8'))
const cancellation=JSON.parse(readFileSync(evidence+'/cancellation.json','utf8'))
const notices=JSON.parse(privateRead(target.runtime+'/operations-browser-fixture.json'))
try{
 const staff=await login('sprint02.staff@example.test')
 for(const visit of [journey.visit,journey.walkVisit,journey.retryWalkVisit]){
  const record=await get(staff.page,'/api/visits/'+visit.id)
  assert.equal(record.status,200);assert.equal(record.body.data.id,visit.id)
  assert.equal(record.body.data.status,'Checked In');assert.equal(record.body.data.queue.id,visit.queue.id)
  assert.equal(record.body.data.queue.status,'Waiting')
 }
 const cancelled=await get(staff.page,'/api/appointments/'+cancellation.appointment)
 assert.equal(cancelled.body.data.status,'Cancelled');assert.equal(cancelled.body.data.revision,cancellation.revision)
 await staff.context.close()
 for(const [role,email] of [['patient','patient@example.test'],['staff','staff.reception@example.test'],['dentist','dentist@example.test'],['owner','owner@example.test']]){
  const account=await login(email)
  const result=await get(account.page,'/api/notifications?collection=archived')
  assert.equal(result.status,200)
  const exact=result.body.data.find(row=>row.id===notices.notification_ids[role])
  assert.ok(exact?.archived,role+' exact archive must survive runtime restart')
  await account.context.close()
 }
 console.log('PASS complete isolated runtime restart: three exact Visit/Waiting queue receipts, cancellation revision and four-role archived notifications persist')
}finally{await browser.close()}

import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const {browser,login,get,evidence}=await import('./local-visit-support.mjs')
const actions=JSON.parse(readFileSync(evidence+'/stf17.json','utf8'))
try{
 const first=await login('sprint02.staff@example.test'),second=await login('sprint02.staff@example.test')
 const entry=(await get(first.page,'/api/queue/'+actions.secondQueue)).body.data
 assert.equal(entry.status,'Waiting')
 const send=(page,key)=>page.evaluate(async({id,revision,key})=>(await import('/src/api-client.js')).queueCommand(id,'call',{expected_revision:revision},key),{id:entry.id,revision:entry.revision,key})
 const results=await Promise.all([send(first.page,'a07-concurrent-first-'+entry.id),send(second.page,'a07-concurrent-second-'+entry.id)])
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>r.kind==='conflict').length,1)
 const current=(await get(first.page,'/api/queue/'+entry.id)).body.data
 assert.equal(current.revision,entry.revision+1);assert.equal(current.status,'Called');assert.equal(current.visit.status,'Checked In')
 assert.equal(current.history.filter(h=>h.event==='queue.called').length,1)
 assert.deepEqual([current.position,current.branch_position,current.queue_number],[entry.position,entry.branch_position,entry.queue_number])
 console.log('PASS two fresh Staff sessions submit concurrent same-revision Calls: one commit, one stale conflict, one history event and unchanged FIFO/Visit')
}finally{await browser.close()}

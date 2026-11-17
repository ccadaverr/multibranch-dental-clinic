import test from 'node:test'
import assert from 'node:assert/strict'
import {discoveryRange,shiftDiscoveryRange,readHistoryPage,readHistoryDetail} from '../src/history-read.js'
const row={id:'t1',patient:{id:'p1'},status:'Completed',visit:{id:'v1',status:'Completed'},branch:{id:'b1'},dentist:{id:'d1'},revision:3,completed_at:'2025-01-01T10:00:00+08:00',procedures:[],clinical_notes:'Synthetic old care'}
test('discovery validates actual calendar dates, future bounds and the existing 184-day API contract',()=>{
 assert.equal(discoveryRange('2025-01-01','2025-07-03','2026-11-17').ok,true)
 for(const [from,to] of [['2025-01-01','2025-07-04'],['2026-02-30','2026-03-02'],['','2026-11-17'],['2026-11-18','2026-11-17'],['2026-11-17','2026-11-18']])assert.equal(discoveryRange(from,to,'2026-11-17').ok,false)
 const original={from:'2025-01-01',to:'2025-01-31'},older=shiftDiscoveryRange(original,-1,'2026-11-17');assert.deepEqual(older,{from:'2024-12-01',to:'2024-12-31'});assert.deepEqual(shiftDiscoveryRange(older,1,'2026-11-17'),original)
})
test('history page 11 beyond 200 records confirms exact page and never adopts a duplicate, wrong-Patient or incomplete page',async()=>{
 const response={ok:true,data:[row],meta:{current_page:11,last_page:11,total:201,per_page:20}},calls=[]
 const read=async p=>{calls.push(p);return response};assert.equal((await readHistoryPage(read,{patientId:'p1',page:11},()=>true)).ok,true);assert.deepEqual(calls[0],{patient_id:'p1',status:'Completed',per_page:20,page:11})
 for(const patch of [{meta:{...response.meta,current_page:1}},{meta:{...response.meta,total:221}},{data:[]},{data:[{...row,patient:{id:'foreign'}}]},{data:[row,row]}])assert.equal((await readHistoryPage(async()=>({...response,...patch}),{patientId:'p1',page:11},()=>true)).ok,false)
})
test('selected encounter read rejects another Visit, branch or revision for the same Patient and encounter id',async()=>{
 const expected={id:'t1',visitId:'v1',branchId:'b1',revision:3}
 assert.equal((await readHistoryDetail(async()=>({ok:true,data:row}),'p1',expected,()=>true)).ok,true)
 for(const patch of [{visit:{id:'v2',status:'Completed'}},{branch:{id:'b2'}},{revision:4},{id:'t2'},{patient:{id:'p2'}},{status:'In Treatment'}])assert.equal((await readHistoryDetail(async()=>({ok:true,data:{...row,...patch}}),'p1',expected,()=>true)).ok,false)
})
test('history errors and late results never substitute a record or dispatch an obsolete request',async()=>{
 let active=true,release,calls=0
 const read=()=>{calls++;return new Promise(r=>release=r)},pending=readHistoryDetail(read,'p1',{id:'t1'},()=>active)
 await Promise.resolve();active=false;release({ok:true,data:row});assert.equal((await pending).kind,'stale_context')
 assert.equal((await readHistoryDetail(read,'p1',{id:'t1'},()=>false)).kind,'stale_context');assert.equal(calls,1)
 assert.equal((await readHistoryPage(()=>{throw Error('offline')},{patientId:'p1',page:1},()=>true)).ok,false)
 assert.equal((await readHistoryDetail(()=>new Promise(()=>{}),'p1',{id:'t1'},()=>true,5)).ok,false)
})

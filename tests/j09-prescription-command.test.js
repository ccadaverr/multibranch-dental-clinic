import test from 'node:test'
import assert from 'node:assert/strict'
import {runPrescriptionWrite} from '../src/prescription-command.js'
import {createPrescriptionCatalog} from '../src/prescription-catalog.js'

const draft=()=>({id:'rx',status:'Draft',revision:4,can_edit:true,number:null,visit:'v1',patient:{id:'p1'},branch:'Synthetic branch',lines:[{medicine:'Synthetic medicine',dosage:'Synthetic dose'}],note:'Synthetic note'})
const request=()=>({base:draft(),visitId:'v1',patientId:'p1',branch:'Synthetic branch',body:{lines:draft().lines,note:'Synthetic note'},issue:true,saveKey:'save',issueKey:'issue'})
const issued=(revision=5)=>({...draft(),revision,status:'Issued',can_edit:false,can_void:true,issued_at:'2026-11-18T08:00:00+08:00',number:'RX-2026-000001'})
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}

test('unchanged restored Draft issues its freshly verified revision without Update',async()=>{
 const calls=[];let done=false
 const api={read:async id=>{calls.push(['read',id]);return {ok:true,data:done?issued():draft()}},update:async()=>{calls.push(['update']);return {ok:false}},issue:async(id,revision,key)=>{calls.push(['issue',id,revision,key]);done=true;return {ok:true,data:issued()}}}
 assert.equal((await runPrescriptionWrite(request(),api,()=>true)).ok,true)
 assert.deepEqual(calls,[['read','rx'],['issue','rx',4,'issue'],['read','rx']])
})
test('dirty Draft updates once with CAS before issuing, with exact final content',async()=>{
 const r=request();r.body.note='Synthetic changed note';let saved,done=false;const calls=[]
 const api={update:async(id,body,key)=>{calls.push(['update',id,body.expected_revision,key]);saved={...draft(),note:body.note,revision:5};return {ok:true,data:saved}},issue:async(id,revision,key)=>{calls.push(['issue',id,revision,key]);done=true;return {ok:true,data:{...issued(6),note:saved.note}}},read:async()=>({ok:true,data:{...issued(6),note:saved.note}})}
 assert.equal((await runPrescriptionWrite(r,api,()=>true)).ok,true);assert.equal(done,true)
 assert.deepEqual(calls,[['update','rx',4,'save'],['issue','rx',5,'issue']])
})
test('unchanged Issue rejects changed revision, content, identity, status or edit authority',async()=>{
 for(const patch of [{revision:5},{id:'other'},{visit:'other'},{patient:{id:'other'}},{branch:'other'},{status:'Issued'},{can_edit:false},{note:'different'},{lines:[{medicine:'different'}]}]){
  let issues=0,updates=0
  const r=await runPrescriptionWrite(request(),{read:async()=>({ok:true,data:{...draft(),...patch}}),issue:async()=>{issues++},update:async()=>{updates++;return {ok:false}}},()=>true)
  assert.equal(r.ok,false);assert.equal(issues,0);assert.equal(updates,0)
 }
})
test('unchanged Issue retains same ID/revision/key after a lost response and rejects auth change',async()=>{
 const r=request(),calls=[];let done=false
 const api={read:async()=>({ok:true,data:done?issued():draft()}),issue:async(...args)=>{calls.push(args.slice(0,3));if(!done){done=true;return {ok:false,kind:'network'}}return {ok:true,data:issued()}}}
 assert.equal((await runPrescriptionWrite(r,api,()=>true)).retryable,true)
 assert.equal((await runPrescriptionWrite(r,api,()=>true)).ok,true);assert.deepEqual(calls,[['rx',4,'issue'],['rx',4,'issue']])
 let current=true,issues=0
 const denied=await runPrescriptionWrite(request(),{read:async()=>{current=false;return {ok:true,data:draft()}},issue:async()=>{issues++}},()=>current)
 assert.equal(denied.kind,'auth_changed');assert.equal(issues,0)
})
test('failed unchanged-Draft preflight is recoverable without any write',async()=>{
 const r=request();let first=true,writes=0,done=false
 const api={read:async()=>{if(first){first=false;return {ok:false,kind:'network'}}return {ok:true,data:done?issued():draft()}},issue:async()=>{writes++;done=true;return {ok:true,data:issued()}}}
 assert.equal((await runPrescriptionWrite(r,api,()=>true)).retryable,true);assert.equal(writes,0)
 assert.equal((await runPrescriptionWrite(r,api,()=>true)).ok,true);assert.equal(writes,1)
})
test('catalog coalesces consumers and caches only within its live scope; explicit invalidation reloads',async()=>{
 let calls=0,current=true;const held=deferred(),catalog=createPrescriptionCatalog(()=>{calls++;return held.promise},()=>current)
 const one=catalog.read(),two=catalog.read();assert.equal(one,two)
 await Promise.resolve();assert.equal(calls,1);held.resolve({ok:true,data:[],meta:{license_no:null}})
 assert.equal((await one).ok,true);await catalog.read();assert.equal(calls,1)
 catalog.invalidate();await catalog.read();assert.equal(calls,2)
 current=false;assert.equal((await catalog.read()).kind,'stale_context');assert.equal(calls,2)
})
test('catalog invalidation and obsolete scope reject pending results and cancel undispatched work',async()=>{
 let calls=0;const held=deferred(),catalog=createPrescriptionCatalog(()=>{calls++;return held.promise},()=>true)
 const read=catalog.read();await Promise.resolve();catalog.invalidate();held.resolve({ok:true,data:[{id:'obsolete'}]})
 assert.equal((await read).kind,'stale_context');assert.equal(calls,1)
 const cancelled=catalog.read();catalog.invalidate();assert.equal((await cancelled).kind,'stale_context');assert.equal(calls,1)
})
test('catalog failures are visible and a real retry can recover',async()=>{
 let calls=0;const catalog=createPrescriptionCatalog(()=>{if(++calls===1)throw Error('offline');return {ok:true,data:[]}},()=>true)
 assert.equal((await catalog.read()).ok,false);assert.equal((await catalog.read()).ok,true);assert.equal(calls,2)
})

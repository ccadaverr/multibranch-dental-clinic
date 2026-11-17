import test from 'node:test'
import assert from 'node:assert/strict'
import {matchesEncounter,boundedEncounter} from '../src/encounter-readback.js'
import {createAppointmentFlow} from '../src/appointment-flow.js'
import {mapTreatment} from '../src/treatments-api.js'
import {encounterContextFor,calledEncounterContext} from '../src/encounter.js'
import {setClockSource} from '../src/clock.js'
import {row,world} from './support/mock-server-world.js'
import {serverId} from './support/server-appointments.js'
setClockSource(()=>new Date('2026-09-19T02:08:00Z'))
async function setup(){
 const w=world();const a=w.seed(row());await w.flow.checkIn(a.id,'arrive');w.role('dentist');await w.flow.queueCommand(w.state.queue[0],'call','call')
 const entry=structuredClone(w.state.queue[0]),visit=structuredClone(w.state.visits[0])
 const expected={visitId:visit.id,visitRevision:visit.revision,queueEntryId:entry.id,queueRevision:entry.revision,patientPublicId:visit.patientPublicId,branchId:visit.branchId,dentistId:visit.dentistId,serviceId:visit.serviceId,appointmentId:visit.appointmentId,clinicDate:visit.clinicDate}
 const receipt={id:serverId(9900),author:true,status:'In Treatment',revision:1,completed_at:null,clinic_date:visit.clinicDate,started_at:visit.arrivedAt,
  patient:{id:visit.patientPublicId},branch:{id:visit.branchId},dentist:{id:visit.dentistId},requested_service:{id:visit.serviceId},appointment:visit.appointmentId?{id:visit.appointmentId,status:'In Treatment'}:null,
  visit:{id:visit.id,status:'In Treatment',source:'appointment',revision:visit.revision+1,queue:{id:entry.id,status:'Served',revision:entry.revision+1}}}
 let generation=1,current=true,reads=0,saves=[],starts=[]
 const commit=(r=receipt)=>{w.state={...w.state,queue:w.state.queue.map(q=>({...q,status:'Served',visitStatus:r.status})),visits:w.state.visits.map(v=>({...v,status:r.status})),appointments:w.state.appointments.map(a=>({...a,status:r.status})),treatments:[{...mapTreatment(r),patientId:entry.patientId}]}}
 const api={startTreatment:async(v,key,q,before)=>{starts.push({v:structuredClone(v),key,q:structuredClone(q),before});commit();return {ok:true,row:receipt}},
  documentTreatment:async(t,form,key,before)=>{saves.push({t,form,key,before});return {ok:false,kind:'conflict',message:'Observed revision changed'}},encounterForVisit:async()=>{reads++;return {ok:true,row:receipt}}}
 let refresh=async()=>({ok:true})
 const flow=createAppointmentFlow({getState:()=>w.state,getSession:()=>w.session,getAuthGeneration:()=>generation,getActions:()=>({}),refresh:()=>refresh(),treatments:api})
 return {w,entry,visit,expected,receipt,api,flow,commit,saves,starts,owns:()=>current,revoke:()=>{generation++},unmount:()=>{current=false},refresh:fn=>{refresh=fn},get reads(){return reads}}
}
test('a start receipt proves the exact persisted tuple, not just Patient and branch',async()=>{
 const x=await setup();assert.equal(matchesEncounter(x.receipt,x.expected,true),true)
 for(const field of ['id','author','status','revision','completed_at','clinic_date']){
  const wrong={...x.receipt,[field]:({id:'bad',author:false,status:'Completed',revision:2,completed_at:'2026-09-19',clinic_date:'2026-09-20'})[field]}
  assert.equal(matchesEncounter(wrong,x.expected,true),false,field)
 }
 for(const patch of [{patient:{id:serverId(22)}},{dentist:{id:'other'}},{branch:{id:'other'}},{requested_service:{id:'other'}},{appointment:null},{visit:{...x.receipt.visit,id:serverId(33)}},{visit:{...x.receipt.visit,queue:{...x.receipt.visit.queue,id:serverId(44)}}},{visit:{...x.receipt.visit,queue:{...x.receipt.visit.queue,revision:99}}}])assert.equal(matchesEncounter({...x.receipt,...patch},x.expected,true),false)
})
test('walk-in receipt requires null appointment and walk_in source',async()=>{const x=await setup();const e={...x.expected,appointmentId:null},r={...x.receipt,appointment:null,visit:{...x.receipt.visit,source:'walk_in'}};assert.equal(matchesEncounter(r,e,true),true);assert.equal(matchesEncounter(x.receipt,e,true),false)})
test('first documentation uses the original start revision despite a newer refreshed revision',async()=>{
 const x=await setup();x.refresh(async()=>{x.commit({...x.receipt,revision:7});return {ok:true}})
 const r=await x.flow.startTreatment(x.entry,{notes:'Original reviewed draft'},'start','save',x.visit)
 assert.equal(r.ok,false);assert.equal(r.partial,true);assert.equal(x.saves.length,1);assert.equal(x.saves[0].t.revision,1);assert.equal(x.saves[0].key,'save');assert.equal(x.saves[0].form.notes,'Original reviewed draft')
})
test('committed loss then retry retains the original queue/Visit revisions and key after projections change',async()=>{
 const x=await setup();let count=0;const send=x.api.startTreatment;x.api.startTreatment=async(...a)=>{const r=await send(...a);return ++count===1?{ok:false,kind:'network'}:r}
 assert.equal((await x.flow.startTreatment(x.entry,null,'same','save',x.visit)).ok,false)
 const r=await x.flow.startTreatment(x.entry,null,'same','save',x.visit);assert.equal(r.ok,true);assert.equal(r.record.id,x.receipt.id)
 assert.deepEqual(x.starts.map(s=>[s.v.revision,s.q.revision,s.key]),[[1,2,'same'],[1,2,'same']]);assert.equal(x.saves.length,0)
})
test('wrong receipt does not trigger refresh or any documentation',async()=>{const x=await setup();x.api.startTreatment=async()=>({ok:true,row:{...x.receipt,patient:{id:serverId(66)}}});x.refresh(()=>assert.fail('No unverified adoption'));const r=await x.flow.startTreatment(x.entry,{notes:'draft'},'a','b',x.visit);assert.equal(r.uncertain,true);assert.equal(x.saves.length,0)})
test('start remains verified but current-list failure is explicit, retryable and does not save a draft',async()=>{const x=await setup();x.refresh(async()=>({ok:false}));const r=await x.flow.startTreatment(x.entry,{notes:'draft'},'a','b',x.visit);assert.equal(r.ok,false);assert.equal(r.partial,true);assert.equal(r.record.id,x.receipt.id);assert.equal(x.saves.length,0)})
for(const action of ['revoke','unmount'])test(action+' during start prevents response adoption and automatic documentation',async()=>{const x=await setup();const send=x.api.startTreatment;x.api.startTreatment=async(...args)=>{const r=await send(...args);x[action]();assert.equal(args[3](),false);return r};const r=await x.flow.startTreatment(x.entry,{notes:'draft'},'a','b',x.visit,x.owns);assert.equal(r.kind,'stale_context');assert.equal(x.saves.length,0)})
test('exact readback validates route context and never dispatches a start',async()=>{const x=await setup();const ctx=encounterContextFor(x.entry);assert.equal((await x.flow.readEncounter(ctx)).ok,true);assert.equal(x.reads,1);assert.equal(x.starts.length,0);assert.equal((await x.flow.readEncounter({...ctx,patientId:'foreign'})).ok,false);assert.equal(x.reads,1);x.api.encounterForVisit=async()=>({ok:true,row:{...x.receipt,appointment:null}});assert.equal((await x.flow.readEncounter(ctx)).kind,'unverified')})
test('bounded network waiting ends in uncertainty without pretending to cancel the server command',async()=>{await assert.rejects(boundedEncounter(()=>new Promise(()=>{}),5),/unavailable/)})
test('call-and-open navigation requires the exact original call receipt',async()=>{const x=await setup();const q={...x.entry,status:'Waiting',revision:1},r={id:q.id,revision:2,status:'Called',clinic_date:q.clinicDate,visit:{id:q.visitId,status:'Checked In'},patient:{id:q.patientPublicId},branch:{id:q.branchId},dentist:{id:q.dentistId},appointment:{id:q.appointmentId}};assert.deepEqual(calledEncounterContext(r,q),encounterContextFor(q));for(const patch of [{id:serverId(8)},{status:'Served'},{revision:9},{visit:{id:serverId(9),status:'Checked In'}},{patient:{id:serverId(10)}},{branch:{id:'other'}},{appointment:null}])assert.equal(calledEncounterContext({...r,...patch},q),null)})

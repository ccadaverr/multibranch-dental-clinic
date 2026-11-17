import test from 'node:test'
import assert from 'node:assert/strict'
import {readHomeAppointments,readHomeBalance} from '../src/patient/home-read.js'
import {readEncounterFollowups} from '../src/encounter-care-read.js'
const family=async()=>({ok:true,data:[{id:'dependent'}],meta:{me:{id:'p1'}}})
const invoice=(id,balance='0.10')=>({id,patient:{id:'p1'},branch:{id:'b1'},status:'Issued',revision:1,lines:[],gross_amount:balance,patient_responsibility_amount:balance,paid_amount:'0.00',balance})
const visit={id:'a1',patient:{id:'dependent',name:'Synthetic dependent'},branch:{id:'b1',name:'Synthetic branch'},status:'Confirmed',date:'2099-11-18',start_time:'09:00',starts_at:'2099-11-18T09:00:00+08:00'}
const task={id:'f1',patient:{id:'p1'},branch:{id:'b1'},status:'Open',revision:1,reason:'Synthetic review',due_on:'2099-11-18',appointment:null}

test('Home balance reads every issued invoice page, checks exact cursor and sums integer centavos',async()=>{
  const first=Array.from({length:100},(_,i)=>invoice('i'+i)),calls=[]
  const r=await readHomeBalance(async p=>{calls.push(p);return p.cursor?{ok:true,data:[invoice('last','0.20')],meta:{next_cursor:null}}:{ok:true,data:first,meta:{next_cursor:'i99'}}},family,'p1',()=>true)
  assert.equal(r.ok,true);assert.deepEqual(r.data,{minor:1020,count:101})
  assert.deepEqual(calls,[{per_page:100,status:'Issued'},{per_page:100,cursor:'i99',status:'Issued'}])
})
test('Home never presents a partial, repeated, malformed or foreign-Patient balance as a complete total',async()=>{
  const bad=[{ok:true,data:[invoice('i')],meta:{}},{ok:true,data:[{...invoice('i'),patient:{id:'foreign'}}],meta:{next_cursor:null}},
    {ok:true,data:[invoice('i'),invoice('i')],meta:{next_cursor:null}},{ok:true,data:[{...invoice('i'),balance:'not money'}],meta:{next_cursor:null}},
    {ok:true,data:[invoice('i')],meta:{next_cursor:'wrong'}}]
  for(const response of bad){const r=await readHomeBalance(async()=>response,family,'p1',()=>true);assert.equal(r.ok,false);assert.equal(r.data,undefined)}
  const r=await readHomeBalance(async p=>p.cursor?{ok:false,message:'Synthetic later-page failure'}:{ok:true,data:[invoice('i')],meta:{next_cursor:'i'}},family,'p1',()=>true)
  assert.equal(r.message,'Synthetic later-page failure');assert.equal(r.data,undefined)
})
test('Home family mismatch and expired ownership do not dispatch clinical reads',async()=>{
  let called=0
  const read=async()=>{called++;return {ok:true,data:[],meta:{next_cursor:null}}}
  assert.equal((await readHomeBalance(read,async()=>({ok:true,data:[],meta:{me:{id:'other'}}}),'p1',()=>true)).ok,false)
  assert.equal((await readHomeBalance(read,family,'p1',()=>false)).ok,false)
  assert.equal(called,0)
})
test('Home active appointment read keeps authorized dependents and exact server statuses',async()=>{
  const calls=[]
  const r=await readHomeAppointments(async p=>{calls.push(p);return {ok:true,data:p.status==='Confirmed'?[visit]:[],meta:{last_page:1}}},family,'p1',()=>true)
  assert.deepEqual(r.data,[visit]);assert.equal(calls.length,4)
  for(const change of [{patient:{id:'foreign'}},{branch:null},{status:'Completed'},{starts_at:'broken'}]) {
    assert.equal((await readHomeAppointments(async()=>({ok:true,data:[{...visit,...change}],meta:{last_page:1}}),family,'p1',()=>true)).ok,false)
  }
})
test('Home rejected and hung reads settle as recoverable failure, and stale pages stop dispatching',async()=>{
  assert.equal((await readHomeBalance(async()=>{throw Error('offline')},family,'p1',()=>true)).ok,false)
  assert.equal((await readHomeBalance(()=>new Promise(()=>{}),family,'p1',()=>true,5)).ok,false)
  let current=true,finish,calls=0
  const r=readHomeBalance(()=>{calls++;return new Promise(resolve=>finish=resolve)},family,'p1',()=>current)
  while(!finish)await new Promise(r=>setImmediate(r))
  current=false;finish({ok:true,data:[invoice('i')],meta:{next_cursor:'i'}})
  assert.equal((await r).ok,false);assert.equal(calls,1)
})
test('Encounter follow-up read validates Patient identity and projects only the exact branch',async()=>{
  const r=await readEncounterFollowups(async id=>{assert.equal(id,'p1');return {ok:true,data:[task,{...task,id:'f2',branch:{id:'b2'}}]}},{patientId:'p1',branchId:'b1'},()=>true)
  assert.deepEqual(r.data,[task])
  for(const data of [[{...task,patient:{id:'foreign'}}],[{...task,revision:0}],[{...task,reason:{}}],[task,task],{}])assert.equal((await readEncounterFollowups(async()=>({ok:true,data}),{patientId:'p1',branchId:'b1'},()=>true)).ok,false)
})
test('Encounter care rejects stale completion and bounds failed or hung reads',async()=>{
  let current=true,finish
  const pending=readEncounterFollowups(()=>new Promise(r=>finish=r),{patientId:'p1',branchId:'b1'},()=>current)
  await Promise.resolve();current=false;finish({ok:true,data:[task]});assert.equal((await pending).kind,'stale_context')
  assert.equal((await readEncounterFollowups(()=>new Promise(()=>{}),{patientId:'p1',branchId:'b1'},()=>true,5)).ok,false)
  assert.equal((await readEncounterFollowups(()=>{throw Error('offline')},{patientId:'p1',branchId:'b1'},()=>true)).ok,false)
})

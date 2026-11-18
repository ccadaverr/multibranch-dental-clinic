import test from 'node:test'
import assert from 'node:assert/strict'
import {readPrescriptionPage} from '../src/prescription-list.js'
import {readPatientPrescriptions} from '../src/patient/prescription-read.js'

const row={id:'rx1',patient:{id:'p1'},visit:'v1',branch_id:'b1',branch:'Synthetic branch',status:'Issued',number:'RX-SYNTHETIC-1',revision:2,issued_at:'2026-11-17T08:00:00+08:00',lines:[{medicine:'Synthetic only'}]}
const page={page:1,per_page:20,patient_id:'p1',visit_id:'v1'}
const response={ok:true,data:[row],meta:{current_page:1,last_page:1,per_page:20,total:1}}
test('paged prescription read preserves exact request and validates totals, identity and status',async()=>{
  const r=await readPrescriptionPage(async q=>{assert.deepEqual(q,page);return response},page,'dentist')
  assert.deepEqual(r,response)
  for(const change of [{patient:{id:'foreign'}},{visit:'foreign'},{branch_id:null},{revision:0},{status:'Unknown'},{number:null}]) {
    assert.equal((await readPrescriptionPage(async()=>({...response,data:[{...row,...change}]}),page,'dentist')).ok,false)
  }
  assert.equal((await readPrescriptionPage(async()=>response,{...page,status:'Void'},'dentist')).ok,false)
})
test('paged prescription read rejects repeated, truncated, malformed and mismatched pages instead of empty success',async()=>{
  for(const data of [null,{},[row,row],[]])assert.equal((await readPrescriptionPage(async()=>({...response,data}),page,'dentist')).ok,false)
  for(const change of [{current_page:2},{total:2},{last_page:2},{per_page:10},{total:-1}]) {
    assert.equal((await readPrescriptionPage(async()=>({...response,meta:{...response.meta,...change}}),page,'dentist')).ok,false)
  }
  assert.equal((await readPrescriptionPage(async()=>({ok:true,data:[],meta:{...response.meta,total:0}}),page,'dentist')).ok,true)
  assert.equal((await readPrescriptionPage(async()=>({ok:false,message:'Denied'}),page,'dentist')).message,'Denied')
  assert.equal((await readPrescriptionPage(async()=>{throw Error('synthetic offline')},page,'dentist')).ok,false)
  assert.equal((await readPrescriptionPage(async()=>undefined,page,'dentist')).ok,false)
  let called=false
  assert.equal((await readPrescriptionPage(()=>{called=true},page,'patient')).ok,false)
  assert.equal((await readPrescriptionPage(()=>{called=true},{...page,patient_id:null},'dentist')).ok,false)
  assert.equal(called,false)
})
test('Owner pages cannot adopt clinical projections and Staff pages cannot adopt Drafts',async()=>{
  assert.equal((await readPrescriptionPage(async()=>response,page,'owner')).ok,false)
  const {patient,visit,branch_id,lines,...metadata}=row
  assert.equal((await readPrescriptionPage(async()=>({...response,data:[metadata]}),page,'owner')).ok,true)
  assert.equal((await readPrescriptionPage(async()=>({...response,data:[{...row,status:'Draft',number:null}]}),page,'staff')).ok,false)
})
const family=async()=>({ok:true,data:[{id:'dependent'}],meta:{me:{id:'p1'}}})
test('Patient prescription read adopts only own/dependent issued and void persisted records',async()=>{
  const records=[row,{...row,id:'rx2',patient:{id:'dependent'},status:'Void',voided:{at:row.issued_at,reason:'Synthetic correction'}}]
  const r=await readPatientPrescriptions(async()=>({ok:true,data:records}),family,'p1',()=>true)
  assert.deepEqual(r.data,records)
  for(const change of [{patient:{id:'foreign'}},{visit:null},{branch_id:null},{status:'Draft'},{lines:null},{revision:0},
    {number:{}},{issued_at:'invalid'},{note:{}},{patient:{id:'p1',name:{}}},{status:'Void'}, {voided:{at:row.issued_at,reason:{}}}, {lines:[{medicine:'Synthetic',instructions:{}}]}]){
    const result=await readPatientPrescriptions(async()=>({ok:true,data:[{...row,...change}]}),family,'p1',()=>true)
    assert.equal(result.ok,false);assert.equal(result.data,undefined)
  }
  assert.equal((await readPatientPrescriptions(async()=>({ok:true,data:[row,row]}),family,'p1',()=>true)).ok,false)
})
test('Patient prescription history keeps valid PDFs accessible when an authorized legacy row has no items', async () => {
  const empty = { ...row, id: 'rx-incomplete', lines: [] }
  const read = data => readPatientPrescriptions(async () => ({ ok: true, data }), family, 'p1', () => true)
  const result = await read([empty, row])
  assert.deepEqual(result.data, [row])
  assert.equal(result.unavailableCount, 1)
  assert.equal((await read([{ ...empty, patient: { id: 'foreign' } }, row])).ok, false)
  assert.equal((await read([{ ...empty, visit: null }, row])).ok, false)
})
test('Patient prescription read fails closed for lost family scope, timeout, rejection and revocation',async()=>{
  const read=async()=>({ok:true,data:[row]})
  assert.equal((await readPatientPrescriptions(read,async()=>({ok:false}), 'p1',()=>true)).ok,false)
  assert.equal((await readPatientPrescriptions(read,async()=>({ok:true,data:{}}),'p1',()=>true)).ok,false)
  assert.equal((await readPatientPrescriptions(()=>{throw Error('offline')},family,'p1',()=>true)).ok,false)
  assert.equal((await readPatientPrescriptions(()=>new Promise(()=>{}),family,'p1',()=>true,5)).ok,false)
  let current=true,finish
  const pending=readPatientPrescriptions(()=>new Promise(r=>{finish=r}),family,'p1',()=>current)
  await Promise.resolve();current=false;finish({ok:true,data:[row]})
  assert.equal((await pending).kind,'stale_context')
  let called=false
  await readPatientPrescriptions(()=>{called=true},family,'p1',()=>false)
  assert.equal(called,false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {readEncounterPrescriptions} from '../src/prescription-readback.js'
const context={patientId:'p1',visitId:'v1',branchId:'b1'}
const row={id:'rx1',patient:{id:'p1'},visit:'v1',branch_id:'b1',status:'Issued',number:'RX-SYNTHETIC-1',revision:2}
test('encounter prescription list passes exact Patient/Visit filters and retains original and correction identities',async()=>{
  const data=[{...row,status:'Void',revision:3},{...row,id:'rx2',number:'RX-SYNTHETIC-2'},{...row,id:'rx3',status:'Draft',number:null,revision:1}]
  const result=await readEncounterPrescriptions(async query=>{assert.deepEqual(query,{patient_id:'p1',visit_id:'v1'});return {ok:true,data}},context)
  assert.equal(result.ok,true);assert.deepEqual(result.data,data)
})
test('foreign Patient, Visit, branch, malformed and truncated prescription lists fail closed',async()=>{
  for(const data of [[{...row,patient:{id:'foreign'}}],[{...row,visit:'foreign'}],[{...row,branch_id:'foreign'}],[{...row,branch_id:undefined}],
    [{...row,status:'Unknown'}],[{...row,revision:0}],[{...row,number:null}],[row,row],{},Array(200).fill(row)]) {
    const r=await readEncounterPrescriptions(async()=>({ok:true,data}),context);assert.equal(r.ok,false);assert.equal(r.data,undefined)
  }
})
test('failed reads remain errors; empty exact reads are distinct and absent identity never dispatches',async()=>{
  assert.equal((await readEncounterPrescriptions(async()=>({ok:false,message:'Synthetic offline'}),context)).message,'Synthetic offline')
  assert.equal((await readEncounterPrescriptions(async()=>{throw Error('synthetic')},context)).ok,false)
  assert.deepEqual((await readEncounterPrescriptions(async()=>({ok:true,data:[]}),context)).data,[])
  assert.equal((await readEncounterPrescriptions(()=>{throw Error('must not dispatch')},{...context,visitId:null})).ok,false)
})

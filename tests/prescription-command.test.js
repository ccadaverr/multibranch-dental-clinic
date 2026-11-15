import test from 'node:test'
import assert from 'node:assert/strict'
import {prescriptionWriteMatches,runPrescriptionWrite} from '../src/prescription-command.js'
const request=()=>({visitId:'visit',patientId:'patient',branch:'Branch',saveKey:'save-key',issueKey:'issue-key',issue:true,body:{lines:[{medicine:'Synthetic medicine',dosage:'Synthetic dose'}],note:'Synthetic note'}})
const draft=()=>({id:'rx',revision:1,status:'Draft',can_edit:true,number:null,visit:'visit',patient:{id:'patient'},branch:'Branch',lines:[{medicine:'Synthetic medicine',dosage:'Synthetic dose'}],note:'Synthetic note'})
const issued=()=>({...draft(),revision:2,status:'Issued',number:'RX-2026-000001',issued_at:'2026-11-15T11:00:00+08:00',can_edit:false,can_void:true})
test('exact clinical identity, medicine content, revision, status and issue evidence are mandatory',()=>{
 assert.equal(prescriptionWriteMatches(draft(),request()),true)
 for(const field of ['visitId','patientId','branch']){const r=request();r[field]=undefined;assert.equal(prescriptionWriteMatches(draft(),r),false)}
 const r=request();r.acceptedDraft=draft();assert.equal(prescriptionWriteMatches(issued(),r,true),true)
 for(const mutate of [p=>p.patient.id='other',p=>p.visit='other',p=>p.branch='other',p=>p.revision=1,p=>p.status='Draft',p=>p.lines[0].medicine='other',p=>p.number='',p=>p.issued_at=null,p=>p.can_edit=true]){const p=issued();mutate(p);assert.equal(prescriptionWriteMatches(p,r,true),false)}
})
test('unknown issuance retries exact saved Draft ID/revision and the original issue key without another Save',async()=>{
 const r=request(),calls=[];let first=true
 const api={create:async()=>{calls.push('create');return{ok:true,data:draft()}},issue:async(id,revision,key)=>{calls.push({id,revision,key});if(first){first=false;return{ok:false,kind:'network'}}return{ok:true,data:issued()}},read:async()=>({ok:true,data:issued()})}
 assert.equal((await runPrescriptionWrite(r,api,()=>true)).retryable,true)
 assert.equal((await runPrescriptionWrite(r,api,()=>true)).ok,true)
 assert.equal(calls.filter(x=>x==='create').length,1);assert.deepEqual(calls[1],calls[2])
})
test('a lost create response reuses its original key and exact clinical payload',async()=>{
 const r=request(),calls=[];let fail=true
 const api={create:async(body,key)=>{calls.push({body,key});if(fail){fail=false;throw Error('lost')}return{ok:true,data:draft()}},issue:async()=>({ok:true,data:issued()}),read:async()=>({ok:true,data:issued()})}
 assert.equal((await runPrescriptionWrite(r,api,()=>true)).retryable,true);assert.equal((await runPrescriptionWrite(r,api,()=>true)).ok,true);assert.deepEqual(calls[0],calls[1])
})
test('contradictory accepted Draft cannot initiate clinical issuance',async()=>{
 let issues=0;const bad=draft();bad.patient.id='foreign'
 const r=await runPrescriptionWrite(request(),{create:async()=>({ok:true,data:bad}),issue:async()=>{issues++}},()=>true)
 assert.equal(r.retryable,true);assert.equal(issues,0)
})
test('an actor change after preparation prevents Issue dispatch',async()=>{
 let allowed=true,issues=0
 const r=await runPrescriptionWrite(request(),{create:async()=>{allowed=false;return{ok:true,data:draft()}},issue:async()=>{issues++}},()=>allowed)
 assert.equal(r.kind,'auth_changed');assert.equal(issues,0)
})
test('contradictory or failed final readback cannot announce issuance success',async()=>{
 for(const read of [{ok:false,kind:'network'},{ok:true,data:{...issued(),revision:1}},{ok:true,data:{...issued(),status:'Draft'}}]){
  const r=await runPrescriptionWrite(request(),{create:async()=>({ok:true,data:draft()}),issue:async()=>({ok:true,data:issued()}),read:async()=>read},()=>true);assert.equal(r.ok,false);assert.equal(r.retryable,true)
 }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {readPrescriptionVisitOptions} from '../src/prescription-visit-read.js'
import {readEncounterPrescriptions} from '../src/prescription-readback.js'
const context={visitId:'v1',patientPublicId:'p1',branchId:'b1',dentistId:'d1'}
const visit={id:'v1',revision:1,patient:{id:'p1',code:'PAT-1',name:'Synthetic Patient'},branch:{id:'b1',name:'Synthetic branch'},dentist:{id:'d1',name:'Synthetic Dentist'},status:'In Treatment',clinic_date:'2026-11-18'}
test('linked prescription Visit is read exactly even when absent from recent suggestions',async()=>{
 const r=await readPrescriptionVisitOptions(async()=>({ok:true,data:[],meta:{allergy_notice:'Verify with Patient'}}),async id=>{assert.equal(id,'v1');return {ok:true,data:visit}},context,()=>true)
 assert.equal(r.ok,true);assert.equal(r.data[0].id,'v1');assert.equal(r.data[0].patient.id,'p1');assert.equal(r.data[0].branch_id,'b1');assert.equal(r.meta.allergy_notice,'Verify with Patient')
 for(const patch of [{id:'wrong'},{patient:{...visit.patient,id:'wrong'}},{branch:{...visit.branch,id:'wrong'}},{dentist:{id:'wrong'}},{status:'Unknown'},{clinic_date:'2026-02-30'},{revision:0}])assert.equal((await readPrescriptionVisitOptions(async()=>({ok:true,data:[]}),async()=>({ok:true,data:{...visit,...patch}}),context,()=>true)).ok,false)
})
test('prescription Visit failure, timeout and stale context cannot become a verified selection',async()=>{
 assert.equal((await readPrescriptionVisitOptions(()=>{throw Error('offline')},async()=>({ok:true,data:visit}),context,()=>true)).ok,false)
 assert.equal((await readPrescriptionVisitOptions(()=>new Promise(()=>{}),async()=>({ok:true,data:visit}),context,()=>true,5)).ok,false)
 let calls=0;assert.equal((await readPrescriptionVisitOptions(()=>{calls++},()=>{},context,()=>false)).kind,'stale_context');assert.equal(calls,0)
 let release,active=true;const r=readPrescriptionVisitOptions(()=>new Promise(resolve=>release=resolve),async()=>({ok:true,data:visit}),context,()=>active);await Promise.resolve();active=false;release({ok:true,data:[]});assert.equal((await r).kind,'stale_context')
})
const row=id=>({id,patient:{id:'p1'},visit:'v1',branch_id:'b1',status:'Draft',number:null,revision:1})
test('exact encounter read reaches prescription 201 and never adopts a partial failed or wrong-branch page',async()=>{
 const rows=Array.from({length:201},(_,i)=>row('rx'+i)),calls=[]
 const read=async q=>{calls.push(q.page);return {ok:true,data:rows.slice((q.page-1)*100,q.page*100),meta:{current_page:q.page,last_page:3,per_page:100,total:201}}}
 const c={patientId:'p1',visitId:'v1',branchId:'b1'},r=await readEncounterPrescriptions(read,c);assert.equal(r.ok,true);assert.deepEqual(r.data,rows);assert.deepEqual(calls,[1,2,3])
 for(const fail of [q=>q.page===2?{ok:false,message:'offline'}:read(q),async q=>{const r=await read(q);return q.page===2?{...r,data:r.data.map(p=>({...p,branch_id:'foreign'}))}:r}]){const r=await readEncounterPrescriptions(fail,c);assert.equal(r.ok,false);assert.equal(r.data,undefined)}
 let active=true,n=0;const stale=await readEncounterPrescriptions(async q=>{n++;const r=await read(q);active=false;return r},c,()=>active);assert.equal(stale.ok,false);assert.equal(n,1)
})

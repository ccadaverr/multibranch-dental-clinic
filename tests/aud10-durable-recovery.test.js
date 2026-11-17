import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {selectedFollowupProblem} from '../src/appointments-api.js'
import {apiBase} from '../src/api-client.js'
const out=await build({stdin:{contents:"export {recoveredFollowupReceipt} from './src/pages/ServerFollowups.jsx'",resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'js'},bundle:true,platform:'node',format:'cjs',write:false,packages:'external',loader:{'.css':'empty'},logLevel:'silent'})
const m={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(createRequire(import.meta.url),m,m.exports)
const {recoveredFollowupReceipt:recover}=m.exports
const P='01ARZ3NDEKTSV4RRFFQ69G5FAB',T='01ARZ3NDEKTSV4RRFFQ69G5FAV',A='01ARZ3NDEKTSV4RRFFQ69G5FAA'
const selection={taskId:T,expectedRevision:7,patientPublicId:P,branchId:'b1',dentistId:'d1'}
const form={patientPublicId:P,branchId:'b1',dentistId:'d1'}
const backend={contract:'followup-booking.v1',enabled:true,exact_task_linkage:true,receipt_recovery:true,dentist_context:true,apiBase:apiBase()}
const receipt=()=>({ok:true,meta:{historical_receipt:true},data:{data:{id:A,code:'SYN-APT',status:'Confirmed',revision:1,patient:{id:P},branch:{id:'b1'},date:'2026-11-20',start_time:'10:00'},meta:{followup_link:{task_id:T,appointment_id:A,status:'Booked',revision:8}}}})
test('runtime contract enables only the verified API target and retained Dentist',()=>{
 assert.equal(selectedFollowupProblem(form,selection,backend,'same-key'),'')
 assert.match(selectedFollowupProblem({...form,dentistId:'d2'},selection,backend,'same-key'),/Dentist/)
})
for(const flag of ['enabled','exact_task_linkage','receipt_recovery','dentist_context'])test('incomplete runtime readiness refuses '+flag,()=>{
 assert.ok(selectedFollowupProblem(form,selection,{...backend,[flag]:false},'same-key'))
})
test('different endpoint cannot reuse runtime readiness',()=>assert.ok(selectedFollowupProblem(form,selection,{...backend,apiBase:'https://example.invalid'},'same-key')))
test('original journal receipt can be read independently of newer task revision',()=>{
 assert.equal(recover(receipt(),{...selection,expectedRevision:12}).id,A)
})
for(const [name,change] of Object.entries({
 'current task substituted':r=>{r.data={id:T,status:'Booked',appointment:{id:A}}},
 'wrong task':r=>{r.data.meta.followup_link.task_id=P},'wrong appointment':r=>{r.data.meta.followup_link.appointment_id=P},
 'wrong Patient':r=>{r.data.data.patient.id=T},'wrong branch':r=>{r.data.data.branch.id='b2'},
 'no historical provenance':r=>{r.meta={}},'invalid original state':r=>{r.data.data.status='Cancelled'},
 'no receipt':r=>{r.ok=false},'invalid revision':r=>{r.data.meta.followup_link.revision='8'}
}))test('recovery refuses '+name,()=>{const r=receipt();change(r);assert.equal(recover(r,selection),null)})

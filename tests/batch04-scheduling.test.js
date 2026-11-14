import test from 'node:test'
import assert from 'node:assert/strict'
import {productionExpression,variableValue} from './support/source-behavior.js'
import {requestLeave,cancelLeave,updateStaffProfile,__resetCsrfCacheForTests} from '../src/api-client.js'

const confirmed=productionExpression('src/pages/Staffing.jsx',n=>n.type==='FunctionDeclaration'&&n.id?.name==='leaveRequestConfirmed',{
 addDays:(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*864e5).toISOString().slice(0,10),
})
const partial={type:'other',start_date:'2026-11-13',end_date:'2026-11-13',start_time:'10:15',end_time:'11:30',private_note:'Synthetic reason'}
const receipt={id:'synthetic-leave',type:'other',status:'Pending',starts_at:'2026-11-13T10:15:00+08:00',ends_at:'2026-11-13T11:30:00+08:00',private_note:'Synthetic reason'}
test('STF-08/DEN-13 exact partial-day receipt confirms only the requested Manila interval',()=>assert.equal(confirmed(partial,receipt),true))
for(const [field,value]of [['id',null],['type','sick'],['status','Approved'],['starts_at','2026-11-13T09:15:00+08:00'],['ends_at','2026-11-14T11:30:00+08:00'],['private_note','Different reason']])test('STF-08/DEN-13 mismatched receipt '+field+' is unverified',()=>assert.equal(confirmed(partial,{...receipt,[field]:value}),false))
for(const value of [null,{},undefined])test('STF-08/DEN-13 absent receipt '+JSON.stringify(value)+' is unverified',()=>assert.equal(confirmed(partial,value),false))
for(const [date,next]of [['2026-12-31','2027-01-01'],['2028-02-29','2028-03-01']])test('STF-08 full-day receipt includes the last Manila day at boundary '+date,()=>{
 const body={type:'vacation',start_date:date,end_date:date,private_note:null}
 assert.equal(confirmed(body,{id:'leave-A',type:'vacation',status:'Pending',starts_at:date+'T00:00:00+08:00',ends_at:next+'T00:00:00+08:00',private_note:null}),true)
})
function shift(reply=async()=>({ok:true,data:{id:'staff-A',branchId:'b1',branch:'Synthetic branch',shiftStart:'09:15:00',shiftEnd:'18:15:00'}})){
 const calls=[],errors=[],saved=[],success=[],b={
  staff:{id:'staff-A',name:'Synthetic Staff',branchRef:'b1'},start:'09:15',end:'18:15',branch:'b1',
  allowed:{current:true},live:{current:true},pending:{current:false},currentProfile:{current:'review-A'},reviewedProfile:{current:'review-A'},getAuthGeneration:()=>1,
  setSaving(){},setEditing(){},setError:v=>errors.push(v),setSuccess:v=>success.push(v),onPending(){},onSaved:r=>saved.push(r),restoreFocus:{current:false},
  firstError:r=>r.message,staffShiftSummary:r=>({id:r.id,start:r.shiftStart?.slice(0,5),end:r.shiftEnd?.slice(0,5),branchRef:r.branchId??''}),
  updateStaffProfile:async(id,body)=>{calls.push({id,body});return reply()},
 }
 const save=()=>variableValue('src/pages/Staffing.jsx','save',b,'StaffShiftProfile')({preventDefault(){}})
 return{b,save,calls,errors,saved,success}
}
test('OWN-11 shift-only update omits branch instruction and adopts exact receipt',async()=>{
 const f=shift();await f.save();assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[{id:'staff-A',body:{shift_start:'09:15',shift_end:'18:15'}}]);assert.equal(f.saved.length,1);assert.match(f.success.at(-1),/Shift profile saved/)
})
for(const [name,patch]of [['wrong ID',{id:'other'}],['wrong hours',{shiftStart:'08:15:00'}],['wrong branch',{branchId:'b2'}]])test('OWN-11 '+name+' receipt never becomes success',async()=>{
 const f=shift(async()=>({ok:true,data:{id:'staff-A',branchId:'b1',shiftStart:'09:15:00',shiftEnd:'18:15:00',...patch}}));await f.save();assert.deepEqual(f.saved,[]);assert.match(f.errors.at(-1),/could not be confirmed/);assert.equal(f.success.filter(Boolean).length,0)
})
test('OWN-11 stale reviewed assignment cannot silently reassign the profile',async()=>{
 const f=shift();f.b.currentProfile.current='review-B';await f.save();assert.deepEqual(f.calls,[]);assert.match(f.errors.at(-1),/profile changed/)
})
for(const [start,end]of [['18:00','09:00'],['09:00','09:00'],['25:00','26:00'],['','18:00']])test('OWN-11 invalid shift interval '+start+'-'+end+' never dispatches',async()=>{
 const f=shift();Object.assign(f.b,{start,end});await f.save();assert.deepEqual(f.calls,[]);assert.match(f.errors.at(-1),/shift end must be after/)
})
for(const changed of ['allowed','live','currentProfile'])test('OWN-11 late save after '+changed+' change cannot announce success',async()=>{
 let release;const f=shift(()=>new Promise(r=>{release=r})),pending=f.save();await Promise.resolve()
 f.b[changed].current=changed==='currentProfile'?'review-B':false
 release({ok:true,data:{id:'staff-A',branchId:'b1',shiftStart:'09:15:00',shiftEnd:'18:15:00'}});await pending
 assert.deepEqual(f.saved,[]);assert.equal(f.success.filter(Boolean).length,0)
})
test('OWN-11 same-tick repeated save dispatches once',async()=>{
 let release;const f=shift(()=>new Promise(r=>{release=r})),first=f.save();await f.save();assert.equal(f.calls.length,1)
 release({ok:true,data:{id:'staff-A',branchId:'b1',shiftStart:'09:15:00',shiftEnd:'18:15:00'}});await first
})
for(const [name,run,path,method,body]of [
 ['leave request',guard=>requestLeave(partial,guard),'/api/leave','POST',partial],
 ['leave cancellation',guard=>cancelLeave('leave-A',guard),'/api/leave/leave-A/cancel','POST',undefined],
 ['shift update',guard=>updateStaffProfile('staff-A',{shift_start:'09:15',shift_end:'18:15'},guard),'/api/staff/staff-A','PATCH',{shift_start:'09:15',shift_end:'18:15'}],
])for(const stale of [false,true])test('QA scheduling dispatch '+name+' '+(stale?'refuses context changed during CSRF':'retains exact method and body'),async()=>{
 const old=globalThis.fetch,calls=[];let current=true,release,started
 const waiting=new Promise(r=>{release=r}),began=new Promise(r=>{started=r});__resetCsrfCacheForTests()
 globalThis.fetch=async(url,options={})=>{
  if(String(url).endsWith('/sanctum/csrf-cookie')){started();await waiting;return new Response(null,{status:204})}
  calls.push({path:new URL(url).pathname,method:options.method,body:options.body?JSON.parse(options.body):undefined});return Response.json({data:{id:'synthetic'}})
 }
 try{
  const pending=run(()=>current);await began;if(stale)current=false;release();const result=await pending
  if(stale){assert.equal(result.kind,'stale_context');assert.deepEqual(calls,[])}
  else{assert.equal(result.ok,true);assert.deepEqual(calls,[{path,method,body}])}
 }finally{globalThis.fetch=old;__resetCsrfCacheForTests()}
})

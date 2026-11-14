import test from 'node:test'
import assert from 'node:assert/strict'
import{createAppointmentFlow}from'../src/appointment-flow.js'
import{apiBase,__resetCsrfCacheForTests}from'../src/api-client.js'
import{SELECTED_FOLLOWUP_BACKEND_COMMIT}from'../src/appointments-api.js'
import{syncBranchUpdate,syncBranchServiceToggle}from'../src/reference-data-bridge.js'
const P='01ARZ3NDEKTSV4RRFFQ69G5FAB',T='01ARZ3NDEKTSV4RRFFQ69G5FAV',AP='01ARZ3NDEKTSV4RRFFQ69G5FAA'
function world(){const w={auth:1,live:true,session:{serverUserId:'synthetic',userId:'staff',role:'staff',active:true,branchId:'b1',branchScopes:['b1']},state:{persons:[{id:'person'}],users:[{id:'staff',personId:'person',role:'Staff',status:'Active',branchId:'b1',permissions:['appointments']}],staff:[{userId:'staff',personId:'person',branchId:'b1'}],branches:[{id:'b1',status:'Open'}],appointments:[]}};w.flow=createAppointmentFlow({getState:()=>w.state,getSession:()=>w.session,getAuthGeneration:()=>w.auth,getActions:()=>({}),refresh:async()=>({ok:true})});w.begin=()=>w.flow.beginSelectedFollowup({patientPublicId:P,branchId:'b1',serviceId:'svc1',date:'2026-11-20',start:'10:00'},{selection:{taskId:T,expectedRevision:7,patientPublicId:P,branchId:'b1'},backend:{commit:SELECTED_FOLLOWUP_BACKEND_COMMIT,apiBase:apiBase()},isCurrent:()=>w.live,key:'stable-reviewed-key'});return w}
async function transport(run,changeReceipt=()=>{}){const previous=globalThis.fetch;__resetCsrfCacheForTests();let release,started;const ready=new Promise(r=>{started=r}),posts=[];globalThis.fetch=async(url,o={})=>{if(String(url).endsWith('/sanctum/csrf-cookie')){started();await new Promise(r=>{release=r});return new Response(null,{status:204})}posts.push({path:new URL(url).pathname,body:JSON.parse(o.body),key:o.headers['Idempotency-Key']});const receipt={data:{id:AP,status:'Confirmed',revision:1,patient:{id:P},branch:{id:'b1'},service:{id:'svc1'},date:'2026-11-20',start_time:'10:00'},meta:{followup_link:{task_id:T,appointment_id:AP,status:'Booked',revision:8}}};changeReceipt(receipt);return Response.json(receipt)};try{await run({posts,ready,release:()=>release()})}finally{globalThis.fetch=previous;__resetCsrfCacheForTests()}}
for(const[label,change]of[['auth generation',w=>{w.auth++}],['permission',w=>{w.state.users[0].permissions=[]}],['branch scope',w=>{w.session.branchScopes=['b2']}],['account',w=>{w.session.serverUserId='replacement'}],['UI context',w=>{w.live=false}]])test('AUD-10 refuses '+label+' changed during CSRF before a selected booking POST',async()=>transport(async h=>{const w=world(),attempt=w.begin(),done=attempt.submit();await h.ready;change(w);h.release();const r=await done;assert.equal(r.ok,false);assert.deepEqual(h.posts,[])}))
test('AUD-10 unchanged context sends the exact frozen selected command',async()=>transport(async h=>{const w=world(),done=w.begin().submit();await h.ready;h.release();assert.equal((await done).outcome,'verified');assert.equal(h.posts.length,1);assert.equal(h.posts[0].body.followup_task_id,T);assert.equal(h.posts[0].body.followup_expected_revision,7);assert.equal(h.posts[0].body.patient_id,P);assert.equal(h.posts[0].key,'stable-reviewed-key')}))
async function response(run,data){const old=globalThis.fetch;__resetCsrfCacheForTests();globalThis.fetch=async u=>String(u).endsWith('/sanctum/csrf-cookie')?new Response(null,{status:204}):Response.json({data});try{return await run()}finally{globalThis.fetch=old;__resetCsrfCacheForTests()}}
for(const[label,row]of[['wrong code',{id:'b1',branch_code:'BRC-A',latitude:14.81,longitude:120.93}],['wrong latitude',{id:'b1',branch_code:'BRC-D',latitude:14.9,longitude:120.93}],['missing coordinates',{id:'b1',branch_code:'BRC-D'}]])test('OWN-02/03 refuses unconfirmed '+label+' receipt',async()=>{const r=await response(()=>syncBranchUpdate('b1',{branchCode:'BRC-D',latitude:14.81,longitude:120.93}),row);assert.equal(r.ok,false);assert.equal(r.kind,'unconfirmed')})
test('OWN-02/03 accepts matching code and database-rounded six-decimal pin',async()=>{const r=await response(()=>syncBranchUpdate('b1',{branchCode:'BRC-D',latitude:14.81234567,longitude:120.93234567}),{id:'b1',branch_code:'BRC-D',latitude:14.812346,longitude:120.932346});assert.equal(r.ok,true);assert.equal(r.record.branchCode,'BRC-D')})
for(const active of [undefined,'true',false])test('Owner service toggle refuses a contradictory active receipt '+active,async()=>{const r=await response(()=>syncBranchServiceToggle('b1','svc1',true),{branch_ref:'b1',service_ref:'svc1',active});assert.equal(r.ok,false)})

for(const [label,change] of [
  ['cancelled appointment',r=>{r.data.status='Cancelled'}],
  ['pending non-Staff creation',r=>{r.data.status='Pending'}],
  ['missing appointment status',r=>{delete r.data.status}],
  ['missing appointment revision',r=>{delete r.data.revision}],
  ['string appointment revision',r=>{r.data.revision='1'}],
  ['later appointment revision',r=>{r.data.revision=2}],
])test('AUD-10 contradictory creation receipt remains unknown: '+label,async()=>transport(async h=>{
  const w=world(),attempt=w.begin(),done=attempt.submit();await h.ready;h.release();
  const result=await done;assert.equal(result.ok,false);assert.equal(result.outcome,'unknown');
  assert.equal(attempt.outcome,'unknown');assert.equal(h.posts.length,1)
},change))

for(const changed of [false,true])test('AUD-10 419 retry '+(changed?'refuses changed context':'retains exact command identity'),async()=>{
  const old=globalThis.fetch;__resetCsrfCacheForTests();let csrf=0,release,started;const ready=new Promise(r=>{started=r}),posts=[];
  globalThis.fetch=async(u,o={})=>{
    if(String(u).endsWith('/sanctum/csrf-cookie')){if(++csrf===2){started();await new Promise(r=>{release=r})}return new Response(null,{status:204})}
    posts.push({body:JSON.parse(o.body),key:o.headers['Idempotency-Key']});
    if(posts.length===1)return Response.json({message:'Synthetic stale CSRF'},{status:419});
    return Response.json({data:{id:AP,status:'Confirmed',revision:1,patient:{id:P},branch:{id:'b1'},service:{id:'svc1'},date:'2026-11-20',start_time:'10:00'},meta:{followup_link:{task_id:T,appointment_id:AP,status:'Booked',revision:8}}})
  };
  try{const w=world(),done=w.begin().submit();await ready;if(changed)w.auth++;release();const r=await done;
    assert.equal(posts.length,changed?1:2);if(changed)assert.equal(r.ok,false);else{assert.equal(r.outcome,'verified');assert.deepEqual(posts[0],posts[1])}
  }finally{globalThis.fetch=old;__resetCsrfCacheForTests()}
})
test('Owner unchanged service receipt preserves exact active boolean',async()=>{
  const r=await response(()=>syncBranchServiceToggle('b1','svc1',false),{branch_ref:'b1',service_ref:'svc1',active:false});assert.equal(r.ok,true)
})
for(const field of ['branch_ref','service_ref'])test('Owner service receipt rejects substituted '+field,async()=>{
  const r=await response(()=>syncBranchServiceToggle('b1','svc1',true),{branch_ref:'b1',service_ref:'svc1',active:true,[field]:'other'});assert.equal(r.ok,false)
})
test('Owner explicitly cleared pin requires a matching null pair',async()=>{
  assert.equal((await response(()=>syncBranchUpdate('b1',{branchCode:'BRC-D',latitude:'',longitude:''}),{id:'b1',branch_code:'BRC-D',latitude:null,longitude:null})).ok,true)
  assert.equal((await response(()=>syncBranchUpdate('b1',{branchCode:'BRC-D',latitude:'',longitude:''}),{id:'b1',branch_code:'BRC-D',latitude:0,longitude:0})).ok,false)
})

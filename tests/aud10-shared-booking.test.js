import test from 'node:test'
import assert from 'node:assert/strict'
import * as adapter from '../src/appointments-api.js'
import { apiBase, __resetCsrfCacheForTests } from '../src/api-client.js'
import { createAppointmentFlow } from '../src/appointment-flow.js'

const A='01ARZ3NDEKTSV4RRFFQ69G5FAW', B='01ARZ3NDEKTSV4RRFFQ69G5FAV', P='01ARZ3NDEKTSV4RRFFQ69G5FAB', AP='01ARZ3NDEKTSV4RRFFQ69G5FAA'
const selection=()=>({taskId:B,expectedRevision:7,patientPublicId:P,branchId:'b1'})
const backend=()=>({commit:adapter.SELECTED_FOLLOWUP_BACKEND_COMMIT,apiBase:apiBase()})
const form=()=>({branchId:'b1',serviceId:'svc1',date:'2026-11-20',start:'10:00',patientPublicId:P,notes:'Synthetic booking note'})
const receipt=()=>({ok:true,row:{id:AP,code:'SYNTHETIC-APT',status:'Confirmed',revision:1,date:'2026-11-20',start_time:'10:00',patient:{id:P},branch:{id:'b1'},service:{id:'svc1'}},meta:{followup_link:{task_id:B,appointment_id:AP,status:'Booked',revision:8}}})
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {resolve,promise}}
function world({send=async()=>receipt(),refresh=async()=>({ok:true})}={}){
  const session={serverUserId:'synthetic-staff',userId:'staff',role:'staff',active:true,branchId:'b1',branchScopes:['b1']}
  const state={appointments:[],persons:[{id:'person'}],users:[{id:'staff',personId:'person',role:'Staff',status:'Active',branchId:'b1',permissions:['appointments']}],staff:[{userId:'staff',personId:'person',branchId:'b1'}],followups:[{id:'legacy-task',legacyAppointment:false}]}
  const seen=[], events=[]
  const w={session,state,seen,events,live:true,refreshes:0}
  w.flow=createAppointmentFlow({getSession:()=>w.session,getState:()=>w.state,getActions:()=>({recordAppointmentEvent:(...args)=>events.push(args),linkFollowupAppointment:(...args)=>{events.push(args);return{ok:true}}}),refresh:async()=>{w.refreshes++;return refresh()},api:{createSelectedFollowupAppointment:async(f,o)=>{seen.push({form:f,options:o});return send(f,o)},createAppointment:async(f,k)=>{seen.push({form:f,key:k});return {ok:true,row:receipt().row}}}})
  w.begin=(patch={},options={})=>w.flow.beginSelectedFollowup({...form(),...patch},{selection:selection(),backend:backend(),isCurrent:()=>w.live,...options})
  return w
}
async function transport(run,respond=()=>({data:receipt().row,meta:receipt().meta})){
  const prior=globalThis.fetch, priorDocument=globalThis.document,seen=[]
  __resetCsrfCacheForTests()
  globalThis.document={cookie:'XSRF-TOKEN=synthetic-csrf'}
  globalThis.fetch=async(url,options={})=>{
    if(String(url).includes('/sanctum/csrf-cookie'))return new Response(null,{status:204})
    seen.push({url:String(url),...options,body:JSON.parse(options.body)})
    return Response.json(respond(),{status:201})
  }
  try{return await run(seen)}finally{globalThis.fetch=prior;if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument;__resetCsrfCacheForTests()}
}

test('AUD10 exact non-oldest B identity/revision survive real adapter and cookie/CSRF transport',async()=>{
  await transport(async seen=>{
    const result=await adapter.createSelectedFollowupAppointment(form(),{selection:selection(),backend:backend(),key:'aud10:stable-attempt'})
    assert.equal(result.meta.followup_link.task_id,B)
    assert.notEqual(result.meta.followup_link.task_id,A)
    assert.deepEqual(seen[0].body,{branch_ref:'b1',service_ref:'svc1',date:'2026-11-20',start_time:'10:00',patient_id:P,notes:'Synthetic booking note',followup_task_id:B,followup_expected_revision:7})
    assert.equal(seen[0].credentials,'include')
    assert.equal(seen[0].headers['Idempotency-Key'],'aud10:stable-attempt')
    assert.equal(seen[0].headers['X-XSRF-TOKEN'],'synthetic-csrf')
  })
})
for(const [name,patch] of Object.entries({null:null,empty:{},'missing task':{taskId:undefined},'internal bigint':{taskId:'123'},'missing revision':{expectedRevision:undefined},'string revision':{expectedRevision:'7'},'fraction revision':{expectedRevision:7.5},'zero revision':{expectedRevision:0},'oversize revision':{expectedRevision:2147483648},'wrong Patient':{patientPublicId:A},'wrong branch':{branchId:'b2'}})){
  test('AUD10 invalid selection sends zero commands: '+name,async()=>transport(async seen=>{
    const chosen=patch===null?null:name==='empty'?{}:{...selection(),...patch}
    const r=await adapter.createSelectedFollowupAppointment(form(),{selection:chosen,backend:backend(),key:'stable'})
    assert.equal(r.ok,false);assert.equal(seen.length,0)
  }))
}
for(const [name,target] of [['absent',undefined],['old backend',{commit:'15d626c',apiBase:apiBase()}],['wrong API base',{...backend(),apiBase:'https://example.invalid'}]]){
  test('AUD10 unverified target blocks selected POST: '+name,async()=>transport(async seen=>{
    assert.equal((await adapter.createSelectedFollowupAppointment(form(),{selection:selection(),backend:target,key:'stable'})).ok,false)
    assert.equal(seen.length,0)
  }))
}
for(const key of [null,'','two words','attempt\n','attempt\r\n','at\ttempt','clé','x'.repeat(256)]){
  test('AUD10 invalid key never reaches transport: '+JSON.stringify(key),async()=>transport(async seen=>{
    assert.equal((await adapter.createSelectedFollowupAppointment(form(),{selection:selection(),backend:backend(),key})).ok,false)
    assert.equal(seen.length,0)
  }))
}
test('AUD10 generated command key is accepted by the R2 visible-ASCII contract',()=>{
  const key=adapter.commandKey();assert.ok(key.length>=1&&key.length<=255);assert.doesNotMatch(key,/[^\x21-\x7e]/)
})
test('AUD10 ordinary result shape and fields remain unchanged and omit selected identity',async()=>transport(async seen=>{
  const result=await adapter.createAppointment(form(),'ordinary')
  assert.deepEqual(result,{ok:true,row:receipt().row})
  assert.equal('followup_task_id' in seen[0].body,false);assert.equal('followup_expected_revision' in seen[0].body,false)
}))
test('AUD10 ordinary guardian/online/pay-at-clinic choices retain existing payload behavior',async()=>transport(async seen=>{
  await adapter.createAppointment({...form(),patientPublicId:null,forPatientId:P,paymentChoice:'online'},'guardian')
  assert.equal(seen[0].body.for_patient_id,P);assert.equal(seen[0].body.pay_at_clinic,false);assert.equal('patient_id' in seen[0].body,false)
  await adapter.createAppointment({...form(),payAtClinic:true,dentistId:'d1',consultationAcknowledged:true},'staff')
  assert.equal(seen[1].body.pay_at_clinic,true);assert.equal(seen[1].body.dentist_ref,'d1');assert.equal(seen[1].body.consultation_acknowledged,true)
}))

const proofChanges={
  'missing metadata':r=>{delete r.meta},'missing proof':r=>{r.meta={}},'wrong task':r=>{r.meta.followup_link.task_id=A},
  'wrong appointment':r=>{r.meta.followup_link.appointment_id=A},'invalid appointment public ID':r=>{r.row.id='123';r.meta.followup_link.appointment_id='123'},
  'wrong status':r=>{r.meta.followup_link.status='Closed'},'string revision':r=>{r.meta.followup_link.revision='8'},
  'fraction revision':r=>{r.meta.followup_link.revision=8.1},'stale revision':r=>{r.meta.followup_link.revision=7},'unrelated later revision':r=>{r.meta.followup_link.revision=9},
  'wrong Patient':r=>{r.row.patient.id=A},'missing Patient':r=>{delete r.row.patient},'wrong branch':r=>{r.row.branch.id='b2'},
  'missing branch':r=>{delete r.row.branch},'wrong service':r=>{r.row.service.id='svc2'},'wrong time':r=>{r.row.start_time='11:00'},'wrong date':r=>{r.row.date='2026-11-21'},
}
for(const [name,change] of Object.entries(proofChanges))test('AUD10 successful HTTP with unverified proof remains unknown: '+name,async()=>{
  const raw=receipt();change(raw)
  const w=world({send:async()=>raw}),command=w.begin()
  const r=await command.submit()
  assert.equal(r.ok,false);assert.equal(r.outcome,'unknown');assert.equal(command.outcome,'unknown');assert.equal(w.refreshes,0);assert.deepEqual(w.events,[])
})
test('AUD10 exact valid proof confirms only B and returns the authoritative appointment',async()=>{
  const w=world(),command=w.begin(),r=await command.submit()
  assert.equal(r.outcome,'verified');assert.equal(r.followupLink.task_id,B);assert.equal(r.record.id,AP)
  assert.equal(w.refreshes,1);assert.deepEqual(w.events,[])
  assert.equal((await command.submit()).outcome,'settled');assert.equal(w.seen.length,1);assert.equal(w.refreshes,1)
})
test('AUD10 same-tick repeated submits dispatch once and apply success effects once',async()=>{
  const wait=deferred(),w=world({send:()=>wait.promise}),command=w.begin(),first=command.submit()
  assert.equal((await command.submit()).outcome,'submitting')
  await Promise.resolve();assert.equal(w.seen.length,1)
  wait.resolve(receipt());assert.equal((await first).outcome,'verified')
  assert.equal((await command.submit()).outcome,'settled');assert.equal(w.refreshes,1)
})
for(const kind of ['network','server','thrown','missing-proof'])test('AUD10 uncertain retry freezes original task, payload and key: '+kind,async()=>{
  let calls=0
  const w=world({send:async()=>{if(++calls===1){if(kind==='thrown')throw Error('Synthetic timeout');if(kind==='missing-proof'){const r=receipt();delete r.meta;return r}return {ok:false,kind}}return receipt()}})
  const draft=form(),selected=selection(),command=w.flow.beginSelectedFollowup(draft,{selection:selected,backend:backend(),key:'frozen-attempt',isCurrent:()=>w.live})
  assert.equal((await command.submit()).outcome,'unknown')
  draft.start='12:00';draft.notes='Changed after submission';selected.taskId=A;selected.expectedRevision=99
  assert.equal((await command.submit()).outcome,'verified')
  assert.equal(w.seen.length,2);assert.deepEqual(w.seen[0],w.seen[1]);assert.equal(w.seen[1].options.key,'frozen-attempt');assert.equal(w.seen[1].options.selection.taskId,B);assert.equal(w.seen[1].form.start,'10:00')
})
test('AUD10 response timeout preserves intent; a late success cannot change unknown state',async()=>{
  const wait=deferred(),w=world({send:()=>wait.promise}),command=w.begin({}, {timeoutMs:5})
  assert.equal((await command.submit()).outcome,'unknown')
  wait.resolve(receipt());await new Promise(r=>setTimeout(r,5))
  assert.equal(command.outcome,'unknown');assert.equal(w.refreshes,0)
})
for(const kind of ['validation','conflict','not_found','forbidden','unauthenticated','rate_limited']){
  test('AUD10 understood initial refusal is terminal without automatic replacement: '+kind,async()=>{
    const w=world({send:async()=>({ok:false,kind,code:kind==='conflict'?'followup_conflict':'synthetic_refusal',message:'Synthetic refusal'})}),command=w.begin()
    assert.equal((await command.submit()).outcome,'refused');assert.equal((await command.submit()).outcome,'settled');assert.equal(w.seen.length,1);assert.equal(w.refreshes,0)
  })
  test('AUD10 refusal after uncertainty does not prove original absence: '+kind,async()=>{
    let calls=0
    const w=world({send:async()=>({ok:false,kind:++calls===1?'network':kind})}),command=w.begin()
    assert.equal((await command.submit()).outcome,'unknown');assert.equal((await command.submit()).outcome,'unknown')
    assert.equal(w.seen.length,2);assert.equal(w.seen[0].options.key,w.seen[1].options.key)
  })
}
for(const [name,change] of Object.entries({unmount:w=>{w.live=false},account:w=>{w.session={...w.session,serverUserId:'other'}},branch:w=>{w.session={...w.session,branchId:'b2'}},scope:w=>{w.session={...w.session,branchScopes:[]}},permission:w=>{w.state.users[0].permissions=[]},role:w=>{w.session={...w.session,role:'owner'}}})){
  test('AUD10 obsolete '+name+' completion has no refresh or clinical side effects',async()=>{
    const wait=deferred(),w=world({send:()=>wait.promise}),command=w.begin(),pending=command.submit()
    await Promise.resolve();change(w);wait.resolve(receipt())
    assert.equal((await pending).outcome,'obsolete');assert.equal(w.refreshes,0);assert.deepEqual(w.events,[])
  })
}
for(const refresh of [async()=>({ok:false}),async()=>{throw Error('Synthetic list failure')}])test('AUD10 valid creation survives failed projection refresh',async()=>{
  const w=world({refresh}),r=await w.begin().submit()
  assert.equal(r.ok,true);assert.equal(r.outcome,'verified');assert.match(r.warning,/list could not be refreshed/);assert.equal(r.record.id,AP);assert.equal(w.seen.length,1)
})
test('AUD10 context invalidation during refresh suppresses adoption without cancelling creation',async()=>{
  const wait=deferred(),w=world({refresh:()=>wait.promise}),pending=w.begin().submit()
  while(!w.refreshes)await new Promise(r=>setImmediate(r))
  w.live=false;wait.resolve({ok:true})
  assert.equal((await pending).outcome,'obsolete');assert.equal(w.seen.length,1)
})
test('AUD10 selected commands cannot use Owner authority or infer a missing selection',async()=>{
  const w=world();w.session.role='owner'
  assert.equal((await w.begin().submit()).outcome,'obsolete');assert.equal(w.seen.length,0)
  const staff=world();assert.equal((await staff.begin({}, {selection:null}).submit()).outcome,'refused');assert.equal(staff.seen.length,0)
})
test('AUD10 ordinary and legacy local follow-up flows keep their existing shape and bridge',async()=>{
  const w=world()
  const ordinary=await w.flow.create(form(),{key:'ordinary'})
  assert.equal(ordinary.ok,true);assert.equal('followupLink' in ordinary,false);assert.deepEqual(w.events[0],[AP,'created'])
  await w.flow.create(form(),{key:'legacy',followupId:'legacy-task'})
  assert.deepEqual(w.events[1],['legacy-task',AP]);assert.equal(w.seen[1].key,'legacy')
})
test('AUD10 a known refused command needs an explicit new factory invocation for changed intent',async()=>{
  let calls=0;const w=world({send:async()=>++calls===1?{ok:false,kind:'validation',code:'schedule_invalid'}:receipt()})
  const first=w.begin();assert.equal((await first.submit()).outcome,'refused');assert.equal((await first.submit()).outcome,'settled')
  const next=w.begin();assert.equal((await next.submit()).outcome,'verified');assert.notEqual(w.seen[0].options.key,w.seen[1].options.key)
})

test('AUD10 same-tick context loss before dispatch sends zero selected commands',async()=>{
  const w=world(),pending=w.begin().submit()
  w.live=false
  assert.equal((await pending).outcome,'obsolete');assert.equal(w.seen.length,0)
})
test('AUD10 a timed-out request and its deliberate retry cannot adopt the first late receipt',async()=>{
  const first=deferred(),second=deferred();let calls=0
  const w=world({send:()=>++calls===1?first.promise:second.promise}),command=w.begin({}, {timeoutMs:15})
  assert.equal((await command.submit()).outcome,'unknown')
  const retry=command.submit()
  first.resolve(receipt());await Promise.resolve()
  assert.equal(command.outcome,'submitting');assert.equal(w.refreshes,0)
  second.resolve(receipt());assert.equal((await retry).outcome,'verified')
  assert.equal(w.seen.length,2);assert.equal(w.seen[0].options.key,w.seen[1].options.key);assert.equal(w.refreshes,1)
})
test('AUD10 successful proof with a selected Dentist must match that Dentist',async()=>{
  const w=world()
  assert.equal((await w.begin({dentistId:'d2'}).submit()).outcome,'unknown')
})
test('AUD10 missing ownership callback fails closed before transmission',async()=>{
  const w=world();assert.equal((await w.begin({}, {isCurrent:undefined}).submit()).outcome,'obsolete');assert.equal(w.seen.length,0)
})

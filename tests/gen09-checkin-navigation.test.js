import test from 'node:test'
import assert from 'node:assert/strict'
import { setClockSource } from '../src/clock.js'
import { checkInAppointmentFor, checkInNavigationFor, checkInSelectionFor } from '../src/checkin-navigation.js'
setClockSource(() => new Date('2026-10-29T12:00:00+08:00'))
function fixture() {
  const patient = { id: 'p1', publicId: 'public-p1', serverProjection: true }
  const appointment = { id: 'a1', server: true, patientId: 'p1', patientPublicId: 'public-p1', branchId: 'b1', revision: 7, date: '2026-10-29', status: 'Confirmed' }
  const state = { persons: [{ id: 'person' }], users: [{ id: 'user', personId: 'person', role: 'Staff', status: 'Active', branchId: 'b1', permissions: ['appointments', 'checkin'] }],
    staff: [{ userId: 'user', personId: 'person', branchId: 'b1' }], patients: [patient], branches: [{ id: 'b1' }], appointments: [appointment], visits: [] }
  return { state, session: { active: true, userId: 'user', serverUserId: 'server-user', role: 'staff', branchId: 'b1', branchScopes: ['b1'] }, getAuthGeneration: () => 1, appointmentsStatus: 'ready', appointmentsTruncated: false }
}
test('GEN-09 check-in shortcut captures exact identity and re-resolves the current row without a command', () => {
  const store = fixture(), original = store.state.appointments[0], selection = checkInNavigationFor(store, original)
  assert.ok(selection)
  assert.equal(selection.appointmentId, 'a1'); assert.equal(selection.patientPublicId, 'public-p1'); assert.equal(selection.branchId, 'b1'); assert.equal(selection.revision, 7)
  assert.equal(checkInAppointmentFor(store, selection), original)
  assert.equal(Object.hasOwn(selection, 'executionAllowed'), false)
})
for (const [name, change] of [
  ['Dentist', s => { s.session.role = 'dentist' }], ['Owner', s => { s.session.role = 'owner' }],
  ['missing server identity', s => { delete s.session.serverUserId }], ['expired generation', s => { s.getAuthGeneration = () => null }],
  ['new auth lifetime', s => { s.getAuthGeneration = () => 2 }], ['new actor', s => { s.session.serverUserId = 'replacement' }],
  ['revoked check-in permission', s => { s.state.users[0].permissions = ['appointments'] }],
  ['inactive account', s => { s.state.users[0].status = 'Inactive' }], ['revoked branch', s => { s.session.branchScopes = ['b2'] }],
  ['loading snapshot', s => { s.appointmentsStatus = 'loading' }], ['incomplete snapshot', s => { s.appointmentsTruncated = true }],
  ['changed revision', s => { s.state.appointments[0].revision++ }], ['changed patient', s => { s.state.appointments[0].patientId = 'p2' }],
  ['changed public identity', s => { s.state.appointments[0].patientPublicId = 'other' }], ['changed branch', s => { s.state.appointments[0].branchId = 'b2' }],
  ['tomorrow', s => { s.state.appointments[0].date = '2026-10-30' }], ['already arrived', s => { s.state.visits = [{ appointmentId: 'a1' }] }],
  ['same-revision state change', s => { s.state.appointments[0].status = 'Pending' }],
  ['same-revision time change', s => { s.state.appointments[0].start = '17:00' }],
  ['same-revision Dentist change', s => { s.state.appointments[0].dentistId = 'replacement' }],
  ['cancelled', s => { s.state.appointments[0].status = 'Cancelled' }], ['legacy row', s => { delete s.state.appointments[0].server }],
  ['missing canonical patient', s => { s.state.patients = [] }], ['missing revision', s => { delete s.state.appointments[0].revision }],
]) test('GEN-09 refuses stale/untrusted navigation: ' + name, () => {
  const store = fixture(), selection = checkInNavigationFor(store, store.state.appointments[0]); assert.ok(selection)
  change(store)
  assert.equal(checkInAppointmentFor(store, selection), null)
})

// Exercise the actual Visit HTTP adapter. All requests are synthetic fetch
// doubles; mutations are refused after recording their exact payload and key.
import { createAppointmentFlow } from '../src/appointment-flow.js'
import { __resetCsrfCacheForTests } from '../src/api-client.js'
async function dispatchCase(run) {
  const store=fixture(), calls=[], previous=globalThis.fetch
  const flow=createAppointmentFlow({getState:()=>store.state,getSession:()=>store.session,getAuthGeneration:()=>store.getAuthGeneration(),getActions:()=>({}),refresh:async()=>({ok:true})})
  __resetCsrfCacheForTests()
  globalThis.fetch=async(url,options={})=>{
    if(String(url).endsWith('/sanctum/csrf-cookie'))return new Response(null,{status:204})
    calls.push({path:String(url),body:JSON.parse(options.body),key:options.headers['Idempotency-Key']})
    return Response.json({message:'Synthetic command refusal'},{status:422})
  }
  try {await run({store,flow,calls,observe:()=>checkInNavigationFor(store,store.state.appointments[0])})}
  finally {globalThis.fetch=previous;__resetCsrfCacheForTests()}
}
for(const [name,change] of [
  ['revision',s=>{s.state={...s.state,appointments:[{...s.state.appointments[0],revision:8}]}}],
  ['patient',s=>{s.state.appointments[0]={...s.state.appointments[0],patientId:'replacement'}}],
  ['public identity',s=>{s.state.appointments[0]={...s.state.appointments[0],patientPublicId:'replacement'}}],
  ['branch',s=>{s.state.appointments[0]={...s.state.appointments[0],branchId:'b2'}}],
  ['status',s=>{s.state.appointments[0]={...s.state.appointments[0],status:'Cancelled'}}],
  ['date',s=>{s.state.appointments[0]={...s.state.appointments[0],date:'2026-10-30'}}],
  ['time',s=>{s.state.appointments[0]={...s.state.appointments[0],start:'17:00'}}],
  ['Dentist',s=>{s.state.appointments[0]={...s.state.appointments[0],dentistId:'replacement'}}],
  ['service',s=>{s.state.appointments[0]={...s.state.appointments[0],serviceId:'replacement'}}],
  ['permissions',s=>{s.state.users[0].permissions=['appointments']}],
  ['branch permission',s=>{s.session.branchScopes=['b2']}],
  ['inactive account',s=>{s.state.users[0].status='Inactive'}],
  ['auth lifetime',s=>{s.getAuthGeneration=()=>2}],
  ['expired auth',s=>{s.getAuthGeneration=()=>null}],
  ['actor',s=>{s.session={...s.session,serverUserId:'replacement'}}],
  ['existing Visit',s=>{s.state.visits=[{appointmentId:'a1'}]}],
]) test('GEN-09 dispatch refuses unseen '+name+' changes before a React render',()=>dispatchCase(async({store,flow,calls,observe})=>{
  const observed=observe();assert.ok(observed);change(store)
  const result=await flow.checkIn(observed.appointmentId,'same-arrival-key',observed)
  assert.equal(result.ok,false);assert.equal(result.kind,'stale_context');assert.match(result.message,/refresh|review/i);assert.deepEqual(calls,[])
}))
test('GEN-09 dispatch uses the reviewed revision and retains exact body/key on retry',()=>dispatchCase(async({flow,calls,observe})=>{
  const observed=observe();assert.ok(Object.isFrozen(observed))
  await flow.checkIn(observed.appointmentId,'same-arrival-key',observed)
  await flow.checkIn(observed.appointmentId,'same-arrival-key',observed)
  assert.equal(calls.length,2)
  for(const c of calls){assert.ok(c.path.endsWith('/api/visits/check-in'));assert.deepEqual(c.body,{appointment_id:'a1',expected_revision:7});assert.equal(c.key,'same-arrival-key')}
}))
test('GEN-09 dispatch accepts revision 8 only after an explicit new review',()=>dispatchCase(async({store,flow,calls,observe})=>{
  const original=observe();store.state.appointments[0]={...store.state.appointments[0],revision:8}
  await flow.checkIn('a1','old-key',original);assert.deepEqual(calls,[])
  const reviewed=observe();assert.equal(reviewed.revision,8)
  await flow.checkIn('a1','new-key',reviewed);assert.equal(calls.length,1);assert.equal(calls[0].body.expected_revision,8)
}))
test('GEN-09 authenticated flow requires a reviewed snapshot and exact appointment binding',()=>dispatchCase(async({flow,calls,observe})=>{
  assert.equal((await flow.checkIn('a1','key')).ok,false)
  assert.equal((await flow.checkIn('other','key',observe())).ok,false)
  assert.deepEqual(calls,[])
}))
for(const change of ['revision','permissions','auth'])test('GEN-09 dispatch rechecks '+change+' after pending CSRF preparation',async()=>{
  const store=fixture(),observed=checkInNavigationFor(store,store.state.appointments[0]),calls=[],previous=globalThis.fetch
  let release,started;const waiting=new Promise(r=>{release=r}),began=new Promise(r=>{started=r})
  __resetCsrfCacheForTests()
  globalThis.fetch=async(url,options={})=>{
    if(String(url).endsWith('/sanctum/csrf-cookie')){started();await waiting;return new Response(null,{status:204})}
    calls.push(JSON.parse(options.body));return Response.json({message:'Synthetic refusal'},{status:422})
  }
  try{
    const flow=createAppointmentFlow({getState:()=>store.state,getSession:()=>store.session,getAuthGeneration:()=>store.getAuthGeneration(),getActions:()=>({}),refresh:async()=>({ok:true})})
    const task=flow.checkIn('a1','key',observed);await began
    if(change==='revision')store.state.appointments[0]={...store.state.appointments[0],revision:8}
    if(change==='permissions')store.state.users[0].permissions=['appointments']
    if(change==='auth')store.getAuthGeneration=()=>2
    release();const result=await task;assert.equal(result.kind,'stale_context');assert.deepEqual(calls,[])
  }finally{release();globalThis.fetch=previous;__resetCsrfCacheForTests()}
})
test('GEN-09 dispatch cannot resend an old confirmation after a 419 and new revision',async()=>{
  const store=fixture(),observed=checkInNavigationFor(store,store.state.appointments[0]),calls=[],previous=globalThis.fetch
  let csrf=0;__resetCsrfCacheForTests()
  globalThis.fetch=async(url,options={})=>{
    if(String(url).endsWith('/sanctum/csrf-cookie')){if(++csrf===2)store.state.appointments[0]={...store.state.appointments[0],revision:8};return new Response(null,{status:204})}
    calls.push({body:JSON.parse(options.body),key:options.headers['Idempotency-Key']});return Response.json({message:'Synthetic CSRF expiry'},{status:419})
  }
  try{
    const flow=createAppointmentFlow({getState:()=>store.state,getSession:()=>store.session,getAuthGeneration:()=>store.getAuthGeneration(),getActions:()=>({}),refresh:async()=>({ok:true})})
    const result=await flow.checkIn('a1','same-key',observed)
    assert.equal(result.kind,'stale_context');assert.equal(calls.length,1);assert.deepEqual(calls[0],{body:{appointment_id:'a1',expected_revision:7},key:'same-key'})
  }finally{globalThis.fetch=previous;__resetCsrfCacheForTests()}
})

test('GEN-09 ordinary Check-In retains Staff with Check-In permission only',()=>dispatchCase(async({store,flow,calls})=>{
  store.state.users[0].permissions=['checkin']
  assert.equal(checkInNavigationFor(store,store.state.appointments[0]),null,'Appointments shortcut still requires its source permission')
  const reviewed=checkInSelectionFor(store,store.state.appointments[0]);assert.ok(reviewed)
  await flow.checkIn('a1','ordinary-arrival',reviewed);assert.equal(calls.length,1);assert.deepEqual(calls[0].body,{appointment_id:'a1',expected_revision:7})
}))
test('GEN-09 a newer review cannot adopt an older out-of-order projection',()=>dispatchCase(async({store,flow,calls,observe})=>{
  store.state.appointments[0]={...store.state.appointments[0],revision:8};const newer=observe()
  store.state.appointments[0]={...store.state.appointments[0],revision:7}
  assert.equal((await flow.checkIn('a1','newer-review',newer)).kind,'stale_context');assert.deepEqual(calls,[])
}))

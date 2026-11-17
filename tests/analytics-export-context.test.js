import test from 'node:test'
import assert from 'node:assert/strict'
import {variableValue} from './support/source-behavior.js'
const file='src/pages/Admin.jsx',scope='AnalyticsPage'
const allowed = overrides => {
  const inputs = {
    isServerSession: true, store: { session: { role: 'owner', active: true }, getAuthGeneration: () => 1 },
    exportAuth: 1, activeBranch: 'Branch B', activeBranchId: 'b2', reportDenied: false, rangeDirty: false, ...overrides,
  }
  const ownerSession = variableValue(file, 'ownerSession', inputs, scope)
  const validBranch = variableValue(file, 'validBranch', inputs, scope)
  return variableValue(file, 'canExport', { reportScope: { enabled: ownerSession && validBranch },
    reportDenied: inputs.reportDenied, rangeDirty: inputs.rangeDirty }, scope)
}
function harness(request=async()=>({blob:'synthetic',filename:'scope.csv'})) {
  const events=[],downloads=[],notices=[],busy=[],exportContext={current:'original'},exportMounted={current:true},exportPending={current:null}
  let auth=1
  const bindings={AbortController,Error,canExport:true,exportKey:'original',exportAuth:1,exportContext,exportMounted,exportPending,period:'This Week',activeBranch:'Branch B',activeBranchId:'b2',store:{session:{serverUserId:'owner'},getAuthGeneration:()=>auth},requestAnalyticsCsv:request,saveClinicCsv:r=>downloads.push(r),me:async()=>({ok:true,data:{id:'owner',role:'owner',account_status:'Active'}}),toast:(...args)=>events.push(args),setExporting:v=>busy.push(v),setExportNotice:v=>notices.push(v)}
  Object.assign(bindings, { reportDeniedRef: { current: false }, reportPeriod: 'this week', dateFrom: undefined, dateTo: undefined })
  const retryable = []
  bindings.setExportRetryable = value => retryable.push(value)
  const filenames = []
  bindings.setExportFilename = value => filenames.push(value)
  return {events,downloads,busy,notices,retryable,filenames,bindings,exportContext,exportMounted,exportPending,revoke:()=>auth++,run:()=>variableValue(file,'exportServerCsv',bindings,scope)(),cancel:()=>variableValue(file,'cancelAnalyticsExport',bindings,scope)()}
}
test('CSV requires a live Owner and an explicit all-branch or resolved branch context',()=>{
  assert.equal(allowed(),true)
  assert.equal(allowed({rangeDirty:true}),false)
  assert.equal(allowed({activeBranch:'All Branches',activeBranchId:null}),true)
  for(const overrides of [{activeBranchId:null},{isServerSession:false},{exportAuth:null},{reportDenied:true},{store:{session:{role:'staff',active:true}}},{store:{session:{role:'owner',active:false}}}])assert.equal(allowed(overrides),false)
})
test('invalid context dispatches nothing; duplicate intent dispatches once and uses chosen branch and period',async()=>{
  let release,calls=0,params
  const h=harness(async p=>{calls++;params=p;await new Promise(r=>release=r);return {filename:'scope.csv'}})
  h.bindings.canExport=false;await h.run();assert.equal(calls,0)
  h.bindings.canExport=true;const pending=h.run();await h.run();assert.equal(calls,1)
  assert.equal(params.branch_id,'b2');assert.equal(params.period,'this week')
  assert.equal(params.include_daily,1)
  release();await pending;assert.equal(h.events.length,1);assert.equal(h.exportPending.current,null);assert.equal(h.downloads.length,1)
  assert.deepEqual(h.filenames, ['', 'scope.csv'])
})
test('branch/account/period/auth/unmount invalidation refuses a delayed payload and suppresses success',async()=>{
  for(const invalidate of [h=>h.exportContext.current='changed branch/account/period',h=>h.revoke(),h=>h.exportMounted.current=false,h=>h.bindings.reportDeniedRef.current=true]){
    let release
    const h=harness(async()=>{await new Promise(r=>release=r);return {filename:'scope.csv'}})
    const pending=h.run();invalidate(h);release();await pending
    assert.equal(h.downloads.length,0);assert.deepEqual(h.events,[])
  }
})
test('delayed failures are silent after context changes and a current failure remains retryable',async()=>{
  let release
  const h=harness(async()=>{await new Promise(r=>release=r);throw Error('Synthetic refusal')})
  let pending=h.run();h.exportContext.current='changed';release();await pending;assert.deepEqual(h.events,[])
  h.exportContext.current='original';pending=h.run();release();await pending
  assert.deepEqual(h.events,[['Synthetic refusal','warning']]);assert.equal(h.exportPending.current,null)
})
test('explicit All Branches is serialized; an absent named branch never becomes all',async()=>{
  let params;const h=harness(async p=>{params=p;return {filename:'all.csv'}})
  h.bindings.activeBranch='All Branches';h.bindings.activeBranchId=null;await h.run();assert.equal(params.branch_id,'all')
  h.bindings.activeBranch='Missing branch';h.bindings.canExport=false;params=null;await h.run();assert.equal(params,null)
})
test('download recovery offers retry for transient failures and stops for authorization or validation failures', async () => {
  for (const [status, expected] of [[503, true], [429, true], [undefined, true], [403, false], [422, false]]) {
    const h = harness(async () => { throw Object.assign(new Error('Synthetic failure'), { status }) })
    await h.run()
    assert.equal(h.retryable.at(-1), expected)
    assert.equal(h.downloads.length, 0)
  }
})
test('cancelled late request cannot clear or download a replacement with the same selection',async()=>{
  const held=[];const h=harness((p,{signal})=>new Promise(resolve=>held.push({resolve,signal})))
  const old=h.run();h.cancel();assert.equal(held[0].signal.aborted,true);assert.equal(h.busy.at(-1),false)
  const replacement=h.run(),ticket=h.exportPending.current;assert.equal(h.busy.at(-1),true)
  held[0].resolve({filename:'old.csv'});await old
  assert.equal(h.exportPending.current,ticket);assert.equal(h.busy.at(-1),true);assert.equal(h.downloads.length,0)
  held[1].resolve({filename:'current.csv'});await replacement
  assert.equal(h.downloads[0].filename,'current.csv');assert.equal(h.events.length,1);assert.equal(h.busy.at(-1),false)
})
test('fresh identity must confirm the same Active Owner; uncertainty never releases a file',async()=>{
  for(const identity of [{ok:false,kind:'network'},{ok:false,kind:'unauthenticated'},{ok:true,data:{id:'other',role:'owner',account_status:'Active'}},{ok:true,data:{id:'owner',role:'staff',account_status:'Active'}},{ok:true,data:{id:'owner',role:'owner',account_status:'Inactive'}}]){
    const h=harness();h.bindings.me=async()=>identity;await h.run()
    assert.equal(h.downloads.length,0);assert.equal(h.events.length,1);assert.match(h.events[0][0],/Owner authority could not be confirmed/)
  }
})
test('cancel during delayed server authorization prevents save even when its response arrives late',async()=>{
  let release;const h=harness();h.bindings.me=()=>new Promise(r=>release=r)
  const pending=h.run();await new Promise(r=>setImmediate(r));h.cancel()
  release({ok:true,data:{id:'owner',role:'owner',account_status:'Active'}});await pending
  assert.equal(h.downloads.length,0);assert.deepEqual(h.events,[])
})

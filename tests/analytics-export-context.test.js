import test from 'node:test'
import assert from 'node:assert/strict'
import {variableValue} from './support/source-behavior.js'

const file='src/pages/Admin.jsx',scope='AnalyticsPage'
const allowed=overrides=>variableValue(file,'canExport',{
  isServerSession:true,store:{session:{role:'owner',active:true},getAuthGeneration:()=>1},exportAuth:1,activeBranch:'Branch B',activeBranchId:'b2',...overrides,
},scope)
function harness(download) {
  const events=[],exportContext={current:'original'},exportMounted={current:true},exportPending={current:false}
  let auth=1
  const bindings={canExport:true,exportKey:'original',exportAuth:1,exportContext,exportMounted,exportPending,period:'This Week',activeBranchId:'b2',store:{getAuthGeneration:()=>auth},downloadAnalyticsCsv:download,toast:(...args)=>events.push(args),setExporting:()=>{}}
  return {events,bindings,exportContext,exportMounted,exportPending,revoke:()=>auth++,run:()=>variableValue(file,'exportServerCsv',bindings,scope)()}
}
test('CSV requires a live Owner and an explicit all-branch or resolved branch context',()=>{
  assert.equal(allowed(),true)
  assert.equal(allowed({activeBranch:'All Branches',activeBranchId:null}),true)
  for(const overrides of [{activeBranchId:null},{isServerSession:false},{exportAuth:null},{store:{session:{role:'staff',active:true}}},{store:{session:{role:'owner',active:false}}}])assert.equal(allowed(overrides),false)
})
test('invalid context dispatches nothing; duplicate intent dispatches once and uses the chosen branch and period',async()=>{
  let release,calls=0,params
  const h=harness(async(p,current)=>{calls++;params=p;await new Promise(r=>release=r);return current()})
  h.bindings.canExport=false;await h.run();assert.equal(calls,0)
  h.bindings.canExport=true;const pending=h.run();await h.run();assert.equal(calls,1)
  assert.equal(params.branch_id,'b2');assert.equal(params.period,'this week')
  release();await pending;assert.equal(h.events.length,1);assert.equal(h.exportPending.current,false)
})
test('the transport callback rejects stale branch/account/period/auth/unmount contexts and suppresses success',async()=>{
  for(const invalidate of [h=>h.exportContext.current='changed branch/account/period',h=>h.revoke(),h=>h.exportMounted.current=false]){
    let release,downloads=0
    const h=harness(async(p,current)=>{await new Promise(r=>release=r);if(!current())return false;downloads++;return true})
    const pending=h.run();invalidate(h);release();await pending
    assert.equal(downloads,0);assert.deepEqual(h.events,[])
  }
})
test('delayed failures are silent after context changes and a current failure remains retryable',async()=>{
  let release
  const h=harness(async()=>{await new Promise(r=>release=r);throw Error('Synthetic refusal')})
  let pending=h.run();h.exportContext.current='changed';release();await pending;assert.deepEqual(h.events,[])
  h.exportContext.current='original';pending=h.run();release();await pending
  assert.deepEqual(h.events,[['Synthetic refusal','warning']]);assert.equal(h.exportPending.current,false)
})

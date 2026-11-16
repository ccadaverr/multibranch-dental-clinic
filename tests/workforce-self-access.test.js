import test from 'node:test'
import assert from 'node:assert/strict'
import {productionExpression} from './support/source-behavior.js'
import {fetchReferenceData} from '../src/reference-data-bridge.js'
const readProfiles=productionExpression('src/pages/Staffing.jsx',n=>n.type==='FunctionDeclaration'&&n.id?.name==='staffScheduleProfiles')
const profiles=(...args)=>Array.from(readProfiles(...args))
const session={serverUserId:'account',active:true,role:'staff',branchScopes:['b2']}
const self={id:'self',branch:{id:'b1'},can_request_roster:true}
const data={staff:[],self_staff:self,staff_roster_publication_available:true}
test('an exact self request remains reachable when assignment differs from branch access',()=>{
  assert.deepEqual(profiles(data,session,'staff').map(r=>r.id),['self'])
  const peer={id:'peer',branch:{id:'b2'}}
  assert.deepEqual(profiles({...data,staff:[peer]},session,'staff').map(r=>r.id),['self','peer'])
  assert.deepEqual(profiles({...data,staff:[{...self,branch:{id:'b2'}}]},session,'staff').map(r=>r.id),['self'])
})
test('self navigation cannot create scope, turn a peer into self or bypass role/session guards',()=>{
  assert.deepEqual(profiles(data,{...session,branchScopes:[]},'staff'),[])
  assert.deepEqual(profiles({...data,self_staff:{...self,can_request_roster:false}},session,'staff'),[])
  assert.deepEqual(profiles({...data,staff_roster_publication_available:false},session,'staff'),[])
  assert.deepEqual(profiles(data,{...session,active:false},'staff'),[])
  assert.deepEqual(profiles(data,{...session,role:'patient'},'staff'),[])
  assert.deepEqual(profiles({staff:[self]},session,'staff'),[],'assignment still does not grant branch authority')
})

test('bootstrap retains exact self identity separately from the scoped directory, without duplicate or Patient calls',async t=>{
  const saved=globalThis.fetch;t.after(()=>{globalThis.fetch=saved})
  const own={id:'s-self',userId:'user-self',personId:'per-s-self',branchId:'b1',title:'Staff'}
  let rows=[],calls=[]
  globalThis.fetch=async url=>{
    calls.push(url)
    const path=new URL(url,'http://localhost').pathname
    return new Response(JSON.stringify(path==='/api/staff'?{data:rows,meta:{self_staff:own}}:{data:[]}),{headers:{'Content-Type':'application/json'}})
  }
  let r=await fetchReferenceData('staff');assert.equal(r.ok,true);assert.deepEqual(r.data.staff.map(s=>s.id),['s-self']);assert.equal(r.data.staff[0].branchId,'b1')
  rows=[own];r=await fetchReferenceData('staff');assert.equal(r.data.staff.length,1)
  rows=[];r=await fetchReferenceData('owner');assert.deepEqual(r.data.staff,[])
  calls=[];r=await fetchReferenceData('patient');assert.deepEqual(r.data.staff,[]);assert.ok(!calls.some(url=>url.endsWith('/api/staff')))
})

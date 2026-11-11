import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthenticationOwner } from '../src/login-lifecycle.js'

const fixture=()=>{
  let generation=null
  const owner=createAuthenticationOwner(()=>generation)
  return {owner, generation:value=>{generation=value}}
}
test('signed-out requests can start only inside the mounted App lifetime',()=>{
  const {owner}=fixture()
  assert.equal(owner.begin(),null)
  owner.activate();const ticket=owner.begin();assert.equal(owner.current(ticket),true)
  owner.dispose();assert.equal(owner.current(ticket),false);assert.equal(owner.begin(),null)
})
test('newer login/bootstrap owns completion even when responses settle out of order',()=>{
  const {owner}=fixture();owner.activate()
  const first=owner.begin(),second=owner.begin()
  assert.equal(owner.current(first),false);assert.equal(owner.current(second),true)
  assert.equal(owner.current(first),false,'older success cannot revive after newer failure')
})
test('form disposal blocks adoption before bridge, redirect or logout side effects',()=>{
  const {owner}=fixture();owner.activate();let formLive=true
  const ticket=owner.begin(()=>formLive);formLive=false
  assert.equal(owner.current(ticket),false)
  assert.equal(owner.begin(()=>false),null,'obsolete callers do not dispatch')
})
test('StrictMode effect replay does not revive the first setup request',()=>{
  const {owner}=fixture();owner.activate();const first=owner.begin()
  owner.dispose();owner.activate();assert.equal(owner.current(first),false)
  const second=owner.begin();assert.equal(owner.current(second),true)
})
test('new authenticated context makes a pending signed-out login obsolete',()=>{
  const {owner,generation}=fixture();owner.activate();const ticket=owner.begin()
  generation(4);assert.equal(owner.current(ticket),false)
})
test('permission generations cannot return to an earlier authenticated lifetime',()=>{
  const {owner,generation}=fixture();owner.activate();generation(4);const first=owner.begin()
  generation(5);assert.equal(owner.current(first),false)
  generation(6);assert.equal(owner.current(first),false)
})
test('explicit sign-out invalidates a ticket even if observed generation returns to null',()=>{
  const {owner,generation}=fixture();owner.activate();const old=owner.begin()
  generation(1);owner.invalidate();generation(null)
  assert.equal(owner.current(old),false)
  assert.equal(owner.current(owner.begin()),true,'new legitimate login remains possible')
})
test('session revalidation survives its own clinical invalidation but not a new account',()=>{
  const {owner,generation}=fixture();owner.activate();generation(4)
  let serverUser='A'
  const ticket=owner.begin(()=>true,()=>serverUser)
  generation(null);assert.equal(owner.current(ticket),true)
  serverUser='B';assert.equal(owner.current(ticket),false)
})
test('revalidation/logout cannot clear a newer login, including the same account',()=>{
  const {owner}=fixture();owner.activate()
  const old=owner.begin(()=>true,()=>'A'),fresh=owner.begin()
  assert.equal(owner.current(old),false);assert.equal(owner.current(fresh),true)
})
test('tickets from another App never gain ownership',()=>{
  const a=fixture().owner,b=fixture().owner;a.activate();b.activate()
  assert.equal(b.current(a.begin()),false);assert.equal(b.current(null),false)
})

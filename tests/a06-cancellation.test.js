import test from 'node:test'
import assert from 'node:assert/strict'
import {createAppointmentFlow} from '../src/appointment-flow.js'
import {cancelAppointment} from '../src/appointments-api.js'
import {__resetCsrfCacheForTests} from '../src/api-client.js'
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
function world(options={}){
 const state={users:[],persons:[],staff:[],appointments:[]},session={serverUserId:'actor',userId:'staff',role:'staff',active:true,branchScopes:['b1']}
 const w={auth:1,applied:0,refreshed:0,session}
 w.flow=createAppointmentFlow({getState:()=>state,getSession:()=>session,getAuthGeneration:()=>w.auth,getActions:()=>({applyAppointmentCancellation:()=>{w.applied++;return {ok:true}}}),refresh:async()=>{w.refreshed++;return {ok:true}},api:{cancelAppointment:async()=>({ok:true,row:{id:'a1',status:'Cancelled'}})},...options})
 return w
}
test('cancellation rejects an unrelated successful receipt before refresh or local follow-up mutation',async()=>{
 const w=world({api:{cancelAppointment:async()=>({ok:true,row:{id:'other',status:'Cancelled'}})}})
 assert.equal((await w.flow.cancel({id:'a1',revision:1},'key')).kind,'unverified');assert.equal(w.applied,0);assert.equal(w.refreshed,0)
})
test('cancellation response from an earlier auth epoch cannot update current local records',async()=>{
 const held=deferred(),w=world({api:{cancelAppointment:()=>held.promise}}),work=w.flow.cancel({id:'a1',revision:1},'key')
 w.auth++;held.resolve({ok:true,row:{id:'a1',status:'Cancelled'}})
 assert.equal((await work).kind,'superseded');assert.equal(w.applied,0);assert.equal(w.refreshed,0)
})
test('verified cancellation survives failed projection refresh without fabricating local follow-up changes',async()=>{
 const w=world({refresh:async()=>{throw Error('Synthetic refresh failure')}}),r=await w.flow.cancel({id:'a1',revision:1},'key')
 assert.equal(r.ok,true);assert.match(r.warning,/Cancellation verified/);assert.equal(w.applied,0)
})
test('real cancellation adapter checks ownership after CSRF and keeps guards out of the request body',async()=>{
 const original=globalThis.fetch,held=deferred(),calls=[];let current=true
 __resetCsrfCacheForTests()
 globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});if(String(url).includes('/sanctum/')){await held.promise;return new Response(null,{status:204})}return new Response(JSON.stringify({data:{id:'a1',status:'Cancelled'}}),{status:200,headers:{'Content-Type':'application/json'}})}
 try{
  const pending=cancelAppointment({id:'a1',revision:3},'same-key',{reason:'Synthetic reason',beforeDispatch:()=>current})
  current=false;held.resolve();assert.equal((await pending).ok,false);assert.equal(calls.filter(c=>c.url.includes('/cancel')).length,0)
  current=true;await cancelAppointment({id:'a1',revision:3},'same-key',{reason:'Synthetic reason',beforeDispatch:()=>current})
  const sent=calls.find(c=>c.url.includes('/cancel'));assert.deepEqual(JSON.parse(sent.options.body),{expected_revision:3,reason:'Synthetic reason'});assert.equal(sent.options.headers['Idempotency-Key'],'same-key')
 }finally{globalThis.fetch=original;__resetCsrfCacheForTests()}
})

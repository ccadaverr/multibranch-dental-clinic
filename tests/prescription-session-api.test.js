import test from 'node:test'
import assert from 'node:assert/strict'
import * as api from '../src/api-client.js'
const response=(status,data={})=>({ok:status<300,status,json:async()=>data})
test('clinical intent carries captured session context, exact revision and idempotency key',async()=>{
 api.__resetCsrfCacheForTests();globalThis.document={cookie:'XSRF-TOKEN=synthetic'}
 const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return response(200,{data:{}})}
 await api.issuePrescription('rx',7,'synthetic-key',()=>true,'synthetic-context')
 const sent=calls.at(-1).options
 assert.equal(sent.headers['X-Clinical-Context'],'synthetic-context');assert.equal(sent.headers['Idempotency-Key'],'synthetic-key')
 assert.deepEqual(JSON.parse(sent.body),{expected_revision:7})
})
test('authorization is rechecked after asynchronous CSRF preparation and before a 419 retry',async()=>{
 api.__resetCsrfCacheForTests();let release;let allowed=true;let writes=0
 globalThis.fetch=async url=>url.includes('/sanctum/')?new Promise(r=>{release=()=>r(response(204))}):(writes++,response(200))
 const pending=api.issuePrescription('rx',1,'k',()=>allowed,'context');allowed=false;release();await pending;assert.equal(writes,0)
 api.__resetCsrfCacheForTests();allowed=true
 globalThis.fetch=async url=>{if(url.includes('/sanctum/'))return response(204);writes++;allowed=false;return response(419)}
 await api.issuePrescription('rx',1,'k',()=>allowed,'context');assert.equal(writes,1)
})

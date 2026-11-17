import test from 'node:test'
import assert from 'node:assert/strict'
import {downloadBillingPdf} from '../src/api-client.js'
const headers={'Content-Type':'application/pdf','X-Invoice-Id':'invoice-A','X-Patient-Id':'patient-A','X-Receipt-Id':'receipt-A'}
test('receipt PDF verifies exact invoice, Patient and receipt before consuming or saving the body',async()=>{
 let blobs=0,clicks=0;globalThis.document={createElement:()=>({click(){clicks++},remove(){}}),body:{appendChild(){}}}
 for(const [field,value] of [['X-Invoice-Id','other'],['X-Patient-Id','other'],['X-Receipt-Id','other'],['Content-Type','text/html']]){
  globalThis.fetch=async()=>({ok:true,headers:new Headers({...headers,[field]:value}),blob:async()=>{blobs++;return new Blob(['%PDF'])}})
  const r=await downloadBillingPdf('invoice-A','receipt',{patientId:'patient-A',receiptId:'receipt-A'});assert.equal(r.ok,false);assert.equal(r.kind,'unverified')
 }
 assert.equal(blobs,0);assert.equal(clicks,0)
 globalThis.fetch=async()=>({ok:true,headers:new Headers(headers),blob:async()=>{blobs++;return new Blob(['%PDF'])}})
 assert.equal((await downloadBillingPdf('invoice-A','receipt',{patientId:'patient-A',receiptId:'receipt-A'})).ok,true);assert.equal(blobs,1);assert.equal(clicks,1)
})
test('session/navigation changes during download suppress file adoption',async()=>{
 let current=true,blobs=0;globalThis.fetch=async()=>{current=false;return {ok:true,headers:new Headers(headers),blob:async()=>{blobs++}}}
 const r=await downloadBillingPdf('invoice-A','receipt',{patientId:'patient-A',receiptId:'receipt-A',isCurrent:()=>current});assert.equal(r.kind,'stale_context');assert.equal(blobs,0)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {readPatientDocuments,readPatientConsents,documentUploadIntent,fileSha256} from '../src/patient/document-workflow.js'
const doc=(id='d1')=>({id,patient:{id:'p1',name:'Synthetic Patient',code:'PAT-1'},status:'Active',category:'referral',title:'Synthetic referral',original_filename:'referral.pdf',mime_type:'application/pdf',file_size_bytes:10,checksum_sha256:'a'.repeat(64),created_at:'2026-11-17T09:00:00+08:00',branch:null,visit_id:null,uploaded_by:{role:'patient'}})
const consent={id:'c1',patient_id:'p1',consent_type:'general_treatment',version:'1',status:'Granted',signed_at:'2026-11-17T09:00:00+08:00',withdrawn_at:null,document_id:'d1',notes:'Synthetic test only'}
test('document library reads beyond 100 with exact Patient and last-record cursors',async()=>{
 const calls=[];const r=await readPatientDocuments(async args=>{calls.push(args);return {ok:true,data:[doc(args.cursor?'last':'first')],meta:{patient_id:'p1',next_cursor:args.cursor?null:'first'}}},'p1',()=>true)
 assert.equal(r.ok,true);assert.deepEqual(r.data.map(d=>d.id),['first','last']);assert.deepEqual(calls,[{per_page:100},{per_page:100,cursor:'first'}])
})
test('partial, repeating, malformed and foreign document lists never become an adopted library',async()=>{
 for(const result of [
  {ok:true,data:[{...doc(),patient:{id:'dependent'}}],meta:{patient_id:'p1',next_cursor:null}},
  {ok:true,data:[doc()],meta:{patient_id:'foreign',next_cursor:null}},
  {ok:true,data:[doc(),doc()],meta:{patient_id:'p1',next_cursor:null}},
  {ok:true,data:[{...doc(),checksum_sha256:'bad'}],meta:{patient_id:'p1',next_cursor:null}},
  {ok:true,data:[doc()],meta:{patient_id:'p1',next_cursor:'wrong'}},
  {ok:true,data:[doc()],meta:{patient_id:'p1'}},
 ])assert.equal((await readPatientDocuments(async()=>result,'p1',()=>true)).ok,false)
 const r=await readPatientDocuments(async args=>args.cursor?{ok:false,message:'later page unavailable'}:{ok:true,data:[doc()],meta:{patient_id:'p1',next_cursor:'d1'}},'p1',()=>true);assert.equal(r.ok,false);assert.equal(r.data,undefined)
})
test('consent history retains Granted and Withdrawn, refuses foreign and malformed evidence',async()=>{
 const withdrawn={...consent,id:'c2',status:'Withdrawn',withdrawn_at:'2026-11-17T09:10:00+08:00'}
 assert.deepEqual((await readPatientConsents(async()=>({ok:true,data:[consent,withdrawn]}),'p1',()=>true)).data,[consent,withdrawn])
 for(const row of [{...consent,patient_id:'dependent'},{...withdrawn,withdrawn_at:null},{...consent,status:'Pending'}])assert.equal((await readPatientConsents(async()=>({ok:true,data:[row]}),'p1',()=>true)).ok,false)
})
test('document and consent reads bound hangs and prevent stale subsequent dispatch',async()=>{
 assert.equal((await readPatientConsents(()=>new Promise(()=>{}),'p1',()=>true,5)).ok,false)
 let current=true,release,calls=0
 const pending=readPatientDocuments(()=>{calls++;return new Promise(r=>release=r)},'p1',()=>current)
 while(!release)await new Promise(r=>setImmediate(r))
 current=false;release({ok:true,data:[doc()],meta:{patient_id:'p1',next_cursor:'d1'}})
 assert.equal((await pending).ok,false);assert.equal(calls,1)
})
test('upload freezes file, title, Patient and key, suppresses duplicates and retries the committed response',async()=>{
 const file=new Blob(['1234567890'],{type:'application/pdf'}),checksum=await fileSha256(file),responses=[]
 let resolve;const intent=documentUploadIntent({file,title:'Synthetic referral',category:'referral',checksum,patientId:'p1',key:'same-key',owns:()=>true})
 const upload=async(body,key,owns)=>{assert.equal(owns(),true);responses.push({key,title:body.get('title'),category:body.get('category'),bytes:await body.get('file').text()});return responses.length===1?new Promise(r=>resolve=r):{ok:true,data:{...doc(),checksum_sha256:checksum}}}
 const first=intent.run(upload);while(!resolve)await new Promise(r=>setImmediate(r))
 assert.equal((await intent.run(upload)).duplicate,true);resolve({ok:false,kind:'network'});assert.equal((await first).ok,false)
 assert.equal((await intent.run(upload)).verified,true);assert.deepEqual(responses[0],responses[1]);assert.equal((await intent.run(upload)).duplicate,true)
})
test('upload refuses wrong response linkage/content and ignores completion after ownership changes',async()=>{
 const file=new Blob(['1234567890']),opts={file,title:'Synthetic referral',category:'referral',checksum:'a'.repeat(64),patientId:'p1',key:'k',owns:()=>true}
 for(const change of [{patient:{id:'foreign'}},{id:'d2',checksum_sha256:'b'.repeat(64)},{category:'valid_id'},{title:'different'}])assert.equal((await documentUploadIntent(opts).run(async()=>({ok:true,data:{...doc(),...change}}))).verified,undefined)
 assert.equal((await documentUploadIntent(opts).run(async()=>({ok:false,kind:'validation'}))).refused,true)
 let current=true,release;const intent=documentUploadIntent({...opts,owns:()=>current}),pending=intent.run(()=>new Promise(r=>release=r));await Promise.resolve();current=false;release({ok:true,data:doc()});assert.equal((await pending).obsolete,true)
})
test('document write dispatch is cancelled if the Patient context changes while CSRF is preparing',async()=>{
 const api=await import('../src/api-client.js'),savedFetch=globalThis.fetch,savedDocument=globalThis.document
 let release,current=true,posts=0
 try{
  api.__resetCsrfCacheForTests();globalThis.document={cookie:'XSRF-TOKEN=synthetic'}
  globalThis.fetch=async(url,options={})=>{if(String(url).endsWith('/sanctum/csrf-cookie'))return new Promise(r=>release=r);if(options.method==='POST')posts++;return {ok:true,status:201,json:async()=>({})}}
  const pending=api.uploadDocument(new FormData(),'j03-context-key',()=>current)
  while(!release)await new Promise(r=>setImmediate(r))
  current=false;release({ok:true,status:204});assert.equal((await pending).kind,'stale_context');assert.equal(posts,0)
 }finally{globalThis.fetch=savedFetch;globalThis.document=savedDocument;api.__resetCsrfCacheForTests()}
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {__resetCsrfCacheForTests} from '../src/api-client.js'
import * as messaging from '../src/messaging-api.js'

const bundle=await build({entryPoints:['src/pages/ServerMessages.jsx'],bundle:true,write:false,platform:'node',format:'esm',loader:{'.css':'empty'},plugins:[{name:'react',setup(b){b.onResolve({filter:/^react$/},()=>({path:import.meta.resolve('react'),external:true}))}}]})
const {conversationSnapshot,conversationMatches}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const c={id:'cA',revision:4,status:'Open',patientId:'pA',branchId:'b1'},m={id:'mA',body:'Synthetic text',mine:true,sent_at:'2026-11-14T10:00:00+08:00',sender:{name:'Synthetic sender',role:'Staff'}}
const readContext={conversation_id:c.id,patient_id:c.patientId,branch_id:c.branchId}
test('DEN-14 reviewed conversation snapshot is frozen and detached',()=>{const original={...c},s=conversationSnapshot(original);original.revision=5;assert.equal(s.revision,4);assert.equal(Object.isFrozen(s),true);assert.equal(conversationMatches(s,c),true)})
for(const patch of [{id:'cB'},{revision:5},{patientId:'pB'},{branchId:'b2'},{status:'Closed'}])test('DEN-14 reviewed context refuses '+JSON.stringify(patch),()=>assert.equal(conversationMatches(conversationSnapshot(c),{...c,...patch}),false))
test('DEN-14 missing context cannot authorize a conversation command',()=>{for(const patch of [{revision:null},{revision:1.5},{status:undefined},{patientId:null},{branchId:null},{id:''}]){const bad={...c,...patch};assert.equal(conversationMatches(conversationSnapshot(bad),bad),false)}})
async function http(run,data,onRequest=()=>{}){const original=globalThis.fetch;__resetCsrfCacheForTests();globalThis.fetch=async(url)=>{onRequest(url);return String(url).endsWith('/sanctum/csrf-cookie')?new Response(null,{status:204}):Response.json(data)};try{return await run()}finally{globalThis.fetch=original;__resetCsrfCacheForTests()}}
test('STF-21 switch receipt binds exact conversation and explicit boolean',async()=>{
 assert.deepEqual(await http(()=>messaging.addDentist('cA','dA'),{data:{id:'cA',added:true}}),{ok:true,added:true})
 assert.deepEqual(await http(()=>messaging.addDentist('cA','dA'),{data:{id:'cA',added:false}}),{ok:true,added:false})
 for(const data of [{id:'cB',added:true},{id:'cA'},null])assert.equal((await http(()=>messaging.addDentist('cA','dA'),{data})).kind,'unconfirmed')
})
test('DEN-14 close receipt requires exact identity status and revision advancement',async()=>{
 assert.equal((await http(()=>messaging.closeConversation(c,'key'),{data:{id:'cA',status:'Closed',revision:5}})).ok,true)
 for(const patch of [{id:'cB'},{status:'Open'},{revision:4},{revision:6},{revision:'5'}])assert.equal((await http(()=>messaging.closeConversation(c,'key'),{data:{id:'cA',status:'Closed',revision:5,...patch}})).kind,'unconfirmed')
})
for(const [name,patch]of [['wrong body',{body:'Different text'}],['not mine',{mine:false}],['missing ID',{id:null}],['missing time',{sent_at:null}],['invalid time',{sent_at:'x'}]])test('DEN-14 send rejects '+name+' receipt and retains uncertainty',async()=>assert.equal((await http(()=>messaging.sendMessage('cA','Synthetic text','key'),{data:{...m,...patch}})).kind,'unconfirmed'))
test('DEN-14 valid message receipt confirms only the exact submitted text',async()=>assert.equal((await http(()=>messaging.sendMessage('cA','  Synthetic text  ','key'),{data:m})).ok,true))
for(const data of [null,{},[m,m],[{...m,body:null}],[{...m,mine:undefined}],[{...m,sent_at:123}]])test('STF-23 malformed history is not a successful empty search '+JSON.stringify(data),async()=>{
 const r=await http(()=>messaging.loadMessages(c.id,null,'needle',c),{data,meta:{context:readContext,next_cursor:null}});assert.equal(r.ok,false);assert.equal(r.rows,undefined)
})
test('STF-23 genuine empty history and exact encoded search cursor stay supported',async()=>{
 const requests=[]
 assert.deepEqual(await http(()=>messaging.loadMessages(c.id,'older','%_needle',c),{data:[],meta:{context:readContext,next_cursor:'next'}},url=>requests.push(new URL(url))),{ok:true,rows:[],nextCursor:'next'})
 assert.equal(requests.length,1);assert.equal(requests[0].pathname,'/api/conversations/cA/messages')
 assert.equal(requests[0].searchParams.get('cursor'),'older');assert.equal(requests[0].searchParams.get('q'),'%_needle')
 assert.equal(requests[0].searchParams.get('per_page'),'30');assert.match(requests[0].search,/q=%25_needle(?:&|$)/)
})
test('STF-23 empty results without exact conversation Patient and branch proof remain unavailable',async()=>{
 for(const context of [undefined,{...readContext,conversation_id:'foreign'},{...readContext,patient_id:'foreign'},{...readContext,branch_id:'foreign'}]){
  const r=await http(()=>messaging.loadMessages(c.id,null,'needle',c),{data:[],meta:{context,next_cursor:null}})
  assert.equal(r.ok,false);assert.equal(r.kind,'unverified');assert.equal(r.rows,undefined)
 }
})
test('STF-23 malformed inbox and dentist options never become empty availability',async()=>{
 for(const data of [null,{},[{id:'same'},{id:'same'}]])assert.equal((await http(()=>messaging.loadConversations(),{data})).ok,false)
 for(const data of [null,[{id:'dA',name:'Synthetic'}],[{id:'dA',name:'Synthetic',participant:'false'}]])assert.equal((await http(()=>messaging.loadDentistOptions('cA'),{data})).ok,false)
})
test('DEN-14 Patient start preserves malformed-receipt uncertainty',async()=>{
 for(const data of [{conversation:{id:'cA'}}, {conversation:{id:'cA'},message:{...m,body:'Different text'}}, {conversation:{id:null},message:m}])assert.equal((await http(()=>messaging.startConversation('branch','Synthetic text','key'),{data})).kind,'unconfirmed')
 assert.equal((await http(()=>messaging.startConversation('branch','Synthetic text','key'),{data:{conversation:{id:'cA',reused:false},message:m}})).ok,true)
})
const operations=[
 ['switch',g=>messaging.addDentist('cA','dA',g),'/api/conversations/cA/participants',{dentist_id:'dA'}],
 ['send',g=>messaging.sendMessage('cA','Synthetic text','key',g),'/api/conversations/cA/messages',{body:'Synthetic text'}],
 ['close',g=>messaging.closeConversation(c,'key',g),'/api/conversations/cA/close',{expected_revision:4}],
 ['read',g=>messaging.markRead('cA','mA',g),'/api/conversations/cA/read',{up_to:'mA'}],
 ['start',g=>messaging.startConversation('branch','Synthetic text','key',g),'/api/conversations',{branch_id:'branch',body:'Synthetic text'}],
]
for(const [name,run,path,body]of operations)for(const stale of [false,true])test('messaging '+name+' '+(stale?'refuses expired context during CSRF':'preserves exact payload'),async()=>{
 const original=globalThis.fetch;__resetCsrfCacheForTests();let valid=true,release,start;const started=new Promise(r=>{start=r}),waiting=new Promise(r=>{release=r}),sent=[]
 globalThis.fetch=async(url,options={})=>{if(String(url).endsWith('/sanctum/csrf-cookie')){start();await waiting;return new Response(null,{status:204})}sent.push({path:new URL(url).pathname,body:JSON.parse(options.body),key:options.headers['Idempotency-Key']??null});const data=name==='start'?{conversation:{id:'cA',reused:false},message:m}:name==='switch'?{id:'cA',added:true}:name==='close'?{id:'cA',status:'Closed',revision:5}:m;return Response.json({data})}
 try{const done=run(()=>valid);await started;if(stale)valid=false;release();const r=await done;if(stale){assert.equal(r.ok,false);assert.deepEqual(sent,[])}else{assert.equal(r.ok,true);assert.equal(sent[0].path,path);assert.deepEqual(sent[0].body,body);assert.equal(sent[0].key,['send','close','start'].includes(name)?'key':null)}}finally{globalThis.fetch=original;__resetCsrfCacheForTests()}
})

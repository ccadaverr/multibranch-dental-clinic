import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {variableValue} from './support/source-behavior.js'
import * as hmoApi from '../src/hmo-api.js'
import {verifyPatientId,__resetCsrfCacheForTests} from '../src/api-client.js'

const bundle=await build({entryPoints:['src/pages/Hmo.jsx'],bundle:true,write:false,platform:'node',format:'esm',loader:{'.css':'empty'},plugins:[{name:'one-react',setup(b){b.onResolve({filter:/^react$/},()=>({path:import.meta.resolve('react'),external:true}))}}]})
const {membershipReceiptMatches,hmoReceiptMatches,captureHmoCase,hmoOperationIsStale,createMembershipLookup,hmoDecisionMatches}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const idReceiptMatches=variableValue('src/pages/CounterIntake.jsx','idReceiptMatches',{ID_TYPES:variableValue('src/pages/CounterIntake.jsx','ID_TYPES',{})})
const body={id_type:'other',other_details:'Synthetic company ID'},receipt={id_type:'other',other_details:'Synthetic company ID',id_verified_at:'2026-11-14T08:00:00+08:00'}
test('STF-04 exact reviewed ID receipt matches',()=>assert.equal(idReceiptMatches(body,receipt),true))
for(const patch of [{id_type:'passport'},{other_details:'Other value'},{id_verified_at:123},{id_verified_at:null},{id_verified_at:''},{id_verified_at:'not-a-timestamp'}])test('STF-04 malformed/mismatching ID receipt '+JSON.stringify(patch),()=>assert.equal(idReceiptMatches(body,{...receipt,...patch}),false))

const visit={id:'visit-A',patientPublicId:'patient-A'},submitted={providerName:'Synthetic provider',memberNumber:'SYNTHETIC-NEW',expectedActiveId:'old'}
const membership={patient:{id:'patient-A'},active:{id:'new',status:'active',provider_name:submitted.providerName,member_number:submitted.memberNumber},history:[{id:'old',status:'ended'}]}
test('GEN-13 exact replacement and ended membership receipts match',()=>{
 assert.equal(membershipReceiptMatches(visit,submitted,false,membership),true)
 assert.equal(membershipReceiptMatches(visit,submitted,true,{...membership,active:null}),true)
})
for(const [name,patch]of [['foreign patient',{patient:{id:'patient-B'}}],['missing active',{active:undefined}],['wrong provider',{active:{...membership.active,provider_name:'Different provider'}}],['wrong member',{active:{...membership.active,member_number:'OTHER'}}],['old active id',{active:{...membership.active,id:'old'}}],['ended active',{active:{...membership.active,status:'ended'}}],['missing history',{history:null}]])test('GEN-13 '+name+' membership receipt stays unconfirmed',()=>assert.equal(membershipReceiptMatches(visit,submitted,false,{...membership,...patch}),false))
test('GEN-13 end receipt must actually contain the selected ended membership',()=>assert.equal(membershipReceiptMatches(visit,submitted,true,{...membership,active:null,history:[{id:'another',status:'ended'}]}),false))

const h={id:'case-A',status:'Pending',revision:4,submissionCycle:1,patientPublicId:'patient-A',branchId:'b1',visitId:'visit-A'}
const intent={mode:'response',outcome:'Approved',method:'Phone',note:'  Synthetic external response  ',providerReference:' SYNTHETIC-REF ',approvedAmount:'001200.1'}
const row={id:h.id,status:'Approved',revision:5,submission_cycle:1,patient:{id:h.patientPublicId},branch:{id:h.branchId},visit:{id:h.visitId},approved_amount:'1200.10',events:[{kind:'response',submission_cycle:1,outcome:'Approved',method:'Phone',note:'Synthetic external response',provider_reference:'SYNTHETIC-REF',approved_amount:'1200.10'}]}
test('GEN-13 approval read receipt matches exact reviewed context and decimal text',()=>assert.equal(hmoReceiptMatches(h,row,intent),true))
for(const [name,patch]of [['case',{id:'case-B'}],['patient',{patient:{id:'patient-B'}}],['visit',{visit:{id:'visit-B'}}],['branch',{branch:{id:'b2'}}],['revision',{revision:4}],['later unreviewed revision',{revision:6}],['cycle',{submission_cycle:2}],['outcome',{status:'Rejected'}],['amount',{approved_amount:'1200.11'}],['rounded fractional amount',{approved_amount:'1200.1000000000001'}],['numeric amount',{approved_amount:1200.1}],['event omitted',{events:[]}],['event mismatched',{events:[{...row.events[0],note:'Different external evidence'}]}]])test('GEN-13 response receipt rejects '+name,()=>assert.equal(hmoReceiptMatches(h,{...row,...patch},intent),false))
test('GEN-13 exact decimal comparison preserves valid leading-dot entry',()=>assert.equal(hmoReceiptMatches(h,{...row,approved_amount:'0.50',events:[{...row.events[0],approved_amount:'0.50'}]},{...intent,approvedAmount:'.5'}),true))
test('GEN-13 rejected response needs the matching external event, without inventing approval',()=>assert.equal(hmoReceiptMatches(h,{...row,status:'Rejected',approved_amount:null,events:[{...row.events[0],outcome:'Rejected',approved_amount:null}]},{...intent,outcome:'Rejected'}),true))
for(const [mode,status,cycle]of [['submit','Pending',2],['contact','Pending',1],['escalate','Escalated',1],['withdraw','Withdrawn',1]])test('GEN-13 '+mode+' receipt follows existing revision/cycle contract',()=>assert.equal(hmoReceiptMatches(h,{...row,status,submission_cycle:cycle},{mode}),true))
test('GEN-13 requirement no-op and advancing receipt both require the reviewed rule',()=>{
 const original={...h,status:'Missing Requirements'},r={...row,status:'Missing Requirements',revision:4,requirements:[{rule:'valid-id',state:'Validated'}]}
 assert.equal(hmoReceiptMatches(original,r,{mode:'requirement',rule:'valid-id'}),true)
 assert.equal(hmoReceiptMatches(original,{...r,status:'Ready for Submission',revision:5},{mode:'requirement',rule:'valid-id'}),true)
 assert.equal(hmoReceiptMatches(original,{...r,requirements:[{rule:'valid-id',state:'Missing'}]},{mode:'requirement',rule:'valid-id'}),false)
})
test('GEN-13 initial case/self-pay receipt preserves server public Patient identity',()=>{
 const initial={...row,id:'new-case',revision:1,submission_cycle:0,status:'Missing Requirements'}
 assert.equal(hmoReceiptMatches(h,initial,{mode:'open'}),true)
 assert.equal(hmoReceiptMatches(h,{...initial,status:'Withdrawn'},{mode:'selfPay'}),true)
 assert.equal(hmoReceiptMatches(h,{...initial,status:'Approved'},{mode:'open'}),false)
})
test('GEN-13 changed status at unchanged revision invalidates the observed HMO case',()=>{
 const original={...h,server:true},operation={caseSnapshot:captureHmoCase(original)}
 assert.equal(hmoOperationIsStale(operation,{...original,status:'Escalated'},h.id),true)
 assert.equal(hmoOperationIsStale(operation,original,h.id),false)
})
test('GEN-13 revoked lookup cannot adopt a late membership response',async()=>{
 let allowed=true,resolve;const states=[],lookup=createMembershipLookup(()=>new Promise(r=>{resolve=r}),x=>states.push(x),()=>allowed)
 const load=lookup.select(visit),token=lookup.capture();allowed=false;resolve({ok:true,membership});assert.equal(await load,false);assert.equal(lookup.current(token),false);assert.equal(lookup.adopt(token,membership),false);assert.equal(states.length,1);lookup.dispose()
})


test('GEN-13 unchanged membership receipt preserves the backend supported no-op',()=>{
 const same={...submitted,expectedProviderName:submitted.providerName,expectedMemberNumber:submitted.memberNumber}
 assert.equal(membershipReceiptMatches(visit,same,false,{...membership,active:{...membership.active,id:'old'}}),true)
 assert.equal(membershipReceiptMatches(visit,{...same,expectedMemberNumber:'ORIGINAL'},false,{...membership,active:{...membership.active,id:'old'}}),false)
})
const returnedIntent={...intent,outcome:'Returned',returned:['valid-id','hmo-card']},returnedRow={...row,status:'Returned',approved_amount:null,events:[{...row.events[0],outcome:'Returned',approved_amount:null,rule_keys:['hmo-card','valid-id']}],requirements:[{rule:'valid-id',state:'Missing'},{rule:'hmo-card',state:'Missing'}]}
test('GEN-13 returned response preserves exact selected requirements',()=>assert.equal(hmoReceiptMatches(h,returnedRow,returnedIntent),true))
for(const [name,patch]of [['missing rule keys',{events:[{...returnedRow.events[0],rule_keys:null}]}],['different selected rules',{events:[{...returnedRow.events[0],rule_keys:['treatment-request']}]}],['unapplied missing state',{requirements:[{rule:'valid-id',state:'Validated'},{rule:'hmo-card',state:'Missing'}]}]])test('GEN-13 returned response rejects '+name,()=>assert.equal(hmoReceiptMatches(h,{...returnedRow,...patch},returnedIntent),false))


test('GEN-13 claim decision context binds both public and legacy identity without inventing a revision',()=>{
 const observed={visitId:'visit-A',patientId:'legacy-A',patientPublicId:'patient-A',branchId:'b1',visitStatus:'Waiting'}
 assert.equal(hmoDecisionMatches(observed,{...observed}),true)
 for(const patch of [{visitId:'visit-B'},{patientId:'legacy-B'},{patientPublicId:'patient-B'},{branchId:'b2'},{visitStatus:'Done'}])assert.equal(hmoDecisionMatches(observed,{...observed,...patch}),false)
 assert.equal(hmoDecisionMatches(observed,null),false)
})

const calls=[
 ['ID verification',guard=>verifyPatientId('patient-A',body,guard),'/api/patients/patient-A/verify-id',body,null],
 ['membership set',guard=>hmoApi.setMembership('visit-A',submitted,'key',guard),'/api/visits/visit-A/hmo-membership',{provider_name:submitted.providerName,member_number:submitted.memberNumber,expected_active_id:'old'},'key'],
 ['membership end',guard=>hmoApi.endMembership('visit-A','old','key',guard),'/api/visits/visit-A/hmo-membership/end',{expected_active_id:'old'},'key'],
 ['case open',guard=>hmoApi.openCase('visit-A','key',guard),'/api/visits/visit-A/hmo-case',{},'key'],
 ['self pay',guard=>hmoApi.recordSelfPay('visit-A','Synthetic reason','key',guard),'/api/visits/visit-A/hmo/self-pay',{reason:'Synthetic reason'},'key'],
 ['requirement',guard=>hmoApi.validateRequirement(h,'valid-id','Synthetic document','key',guard),'/api/hmo-cases/case-A/requirements/valid-id',{expected_revision:4,document_label:'Synthetic document'},'key'],
 ['submit',guard=>hmoApi.submitCase(h,{method:'Phone',note:'Synthetic note'},'key',guard),'/api/hmo-cases/case-A/submit',{expected_revision:4,method:'Phone',note:'Synthetic note'},'key'],
 ['contact',guard=>hmoApi.recordContact(h,{method:'Phone',note:'Synthetic note',nextAction:'Synthetic next action'},'key',guard),'/api/hmo-cases/case-A/contact',{expected_revision:4,method:'Phone',note:'Synthetic note',next_action:'Synthetic next action'},'key'],
 ['escalate',guard=>hmoApi.escalateCase(h,'key',guard),'/api/hmo-cases/case-A/escalate',{expected_revision:4},'key'],
 ['withdraw',guard=>hmoApi.withdrawCase(h,'Synthetic reason','key',guard),'/api/hmo-cases/case-A/withdraw',{expected_revision:4,reason:'Synthetic reason'},'key'],
 ['response',guard=>hmoApi.recordResponse(h,{outcome:'Rejected',method:'Phone',note:'Synthetic evidence'},'key',guard),'/api/hmo-cases/case-A/response',{expected_revision:4,submission_cycle:1,outcome:'Rejected',method:'Phone',note:'Synthetic evidence'},'key'],
]
for(const [name,run,path,expected,key]of calls)for(const stale of [false,true])test('GEN-13 dispatch '+name+' '+(stale?'refuses expired context during CSRF':'preserves payload and key'),async()=>{
 const old=globalThis.fetch;let valid=true,release,started;const begin=new Promise(r=>{started=r}),pending=new Promise(r=>{release=r}),sent=[];__resetCsrfCacheForTests()
 globalThis.fetch=async(url,options={})=>{
  if(String(url).endsWith('/sanctum/csrf-cookie')){started();await pending;return new Response(null,{status:204})}
  sent.push({path:new URL(url).pathname,method:options.method,body:JSON.parse(options.body),key:options.headers['Idempotency-Key']||null});return Response.json({data:{}})
 }
 try{const done=run(()=>valid);await begin;if(stale)valid=false;release();const result=await done
  if(stale){assert.equal(result.ok,false);assert.deepEqual(sent,[])}else{assert.equal(result.ok,true);assert.deepEqual(sent,[{path,method:'POST',body:expected,key}])}
 }finally{globalThis.fetch=old;__resetCsrfCacheForTests()}
})

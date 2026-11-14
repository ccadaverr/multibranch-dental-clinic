import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {readFileSync} from 'node:fs'

// Import the actual production helpers through the JSX dependency graph. No database or HTTP.
const require = createRequire(import.meta.url)
const output = await build({stdin:{contents:"export {clinicalBookingSelection,currentFollowupReview} from './src/pages/ServerFollowups.jsx'",resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'js'},bundle:true,platform:'node',format:'cjs',write:false,packages:'external',loader:{'.css':'empty'},logLevel:'silent'})
const module = {exports:{}}
new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports)
const {clinicalBookingSelection:select,currentFollowupReview:review} = module.exports
const P='01ARZ3NDEKTSV4RRFFQ69G5FAB', A='01ARZ3NDEKTSV4RRFFQ69G5FAW', B='01ARZ3NDEKTSV4RRFFQ69G5FAV', AP='01ARZ3NDEKTSV4RRFFQ69G5FAA'
const task=()=>({id:B,revision:7,status:'Open',can_book:true,patient:{id:P},branch:{id:'b1'},service:{id:'svc1'},appointment:null})
const world=()=>({getAuthGeneration:()=>1,session:{serverUserId:'synthetic',userId:'staff',role:'staff',active:true,branchId:'b1',branchScopes:['b1']},state:{persons:[{id:'person'}],users:[{id:'staff',personId:'person',role:'Staff',status:'Active',branchId:'b1',permissions:['appointments']}],staff:[{userId:'staff',personId:'person',branchId:'b1'}],branches:[{id:'b1',status:'Open'}]}})
const selected=()=>({taskId:B,expectedRevision:7,patientPublicId:P,branchId:'b1'})
const observed=()=>({...selected(),observedStatus:'Open'})

for(const status of ['Open','Contacted'])test('clinical exact B selection: '+status,()=>{
  const older={...task(),id:A,revision:3}, chosen={...task(),status}
  const result=select([older,chosen][1],'staff',world())
  assert.deepEqual(result,selected());assert.ok(Object.isFrozen(result))
  chosen.revision=9;chosen.id=A;assert.deepEqual(result,selected())
})
const invalid={
  'missing task':t=>{delete t.id},'bigint task':t=>{t.id='123'},'invalid ULID':t=>{t.id='81ARZ3NDEKTSV4RRFFQ69G5FAV'},'LF suffix':t=>{t.id+='\n'},'CRLF suffix':t=>{t.id+='\r\n'},
  'missing revision':t=>{delete t.revision},'string revision':t=>{t.revision='7'},'fraction revision':t=>{t.revision=7.5},'zero revision':t=>{t.revision=0},'oversize revision':t=>{t.revision=2147483648},
  'missing Patient':t=>{delete t.patient},'internal Patient id':t=>{t.patient.id='12'},'missing branch':t=>{delete t.branch},'outside branch':t=>{t.branch.id='b2'},
  'invalid service':t=>{t.service={id:123}},'Closed':t=>{t.status='Closed'},'Booked':t=>{t.status='Booked'},'server refusal':t=>{t.can_book=false},'linked Open':t=>{t.appointment={id:AP}}
}
for(const [name,change] of Object.entries(invalid))test('clinical selection fails closed: '+name,()=>{const t=task();change(t);assert.equal(select(t,'staff',world()),null)})
for(const role of ['owner','dentist','patient'])test('clinical selected booking excludes '+role,()=>{
  const w=world();assert.equal(select(task(),role,w),null);w.session.role=role;assert.equal(select(task(),'staff',w),null)
})
for(const [name,change] of Object.entries({
  'branch closed':w=>{w.state.branches[0].status='Closed'},'branch absent':w=>{w.state.branches=[]},
  'permission removed':w=>{w.state.users[0].permissions=[]},'inactive account':w=>{w.state.users[0].status='Inactive'},
  'auth unavailable':w=>{w.getAuthGeneration=()=>null},'branch scope changed':w=>{w.session.branchScopes=['b2']}
}))test('clinical current authorization gate: '+name,()=>{const w=world();change(w);assert.equal(select(task(),'staff',w),null)})
test('clinical service remains optional and separate from the legacy local followup',()=>{
  const t=task();t.service=null;t.followup={id:A};assert.deepEqual(select(t,'staff',world()),selected())
})
for(const status of ['Open','Contacted','Booked','Closed'])test('bounded current read: '+status+' is state, not command proof',()=>{
  const t={...task(),status,revision:8,reason:'not copied',appointment:status==='Booked'?{id:AP,code:'SYNTHETIC',when:'2026-11-20',notes:'not copied'}:null}
  const result=review({ok:true,data:[{...task(),id:A},t]},observed())
  assert.equal(result.status,status);assert.equal(result.revision,8)
  assert.deepEqual(Object.keys(result).sort(),['appointment','revision','status'])
  assert.equal('followup_link' in result,false);assert.equal('notes' in (result.appointment||{}),false)
})
for(const [name,make] of Object.entries({
  absent:()=>({ok:true,data:[]}),missing:()=>null,forbidden:()=>({ok:false,kind:'forbidden'}),network:()=>({ok:false,kind:'network'}),malformed:()=>({ok:true,data:{}}),
  duplicate:()=>({ok:true,data:[task(),task()]}),wrongPatient:()=>({ok:true,data:[{...task(),patient:{id:A}}]}),wrongBranch:()=>({ok:true,data:[{...task(),branch:{id:'b2'}}]}),
  stale:()=>({ok:true,data:[{...task(),revision:6}]}),stringRevision:()=>({ok:true,data:[{...task(),revision:'8'}]}),unknownStatus:()=>({ok:true,data:[{...task(),status:'Pending'}]}),
  unlinkedBooked:()=>({ok:true,data:[{...task(),status:'Booked'}]}),malformedLink:()=>({ok:true,data:[{...task(),status:'Booked',appointment:{id:'123'}}]}),linkedOpen:()=>({ok:true,data:[{...task(),appointment:{id:AP}}]})
}))test('bounded read cannot establish current exact relationship: '+name,()=>assert.equal(review(make(),observed()),null))
test('an unchanged Open read remains only a snapshot; no success or original receipt is invented',()=>{
  assert.deepEqual(review({ok:true,data:[task()]},observed()),{status:'Open',revision:7,appointment:null})
})

test('P2 original Open 7 to Booked 7 contradiction is unverified',()=>{
  assert.equal(review({ok:true,data:[{...task(),status:'Booked',appointment:{id:AP}}]},observed()),null)
})
for(const before of ['Open','Contacted','Booked','Closed'])for(const after of ['Open','Contacted','Booked','Closed']){
  test(`unchanged revision cannot change observed ${before} to ${after}`,()=>{
    const result=review({ok:true,data:[{...task(),status:after,appointment:after==='Booked'?{id:AP}:null}]},{...observed(),observedStatus:before})
    if(before!==after)assert.equal(result,null)
    else assert.equal(result.status,after)
  })
}
// These are actual R2 mutations, not a new transition policy for arbitrary read gaps.
for(const [before,after] of [['Open','Contacted'],['Open','Booked'],['Open','Closed'],['Contacted','Booked'],['Contacted','Closed'],['Booked','Open'],['Booked','Closed']]){
  test(`revision advancement preserves actual ${before} to ${after} current state without command attribution`,()=>{
    const result=review({ok:true,data:[{...task(),status:after,revision:8,appointment:after==='Booked'?{id:AP}:null}]},{...observed(),observedStatus:before})
    assert.equal(result.status,after);assert.equal(result.revision,8);assert.equal('followupLink' in result,false)
  })
}
test('current read requires a complete observed status/revision and exact task',()=>{
  for(const patch of [{observedStatus:undefined},{observedStatus:'Pending'},{expectedRevision:2147483648}])assert.equal(review({ok:true,data:[task()]},{...observed(),...patch}),null)
  assert.equal(review({ok:true,data:[{...task(),id:A}]},observed()),null)
})
test('repeated current snapshots cannot downgrade an advanced observation or mutate booking intent',()=>{
  const booking=select(task(),'staff',world()),initial=Object.freeze(observed())
  const booked=review({ok:true,data:[{...task(),revision:8,status:'Booked',appointment:{id:AP}}]},initial)
  const newer=Object.freeze({...initial,expectedRevision:booked.revision,observedStatus:booked.status})
  assert.equal(review({ok:true,data:[task()]},newer),null)
  assert.equal(review({ok:true,data:[{...task(),revision:8,status:'Closed'}]},newer),null)
  assert.equal(review({ok:true,data:[{...task(),revision:8,status:'Booked',appointment:{id:AP}}]},newer).status,'Booked')
  assert.equal(review({ok:true,data:[{...task(),revision:9,status:'Closed'}]},newer).status,'Closed')
  assert.deepEqual(booking,selected());assert.deepEqual(initial,observed())
})
test('clinical fixture imports the exact production CSS sequence, including Follow-ups styles',()=>{
  const css=text=>[...text.matchAll(/^import ['"]([^'"]+\.css)['"]/gm)].map(m=>m[1].replace(/^\.\//,'').replace(/^\/src\//,''))
  assert.deepEqual(css(readFileSync(new URL('./fixtures/aud10-clinical-ui.html',import.meta.url),'utf8')),css(readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8')))
})

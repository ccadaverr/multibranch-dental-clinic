import test from 'node:test'
import assert from 'node:assert/strict'
import {productionExpression} from './support/source-behavior.js'
import {schedulingActorKey} from '../src/appointment-ui.js'

const file='src/pages/ServerFollowups.jsx'
const rowAttribute=(scope,name,bindings)=>productionExpression(file,(n,parent,ancestors)=>parent?.type==='JSXExpressionContainer'&&parent.expression===n&&ancestors.some(a=>a.type==='JSXAttribute'&&a.name.name===name)&&ancestors.some(a=>a.type==='JSXOpeningElement'&&a.name.name==='FollowupRow')&&ancestors.some(a=>a.type==='FunctionDeclaration'&&a.id?.name===scope),bindings)
function fixture(){return{t:{id:'01ARZ3NDEKTSV4RRFFQ69G5FAV',revision:7,patient:{id:'01ARZ3NDEKTSV4RRFFQ69G5FAB'},branch:{id:'b1'},service:{id:'svc1'},due_on:'2026-11-20'},store:{session:{serverUserId:'server',userId:'staff',role:'staff',active:true,branchId:'b1',branchScopes:['b1']},state:{users:[{id:'staff',permissions:['appointments']}]}}}}
for(const scope of ['FollowupsBody','PatientFollowupPanel'])for(const [label,change] of [
 ['Patient',s=>{s.t.patient.id='different-patient'}],['branch',s=>{s.t.branch.id='b2'}],['revision',s=>{s.t.revision=8}],
 ['service',s=>{s.t.service.id='svc2'}],['due date',s=>{s.t.due_on='2026-11-21'}],['actor',s=>{s.store.session.serverUserId='replacement'}],
 ['permission',s=>{s.store.state.users[0].permissions=[]}],
])test('integration: '+scope+' row lifetime changes with '+label,()=>{
 const s=fixture(),key=()=>rowAttribute(scope,'key',{...s,schedulingActorKey}),before=key();change(s);assert.notEqual(key(),before,'an old booking/review row must not survive changed context')
})
for(const scope of ['FollowupsBody','PatientFollowupPanel'])test('integration: '+scope+' passes the awaited QA recovery callback through the clinical row',async()=>{
 let release,calls=0;const pending=new Promise(r=>{release=r}),reload=()=>{calls++;return pending};const received=rowAttribute(scope,'onReload',{reload});assert.equal(received,reload);const settled=received();assert.equal(calls,1);assert.equal(settled,pending);release(true);assert.equal(await settled,true)
})

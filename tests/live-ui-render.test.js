import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { withServerAppointments } from './support/server-appointments.js'
import { setClockSource } from '../src/clock.js'

const require=createRequire(import.meta.url)
const files=['data.js','clock.js','contracts.js','safeguards.js','phase3-contracts.js','workflow.js','hmo-presentation.js','hmo-api.js','patient-ui.jsx','patient-view.js','pages/Scheduling.jsx','pages/FinanceCommunication.jsx','pages/PatientCare.jsx','pages/PatientMe.jsx']
const bundle=await build({stdin:{contents:files.map(file=>`export * from './src/${file}';`).join('\n'),resolveDir:process.cwd()},bundle:true,write:false,loader:{'.css':'empty'},platform:'node',format:'esm',plugins:[{name:'shared-react',setup(build){build.onResolve({filter:/^react$/},()=>({path:pathToFileURL(require.resolve('react')).href,external:true}))}}]})
const m=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
m.setClockSource(()=>new Date('2026-09-19T02:08:00Z'))
// The server-flow helper's dry run uses the unbundled modules, so pin that clock too.
setClockSource(()=>new Date('2026-09-19T02:08:00Z'))

function fixture() {
  const seeds={persons:'PERSONS',patients:'PATIENTS',users:'USERS',branches:'BRANCHES',services:'SERVICES',branchServices:'BRANCH_SERVICES',dentists:'DENTISTS',staff:'STAFF',dentistServiceAssignments:'DENTIST_SERVICE_ASSIGNMENTS'}
  const reference=Object.fromEntries(Object.entries(seeds).map(([key,name])=>[key,structuredClone(m[`INITIAL_${name}`])]))
  let state=m.normalizeClinicState({...reference,appointments:[],queue:[],checkIns:[],treatments:[],invoices:[],followups:[],prescriptions:[],notifications:[],hmo:[],conversations:[],inquiries:[],workflowLog:[],audit:[],bookingDrafts:[]})
  let session=m.sessionForRole('staff',state)
  const raw=m.createWorkflowActions({getState:()=>state,getSession:()=>session,commit:patch=>{state=m.normalizeClinicState({...state,...patch})}})
  // M6 cutover: server appointments; Check-In/No-show/treatment transitions run server-first.
  const server=withServerAppointments({getState:()=>state,setState:next=>{state=m.normalizeClinicState(next)},getSession:()=>session,rawActions:()=>raw})
  return {get actions(){return server.actions()},flow:server.flow,get state(){return state},get session(){return session},role(next){session=m.sessionForRole(next,state)},addInvoice(invoice){state=m.normalizeClinicState({...state,invoices:[...state.invoices,invoice]})}}
}
const ok=result=>{assert.equal(result.ok,true,result.message);return result.record}
const render=(Component,props)=>renderToString(React.createElement(Component,props))

// M12: HMO cases come from the server. `serverCase` builds a GET /api/hmo-cases row; `withCases` puts the mapped server
// projection into the store exactly as src/store.jsx does.
const serverCase=(fields={})=>({id:'01jhmo0000000000000000000a',status:'Missing Requirements',revision:1,submission_cycle:0,provider_name:'Insurer One',member_number:'M-000123',
  visit:{id:'01jvisit000000000000000000a',clinic_date:'2026-09-19',status:'Checked In'},patient:{id:'p1',code:'PAT-0001',name:'Maria Santos'},branch:{id:'b1',name:'Dr. Dana Roxas Dental Clinic'},
  dentist:{id:'d1',name:'Miguel Reyes'},appointment:null,submitted_at:null,follow_up_due_at:null,escalated_at:null,final_at:null,approved_amount:null,created_at:'2026-09-19T10:00:00+08:00',
  requirements:[{rule:'hmo-card',label:'HMO Card',state:'Missing'},{rule:'valid-id',label:'Valid ID',state:'Missing'},{rule:'treatment-request',label:'Dentist treatment request',state:'Missing'}],
  events:[{kind:'created',submission_cycle:0,from_status:null,to_status:'Missing Requirements',occurred_at:'2026-09-19T10:00:00+08:00',actor:{role:'staff',name:'Alyssa Cruz'}}],...fields})
// Match the production HMO command boundary; a local role alone is not authenticated.
const hmoStaffSession=f=>({...f.session,serverUserId:'synthetic-hmo-staff',branchScopes:['b1']})
const withCases=(f,rows,patient=false)=>m.normalizeClinicState({...f.state,hmo:rows.map(r=>patient?m.mapPatientHmoCase(r,'p1'):m.mapHmoCase(r)),claimDecisions:[]})

test('live HMO worklist uses server cases and detail reveals the case sections',()=>{
  const f=fixture()
  const state=withCases(f,[serverCase()])
  const store={state,session:hmoStaffSession(f),actions:f.actions,toast:()=>{}}
  const list=render(m.HmoPage,{role:'staff',store})
  assert.match(list,/HMO Management/)
  assert.match(list,/All Cases/);assert.match(list,/Needs Action/);assert.match(list,/Follow-Ups/)
  // Worklist views are pressed toggle buttons, not a partial tabs pattern; counts stay out of the accessible name.
  assert.doesNotMatch(list,/role="tab/);assert.match(list,/role="group" aria-label="HMO case views"/)
  assert.match(list,/aria-pressed="true"[^>]*>All Cases<span aria-hidden="true">1<\/span>/)
  assert.match(list,/class="hmo-case-row/);assert.match(list,/Maria Santos/)
  assert.doesNotMatch(list,/aria-label="View case for/,'row keeps its visible text as the accessible name')
  assert.match(list,/Claim decisions needed/);assert.match(list,/Patient HMO membership/)
  assert.doesNotMatch(list,/Case history/)
  const detail=render(m.HmoPage,{role:'staff',store,context:{hmoCaseId:'01jhmo0000000000000000000a'}})
  for(const section of ['Visit','HMO Provider','Requirements','Request status','Follow-Up','Case history'])assert.ok(detail.includes(section),section)
  assert.match(detail,/Missing Requirements/);assert.match(detail,/Insurer One/)
  assert.equal((detail.match(/<b>HMO Card<\/b>/g)||[]).length,1,'requirement name renders once in the checklist')
  assert.match(detail,/Check (<!-- -->)?HMO Card/);assert.match(detail,/Withdraw \(self-pay\)/)
  assert.match(detail,/<h2 tabindex="-1">Maria Santos<\/h2>/)
  assert.doesNotMatch(detail,/Provider response:/,'no response is fabricated before one is recorded')
})

test('a Returned case corrected to Ready keeps Returned as the last provider response and cannot be withdrawn',()=>{
  const f=fixture()
  const row=serverCase({status:'Ready for Submission',revision:6,submission_cycle:1,submitted_at:'2026-09-19T08:00:00+08:00',
    requirements:[{rule:'hmo-card',label:'HMO Card',state:'Validated'},{rule:'valid-id',label:'Valid ID',state:'Validated'},{rule:'treatment-request',label:'Dentist treatment request',state:'Validated'}],
    events:[{kind:'submission',submission_cycle:1,to_status:'Pending',method:'Portal',occurred_at:'2026-09-19T08:00:00+08:00',actor:{name:'Alyssa Cruz'}},
      {kind:'response',submission_cycle:1,to_status:'Returned',outcome:'Returned',method:'Email',note:'Provider returned the ID',rule_keys:['valid-id'],occurred_at:'2026-09-19T09:00:00+08:00',actor:{name:'Alyssa Cruz'}}]})
  const mapped=m.mapHmoCase(row)
  assert.equal(m.latestProviderResponse(mapped).outcome,'Returned')
  const detail=render(m.HmoPage,{role:'staff',store:{state:withCases(f,[row]),session:hmoStaffSession(f),actions:f.actions,toast:()=>{}},context:{hmoCaseId:row.id}})
  assert.match(detail,/Current status: <b>Ready for Submission<\/b>/)
  assert.match(detail,/Provider response: (<!-- -->)?Returned/)
  assert.match(detail,/Record Resubmission/)
  assert.doesNotMatch(detail,/Withdraw \(self-pay\)/,'withdrawal is only possible before the first submission')
  assert.equal(m.latestProviderResponse({status:'Approved',providerOutcome:'Approved'}),null,'legacy status alone is not response history')
})

test('HMO fixture authentication does not authorize local Staff, foreign branches or Owner commands',()=>{
  const f=fixture(),state=withCases(f,[serverCase()])
  for(const session of [f.session,{...hmoStaffSession(f),branchScopes:['b2']}]){
    const html=render(m.HmoPage,{role:'staff',store:{state,session,actions:f.actions,toast(){}},context:{hmoCaseId:'01jhmo0000000000000000000a'}})
    assert.doesNotMatch(html,/Check (?:<!-- -->)?HMO Card|Withdraw \(self-pay\)|Record Provider Response/)
    if(session.serverUserId)assert.doesNotMatch(html,/Maria Santos|M-000123|Insurer One/,'foreign-scope Staff sees no Branch b1 case or member data')
    else assert.doesNotMatch(html,/Patient HMO membership/,'local role alone cannot manage memberships')
  }
  f.role('owner')
  const html=render(m.HmoPage,{role:'owner',store:{state,session:{...f.session,serverUserId:'synthetic-owner'},actions:f.actions,toast(){}},context:{hmoCaseId:'01jhmo0000000000000000000a'}})
  assert.doesNotMatch(html,/Patient HMO membership|Record Provider Response|Withdraw \(self-pay\)/)
})

test('HMO attention and timeline derive from case state and dated events',()=>{
  const h={id:'case',status:'Missing Requirements',submissionCycle:0,requirements:[{id:'one',label:'HMO Card',state:'Missing'}],followUpTasks:[]}
  assert.equal(m.getHmoAttention(h,{timestamp:'2026-09-19T10:08:00+08:00'}).label,'Missing requirements')
  assert.deepEqual(m.hmoTimeline(h),[])
  const pending={...h,id:'pending',status:'Pending',submissionCycle:1,requirements:[{id:'one',label:'HMO Card',state:'Validated locally'}],submittedAt:'2026-09-19T00:08:00+08:00',contacts:[]}
  assert.equal(m.getHmoAttention(pending,{timestamp:'2026-09-19T13:08:00+08:00'}).label,'Follow-up due')
  assert.equal(m.getHmoAttention(pending,{timestamp:'2026-09-19T02:08:00+08:00'}).label,'Waiting for provider')
  assert.deepEqual(m.hmoTimeline(pending).map(e=>e.label),['Submission recorded'])
  const cases=[h,pending,{...pending,id:'approved',status:'Approved'}]
  const now={timestamp:'2026-09-19T13:08:00+08:00'}
  assert.equal(m.hmoCasesForView(cases,'all',now).length,3)
  assert.deepEqual(m.hmoCasesForView(cases,'action',now).map(c=>c.id),['case','pending'])
  assert.deepEqual(m.hmoCasesForView(cases,'followups',now).map(c=>c.status),['Pending'])
  // A provider return is its own attention state, even when requirements are also missing.
  const returned=m.getHmoAttention({...h,id:'returned',status:'Returned'},now)
  assert.equal(returned.label,'Returned by provider — correction needed');assert.equal(returned.needsAction,true)
})

test('Patient HMO shows the server safe subset while Owner oversight is read-only',()=>{
  const f=fixture()
  const patientRow={id:'01jhmo0000000000000000000a',status:'Missing Requirements',provider_name:'Insurer One',member_number:'••••0123',visit_date:'2026-09-19',appointment:null,branch:{name:'Dr. Dana Roxas Dental Clinic'},
    requirements:[{rule:'hmo-card',label:'HMO Card',state:'Missing'},{rule:'valid-id',label:'Valid ID',state:'Missing'},{rule:'treatment-request',label:'Dentist treatment request',state:'Missing'}],
    submitted_at:null,final_at:null,approved_amount:null}
  f.role('patient')
  const patientState=withCases(f,[patientRow],true)
  const patient=render(m.HmoPage,{role:'patient',store:{state:patientState,session:f.session,actions:f.actions,toast:()=>{}}})
  assert.match(patient,/HMO Coverage/);assert.match(patient,/Action required/)
  // Only Patient-provided documents are Patient actions; the clinic-prepared Dentist request is not.
  assert.match(patient,/Bring to the clinic: (<!-- -->)?HMO Card, Valid ID</)
  assert.doesNotMatch(patient,/Bring to the clinic: (<!-- -->)?[^<]*Dentist treatment request/)
  assert.match(patient,/The clinic prepares this document/)
  assert.match(patient,/••••0123/)
  assert.doesNotMatch(patient,/type="file"|Record Document Metadata|Record Contact Attempt|Escalate Case|Case history|Internal tracking note|M-000123/)
  const request=m.hmoCaseView(patientState.hmo[0]).requirements.find(r=>r.ruleId==='treatment-request')
  assert.equal(request.clinicSide,true);assert.equal(request.needsAction,false)
  assert.match(m.patientAttention(patientState,f.session).find(i=>i.kind==='hmo').detail,/2 documents to provide/)
  f.role('owner')
  const owner=render(m.HmoPage,{role:'owner',store:{state:withCases(f,[serverCase()]),session:f.session,actions:f.actions,toast:()=>{}}})
  assert.match(owner,/Needs Attention/);assert.match(owner,/Maria Santos/)
  assert.doesNotMatch(owner,/Record Contact Attempt|Record Provider Response|Open HMO case|Proceed self-pay|Patient HMO membership|Claim decisions needed|Check (<!-- -->)?HMO Card/)
})

test('Owner reaches approved and other cases through a read-only All Cases view',()=>{
  const f=fixture()
  const approved=serverCase({id:'01jhmo0000000000000000000b',status:'Approved',revision:7,submission_cycle:1,submitted_at:'2026-09-19T08:00:00+08:00',final_at:'2026-09-19T09:30:00+08:00',approved_amount:'1200.00',
    requirements:[{rule:'hmo-card',label:'HMO Card',state:'Validated'},{rule:'valid-id',label:'Valid ID',state:'Validated'},{rule:'treatment-request',label:'Dentist treatment request',state:'Validated'}],
    events:[{kind:'response',submission_cycle:1,to_status:'Approved',outcome:'Approved',method:'Phone',note:'Approved by provider',approved_amount:'1200.00',occurred_at:'2026-09-19T09:30:00+08:00',actor:{name:'Alyssa Cruz'}}]})
  const missing=serverCase()
  f.role('owner')
  const state=withCases(f,[approved,missing])
  const store={state,session:f.session,actions:f.actions,toast:()=>{}}
  const owner=render(m.HmoPage,{role:'owner',store})
  assert.match(owner,/<span>Approved<\/span><b>1<\/b>/,'summary counts the non-attention approved case')
  assert.match(owner,/aria-pressed="true"[^>]*>Needs Attention</);assert.match(owner,/>All Cases<span aria-hidden="true">2<\/span>/)
  assert.equal((owner.match(/class="hmo-case-row/g)||[]).length,1,'attention view lists only the case needing action')
  const visible=m.visibleHmo(state,f.session)
  assert.deepEqual(m.hmoCasesForView(visible,'action').map(h=>h.id),[missing.id])
  assert.deepEqual(m.hmoCasesForView(visible,'all').map(h=>h.id).sort(),[approved.id,missing.id].sort())
  const detail=render(m.HmoPage,{role:'owner',store,context:{hmoCaseId:approved.id}})
  assert.match(detail,/Current status: <b>Provider Approved<\/b>/);assert.match(detail,/Provider response: (<!-- -->)?Approved/);assert.match(detail,/Approved amount: <b>₱1,200.00<\/b>/);assert.match(detail,/Case history/)
  assert.doesNotMatch(detail,/Record Provider Response|Withdraw/)
})

test('HMO Coordinator is a Staff title with branch scoped HMO permission',()=>{
  const f=fixture(), user=f.state.users.find(u=>u.id==='u4')
  assert.equal(user.roleName,'HMO Coordinator')
  const session={role:'staff',userId:user.id,branchId:user.branchId,active:true}
  assert.equal(m.validSession(f.state,session),true)
  assert.equal(m.permitted(f.state,session,'hmo'),true)
  assert.equal(m.visibleHmo(f.state,session).length,0)
  assert.equal(m.validSession(f.state,{...session,role:'HMO Coordinator'}),false)
})

test('the live date and time controls render separate selected and unavailable choices',()=>{
  const dates=render(m.DateStrip,{days:[{date:'2026-09-19',dayLabel:'Today',dayNumber:19,hasOpenings:true},{date:'2026-09-20',dayLabel:'Tomorrow',dayNumber:20,hasOpenings:true},{date:'2026-09-21',dayLabel:'Mon',dayNumber:21,hasOpenings:false}],value:'2026-09-20',onChange:()=>{}})
  assert.equal((dates.match(/class="pt-date-chip(?: is-selected)?"/g)||[]).length,3)
  assert.match(dates,/aria-checked="true"/)
  assert.match(dates,/disabled=""/)
  const slots=render(m.TimeSlotGroup,{legend:'Morning',slots:[{value:'09:00',label:'9:00 AM'},{value:'09:30',label:'9:30 AM'},{value:'10:00',label:'10:00 AM',disabled:true}],value:'09:30',onPick:()=>{}})
  assert.equal((slots.match(/class="pt-time-slot(?: is-selected)?"/g)||[]).length,3)
  assert.match(slots,/class="pt-time-slot is-selected" aria-pressed="true"/)
  assert.match(slots,/disabled=""/)
})

test('live Staff Billing renders compact closed rows and excludes a Roxas - Cardinal Dental Center invoice',()=>{
  const f=fixture()
  f.addInvoice({...structuredClone(m.INITIAL_INVOICES[0]),id:'branch-a-invoice'})
  f.addInvoice(structuredClone(m.INITIAL_INVOICES[1]))
  const html=render(m.BillingPage,{role:'staff',store:{state:f.state,session:f.session,actions:{},toast:()=>{}}})
  assert.match(html,/class="billing-worklist-row"/)
  assert.match(html,/Maria Santos/)
  assert.doesNotMatch(html,/INV-2026-0002/)
  assert.doesNotMatch(html,/<details[^>]* open/)
  assert.match(html,/class="billing-worklist-detail"/)
})

test('completed payment reaches the live Patient Payments list with a View Receipt action',()=>{
  const f=fixture()
  const appointment=f.flow.book({patientId:'p1',branchId:'b1',dentistId:'d1',serviceId:'svc1',date:'2026-09-19',start:'11:00'})
  const queue=ok(f.actions.checkInAppointment(appointment.id))
  f.role('dentist')
  ok(f.actions.updateQueue(queue.id,'Called'))
  ok(f.actions.saveTreatment({queueEntryId:queue.id}))
  const treatment=ok(f.actions.completeTreatment({queueEntryId:queue.id,procedure:'Dental Consultation',procedures:[{serviceId:'svc1',quantity:1}]}))
  f.role('staff')
  const invoice=f.state.invoices.find(i=>i.treatmentId===treatment.id)
  ok(f.actions.reviewInvoice(invoice.id));ok(f.actions.issueInvoice(invoice.id))
  const payment=ok(f.actions.postPayment(invoice.id,'Cash',invoice.total))
  f.role('patient')
  const html=render(m.BillingPage,{role:'patient',store:{state:f.state,session:f.session,actions:{},toast:()=>{}}})
  assert.match(html,/View Receipt/)
  assert.ok(html.includes(payment.receipt))
  assert.match(html,/Dental Consultation/)
  assert.doesNotMatch(html,/class="pt-receipt"/)
})

test('Patient Profile remains a profile-only page without duplicate account navigation',()=>{
  const f=fixture();f.role('patient')
  const html=render(m.PatientMePage,{store:{state:f.state,session:f.session}})
  assert.match(html,/Profile/)
  assert.doesNotMatch(html,/>More</)
  assert.doesNotMatch(html,/Referral &amp; Loyalty|Receipts &amp; Payments/)
})

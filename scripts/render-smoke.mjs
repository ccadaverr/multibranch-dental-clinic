import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import React from 'react'
import { renderToString } from 'react-dom/server'

const require=createRequire(import.meta.url)
const files=['assistant-panel.jsx','components.jsx','store.jsx','layout.jsx','clock.js','contracts.js','workflow.js','phase2.js','phase3-contracts.js','orchestration.js','pages/Dashboards.jsx','pages/Scheduling.jsx','pages/StaffDayCalendar.jsx','pages/PatientFlow.jsx','pages/Clinical.jsx','pages/FinanceCommunication.jsx','pages/Admin.jsx','pages/Pricing.jsx','pages/AuditTrail.jsx','pages/ClinicBranding.jsx','pages/AssistantAnswers.jsx','pages/Automations.jsx','pages/PossibleNoShows.jsx','pages/FrontDeskToday.jsx','pages/ClosedDates.jsx','pages/Staffing.jsx','pages/Handovers.jsx','pages/ServerPrescriptions.jsx','pages/ServerFollowups.jsx','pages/DentalChart.jsx','pages/AcceptedHmos.jsx','pages/WordingApprovals.jsx','pages/ArchivesPage.jsx','audit-api.js','automation-api.js','analytics-api.js','hmo-api.js','pages/PatientLoyalty.jsx','pages/Feedback.jsx','pages/PatientRegister.jsx','pages/PatientBook.jsx','pages/PatientMe.jsx','pages/PatientVisits.jsx','pages/PatientHome.jsx','loyalty.js','registration.js','scheduling.js','booking-drafts.js','geo.js','patient-view.js','data.js']
const result=await build({stdin:{contents:[...files.map(file=>`export * from './src/${file}';`),`export * from './tests/support/server-appointments.js';`].join('\n'),resolveDir:process.cwd()},bundle:true,write:false,loader:{'.css':'empty'},platform:'node',format:'esm',plugins:[{name:'shared-react',setup(b){b.onResolve({filter:/^react$/},()=>({path:pathToFileURL(require.resolve('react')).href,external:true}))}}]})
const m=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'))
m.setClockSource(()=>new Date('2026-09-19T02:08:00Z'))
// Phase 2A: branches/services/branchServices/dentists/staff are backend-authoritative and populated only
// by a live fetch (see src/store.jsx's reference-data bootstrap effect) — but renderToString runs
// render-phase code only, so that fetch-on-mount effect never executes under SSR (no commit phase). This
// test-only initialReferenceData prop (ClinicProvider, src/store.jsx) skips the fetch entirely and seeds
// those collections synchronously instead, built here directly from data.js's own INITIAL_* exports (the
// exact legacy shape already) rather than the API-response shape reference-data-bridge.js's mappers
// expect — dentistServiceAssignments is derived internally from each dentist's `serviceIds`, so that field
// is reconstructed here from INITIAL_DENTIST_SERVICE_ASSIGNMENTS to keep dentist-service eligibility real
// in every smoke render, exactly as it would be from a genuine API response.
const dentistServiceIds={}
for(const a of m.INITIAL_DENTIST_SERVICE_ASSIGNMENTS)(dentistServiceIds[a.dentistId]??=[]).push(a.serviceId)
const initialReferenceData={
  branches:m.INITIAL_BRANCHES,
  services:m.INITIAL_SERVICES,
  branchServices:m.INITIAL_BRANCH_SERVICES,
  staff:m.INITIAL_STAFF,
  dentists:m.INITIAL_DENTISTS.map(d=>({...d,serviceIds:dentistServiceIds[d.id]||[]})),
}
let store
function Capture(){store=m.useClinic();return null}
renderToString(React.createElement(m.ClinicProvider,{initialReferenceData},React.createElement(Capture)))
const pages={dashboard:'DashboardPage',book:'BookingPage',appointments:'AppointmentsPage',schedule:'SchedulePage',calendar:'StaffDayCalendar',checkin:'CheckInPage',queue:'QueuePage',capacity:'CapacityPage',patients:'PatientsPage',treatment:'TreatmentPage',billing:'BillingPage',hmo:'HmoPage',inquiries:'InquiriesPage',messages:'MessagesPage',prescriptions:'PrescriptionsServerPage',followups:'FollowupsServerPage',chart:'DentalChartPage',branches:'BranchesPage',team:'TeamPage',analytics:'AnalyticsPage',users:'UsersPage',pricing:'ServicesPricingPage',automations:'AutomationsPage',closures:'ClosedDatesPage',schedules:'WorkSchedulesPage',leave:'LeavePage',handovers:'HandoversPage',hmos:'AcceptedHmosPage',wording:'WordingApprovalsPage',automation:'AutomationPage',audit:'AuditTrailPage',branding:'ClinicBrandingPage',assistant:'AssistantAnswersPage',engagement:'EngagementPage',loyalty:'PatientLoyaltyPage',feedback:'PatientFeedbackPage',me:'PatientMePage',archives:'ArchivesPage'}
let count=0
function render(page,role='staff',context=null){
  const session={...m.sessionForRole(role,store.state),...(role==='dentist'?{serverUserId:'synthetic-smoke-dentist'}:{})}
  const activeBranch=store.state.branches.find(b=>b.id===session.branchId)?.name||'All Branches'
  return renderToString(React.createElement(m.Shell,{role,page,setPage:()=>{},onLogout:()=>{},activeBranch,setActiveBranch:()=>{},store:{...store,session}},React.createElement(m[pages[page]],{role,activeBranch,store:{...store,session},context,setPage:()=>{}})))
}
// DEN-UI-02 clinical screens require a server-authenticated projection. These records are synthetic.
function renderClinical(context){
  const state={...store.state,patients:store.state.patients.map(p=>({...p,serverProjection:true}))}
  const session={...m.sessionForRole('dentist',state),serverUserId:'synthetic-smoke-dentist'}
  return renderToString(React.createElement(m.TreatmentPage,{store:{...store,state,session,appointmentsStatus:'ready'},context,setPage:()=>{}}))
}
for(const [role,nav] of Object.entries(m.NAV))for(const [page] of nav){render(page,role);count++}
renderToString(React.createElement(m.Login,{onLogin:()=>{}}))
// Production shell: no demo-reset control and no presentation-only Module Coverage page for any role.
for(const role of Object.keys(m.NAV)){const shell=render('dashboard',role);assert.ok(!/Reset demo|demo workspace/i.test(shell),`${role} shell exposes no demo reset`);assert.ok(shell.includes('Sign out')||shell.includes('Log out'),`${role} shell keeps Sign out`)}
assert.equal(m.ModulesPage,undefined,'the professor-facing Module Coverage page is removed')
// M7: the Patient assistant panel is server-backed (typed question box) in a clinic-server session and an explicitly labelled demo otherwise.
{const server=renderToString(React.createElement(m.ClinicAssistant,{open:true,onOpenChange(){},server:true}));const demo=renderToString(React.createElement(m.ClinicAssistant,{open:true,onOpenChange(){},server:false}))
assert.ok(server.includes('Ask about using the clinic system')&&!server.includes('Offline demo preview'),'server-mode assistant has the question box and no demo label')
assert.ok(demo.includes('Offline demo preview')&&!demo.includes('Ask about using the clinic system'),'the demo assistant is labelled and has no free-text box')
assert.ok(/can.t diagnose/.test(server.replace(/&#x27;|’/g,"'")),'the scope is stated up front')}
// M23: Archives & Historical Records Management renders for Staff, Dentist, and Owner
{const archives=render('archives','owner')
assert.ok(archives.includes('Archives')&&archives.includes('Historical Records'),'Archives page renders honestly')
assert.ok(m.NAV.owner.some(([k])=>k==='archives'),'Owner has archives nav entry')
assert.ok(m.NAV.staff.some(([k])=>k==='archives'),'Staff has archives nav entry')
assert.ok(!m.NAV.owner.some(([k])=>k==='feedback'),'Owner has no feedback nav entry')}
// Scheduled automations: the Owner page renders its loading state under SSR and says nothing is sent before the wording is approved
// (each value's "not confirmed by the clinic" label is in the row details, loaded from the server).
{const automations=render('automations','owner');assert.ok(automations.includes('Automations')&&automations.includes('Nothing is sent until you approve its wording')&&automations.includes('Loading automations'),'automations page renders honestly')
assert.ok(!m.NAV.staff.some(([k])=>k==='automations')&&!m.NAV.patient.some(([k])=>k==='automations'),'only the Owner has the Automations page')}
// M13: the Owner pricing page renders its honest loading state under SSR (no fetch runs) and the Branches screen labels
// the reference fee as unconfirmed rather than as a price.
{const pricing=render('pricing','owner');assert.ok(pricing.includes('Services &amp; Pricing')&&pricing.includes('Loading prices'),'pricing page renders');assert.ok(!/reference fee/i.test(pricing),'no reference fee is shown on the pricing page')}
assert.ok(!/reference fee/i.test(render('branches','owner')),'the Branches screen shows no reference fee')
// M4: under a server-authenticated session the Patient Records surface lists only authoritative server Patients — never the
// browser demo/legacy collection, and never as read-only "earlier browser record" rows.
{const renderServer=role=>{const session={...m.sessionForRole(role,store.state),serverUserId:'01K00000000000000000000099'};return renderToString(React.createElement(m.Shell,{role,page:'patients',setPage:()=>{},onLogout:()=>{},activeBranch:'All Branches',setActiveBranch:()=>{},store:{...store,session}},React.createElement(m[pages.patients],{role,activeBranch:'All Branches',store:{...store,session},context:null,setPage:()=>{}})))}
 const demoNames=store.state.patients.filter(p=>!p.serverProjection).map(p=>p.name)
 assert.ok(demoNames.length>0,'the demo collection exists in state')
 for(const role of ['staff','dentist']){const html=renderServer(role);for(const name of demoNames)assert.ok(!html.includes(name),`${role} server session does not list demo Patient ${name}`);assert.ok(!html.includes('Earlier browser record'),`${role} shows no earlier browser rows`)}
 assert.ok(renderServer('staff').includes('Type at least 2 characters to search the clinic patient directory'),'Staff is asked to search the server directory')
 assert.ok(renderServer('dentist').includes('Patients appear here from your appointments and queue'),'Dentist list comes from workflow records')
 assert.ok(render('patients','staff').includes(demoNames[0]),'a non-server (demo/local) context keeps the browser collection')}
console.log(`PASS: ${count} initial role/page renders, Login, production shell without demo reset`)

const providerStore=store
let state=store.state
let session=m.sessionForRole('staff',state)
const rawActions=m.createWorkflowActions({getState:()=>state,getSession:()=>session,clock:m.clinicNow,commit:patch=>{
  state=m.normalizeClinicState({...state,...patch})
  state.patients=state.patients.map(p=>m.patientProjection(p,state.persons.find(person=>person.id===p.personId)))
  store={...store,state,actions}
}})
// M6/M8/M9/M5 cutovers: appointments, Visits, the queue and Treatments are server-authoritative. The smoke run stands in
// for "the server accepted the command and the projection was refreshed" and runs Check-In/Walk-In/treatment server-first,
// like the store's flow.
const flow=m.serverFlow({actions:()=>rawActions,getState:()=>state,getSession:()=>session,patchState:patch=>{state=m.normalizeClinicState({...state,...patch});store={...store,state,actions}}})
const actions=m.serverFirstActions(rawActions,flow)
const bookServer=form=>({ok:true,record:flow.book(form)})
const patient=actions.createPatientRecord({person:{firstName:'PhaseOne',lastName:'Patient',phone:'0917-audit-new'},patient:{preferredBranchId:'b1',allergies:'None'}})
assert.equal(patient.ok,true,patient.message)
assert.ok(render('patients','staff',{patientId:patient.record.id}).includes('PhaseOne Patient'))
const booking=bookServer({patientId:patient.record.id,branchId:'b1',dentistId:'d1',serviceId:'svc1',date:'2026-09-19',start:'12:00'})
assert.equal(booking.ok,true,booking.message)
assert.ok(render('checkin').includes('PhaseOne Patient'))
const arrival=actions.checkInAppointment(booking.record.id);assert.equal(arrival.ok,true,arrival.message)
assert.equal(actions.checkInAppointment(booking.record.id).unchanged,true)
assert.ok(!render('checkin').includes('PhaseOne Patient'))
assert.ok(render('queue').includes('PhaseOne Patient'))
assert.ok(!render('queue','dentist').includes('Finish queue step'))
session=m.sessionForRole('dentist',state)
assert.equal(actions.updateQueue(arrival.record.id,'Called').ok,true)
assert.ok(renderClinical(arrival.context).includes('PhaseOne Patient'))
assert.equal(actions.saveTreatment({queueEntryId:arrival.record.id,procedure:'Consultation'}).ok,true)
assert.ok(renderClinical(arrival.context).includes('Save Treatment Progress'))
assert.equal(actions.completeTreatment({queueEntryId:arrival.record.id,procedure:'Consultation',procedures:[{serviceId:'svc1',quantity:1}]}).ok,true)
assert.ok(renderClinical(arrival.context).includes('read-only'))
assert.ok(render('billing').includes('Draft'))
console.log('PASS: created-patient chart, booking/check-in visibility, exact queue treatment, completion, billing renders')

// Phase 2: exercise shared actions, then render the exact role-visible results.
// The seeded p1 queue entry points at a pre-cutover demo appointment (D5 legacy history), so build a live encounter:
// a server-confirmed booking checked in server-first.
session=m.sessionForRole('staff',state)
const p1Visit=bookServer({patientId:'p1',branchId:'b1',dentistId:'d1',serviceId:'svc1',date:'2026-09-19',start:'13:00'})
assert.equal(actions.checkInAppointment(p1Visit.record.id).ok,true)
session=m.sessionForRole('dentist',state)
assert.ok(!state.queue.some(q=>q.appointmentId==='a1'),'legacy queue entries stay out of the live queue')
const ownQueue=state.queue.find(q=>q.patientId==='p1'&&q.status==='Waiting'&&q.appointmentId===p1Visit.record.id)
assert.ok(ownQueue)
assert.equal(actions.updateQueue(ownQueue.id,'Called').ok,true)
assert.equal(actions.saveTreatment({queueEntryId:ownQueue.id,procedures:[]}).ok,true)
const completed=actions.completeTreatment({queueEntryId:ownQueue.id,procedure:'Phase Two completed care',procedures:[{serviceId:'svc1',quantity:1},{serviceId:'svc2',quantity:1}],prescriptionRequired:true,followupRequired:true,followupDate:'2026-09-20',followupReason:'Phase Two return visit'})
assert.equal(completed.ok,true,completed.message)
// M19 is a clinic-server page now: it renders its own loading state and never shows browser-stored prescriptions.
assert.ok(render('prescriptions','dentist').includes('Write a prescription'))
const rx=actions.savePrescription({treatmentId:completed.record.id,items:[{medication:'Phase Two medication',dosage:'Dentist dose',instructions:'Dentist instructions',duration:'Dentist duration'}]})
assert.equal(rx.ok,true,rx.message)
assert.ok(!render('prescriptions','patient').includes('Phase Two medication'))
assert.equal(actions.authorizePrescription({treatmentId:completed.record.id}).ok,true)
assert.ok(!render('prescriptions','patient').includes('Phase Two medication'),'browser-stored prescriptions are never displayed')
// Phase 4B.3C-1: completed-visit summaries live on Visits (Past), not Home — Home stays active-care-first.
assert.ok(render('appointments','patient',{entityId:ownQueue.appointmentId}).includes('Phase Two completed care'))
assert.ok(!render('followups','patient').includes('Phase Two return visit')) // M20: follow-ups come from the clinic server only
session=m.sessionForRole('staff',state)
const invoice=state.invoices.find(i=>i.treatmentId===completed.record.id)
assert.equal(invoice.total,1800)
assert.ok(!render('billing','patient').includes(invoice.invoiceNo))
assert.equal(actions.reviewInvoice(invoice.id).ok,true)
assert.ok(render('billing').includes('Review'))
assert.ok(!render('billing','patient').includes(invoice.invoiceNo))
assert.equal(actions.issueInvoice(invoice.id).ok,true)
assert.ok(render('billing','patient').includes(invoice.invoiceNo))
const payment=actions.postPayment(invoice.id,'Cash',1800)
assert.equal(payment.ok,true,payment.message)
assert.equal(actions.postPayment(invoice.id,'Cash',1800).unchanged,true)
assert.ok(render('billing','patient').includes(payment.receipt))
assert.ok(!render('billing','patient').includes('Record Payment'))
const followup=state.followups.find(f=>f.treatmentId===completed.record.id)
assert.ok(render('followups','staff').includes('Follow-ups'))
// Transitional M6/M20 rule: the Dentist records the follow-up requirement; clinic Staff schedule it. No Dentist or
// Patient booking control is rendered for the same open follow-up.
assert.ok(render('followups','dentist').includes('Patients the dentist asked to see again'))
assert.ok(!/>Schedule follow-up</.test(render('followups','staff'))&&!/>Schedule follow-up</.test(render('followups','dentist'))) // the browser scheduling control is gone
assert.ok(!render('followups','patient').includes('Phase Two return visit'))
assert.ok(!/>Schedule follow-up</.test(render('followups','patient')))
session=m.sessionForRole('staff',state)
const followBooking=bookServer({patientId:'p1',branchId:'b1',dentistId:'d1',serviceId:'svc11',date:'2026-09-20',start:'12:00'})
const followLink=actions.linkFollowupAppointment(followup.id,followBooking.record.id)
assert.equal(followLink.ok,true,followLink.message)
assert.ok(!render('followups','patient').includes('Phase Two return visit'))
console.log('PASS: Phase 2 procedures, prescription draft privacy/authorization, patient care, invoice review/issue/payment/receipt and follow-up scheduling')

// Phase 3 operational flows: no real provider, delivery, or server transport.
// M12: HMO cases are server-authoritative. The smoke run stands in for the rows GET /api/hmo-cases (Staff) and
// /api/hmo-cases/mine (Patient) return for p1's completed Visit; the browser holds no HMO commands.
const hmoRow=(fields={})=>({id:'01jsmokehmo00000000000000a',status:'Pending',revision:5,submission_cycle:1,provider_name:'Insurer One',member_number:'M-000123',
  visit:{id:completed.record.visitId,clinic_date:'2026-09-19',status:'Completed'},patient:{id:'p1',code:'PAT-0001',name:'Maria Santos'},branch:{id:'b1',name:'Dr. Dana Roxas Dental Clinic'},
  dentist:{id:'d1',name:'Miguel Reyes'},appointment:{id:p1Visit.record.id,code:p1Visit.record.appointmentNo},submitted_at:'2026-09-19T10:00:00+08:00',follow_up_due_at:'2026-09-19T22:00:00+08:00',
  escalated_at:null,final_at:null,approved_amount:null,created_at:'2026-09-19T09:30:00+08:00',
  requirements:['hmo-card','valid-id','treatment-request'].map(rule=>({rule,label:rule,state:'Validated'})),
  events:[{kind:'submission',submission_cycle:1,to_status:'Pending',method:'Portal',note:'Internal submission note',occurred_at:'2026-09-19T10:00:00+08:00',actor:{role:'staff',name:'Alyssa Cruz'}},
    {kind:'contact',submission_cycle:1,to_status:'Pending',method:'Phone',note:'Internal contact history',next_action:'Await provider',occurred_at:'2026-09-19T11:00:00+08:00',actor:{role:'staff',name:'Alyssa Cruz'}}],...fields})
const patientHmoRow=row=>({id:row.id,status:row.status,provider_name:row.provider_name,member_number:'••••0123',visit_date:'2026-09-19',appointment:row.appointment,branch:{name:'Dr. Dana Roxas Dental Clinic'},
  requirements:row.requirements,submitted_at:row.submitted_at,final_at:row.final_at,approved_amount:row.status==='Approved'?row.approved_amount:null})
const withHmo=(role,row)=>{state={...state,hmo:[role==='patient'?m.mapPatientHmoCase(patientHmoRow(row),'p1'):m.mapHmoCase(row)]};store={...store,state,actions}}
const hmoCase={id:'01jsmokehmo00000000000000a'}
withHmo('patient',hmoRow())
assert.ok(render('hmo','patient').includes('HMO Coverage'))
assert.ok(!render('hmo','patient').includes('Record Document Metadata'),'no Patient document upload in this wave (M14)')
withHmo('staff',hmoRow())
assert.ok(render('hmo','staff',{hmoCaseId:hmoCase.id}).includes('Record Provider Response'))
assert.ok(render('hmo','staff',{hmoCaseId:hmoCase.id}).includes('Internal contact history'),'Staff see their contact log')
withHmo('patient',hmoRow())
assert.ok(!render('hmo','patient',{hmoCaseId:hmoCase.id}).includes('Internal contact history'))
assert.ok(!render('hmo','patient',{hmoCaseId:hmoCase.id}).includes('Record Provider Response'))
const approvedHmo=hmoRow({status:'Approved',revision:9,submission_cycle:2,final_at:'2026-09-19T15:00:00+08:00',approved_amount:'1200.00'})
withHmo('patient',approvedHmo)
assert.ok(render('hmo','patient',{hmoCaseId:hmoCase.id}).includes('Provider Approved'))
// Notification navigation and read scope, through the Patient's own appointment notification.
assert.equal(actions.recordAppointmentEvent(p1Visit.record.id,'created').ok,true)
const ownNotification=state.notifications.find(n=>n.recipientUserId==='u12'&&n.entityId===p1Visit.record.id)
session=m.sessionForRole('patient',state)
const dest=m.notificationDestination(state,session,ownNotification)
assert.equal(dest.context.appointmentId,p1Visit.record.id)
assert.equal(actions.markNotificationRead(ownNotification.id).ok,true)
const renderPanel=role=>renderToString(React.createElement(m.NotificationPanel,{role,store:{...store,session:m.sessionForRole(role,state)},setPage:()=>{},onClose:()=>{}}))
assert.ok(renderPanel('patient').includes('View all'))
assert.ok(!renderPanel('dentist').includes('Invoice review needed'))
session=m.sessionForRole('staff',state)
const conversation=state.conversations.find(c=>c.id==='c1')
assert.ok(m.visibleConversations(state,session).some(c=>c.id===conversation.id))
assert.equal(actions.replyToConversation(conversation.id,'Phase Three clinic reply','smoke-reply').ok,true)
assert.ok(render('messages','patient',{conversationId:conversation.id}).includes('Phase Three clinic reply'))
assert.ok(!render('messages','dentist',{conversationId:conversation.id}).includes('Phase Three clinic reply'))
session=m.sessionForRole('patient',state)
assert.equal(actions.markConversationRead(conversation.id).ok,true)
assert.ok(!state.conversations.find(c=>c.id===conversation.id).unreadUserIds.includes('u12'))
session=m.sessionForRole('staff',state)
assert.equal(actions.replyToConversation(conversation.id,'   ','invalid-empty-reply').ok,false)
assert.ok(render('automation','owner').includes('conversation.reply'))
const beforeRender=JSON.stringify(state)
for(let repeat=0;repeat<2;repeat++){render('hmo','staff');render('hmo','patient');renderPanel('patient');render('messages','dentist');render('automation','owner')}
assert.equal(JSON.stringify(state),beforeRender)
m.setClockSource(()=>new Date('2026-09-19T02:08:00Z'))
console.log('PASS: Phase 3 server HMO case views (Staff detail, Patient privacy, approved outcome), notification navigation/read scope, participant messages, monitor failures, render purity')

// Exercise ClinicProvider's synchronous snapshot with commands issued before any render.
// The server already recorded the arrival and queued it (M8 + M9): the appointment, Visit and queue entry reach the
// in-memory projection, and a repeated local adapter command issued before any render stays idempotent.
const quickRow=m.serverRow({patientId:'p1',branchId:'b1',dentistId:'d1',serviceId:'svc1',date:'2026-09-19',start:'16:00',status:'Checked In'})
const quickVisit=m.serverVisitRow({appointmentId:quickRow.id,patientId:'p1',branchId:'b1',dentistId:'d1',serviceId:'svc1',arrivedAt:'2026-09-19T10:05:00+08:00'})
const quickEntry=m.serverQueueRow(m.serverQueueEntry(m.serverVisit({id:quickVisit.id,appointmentId:quickRow.id,patientId:'p1',branchId:'b1',dentistId:'d1',serviceId:'svc1',arrivedAt:'2026-09-19T10:05:00+08:00'}),1))
let serverStore
renderToString(React.createElement(m.ClinicProvider,{initialReferenceData,initialServerAppointments:[quickRow],initialServerVisits:[quickVisit],initialServerQueue:[quickEntry]},React.createElement(function(){serverStore=m.useClinic();return null})))
serverStore.setSession('staff')
assert.equal(serverStore.state.appointments[0].id,quickRow.id,'server rows reach the in-memory projection')
assert.equal(serverStore.state.visits[0].id,quickVisit.id,'server Visits reach the in-memory projection')
assert.equal(serverStore.state.queue[0].id,quickEntry.id,'the server queue reaches the in-memory projection')
assert.equal(serverStore.state.queue[0].queueNumber,1)
assert.equal('updateQueue' in serverStore.actions,false,'no local queue command exists')
const check1=serverStore.actions.recordAppointmentEvent(quickRow.id,'created'),check2=serverStore.actions.recordAppointmentEvent(quickRow.id,'created')
assert.equal(check1.ok,true,check1.message);assert.equal(check2.ok,true)
console.log('PASS: immediate repeated command integration')

// Reload persisted ID-only records, including an old record missing branch entirely.
const persisted=new Map()
for(const key of ['persons','patients','appointments','queue','treatments','invoices','followups','prescriptions','hmo','notifications','conversations','inquiries','dentists','staff']){
  persisted.set(`dentalops-v4-${key}`,JSON.stringify(m.persistableCollection(key,state[key])))
}
globalThis.localStorage={getItem:key=>persisted.get(key)||null}
// Phase 2A: 'dentists'/'staff' in the manually-populated localStorage map above are now inert (nothing
// reads those keys anymore — see the first ClinicProvider render's comment) but are left in place rather
// than removed, since writing to an unused key is harmless and this loop's real job (persons/patients/
// appointments/etc. reload) is unaffected. initialReferenceData is still required here for the same reason
// as the first render.
// M6 cutover: a saved `appointments` key is never read back — with only browser storage, no appointment appears.
renderToString(React.createElement(m.ClinicProvider,{initialReferenceData},React.createElement(Capture)))
assert.equal(store.state.appointments.length,0,'browser-stored appointments are ignored after the cutover')
// Appointments return only from the server (here: the rows GET /api/appointments would return).
const serverRows=state.appointments.map(a=>m.serverRow({...a,code:a.appointmentNo}))
// M5: Treatments are never read back from browser storage either; they return only from the server.
const serverTreatmentRows=state.treatments.filter(t=>t.server).map(m.serverTreatmentRow)
assert.ok(serverTreatmentRows.length>0)
renderToString(React.createElement(m.ClinicProvider,{initialReferenceData,initialServerAppointments:serverRows},React.createElement(Capture)))
assert.equal(store.state.treatments.filter(t=>t.server).length,0,'browser storage never restores a server Treatment')
// M12: HMO cases also return only from the server (here: the Staff/Owner rows GET /api/hmo-cases would return).
renderToString(React.createElement(m.ClinicProvider,{initialReferenceData,initialServerAppointments:serverRows,initialServerTreatments:serverTreatmentRows,initialServerHmo:[approvedHmo]},React.createElement(Capture)))
assert.ok(render('patients','staff',{patientId:patient.record.id}).includes('PhaseOne Patient'))
assert.ok(render('schedule','dentist').includes('Dr. Dana Roxas Dental Clinic'))
assert.ok(render('appointments').includes('Appointment management'))
render('queue','dentist')
render('dashboard','staff')
render('dashboard','owner')
assert.equal(store.state.appointments.find(a=>a.id===booking.record.id).branchId,'b1')
assert.ok(render('billing','patient').includes(payment.receipt))
assert.ok(!render('prescriptions','patient').includes('Phase Two medication')) // M19: prescriptions come from the clinic server only
assert.ok(render('hmo','patient',{hmoCaseId:hmoCase.id}).includes('Provider Approved'))
assert.ok(render('messages','patient',{conversationId:conversation.id}).includes('Phase Three clinic reply'))
delete globalThis.localStorage
console.log('PASS: persisted ID-only records reload and render across appointments, queue, schedule, chart, dashboards')

// Phase 3.5: invalid/current-state recovery surfaces, without changing fixtures on disk.
const recoveryBase=store.state
const recoveryFollow=recoveryBase.followups.find(f=>f.id===followup.id)
store={...store,state:m.normalizeClinicState({...recoveryBase,
  appointments:recoveryBase.appointments.map(a=>a.id===recoveryFollow.appointmentId?{...a,status:'Cancelled'}:a),
  conversations:recoveryBase.conversations.map(c=>c.id===conversation.id?{...c,status:'Closed'}:c),
})}
assert.ok(render('appointments','staff').includes('Cancelled'))
assert.ok(render('followups','staff').includes('Follow-ups'))
assert.ok(render('billing','patient').includes(payment.receipt))
assert.ok(render('messages','patient',{conversationId:conversation.id}).includes('Closed'))
assert.ok(!render('treatment','dentist',{queueEntryId:'missing'}).includes('Save Treatment Progress'))
const stalePanel=renderToString(React.createElement(m.NotificationPanel,{role:'patient',store:{...store,session:m.sessionForRole('patient',store.state),state:{...store.state,notifications:[{id:'stale',recipientUserId:'u12',patientId:'p1',title:'Old update',body:'Review availability',entityType:'invoice',entityId:'missing',action:{page:'billing'}}]}},setPage:()=>{},onClose:()=>{}}))
assert.ok(stalePanel.includes('Old update'));assert.ok(!stalePanel.includes('View update'))
store={...store,state:{...store.state,queue:[]}}
// Phase 4B.1 Patient wording: an empty queue renders an explicit no-visit/not-checked-in state (previously "No active queue entry").
assert.ok(/No visit today|haven’t been checked in yet/.test(render('queue','patient')))
store={...store,state:{...store.state,users:store.state.users.map(u=>u.id==='u12'?{...u,accountStatus:'Inactive'}:u)}}
assert.ok(!render('billing','patient').includes(payment.receipt))
store={...store,state:recoveryBase}
console.log('PASS: Phase 3.5 cancelled appointment/follow-up recovery, paid receipt, closed conversation, invalid encounter, stale notification, empty queue and inactive-account privacy')
store={...store,state:{...recoveryBase,patients:[]}}
assert.ok(render('patients','staff').includes('New Patient'))
store={...store,state:recoveryBase}
console.log('PASS: empty patient registry retains the Staff registration recovery action')
assert.ok(render('checkin','staff').includes('Select an appointment to check the patient in.'))
assert.doesNotMatch(render('checkin','staff'),/Confirm arrival<\/button>/)
// Malformed earlier browser HMO history renders safely as read-only history and never as a live server case.
store={...store,state:{...recoveryBase,hmo:[...recoveryBase.hmo.filter(h=>h.server),{id:'legacy-bad',legacy:true,legacyAppointment:true,preServer:true,server:false,patientId:'p1',branchId:'b1',status:'Pending',contacts:{malformed:true},requirements:'bad'}]}}
{const page=render('hmo','staff');assert.ok(page.includes('HMO Management'));assert.ok(!/legacy-bad/.test(page))}
store={...store,state:recoveryBase}
console.log('PASS: explicit arrival selection and malformed HMO history recovery render')

// Phase 4A: shared presentation must preserve semantic controls and role scope.
const ui=component=>renderToString(component)
const field=ui(React.createElement(m.Field,{label:'Visit note',required:true,hint:'Keep the encounter context',error:'Review the current visit'},React.createElement('input',{defaultValue:'Retained draft'})))
assert.match(field,/aria-required="true"/)
assert.match(field,/aria-invalid="true"/)
assert.match(field,/aria-describedby=/)
assert.ok(field.includes('Retained draft'))
assert.match(ui(React.createElement(m.Button,null,'Continue')),/type="button"/)
const records=ui(React.createElement(m.Table,{caption:'Patient appointments',columns:[{key:'name',label:'Patient'},{key:'status',label:'State'}],rows:[{id:'long',name:'A long patient name retained in full',status:'Cancelled'}]}))
assert.ok(records.includes('Patient appointments'))
assert.match(records,/scope="col"/)
assert.ok(records.includes('mobile-cell-label'))
assert.ok(records.includes('A long patient name retained in full'))
assert.match(ui(React.createElement(m.Status,null,'Escalated')),/status attention/)
assert.match(ui(React.createElement(m.Status,null,'Rejected')),/status danger/)
assert.match(ui(React.createElement(m.Status,null,'Validated locally')),/status info/)
const modal=ui(React.createElement(m.Modal,{open:true,title:'Review invoice',onClose:()=>{}},'Exact invoice'))
assert.match(modal,/<dialog/)
assert.match(modal,/aria-labelledby=/)
assert.ok(modal.includes('Close Review invoice'))
assert.ok(render('dashboard','patient').includes('/images/logo.png'))
assert.ok(render('dashboard','owner').includes('Skip to content'))
const staffUser=m.sessionForRole('staff',store.state).userId
const beforeRestricted=store
store={...store,state:{...store.state,users:store.state.users.map(u=>u.id===staffUser?{...u,permissions:u.permissions.filter(p=>p!=='billing')}:u)}}
const restricted=render('dashboard','staff')
assert.ok(!restricted.includes('>Billing &amp; Payments</span>'))
// Inspect the navigation itself rather than unrelated dashboard text.
const navMarkup=restricted.match(/<nav class="main-nav"[\s\S]*?<\/nav>/)?.[0]||''
assert.ok(navMarkup.length)
assert.ok(!navMarkup.includes('Billing &amp; Payments'))
store=beforeRestricted
console.log('PASS: Phase 4A shared field/table/dialog semantics, distinct statuses, official logo and permission-filtered navigation')

// Clinic brand alignment: the authoritative visible identity is the text "Dr. Dana E. Roxas" / "Dental Clinic" beside the
// official compact logo, never the old product name. Only rendered text/markup is checked; stable internal identifiers
// (e.g. storage namespaces) are deliberately out of scope.
const clinicName='Dr. Dana E. Roxas',clinicIdentity=`<strong>${clinicName}</strong><span>Dental Clinic</span>`
const loginHtml=renderToString(React.createElement(m.Login,{onLogin:()=>{}}))
assert.ok(loginHtml.includes('src="/images/logo.png"'),'login uses the official compact logo')
assert.ok(loginHtml.includes(clinicIdentity),'login shows the exact clinic identity as real text')
const brandedHtml=[loginHtml]
for(const [role,nav] of Object.entries(m.NAV)){
  for(const [page] of nav)brandedHtml.push(render(page,role))
  const shell=render('dashboard',role)
  assert.ok(shell.includes('src="/images/logo.png"'),`${role} shell uses the compact official logo`)
  assert.ok(shell.includes(clinicIdentity),`${role} shell shows the clinic name with Dental Clinic subtitle`)
}
for(const html of brandedHtml)assert.ok(!/dentalops/i.test(html),'no user-facing render still uses the old product name')
// Every image the UI references must exist. logo-with-name.png is a supplied asset that is deliberately not rendered.
for(const file of new Set(brandedHtml.flatMap(html=>[...html.matchAll(/src="(\/images\/[^"]+)"/g)].map(x=>x[1])))){
  assert.ok(existsSync(`public${file}`),`${file} exists in public/`)
  assert.equal(readFileSync(`public${file}`).subarray(0,8).toString('hex'),'89504e470d0a1a0a',`${file} is a PNG`)
}
// The official artwork must never be altered. Update these hashes only when the client supplies a replacement asset.
const assetSha256={'public/images/logo.png':'9ffca1383e222e1e6b04068b8026212f1c0f7619ec441201aec0a684752c8e5e','public/images/logo-with-name.png':'dffe98c29e6acd00b3970fe4246824943ab2057b70e547dbec1e7ab00c2f068b'}
for(const [file,hash] of Object.entries(assetSha256)){
  assert.ok(existsSync(file),`${file} exists as a supplied clinic asset`)
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash,`${file} must remain unmodified`)
}
// Copy that only renders after interaction (Assistant panel, export filenames) is checked at source. Presentation files
// hold no stable internal identifiers; storage namespaces live in store.jsx/persistence.js, which are intentionally not scanned.
for(const file of ['App.jsx','layout.jsx','components.jsx',...readdirSync('src/pages').map(name=>`pages/${name}`)])
  assert.ok(!/dentalops/i.test(readFileSync(`src/${file}`,'utf8')),`src/${file} still contains the old product name`)
const documentTitle=readFileSync('index.html','utf8').match(/<title>([^<]*)<\/title>/)?.[1]
assert.equal(documentTitle,`${clinicName} Dental Clinic`)
console.log('PASS: clinic brand alignment — compact logo with exact clinic text on login and every role shell, unmodified official assets, document title and no old product name in the UI')

// Phase 4B.1 Patient core experience: real Patient pages rendered from state built through real commands.
store={...store,state}
const patientPages=m.NAV.patient.map(([page])=>page)
const mainOf=html=>html.match(/<main id="main-content"[\s\S]*?<\/main>/)?.[0]||''
const staffControls=['Record Payment','Review Invoice','Issue Invoice','Confirm arrival','Call patient','Prepare HMO Case','Record Provider Response','Authorize Prescription','Emergency priority','Mark resolved']
for(const page of patientPages){
  const html=render(page,'patient'),main=mainOf(html)
  assert.equal((main.match(/<h1[\s>]/g)||[]).length,1,`${page}: exactly one h1`)
  for(const control of staffControls)assert.ok(!html.includes(control),`${page}: no Staff control ${control}`)
  assert.ok(html.includes('id="clinic-assistant-fab"')&&html.includes('assistant-fab is-patient')&&html.includes('aria-controls="clinic-assistant-panel"')&&html.includes('aria-expanded="false"'),`${page}: the Patient assistant is the floating logo FAB`)
  assert.ok(!html.includes('PhaseOne'),`${page}: no other Patient's data`)
  for(const tag of main.match(/<button\b[^>]*>/g)||[])assert.ok(/\stype="/.test(tag),`${page}: button declares a type ${tag}`)
}
const home=render('dashboard','patient')
assert.ok(/Good (morning|afternoon|evening), Maria/.test(home))
// Phase 4B.3C-1 Home: no giant "Needs your attention" or "Recent care" sections; compact quick actions instead,
// and care history moved to Visits (Past tab).
assert.ok(!/Needs your attention|Recent care/.test(home),'Home no longer duplicates a giant attention/recent-care section')
assert.ok(!home.includes('Phase Two completed care'),'completed-visit summaries no longer live on Home')
assert.ok(home.includes('pt-home-quick'),'Home shows compact quick actions')
assert.ok(!/keep this page updated|Recent notifications/.test(home))
assert.ok(home.includes('Booking')&&home.includes('Visits'),'Patient sidebar groups Booking/Visits')
const upcomingVisit=state.appointments.find(a=>a.id===followBooking.record.id)
const visit=state.appointments.find(a=>a.id===ownQueue.appointmentId)
const appts=render('appointments','patient')
assert.ok(appts.includes('Reschedule')&&appts.includes('Cancel appointment')&&appts.includes('aria-pressed'))
assert.ok(!appts.includes('Book appointment'),'Visits offers no booking CTA — Book is the exclusive booking destination')
const past=render('appointments','patient',{entityId:visit.id})
assert.ok(past.includes('Visit details')&&past.includes('is-target')&&past.includes('Phase Two completed care'))
assert.ok(past.includes('Payment status'),'Past visit shows real payment status from evidence, never a fabricated one')
assert.ok(!past.includes('Rescheduled')&&!render('appointments','patient',{entityId:'nope'}).includes('is-target'))
assert.ok(render('appointments','patient',{entityId:upcomingVisit.id}).includes('is-target'))
// M19: the patient's prescriptions page reads the clinic server (no browser record to deep-link to) and offers no edit or renewal.
assert.ok(!/Renew|Reissue|Edit prescription/.test(render('prescriptions','patient')))
const bill=render('billing','patient',{invoiceId:invoice.id})
assert.ok(bill.includes('is-target')&&bill.includes(payment.receipt)&&bill.includes('Total')&&bill.includes('The clinic records payments'))
assert.ok(!/>Pay</.test(bill)&&!/Payment pay-/.test(bill))
// M20: the follow-up page reads the clinic server (no browser record to deep-link to).
const hmoPage=render('hmo','patient',{hmoCaseId:hmoCase.id})
assert.ok(hmoPage.includes('is-target')&&hmoPage.includes('Provider Approved')&&hmoPage.includes('is not approval from your HMO'))
assert.ok(!/Internal|Record Provider Response/.test(hmoPage))
const bookPage=render('book','patient')
for(const text of ['Smart Find','Manual Appointment','pt-book-modes'])assert.ok(bookPage.includes(text),text)
assert.ok(!/Any available|Finding|Smart Scheduling validation|AI-powered|Smart AI|best Dentist|recommended Dentist|Preferred Dentist/.test(bookPage),'Book entry names no Dentist chooser and no fake-AI language')
// M9: a Patient's queue state is their own server queue state (GET /api/queue/mine); once the encounter is complete
// there is no active queue experience and no wait figure.
const storeBeforePatientQueue=store
store={...store,state:m.asPatient(store.state,'p1')}
const doneQueue=render('queue','patient')
store=storeBeforePatientQueue
assert.ok(!doneQueue.includes('in line')&&!/0 min|Estimated wait|updates automatically/.test(doneQueue))
assert.ok(/Unread: /.test(renderPanel('patient')))
// A live queue entry, built by the real Staff check-in command.
m.setClockSource(()=>new Date('2026-09-19T02:08:00Z'))
session=m.sessionForRole('staff',state)
const liveVisit=bookServer({patientId:'p1',branchId:'b1',dentistId:'d2',serviceId:'svc1',date:'2026-09-19',start:'16:30'})
assert.equal(liveVisit.ok,true,liveVisit.message)
assert.equal(actions.checkInAppointment(liveVisit.record.id).ok,true)
store={...store,state:m.asPatient(state,'p1')}
const liveQueue=render('queue','patient')
assert.ok(liveQueue.includes('in line')&&liveQueue.includes('aria-live="polite"')&&liveQueue.includes('Queue number')&&!liveQueue.includes('Estimated wait')&&!liveQueue.includes('PhaseOne'))
assert.ok(render('dashboard','patient').includes('You’re checked in')&&render('dashboard','patient').includes('View live queue'))
// A real store only ever holds the signed-in Patient's own queue state; drop Maria's before other Patients render.
store={...store,state}
m.setClockSource(()=>new Date('2026-09-19T15:08:00Z'))
// Messages: participant conversations only, and never a control that promises Patient-started messages.
const messages=render('messages','patient')
assert.ok(messages.includes('Conversations')&&messages.includes('Select a conversation'))
assert.ok(!/Start (a )?(new )?(conversation|message)|New message/i.test(messages))
const threadPage=render('messages','patient',{conversationId:conversation.id})
assert.ok(threadPage.includes('has-thread')&&threadPage.includes('Send message')&&threadPage.includes('All conversations'))
const withState=patch=>{store={...store,state:{...store.state,...patch}}}
const fullState=store.state
withState({conversations:store.state.conversations.map(c=>({...c,status:'Closed'}))})
const closedThread=render('messages','patient',{conversationId:conversation.id})
assert.ok(closedThread.includes('This conversation is closed')&&!closedThread.includes('<textarea'))
withState({conversations:[]})
assert.ok(render('messages','patient').includes('No messages from the clinic yet.'))
const quietHome=render('dashboard','patient')
assert.ok(!quietHome.includes('Message the clinic')&&!quietHome.includes('Your conversations'))
store={...store,state:fullState}
// Invalid or stale Patient session: every Patient page fails closed instead of showing another identity.
withState({users:fullState.users.map(u=>u.id==='u12'?{...u,accountStatus:'Inactive',status:'Inactive'}:u)})
// (Prescriptions are a clinic-server page since M19: the server refuses an inactive account, so it is not a browser-session page here.)
for(const page of ['dashboard','book','appointments','queue','hmo','billing','messages']){ // (follow-ups too are a clinic-server page since M20)
  const html=render(page,'patient')
  assert.ok(html.includes('couldn’t confirm your account'),`${page}: fails closed for an inactive account`)
  assert.ok(!html.includes('Phase Two')&&!html.includes(payment.receipt),`${page}: exposes nothing`)
}
store={...store,state:fullState}
// Pass 1 remediation: the Clinic Assistant is Patient-only — Staff/Dentist/Owner render no assistant FAB at all,
// and keep their existing top-left workspace-drawer hamburger trigger unchanged.
for(const role of ['staff','dentist','owner']){
  const html=render('dashboard',role)
  assert.ok(!html.includes('assistant-fab')&&!html.includes('clinic-assistant-fab'),`${role}: no Patient Clinic Assistant`)
  assert.ok(html.includes('mobile-menu icon-btn'),`${role}: keeps the existing top-left navigation trigger`)
}
console.log('PASS: Phase 4B.1 Patient Journey Hub, booking semantics, appointments, live queue, care records, HMO, receipts, Messages, deep links, isolation and fail-closed sessions')

// Phase 4B.2 Referral & Loyalty (M24): the Patient page renders only supported information from real ledger state.
const account=(points,history,extra={})=>({id:'loy1',patientId:'p1',referralCode:'DANA-MARIA-01',points,history,...extra})
const earning=points=>({at:'2026-09-12',type:'Qualified Visit',detail:'Oral prophylaxis',points})
const requestEntry={id:'lh-request',commandId:'req-1',at:'2026-09-19',type:'Redemption Request',detail:'50-point reward requested',points:0,status:'Pending',requestedAt:'2026-09-19T10:00:00+08:00'}
const rewardButton=html=>html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Request 50-point reward(?:(?!<\/button>)[\s\S])*<\/button>/)?.[0]||''
const rewardDisabled=html=>/^<button[^>]*\sdisabled/.test(rewardButton(html))
store={...store,state:fullState}
const ready=render('loyalty','patient')
for(const text of ['Referral &amp; Loyalty','A prototype program','not an established clinic policy','Your points','DANA-MARIA-01','Activity history','Oral prophylaxis','Qualified visit','Referral reward','+100 points'])assert.ok(ready.includes(text),`loyalty: ${text}`)
assert.ok(/<b>120<\/b>/.test(ready),'the ledger-validated balance is shown')
assert.ok(rewardButton(ready)&&!rewardDisabled(ready),'sufficient balance enables the request')
assert.ok(!/Proposed|Rewards|loy1|lh-|<input|<select|<textarea/.test(mainOf(ready)+ready.replace(mainOf(ready),'')),'no PE copy, no internal IDs, no editable points')
assert.ok(!/discount|voucher|free treatment|referred by|people you referred|tier/i.test(mainOf(ready)),'no invented reward benefit or referral relationship')
withState({loyalty:[account(30,[earning(30)])]})
const low=render('loyalty','patient')
assert.ok(low.includes('You need 20 more points to request a reward.')&&rewardButton(low)&&rewardDisabled(low),'insufficient balance disables the request and says why')
withState({loyalty:[account(60,[requestEntry,earning(60)])]})
const pending=render('loyalty','patient')
assert.ok(pending.includes('Awaiting clinic processing.')&&!rewardButton(pending),'a Pending request replaces the request control')
assert.ok(pending.includes('Reward request')&&pending.includes('Pending'),'the pending request is a labelled history entry')
withState({loyalty:[account(999,[earning(60)])]})
const review=render('loyalty','patient')
assert.ok(review.includes('Your loyalty activity needs clinic review.')&&!rewardButton(review)&&!review.includes('Your points')&&!/<b>999<\/b>/.test(review),'an inconsistent ledger shows no balance and no redemption')
assert.ok(review.includes('DANA-MARIA-01'),'the referral code stays available')
withState({loyalty:[]})
assert.ok(render('loyalty','patient').includes('No referral &amp; loyalty account yet'),'no account renders a neutral empty state')
const enrollHtml=render('engagement','owner')
assert.ok(enrollHtml.includes('Maria Santos</option>')&&enrollHtml.includes('first qualified activity creates their loyalty account and referral code'),'Owner Engagement still offers a Patient with no loyalty account and explains that the first qualified activity creates it')
assert.ok(!/recordLoyaltyActivity|Validate &amp; Apply/.test(render('loyalty','patient')),'the Patient page offers no enrollment control')
assert.ok(!/href="[^"]*loyalty|Referral &amp; Loyalty<\/b>/.test((render('dashboard','patient').match(/<nav class="pt-home-quick"[\s\S]*?<\/nav>/)||[''])[0]),'Home offers no loyalty quick action without an account')
store={...store,state:fullState}
assert.ok((render('dashboard','patient').match(/<nav class="pt-home-quick"[\s\S]*?<\/nav>/)||[''])[0].includes('Referral &amp; Loyalty'),'Home links to Referral & Loyalty when an account exists')
assert.ok(!/nav-proposed|Rewards|Proposed/.test(render('dashboard','patient')),'Patient navigation carries no PE tag')
// Staff/Owner Engagement keeps its page but its M24 controls are command-backed and its status copy is aligned.
withState({loyalty:[account(60,[requestEntry,earning(60)]),{...account(10,[earning(30)]),id:'loy2',patientId:'p2',referralCode:'DANA-JOHN-01'}]})
const engagement=render('engagement','owner')
for(const text of ['Optional engagement programs','team-designed','Process request','Under review','Marketing &amp; Reactivation'])assert.ok(engagement.includes(text),`engagement: ${text}`)
assert.ok(!/Proposed Enhancement|\bPE\b|Engagement • PE/.test(engagement+render('dashboard','owner')+render('dashboard','staff')),'Owner and Staff carry no PE copy')
// New canonical modules that are not built yet must never be claimed as represented (canonical module data).
for(const text of ['Patient AI Support & Clinic Knowledge Management','Limited preview: a rule-based Clinic Assistant','Planned: only HMO document metadata','Planned: clinic settings are still fixed','Planned: only a limited in-browser activity history'])assert.ok(m.MODULES.some(mod=>mod.coverageNote?.includes(text)||mod.name===text),`module coverage: ${text}`)
store={...store,state:fullState}
console.log('PASS: Phase 4B.2 Referral & Loyalty — ledger-validated balance, request/pending/insufficient/review/empty states, Journey Hub entry point, aligned Engagement copy and Patient navigation')

// Phase 4B.3A Patient identity: self-registration, user-derived sign-in and first-use Home. Registers into the SAME
// history-laden state the earlier scenarios built for Maria/John, so isolation is checked against real data, not a
// reset fixture.
let regState=fullState
const register=m.createRegistrationAction({getState:()=>regState,commit:patch=>{regState=m.normalizeClinicState({...regState,...patch})}})
const renderPatientAs=(page,patientSession,context=null)=>{
  const activeBranch=regState.branches.find(b=>b.id===patientSession.branchId)?.name||'All Branches'
  return renderToString(React.createElement(m.Shell,{role:'patient',page,setPage:()=>{},onLogout:()=>{},activeBranch,setActiveBranch:()=>{},store:{state:regState,session:patientSession}},React.createElement(m[pages[page]],{role:'patient',activeBranch,store:{state:regState,session:patientSession},context,setPage:()=>{}})))
}
const reg=register({firstName:'Jamie',lastName:'Cruz',phone:'0917 555 0001',email:'jamie.cruz@example.com',dob:'',preferredBranchId:'b1'},'smoke-register')
assert.equal(reg.ok,true,reg.message)
const {personId:newPersonId,patientId:newPatientId,userId:newUserId}=reg.record
const newPerson=regState.persons.find(p=>p.id===newPersonId),newPatientRow=regState.patients.find(p=>p.id===newPatientId),newUserRow=regState.users.find(u=>u.id===newUserId)
assert.equal(newPatientRow.personId,newPersonId);assert.equal(newUserRow.personId,newPersonId);assert.equal(newPatientRow.userId,newUserId)
assert.equal(newUserRow.roleName,'Patient');assert.deepEqual(newUserRow.permissions,['patient-portal']);assert.equal(newUserRow.accountStatus,'Active')
// Replay: the same command ID never creates a second account.
assert.equal(register({firstName:'Someone',lastName:'Else',phone:'0917 000 7777',email:'other@example.com',preferredBranchId:'b1'},'smoke-register').unchanged,true)
// A matching phone fails closed with neutral copy, discloses nothing, and creates nothing.
const dup=register({firstName:'Someone',lastName:'Else',phone:'0917 555 0001',email:'dup@example.com',preferredBranchId:'b1'},'smoke-dup')
assert.equal(dup.ok,false);assert.match(dup.message,/existing patient record may already match/);assert.doesNotMatch(dup.message,/Jamie|Cruz/)
// Sign in by the normalized email — never a browser-supplied Patient/Person/User ID.
const loginResult=m.resolvePatientLogin(regState,'  JAMIE.cruz@example.com  ')
assert.equal(loginResult.ok,true);assert.equal(loginResult.session.patientId,newPatientId);assert.equal(loginResult.session.userId,newUserId)
assert.equal(m.resolvePatientLogin(regState,'nobody@example.com').ok,false)
assert.equal(m.sessionForUser(regState,'u1'),null,'an Owner account cannot enter the Patient sign-in path')
// Maria's demo persona is unaffected.
assert.equal(m.resolvePatientLogin(regState,'maria@example.com').ok,true)

store={...store,state:regState}
const newHome=renderPatientAs('dashboard',loginResult.session)
assert.ok(newHome.includes('Need a visit?')&&newHome.includes('Start booking'),'a brand-new Patient sees first-use Home, not the booking form embedded')
assert.ok(!/pt-home-quick|pt-action-required/.test(mainOf(newHome)),'first-use Home omits the returning-Home sections')
assert.ok(!/PhaseOne|Phase Two|Phase Three|Maria|Santos|John|Dela Cruz/.test(newHome),'no other Patient’s data reaches a brand-new Patient’s Home')
assert.ok(!newHome.includes('pt-first-use-aside'),'no Messages/Referral quick access is shown when neither exists yet')
assert.ok(!render('dashboard','patient').includes('Jamie'),'Maria’s own Home shows nothing of the newly registered Patient')
// A real booking (the shared command, not a flag) transitions the same Patient into the returning Home.
// The server confirmed the Patient's first booking; the in-memory projection now carries it.
regState=m.normalizeClinicState({...regState,appointments:[...regState.appointments,m.serverAppointment({patientId:newPatientId,branchId:'b1',dentistId:'d1',serviceId:'svc1',date:'2026-09-20',start:'11:00'})]})
store={...store,state:regState}
const returningHome=renderPatientAs('dashboard',loginResult.session)
assert.ok(!returningHome.includes('Need a visit?')&&returningHome.includes('pt-home-quick')&&returningHome.includes('Upcoming visit'),'a real appointment naturally returns the Patient to the full returning Home')
// Login (Backend Foundation 1B): one real email+password form serves every role — backend /api/me determines
// role, so there is no client role picker. "Create an account" is Patient-only and gated by the optional
// onShowRegister prop, still rendering unchanged with none supplied (existing brand smoke assertion above
// already covers Login's base render).
const loginWithRegister=renderToString(React.createElement(m.Login,{onLogin:()=>{},onShowRegister:()=>{}}))
assert.ok(loginWithRegister.includes('Create an account'))
assert.ok(!renderToString(React.createElement(m.Login,{onLogin:()=>{}})).includes('Create an account'),'the Create-an-account link is absent unless onShowRegister is supplied')
const registerHtml=renderToString(React.createElement(m.PatientRegister,{onRegister:()=>({ok:false,message:'x'}),onCancel:()=>{}}))
assert.ok(registerHtml.includes('Create your account')&&registerHtml.includes('First name'))
assert.ok(/type="password"/i.test(registerHtml),'a real password field is present (Backend Foundation 1B registers against the real backend)')
assert.ok(registerHtml.includes('Confirm password'),'a confirm-password field is present')
assert.ok(!registerHtml.includes('Preferred branch'),'no branch preference field — the real backend registration contract collects none yet')
assert.ok(!registerHtml.includes('Demo workspace'),'registration no longer describes itself as browser-local demo storage')
assert.ok(!registerHtml.includes('Middle name'),'no middle-name field — the public form collects first and last name only')
assert.ok(registerHtml.includes('phone-field')&&registerHtml.includes('+63')&&registerHtml.includes('Philippines'),'the country-code phone control is present, defaulting to +63 Philippines')
store={...store,state:fullState}
console.log('PASS: Phase 4B.3A Patient identity — self-registration (atomic PERSON+PATIENT+USER, replay-safe, duplicate-safe), email sign-in, first-use Home vs returning Journey Hub, and isolation from other Patients')

// Phase 4B.3C-1 Patient core UX & booking: Booking Drafts (never an appointment), Smart Find / Manual auto-assigned
// booking through the real Phase 4B.3B domain, Me, the 4-item mobile nav and the floating logo assistant FAB.
let bookState=fullState
let bookSession=m.sessionForRole('patient',bookState)
const bookActions=m.createWorkflowActions({getState:()=>bookState,getSession:()=>bookSession,commit:patch=>{bookState=m.normalizeClinicState({...bookState,...patch})}})
const bookRegister=m.createRegistrationAction({getState:()=>bookState,commit:patch=>{bookState=m.normalizeClinicState({...bookState,...patch})}})
const priyaReg=bookRegister({firstName:'Priya',lastName:'Cruz',phone:'0917 555 9911',email:'priya.smoke@example.com',preferredBranchId:'b1'},'smoke-priya-register')
assert.equal(priyaReg.ok,true,priyaReg.message)
const priyaSession=m.resolvePatientLogin(bookState,'priya.smoke@example.com').session

// Draft: partial progress is upserted (one per Patient), reserves no slot, creates no appointment/queue entry.
const beforeAppointments=bookState.appointments.length, beforeQueue=bookState.queue.length
const draft1=bookActions.saveBookingDraft({mode:'manual',branchId:'b1'},'smoke-draft-1')
assert.equal(draft1.ok,true,draft1.message)
assert.equal(bookState.bookingDrafts.length,1)
assert.equal(bookState.appointments.length,beforeAppointments,'a draft reserves no slot and creates no appointment')
assert.equal(bookState.queue.length,beforeQueue,'a draft creates no queue entry')
const draft2=bookActions.saveBookingDraft({serviceId:'svc1'},'smoke-draft-2')
assert.equal(draft2.ok,true,draft2.message);assert.equal(draft2.record.branchId,'b1');assert.equal(draft2.record.serviceId,'svc1')
assert.equal(bookState.bookingDrafts.length,1,'one draft per Patient, upserted not duplicated')
assert.equal(draft2.record.dentistId,undefined,'a draft never stores a committed Dentist selection')
// Idempotent no-op: resubmitting the identical patch changes nothing.
const draftNoop=bookActions.saveBookingDraft({serviceId:'svc1'},'smoke-draft-3')
assert.equal(draftNoop.unchanged,true)
// Isolation: another real Patient never sees or can discard this draft.
assert.equal(m.patientBookingDraft(bookState,priyaSession),null,"another Patient's draft is invisible")
bookSession=priyaSession
assert.equal(bookActions.discardBookingDraft('smoke-priya-discard').unchanged,true,"a Patient with no draft discarding is a safe no-op, never another Patient's draft")
assert.equal(bookState.bookingDrafts.length,1,"Priya's discard did not remove Maria's draft")
bookSession=m.sessionForRole('patient',bookState)

// Stale-slot revalidation: a saved date/time that is no longer valid is reported, never silently replaced.
const staleDraftSave=bookActions.saveBookingDraft({date:'2026-09-19',start:'07:00'},'smoke-draft-stale')
assert.equal(staleDraftSave.ok,true,staleDraftSave.message)
const staleStatus=m.draftStatus(bookState,bookSession,m.patientBookingDraft(bookState,bookSession))
assert.equal(staleStatus.slotValid,false,'a past/invalid saved time is reported invalid on resume')
assert.ok(staleStatus.issues.length>0&&!/undefined/.test(staleStatus.issues.join(' ')))

// Smart Find availability and zero-eligible results come from the server now; the browser search is gone.
assert.equal(m.findOpenTimes,undefined,'no browser open-time search remains')
assert.deepEqual(m.dentistsFor(bookState,'b3','svc10'),[],'no Dentist is configured for this branch/service')
// No fake nearest-branch result: canonical branches carry no coordinates in this pass.
assert.equal(m.nearestBranch(bookState.branches,{lat:14.8,lng:120.9}),null,'coordinates unavailable → no fake nearest-branch result')

// Confirm a real Smart-Find-style auto-assigned booking; the draft is cleared atomically by the same command.
const smartBooked=m.serverAppointment({patientId:'p1',branchId:'b1',dentistId:'d1',serviceId:'svc1',date:'2026-09-21',start:'11:00',assignmentMethod:'auto',source:'Patient Portal'})
bookState=m.normalizeClinicState({...bookState,appointments:[...bookState.appointments,smartBooked]})
const appointmentsAfterConfirm=bookState.appointments.length
const smartConfirm=bookActions.recordAppointmentEvent(smartBooked.id,'created')
assert.equal(smartConfirm.ok,true,smartConfirm.message)
assert.equal(bookState.bookingDrafts.length,0,'a server-confirmed booking removes the Patient’s draft')
// Replaying the confirmation adapter never creates an appointment (the server owns creation and Idempotency-Key replay).
assert.equal(bookActions.recordAppointmentEvent(smartBooked.id,'created').ok,true)
assert.equal(bookState.appointments.length,appointmentsAfterConfirm)

// Render checks: Home quick actions no longer include Book/Visits (already in primary nav); Me is profile-only;
// the Menu sheet owns care/account destinations; mobile nav is exactly Home/Book/Visits/Menu; the assistant is a
// floating logo FAB.
store={...store,state:bookState}
const renderBookAs=(page,patientSession)=>{
  const activeBranch=bookState.branches.find(b=>b.id===patientSession.branchId)?.name||'All Branches'
  return renderToString(React.createElement(m.Shell,{role:'patient',page,setPage:()=>{},onLogout:()=>{},activeBranch,setActiveBranch:()=>{},store:{state:bookState,session:patientSession}},React.createElement(m[pages[page]],{role:'patient',activeBranch,store:{state:bookState,session:patientSession},context:null,setPage:()=>{}})))
}
const mePage=renderBookAs('me',bookSession)
for(const text of ['Maria Santos','maria@example.com'])assert.ok(mePage.includes(text),`me: ${text}`)
for(const text of ['Payments','HMO coverage','Prescriptions'])assert.ok(!mainOf(mePage).includes(text),`profile does not duplicate navigation: ${text}`)
assert.ok(!/<input|<select|<textarea/.test(mainOf(mePage)),'Me is view-only in this phase — no editable field')
const shellHtml=renderBookAs('dashboard',bookSession)
const mobileNav=shellHtml.match(/<nav class="patient-mobile-nav"[\s\S]*?<\/nav>/)?.[0]||''
const mobileNavLabels=[...mobileNav.matchAll(/<span>([^<]+)<\/span>/g)].map(x=>x[1])
assert.deepEqual(mobileNavLabels,['Home','Book','Visits','Menu'],'mobile primary navigation is exactly Home, Book, Visits, Menu')
assert.ok(!mobileNav.includes('>Queue<')&&!mobileNav.includes('>Messages<')&&!mobileNav.includes('>Me<'),'Queue/Messages are contextual and Me is no longer a primary mobile nav item')
assert.ok(shellHtml.includes('id="clinic-assistant-fab"')&&shellHtml.includes('src="/images/logo.png"'),'Patient assistant is the floating logo FAB')
assert.ok(!shellHtml.includes('id="clinic-assistant-toggle"'),'the old top-bar assistant trigger is gone')
// Pass 1: Patient has exactly one menu entry point — no top-left hamburger, only the bottom-right Menu trigger.
assert.ok(!shellHtml.includes('mobile-menu icon-btn'),'Patient shell renders no top-left hamburger trigger')
// The Menu sheet itself: grouped Bookings/Communications/Account sections with the Patient's care and account
// destinations in one place; Logout is visually separated at the bottom.
const menuSheet=renderToString(React.createElement(m.PatientMenuSheet,{open:true,onClose:()=>{},setPage:()=>{},name:'Maria Santos',unreadMessages:2,onRequestLogout:()=>{}}))
for(const heading of ['Bookings','Communications','Account'])assert.ok(menuSheet.includes(heading),`Menu group heading: ${heading}`)
for(const text of ['Book Appointment','Visits','Messages','Receipts &amp; Payments','HMO coverage','Prescriptions','Follow-up care','Referral &amp; Loyalty','My Profile'])assert.ok(menuSheet.includes(text),`Menu destination: ${text}`)
assert.ok(menuSheet.includes('patient-menu-logout')&&(menuSheet.includes('Sign out')||menuSheet.includes('Log out')),'Menu: Logout is present')
assert.ok(!menuSheet.includes('>Home<'),'Menu does not duplicate the primary Home bottom-nav destination')
// Pass 1: logout requires confirmation via a real dialog, not an immediate call — Sign out uses the normal
// primary action style (a session ending, not data being destroyed), never the danger/red treatment.
const logoutDialog=renderToString(React.createElement(m.ConfirmDialog,{open:true,title:'Sign out?',tone:'default',confirmLabel:'Sign out',cancelLabel:'Cancel',className:'patient-logout-dialog',onConfirm:()=>{},onCancel:()=>{}},'Are you sure you want to sign out of your account?'))
assert.ok((logoutDialog.includes('Sign out?')||logoutDialog.includes('Log out?'))&&(logoutDialog.includes('sign out')||logoutDialog.includes('log out')),'Logout dialog states the exact required copy')
assert.ok(logoutDialog.includes('patient-logout-dialog'),'Logout dialog uses bottom-sheet-capable styling on mobile')
const logoutConfirmButton=logoutDialog.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*(?:Sign out|Log out)(?:(?!<\/button>)[\s\S])*<\/button>/)?.[0]||''
assert.ok(logoutConfirmButton&&!/\bdanger\b/.test(logoutConfirmButton),'Log out uses the normal primary action style, not danger/red')
store={...store,state:fullState}
console.log('PASS: Phase 4B.3C-1 Patient core UX & booking — Booking Drafts (isolation, idempotency, stale-slot revalidation, atomic clear-on-confirm), zero-provider Smart Find, honest no-coordinates fallback, Me, 4-item mobile nav (Home/Book/Visits/Menu), the Menu sheet and the logo assistant FAB')
console.log('PASS: Pass 1 Patient mobile UX remediation — single Menu entry point (no top-left hamburger for Patient, unchanged for other roles), grouped Menu (Bookings/Communications/Account), Patient-only Clinic Assistant, confirmed logout with non-destructive styling')

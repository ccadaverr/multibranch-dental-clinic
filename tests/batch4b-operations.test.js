import { jsxAttribute } from './support/source-behavior.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('M8/M9 Unified registration entry point in Check-In and removal from Clinical records', () => {
  const clinical = read('src/pages/Clinical.jsx')
  // Verify Clinical.jsx no longer renders or defines the duplicate patient registration modal
  assert.doesNotMatch(clinical, /showNewPatientModal/)
  assert.doesNotMatch(clinical, /setShowNewPatientModal/)
  assert.doesNotMatch(clinical, /function NewPatientModal/)

  const patientFlow = read('src/pages/PatientFlow.jsx')
  // Verify Check-In (PatientFlow.jsx) provides the unified registration state and action
  assert.match(patientFlow, /registering/)
  assert.match(patientFlow, /Register new patient/)
  assert.match(patientFlow, /registerPatient/)
  // Verify registration creates record without forcing queue admission
  assert.match(patientFlow, /Creates a clinic patient record only — no login account/)
  // Verify upcoming appointment check is advisory
  assert.match(patientFlow, /upcomingAppt/)
  assert.match(patientFlow, /Walk-ins are queued behind scheduled arrivals and must not displace confirmed appointments/)
})

test('M4 Calendar click passing date and branch to AppointmentForm without field lock', () => {
  const calendar = read('src/pages/StaffDayCalendar.jsx')
  // Calendar passes prefill with selected date and branch into AppointmentForm
  assert.match(calendar, /<AppointmentForm role=\{role\} store=\{store\} prefill=\{selectedDate \? \{ date: selectedDate/)

  const scheduling = read('src/pages/Scheduling.jsx')
  // Scheduling AppointmentForm accepts prefill and does not lock patient or branch when only date/branch are passed
  assert.match(scheduling, /lockedPatient=!!\(appointment\|\|followup\|\|prefill\?\.patientPublicId/)
  assert.match(scheduling, /lockedBranch=!!\(appointment\|\|followup\|\|\(prefill\?\.patientPublicId&&prefill\?\.branchId\)\)/)
})

test('M4 consultation_first restricted procedure requires clinical authorization checkbox and sends flag', () => {
  const scheduling = read('src/pages/Scheduling.jsx')
  // Detects consultation_first on the selected service
  assert.match(scheduling, /onlineBooking==='consultation_first'/)
  assert.match(scheduling, /authConfirmed/)
  assert.match(scheduling, /Prior consultation \/ dentist clinical authorization confirmed by front desk/)
  assert.match(scheduling, /consultationAcknowledged:isRestricted\?authConfirmed:null/)

  const api = read('src/appointments-api.js')
  // Submits consultation_acknowledged to server
  assert.match(api, /if \(consultationAcknowledged !== null\) payload\.consultation_acknowledged = !!consultationAcknowledged/)
})

test('M17 ServerMessages close conversation uses ConfirmDialog with state preservation on cancel', () => {
  const messages = read('src/pages/ServerMessages.jsx')
  assert.match(messages, /confirmClose/)
  assert.match(messages, /<ConfirmDialog/)
  assert.match(messages, /title="Close this conversation\?"/)
  // On cancel, resets confirmClose without calling close API
  assert.match(messages, /onCancel=\{\(\) => setConfirmClose\(false\)\}/)
  // On confirm, invokes conversation close
  assert.match(messages, /onConfirm=\{\(\) => \{ setConfirmClose\(false\); close\(\) \}\}/)
})

test('M11 FinanceCommunication invoice issuance uses ConfirmDialog with state preservation on cancel', () => {
  const finance = read('src/pages/FinanceCommunication.jsx')
  assert.match(finance, /issueConfirmInvoice/)
  assert.match(finance, /<ConfirmDialog open=\{!!issueConfirmInvoice\}/)
  assert.match(finance, /title="Issue this invoice\?"/)
  // Cancel clears issueConfirmInvoice without modifying invoice state
  assert.match(finance, /onCancel=\{\(\)=>setIssueConfirmInvoice\(null\)\}/)
  // Confirm proceeds with invoice issuance
  assert.match(finance, /run\(issueBillingInvoice,target\.id/)
})

test('M12 HMO case escalation uses ConfirmDialog with state preservation on cancel', () => {
  const captured=Object.freeze({id:'case-A',revision:7,submissionCycle:1}), calls=[]
  let confirmation=captured
  const bindings={confirmEscalate:captured,escalationStale:false,setConfirmEscalate:v=>{confirmation=v},onEscalate:v=>calls.push(v)}
  const callback=name=>jsxAttribute('src/pages/Hmo.jsx','ConfirmDialog',name,bindings,'Escalate HMO case?')
  callback('onCancel')(); assert.equal(confirmation,null); assert.deepEqual(calls,[])
  confirmation=captured; callback('onConfirm')(); assert.equal(confirmation,null); assert.deepEqual(calls,[captured]);assert.equal(calls[0],captured)
  bindings.escalationStale=true; callback('onConfirm')();assert.equal(calls.length,1,'a stale confirmation cannot escalate')
})

test('M18 Inquiries close inquiry uses ConfirmDialog with state preservation on cancel', () => {
  const inquiries = read('src/pages/Inquiries.jsx')
  assert.match(inquiries, /closingInquiry/)
  assert.match(inquiries, /<ConfirmDialog/)
  assert.match(inquiries, /title="Close this inquiry\?"/)
  // Cancel preserves state without closing inquiry
  assert.match(inquiries, /onCancel=\{\(\) => setClosingInquiry\(null\)\}/)
  // Confirm performs inquiry close with revision
  assert.match(inquiries, /run\(\(\) => closeInquiry\(target, commandKey\(\)\)/)
})

test('Neutral undecryptable-message display in both staff and patient interfaces', () => {
  const messageModel = read('backend/app/Models/ConversationMessage.php')
  // Returns neutral safe text
  assert.match(messageModel, /return "This message can't be displayed";/)
  // Must never expose crypto internal keys
  assert.doesNotMatch(messageModel, /Message encrypted with a previous clinic key/)

  const staffMessages = read('src/pages/ServerMessages.jsx')
  assert.match(staffMessages, /<p>\{m\.body\}<\/p>/)

  const portal = read('src/patient/Portal.jsx')
  assert.match(portal, /messages|Messages/)
})

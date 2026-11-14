import React from 'react'
import { canSchedule } from '../src/appointment-ui.js'
import { productionExpression, jsxAttribute } from './support/source-behavior.js'
import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as data from '../src/data.js'
import { setClockSource } from '../src/clock.js'
import { normalizeClinicState, sessionForRole } from '../src/contracts.js'
import * as api from '../src/appointments-api.js'
import { __resetCsrfCacheForTests, onSessionInvalidated, sessionStillValid } from '../src/api-client.js'
import { patientAttention } from '../src/patient-view.js'
import { serverId } from './support/server-appointments.js'
import { row, world } from './support/mock-server-world.js'

// M6 cutover final hardening: the transitional follow-up rule (Dentist recommends, clinic Staff schedule), the shared
// expired-session path for M6 calls, and the bounded appointment window never presented as all-time data.

beforeEach(() => setClockSource(() => new Date('2026-09-19T02:08:00Z')))
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// The real appointment-flow.js over the mocked M6/M8 server (tests/support/mock-server-world.js).

// A completed encounter whose Dentist indicated a required follow-up (the real server-first path).
async function openFollowup() {
  const w = world(); const a = w.seed(row())
  await w.flow.checkIn(a.id)
  const q = w.state.queue[0]
  w.role('dentist'); await w.flow.queueCommand(q, 'call', 'call-1')
  await w.treat({ queueEntryId: q.id }, 'In Treatment')
  const done = await w.treat({ queueEntryId: q.id, procedure: 'Consultation', procedures: [{ serviceId: 'svc1', quantity: 1 }], followupRequired: true, followupDate: '2026-09-26' }, 'Completed')
  assert.equal(done.ok, true, done.message)
  const followup = w.state.followups[0]
  assert.equal(followup.status, 'Open')
  w.log.length = 0
  return { w, followup }
}
const followupForm = { branchId: 'b1', serviceId: 'svc1', date: '2026-09-26', start: '10:00', patientPublicId: serverId(500), dentistId: 'd1' }

// ================================================================================================================
// FOLLOW-UP (transitional M6/M20 rule)
// ================================================================================================================
test('Staff schedule the follow-up as a server appointment; only its public id is stored locally', async () => {
  const { w, followup } = await openFollowup()
  w.role('staff')
  const booked = await w.flow.create(followupForm, { key: 'f-1', followupId: followup.id })
  assert.equal(booked.ok, true, booked.message)
  assert.deepEqual(w.log.map(x => x[0]), ['create', 'refresh'])
  const stored = w.state.followups[0]
  assert.equal(stored.appointmentId, booked.record.id)
  assert.equal(api.isServerId(stored.appointmentId), true, 'the follow-up keeps the server public id')
  assert.equal(stored.status, 'Scheduled')
  assert.equal(w.patches.some(p => 'appointments' in p), false, 'no local appointment record is ever committed')
  assert.deepEqual(w.state.appointments.map(a => a.id).sort(), [...w.server.keys()].sort(), 'every appointment is a server row')
})

test('the Owner may schedule a follow-up through the same bridge (current authorization permits it)', async () => {
  const { w, followup } = await openFollowup()
  w.role('owner')
  const booked = await w.flow.create(followupForm, { key: 'f-2', followupId: followup.id })
  assert.equal(booked.ok, true, booked.message)
  assert.equal(booked.warning, '')
  assert.equal(w.state.followups[0].appointmentId, booked.record.id)
})

test('a Dentist cannot book the follow-up: nothing reaches the server and the follow-up stays open', async () => {
  const { w, followup } = await openFollowup()
  w.role('dentist')
  const result = await w.flow.create(followupForm, { key: 'f-3', followupId: followup.id })
  assert.equal(result.ok, false)
  assert.match(result.message, /scheduled by clinic Staff/)
  assert.deepEqual(w.log, [], 'no server create was attempted')
  assert.equal(w.server.size, 1, 'no new server appointment exists')
  assert.equal(w.state.followups[0].status, 'Open')
  // The local adapter refuses a Dentist too, even with a real server appointment id.
  const [existing] = w.server.keys()
  assert.equal(w.actions.linkFollowupAppointment(followup.id, existing).ok, false)
})

test('the follow-up screen (M20, clinic server) offers booking to the front desk only', () => {
  const file='src/pages/ServerFollowups.jsx',patientId='01ARZ3NDEKTSV4RRFFQ69G5FAB',taskId='01ARZ3NDEKTSV4RRFFQ69G5FAV'
  const t={id:taskId,revision:7,status:'Open',can_book:true,patient:{id:patientId,name:'Synthetic Patient',code:'SYNTHETIC'},branch:{id:'b1'},service:{id:'svc1'},due_on:'2026-11-13',appointment:null}
  const store={session:{serverUserId:'synthetic',userId:'staff',role:'staff',active:true,branchId:'b1',branchScopes:['b1']},state:{persons:[{id:'person'}],users:[{id:'staff',personId:'person',role:'Staff',status:'Active',branchId:'b1',permissions:['appointments']}],staff:[{userId:'staff',personId:'person',branchId:'b1'}],branches:[{id:'b1',status:'Open'}]}}
  const publicTaskId=productionExpression(file,(n,parent)=>parent?.type==='VariableDeclarator'&&parent.id.name==='publicTaskId'&&parent.init===n)
  const select=productionExpression(file,n=>n.type==='FunctionDeclaration'&&n.id?.name==='clinicalBookingSelection',{canSchedule,publicTaskId})
  const selection=select(t,'staff',store),pending={current:false},bookingToken={current:null},pendingTasks={tasks:new Map()};let booking=null,current=true
  const bindings={React,Button:'button',t,store,selection,clinicalBookingSelection:select,latest:{current:{store,task:t}},role:'staff',busy:'',needsReload:false,taskRequest:null,staleRow:false,pending,pendingTasks,bookingToken,ownsRow:()=>current,setBooking:v=>{booking=v}}
  const control=()=>productionExpression(file,n=>n.type==='LogicalExpression'&&n.right?.type==='JSXElement'&&n.right.openingElement.name.name==='Button'&&n.right.children.some(c=>c.type==='JSXText'&&c.value.trim()==='Book follow-up'),bindings)
  const button=control();assert.equal(button.type,'button');assert.equal(button.props.disabled,false)
  button.props.onClick();assert.equal(booking,bookingToken.current);assert.ok(Object.isFrozen(booking));assert.ok(Object.isFrozen(booking.task));assert.notEqual(booking.task,t)
  const captured=booking;button.props.onClick();assert.equal(booking,captured,'duplicate confirmation cannot replace frozen intent')
  const prefill=jsxAttribute(file,'AppointmentForm','prefill',{t,booking})
  assert.deepEqual(JSON.parse(JSON.stringify(prefill)),{patientPublicId:patientId,patientName:'Synthetic Patient • SYNTHETIC',branchId:'b1',serviceId:'svc1',date:'2026-11-13'})
  assert.equal(jsxAttribute(file,'AppointmentForm','serverFollowupSelection',{booking}),booking.selection);assert.deepEqual(booking.selection,selection)
  for(const role of ['dentist','patient','owner']){bindings.role=role;assert.equal(control(),false)}
  bindings.role='staff';t.can_book=false;assert.equal(control(),false);t.can_book=true
  for(const blocked of ['needsReload','staleRow']){bindings[blocked]=true;assert.equal(control().props.disabled,true);bindings[blocked]=false}
  const reset=()=>{booking=null;bookingToken.current=null}
  reset();current=false;control().props.onClick();assert.equal(booking,null)
  reset();current=true;pending.current=true;control().props.onClick();assert.equal(booking,null)
  reset();pending.current=false;pendingTasks.tasks.set(t.id,{});control().props.onClick();assert.equal(booking,null)
  bindings.selection=null;assert.equal(control().props.disabled,true,'invalid exact selection remains disabled')
})

test('a Patient has no active follow-up self-booking control', async () => {
  const { w, followup } = await openFollowup()
  w.role('patient')
  const result = await w.flow.create(followupForm, { key: 'f-4', followupId: followup.id })
  assert.equal(result.ok, false)
  assert.deepEqual(w.log, [])
  const item = patientAttention(w.state, sessionForRole('patient', w.state)).find(i => i.kind === 'followup')
  assert.ok(item, 'the recommendation is still shown to the Patient')
  assert.equal(item.action, 'View follow-up')
  assert.match(item.detail, /clinic will schedule it/)
  // The browser follow-up page is gone (M20 is on the clinic server); a patient is told the clinic contacts them.
  assert.match(read('src/App.jsx'), /When your dentist asks to see you again, the clinic contacts you/)
})

// ================================================================================================================
// EXPIRED SERVER SESSION
// ================================================================================================================
let calls = []
let oldFetch
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
function mockFetch(handler) {
  oldFetch = globalThis.fetch
  calls = []
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    calls.push({ path, method: (options.method || 'GET').toUpperCase() })
    if (path === '/sanctum/csrf-cookie') return new Response(null, { status: 204 })
    return handler(path, options)
  }
}
let unsubscribe = null
afterEach(() => { if (oldFetch) globalThis.fetch = oldFetch; oldFetch = null; unsubscribe?.(); unsubscribe = null; __resetCsrfCacheForTests() })
const expired = () => json(401, { message: 'Unauthenticated.' })
const listen = () => { const seen = []; unsubscribe = onSessionInvalidated(() => seen.push(1)); return seen }
const apiCalls = () => calls.filter(c => c.path !== '/sanctum/csrf-cookie')

test('an appointment read returning 401 reports the shared session-invalidated signal', async () => {
  mockFetch(expired)
  const seen = listen()
  const result = await api.loadAppointments('2026-09-19')
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'unauthenticated')
  assert.equal(result.message, 'Your session has ended. Sign in again.')
  assert.equal(seen.length, 1)
  assert.equal(apiCalls().length, 1, 'the read stops at the first 401 page')
})

test('availability, recommendation and Patient directory 401s follow the same path', async () => {
  mockFetch(expired)
  const seen = listen()
  assert.equal((await api.fetchAvailability({ branchId: 'b1', serviceId: 'svc1', date: '2026-09-20' })).kind, 'unauthenticated')
  assert.equal((await api.fetchRecommendation({ serviceId: 'svc1' })).kind, 'unauthenticated')
  assert.equal((await api.searchPatients('ma')).kind, 'unauthenticated')
  assert.equal(seen.length, 3)
})

test('create, reschedule, cancel and lifecycle 401s are reported once each and never retried', async () => {
  mockFetch(expired)
  const seen = listen()
  const appointment = api.mapAppointment(row())
  const results = [
    await api.createAppointment({ branchId: 'b1', serviceId: 'svc1', date: '2026-09-20', start: '10:00' }, 'k-create'),
    await api.rescheduleAppointment(appointment, { date: '2026-09-21', start: '10:00' }, 'k-resched'),
    await api.cancelAppointment(appointment, 'k-cancel'),
    await api.transitionAppointment(appointment, 'check-in', 'k-check'),
  ]
  for (const result of results) { assert.equal(result.ok, false); assert.equal(result.kind, 'unauthenticated') }
  assert.equal(seen.length, 4)
  const posts = apiCalls().filter(c => c.method === 'POST')
  assert.equal(posts.length, 4, 'exactly one request per command: a 401 is never retried')
})

test('revalidation keeps the session only when /api/me confirms the same account', async () => {
  const userId = '01jtestuser00000000000001'
  mockFetch(() => expired())
  assert.equal(await sessionStillValid(userId), false, 'server confirms the session is gone')
  globalThis.fetch = oldFetch
  mockFetch(() => json(200, { data: { id: '01jtestuser00000000000002', role: 'staff' } }))
  assert.equal(await sessionStillValid(userId), false, 'a different account is signed in now')
  globalThis.fetch = oldFetch
  mockFetch(() => json(200, { data: { id: userId, role: 'staff' } }))
  assert.equal(await sessionStillValid(userId), true)
  assert.equal(await sessionStillValid(null), false, 'no known server account: never assume the session is valid')
})

test('a 401 on create changes nothing locally: no refresh, no draft clearing, no follow-up link', async () => {
  const { w, followup } = await openFollowup()
  w.role('staff')
  const draft = { id: 'draft-1', patientId: 'p1', mode: 'manual', branchId: 'b1', serviceId: 'svc1', date: '2026-09-26', start: '10:00' }
  w.state = normalizeClinicState({ ...w.state, bookingDrafts: [draft] })
  w.failCreateWith(api.normalizeFailure({ ok: false, kind: 'unauthenticated' }))
  const result = await w.flow.create(followupForm, { key: 'f-5', followupId: followup.id })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'unauthenticated')
  assert.deepEqual(w.log.map(x => x[0]), ['create'], 'no refresh and no second create attempt')
  assert.equal(w.state.bookingDrafts.length, 1, 'the recoverable draft is kept for the next sign-in')
  assert.equal(w.state.followups[0].status, 'Open')
})

test('the app shell handles the signal through its normal sign-out path (no second session system)', () => {
  const app = read('src/App.jsx')
  assert.match(app, /api\.onSessionInvalidated\(/)
  assert.match(app, /api\.sessionStillValid\(/)
  assert.match(app, /current\.signedOut\(\)/)
  assert.match(app, /Your session has ended\. Sign in again\./)
  // logout() and the expiry path share the same signed-out transition.
  assert.equal((app.match(/signedOut\(\)/g) || []).length >= 2, true)
  const client = read('src/appointments-api.js')
  assert.doesNotMatch(client, /adoptSession|sessionStorage|localStorage|login\(/, 'appointments-api.js holds no session state of its own')
})

// ================================================================================================================
// ANALYTICS WINDOW
// ================================================================================================================
test('the loaded appointment window is bounded and the Scheduling metric names it (never all-time)', () => {
  assert.deepEqual(api.appointmentWindow('2026-09-19'), { from: '2026-06-21', to: '2026-12-21' })
  const admin = read('src/pages/Admin.jsx')
  assert.match(admin, /appointmentWindow\(clinicDate\(\)\)/)
  assert.match(admin, /not all-time; the period selector does not apply/)
  assert.match(admin, /appointmentsTruncated\?'\. Partial: the appointment list limit was reached\.'/)
  for (const path of ['src/pages/Admin.jsx', 'src/pages/Dashboards.jsx']) assert.doesNotMatch(read(path), /all[- ]time appointments|complete appointment history/i, path)
})

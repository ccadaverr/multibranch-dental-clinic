import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setClockSource } from '../src/clock.js'
import * as visitsApi from '../src/visits-api.js'
import { __resetCsrfCacheForTests, onSessionInvalidated } from '../src/api-client.js'
import { buildServerProjection, classifyLegacy, reanchorLocalEvidence, liveRecords } from '../src/appointment-projection.js'
import { persistableCollection, normalizeClinicState } from '../src/contracts.js'
import { encounterIssue } from '../src/safeguards.js'
import { serverId } from './support/server-appointments.js'
import { row, world } from './support/mock-server-world.js'

// M8 cutover: Laravel/PostgreSQL is the only authority for Patient arrival (scheduled Check-In, Walk-In) and for the
// Visit / Clinical Encounter lifecycle. The M9 queue and M5 treatment prototypes stay browser-local but reference the
// server Visit. These tests exercise the real client, projection, flows and adapters against mocked HTTP / a mocked
// server (the server rules themselves are covered by backend/tests/Feature/Visits).

beforeEach(() => setClockSource(() => new Date('2026-09-19T02:08:00Z')))
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const visitRow = (fields = {}) => ({
  id: serverId(4000), source: 'appointment', status: 'Checked In', revision: 1, arrived_at: '2026-09-19T10:05:00+08:00', clinic_date: '2026-09-19', closed_at: null,
  patient: { id: serverId(500), code: 'PAT-0500', name: 'Server Patient' }, branch: { id: 'b1', name: 'Dr. Dana Roxas Dental Clinic' }, dentist: { id: 'd1', name: 'Dr. Miguel Reyes' },
  service: { id: 'svc1', name: 'Dental Consultation' }, appointment: { id: serverId(900), code: 'APT-2026-000900', status: 'Checked In', revision: 2, date: '2026-09-19', start_time: '11:00' }, ...fields,
})

// ---- mocked fetch ---------------------------------------------------------------------------------------------
let calls = []
let oldFetch
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
function mockFetch(handler) {
  oldFetch = globalThis.fetch
  calls = []
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    calls.push({ path, method: (options.method || 'GET').toUpperCase(), headers: options.headers || {}, body: options.body ? JSON.parse(options.body) : null })
    if (path === '/sanctum/csrf-cookie') return new Response(null, { status: 204 })
    return handler(path, options)
  }
}
let unsubscribe = null
afterEach(() => { if (oldFetch) globalThis.fetch = oldFetch; oldFetch = null; unsubscribe?.(); unsubscribe = null; __resetCsrfCacheForTests() })
const apiCalls = () => calls.filter(c => c.path !== '/sanctum/csrf-cookie')

// ================================================================================================================
// VISIT CLIENT
// ================================================================================================================
test('mapVisit exposes public ids only and the server arrival time', () => {
  const v = visitsApi.mapVisit(visitRow(), id => (id === serverId(500) ? 'p1' : id))
  assert.equal(v.id, serverId(4000)); assert.equal(v.patientId, 'p1'); assert.equal(v.patientPublicId, serverId(500))
  assert.equal(v.appointmentId, serverId(900)); assert.equal(v.dentistId, 'd1'); assert.equal(v.serviceId, 'svc1')
  assert.equal(v.arrivedAt, '2026-09-19T10:05:00+08:00'); assert.equal(v.checkedIn, '10:05'); assert.equal(v.clinicDate, '2026-09-19')
  const walkIn = visitsApi.mapVisit(visitRow({ source: 'walk_in', appointment: null, dentist: null }))
  assert.equal(walkIn.walkIn, true); assert.equal(walkIn.appointmentId, null); assert.equal(walkIn.dentistId, null)
})

test('Visits load through the same bounded, paginated window as appointments', async () => {
  mockFetch(path => {
    const page = Number(new URL(`http://x${path}`).searchParams.get('page'))
    return json(200, { data: [visitRow({ id: serverId(4000 + page) })], meta: { current_page: page, last_page: 2 } })
  })
  const result = await visitsApi.loadVisits('2026-09-19')
  assert.equal(result.ok, true); assert.equal(result.rows.length, 2); assert.equal(result.truncated, false)
  const params = new URL(`http://x${apiCalls()[0].path}`).searchParams
  assert.equal(apiCalls()[0].path.startsWith('/api/visits?'), true)
  assert.deepEqual([params.get('from'), params.get('to'), params.get('per_page')], ['2026-06-21', '2026-12-21', '100'])
})

test('Check-In and Walk-In send named commands with the Idempotency-Key and no client-chosen status; Visit progression is M5-only', async () => {
  mockFetch(() => json(201, { data: visitRow() }))
  await visitsApi.checkIn({ id: serverId(900), revision: 1 }, 'arrive-1')
  await visitsApi.walkIn({ patientPublicId: serverId(500), branchId: 'b1', serviceId: 'svc1', dentistId: null }, 'walk-1')
  const [checkIn, walkIn] = apiCalls()
  assert.deepEqual([checkIn.method, checkIn.path, checkIn.body, checkIn.headers['Idempotency-Key']], ['POST', '/api/visits/check-in', { appointment_id: serverId(900), expected_revision: 1 }, 'arrive-1'])
  assert.deepEqual([walkIn.path, walkIn.body, walkIn.headers['Idempotency-Key']], ['/api/visits/walk-in', { patient_id: serverId(500), branch_ref: 'b1', service_ref: 'svc1' }, 'walk-1'])
  assert.equal('appointment_id' in walkIn.body, false, 'a walk-in never names an appointment')
  for (const call of [checkIn, walkIn]) assert.equal('status' in call.body, false)
  assert.equal('transitionVisit' in visitsApi, false, 'there is no standalone Visit start/complete client')
})

test('front-desk registration sends only Person/Patient fields — never a password, role or login', async () => {
  mockFetch(() => json(201, { data: { id: serverId(600), code: 'PAT-0600', name: 'Walk In', first_name: 'Walk', last_name: 'In', phone: '+639171234567', date_of_birth: null } }))
  const result = await visitsApi.registerPatient({ firstName: 'Walk', lastName: 'In', phone: '+639171234567' }, 'reg-1')
  assert.equal(result.ok, true); assert.equal(result.patient.id, serverId(600)); assert.equal(result.patient.patientCode, 'PAT-0600')
  const [call] = apiCalls()
  assert.deepEqual([call.path, call.body, call.headers['Idempotency-Key']], ['/api/patients', { first_name: 'Walk', last_name: 'In', phone: '+639171234567' }, 'reg-1'])
})

test('M8 refusals keep their codes and clear messages; a 401 reaches the shared session-invalidated path', async () => {
  mockFetch(path => (path === '/api/visits/check-in'
    ? json(409, { message: 'This appointment is already checked in.', code: 'visit_exists' })
    : path === '/api/visits/walk-in'
      ? json(422, { message: 'This walk-in can’t be admitted.', code: 'walk_in_invalid', errors: { walk_in: ['The Dentist is within their shift'] }, failed_checks: ['dentist-shift'] })
      : json(401, { message: 'Unauthenticated.' })))
  const seen = []; unsubscribe = onSessionInvalidated(() => seen.push(1))
  const exists = await visitsApi.checkIn({ id: serverId(900), revision: 1 }, 'k1')
  assert.deepEqual([exists.kind, exists.code], ['conflict', 'visit_exists']); assert.match(exists.message, /already checked in/)
  const invalid = await visitsApi.walkIn({ patientPublicId: serverId(500), branchId: 'b1', serviceId: 'svc1', dentistId: 'd1' }, 'k2')
  assert.deepEqual(invalid.failedChecks, ['dentist-shift']); assert.match(invalid.message, /Checks not met: The Dentist is within their shift/)
  const expired = await visitsApi.loadVisits('2026-09-19')
  assert.equal(expired.kind, 'unauthenticated'); assert.equal(seen.length, 1)
})

// ================================================================================================================
// PROJECTION, RELINK AND LEGACY QUARANTINE
// ================================================================================================================
test('server Visits enter the read model; walk-in Patients become read-model Patients; nothing is persisted', () => {
  const projection = buildServerProjection({ visitRows: [visitRow({ source: 'walk_in', appointment: null, patient: { id: serverId(601), code: 'PAT-0601', name: 'New Walk-In' } })] })
  assert.equal(projection.visits[0].patientId, serverId(601))
  assert.equal(projection.readModelPatients[0].name, 'New Walk-In')
  assert.equal(persistableCollection('patients', projection.readModelPatients).length, 0)
  const store = read('src/store.jsx')
  assert.doesNotMatch(store, /usePersist\('check-ins'/); assert.doesNotMatch(store, /usePersist\('visits'/)
  assert.match(store, /const \{appointments:_ignored,visits:_ignoredVisits,queue:_ignoredQueue,myQueue:_ignoredMyQueue,treatments:_ignoredTreatments,hmo:_ignoredHmo,claimDecisions:_ignoredClaimDecisions,\.\.\.patch\}=rawPatch/, 'a local patch can never write Visits, the queue or Treatments')
})

test('local evidence re-anchors to a server Visit only through an exact link; everything else is legacy (M9 Q11)', () => {
  const visits = [visitsApi.mapVisit(visitRow(), id => (id === serverId(500) ? 'p1' : id))]
  const serverQueue = [{ id: serverId(7000), visitId: serverId(4000) }]
  const localQueue = [
    { id: 'relink', appointmentId: serverId(900), patientId: 'p1', clinicDate: '2026-09-19' },            // exact server appointment id
    { id: 'linked', visitId: serverId(4000), appointmentId: serverId(900), patientId: 'p1' },           // carries the Visit already
    { id: 'same-day-other', appointmentId: serverId(901), patientId: 'p1', clinicDate: '2026-09-19' },   // same Patient/day, no Visit
    { id: 'walkin-local', appointmentId: null, patientId: 'p1', clinicDate: '2026-09-19' },              // browser-only walk-in
    { id: 'pre-m6', appointmentId: 'a1', patientId: 'p1' },                                              // pre-cutover appointment id
  ]
  const records = localQueue.map(q => ({ id: `t-${q.id}`, queueEntryId: q.id, patientId: 'p1' }))
  const { records: next, changed } = reanchorLocalEvidence({ records, localQueue, visits, serverQueue })
  assert.equal(changed, true)
  const byId = Object.fromEntries(next.map(r => [r.id, r]))
  for (const id of ['t-relink', 't-linked']) {
    assert.equal(byId[id].visitId, serverId(4000), id)
    assert.equal(byId[id].queueEntryId, serverId(7000), `${id} now points at the server queue entry for the same Visit`)
  }
  for (const id of ['t-same-day-other', 't-walkin-local', 't-pre-m6']) assert.equal(byId[id].visitId, undefined, `${id} is never guessed`)
  assert.equal(reanchorLocalEvidence({ records: next, localQueue, visits, serverQueue }).changed, false, 'idempotent')

  const classified = classifyLegacy({ treatments: next, invoices: [{ id: 'i1', treatmentId: 't-walkin-local', status: 'Paid' }] })
  assert.equal(classified.treatments.find(t => t.id === 't-walkin-local').legacyAppointment, true)
  assert.equal(classified.treatments.find(t => t.id === 't-relink').legacyAppointment, undefined)
  assert.deepEqual(liveRecords(classified.invoices), [], 'legacy walk-in billing never reaches live KPIs')
})

// ================================================================================================================
// M9 QUEUE ADAPTER / M5 TREATMENT ADAPTER (real appointment-flow.js + workflow.js over the mocked server)
// ================================================================================================================
test('arrival queues the Visit on the server; there is no local queue creation step', async () => {
  const w = world(); const a = w.seed(row())
  const first = await w.flow.checkIn(a.id, 'arrive')
  assert.equal(first.ok, true, first.message)
  const visitId = w.state.visits[0].id
  assert.deepEqual([w.state.queue.length, w.state.queue[0].visitId, w.state.queue[0].queueNumber, w.state.queue[0].server], [1, visitId, 1, true])
  assert.equal('retryAdmit' in w.flow, false); assert.equal('admitVisit' in w.actions, false)
  assert.equal(w.patches.length, 0, 'no local write at all')
})

test('a Walk-In goes server-first and creates no appointment; a Visit without a Dentist is simply not queued', async () => {
  const w = world()
  const result = await w.flow.walkIn({ patientId: 'p1', patientPublicId: serverId(500), branchId: 'b1', serviceId: 'svc1', dentistId: 'd1' }, 'walk-1')
  assert.equal(result.ok, true, result.message)
  assert.deepEqual(w.log.map(x => x[0]), ['walk-in', 'refresh'])
  assert.equal(w.state.appointments.length, 0)
  assert.deepEqual([w.state.visits[0].walkIn, w.state.queue[0].appointmentId, w.state.queue[0].visitId], [true, null, w.state.visits[0].id])

  const w2 = world()
  const noDentist = await w2.flow.walkIn({ patientId: 'p1', patientPublicId: serverId(500), branchId: 'b1', serviceId: 'svc1', dentistId: null }, 'walk-2')
  assert.equal(noDentist.ok, true, noDentist.message)
  assert.deepEqual([noDentist.queued, w2.state.visits.length, w2.state.queue.length], [false, 1, 0])
})

test('M5 start is one server command; a documentation save that fails after it is reported partial and retried without restarting', async () => {
  const w = world(); const a = w.seed(row())
  await w.flow.checkIn(a.id, 'k')
  const q = w.state.queue[0]
  w.role('dentist'); await w.flow.queueCommand(q, 'call', 'call-1')
  w.failNextDocumentWith({ ok: false, kind: 'server', code: null, message: 'The clinic server is unavailable.' })
  const partial = await w.treat({ queueEntryId: q.id, complaint: 'Sensitivity' }, 'In Treatment')
  assert.equal(partial.ok, false); assert.equal(partial.partial, true); assert.match(partial.message, /Treatment started, but the documentation was not saved/)
  assert.equal(w.state.visits[0].status, 'In Treatment', 'the server start is never rolled back')
  assert.equal(w.state.queue[0].status, 'Served', 'the server queue entry was Served by the same server command')
  assert.equal(w.state.treatments[0].complaint, '', 'nothing clinical is written locally')
  const retry = await w.treat({ queueEntryId: q.id, complaint: 'Sensitivity' }, 'In Treatment')
  assert.equal(retry.ok, true, retry.message)
  assert.equal(w.log.filter(x => x[0] === 'treatment.start').length, 1, 'the retry does not repeat the start command')
  assert.equal(w.state.treatments[0].complaint, 'Sensitivity')
  assert.equal(w.state.treatments[0].visitId, q.visitId)
  assert.equal(w.state.treatments[0].queueEntryId, q.id, 'the server Treatment points at the SERVER queue entry public id')
})

test('a front-desk registered Patient is added to the in-memory directory', async () => {
  const w = world(); const added = []
  const flow = (await import('../src/appointment-flow.js')).createAppointmentFlow({ getState: () => w.state, getSession: () => w.session, getActions: () => w.actions, refresh: async () => ({ ok: true }), addDirectoryPatient: p => added.push(p),
    visits: { registerPatient: async form => ({ ok: true, patient: { id: serverId(600), patientCode: 'PAT-0600', name: `${form.firstName} ${form.lastName}` } }) } })
  const result = await flow.registerPatient({ firstName: 'Walk', lastName: 'In' }, 'reg')
  assert.equal(result.ok, true); assert.deepEqual(added.map(p => p.id), [serverId(600)])
})

test('a missing server Visit fails closed where Visits are projected; Patient read views use local links only (D9)', async () => {
  const w = world(); const a = w.seed(row())
  await w.flow.checkIn(a.id, 'k')
  const q = w.state.queue[0]
  assert.equal(encounterIssue(w.state, q), null)
  const withoutVisit = normalizeClinicState({ ...w.state, visits: [] })
  assert.match(encounterIssue({ ...withoutVisit, visitsProjected: true }, q), /not loaded from the clinic server/)
  assert.match(encounterIssue(withoutVisit, q), /not loaded/, 'the default is fail-closed')
  assert.equal(encounterIssue({ ...withoutVisit, visitsProjected: false }, q), null, 'a Patient session has no Visit API yet')
  assert.match(read('src/store.jsx'), /visitsProjected:!!initialServerVisits\|\|\['staff','dentist','owner'\]\.includes\(session\?\.role\)/)
})

// ================================================================================================================
// UI CONTRACT
// ================================================================================================================
test('the front desk uses server commands only; no local arrival, walk-in or queue No-show authority remains', () => {
  const page = read('src/pages/PatientFlow.jsx')
  assert.match(page, /flow\.checkIn\(reviewed\.appointmentId,ticket\.key,reviewed\)/)
  assert.doesNotMatch(page, /flow\.checkIn\(selectedAppointment\.id,checkInKey\.current\.key\)/, 'arrival must carry the human-reviewed snapshot')
  assert.match(page, /flow\.walkIn\(\{\.\.\.walkIn,patientId\},walkKey\.current\)/)
  assert.match(page, /flow\.registerPatient\(/)
  assert.doesNotMatch(page, /actions\.admitWalkIn|actions\.updateQueue|checkIns|'No-show'\)|Add to queue|retryAdmit/)
  assert.match(page, /isn’t available yet — the clinic still needs to decide how an admitted visit is closed/)
  // The walk-in form still requires a Dentist: the queue is organized per Dentist and there is no assignment step yet.
  // B2 requires an actually selected directory Patient and blocks the registration mode,
  // in addition to the existing branch/service/Dentist requirements.
  assert.match(page, /const selectedPatient=\(store\.directoryPatients\|\|\[\]\)\.find\(p=>p\.id===walkIn\.patientPublicId\)/)
  assert.match(page, /const canWalkIn=!registering&&!!selectedPatient&&!!walkIn\.branchId&&!!walkIn\.serviceId&&!!walkIn\.dentistId/)
  const scheduling = read('src/pages/Scheduling.jsx')
  assert.match(scheduling, /store\.appointmentFlow\.noShow\(a,commandKey\(\)\)/)
  assert.match(scheduling, /Use this only when the patient did not arrive; no visit is created/)
  const workflow = read('src/workflow.js')
  assert.doesNotMatch(workflow, /checkInAppointment|admitWalkIn|admitVisit|updateQueue|state\.checkIns|state\.queue=|uid\('ci'\)|recalcQueue/)
  assert.doesNotMatch(read('src/contracts.js'), /checkIns/)
})

import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createWorkflowActions } from '../src/workflow.js'
import * as data from '../src/data.js'
import * as api from '../src/api-client.js'
import { normalizeClinicState, sessionForRole } from '../src/contracts.js'
import {
  mapBranch, mapService, mapBranchService, mapStaffProfile, mapDentistProfile,
  deriveDentistServiceAssignments, fetchReferenceData, syncBranchUpdate, syncPersonnelUpdate,
} from '../src/reference-data-bridge.js'

// ---- Mock API response fixtures, shaped exactly like the real backend Resources (Phase 2A plan, H) ------
const API_BRANCH = { id: 'b1', branch_code: 'BRC-A', name: 'Dr. Dana Roxas Dental Clinic', city: 'Bocaue', address: '1 St', phone: '(02) 8123 1001', open_time: '09:00:00', close_time: '18:00:00', status: 'Open', capacity_threshold: 80, latitude: null, longitude: null }
const API_SERVICE = { id: 'svc1', code: 'CONSULT', name: 'Dental Consultation', duration_minutes: 30, reference_fee_php: 600, category: 'General Dentistry', status: 'Active' }
const API_BRANCH_SERVICE = { branch_ref: 'b1', service_ref: 'svc1', active: true, duration_override_minutes: null }
const API_STAFF = { id: 's3', userId: 'u10', personId: 'per-s3', name: 'Nina Torres', title: 'Dental Assistant', branchId: 'b1', branch: 'Dr. Dana Roxas Dental Clinic', shiftStart: '09:00:00', shiftEnd: '18:00:00', available: true }
const API_DENTIST = { id: 'd1', userId: 'u3', personId: 'per-d1', name: 'Miguel Reyes', specialty: 'General Dentistry', license_no: 'PRC-D-1001', assistantStaffId: 's3', branch_ids: ['b1'], service_ids: ['svc1', 'svc2', 'svc3', 'svc4', 'svc5', 'svc11'], shiftStart: '09:00:00', shiftEnd: '18:00:00', available: true }

beforeEach(() => { api.__resetCsrfCacheForTests() })

test('branch bootstrap refuses malformed and duplicate catalogs without demo fallback', async () => {
  for (const branches of [null, {}, [null], [{id: 1, name:'Numeric'}], [API_BRANCH, API_BRANCH]]) {
    mockFetchSequence([jsonResponse(branches), jsonResponse([]), jsonResponse([]), jsonResponse([])])
    const result = await fetchReferenceData('patient')
    assert.equal(result.ok, false)
    assert.equal(result.kind, 'unavailable')
    assert.equal(result.data, undefined)
  }
})

test('branch mapper preserves server public identity and unconfirmed operating provenance', () => {
  const row = {...API_BRANCH, public_id:'01K00000000000000000000001', operating_data_status:'unconfirmed'}
  assert.equal(mapBranch(row).publicId, row.public_id)
  assert.equal(mapBranch(row).operatingDataStatus, 'unconfirmed')
  assert.equal(mapBranch(row).id, 'b1', 'downstream legacy references are not renumbered')
})

// ---- Mapper parity: exact legacy field shapes (Phase 2A plan, section A/D/J) ------------------------------

test('mapBranch produces the exact legacy INITIAL_BRANCHES shape', () => {
  const mapped = mapBranch(API_BRANCH)
  assert.deepEqual(mapped, {
    id: 'b1', branchCode: 'BRC-A', name: 'Dr. Dana Roxas Dental Clinic', city: 'Bocaue', address: '1 St', phone: '(02) 8123 1001',
    open: '09:00', close: '18:00', status: 'Open', threshold: 80,
    // The Owner's branch form also edits the map position (and, when the server sends them, email and days open).
    latitude: null, longitude: null,
  })
  assert.deepEqual(mapBranch({ ...API_BRANCH, email: null, operating_days: [1, 2, 3, 4, 5, 6] }).operatingDays, [1, 2, 3, 4, 5, 6])
})

test('mapService produces the exact legacy INITIAL_SERVICES shape', () => {
  const mapped = mapService(API_SERVICE)
  assert.deepEqual(mapped, { id: 'svc1', code: 'CONSULT', name: 'Dental Consultation', duration: 30, category: 'General Dentistry', status: 'Active' })
  assert.equal('baseFee' in mapped, false, 'the server Service has no fee')
})

test('mapBranchService derives the same bs-<branch>-<service> id data.js already generates', () => {
  const mapped = mapBranchService(API_BRANCH_SERVICE)
  assert.equal(mapped.id, 'bs-b1-svc1')
  assert.equal(mapped.branchId, 'b1')
  assert.equal(mapped.serviceId, 'svc1')
  assert.equal(mapped.active, true)
})

test('mapStaffProfile carries userId/personId as legacy_ref strings, never a bigint', () => {
  const mapped = mapStaffProfile(API_STAFF)
  assert.equal(mapped.id, 's3')
  assert.equal(mapped.userId, 'u10')
  assert.equal(mapped.personId, 'per-s3')
  assert.equal(mapped.branchId, 'b1')
  assert.equal(mapped.shiftStart, '09:00')
  assert.equal(mapped.available, true)
})

test('mapDentistProfile carries branchIds/assistantStaffId as legacy_ref strings, never a bigint', () => {
  const mapped = mapDentistProfile(API_DENTIST)
  assert.equal(mapped.id, 'd1')
  assert.equal(mapped.userId, 'u3')
  assert.equal(mapped.personId, 'per-d1')
  assert.deepEqual(mapped.branchIds, ['b1'])
  assert.equal(mapped.assistantStaffId, 's3')
  assert.equal(mapped.licenseNo, 'PRC-D-1001')
  assert.deepEqual(mapped.serviceIds, ['svc1', 'svc2', 'svc3', 'svc4', 'svc5', 'svc11'])
})

test('no mapped record ever carries a raw numeric id — every id/userId/personId/branchId/assistantStaffId is a legacy string', () => {
  const records = [mapBranch(API_BRANCH), mapService(API_SERVICE), mapStaffProfile(API_STAFF), mapDentistProfile(API_DENTIST)]
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (/^(id|userId|personId|branchId|assistantStaffId)$/.test(key) && value != null) {
        assert.equal(typeof value, 'string', `${key} on ${JSON.stringify(record)} must be a legacy string, not a raw number`)
      }
    }
  }
})

test('deriveDentistServiceAssignments reproduces the exact dsa-<dentist>-<service> generated shape', () => {
  const dentists = [mapDentistProfile(API_DENTIST)]
  const rows = deriveDentistServiceAssignments(dentists)
  assert.equal(rows.length, 6)
  assert.deepEqual(rows[0], { id: 'dsa-d1-svc1', dentistId: 'd1', serviceId: 'svc1' })
})

// ---- Legacy-ID cutover safety (Phase 2A plan, section S3) — the test that actually proves existing local
// records keep resolving, not just an assumption. Builds a representative still-local appointment/queue/
// treatment fixture referencing today's exact string ids, runs a mocked bootstrap through the real bridge,
// and confirms every cross-collection reference resolves against the bridge-mapped state. ------------------

function jsonResponse(body) { return { ok: true, status: 200, json: async () => ({ data: body }) } }
function adoptionFixture() {
  const state = normalizeClinicState({
    persons: structuredClone(data.INITIAL_PERSONS), users: structuredClone(data.INITIAL_USERS),
    branches: structuredClone(data.INITIAL_BRANCHES), services: structuredClone(data.INITIAL_SERVICES),
    branchServices: structuredClone(data.INITIAL_BRANCH_SERVICES), dentistServiceAssignments: structuredClone(data.INITIAL_DENTIST_SERVICE_ASSIGNMENTS),
    dentists: structuredClone(data.INITIAL_DENTISTS), staff: structuredClone(data.INITIAL_STAFF), patients: [],
    appointments: [], queue: [], treatments: [], invoices: [], hmo: [], inquiries: [], conversations: [],
    notifications: [], prescriptions: [], followups: [], automations: [], workflowLog: [], campaigns: [],
    loyalty: [], audit: [], checkIns: [], bookingDrafts: [],
  })
  const owner = sessionForRole('owner', state)
  const actions = createWorkflowActions({ getState: () => state, getSession: () => owner,
    commit: patch => Object.assign(state, normalizeClinicState({ ...state, ...patch })) })
  return { state, actions }
}

test('Staff server adoption reconciles the transitional branch mirror and keeps the session valid', () => {
  const { state, actions } = adoptionFixture()
  const confirmed = { ...state.staff.find(p => p.id === 's1'), branchId: 'b2' }
  assert.equal(actions.adoptPersonnelFromServer('staff', 's1', confirmed).ok, true)
  assert.equal(state.users.find(u => u.id === 'u2').branchId, 'b2')
  const session = sessionForRole('staff', state)
  assert.equal(session.branchId, 'b2'); assert.equal(session.active, true)
  assert.equal(state.users.find(u => u.id === 'u2').accountStatus, 'Active')
  assert.equal(state.staff.find(p => p.id === 's1').available, true)
})

test('Dentist server adoption preserves a current assigned branch and mirrors it', () => {
  const { state, actions } = adoptionFixture()
  const confirmed = { ...state.dentists.find(p => p.id === 'd1'), branchIds: ['b1', 'b2'] }
  assert.equal(state.users.find(u => u.id === 'u3').branchId, 'b1')
  assert.equal(actions.adoptPersonnelFromServer('dentists', 'd1', confirmed).ok, true)
  assert.equal(state.users.find(u => u.id === 'u3').branchId, 'b1')
  const session = sessionForRole('dentist', state)
  assert.equal(session.branchId, 'b1'); assert.equal(session.active, true)
})

test('Dentist server adoption selects the established fallback when current branch is removed', () => {
  const { state, actions } = adoptionFixture()
  const confirmed = { ...state.dentists.find(p => p.id === 'd1'), branchIds: ['b2'] }
  assert.equal(actions.adoptPersonnelFromServer('dentists', 'd1', confirmed).ok, true)
  assert.equal(state.users.find(u => u.id === 'u3').branchId, 'b2')
  const session = sessionForRole('dentist', state)
  assert.equal(session.branchId, 'b2'); assert.equal(session.active, true)
  assert.equal(state.dentists.find(p => p.id === 'd1').available, true)
})

test('personnel editors expose only role-supported controls', () => {
  const source = readFileSync(new URL('../src/pages/Admin.jsx', import.meta.url), 'utf8')
  const staff = source.split('title="Edit staff profile"')[1].split('</Modal>')[0]
  const dentist = source.split('title="Edit dentist profile"')[1].split('</Modal>')[0]
  assert.match(staff, /label="Staff title"/)
  assert.doesNotMatch(staff, /licenseNo|specialization|specialty|License no\.|Specialization/)
  assert.match(dentist, /label="License Number"[\s\S]*?onChange=/)
  assert.match(dentist, /label="Specialty"[\s\S]*?onChange=/)
})

test('Staff title mapping does not invent a Dentist specialty or license', () => {
  const staff = mapStaffProfile(API_STAFF)
  assert.equal(staff.staffType, API_STAFF.title)
  for (const field of ['specialty', 'specialization', 'licenseNo']) assert.equal(Object.hasOwn(staff, field), false)
  assert.equal(mapDentistProfile(API_DENTIST).specialty, API_DENTIST.specialty)
})

for (const collection of ['staff', 'dentists']) test(`${collection} supported edits use the API payload and adopt only confirmed personnel state`, async t => {
  const isStaff = collection === 'staff'
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const draft = isStaff
    ? { staffType: 'Receptionist', branchId: 'b2', shiftStart: '10:00', shiftEnd: '17:00', available: false }
    : { licenseNo: 'DEMO-TEST-123', specialty: 'Orthodontics', branchIds: ['b2'], assistantStaffId: null,
        shiftStart: '10:00', shiftEnd: '17:00', available: false }
  const expected = isStaff
    ? { title: 'Receptionist', branch_ref: 'b2', shift_start: '10:00', shift_end: '17:00', available: false, expected_revision: 'a'.repeat(64), operation_id: '11111111-1111-4111-8111-111111111111' }
    : { license_no: 'DEMO-TEST-123', specialty: 'Orthodontics', branch_ids: ['b2'], assistant_staff_ref: null,
        shift_start: '10:00', shift_end: '17:00', available: false }
  const confirmed = isStaff
    ? { ...API_STAFF, title: draft.staffType, branchId: 'b2', shiftStart: '10:00:00', shiftEnd: '17:00:00', available: false, revision: 'b'.repeat(64) }
    : { ...API_DENTIST, license_no: draft.licenseNo, specialty: draft.specialty, branch_ids: ['b2'],
        assistantStaffId: null, shiftStart: '10:00:00', shiftEnd: '17:00:00', available: false }
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/sanctum/csrf-cookie')) return { ok: true, status: 204 }
    assert.equal(String(url).endsWith(`/api/${collection}/${confirmed.id}`), true)
    assert.equal(options.method, 'PATCH')
    assert.deepEqual(JSON.parse(options.body), expected)
    return isStaff ? { ok: true, status: 200, json: async () => ({ data: confirmed, meta: { operation_id: expected.operation_id, replayed: false } }) } : jsonResponse(confirmed)
  }
  let state = normalizeClinicState({ ...personsAndUsersFixture(), branches: [mapBranch(API_BRANCH), { ...mapBranch(API_BRANCH), id: 'b2', name: 'Roxas - Cardinal Dental Center' }],
    services: [], branchServices: [], dentistServiceAssignments: [], dentists: [mapDentistProfile(API_DENTIST)], staff: [mapStaffProfile(API_STAFF)], patients: [],
    appointments: [], queue: [], treatments: [], invoices: [], hmo: [], inquiries: [], conversations: [],
    notifications: [], prescriptions: [], followups: [], automations: [], workflowLog: [], campaigns: [],
    loyalty: [], audit: [], checkIns: [], bookingDrafts: [] })
  const session = sessionForRole('owner', state)
  const actions = createWorkflowActions({ getState: () => state, getSession: () => session,
    commit: patch => { state = normalizeClinicState({ ...state, ...patch }) } })
  const before = structuredClone(state[collection])
  const result = await syncPersonnelUpdate(collection, confirmed.id, isStaff ? { ...draft, revision: expected.expected_revision, operationId: expected.operation_id } : draft)
  assert.equal(result.ok, true)
  assert.deepEqual(state[collection], before, 'API completion alone must not optimistically mutate state')
  assert.equal(actions.adoptPersonnelFromServer(collection, confirmed.id, result.record).ok, true)
  for (const [key, value] of Object.entries(draft)) assert.deepEqual(state[collection][0][key], value, key)
  assert.deepEqual(result.record, (isStaff ? mapStaffProfile : mapDentistProfile)(JSON.parse(JSON.stringify(confirmed))))
})

test('Staff personnel bridge refuses missing observation rather than fetching a newer revision behind the draft', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let sent = false
  globalThis.fetch = async () => { sent = true; throw Error('Unexpected dispatch') }
  const result = await syncPersonnelUpdate('staff', 's1', { shiftStart: '09:00', shiftEnd: '17:00' })
  assert.equal(result.code, 'staff_precondition_required')
  assert.equal(sent, false)
})
test('every Owner branch status survives API transport, mapping, adoption and reload without aliases', async t => {
  const canonical = ['Open', 'Temporarily Closed', 'Inactive']
  const source = readFileSync(new URL('../src/pages/Admin.jsx', import.meta.url), 'utf8')
  const select = source.match(/label="Branch status"[\s\S]*?<\/select>/)[0]
  assert.deepEqual([...select.matchAll(/<option>(.*?)<\/option>/g)].map(m => m[1]), canonical)

  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let stored = { ...API_BRANCH }
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/sanctum/csrf-cookie')) return { ok: true, status: 204 }
    assert.equal(String(url).endsWith('/api/branches/b1'), true)
    assert.equal(options.method, 'PATCH')
    const payload = JSON.parse(options.body)
    assert.ok(canonical.includes(payload.status))
    stored = { ...stored, ...payload }
    return jsonResponse(stored)
  }
  let state = normalizeClinicState({ ...personsAndUsersFixture(), branches: [mapBranch(stored)],
    services: [], branchServices: [], dentistServiceAssignments: [], dentists: [], staff: [], patients: [],
    appointments: [], queue: [], treatments: [], invoices: [], hmo: [], inquiries: [], conversations: [],
    notifications: [], prescriptions: [], followups: [], automations: [], workflowLog: [], campaigns: [],
    loyalty: [], audit: [], checkIns: [], bookingDrafts: [] })
  const session = sessionForRole('owner', state)
  const actions = createWorkflowActions({ getState: () => state, getSession: () => session,
    commit: patch => { state = normalizeClinicState({ ...state, ...patch }) } })
  for (const status of canonical) {
    const result = await syncBranchUpdate('b1', { status })
    assert.equal(result.ok, true)
    assert.equal(result.record.status, status)
    assert.equal(actions.adoptBranchFromServer('b1', result.record).ok, true)
    assert.equal(state.branches[0].status, status)
    assert.equal(mapBranch(JSON.parse(JSON.stringify(stored))).status, status)
  }
})
function mockFetchSequence(responses) {
  let i = 0
  globalThis.fetch = async () => responses[Math.min(i++, responses.length - 1)]
}

test('existing local appointment/queue/treatment records referencing b1/svc1/d1 resolve after bridging', async () => {
  mockFetchSequence([
    jsonResponse([API_BRANCH]), jsonResponse([API_SERVICE]), jsonResponse([API_BRANCH_SERVICE]), jsonResponse([API_DENTIST]),
  ])
  const result = await fetchReferenceData('patient')
  assert.equal(result.ok, true)

  // INITIAL_USERS/INITIAL_PERSONS stay local/unchanged this phase — a real still-local appointment record
  // was always shaped exactly like this, referencing these exact legacy ids.
  const legacyAppointment = { id: 'a99', branchId: 'b1', serviceId: 'svc1', dentistId: 'd1', patientId: 'p1', date: '2026-09-19', start: '09:00', status: 'Confirmed' }
  const legacyQueue = { id: 'q99', branchId: 'b1', serviceId: 'svc1', dentistId: 'd1', patientId: 'p1', status: 'Waiting' }
  const legacyTreatment = { id: 't99', branchId: 'b1', appointmentId: 'a99', patientId: 'p1', dentistId: 'd1' }

  const state = normalizeClinicState({
    persons: [], services: result.data.services, branchServices: result.data.branchServices,
    dentistServiceAssignments: result.data.dentistServiceAssignments, branches: result.data.branches,
    dentists: result.data.dentists, staff: [], patients: [], appointments: [legacyAppointment],
    queue: [legacyQueue], treatments: [legacyTreatment], invoices: [], hmo: [], inquiries: [], conversations: [],
    notifications: [], prescriptions: [], followups: [], users: [], automations: [], workflowLog: [],
    campaigns: [], loyalty: [], audit: [], checkIns: [], bookingDrafts: [],
  })

  const branch = state.branches.find(b => b.id === 'b1')
  const service = state.services.find(s => s.id === 'svc1')
  const dentist = state.dentists.find(d => d.id === 'd1')
  assert.ok(branch, 'bridge-mapped branch b1 must exist in state.branches')
  assert.ok(service, 'bridge-mapped service svc1 must exist in state.services')
  assert.ok(dentist, 'bridge-mapped dentist d1 must exist in state.dentists')
  assert.equal(typeof branch.id, 'string')
  assert.equal(typeof service.id, 'string')
  assert.equal(typeof dentist.id, 'string')

  const appointment = state.appointments.find(a => a.id === 'a99')
  assert.equal(appointment.branchId, 'b1')
  assert.equal(state.branches.some(b => b.id === appointment.branchId), true, 'appointment.branchId must resolve to a bridge-mapped branch')
  assert.equal(state.services.some(s => s.id === appointment.serviceId), true, 'appointment.serviceId must resolve to a bridge-mapped service')

  const queueEntry = state.queue.find(q => q.id === 'q99')
  assert.equal(state.branches.some(b => b.id === queueEntry.branchId), true, 'queue.branchId must resolve')

  const treatment = state.treatments.find(t => t.id === 't99')
  assert.equal(state.branches.some(b => b.id === treatment.branchId), true, 'treatment.branchId must resolve')

  // dentist.userId -> the still-local (unchanged) state.users collection, via legacy_user_ref.
  assert.equal(dentist.userId, 'u3')
  assert.equal(dentist.branchIds.includes('b1'), true)
})

test('a device with an existing local Dentist/Staff assistant link (assistantStaffId) still resolves after bridging', async () => {
  mockFetchSequence([
    jsonResponse([API_BRANCH]), jsonResponse([API_SERVICE]), jsonResponse([API_BRANCH_SERVICE]),
    jsonResponse([API_DENTIST]), jsonResponse([API_STAFF]),
  ])
  const result = await fetchReferenceData('owner')
  assert.equal(result.ok, true)
  assert.equal(result.data.staff.length, 1)

  const dentist = result.data.dentists.find(d => d.id === 'd1')
  assert.equal(dentist.assistantStaffId, 's3')
  assert.equal(result.data.staff.some(s => s.id === 's3'), true, 'the assistant staff record must be present in the same bridged response')
})

// ---- Role-aware bootstrap (Phase 2A plan, section H/point 1) ---------------------------------------------

test('Patient bootstrap never requests /api/staff', async () => {
  mockFetchSequence([jsonResponse([API_BRANCH]), jsonResponse([API_SERVICE]), jsonResponse([API_BRANCH_SERVICE]), jsonResponse([API_DENTIST])])
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => { calls.push(String(url)); return realFetch(url, options) }
  const result = await fetchReferenceData('patient')
  assert.equal(result.ok, true)
  assert.equal(calls.length, 4)
  assert.equal(calls.some(url => url.includes('/api/staff')), false)
})

test('Staff/Dentist/Owner bootstrap requests all five datasets including /api/staff', async () => {
  for (const role of ['staff', 'dentist', 'owner']) {
    mockFetchSequence([jsonResponse([API_BRANCH]), jsonResponse([API_SERVICE]), jsonResponse([API_BRANCH_SERVICE]), jsonResponse([API_DENTIST]), jsonResponse([API_STAFF])])
    const calls = []
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url, options) => { calls.push(String(url)); return realFetch(url, options) }
    const result = await fetchReferenceData(role)
    assert.equal(result.ok, true, role)
    assert.equal(calls.length, 5, role)
    assert.equal(calls.some(url => url.includes('/api/staff')), true, role)
  }
})

// ---- Session re-derivation bugfix (found via real-browser Phase 2A QA) -----------------------------------
// sessionForRole (contracts.js) computes session.active by calling validSession(state,session) internally,
// at the exact moment a session is first established — which for a Staff/Dentist session happens BEFORE
// the reference-data bootstrap fetch (this file's fetchReferenceData) has resolved, since that fetch only
// starts once a session exists. validSession's Staff/Dentist branches check state.staff/state.dentists,
// which are empty at that instant — so active gets permanently frozen false, and the session is never
// re-derived automatically once the fetch actually completes (src/store.jsx's dedicated recovery effect
// exists specifically to fix this — verified live via Playwright, not reproducible here without a new
// React-rendering/async test dependency this project doesn't have). These tests lock in the exact
// mechanism so a future change can't silently reintroduce it.

function personsAndUsersFixture() {
  return { persons: structuredClone(data.INITIAL_PERSONS), users: structuredClone(data.INITIAL_USERS) }
}

test('sessionForRole computes active:false for Staff when state.staff is still empty (the exact bug)', () => {
  const { persons, users } = personsAndUsersFixture()
  const state = normalizeClinicState({
    persons, users, services: [], branchServices: [], dentistServiceAssignments: [], branches: [],
    dentists: [], staff: [], patients: [], appointments: [], queue: [], treatments: [], invoices: [],
    hmo: [], inquiries: [], conversations: [], notifications: [], prescriptions: [], followups: [],
    automations: [], workflowLog: [], campaigns: [], loyalty: [], audit: [], checkIns: [], bookingDrafts: [],
  })
  const session = sessionForRole('staff', state)
  assert.equal(session.active, false, 'reproduces the bug: empty state.staff makes validSession (and therefore active) false')
})

test('sessionForRole computes active:true for Staff once state.staff/state.branches are populated (the fix target)', () => {
  const { persons, users } = personsAndUsersFixture()
  const state = normalizeClinicState({
    persons, users,
    services: structuredClone(data.INITIAL_SERVICES), branchServices: structuredClone(data.INITIAL_BRANCH_SERVICES),
    dentistServiceAssignments: structuredClone(data.INITIAL_DENTIST_SERVICE_ASSIGNMENTS),
    branches: structuredClone(data.INITIAL_BRANCHES), dentists: structuredClone(data.INITIAL_DENTISTS),
    staff: structuredClone(data.INITIAL_STAFF), patients: [], appointments: [], queue: [], treatments: [],
    invoices: [], hmo: [], inquiries: [], conversations: [], notifications: [], prescriptions: [], followups: [],
    automations: [], workflowLog: [], campaigns: [], loyalty: [], audit: [], checkIns: [], bookingDrafts: [],
  })
  const session = sessionForRole('staff', state)
  assert.equal(session.active, true, 'store.jsx re-derives the session via this exact call once refDataStatus is ready — this is what that re-derivation must produce')
})

test('a failed read call is reported, not silently swallowed into empty collections', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: 'server error' }) })
  const result = await fetchReferenceData('patient')
  assert.equal(result.ok, false)
})

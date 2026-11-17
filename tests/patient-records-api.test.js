import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as api from '../src/api-client.js'
import { EDITABLE_FIELDS, changedFields, loadPatientRecord, loadPatientRecordIndex, mapPatientRecord, savePatientRecord } from '../src/patient-records-api.js'
import { patientInScope, sessionForRole, normalizeClinicState } from '../src/contracts.js'
import * as data from '../src/data.js'

// M4 Patient record client: the clinic server is the only authority; failures are explicit, never a fallback Patient.

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
let calls
function stubFetch(...responses) {
  let i = 0
  globalThis.fetch = async (url, options = {}) => { calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null }); return responses[Math.min(i++, responses.length - 1)] }
}
beforeEach(() => { calls = []; globalThis.document = { cookie: 'XSRF-TOKEN=t' }; api.__resetCsrfCacheForTests() })

const STAFF_ROW = {
  id: '01j0000000000000000000000a', code: 'PAT-0001', name: 'Maria Santos', first_name: 'Maria', last_name: 'Santos', date_of_birth: '1990-05-06', sex: 'Female',
  phone: '+639171234567', emergency_contact: 'Juan', revision: 3, email: 'maria@example.test', address: '1 Main St',
  preferred_branch: { id: 'b1', name: 'Dr. Dana Roxas Dental Clinic' }, has_portal_account: true, profile_access: 'full',
}
const IDENTITY_ROW = { id: STAFF_ROW.id, code: 'PAT-0001', name: 'Maria Santos', first_name: 'Maria', last_name: 'Santos', date_of_birth: '1990-05-06', phone: '+639171234567', profile_access: 'identity' }

test('profile and linked-index reads reject another Patient instead of adopting their values/counts',async()=>{
  stubFetch(json(200,{data:{...STAFF_ROW,id:'another-patient'}}));assert.equal((await loadPatientRecord(STAFF_ROW.id)).kind,'unverified')
  stubFetch(json(200,{data:{patient:{id:'another-patient'},appointments:[],visits:[],treatments:[],invoices:[],hmo_cases:[]}}));assert.equal((await loadPatientRecordIndex(STAFF_ROW.id)).kind,'unverified')
  stubFetch(json(200,{data:{patient:{id:STAFF_ROW.id},appointments:[]}}));assert.equal((await loadPatientRecordIndex(STAFF_ROW.id)).kind,'unverified','Missing families are not zero counts')
})
test('save requires exact Patient, full access and the original resulting revision',async()=>{
 const record=mapPatientRecord(STAFF_ROW)
 for(const patch of [{id:'another-patient'},{profile_access:'identity'},{revision:5},{revision:3}]){
  api.__resetCsrfCacheForTests();stubFetch(json(204,{}),json(200,{data:{...STAFF_ROW,revision:4,...patch}}))
  const r=await savePatientRecord(record,{...record,address:'Synthetic changed address'},{key:'profile-exact'});assert.equal(r.kind,'unverified',JSON.stringify(patch));assert.equal(r.record,undefined)
 }
})
test('explicit same-revision no-op receipt remains compatible without inventing a new revision',async()=>{
 const record=mapPatientRecord(STAFF_ROW);stubFetch(json(204,{}),json(200,{data:STAFF_ROW,meta:{unchanged:true}}))
 const r=await savePatientRecord(record,{...record,address:'Synthetic normalization'},{key:'profile-noop'});assert.equal(r.ok,true);assert.equal(r.unchanged,true);assert.equal(r.record.revision,3)
})

test('a full projection maps to the UI record and an identity-tier projection leaves everything beyond the directory fields undefined', () => {
  const full = mapPatientRecord(STAFF_ROW)
  assert.deepEqual([full.id, full.patientCode, full.dob, full.email, full.address, full.sex, full.preferredBranchId, full.revision, full.hasPortalAccount, full.access], [STAFF_ROW.id, 'PAT-0001', '1990-05-06', 'maria@example.test', '1 Main St', 'Female', 'b1', 3, true, 'full'])
  const identity = mapPatientRecord(IDENTITY_ROW)
  assert.equal(identity.access, 'identity')
  for (const key of ['email', 'address', 'sex', 'emergencyContact', 'preferredBranchId', 'revision']) assert.equal(identity[key], undefined, `${key} is not shown at the identity tier`)
  assert.equal(identity.phone, '+639171234567')
})

test('only changed, allowlisted fields are sent; an account holder email is never sent', () => {
  const record = mapPatientRecord(STAFF_ROW)
  assert.deepEqual(changedFields(record, { ...record }), {})
  assert.deepEqual(changedFields(record, { ...record, firstName: ' Marie ', address: '' }), { first_name: 'Marie', address: null })
  assert.deepEqual(changedFields(record, { ...record, email: 'other@example.test' }), {}, 'M1 owns the email of a portal account holder')
  const walkIn = mapPatientRecord({ ...STAFF_ROW, has_portal_account: false })
  assert.deepEqual(changedFields(walkIn, { ...walkIn, email: 'other@example.test' }), { email: 'other@example.test' })
  assert.deepEqual(changedFields(record, { ...record, preferredBranchId: null }), { preferred_branch_id: null })
  for (const forbidden of ['allergies', 'medicalHistory', 'dentalHistory', 'patientCode', 'id', 'revision', 'consent']) assert.ok(!(forbidden in EDITABLE_FIELDS), `${forbidden} is not editable here`)
  assert.deepEqual(changedFields(record, { ...record, allergies: 'x', medicalHistory: 'y', dentalHistory: 'z', patientCode: 'PAT-9999' }), {})
})

test('saving sends only the changes with the loaded revision and adopts the server result', async () => {
  const record = mapPatientRecord(STAFF_ROW)
  stubFetch(json(200, {}), json(200, { data: { ...STAFF_ROW, first_name: 'Marie', name: 'Marie Santos', revision: 4 } }))
  const result = await savePatientRecord(record, { ...record, firstName: 'Marie' })
  assert.equal(result.ok, true)
  assert.equal(result.record.revision, 4)
  const patch = calls.find(c => c.method === 'PATCH')
  assert.equal(patch.url.endsWith(`/api/patients/${STAFF_ROW.id}`), true)
  assert.deepEqual(patch.body, { first_name: 'Marie', expected_revision: 3 })
})

test('an unchanged save makes no request', async () => {
  const record = mapPatientRecord(STAFF_ROW)
  stubFetch(json(500, {}))
  const result = await savePatientRecord(record, { ...record })
  assert.deepEqual([result.ok, result.unchanged, calls.length], [true, true, 0])
})

test('a stale revision is reported as a conflict, not applied locally', async () => {
  const record = mapPatientRecord(STAFF_ROW)
  stubFetch(json(200, {}), json(409, { message: 'stale', code: 'stale_revision', current_revision: 5 }))
  const result = await savePatientRecord(record, { ...record, phone: '+639172222222' })
  assert.deepEqual([result.ok, result.kind, result.code], [false, 'conflict', 'stale_revision'])
  assert.match(result.message, /patient record changed/)
})

test('a failed load is an explicit failure with no Patient data (no demo or first-patient fallback)', async () => {
  for (const [status, kind] of [[404, 'not_found'], [403, 'forbidden'], [500, 'server']]) {
    stubFetch(json(status, {}))
    const result = await loadPatientRecord(STAFF_ROW.id)
    assert.equal(result.ok, false)
    assert.equal(result.kind, kind)
    assert.equal(result.record, undefined)
  }
  globalThis.fetch = async () => { throw new TypeError('offline') }
  const offline = await loadPatientRecord(STAFF_ROW.id)
  assert.deepEqual([offline.ok, offline.kind, offline.record], [false, 'network', undefined])
})

test('the record index reports counts and the families that have no server source yet', async () => {
  stubFetch(json(200, { data: { patient: { id: STAFF_ROW.id }, appointments: [{}, {}], visits: [{}], treatments: [], invoices: [], hmo_cases: [{}], limit_per_list: 100, unavailable: ['clinical_history', 'prescriptions', 'follow_ups'] } }))
  const result = await loadPatientRecordIndex(STAFF_ROW.id)
  assert.deepEqual(result.counts, { appointments: 2, visits: 1, treatments: 0, invoices: 0, hmo_cases: 1 })
  assert.deepEqual(result.unavailable, ['clinical_history', 'prescriptions', 'follow_ups'])
})

test('the client never touches browser storage and always addresses a Patient by the encoded public id', async () => {
  const source = readFileSync(new URL('../src/patient-records-api.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /localStorage|sessionStorage/)
  stubFetch(json(200, { data: IDENTITY_ROW }))
  await loadPatientRecord('a/b?c')
  assert.ok(calls[0].url.endsWith('/api/patients/a%2Fb%3Fc'))
})

test('a server Staff session sees a server Patient as in scope; a local Patient keeps the browser rule', () => {
  const seeds = Object.fromEntries(Object.entries({ persons: 'PERSONS', branches: 'BRANCHES', patients: 'PATIENTS', users: 'USERS', staff: 'STAFF', dentists: 'DENTISTS', services: 'SERVICES' })
    .map(([k, v]) => [k, structuredClone(data[`INITIAL_${v}`])]))
  const state = normalizeClinicState({ ...seeds, appointments: [], visits: [], queue: [], treatments: [], invoices: [], prescriptions: [], followups: [], hmo: [], conversations: [], inquiries: [], notifications: [], workflowLog: [], audit: [] })
  const staff = { ...sessionForRole('staff', state), serverUserId: '01K00000000000000000000002' }
  const serverPatient = { id: STAFF_ROW.id, publicId: STAFF_ROW.id, serverProjection: true, preferredBranchId: null }
  assert.equal(patientInScope(serverPatient, state, staff), true)
  assert.equal(patientInScope(serverPatient, state, sessionForRole('staff', state)), false, 'without a server session a projection grants nothing')
  assert.equal(patientInScope({ ...serverPatient, serverProjection: false }, state, staff), false)
})

test('the Patients page and My Profile read the clinic server with loading, error and retry, and hold no demo fallback', () => {
  const clinical = readFileSync(new URL('../src/pages/Clinical.jsx', import.meta.url), 'utf8')
  const me = readFileSync(new URL('../src/pages/PatientMe.jsx', import.meta.url), 'utf8')
  assert.match(clinical, /function ServerPatientSummary/)
  assert.match(clinical, /Loading the patient record from the clinic server/)
  assert.match(clinical, /Patient record unavailable/)
  assert.match(clinical, />Retry</)
  assert.match(clinical, /Allergies, medical history and dental history are not stored on the clinic server yet/)
  assert.match(clinical, /serverPatient=serverSession&&!!patient\?\.serverProjection/)
  // Server sessions list only authoritative server Patients; there is no read-only "earlier browser record" path left.
  assert.match(clinical, /\(!serverSession\|\|p\.serverProjection\)&&patientInScope/)
  assert.doesNotMatch(clinical, /Earlier browser record|locked/)
  assert.match(clinical, /Patient search unavailable/)
  assert.match(clinical, /Full patient record not available to Dentists yet/)
  assert.doesNotMatch(clinical, /patient\?\.patientCode \|\| patient\?\.id/, 'documents are addressed by public id only')
  assert.match(me, /loadPatientRecord\(session\.patientPublicId\)/)
  assert.match(me, /We couldn’t load your profile/)
  // The server summary component never reads the browser clinical fields.
  const summary = clinical.slice(clinical.indexOf('function ServerPatientSummary'), clinical.indexOf('function PatientDocumentsTab'))
  assert.doesNotMatch(summary.slice(0, summary.indexOf('function StaffPatientSummary')), /loadPatientRecord/, 'a Dentist session never requests the generic Patient record')
  assert.doesNotMatch(summary, /patient\.(allergies|medicalHistory|dentalHistory)|INITIAL_PATIENTS|localStorage/)
})

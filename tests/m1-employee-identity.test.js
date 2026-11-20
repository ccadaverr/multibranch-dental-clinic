import { variableValue } from './support/source-behavior.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as data from '../src/data.js'
import { createIdentityBridge, EMPLOYEE_ROLE_PERMISSIONS } from '../src/identity-bridge.js'
import { normalizeClinicState, sessionForEmployee } from '../src/contracts.js'
import { canAccessPage, validSession } from '../src/safeguards.js'

// M1: a server-provisioned Staff/Dentist opens their OWN workspace from /api/me (`employee` = own profile ref + branch),
// never the demo identity table. Server tests: backend/tests/Feature/Identity/EmployeeInvitationTest.php.
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const seedKeys = { persons: 'PERSONS', services: 'SERVICES', branchServices: 'BRANCH_SERVICES', dentistServiceAssignments: 'DENTIST_SERVICE_ASSIGNMENTS', branches: 'BRANCHES', dentists: 'DENTISTS', staff: 'STAFF', patients: 'PATIENTS', users: 'USERS' }
const empty = { appointments: [], queue: [], checkIns: [], treatments: [], invoices: [], prescriptions: [], followups: [], hmo: [], conversations: [], inquiries: [], notifications: [], workflowLog: [], audit: [] }
const UID = '01KNEWSTAFF000000000000001', DUID = '01KNEWDENT0000000000000001'

function harness({ withProfiles = true } = {}) {
  const seeds = Object.fromEntries(Object.entries(seedKeys).map(([k, n]) => [k, structuredClone(data[`INITIAL_${n}`])]))
  // what the store projects from GET /api/staff and /api/dentists for the invited people (userId = server user public id)
  const serverStaff = { id: 's-01knew', userId: UID, personId: 'per-s-01knew', branchId: 'b2', staffType: 'Front Desk Lead', role: 'Front Desk Lead', available: false }
  const serverDentist = { id: 'd-01knew', userId: DUID, personId: 'per-d-01knew', branchIds: ['b1', 'b2'], staffType: 'Dentist', specialty: '', available: false }
  let state = normalizeClinicState({ ...seeds, ...empty, staff: [...seeds.staff, ...(withProfiles ? [serverStaff] : [])], dentists: [...seeds.dentists, ...(withProfiles ? [serverDentist] : [])] })
  const bridge = createIdentityBridge({ getState: () => state, commit: patch => { state = normalizeClinicState({ ...state, ...patch }) } })
  return { bridge, get state() { return state } }
}
const staffMe = (over = {}) => ({ id: UID, role: 'staff', email: 'rina@example.test', name: 'Rina Lopez', first_name: 'Rina', last_name: 'Lopez', account_status: 'Active', employee: { profile_id: 's-01knew', branch_id: 'b2', title: 'Front Desk Lead' }, ...over })
const dentistMe = (over = {}) => ({ id: DUID, role: 'dentist', email: 'dr.new@example.test', name: 'Ana Reyes', first_name: 'Ana', last_name: 'Reyes', account_status: 'Active', employee: { profile_id: 'd-01knew', branch_id: 'b1', title: null }, ...over })

test('an invited Staff member opens their own workspace, not the demo Staff identity', () => {
  const h = harness()
  const result = h.bridge(staffMe())
  assert.equal(result.ok, true)
  const s = result.session
  assert.deepEqual([s.role, s.userId, s.staffId, s.branchId, s.employeeBridge], ['staff', UID, 's-01knew', 'b2', true])
  assert.notEqual(s.userId, data.ROLE_INFO.staff.userId)
  assert.equal(s.active, true)
  assert.equal(validSession(h.state, s), true)
  const user = h.state.users.find(u => u.id === UID)
  assert.equal(user.roleName, 'Staff') // a non-legacy title is a label, not a role or permission
  assert.deepEqual(user.permissions, [...EMPLOYEE_ROLE_PERMISSIONS.staff])
  assert.equal(canAccessPage(h.state, s, 'appointments'), true)
  assert.equal(canAccessPage(h.state, s, 'users'), false) // Owner pages stay Owner-only
  assert.equal(canAccessPage(h.state, s, 'treatment'), false)
  // a second sign-in reuses the same local projection (no duplicate)
  const again = h.bridge(staffMe())
  assert.equal(again.ok, true); assert.equal(h.state.users.filter(u => u.id === UID).length, 1)
})

test('an invited Dentist opens their own clinical workspace at the server-reported branch', () => {
  const h = harness()
  const r = h.bridge(dentistMe())
  assert.equal(r.ok, true)
  assert.deepEqual([r.session.dentistId, r.session.branchId, r.session.active], ['d-01knew', 'b1', true])
  assert.equal(canAccessPage(h.state, r.session, 'treatment'), true)
  assert.equal(canAccessPage(h.state, r.session, 'billing'), false)
})

test('the session stays inactive until the server profile is loaded, then re-derives to the SAME person', () => {
  const h = harness({ withProfiles: false })
  const r = h.bridge(staffMe())
  assert.equal(r.ok, true); assert.equal(r.session.active, false)
  const later = normalizeClinicState({ ...h.state, staff: [...h.state.staff, { id: 's-01knew', userId: UID, personId: 'per-s-01knew', branchId: 'b2', staffType: 'Front Desk Lead', role: 'Front Desk Lead' }] })
  const rederived = sessionForEmployee(later, r.session)
  assert.deepEqual([rederived.userId, rederived.staffId, rederived.active], [UID, 's-01knew', true])
  assert.equal(sessionForEmployee(later, { ...r.session, employeeBridge: false }), null)
  const sessionRef={current:{...r.session,serverUserId:'server-invited-staff',branchScopes:['b2']}}, stateRef={current:later}, generations=[]
  let published
  const setSession=variableValue('src/store.jsx','setSession',{
    sessionRef,stateRef,sessionForEmployee,sessionForRole:()=>{throw Error('must not substitute demo identity')},
    authLifetime:{current:{rederive:()=>generations.push('rederived')}},setSessionState:v=>{published=v},actionsRef:{current:null},
  })
  setSession('staff')
  assert.equal(sessionRef.current.staffId,'s-01knew');assert.equal(published.userId,UID)
  assert.equal(published.serverUserId,'server-invited-staff');assert.deepEqual(published.branchScopes,['b2'])
  assert.equal(published.active,true);assert.deepEqual(generations,['rederived'])
  setSession(null);assert.equal(sessionRef.current,null);assert.equal(published,null)
})

test('missing or contradictory server links fail closed', () => {
  for (const bad of [staffMe({ employee: null }), staffMe({ employee: { profile_id: '', branch_id: 'b2' } }), staffMe({ employee: { profile_id: 's-01knew' } }), staffMe({ account_status: 'Invited' }), staffMe({ id: 7 })]) {
    assert.equal(harness().bridge(bad).ok, false)
  }
  // a profile owned by another server user never validates (server staff.userId must equal this user)
  const h = harness()
  const other = h.bridge(staffMe({ id: '01KSOMEONEELSE000000000001', employee: { profile_id: 's-01knew', branch_id: 'b2', title: 'X' } }))
  assert.equal(other.ok, true); assert.equal(other.session.active, false)
  assert.equal(validSession(h.state, { ...other.session, active: true }), false)
  // the same person id re-used by a different account is refused
  assert.equal(h.bridge(staffMe()).ok, false)
  // a branch the profile does not belong to never validates
  const h2 = harness()
  const wrongBranch = h2.bridge(staffMe({ employee: { profile_id: 's-01knew', branch_id: 'b1', title: 'X' } }))
  assert.equal(wrongBranch.session.active, false)
})

test('demo seed accounts keep their existing explicit mapping', () => {
  const h = harness()
  const owner = h.bridge({ id: '01KOWNER', role: 'owner', email: 'owner@example.test' })
  assert.equal(owner.session.userId, data.ROLE_INFO.owner.userId)
  const staff = h.bridge({ id: '01KREC', role: 'staff', email: 'staff.reception@example.test', employee: { profile_id: 's1', branch_id: 'b1' } })
  assert.equal(staff.session.userId, data.ROLE_INFO.staff.userId)
  assert.equal(h.bridge({ id: '01KOWN2', role: 'owner', email: 'second.owner@example.test' }).ok, false) // no additional Owner mapping (PI-01)
})

test('demo employees use their real profile links when a development database assigns different profiles', () => {
  const h = harness()
  const staff = h.bridge(staffMe({ email: 'staff.reception@example.test' }))
  const dentist = h.bridge(dentistMe({ email: 'dentist@example.test' }))

  assert.deepEqual([staff.session.userId, staff.session.staffId, staff.session.branchId], [UID, 's-01knew', 'b2'])
  assert.deepEqual([dentist.session.userId, dentist.session.dentistId, dentist.session.branchId], [DUID, 'd-01knew', 'b1'])
  assert.equal(validSession(h.state, staff.session), true)
  assert.equal(validSession(h.state, dentist.session), true)
})

import { sessionForEmployee, sessionForRole, sessionForUser } from './contracts.js'
import { uid } from './logic.js'
import { clinicNow } from './clock.js'

// Backend Foundation 1B — TEMPORARY compatibility bridge. Authentication, identity and role are authoritative
// from the real Laravel/Sanctum backend (`GET /api/me`); this module's only job is to project that backend
// identity onto the still-frontend-local business collections (persons/patients/users) so the existing,
// unmigrated pages/selectors keep working completely unchanged. Remove this file, and the `bridgeBackendIdentity`
// wiring in store.jsx, as each corresponding module's data moves to the backend.
//
// Every explicit mapping entry verifies BOTH the exact backend seed email AND that the backend's own `me.role`
// matches the role this entry claims — email alone is never sufficient authority. This table is intentionally
// the ONLY place a backend identity is translated into a local operational identity; nothing here scans an
// array, picks "the first" of anything, or guesses.
const DEMO_IDENTITY_MAP = {
  'owner@example.test': { role: 'owner', kind: 'role-info', roleInfoKey: 'owner' },
  'staff.reception@example.test': { role: 'staff', kind: 'role-info', roleInfoKey: 'staff', legacyProfileRef: 's1' },
  // staff.assistant@example.test is deliberately NOT mapped: ROLE_INFO defines exactly one local Staff
  // operational identity (Alyssa Cruz / u2), already claimed above. Mapping a second, distinct backend person
  // to that same local identity would mean two different backend people sharing one local Staff account —
  // exactly what must never happen. This account fails closed (see bridgeFromBackend below) until a second
  // local Staff identity exists to map it to. staff.reception@example.test alone is sufficient for an
  // end-to-end Staff demo.
  'dentist@example.test': { role: 'dentist', kind: 'role-info', roleInfoKey: 'dentist', legacyProfileRef: 'd1' },
  // Explicit alignment, not a rename of the backend seed and not a name/fuzzy match: the Backend 1A demo
  // Patient account is declared here to represent the existing, already-populated local Patient (Maria
  // Santos, p1/u12), so signing in through the real backend still demonstrates her existing care history
  // rather than a second, empty duplicate Patient.
  'patient@example.test': { role: 'patient', kind: 'local-patient', patientId: 'p1', userId: 'u12' },
}

const cleanText = value => typeof value === 'string' ? value.trim() : ''

export function createIdentityBridge({ getState, commit, clock = clinicNow }) {
  return function bridgeFromBackend(me) {
    if (!me || typeof me !== 'object' || !me.role) return { ok: false, reason: 'invalid-identity' }
    const mapped = DEMO_IDENTITY_MAP[me.email]
    if (mapped) {
      if (mapped.role !== me.role) return { ok: false, reason: 'role-mismatch' }
      const state = getState()
      const session = mapped.kind === 'role-info'
        ? sessionForRole(mapped.roleInfoKey, state)
        : sessionForUser(state, mapped.userId)
      if (mapped.legacyProfileRef && me.employee
        && (me.employee.profile_id !== mapped.legacyProfileRef || me.employee.branch_id !== session?.branchId)) {
        return bridgeEmployee(me, { getState, commit })
      }
      return session?.role === me.role ? { ok: true, session } : { ok: false, reason: 'no-local-identity' }
    }
    // Any backend account not in the explicit table above fails closed unless it is a Patient — any number
    // of real people can register as a Patient, so that path is general-purpose, not table-based.
    if (me.role === 'staff' || me.role === 'dentist') return bridgeEmployee(me, { getState, commit })
    if (me.role !== 'patient') return { ok: false, reason: 'no-local-identity' }
    return bridgePatient(me, { getState, commit, clock })
  }
}

// M1: page permissions for a server-provisioned employee mirror what the SERVER authorizes for the role (route
// middleware role:staff / role:dentist); they are the same for every member of the role and are never derived from a
// job title (PI-09 is unanswered: narrowing a role by duty needs a clinic decision and a server change first). They
// equal the long-standing local Staff and Dentist workspaces.
export const EMPLOYEE_ROLE_PERMISSIONS = Object.freeze({
  staff: Object.freeze(['appointments', 'checkin', 'queue', 'patient-demographics', 'billing', 'hmo', 'messages', 'followups']),
  dentist: Object.freeze(['schedule', 'queue', 'clinical-records', 'treatment', 'prescriptions', 'followups', 'messages']),
})
const LEGACY_STAFF_TITLES = ['Receptionist', 'Dental Assistant', 'HMO Coordinator', 'Cashier', 'Patient Engagement Staff']

// M1: a Staff/Dentist account that is not one of the demo seeds opens its OWN workspace from the server's answer:
// `me.employee` names the person's operational profile (server legacy_ref) and working branch. The local projection is
// keyed by the server user public id, so the server profile's `userId` link matches it exactly. Fails closed on any
// missing or contradictory link; it never borrows another person's identity.
function bridgeEmployee(me, { getState, commit }) {
  const emp = me.employee
  if (typeof me.id !== 'string' || me.account_status !== 'Active' || !emp || typeof emp.profile_id !== 'string' || !emp.profile_id || typeof emp.branch_id !== 'string' || !emp.branch_id)
    return { ok: false, reason: 'no-employee-profile' }
  const state = getState()
  const personId = `per-${emp.profile_id}`
  const title = cleanText(emp.title)
  const roleName = me.role === 'dentist' ? 'Dentist' : LEGACY_STAFF_TITLES.includes(title) ? title : 'Staff'
  const permissions = [...EMPLOYEE_ROLE_PERMISSIONS[me.role]]
  const existing = state.users.find(u => u.id === me.id)
  if (existing && (existing.backendUserId !== me.id || existing.backendEmployeeProfileId !== emp.profile_id || existing.personId !== personId)) return { ok: false, reason: 'identity-mismatch' }
  if (!existing && state.users.some(u => u.personId === personId || u.backendUserId === me.id)) return { ok: false, reason: 'identity-conflict' }
  const otherPerson = state.persons.find(p => p.id === personId)
  if (otherPerson && !existing) return { ok: false, reason: 'identity-conflict' }
  const person = { id: personId, firstName: cleanText(me.first_name), lastName: cleanText(me.last_name), email: cleanText(me.email).toLowerCase(), phone: cleanText(me.phone), dob: '', sex: '', address: '' }
  const user = {
    ...(existing || {}), id: me.id, personId, username: person.email, login: person.email, roleName, role: roleName,
    branchId: emp.branch_id, accountStatus: 'Active', status: 'Active', permissions,
    backendUserId: me.id, backendEmployeeProfileId: emp.profile_id,
  }
  commit({
    persons: existing ? state.persons.map(p => p.id === personId ? { ...p, ...person } : p) : [...state.persons, person],
    users: existing ? state.users.map(u => u.id === me.id ? user : u) : [...state.users, user],
  })
  const base = {
    role: me.role, label: me.role === 'dentist' ? 'Dentist' : 'Staff', name: `${me.role === 'dentist' ? 'Dr. ' : ''}${cleanText(me.name) || person.email}`,
    subtitle: me.role === 'dentist' ? 'Clinical Services' : title || 'Staff', userId: me.id, branchId: emp.branch_id, employeeBridge: true,
    ...(me.role === 'dentist' ? { dentistId: emp.profile_id } : { staffId: emp.profile_id }),
  }
  // Reference data (server staff/dentist profiles) may still be loading: the session is re-validated when it arrives.
  return { ok: true, session: sessionForEmployee(getState(), base) }
}

// Upserts a minimal local Person/Patient/User projection for a real, backend-authenticated Patient who has no
// pre-existing local demo row. Which Patient the login owns is decided by the server (`me.patient`, resolved through
// User -> Person -> Patient); an account with no server Patient record fails closed instead of being guessed.
// Idempotent by the public ids (`backendUserId` = user public_id, `backendPatientId` = Patient public_id): a second
// login from the same backend account reuses the same local IDs rather than creating a duplicate. Creates identity
// only — no appointment, treatment, invoice, HMO case or any other history is fabricated.
function bridgePatient(me, { getState, commit, clock }) {
  const serverPatientId = typeof me.patient?.id === 'string' ? me.patient.id : null
  if (typeof me.id !== 'string' || !serverPatientId) return { ok: false, reason: 'no-patient-record' }
  const sessionFor = user => {
    const session = sessionForUser(getState(), user.id)
    return session ? { ok: true, session } : { ok: false, reason: 'stale-local-identity' }
  }
  const existingUser = getState().users.find(u => u.backendUserId === me.id)
  if (existingUser) {
    if (existingUser.backendPatientId !== serverPatientId || (existingUser.roleName || existingUser.role) !== 'Patient') return { ok: false, reason: 'identity-mismatch' }
    const result = sessionFor(existingUser)
    return result.session?.role === 'patient' ? result : { ok: false, reason: 'role-mismatch' }
  }
  // A local record already keyed to this server Patient under another account id is never reused or duplicated.
  if (getState().users.some(u => u.backendPatientId === serverPatientId)) return { ok: false, reason: 'patient-already-linked' }

  // TEMPORARY COMPATIBILITY MIGRATION — remove the legacy email-based local-record re-key after the remaining
  // browser-local Patient-dependent collections have been migrated to backend authority. Nothing new may depend on it.
  // One-time, deterministic re-key of a projection saved before the public-id cutover, when this bridge still stored
  // the numeric backend user id. It runs only after the backend has authenticated the User and returned the
  // authoritative Patient public_id, and it only re-labels this browser's own saved record with that server id: it
  // never chooses the server Patient, never alters server relationships, and never guesses — exactly one old-format
  // match is required and more than one fails closed.
  const email = cleanText(me.email).toLowerCase()
  const legacy = getState().users.filter(u => typeof u.backendUserId === 'number' && (u.roleName || u.role) === 'Patient'
    && cleanText(u.login).toLowerCase() === email)
  if (legacy.length > 1) return { ok: false, reason: 'ambiguous-legacy-identity' }
  if (legacy.length === 1) {
    const state = getState()
    const { backendPersonId, ...rekeyed } = legacy[0]
    commit({ users: state.users.map(u => u.id === legacy[0].id ? { ...rekeyed, backendUserId: me.id, backendPatientId: serverPatientId } : u) })
    return sessionFor(legacy[0])
  }

  const state = getState()
  const now = clock()
  const openBranch = state.branches.find(b => b.status === 'Open')
  const firstName = cleanText(me.first_name)
  const lastName = cleanText(me.last_name)

  const person = {
    id: uid('per'), firstName, lastName, email,
    phone: cleanText(me.phone), dob: cleanText(me.date_of_birth), sex: '', address: '',
  }
  // No branch preference exists in the current backend registration contract (see backend/README.md); the
  // first Open branch is a technical default for local operational compatibility only, never presented as a
  // stated Patient preference.
  const patient = {
    id: uid('p'), personId: person.id, userId: null,
    // The server's patient_code, so the local projection shows the same clinic-facing code as the backend record.
    patientCode: cleanText(me.patient.code) || `PAT-${String(state.patients.length + 1).padStart(4, '0')}`,
    preferredBranchId: openBranch?.id || null, hmo: 'None', hmoMember: '—', allergies: '', medicalHistory: '',
    dentalHistory: '', emergencyContact: '', consent: false,
  }
  const user = {
    id: uid('u'), personId: person.id, username: email, login: email, roleName: 'Patient', role: 'Patient',
    branchId: null, accountStatus: 'Active', status: 'Active', permissions: ['patient-portal'],
    lastLogin: now.timestamp, registeredAt: now.timestamp,
    // Markers written only by this bridge; they make the upsert idempotent and are what makes this whole file
    // removable later without touching the canonical person_id/patient_id relationships they point back to.
    backendUserId: me.id, backendPatientId: serverPatientId,
  }
  patient.userId = user.id

  const key = `backend-bridge:${me.id}`, eventId = `event:${key}`
  const logEntry = {
    id: eventId, commandKey: key, at: now.label, createdAt: now.timestamp, domain: 'identity→patient',
    event: 'patient.backend_identity_bridged', eventType: 'patient.backend_identity_bridged',
    result: 'Backend-authenticated Patient identity created (local compatibility projection)',
    status: 'Success', entityType: 'patient', entityId: patient.id, patientId: patient.id,
    branchId: patient.preferredBranchId,
  }
  const auditEntry = {
    id: uid('aud'), eventId, at: now.label, actor: `${firstName} ${lastName}`.trim() || email,
    actorUserId: user.id, action: 'Backend-authenticated Patient registration (local compatibility projection)',
    domain: 'identity→patient',
  }

  commit({
    persons: [...state.persons, person],
    patients: [...state.patients, patient],
    users: [...state.users, user],
    workflowLog: [logEntry, ...state.workflowLog],
    audit: [auditEntry, ...state.audit].slice(0, 150),
  })

  const session = sessionForUser(getState(), user.id)
  return session ? { ok: true, session } : { ok: false, reason: 'bridge-failed' }
}

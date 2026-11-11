import * as data from '../../src/data.js'
import { normalizeClinicState, sessionForRole } from '../../src/contracts.js'

// Synthetic browser/unit acceptance only; no server, database or real personnel.
export function personnelFixture(role = 'owner') {
  const keys = { persons:'PERSONS', services:'SERVICES', branchServices:'BRANCH_SERVICES', dentistServiceAssignments:'DENTIST_SERVICE_ASSIGNMENTS', branches:'BRANCHES', dentists:'DENTISTS', staff:'STAFF', patients:'PATIENTS', users:'USERS' }
  const seeds = Object.fromEntries(Object.entries(keys).map(([key, name]) => [key, structuredClone(data[`INITIAL_${name}`])]))
  // Match the store's canonical Person-to-display projection before normalization.
  for (const collection of ['users','dentists','staff']) seeds[collection] = seeds[collection].map(row => {
    const person = seeds.persons.find(p => p.id === row.personId)
    return {...row, name:`${collection === 'dentists' ? 'Dr. ' : ''}${person.firstName} ${person.lastName}`}
  })
  const state = normalizeClinicState({ ...seeds, appointments:[], visits:[], queue:[], treatments:[], invoices:[], prescriptions:[], followups:[], hmo:[], conversations:[], inquiries:[], notifications:[], workflowLog:[], audit:[] })
  const session = { ...sessionForRole(role, state), serverUserId:`synthetic-${role}` }
  return { state, session }
}

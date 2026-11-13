import * as api from './api-client.js'
import { appointmentWindow, normalizeFailure } from './appointments-api.js'

// M8 Visit client. Laravel/PostgreSQL is the ONLY authority for Patient arrival (scheduled Check-In, Walk-In) and for
// Visit arrival. This module reads server Visits and sends the named M8 commands; the Visit's clinical progression is
// driven only by the M5 Treatment commands (src/treatments-api.js). The mapped Visits feed the in-memory projection,
// which is never persisted and never written back. Failures use the same normalized shape as the appointment client,
// so 401s reach the shared session-invalidated path.

const PAGE_SIZE = 100
const MAX_PAGES = 20

/** Server Visit row -> read-model record. `patientIdFor` maps the Patient public id to the id the UI keys on. */
export function mapVisit(row, patientIdFor = id => id) {
  const arrivedAt = row.arrived_at
  return {
    id: row.id,
    source: row.source,
    walkIn: row.source === 'walk_in',
    status: row.status,
    revision: row.revision,
    arrivedAt,
    checkedIn: typeof arrivedAt === 'string' ? arrivedAt.slice(11, 16) : null,
    clinicDate: row.clinic_date,
    closedAt: row.closed_at,
    patientId: patientIdFor(row.patient?.id),
    patientPublicId: row.patient?.id ?? null,
    patientCode: row.patient?.code ?? null,
    patientName: row.patient?.name ?? '',
    branchId: row.branch?.id ?? null,
    dentistId: row.dentist?.id ?? null,
    dentistName: row.dentist?.name ?? '',
    serviceId: row.service?.id ?? null,
    service: row.service?.name ?? '',
    appointmentId: row.appointment?.id ?? null,
    appointmentCode: row.appointment?.code ?? null,
    server: true,
  }
}

/** Server Visits visible to the signed-in Staff/Dentist/Owner within the same bounded window as appointments. */
export async function loadVisits(today) {
  const params = { ...appointmentWindow(today), per_page: PAGE_SIZE }
  const rows = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await api.listVisits({ ...params, page })
    if (!result.ok) return normalizeFailure(result)
    rows.push(...(result.data || []))
    if (!result.meta || result.meta.current_page >= result.meta.last_page) return { ok: true, rows, truncated: false }
  }
  return { ok: true, rows, truncated: true }
}

const commandResult = result => (result.ok ? { ok: true, row: result.data } : normalizeFailure(result))

/** Scheduled Check-In: the server moves the appointment to Checked In and opens the Visit in one transaction. */
export async function checkIn(appointment, key, beforeDispatch) {
  return commandResult(await api.checkInVisit({ appointment_id: appointment.id, expected_revision: appointment.revision }, key, beforeDispatch))
}

/** Walk-In admission: a Visit with no appointment. The Dentist may be omitted (the server allows an unresolved one). */
export async function walkIn({ patientPublicId, branchId, serviceId = null, dentistId = null }, key) {
  const payload = { patient_id: patientPublicId, branch_ref: branchId }
  if (serviceId) payload.service_ref = serviceId
  if (dentistId) payload.dentist_ref = dentistId
  return commandResult(await api.walkInVisit(payload, key))
}

/** Minimal front-desk Patient registration (Person + Patient, no login). Returns the directory shape. */
export async function registerPatient({ firstName, lastName, phone = '', email = '', dob = '' }, key) {
  const payload = { first_name: firstName, last_name: lastName }
  if (phone) payload.phone = phone
  if (email) payload.email = email
  if (dob) payload.date_of_birth = dob
  const result = await api.registerPatient(payload, key)
  if (!result.ok) return normalizeFailure(result)
  const p = result.data
  return { ok: true, patient: { id: p.id, patientCode: p.code, name: p.name, firstName: p.first_name, lastName: p.last_name, phone: p.phone || '', dob: p.date_of_birth || '' } }
}

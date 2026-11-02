import * as api from './api-client.js'
import { addDays } from './clock.js'

// M6 appointment client. Laravel/PostgreSQL is the ONLY appointment authority: this module reads server appointments,
// sends named commands and maps server rows into the read-model shape the still-browser-local modules (check-in,
// queue, treatment, billing, HMO, follow-ups, dashboards) already read. The projection is never persisted and never
// written back — every change goes through a server command followed by a refresh.

const ULID = /^[0-9a-hjkmnp-tv-z]{26}$/

/** A server appointment/Patient public id (ULID). Anything else is a pre-cutover browser-local id. */
export const isServerId = id => typeof id === 'string' && ULID.test(id)

/**
 * Records created before the cutover point at browser-local appointment ids ('a1', 'a-…'). They are LEGACY HISTORY:
 * read-only, excluded from live scheduling, live integrity decisions and live KPIs, and never used to mutate a server
 * appointment (decision D5).
 */
export const isLegacyAppointmentRef = id => id != null && id !== '' && !isServerId(id)

/** One Idempotency-Key per user confirm attempt; reuse it when retrying the same command. */
export function commandKey() {
  const random = globalThis.crypto?.randomUUID?.()
  return random || `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

// The list window loaded for every role: about three months back and three ahead (the server caps one request at 184
// days and paginates within it). Patient online booking only reaches one calendar month after tomorrow.
export const LIST_DAYS_BACK = 90
export const LIST_DAYS_AHEAD = 93
/** The bounded list window around `today`. It is a working window, never an all-time appointment history. */
export const appointmentWindow = today => ({ from: addDays(today, -LIST_DAYS_BACK), to: addDays(today, LIST_DAYS_AHEAD) })
const PAGE_SIZE = 100
const MAX_PAGES = 20

const SOURCE_LABELS = { patient_portal: 'Patient Portal', front_desk: 'Front Desk' }

/** Server appointment row -> read-model record. `patientIdFor` maps the Patient public id to the id the UI keys on. */
export function mapAppointment(row, patientIdFor = id => id) {
  return {
    id: row.id,
    code: row.code,
    // The server-owned human-readable reference; React never generates one.
    appointmentNo: row.code,
    patientId: patientIdFor(row.patient?.id),
    patientPublicId: row.patient?.id ?? null,
    patientCode: row.patient?.code ?? null,
    patientName: row.patient?.name ?? '',
    branchId: row.branch?.id ?? null,
    serviceId: row.service?.id ?? null,
    service: row.service?.name ?? '',
    dentistId: row.dentist?.id ?? null,
    dentistName: row.dentist?.name ?? '',
    date: row.date,
    start: row.start_time,
    end: row.end_time,
    duration: row.duration_minutes,
    scheduledStart: `${row.date}T${row.start_time}`,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    revision: row.revision,
    source: SOURCE_LABELS[row.source] || row.source,
    assignmentMethod: row.assignment_method,
    notes: row.notes || '',
    bookingFeePhp: row.booking_fee_php ?? null,
    bookingPaymentStatus: row.booking_payment_status ?? 'unpaid',
    bookingPaymentMethod: row.booking_payment_method ?? null,
    bookingPaidAt: row.booking_paid_at ?? null,
    bookingHoldExpiresAt: row.booking_hold_expires_at ?? null,
    history: row.history || null,
    server: true,
  }
}

const describeFailure = result => {
  if (result.kind === 'conflict' && result.code === 'schedule_conflict') return 'That time was just taken. Choose another time.'
  if (result.kind === 'conflict' && result.code === 'stale_revision') return 'This appointment changed since you opened it. It has been refreshed — review it and try again.'
  if (result.kind === 'validation' && result.code === 'schedule_invalid') {
    const reasons = result.errors?.schedule || []
    return reasons.length ? `This time can’t be booked. Checks not met: ${reasons.join('; ')}.` : result.message
  }
  if (result.kind === 'conflict' && result.code === 'visit_exists') return 'This appointment is already checked in. The list has been refreshed.'
  if (result.kind === 'validation' && result.code === 'walk_in_invalid') {
    const reasons = result.errors?.walk_in || []
    return reasons.length ? `This walk-in can’t be admitted. Checks not met: ${reasons.join('; ')}.` : result.message
  }
  if (result.kind === 'unauthenticated') return 'Your session has ended. Sign in again.'
  if (result.kind === 'forbidden') return 'This is outside your access.'
  if (result.kind === 'validation') return Object.values(result.errors || {})[0]?.[0] || result.message
  return result.message || 'Something went wrong. Try again.'
}

/** Uniform failure shape for every M6 call. A 401 is also reported to the shared session-invalidated path. */
export function normalizeFailure(result) {
  if (result.kind === 'unauthenticated') api.reportSessionInvalidated()
  return {
    ok: false,
    kind: result.kind || 'server',
    code: result.code || null,
    message: describeFailure(result),
    errors: result.errors || {},
    failedChecks: result.failedChecks || [],
    alternatives: result.alternatives || [],
    ...(result.retry_after ? { retry_after: result.retry_after } : {}),
  }
}

/** Loads every server appointment visible to the signed-in account within the bounded window around `today`. */
export async function loadAppointments(today) {
  const params = { ...appointmentWindow(today), per_page: PAGE_SIZE }
  const rows = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await api.listAppointments({ ...params, page })
    if (!result.ok) return normalizeFailure(result)
    rows.push(...(result.data || []))
    if (!result.meta || result.meta.current_page >= result.meta.last_page) return { ok: true, rows, truncated: false }
  }
  return { ok: true, rows, truncated: true }
}

export async function fetchAppointment(id) {
  const result = await api.getAppointment(id)
  return result.ok ? { ok: true, row: result.data } : normalizeFailure(result)
}

/** Server-valid start times for one branch/service/date (Patient: hourly, in the window; Staff: 30-minute). */
export async function fetchAvailability({ branchId, serviceId, date, patientPublicId = null, ignoreAppointmentId = null, dentistId = null }) {
  const result = await api.appointmentAvailability({ branch_ref: branchId, service_ref: serviceId, date, patient_id: patientPublicId, appointment_id: ignoreAppointmentId, dentist_ref: dentistId })
  if (!result.ok) return normalizeFailure(result)
  const data = result.data
  return {
    ok: true,
    date: data.date,
    duration: data.service?.duration_minutes ?? null,
    rules: { gridMinutes: data.rules?.start_grid_minutes ?? null, firstDate: data.rules?.window?.first_date ?? null, lastDate: data.rules?.window?.last_date ?? null },
    slots: (data.slots || []).map(slot => ({ date: slot.date, start: slot.start_time, end: slot.end_time, dentistId: slot.dentist?.id ?? null, dentist: slot.dentist?.name ?? '' })),
  }
}

/** Smart Scheduling suggestion. It reserves nothing; the create command validates everything again. */
export async function fetchRecommendation({ serviceId, branchId = null, coords = null }) {
  const result = await api.appointmentRecommendation({ service_ref: serviceId, branch_ref: branchId, latitude: coords?.lat ?? null, longitude: coords?.lng ?? null })
  if (!result.ok) return normalizeFailure(result)
  const data = result.data
  const found = data.recommendation
  return {
    ok: true,
    locationRanking: data.location_ranking,
    eligibleBranches: (data.eligible_branches || []).map(b => ({ id: b.id, name: b.name, hasCoordinates: !!b.has_coordinates })),
    rules: { gridMinutes: data.rules?.start_grid_minutes ?? null, firstDate: data.rules?.window?.first_date ?? null, lastDate: data.rules?.window?.last_date ?? null },
    recommendation: found ? {
      branchId: found.branch?.id, branch: found.branch?.name, date: found.date, start: found.start_time, end: found.end_time,
      duration: found.duration_minutes, dentistId: found.dentist?.id ?? null, dentist: found.dentist?.name ?? '', reserved: false,
    } : null,
  }
}

const commandResult = result => (result.ok ? { ok: true, row: result.data } : normalizeFailure(result))

export async function createAppointment({ branchId, serviceId, date, start, notes = null, patientPublicId = null, dentistId = null, forPatientId = null, consultationAcknowledged = null, payAtClinic = false, paymentChoice = null }, key) {
  const payload = { branch_ref: branchId, service_ref: serviceId, date, start_time: start }
  if (notes) payload.notes = notes
  if (patientPublicId) payload.patient_id = patientPublicId
  if (forPatientId) payload.for_patient_id = forPatientId // a guardian booking for a dependent
  if (dentistId) payload.dentist_ref = dentistId
  if (consultationAcknowledged !== null) payload.consultation_acknowledged = !!consultationAcknowledged
  if (payAtClinic) payload.pay_at_clinic = true
  if (paymentChoice === 'online') payload.pay_at_clinic = false
  return commandResult(await api.createAppointment(payload, key))
}

export async function rescheduleAppointment(appointment, { date, start, dentistId = null }, key) {
  const payload = { date, start_time: start, expected_revision: appointment.revision }
  if (dentistId) payload.dentist_ref = dentistId
  return commandResult(await api.rescheduleAppointment(appointment.id, payload, key))
}

export async function cancelAppointment(appointment, key, extra = {}) {
  return commandResult(await api.cancelAppointmentRemote(appointment.id, { expected_revision: appointment.revision, ...extra }, key))
}

/** The appointment-only lifecycle command: 'no-show' (the scheduled Patient did not arrive; no Visit exists). */
export async function transitionAppointment(appointment, name, key) {
  return commandResult(await api.transitionAppointment(appointment.id, name, { expected_revision: appointment.revision }, key))
}

/** Minimal M4 directory for Staff/Owner Patient selection (public ids only). */
export async function searchPatients(search = '') {
  const result = await api.searchPatients({ search: search.trim().length >= 2 ? search.trim() : null, per_page: 50 })
  if (!result.ok) return normalizeFailure(result)
  return { ok: true, patients: (result.data || []).map(p => ({ id: p.id, patientCode: p.code, name: p.name, firstName: p.first_name, lastName: p.last_name, phone: p.phone || '', dob: p.date_of_birth || '' })) }
}

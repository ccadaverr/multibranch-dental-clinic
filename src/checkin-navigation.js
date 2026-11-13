import { clinicDate } from './clock.js'
import { inScope } from './contracts.js'
import { publicPatientIdFor } from './appointment-projection.js'
import { canAccessPage } from './safeguards.js'

// Client selection/continuity only: this snapshot never authorizes or records an arrival.
// The existing check-in command and backend remain responsible for the transaction.
export const checkInActorKey = session => JSON.stringify([session?.serverUserId, session?.userId, session?.role, session?.branchId])

// Dispatch uses the latest canonical state/session, independent of an old React render.
export function reviewedCheckInAppointmentFor(store, selection) {
  const { state, session } = store
  if (!selection || !session?.serverUserId || session.role !== 'staff' ||
    !Number.isSafeInteger(store.getAuthGeneration?.()) || selection.authGeneration !== store.getAuthGeneration() || selection.actorKey !== checkInActorKey(session) ||
    !canAccessPage(state, session, 'checkin') || selection.source === 'appointments' && !canAccessPage(state, session, 'appointments')) return null
  const appointment = state.appointments.find(a => a.id === selection.appointmentId)
  if (!appointment?.server || appointment.date !== clinicDate() ||
    !['Confirmed', 'Pending'].includes(appointment.status) || !inScope(appointment, session, state) ||
    !Number.isSafeInteger(selection.revision) || selection.revision < 1 || appointment.revision !== selection.revision ||
    ['patientId', 'patientPublicId', 'branchId'].some(key => !selection[key] || appointment[key] !== selection[key]) ||
    ['date', 'start', 'end', 'duration', 'status', 'serviceId', 'dentistId'].some(key => (appointment[key] ?? null) !== selection[key]) ||
    publicPatientIdFor(appointment.patientId, { session, users: state.users, patients: state.patients }) !== selection.patientPublicId ||
    (state.visits || []).some(v => v.appointmentId === appointment.id)) return null
  return appointment
}

export function checkInAppointmentFor(store, selection) {
  if (store.appointmentsStatus !== 'ready' || store.appointmentsTruncated) return null
  return reviewedCheckInAppointmentFor(store, selection)
}

function captureCheckInSelection(store, appointment, source) {
  if (!appointment) return null
  const selection = { source, authGeneration: store.getAuthGeneration?.(), actorKey: checkInActorKey(store.session), appointmentId: appointment.id, patientId: appointment.patientId,
    patientPublicId: appointment.patientPublicId, branchId: appointment.branchId, revision: appointment.revision,
    date: appointment.date, start: appointment.start ?? null, end: appointment.end ?? null, duration: appointment.duration ?? null, status: appointment.status, serviceId: appointment.serviceId ?? null, dentistId: appointment.dentistId ?? null }
  return checkInAppointmentFor(store, selection) ? Object.freeze(selection) : null
}

// Check-In permission is sufficient on the ordinary admission page. The row
// shortcut additionally retains the originating Appointments permission.
export const checkInSelectionFor = (store, appointment) => captureCheckInSelection(store, appointment, 'checkin')
export const checkInNavigationFor = (store, appointment) => captureCheckInSelection(store, appointment, 'appointments')

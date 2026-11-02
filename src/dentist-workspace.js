import { inScope } from './contracts.js'
import { validSession } from './safeguards.js'
import { encounterContext } from './contracts.js'
import { addDays } from './clock.js'
import { monthRange, weekRange } from './day-calendar.js'

// Read projections only. Identity/branch checks remain the shared checks; no display-name joins.
export function dentistScopeKey(state, session) {
  if (session?.role !== 'dentist' || !validSession(state, session)) return ''
  const branches = state.dentists.find(d => d.id === session.dentistId)?.branchIds || []
  return JSON.stringify([session.serverUserId, session.userId, session.dentistId, session.branchId, [...branches].sort()])
}
export function ownDentistRows(rows, state, session) {
  if (!dentistScopeKey(state, session)) return []
  return (rows || []).filter(row => inScope(row, session, state))
}
export function dayAgenda(rows, date, { search = '', status = 'All' } = {}) {
  const term = search.trim().toLocaleLowerCase('en-PH')
  return rows.filter(a => a.date === date && (status === 'All' || a.status === status)
    && (!term || [a.patientName, a.serviceName, a.branchName].some(v => String(v || '').toLocaleLowerCase('en-PH').includes(term))))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.id).localeCompare(String(b.id)))
}
export function calendarKeyTarget(date, key) {
  const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
  if (key in offsets) return addDays(date, offsets[key])
  if (key === 'Home') return weekRange(date).from
  if (key === 'End') return weekRange(date).to
  return null
}
export function sameMonth(a, b) { return monthRange(a).from === monthRange(b).from }
export const clinicDateLabel = (date, options = { weekday: 'long', month: 'long', day: 'numeric' }) =>
  new Intl.DateTimeFormat('en-PH', { ...options, timeZone: 'Asia/Manila' }).format(new Date(`${date}T00:00:00+08:00`))

// Resume an exact server Treatment even when yesterday's queue is no longer in today's projection.
export function treatmentContext(t) {
  return { treatmentId: t.id, visitId: t.visitId, queueEntryId: t.queueEntryId || null,
    patientId: t.patientId, appointmentId: t.appointmentId || null, dentistId: t.dentistId, branchId: t.branchId }
}
export function homeClinicalWork(state, session, date) {
  const own = rows => ownDentistRows(rows, state, session)
  const queue = own(state.queue).filter(q => q.clinicDate === date && ['In Queue', 'Waiting', 'Called', 'Treatment Ready'].includes(q.status))
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || String(a.id).localeCompare(String(b.id)))
  const active = own(state.treatments).find(t => t.server && t.status === 'In Treatment') || null
  const ready = queue.find(q => ['Called', 'Treatment Ready'].includes(q.status)) || null
  return { queue, active, ready, context: active ? treatmentContext(active) : ready ? encounterContext(ready) : null }
}

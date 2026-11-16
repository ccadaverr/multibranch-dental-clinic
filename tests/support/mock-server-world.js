import * as data from '../../src/data.js'
import { normalizeClinicState, sessionForRole } from '../../src/contracts.js'
import { createWorkflowActions } from '../../src/workflow.js'
import * as api from '../../src/appointments-api.js'
import { mapVisit } from '../../src/visits-api.js'
import { mapQueueEntry } from '../../src/queue-api.js'
import { mapTreatment, documentationPayload } from '../../src/treatments-api.js'
import { createAppointmentFlow } from '../../src/appointment-flow.js'
import { clinicNow } from '../../src/clock.js'
import { serverId } from './server-appointments.js'

// The REAL appointment-flow.js (store.jsx's server-first flows) over a tiny in-memory "server" that mirrors the Laravel
// M6/M8/M9/M5 command rules (AppointmentService / VisitService / QueueService / TreatmentService; covered by the backend
// tests). Commands mutate the server maps; refresh() copies them into the read projection exactly like the store does.

/** A GET /api/appointments row. Patient serverId(500) is the seeded local Patient p1. */
export const row = (fields = {}) => ({
  id: fields.id || serverId(900), code: fields.code || 'APT-2026-000900', status: 'Confirmed', source: 'front_desk', assignment_method: 'auto', revision: 1,
  date: '2026-09-19', start_time: '11:00', end_time: '11:30', starts_at: '2026-09-19T11:00:00+08:00', ends_at: '2026-09-19T11:30:00+08:00', duration_minutes: 30,
  patient: { id: serverId(500), code: 'PAT-0500', name: 'Server Patient' }, branch: { id: 'b1', name: 'Branch A' }, service: { id: 'svc1', name: 'Dental Consultation' },
  dentist: { id: 'd1', name: 'Dr. Miguel Reyes' }, notes: null, ...fields,
})

const seedKeys = { persons: 'PERSONS', services: 'SERVICES', branchServices: 'BRANCH_SERVICES', dentistServiceAssignments: 'DENTIST_SERVICE_ASSIGNMENTS', branches: 'BRANCHES', dentists: 'DENTISTS', staff: 'STAFF', patients: 'PATIENTS', users: 'USERS' }
const keyFor = id => (id === serverId(500) ? 'p1' : id)

export function world() {
  const seeds = Object.fromEntries(Object.entries(seedKeys).map(([k, v]) => [k, structuredClone(data[`INITIAL_${v}`])]))
  let state = normalizeClinicState({ ...seeds, appointments: [], visits: [], queue: [], treatments: [], invoices: [], followups: [], prescriptions: [], notifications: [], hmo: [], conversations: [], inquiries: [], workflowLog: [], audit: [], bookingDrafts: [] })
  let session = sessionForRole('staff', state)
  const patches = []
  const actions = createWorkflowActions({ getState: () => state, getSession: () => session, commit: patch => { patches.push(patch); state = normalizeClinicState({ ...state, ...patch }) } })
  const server = new Map()
  const visits = new Map()
  const queueRows = new Map()
  const treatmentRows = new Map()
  const log = []
  let createResult = null
  let documentResult = null
  // Server positions: per Dentist queue, priority then exact arrival then queue number (QueueService::positions).
  const rank = { Urgent: 0, Priority: 1, Normal: 2 }
  const queueView = () => {
    const rows = [...queueRows.values()].map(q => ({ ...q, visit: { ...q.visit, status: visits.get(q.visit.id).status } }))
    const positional = rows.filter(q => ['Waiting', 'Called', 'Treatment Ready'].includes(q.status))
      .sort((a, b) => rank[a.priority] - rank[b.priority] || a.visit.arrived_at.localeCompare(b.visit.arrived_at) || a.queue_number - b.queue_number)
    return rows.map(q => ({ ...q, position: q.dentist ? (positional.filter(p => p.dentist.id === q.dentist.id).findIndex(p => p.id === q.id) + 1 || null) : null }))
  }
  // The Treatment rows as the signed-in account receives them (`author` is per viewer; Visit status is current).
  const treatmentView = () => [...treatmentRows.values()].map(t => {
    const v = visits.get(t.visit.id)
    return { ...t, author: session?.role === 'dentist' && session.dentistId === t.dentist.id, visit: { ...t.visit, status: v.status, revision: v.revision, queue: v.queue ? { id: v.queue.id, status: queueRows.get(v.queue.id).status, revision:queueRows.get(v.queue.id).revision } : null },
      appointment: t.appointment ? { ...t.appointment, status: server.get(t.appointment.id).status } : null }
  })
  const project = () => {
    const serverTreatments = session?.role === 'patient' ? [] : treatmentView().map(t => mapTreatment(t, keyFor))
    state = normalizeClinicState({ ...state, appointments: [...server.values()].map(r => api.mapAppointment(r, keyFor)), visits: [...visits.values()].map(v => mapVisit(v, keyFor)), queue: queueView().map(q => mapQueueEntry(q, keyFor)),
      treatments: [...serverTreatments, ...state.treatments.filter(t => !t.server)] })
  }
  const accept = (id, changes) => { const current = server.get(id); const next = { ...current, ...changes, revision: current.revision + 1 }; server.set(id, next); return { ok: true, row: next } }
  const visitFor = appointmentId => [...visits.values()].find(v => v.appointment?.id === appointmentId)
  const refuse = (kind, code, message) => ({ ok: false, kind, code, message })
  // M8 + M9 arrival: the Visit and — with a responsible Dentist — its queue entry, in one "transaction".
  const openVisit = fields => {
    const now = clinicNow()
    const v = { id: serverId(800000 + visits.size), status: 'Checked In', revision: 1, arrived_at: now.timestamp, clinic_date: now.date, closed_at: null, ...fields }
    visits.set(v.id, v)
    if (v.dentist) {
      const number = [...queueRows.values()].filter(q => q.dentist.id === v.dentist.id && q.clinic_date === v.clinic_date).length + 1
      const q = { id: serverId(850000 + queueRows.size), status: 'Waiting', priority: 'Normal', priority_reason: null, queue_number: number, revision: 1, clinic_date: v.clinic_date, closed_at: null,
        branch: v.branch, dentist: v.dentist, visit: { id: v.id, status: v.status, source: v.source, revision: 1, arrived_at: v.arrived_at }, patient: v.patient, service: v.service,
        appointment: v.appointment ? { id: v.appointment.id, code: v.appointment.code, status: 'Checked In', start_time: '11:00' } : null }
      queueRows.set(q.id, q)
      v.queue = { id: q.id, status: q.status, queue_number: number, revision: 1 }
    } else v.queue = null
    return { ok: true, row: v }
  }
  const queueEntryForVisit = visitId => [...queueRows.values()].find(q => q.visit.id === visitId)

  const mock = {
    commandKey: () => `k-${log.length}`,
    async createAppointment(form, key) {
      log.push(['create', key])
      if (createResult) return createResult
      const r = row({ id: serverId(700 + server.size), code: `APT-2026-00070${server.size}`, date: form.date, start_time: form.start, dentist: { id: form.dentistId || 'd1', name: 'Dr' } })
      server.set(r.id, r); return { ok: true, row: r }
    },
    async rescheduleAppointment(a, form) { log.push(['reschedule', a.revision]); if (server.get(a.id).revision !== a.revision) return refuse('conflict', 'stale_revision', 'changed'); return accept(a.id, { date: form.date, start_time: form.start }) },
    async cancelAppointment(a) {
      log.push(['cancel', a.revision])
      if (visitFor(a.id)) return refuse('validation', 'appointment_admitted', 'This patient has already checked in.')
      return accept(a.id, { status: 'Cancelled' })
    },
    async transitionAppointment(a, name) {
      log.push([name, a.revision])
      if (name !== 'no-show') return refuse('not_found', null, 'Not found.')
      if (visitFor(a.id) || !['Pending', 'Confirmed'].includes(server.get(a.id).status)) return refuse('validation', 'invalid_transition', 'This appointment cannot be marked No-show.')
      return accept(a.id, { status: 'No-show' })
    },
  }
  const visitsMock = {
    async checkIn(a, key) {
      log.push(['check-in', key])
      const current = server.get(a.id)
      if (visitFor(a.id)) return refuse('conflict', 'visit_exists', 'This appointment is already checked in.')
      if (current.revision !== a.revision) return refuse('conflict', 'stale_revision', 'changed')
      if (current.date !== clinicNow().date) return refuse('validation', 'not_today', 'Only today’s appointments can be checked in.')
      accept(a.id, { status: 'Checked In' })
      const r = server.get(a.id)
      return openVisit({ source: 'appointment', patient: r.patient, branch: r.branch, dentist: r.dentist, service: r.service, appointment: { id: r.id, code: r.code, status: r.status, revision: r.revision } })
    },
    async walkIn(form, key) {
      log.push(['walk-in', key])
      return openVisit({ source: 'walk_in', patient: { id: form.patientPublicId, code: '', name: '' }, branch: { id: form.branchId, name: '' },
        dentist: form.dentistId ? { id: form.dentistId, name: '' } : null, service: form.serviceId ? { id: form.serviceId, name: '' } : null, appointment: null })
    },
    async registerPatient(form) { log.push(['register']); return { ok: true, patient: { id: serverId(600), patientCode: 'PAT-0600', name: `${form.firstName} ${form.lastName}` } } },
  }
  // M5 TreatmentService mirror: atomic start, whole-documentation save, completion (no money anywhere).
  const treatmentForVisit = visitId => [...treatmentRows.values()].find(t => t.visit.id === visitId)
  const treatmentsMock = {
    async startTreatment(v, key) {
      log.push(['treatment.start', v.revision, key])
      const current = visits.get(v.id)
      if (treatmentForVisit(v.id)) return refuse('conflict', 'treatment_exists', 'Treatment has already started for this visit.')
      if (current.revision !== v.revision) return refuse('conflict', 'stale_revision', 'This visit changed.')
      if (current.status !== 'Checked In') return refuse('validation', 'invalid_transition', 'invalid')
      if (!current.dentist) return refuse('validation', 'dentist_unresolved', 'Assign a responsible Dentist to this visit before clinical work starts.')
      if (session?.dentistId !== current.dentist.id) return refuse('forbidden', 'forbidden', 'Only the responsible Dentist may start this treatment.')
      if ([...treatmentRows.values()].some(t => t.dentist.id === current.dentist.id && t.status === 'In Treatment')) return refuse('conflict', 'dentist_busy', 'Complete your current treatment before starting another.')
      const entry = queueEntryForVisit(v.id)
      if (!entry) return refuse('validation', 'not_in_queue', 'This visit is not in a queue.')
      if (!['Called', 'Treatment Ready'].includes(entry.status)) return refuse('validation', 'queue_not_ready', 'Call this patient before starting treatment.')
      const now = clinicNow()
      queueRows.set(entry.id, { ...entry, status: 'Served', closed_at: now.timestamp, revision: entry.revision + 1 })
      visits.set(v.id, { ...current, status: 'In Treatment', revision: current.revision + 1 })
      if (current.appointment) accept(current.appointment.id, { status: 'In Treatment' })
      const t = { id: serverId(870000 + treatmentRows.size), status: 'In Treatment', revision: 1, clinic_date: current.clinic_date, started_at: now.timestamp, completed_at: null,
        visit: { id: v.id, source: current.source }, patient: current.patient, branch: current.branch, dentist: current.dentist,
        appointment: current.appointment ? { id: current.appointment.id, code: current.appointment.code } : null, requested_service: current.service,
        chief_complaint: null, treatment_plan: null, procedure_summary: null, clinical_notes: null, assistant: null,
        prescription_required: false, followup_required: false, followup_recommended_date: null, followup_reason: null, followup_interval: null, procedures: [] }
      treatmentRows.set(t.id, t)
      return { ok: true, row: treatmentView().find(x => x.id === t.id) }
    },
    async documentTreatment(t, form, key) {
      log.push(['treatment.document', t.revision, key])
      if (documentResult) { const r = documentResult; documentResult = null; return r }
      const current = treatmentRows.get(t.id)
      if (current.revision !== t.revision) return refuse('conflict', 'stale_revision', 'This treatment changed since you opened it.')
      if (current.status !== 'In Treatment') return refuse('validation', 'treatment_completed', 'This treatment is completed and read-only.')
      const payload = documentationPayload(form, t)
      const services = state.services
      const lines = []
      for (const [i, p] of payload.procedures.entries()) {
        const service = services.find(x => x.id === p.service_ref && x.status === 'Active')
        if (!service || !Number.isInteger(p.quantity) || p.quantity < 1) return refuse('validation', 'procedure_invalid', 'Review the performed procedures.')
        lines.push({ id: p.id || serverId(880000 + i + 10 * current.revision + 1000 * treatmentRows.size), line_no: i + 1, service: { id: service.id, code: service.code || '', name: service.name }, quantity: p.quantity, notes: p.notes })
      }
      const { procedures: _p, ...fields } = payload
      treatmentRows.set(t.id, { ...current, ...fields, procedures: lines, revision: current.revision + 1 })
      return { ok: true, row: treatmentView().find(x => x.id === t.id) }
    },
    async completeTreatment(t, key) {
      log.push(['treatment.complete', t.revision, key])
      const current = treatmentRows.get(t.id)
      if (current.status === 'Completed') return { ok: true, row: treatmentView().find(x => x.id === t.id) }
      if (current.revision !== t.revision) return refuse('conflict', 'stale_revision', 'This treatment changed since you opened it.')
      if (!current.procedure_summary) return refuse('validation', 'procedure_summary_required', 'Document the performed procedure before completing treatment.')
      if (!current.procedures.length) return refuse('validation', 'procedures_required', 'Confirm at least one performed procedure before completing treatment.')
      const now = clinicNow()
      const v = visits.get(current.visit.id)
      visits.set(v.id, { ...v, status: 'Completed', revision: v.revision + 1, closed_at: now.timestamp })
      if (v.appointment) accept(v.appointment.id, { status: 'Completed' })
      treatmentRows.set(t.id, { ...current, status: 'Completed', completed_at: now.timestamp, revision: current.revision + 1 })
      return { ok: true, row: treatmentView().find(x => x.id === t.id) }
    },
  }
  const queueTransitions = { call: [['Waiting'], 'Called'], ready: [['Called'], 'Treatment Ready'], away: [['Waiting', 'Called', 'Treatment Ready'], 'Temporarily Away'], return: [['Temporarily Away'], 'Waiting'] }
  const queueMock = {
    async transitionQueue(entry, name) {
      log.push([`queue.${name}`, entry.revision])
      const current = queueRows.get(entry.id)
      const [from, to] = queueTransitions[name]
      if (current.status === to) return { ok: true, row: current }
      if (current.revision !== entry.revision) return refuse('conflict', 'stale_revision', 'This queue entry changed.')
      if (!from.includes(current.status)) return refuse('validation', 'invalid_transition', 'invalid')
      const next = { ...current, status: to, revision: current.revision + 1 }
      queueRows.set(entry.id, next)
      return { ok: true, row: next }
    },
    async setQueuePriority(entry, priority, reason) {
      log.push(['queue.priority', entry.revision])
      const current = queueRows.get(entry.id)
      if (current.revision !== entry.revision) return refuse('conflict', 'stale_revision', 'This queue entry changed.')
      const next = { ...current, priority, priority_reason: reason, revision: current.revision + 1 }
      queueRows.set(entry.id, next)
      return { ok: true, row: next }
    },
  }
  const flow = createAppointmentFlow({ getState: () => state, getSession: () => session, getActions: () => actions, refresh: async () => { log.push(['refresh']); project(); return { ok: true } }, api: mock, visits: visitsMock, queue: queueMock, treatments: treatmentsMock })
  /**
   * Drives the REAL M5 flow for a queue entry the way the TreatmentPage does: with no server Treatment yet, 'In Treatment'
   * starts it (and saves any documentation in `form`); otherwise it saves the documentation; 'Completed' saves changed
   * documentation and completes.
   */
  const treat = async (form, status = 'In Treatment') => {
    const entry = state.queue.find(q => q.id === form.queueEntryId)
    const existing = entry && flow.treatmentFor(entry.visitId)
    if (!existing) {
      if (status === 'Completed') return { ok: false, message: 'Start treatment before completing this encounter.' }
      return flow.startTreatment(entry, form)
    }
    return status === 'Completed' ? flow.completeTreatment(existing, form, { dirty: true }) : flow.saveTreatment(existing, form)
  }
  return {
    flow, actions, log, server, visits, queueRows, treatmentRows, patches, treat,
    get state() { return state },
    set state(next) { state = next },
    get session() { return session },
    role(r) { session = sessionForRole(r, state) },
    failCreateWith(result) { createResult = result },
    failNextDocumentWith(result) { documentResult = result },
    seed(r) { server.set(r.id, r); project(); return state.appointments.find(a => a.id === r.id) },
  }
}

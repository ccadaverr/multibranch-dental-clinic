import * as appointmentsApi from './appointments-api.js'
import * as visitsApi from './visits-api.js'
import * as queueApi from './queue-api.js'
import * as treatmentsApi from './treatments-api.js'
import { encounterIssue } from './safeguards.js'

// Server-first M6/M8/M9/M5 command flows. Every appointment, Visit, queue and Treatment change is a Laravel command
// followed by a refresh of the in-memory server projection; the browser-local adapter step for unfinished modules
// (follow-ups, billing, prescriptions, HMO, in-app notifications) runs only after the server succeeded and is never used
// to reverse it. Arrival (Check-In / Walk-In) is entirely server-side since M9, and treatment since M5.
//
// Dependencies are injected so the exact flow the store uses is unit-testable with a mocked API:
//   getState()/getSession()  latest store snapshot and session
//   getActions()             the committed workflow actions (adapters)
//   refresh()                reloads the server appointment/Visit/queue/Treatment projection (async)
//   api / visits / queue / treatments   appointments-api.js / visits-api.js / queue-api.js / treatments-api.js (or doubles)
const hasDocumentation = form => ['complaint', 'plan', 'procedure', 'notes'].some(k => typeof form[k] === 'string' && form[k].trim())
  || form.prescriptionRequired === true || form.followupRequired === true || (form.procedures || []).some(p => p?.serviceId)

export function createAppointmentFlow({ getState, getSession, getActions, refresh, searchPatients = null, addDirectoryPatient = null, api = appointmentsApi, visits = visitsApi, queue = queueApi, treatments = treatmentsApi }) {
  const projected = id => getState().appointments.find(a => a.id === id)
  const visitFor = id => (getState().visits || []).find(v => v.id === id)

  const afterServerCommand = async result => {
    // A stale or conflicting command means the server state moved on: refresh so the UI shows the truth.
    if (!result.ok && ['conflict', 'validation', 'not_found'].includes(result.kind)) await refresh()
    return result
  }

  return {
    refresh,
    searchPatients,

    async create(form, { key, followupId = null } = {}) {
      if (followupId) {
        // Transitional M20 bridge (removed when M20 is backend-authoritative): the Dentist records/recommends the
        // follow-up; clinic Staff (or the Owner) schedule it. Dentists and Patients get no booking path here, so no
        // server appointment is ever created for them through this bridge.
        if (!['staff', 'owner'].includes(getSession()?.role)) return { ok: false, message: 'Follow-up visits are scheduled by clinic Staff.' }
        const followup = getState().followups.find(f => f.id === followupId)
        if (!followup || followup.legacyAppointment) return { ok: false, message: 'This follow-up is historical and cannot be booked here.' }
      }
      const result = await api.createAppointment(form, key)
      if (!result.ok) return afterServerCommand(result)
      await refresh()
      const warnings = []
      if (followupId) {
        const link = getActions().linkFollowupAppointment(followupId, result.row.id)
        if (!link.ok) warnings.push(`The appointment is booked, but the follow-up task was not linked: ${link.message}`)
      } else getActions().recordAppointmentEvent(result.row.id, 'created')
      return { ok: true, record: projected(result.row.id), row: result.row, warning: warnings.join(' ') }
    },

    async reschedule(appointment, form, key) {
      const result = await api.rescheduleAppointment(appointment, form, key)
      if (!result.ok) return afterServerCommand(result)
      await refresh()
      getActions().recordAppointmentEvent(result.row.id, 'rescheduled')
      return { ok: true, record: projected(result.row.id) }
    },

    async cancel(appointment, key, extra = {}) {
      const result = await api.cancelAppointment(appointment, key, extra)
      if (!result.ok) return afterServerCommand(result)
      await refresh()
      const local = getActions().applyAppointmentCancellation(appointment.id)
      return local.ok ? { ok: true } : { ok: true, warning: `The appointment is cancelled, but its local follow-up/notification records need review: ${local.message}` }
    },

    // M8 scheduled Check-In: the server moves the appointment to Checked In, opens the Visit and — when the Visit has a
    // responsible Dentist — queues it, all in one transaction. Nothing is written locally.
    async checkIn(appointmentId, key) {
      const appointment = projected(appointmentId)
      if (!appointment) return { ok: false, message: 'This appointment is not loaded from the server. Refresh and try again.' }
      const result = await visits.checkIn(appointment, key)
      if (!result.ok) return afterServerCommand(result)
      await refresh()
      return { ok: true, visitId: result.row.id, queued: !!result.row.queue, queueNumber: result.row.queue?.queue_number ?? null }
    },

    // M8 Walk-In: a server Visit with no appointment, queued in the same server transaction when a Dentist is given.
    async walkIn(form, key) {
      const result = await visits.walkIn(form, key)
      if (!result.ok) return afterServerCommand(result)
      await refresh()
      return { ok: true, visitId: result.row.id, queued: !!result.row.queue, queueNumber: result.row.queue?.queue_number ?? null }
    },

    // M9 queue commands (server only): 'call' | 'ready' | 'away' | 'return', and the operational priority.
    async queueCommand(entry, name, key) {
      const result = await queue.transitionQueue(entry, name, key)
      if (!result.ok) return afterServerCommand(result)
      await refresh()
      return { ok: true, row: result.row }
    },

    async queuePriority(entry, priority, reason, key, meta = {}) {
      const result = await queue.setQueuePriority(entry, priority, reason, key, meta)
      if (!result.ok) return afterServerCommand(result)
      await refresh()
      return { ok: true, row: result.row }
    },

    // F2: restore a late arrival's normal place (Staff override of R2-07, reason required).
    async queueRestoreOrder(entry, reason, key) {
      const result = await queue.restoreQueueOrder(entry, reason, key)
      if (!result.ok) return afterServerCommand(result)
      await refresh()
      return { ok: true, row: result.row }
    },

    // M6 pre-arrival No-show: the scheduled Patient did not arrive, so there is no Visit and no queue entry.
    async noShow(appointment, key) {
      const result = await api.transitionAppointment(appointment, 'no-show', key)
      if (!result.ok) return afterServerCommand(result)
      await refresh()
      const local = getActions().applyAppointmentNoShow(appointment.id)
      return local.ok ? { ok: true } : { ok: true, warning: `The No-show is recorded, but its local follow-up records need review: ${local.message}` }
    },

    // ---- M5 Treatment (server-authoritative) ------------------------------------------------------------------------
    // Start, documentation and completion are the three M5 server commands; nothing is written locally. The Dentist's
    // unsaved form stays in React memory; on a stale revision the projection is refreshed and the form keeps its text so
    // the Dentist can reload the latest record and re-apply. After completion — and on every later load in any
    // authorized Staff/Dentist browser — the transitional downstream projections are reconciled from the server Treatment.
    treatmentFor(visitId) {
      return getState().treatments.find(t => t.server && t.visitId === visitId) || null
    },

    // Client-side fail-closed check before any M5 command: the loaded Visit, queue entry, appointment and Treatment must
    // agree (encounterIssue). It never replaces the server's checks; it only refuses to act on a contradictory projection.
    encounterProblem(treatment) {
      const entry = getState().queue.find(q => q.visitId === treatment.visitId)
      return entry ? encounterIssue(getState(), entry) : null
    },

    // Atomic start (Queue Served + Visit/appointment In Treatment + Treatment created). When the Dentist already filled in
    // the form, it is then saved as the first documentation revision (a separate command with its own key).
    async startTreatment(entry, form = null, key = api.commandKey(), documentKey = api.commandKey(), visitIntent = null) {
      const issue = entry ? encounterIssue(getState(), entry) : 'Open your exact encounter from today’s queue.'
      if (issue) return { ok: false, message: issue }
      const visit = visitIntent?.id === entry.visitId ? visitIntent : visitFor(entry.visitId)
      if (!visit) return { ok: false, message: 'This visit is not loaded from the clinic server. Refresh the worklist and try again.' }
      const result = await treatments.startTreatment(visit, key)
      if (!result.ok) return afterServerCommand(result)
      await refresh()
      const started = this.treatmentFor(visit.id)
      if (!started) return { ok: false, uncertain: true, message: 'The start command was accepted, but the treatment could not be refreshed. Check the encounter before retrying.' }
      if (!form || !hasDocumentation(form)) return { ok: true, record: started }
      const saved = await this.saveTreatment(started, form, documentKey)
      return saved.ok ? saved : { ...saved, ok: false, partial: true, record: started, message: `Treatment started, but the documentation was not saved: ${saved.message}` }
    },

    async saveTreatment(treatment, form, key = api.commandKey()) {
      if (!treatment?.server || !treatment.author) return { ok: false, message: 'Only the treating Dentist can document this treatment.' }
      const issue = this.encounterProblem(treatment)
      if (issue) return { ok: false, message: issue }
      const result = await treatments.documentTreatment(treatment, form, key)
      if (!result.ok) return afterServerCommand(result)
      await refresh()
      const record = this.treatmentFor(treatment.visitId)
      return record && record.revision >= result.row.revision ? { ok: true, record } : { ok: false, uncertain: true, message: 'The save was accepted, but the current record could not be refreshed. Your editor is retained; check the encounter before retrying.' }
    },

    // Saves unsaved documentation first (if any), then completes. Completion Completes the Visit and a scheduled
    // appointment in the same server transaction; the queue entry stays Served.
    async completeTreatment(treatment, form = null, { dirty = false, saveKey = api.commandKey(), completeKey = api.commandKey() } = {}) {
      if (!treatment?.server || !treatment.author) return { ok: false, message: 'Only the treating Dentist can complete this treatment.' }
      const issue = this.encounterProblem(treatment)
      if (issue) return { ok: false, message: issue }
      let current = treatment
      let savedNow = false
      if (dirty && form) {
        const saved = await this.saveTreatment(current, form, saveKey)
        if (!saved.ok) return saved
        current = saved.record
        savedNow = true
      }
      const result = await treatments.completeTreatment(current, completeKey)
      if (!result.ok) {
        await afterServerCommand(result)
        // Two separate commands: the documentation save stays recorded; only completion was refused.
        return savedNow
          ? { ...result, saved: true, record: this.treatmentFor(current.visitId) || current, message: `Your documentation was saved, but the treatment was not completed: ${result.message}` }
          : result
      }
      await refresh()
      const confirmed = this.treatmentFor(current.visitId)
      if (!confirmed || confirmed.status !== 'Completed') return { ok: false, uncertain: true, message: 'Completion was accepted, but the closed record could not be refreshed. Check its status before continuing.' }
      const handoffs = getActions().reconcileTreatmentHandoffs()
      return { ok: true, record: this.treatmentFor(current.visitId), warnings: handoffs.ok ? handoffs.warnings || [] : [handoffs.message] }
    },

    // Minimal front-desk registration (Person + Patient, no login) for a new walk-in Patient.
    async registerPatient(form, key) {
      const result = await visits.registerPatient(form, key)
      if (!result.ok) return result
      addDirectoryPatient?.(result.patient)
      return result
    },
  }
}

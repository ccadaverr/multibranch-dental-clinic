import { inScope, isTodayQueue } from './contracts.js'
import { validSession, encounterIssue } from './safeguards.js'

const links = ['patientId', 'branchId', 'dentistId', 'appointmentId']
const same = (a, b, fields = links) => fields.every(k => (a?.[k] ?? null) === (b?.[k] ?? null))
export const clinicalSessionKey = session => [session?.serverUserId, session?.userId, session?.dentistId, session?.branchId].join('|')
export const encounterKey = context => JSON.stringify(['queueEntryId', 'visitId', 'treatmentId', ...links].map(k => context?.[k] ?? null))
export function encounterContextFor(record) {
  return { queueEntryId: record.queueEntryId || (record.visitId && !record.author ? record.id : null), visitId: record.visitId,
    treatmentId: record.server && 'author' in record ? record.id : record.treatmentId || null,
    patientId: record.patientId, branchId: record.branchId, dentistId: record.dentistId, appointmentId: record.appointmentId || null }
}
export function resolveEncounter(state, session, context) {
  const refused = message => ({ ok: false, message })
  if (session?.role !== 'dentist' || !session.serverUserId || !validSession(state, session)) return refused('Your clinical session is unavailable. Return to My Queue after signing in.')
  if (!context?.queueEntryId && !context?.treatmentId) return refused('Select an exact encounter from My Queue.')
  const q = state.queue.find(r => r.id === context.queueEntryId) || null
  const t = (context.treatmentId ? state.treatments.find(r => r.id === context.treatmentId) : state.treatments.find(r => r.server && r.visitId === q?.visitId)) || null
  if (context.treatmentId && !t) return refused('This treatment is no longer available. Refresh My Queue.')
  if (!t && (!q?.server || !isTodayQueue(q))) return refused('This queue entry is no longer available for treatment. Refresh My Queue.')
  const record = t || q
  if (!record.server || !inScope(record, session, state) || t?.summaryOnly || t && !t.author) return refused('This encounter is outside your authorized treatment workspace.')
  if (context.visitId && context.visitId !== record.visitId || links.some(k => context[k] != null && context[k] !== record[k]) || q && (!same(q, record) || q.visitId !== record.visitId) || t && context.queueEntryId && t.queueEntryId !== context.queueEntryId) return refused('The selected records identify different encounters. Return to My Queue; no patient was substituted.')
  const visit = (state.visits || []).find(v => v.id === record.visitId)
  if (!visit?.server || !same(visit, record) || t && visit.status !== t.status) return refused('The visit no longer matches this treatment. Refresh My Queue and review its current state.')
  const issue = q && encounterIssue(state, q)
  if (issue) return refused(issue)
  const patient = state.patients.find(p => p.id === record.patientId && p.serverProjection)
  if (!patient) return refused('The authorized patient identity is unavailable. Refresh My Queue.')
  return { ok: true, queue: q, treatment: t, visit, patient, record,
    canStart: !t && ['Called', 'Treatment Ready'].includes(q?.status) && visit.status === 'Checked In',
    editable: !!t && t.status === 'In Treatment' && t.author === true }
}
// A single component-owned command gate; retries reuse the exact intent and keys after an uncertain response.
export function commandGate(makeKey) {
  let running = false, retry = null
  return {
    get pending() { return running },
    get retry() { return retry },
    clear() { if (!running) retry = null },
    async run(intent, send) {
      if (running) return { ok: false, duplicate: true }
      running = true
      const attempt = retry || { ...intent, keys: { start: makeKey(), save: makeKey(), complete: makeKey() } }
      try {
        const result = await send(attempt)
        retry = ['network','server'].includes(result?.kind) || result?.uncertain ? attempt : null
        return result
      } catch { retry = attempt; return { ok: false, uncertain: true, message: 'The command result could not be confirmed. Your text is retained. Refresh to check the record or retry the same command.' } }
      finally { running = false }
    },
  }
}

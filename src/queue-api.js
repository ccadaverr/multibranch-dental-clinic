import * as api from './api-client.js'
import { normalizeFailure } from './appointments-api.js'
import { isTruncatedQueueResponse } from './queue-counts.js'

// M9 queue client. Laravel/PostgreSQL is the ONLY queue authority: entries are created by the server with the M8
// arrival, numbered and ordered by the server, and changed only by named commands (Idempotency-Key + expected_revision).
// The mapped entries feed the in-memory `state.queue` projection, which is never persisted or written locally.
// Failures use the shared normalized shape, so 401s reach the session-invalidated path.

/** Presentation phase: the real queue status, or — once Served — the Visit's status ("In Treatment" / "Completed"). */
export const displayQueueStatus = entry => (entry?.status === 'Served' ? entry.visitStatus || 'Served' : entry?.status || '')

// Operational branch order is server-computed across Dentists. Never alphabetize Dentists ahead of arrival order.
export const compareBranchQueue = (a, b) => String(a.branch || a.branchId || '').localeCompare(String(b.branch || b.branchId || ''))
  || (a.branchPosition ?? Number.MAX_SAFE_INTEGER) - (b.branchPosition ?? Number.MAX_SAFE_INTEGER)
  || (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER)
  || String(a.arrivedAt || '').localeCompare(String(b.arrivedAt || ''))
  || String(a.id || '').localeCompare(String(b.id || ''))

/** Server queue row -> read-model entry. `patientIdFor` maps the Patient public id to the id the UI keys on. */
export function mapQueueEntry(row, patientIdFor = id => id) {
  const arrivedAt = row.visit?.arrived_at ?? null
  const entry = {
    id: row.id,
    queueEntryId: row.id,
    server: true,
    status: row.status,
    priority: row.priority,
    priorityReason: row.priority_reason || '',
    lateArrival: !!row.late_arrival,
    queueNumber: row.queue_number,
    position: row.position ?? null,
    branchPosition: row.branch_position ?? null,
    revision: row.revision,
    clinicDate: row.clinic_date,
    closedAt: row.closed_at,
    visitId: row.visit?.id ?? null,
    visitStatus: row.visit?.status ?? null,
    walkIn: row.visit?.source === 'walk_in',
    arrivedAt,
    checkedIn: typeof arrivedAt === 'string' ? arrivedAt.slice(11, 16) : null,
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
  }
  return { ...entry, displayStatus: displayQueueStatus(entry) }
}

/** Today's queue for the signed-in Staff / Dentist / Owner (server-scoped; the server computes positions). */
export async function loadQueue(today) {
  const result = await api.listQueue({ date: today })
  if (!result.ok) return normalizeFailure(result)
  const rows = result.data || []
  // The server reports whether the bounded list was cut off (meta.truncated). An older server without that metadata is
  // judged by the row cap: a response at the cap may be cut off and is flagged, never treated as complete.
  const truncated = typeof result.meta?.truncated === 'boolean' ? result.meta.truncated : isTruncatedQueueResponse(rows)
  return { ok: true, rows, truncated }
}

/** The signed-in Patient's own current queue state (or null). No other Patient's data and no wait estimate. */
export async function loadMyQueue() {
  const result = await api.myQueue()
  if (!result.ok) return normalizeFailure(result)
  return { ok: true, data: result.data ?? null }
}

// A stale queue command gets queue wording (the shared mapper words stale revisions for appointments).
const queueFailure = result => {
  const failure = normalizeFailure(result)
  if (failure.code === 'stale_revision') failure.message = 'This queue entry changed since you opened it. The queue has been refreshed — review it and try again.'
  return failure
}
const commandResult = result => (result.ok ? { ok: true, row: result.data } : queueFailure(result))

export async function loadQueueOrder(entry) {
  const result = await api.queueOrder(entry.id)
  return result.ok ? {ok:true, snapshot:result.data} : queueFailure(result)
}

export async function reorderQueue(entry, payload, key, beforeDispatch) {
  const result = await api.queueCommand(entry.id, 'reorder', payload, key, beforeDispatch)
  return result.ok ? {ok:true, row:result.data, receipt:result.meta?.queue_order} : queueFailure(result)
}

/** Named transitions: 'call' | 'ready' | 'away' | 'return'. */
export async function transitionQueue(entry, name, key, beforeDispatch) {
  return commandResult(await api.queueCommand(entry.id, name, { expected_revision: entry.revision }, key, beforeDispatch))
}

/** Compatibility command: clear a late-arrival flag with a reason; arrival order stays unchanged. */
export async function restoreQueueOrder(entry, reason, key) {
  return commandResult(await api.queueCommand(entry.id, 'late-order', { expected_revision: entry.revision, reason }, key))
}

/** Operational priority (Normal / Priority / Urgent) with a required reason and optional category/verification_status — not clinical triage. */
export async function setQueuePriority(entry, priority, reason, key, meta = {}) {
  const payload = { expected_revision: entry.revision, priority, reason }
  if (meta.category) payload.category = meta.category
  if (meta.verificationStatus) payload.verification_status = meta.verificationStatus
  return commandResult(await api.queueCommand(entry.id, 'priority', payload, key))
}

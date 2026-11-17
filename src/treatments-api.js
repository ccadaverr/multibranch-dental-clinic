import * as api from './api-client.js'
import { appointmentWindow, normalizeFailure } from './appointments-api.js'

// M5 Treatment client. Laravel/PostgreSQL is the ONLY authority for the clinical Treatment record (anchored to one server
// Visit). This module reads server Treatments and sends the three named M5 commands (start, document, complete); the
// mapped records feed the in-memory `state.treatments` projection, which is never persisted and never written locally.
// There are no browser Treatment drafts: unsaved form text lives only in React memory. Money never appears here — the
// transitional M11 invoice adapter prices performed lines from local fee configuration (phase2.js).

const PAGE_SIZE = 100
const MAX_PAGES = 20

const line = (row, treatmentId) => ({
  id: row.id,
  treatmentId,
  lineNo: row.line_no ?? null,
  serviceId: row.service?.id ?? null,
  serviceCode: row.service?.code ?? '',
  serviceName: row.service?.name ?? '',
  quantity: row.quantity,
  notes: row.notes ?? '',
})

/**
 * Server Treatment row -> read-model record for Staff / Dentist / Owner. `patientIdFor` maps the Patient public id to the
 * id the UI keys on. Owner rows are the operational summary: the server omits every clinical text field, so they stay
 * empty here (`summaryOnly`).
 */
export function mapTreatment(row, patientIdFor = id => id) {
  const summaryOnly = !('clinical_notes' in row)
  const procedures = (row.procedures || []).map(p => line(p, row.id))
  return {
    id: row.id,
    server: true,
    summaryOnly,
    author: row.author === true,
    status: row.status,
    revision: row.revision,
    date: row.clinic_date,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    visitId: row.visit?.id ?? null,
    visitStatus: row.visit?.status ?? null,
    queueEntryId: row.visit?.queue?.id ?? null,
    patientId: patientIdFor(row.patient?.id),
    patientPublicId: row.patient?.id ?? null,
    patientCode: row.patient?.code ?? null,
    patientName: row.patient?.name ?? '',
    branchId: row.branch?.id ?? null,
    dentistId: row.dentist?.id ?? null,
    dentistName: row.dentist?.name ?? '',
    appointmentId: row.appointment?.id ?? null,
    requestedServiceId: row.requested_service?.id ?? null,
    serviceId: procedures[0]?.serviceId ?? null,
    procedures,
    complaint: row.chief_complaint ?? '',
    plan: row.treatment_plan ?? '',
    procedure: row.procedure_summary ?? '',
    notes: row.clinical_notes ?? '',
    assistant: row.assistant?.name ?? '',
    assistantStaffId: row.assistant?.id ?? null,
    prescriptionRequired: row.prescription_required === true,
    followupRequired: row.followup_required === true,
    followupDate: row.followup_recommended_date ?? '',
    followupReason: row.followup_reason ?? '',
    followupInterval: row.followup_interval ?? '',
    history: row.history || null,
  }
}

/**
 * The signed-in Patient's own COMPLETED Treatment: exactly the approved safe subset from GET /api/treatments/mine — date,
 * procedure summary, performed service display names and the Dentist's display name, keyed by the Treatment's public id.
 * It carries no branch, appointment, service or Visit identifier: Patient Billing / Visit / HMO views link to it only
 * through their own records' exact `treatmentId` (their own module projections), never through M5 fields.
 */
export function mapPatientTreatment(row, patientId) {
  return {
    id: row.id,
    server: true,
    patientSubset: true,
    status: 'Completed',
    date: row.date,
    patientId,
    dentistName: row.dentist?.name ?? '',
    procedure: row.procedure_summary ?? '',
    procedures: (row.services || []).map((s, index) => ({ id: `${row.id}-${index + 1}`, treatmentId: row.id, serviceName: s.name ?? '' })),
  }
}

/** Server Treatments visible to the signed-in Staff / Dentist / Owner within the same bounded window as appointments. */
export async function loadTreatments(today) {
  const params = { ...appointmentWindow(today), per_page: PAGE_SIZE }
  const rows = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await api.listTreatments({ ...params, page })
    if (!result.ok) return normalizeFailure(result)
    rows.push(...(result.data || []))
    if (!result.meta || result.meta.current_page >= result.meta.last_page) return { ok: true, rows, truncated: false }
  }
  return { ok: true, rows, truncated: true }
}

/**
 * The signed-in Patient's own completed Treatments (safe subset), newest first, read page by page through the server's cursor.
 * A history longer than the bounded number of pages is reported as `truncated` so the app never presents a partial history as
 * complete; a failed page is an explicit failure (never a silently shorter list).
 */
export async function loadMyTreatments(startCursor = null) {
  const rows = []
  let cursor = startCursor
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await api.myTreatments({ per_page: PAGE_SIZE, ...(cursor ? { cursor } : {}) })
    if (!result.ok) return normalizeFailure(result)
    rows.push(...(result.data || []))
    cursor = result.meta?.next_cursor ?? null
    if (!cursor) return { ok: true, rows, truncated: false, nextCursor: null }
  }
  // The automatic fetch is bounded, but the server cursor is kept: the Patient continues from it with an explicit action.
  return { ok: true, rows, truncated: true, nextCursor: cursor }
}

// Treatment-specific wording for refusals the shared mapper words for appointments.
const treatmentFailure = result => {
  const failure = normalizeFailure(result)
  if (failure.code === 'stale_revision') failure.message = 'This treatment changed since you opened it (another tab or session saved it). It has been refreshed — reload the latest record, re-apply your unsaved changes and save again.'
  if (failure.code === 'treatment_exists') failure.message = 'Treatment has already started for this visit. It has been refreshed — continue from the saved record.'
  return failure
}
const commandResult = result => (result.ok ? { ok: true, row: result.data } : treatmentFailure(result))

/** Atomic M5 start: Queue -> Served, Visit/appointment -> In Treatment and the Treatment created, in one server transaction. */
export async function startTreatment(visit, key, entry = null, beforeDispatch) {
  const result = await api.startTreatment(visit.id, { expected_revision: visit.revision,
    ...(entry?{queue_id:entry.id,expected_queue_revision:entry.revision}:{}) }, key, beforeDispatch)
  return result.ok ? { ok: true, row: result.data } : treatmentFailure(result)
}

export async function encounterForVisit(visitId, options) {
  const result = await api.encounterForVisit(visitId, options)
  return result.ok ? {ok:true,row:result.data} : treatmentFailure(result)
}

const text = value => (typeof value === 'string' && value.trim() ? value.trim() : null)

/**
 * The complete documentation payload from the Treatment form. A procedure line keeps its server id only while it is the
 * same saved line for the same service; otherwise the server records it as a new line. No fee or amount is ever sent.
 */
export function documentationPayload(form, saved = null) {
  const savedLines = new Map((saved?.procedures || []).map(p => [p.id, p]))
  const followup = form.followupRequired === true
  return {
    chief_complaint: text(form.complaint),
    treatment_plan: text(form.plan),
    procedure_summary: text(form.procedure),
    clinical_notes: text(form.notes),
    prescription_required: form.prescriptionRequired === true,
    followup_required: followup,
    followup_recommended_date: followup ? text(form.followupDate) : null,
    followup_reason: followup ? text(form.followupReason) : null,
    followup_interval: followup ? text(form.followupInterval) : null,
    procedures: (form.procedures || []).filter(Boolean).map(p => {
      const kept = p.id && savedLines.get(p.id)?.serviceId === p.serviceId ? p.id : null
      const row = { service_ref: p.serviceId, quantity: Number(p.quantity), notes: text(p.notes) }
      return kept ? { id: kept, ...row } : row
    }),
  }
}

export async function documentTreatment(treatment, form, key, beforeDispatch) {
  return commandResult(await api.treatmentCommand(treatment.id, 'document', { expected_revision: treatment.revision, ...documentationPayload(form, treatment) }, key, beforeDispatch))
}

export async function completeTreatment(treatment, key) {
  return commandResult(await api.treatmentCommand(treatment.id, 'complete', { expected_revision: treatment.revision }, key))
}

import * as api from './api-client.js'
import { appointmentWindow, normalizeFailure } from './appointments-api.js'

// Minimal M12 HMO client. Laravel/PostgreSQL is the ONLY authority for Patient HMO memberships, Visit-anchored HMO
// cases, their lifecycle (incl. the pre-submission Withdrawn / self-pay disposition) and the approved amount. The mapped
// cases feed the in-memory `state.hmo` projection (never persisted, never written locally). Browser HMO records are
// read-only history. Amounts stay decimal strings; nothing here does arithmetic or decides whether money may be taken.

// Server requirement states map onto the existing presentation vocabulary ("checked locally" = Staff-validated at the
// clinic, never provider approval).
const REQUIREMENT_STATE = { Missing: 'Missing', Validated: 'Validated locally' }

const requirementsOf = (row, caseId) => (row.requirements || []).map(r => ({
  id: `${caseId}:${r.rule}`, ruleId: r.rule, label: r.label, state: REQUIREMENT_STATE[r.state] || r.state,
  documentLabel: r.document_label ?? null, validatedAt: r.validated_at ?? null,
}))

/** Server case (Staff / Owner / Dentist projection) -> read model. `patientIdFor` maps the Patient public id to the UI key. */
export function mapHmoCase(row, patientIdFor = id => id) {
  const events = row.events || []
  const responses = events.filter(e => e.kind === 'response').map((e, i) => ({
    id: `${row.id}:response:${i + 1}`, caseId: row.id, submissionCycle: e.submission_cycle, outcome: e.outcome, method: e.method, note: e.note,
    providerReference: e.provider_reference, approvedAmount: e.approved_amount, recordedAt: e.occurred_at, recordedBy: e.actor?.name || '', externalResponseRecorded: true,
  }))
  const contacts = events.filter(e => e.kind === 'contact').map((e, i) => ({
    id: `${row.id}:contact:${i + 1}`, caseId: row.id, submissionCycle: e.submission_cycle, at: e.occurred_at, method: e.method, note: e.note, nextAction: e.next_action, staff: e.actor?.name || '',
  }))
  return {
    id: row.id,
    server: true,
    summaryOnly: !('events' in row),
    status: row.status,
    revision: row.revision,
    submissionCycle: row.submission_cycle,
    providerName: row.provider_name,
    memberId: row.member_number ?? null,
    visitId: row.visit?.id ?? null,
    visitStatus: row.visit?.status ?? null,
    clinicDate: row.visit?.clinic_date ?? null,
    patientId: patientIdFor(row.patient?.id),
    patientPublicId: row.patient?.id ?? null,
    patientName: row.patient?.name ?? '',
    patientCode: row.patient?.code ?? '',
    branchId: row.branch?.id ?? null,
    branchName: row.branch?.name ?? '',
    dentistId: row.dentist?.id ?? null,
    appointmentId: row.appointment?.id ?? null,
    appointmentCode: row.appointment?.code ?? null,
    submittedAt: row.submitted_at,
    followUpDueAt: row.follow_up_due_at,
    escalatedAt: row.escalated_at,
    finalAt: row.final_at,
    providerRespondedAt: responses.at(-1)?.recordedAt ?? null,
    approvedAmount: row.approved_amount ?? null,
    createdAt: row.created_at ?? null,
    requirements: requirementsOf(row, row.id),
    responses,
    contacts,
    events,
  }
}

/** The signed-in Patient's own case (safe subset: no notes, contacts, recorders or history). */
export function mapPatientHmoCase(row, patientId) {
  return {
    id: row.id, server: true, patientSubset: true, status: row.status, patientId,
    providerName: row.provider_name, memberId: row.member_number, clinicDate: row.visit_date,
    appointmentId: row.appointment?.id ?? null, appointmentCode: row.appointment?.code ?? null, branchName: row.branch?.name ?? '',
    requirements: requirementsOf(row, row.id), submittedAt: row.submitted_at, finalAt: row.final_at, approvedAmount: row.approved_amount ?? null,
    responses: [], contacts: [], events: [],
  }
}

export async function loadHmoCases(today) {
  const result = await api.listHmoCases(appointmentWindow(today))
  if (!result.ok) return normalizeFailure(result)
  return { ok: true, rows: result.data || [] }
}

export async function loadMyHmoCases() {
  const result = await api.myHmoCases()
  if (!result.ok) return normalizeFailure(result)
  return { ok: true, rows: result.data || [] }
}

/** Visits in scope whose Patient has an active membership but no case: Staff must open a case or record self-pay. */
export async function loadClaimDecisions(today) {
  const result = await api.listClaimDecisions(appointmentWindow(today))
  if (!result.ok) return normalizeFailure(result)
  return { ok: true, rows: result.data || [] }
}

export async function loadMembership(patientPublicId) {
  const result = await api.getHmoMembership(patientPublicId)
  return result.ok ? { ok: true, membership: result.data } : normalizeFailure(result)
}

const hmoFailure = result => {
  const failure = normalizeFailure(result)
  if (failure.code === 'stale_revision') failure.message = 'This HMO case changed since you opened it. It has been refreshed — review it and try again.'
  if (failure.code === 'stale_membership') failure.message = 'This Patient’s HMO membership changed since you opened it. It has been reloaded — review it and try again.'
  if (failure.code === 'hmo_case_exists') failure.message = 'This visit already has an HMO case or a self-pay decision. The list has been refreshed.'
  return failure
}
const commandResult = result => (result.ok ? { ok: true, row: result.data } : hmoFailure(result))

/** Changes the Patient's (global) membership through one of their Visits in the Staff member's branch scope. */
export async function setMembership(visitId, { providerName, memberNumber, expectedActiveId }, key, beforeDispatch) {
  const result = await api.setHmoMembership(visitId, { provider_name: providerName, member_number: memberNumber, expected_active_id: expectedActiveId ?? null }, key, beforeDispatch)
  return result.ok ? { ok: true, membership: result.data } : hmoFailure(result)
}

export async function endMembership(visitId, expectedActiveId, key, beforeDispatch) {
  const result = await api.endHmoMembership(visitId, { expected_active_id: expectedActiveId }, key, beforeDispatch)
  return result.ok ? { ok: true, membership: result.data } : hmoFailure(result)
}

export async function openCase(visitId, key, beforeDispatch) { return commandResult(await api.openHmoCase(visitId, key, beforeDispatch)) }
export async function recordSelfPay(visitId, reason, key, beforeDispatch) { return commandResult(await api.hmoSelfPay(visitId, { reason }, key, beforeDispatch)) }
export async function validateRequirement(hmoCase, ruleId, documentLabel, key, beforeDispatch) {
  const payload = { expected_revision: hmoCase.revision }
  if (documentLabel) payload.document_label = documentLabel
  return commandResult(await api.hmoCaseCommand(hmoCase.id, `requirements/${encodeURIComponent(ruleId)}`, payload, key, beforeDispatch))
}
export async function submitCase(hmoCase, { method, note }, key, beforeDispatch) { return commandResult(await api.hmoCaseCommand(hmoCase.id, 'submit', { expected_revision: hmoCase.revision, method, note }, key, beforeDispatch)) }
export async function recordContact(hmoCase, { method, note, nextAction }, key, beforeDispatch) { return commandResult(await api.hmoCaseCommand(hmoCase.id, 'contact', { expected_revision: hmoCase.revision, method, note, next_action: nextAction }, key, beforeDispatch)) }
export async function escalateCase(hmoCase, key, beforeDispatch) { return commandResult(await api.hmoCaseCommand(hmoCase.id, 'escalate', { expected_revision: hmoCase.revision }, key, beforeDispatch)) }
export async function withdrawCase(hmoCase, reason, key, beforeDispatch) { return commandResult(await api.hmoCaseCommand(hmoCase.id, 'withdraw', { expected_revision: hmoCase.revision, reason }, key, beforeDispatch)) }

/** Staff-confirmed external provider response for the current submission cycle. */
export async function recordResponse(hmoCase, { outcome, method, note, providerReference = '', approvedAmount = '', returnedRequirements = [] }, key, beforeDispatch) {
  const payload = { expected_revision: hmoCase.revision, submission_cycle: hmoCase.submissionCycle, outcome, method, note }
  if (providerReference.trim()) payload.provider_reference = providerReference.trim()
  if (outcome === 'Approved') payload.approved_amount = String(approvedAmount).trim()
  if (outcome === 'Returned') payload.returned_requirements = returnedRequirements
  return commandResult(await api.hmoCaseCommand(hmoCase.id, 'response', payload, key, beforeDispatch))
}

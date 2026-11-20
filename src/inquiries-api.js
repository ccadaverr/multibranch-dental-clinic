import * as api from './api-client.js'
import { normalizeFailure } from './appointments-api.js'

// M16 client. Laravel/PostgreSQL is the ONLY authority for external inquiries in a clinic-server session. An inquiry is captured
// MANUALLY by Staff: `source` is the channel Staff reported, never evidence of a platform connection, and nothing here sends,
// delivers or synchronizes a message. The browser never stores an inquiry and never decides who may see one.

export const SOURCES = ['Facebook', 'Instagram', 'Website']
export const LIMITS = { name: 120, contact: 200, topic: 500 }
const PAGE_SIZE = 25

/** Server inquiry -> display record. Text fields stay plain strings: React renders them as text, never as HTML. */
export function mapInquiry(row) {
  return {
    id: row.id,
    server: true,
    source: row.source,
    capture: row.capture || 'Recorded manually by Staff',
    name: row.contact?.name ?? '',
    contact: row.contact?.detail ?? '',
    topic: row.topic ?? '',
    status: row.status,
    revision: row.revision,
    branchId: row.branch?.id ?? null,
    branchName: row.branch?.name ?? '',
    assignedName: row.assigned?.name ?? '',
    patientName: row.patient?.name ?? '',
    patientCode: row.patient?.code ?? '',
    appointmentId: row.appointment?.id ?? null,
    appointmentCode: row.appointment?.code ?? null,
    receivedAt: row.received_at,
    respondedAt: row.responded_at,
    closedAt: row.closed_at,
    convertedAt: row.converted_at,
  }
}

/** One page, newest first. `cursor` continues from the previous page's next_cursor; a failed page is an error, never a shorter list. */
export async function loadInquiries(cursor = null) {
  const result = await api.listInquiries({ per_page: PAGE_SIZE, ...(cursor ? { cursor } : {}) })
  if (!result.ok) return normalizeFailure(result)
  return { ok: true, rows: (result.data || []).map(mapInquiry), nextCursor: result.meta?.next_cursor ?? null }
}

/** Authoritative scoped counts for the signed-in Staff member. A failure is returned as a failure — never as zero. */
export async function loadInquirySummary(signal) {
  const result = await api.inquirySummary(signal)
  if (!result.ok) return normalizeFailure(result)
  const d = result.data || {}
  const n = v => (Number.isInteger(v) && v >= 0 ? v : null)
  if (n(d.open) === null) return { ok: false, kind: 'server', message: 'The inquiry count is unavailable.' }
  return { ok: true, open: d.open, responded: n(d.responded), closed: n(d.closed), converted: n(d.converted), total: n(d.total) }
}

const one = result => (result.ok ? { ok: true, row: mapInquiry(result.data) } : normalizeFailure(result))

export async function captureInquiry(form, key) {
  const payload = { ...(form.branchId ? { branch_ref: form.branchId } : {}), source: form.source, name: String(form.name ?? '').trim(), topic: String(form.topic ?? '').trim() }
  const contact = String(form.contact ?? '').trim()
  if (contact) payload.contact = contact
  return one(await api.createInquiry(payload, key))
}

export const respondToInquiry = async (inquiry, key) => one(await api.inquiryCommand(inquiry.id, 'respond', { expected_revision: inquiry.revision }, key))
export const closeInquiry = async (inquiry, key) => one(await api.inquiryCommand(inquiry.id, 'close', { expected_revision: inquiry.revision }, key))
export const linkInquiryToAppointment = async (inquiry, appointmentId, key) => one(await api.inquiryCommand(inquiry.id, 'convert', { expected_revision: inquiry.revision, appointment_id: appointmentId }, key))

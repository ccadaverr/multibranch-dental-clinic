import * as api from './api-client.js'
import { normalizeFailure } from './appointments-api.js'
import { clinicDate } from './clock.js'
import { requestClinicCsv, saveClinicCsv } from './clinic-csv.js'

export function mapAuditLog(row) {
  return {
    id: row.id,
    action: row.action,
    category: row.category,
    severity: row.severity,
    actor: row.actor?.name ? row.actor : { id: null, name: 'Anonymous', role: 'anonymous' },
    branch: row.branch || null,
    auditableType: row.auditable_type,
    auditableId: row.auditable_id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    payload: row.payload || {},
    createdAt: row.created_at,
  }
}

// Server-backed, cursor-paginated (newest first). A failure throws; the caller shows an error with Retry, never an empty list.
export async function fetchAuditLogs(params = {}) {
  const res = await api.listAuditLogs(params)
  if (!res.ok) throw normalizeFailure(res)
  return { rows: (res.data || []).map(mapAuditLog), nextCursor: res.meta?.next_cursor ?? null }
}

export async function fetchAuditLog(id) {
  const res = await api.getAuditLog(id)
  if (!res.ok) throw normalizeFailure(res)
  return mapAuditLog(res.data)
}

export async function requestAuditLogsCsv(params = {}, { signal } = {}) {
  const filters = { ...params }
  for (const key of ['category', 'severity']) {
    if (filters[key] === 'all') delete filters[key]
  }
  const isExact = value => typeof value === 'string' && value !== '' && value === value.trim()
  const { target_type: type, target_id: id, branch_id: branchId } = filters
  if ((type != null || id != null) && (!isExact(type) || !isExact(id))) {
    throw new Error('Provide both the audit record type and ID.')
  }
  if (branchId != null && branchId !== '' && !isExact(branchId)) {
    throw new Error('Choose a valid audit branch before exporting.')
  }
  return requestClinicCsv('/api/audit-logs/export', filters, {
    signal,
    fallbackFilename: `audit_trail_${clinicDate()}.csv`,
    failureMessage: 'Failed to export audit logs.',
  })
}

/** Compatibility adapter for callers using the audit context callback. */
export async function downloadAuditLogsCsv(params = {}, isCurrent = () => true, options) {
  const requireCurrent = () => {
    if (!isCurrent()) throw new Error('Audit export context changed. Review the current filters before exporting.')
  }
  requireCurrent()
  let result
  try {
    result = await requestAuditLogsCsv(params, options)
  } catch (error) {
    requireCurrent()
    throw error
  }
  requireCurrent()
  saveClinicCsv(result)
  return { truncated: result.truncated, limit: result.limit }
}

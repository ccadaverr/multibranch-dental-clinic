import * as api from './api-client.js'
import { normalizeFailure } from './appointments-api.js'
import { clinicDate } from './clock.js'

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

/** Downloads the CSV and reports whether the server cut it at its bound (the export is never silently partial). */
export async function downloadAuditLogsCsv(params = {}, beforeDispatch = () => true) {
  const query = Object.entries(params)
    .filter(([key, value]) => value !== null && value !== undefined && value !== ''
      && !(value === 'all' && ['category', 'severity'].includes(key)))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const url = `${api.apiBase()}/api/audit-logs/export${query ? `?${query}` : ''}`

  if (!beforeDispatch()) throw new Error('Audit export context changed. Review the current filters before exporting.')
  let res
  try { res = await fetch(url, { credentials: 'include' }) } catch { throw new Error('Could not reach the clinic system. Check your connection and try again.') }
  if (!res.ok) {
    throw new Error(res.status === 403 ? 'Audit trail export is restricted to the clinic Owner.'
      : res.status === 422 ? 'The export filters are not valid. Adjust them and try again.' : 'Failed to export audit logs.')
  }
  if (!beforeDispatch()) throw new Error('Audit export context changed. Review the current filters before exporting.')
  const truncated = res.headers?.get?.('X-Audit-Export-Truncated') === 'true'
  const limit = Number(res.headers?.get?.('X-Audit-Export-Limit')) || null
  const contentType = res.headers?.get?.('Content-Type') || ''
  if (!/^text\/csv(?:\s*;|$)/i.test(contentType)) {
    throw new Error('The clinic server did not return a CSV file.')
  }
  const blob = await res.blob()
  if (!beforeDispatch()) throw new Error('Audit export context changed. Review the current filters before exporting.')
  const blobUrl = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = `audit_trail_${clinicDate()}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(blobUrl)
  return { truncated, limit }
}

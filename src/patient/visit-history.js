import { splitAppointments } from './format.js'

// PatientTreatmentResource deliberately exposes no appointment/visit link. Keep its
// summaries separate: matching a date (or guessing a link) would lose encounters.
export function treatmentSummaries(rows) {
  return (Array.isArray(rows) ? rows : []).map(t => ({
    id: `treatment-${t.id}`, date: t.date, status: 'Completed',
    service: { name: t.procedure_summary || t.services?.map(s => s.name).filter(Boolean).join(', ') || 'Treatment summary' },
    dentist: t.dentist, isTreatmentSummary: true,
  }))
}

export function visitFilter(tab) {
  return ({ archived: 'history', past: 'history' })[tab] || tab || 'upcoming'
}

// Follow pagination without sending an invalid multi-month date range. Fail the
// whole read if a later page fails, rather than presenting incomplete history.
export async function loadPatientAppointments(fetchPage) {
  const rows = []
  let page = 1
  while (true) {
    const result = await fetchPage({ per_page: 100, page })
    if (!result.ok) return result
    const last = result.meta?.last_page ?? 1
    if (!Array.isArray(result.data) || !Number.isSafeInteger(last) || last < page ||
        (result.meta?.current_page != null && result.meta.current_page !== page)) {
      return { ok: false, message: 'The appointment list could not be verified. Try again.' }
    }
    rows.push(...result.data)
    if (page === last) return { ...result, data: rows }
    page++
  }
}

export async function loadTreatmentHistory(fetchPage) {
  const rows = []
  let cursor = null
  const seen = new Set()
  do {
    const result = await fetchPage({ per_page: 100, ...(cursor ? { cursor } : {}) })
    if (!result.ok) return result
    if (!Array.isArray(result.data)) return { ok: false, message: 'Treatment history could not be verified.' }
    rows.push(...result.data)
    cursor = result.meta?.next_cursor || null
    if (cursor !== null && (typeof cursor !== 'string' || seen.has(cursor))) {
      return { ok: false, message: 'Treatment history repeated a page. Try again.' }
    }
    if (cursor) seen.add(cursor)
  } while (cursor)
  return { ok: true, data: rows }
}

// The existing API supports a lifecycle status filter and ascending pagination.
// Critical upcoming information never waits for completed/cancelled history.
// Home stops each active-status search at its first relevant page; Visits reads
// every active page. Neither imposes an invented future booking horizon.
export async function loadActiveAppointments(fetchPage, { firstOnly = false, now = new Date() } = {}) {
  const results = await Promise.all(['Pending', 'Confirmed', 'Checked In', 'In Treatment'].map(async status => {
    const rows = []
    let page = 1
    while (true) {
      const r = await fetchPage({ status, per_page: 100, page })
      if (!r.ok) return r
      const active = splitAppointments(r.data, now).upcoming
      rows.push(...active)
      if ((firstOnly && active.length) || page >= (r.meta?.last_page || 1)) return { ok: true, data: rows }
      page++
    }
  }))
  return results.find(r => !r.ok) || { ok: true, data: results.flatMap(r => r.data) }
}

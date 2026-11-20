import * as api from './api-client.js'
import { normalizeFailure } from './appointments-api.js'
import { addDays, clinicDate } from './clock.js'
import { createLatestGate } from './queue-counts.js'

// M6 read-only Staff Day Calendar. One selected clinic date, fetched on its own from GET /api/appointments?date=…, never
// through (or into) the shared appointment window in src/store.jsx. The server decides which branches the Staff member
// may see; nothing here grants access, changes an appointment or infers completion from the clock.

/** Authoritative appointment statuses (backend: appointments_status_check; Appointment::ACTIVE/TERMINAL_STATUSES). */
export const APPOINTMENT_STATUSES = {
  Pending: 'Booked, waiting for confirmation.',
  Confirmed: 'Booked and confirmed.',
  'Checked In': 'The Patient has arrived; a Visit exists.',
  'In Treatment': 'Treatment has started.',
  Completed: 'Treatment was completed (set by the clinic server when the Dentist completes the Treatment).',
  Cancelled: 'Cancelled before the visit.',
  'No-show': 'Marked as not arrived by Staff.',
}
/** Server booking-source codes such as `patient_portal` read as plain words; the code itself is unchanged elsewhere. */
export const sourceLabel = source => { const t = String(source || '').replace(/_/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : '—' }
export const isCompletedStatus = status => status === 'Completed'
export const statusMeaning = status => APPOINTMENT_STATUSES[status] || 'Status not recognised by this screen; shown exactly as the clinic server sent it.'

// ---- dates ------------------------------------------------------------------------------------------------------------
export const isValidClinicDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}
/** Previous/next calendar day. No artificial limit: any valid date the server accepts can be requested. */
export const shiftClinicDate = (date, days) => (isValidClinicDate(date) ? addDays(date, days) : date)
export const defaultCalendarDate = () => clinicDate()

// ---- periods: Day, Week (Monday–Sunday) and Month (the selected calendar month) -----------------------------------------
// Everything is plain Asia/Manila calendar dates (YYYY-MM-DD strings, UTC arithmetic on the date part only), never instants.
export const VIEWS = ['day', 'week', 'month']
const parts = date => { const [y, m, d] = date.split('-').map(Number); return { y, m, d } }
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10)
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate() // m is 1-based; day 0 of next month = last day (leap years included)
/** 0 = Monday … 6 = Sunday */
export const weekdayIndex = date => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export const weekRange = date => { const from = addDays(date, -weekdayIndex(date)); return { from, to: addDays(from, 6) } }
export const monthRange = date => { const { y, m } = parts(date); return { from: iso(y, m, 1), to: iso(y, m, daysInMonth(y, m)) } }
/** The inclusive date range a view fetches for an anchor date. */
export const periodRange = (view, date) => (view === 'week' ? weekRange(date) : view === 'month' ? monthRange(date) : { from: date, to: date })
export const rangeDays = ({ from, to }) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1
/** The server refuses a list range of 184 days or more (AppointmentController::MAX_RANGE_DAYS). Week and month are far below it. */
export const SERVER_MAX_RANGE_DAYS = 184
export const rangeWithinServerLimit = range => rangeDays(range) < SERVER_MAX_RANGE_DAYS

/** Previous/next period. Months keep the anchor's day when it exists, else the month's last day (Jan 31 -> Feb 28/29). */
export function shiftPeriod(view, date, direction) {
  if (!isValidClinicDate(date)) return date
  if (view === 'day') return addDays(date, direction)
  if (view === 'week') return addDays(date, 7 * direction)
  const { y, m, d } = parts(date)
  const first = new Date(Date.UTC(y, m - 1 + direction, 1))
  const ny = first.getUTCFullYear(), nm = first.getUTCMonth() + 1
  return iso(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}
export const periodContains = (view, date, day) => { const { from, to } = periodRange(view, date); return day >= from && day <= to }
export const shiftMonth = (date, direction) => shiftPeriod('month', date, direction)
export const monthContains = (date, day) => periodContains('month', date, day)

/** Explicit, configurable appointment-count-based busyness classification thresholds. */
export const COUNT_BUSYNESS_THRESHOLDS = Object.freeze({
  low: 3,       // 1-3 appointments: Low activity
  moderate: 6,  // 4-6 appointments: Moderate activity
  busy: 9,      // 7-9 appointments: Busy
  // 10+: Very busy
})

/**
 * Evaluates busyness for a date from either server capacity metrics (loadBand) or count-based thresholds.
 * Color is accompanied by an accessible text label in every state.
 */
export function busynessStatus({ dayLoad, count = 0, crowded = 80 } = {}) {
  if (dayLoad?.closed) {
    return { band: 'closed', label: 'Closed', shortLabel: 'Closed', detail: dayLoad.reason || 'Closed' }
  }
  if (dayLoad && typeof dayLoad.percent === 'number') {
    const band = dayLoad.percent >= crowded ? 'crowded' : dayLoad.percent >= 50 ? 'busy' : dayLoad.percent > 0 ? 'light' : 'free'
    const shortLabel = band === 'crowded' ? 'Very busy' : band === 'busy' ? 'Busy' : band === 'light' ? 'Low activity' : 'Free'
    return {
      band,
      label: `${dayLoad.percent}% booked${band === 'crowded' ? ' · crowded' : ''}`,
      shortLabel,
      detail: `${dayLoad.appointments ?? count} appointment${(dayLoad.appointments ?? count) === 1 ? '' : 's'}, ${dayLoad.booked_minutes || 0} of ${dayLoad.capacity_minutes || 0} dentist minutes`,
    }
  }
  if (count === 0) return { band: 'free', label: 'No appointments', shortLabel: 'No activity', detail: '0 appointments' }
  if (count <= COUNT_BUSYNESS_THRESHOLDS.low) return { band: 'light', label: 'Low activity', shortLabel: 'Low activity', detail: `${count} appointment${count === 1 ? '' : 's'}` }
  if (count <= COUNT_BUSYNESS_THRESHOLDS.moderate) return { band: 'busy', label: 'Moderate activity', shortLabel: 'Moderate activity', detail: `${count} appointments` }
  if (count <= COUNT_BUSYNESS_THRESHOLDS.busy) return { band: 'busy', label: 'Busy', shortLabel: 'Busy', detail: `${count} appointments` }
  return { band: 'crowded', label: 'Very busy', shortLabel: 'Very busy', detail: `${count} appointments` }
}

/** The seven dates of a week view. */
export const weekDays = date => { const { from } = weekRange(date); return Array.from({ length: 7 }, (_, i) => addDays(from, i)) }
/**
 * Month grid cells, Monday-first, padded with adjacent-month dates. Only `inMonth` cells are fetched, so padding cells carry
 * `fetched: false` and must never be shown as empty or counted.
 */
export function monthCells(date) {
  const { from, to } = monthRange(date)
  const start = addDays(from, -weekdayIndex(from)), end = addDays(to, 6 - weekdayIndex(to))
  const cells = []
  for (let d = start; d <= end; d = addDays(d, 1)) cells.push({ date: d, inMonth: d >= from && d <= to, fetched: d >= from && d <= to })
  return cells
}

/** Rows by date, branch-filtered and time-sorted. */
export function groupByDate(rows, { branchId = null } = {}) {
  const byDate = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (branchId && row.branchId !== branchId) continue
    if (!byDate.has(row.date)) byDate.set(row.date, [])
    byDate.get(row.date).push(row)
  }
  for (const list of byDate.values()) list.sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.code).localeCompare(String(b.code)))
  return byDate
}
/** Per-day totals exist only for a complete response; an incomplete one yields null so nothing complete-looking can be drawn. */
export function dayTotals(rows, complete, { branchId = null } = {}) {
  if (!complete) return null
  const totals = new Map()
  for (const [date, list] of groupByDate(rows, { branchId })) totals.set(date, list.length)
  return totals
}

// ---- server list -> read model ------------------------------------------------------------------------------------------
// GET /api/appointments is paginated (per_page 1–100, meta.last_page) with NO silent row cap. A day is complete only when
// every page was read; beyond MAX_PAGES the result is flagged incomplete and the page says so instead of showing "empty".
export const DAY_PAGE_SIZE = 100
export const DAY_MAX_PAGES = 10

/** Only fields the existing contract returns for list rows and that the calendar needs. Notes and history are never kept. */
export function mapDayAppointment(row) {
  return {
    id: row.id,
    code: row.code ?? '',
    status: row.status ?? '',
    source: row.source ?? '',
    date: row.date,
    start: row.start_time ?? '',
    end: row.end_time ?? '',
    duration: row.duration_minutes ?? null,
    patientName: row.patient?.name ?? '',
    patientCode: row.patient?.code ?? '',
    branchId: row.branch?.id ?? null,
    branchName: row.branch?.name ?? '',
    serviceName: row.service?.name ?? '',
    intendedServiceName: row.intended_service?.name ?? '',
    dentistId: row.dentist?.id ?? null,
    dentistName: row.dentist?.name ?? '',
  }
}

export async function loadDayAppointments(date) {
  if (!isValidClinicDate(date)) return { ok: false, kind: 'validation', message: 'Choose a valid date.' }
  const rows = []
  for (let page = 1; page <= DAY_MAX_PAGES; page++) {
    const result = await api.listAppointments({ date, per_page: DAY_PAGE_SIZE, page })
    if (!result.ok) return normalizeFailure(result)
    rows.push(...(result.data || []).map(mapDayAppointment))
    if (!result.meta || result.meta.current_page >= result.meta.last_page) return { ok: true, rows, complete: true }
  }
  return { ok: true, rows, complete: false }
}

/** Week/month reads use the same list endpoint with from/to. A month can hold many pages, so the documented limit is higher. */
export const RANGE_MAX_PAGES = 30

export async function loadRangeAppointments({ from, to }) {
  if (!isValidClinicDate(from) || !isValidClinicDate(to) || to < from) return { ok: false, kind: 'validation', message: 'Choose a valid period.' }
  if (!rangeWithinServerLimit({ from, to })) return { ok: false, kind: 'validation', message: 'That period is longer than the clinic server allows.' }
  const rows = []
  for (let page = 1; page <= RANGE_MAX_PAGES; page++) {
    const result = await api.listAppointments({ from, to, per_page: DAY_PAGE_SIZE, page })
    if (!result.ok) return normalizeFailure(result)
    rows.push(...(result.data || []).map(mapDayAppointment))
    if (!result.meta || result.meta.current_page >= result.meta.last_page) return { ok: true, rows, complete: true }
  }
  return { ok: true, rows, complete: false }
}

/** A period target is `view|anchorDate` (a bare date means the day view). */
export const periodTarget = (view, date) => `${view}|${date}`
export function loadPeriod(target) {
  const [view, date] = String(target).includes('|') ? String(target).split('|') : ['day', target]
  return view === 'day' ? loadDayAppointments(date) : loadRangeAppointments(periodRange(view, date))
}

// ---- grouping ----------------------------------------------------------------------------------------------------------
export const UNASSIGNED = 'unassigned'

/** Filter by branch (null = every branch the server returned), group by Dentist (Unassigned last), sort by start time. */
export function groupByDentist(rows, { branchId = null } = {}) {
  const groups = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (branchId && row.branchId !== branchId) continue
    const key = row.dentistId || UNASSIGNED
    if (!groups.has(key)) groups.set(key, { key, name: row.dentistId ? row.dentistName || 'Dentist' : 'Unassigned', rows: [] })
    groups.get(key).rows.push(row)
  }
  const byTime = (a, b) => String(a.start).localeCompare(String(b.start)) || String(a.code).localeCompare(String(b.code))
  return [...groups.values()]
    .map(g => ({ ...g, rows: [...g.rows].sort(byTime) }))
    .sort((a, b) => (a.key === UNASSIGNED) - (b.key === UNASSIGNED) || a.name.localeCompare(b.name))
}

// ---- loader with request-race protection ---------------------------------------------------------------------------------
export const IDLE = Object.freeze({ status: 'idle', date: null, key: null, rows: [], complete: false, error: '', stale: false })

/**
 * Framework-free controller. `load(target)` (a date or a period target) and `refresh()` are latest-wins: a slower older response (rapid date changes, a
 * retry, a background refresh) can never replace a newer one, and `invalidate()` (sign-out, session change, unmount) discards
 * everything in flight. A failed BACKGROUND refresh keeps the last complete list but marks it stale; a failed foreground load
 * shows an error and no rows.
 */
export function createDayLoader({ fetchDay = loadPeriod, onChange = () => {}, now = () => clinicDate() } = {}) {
  const gate = createLatestGate()
  let state = IDLE
  const set = patch => { state = { ...state, ...patch }; onChange(state) }
  async function run(date, key, { background = false } = {}) {
    const token = gate.begin()
    if (!background) set({ status: 'loading', date, key, rows: [], complete: false, error: '', stale: false })
    const result = await fetchDay(date)
    if (!gate.isCurrent(token)) return { superseded: true }
    if (result.ok) set({ status: 'ready', date, key, rows: result.rows, complete: result.complete, error: '', stale: false, loadedDay: now() })
    else if (background && state.status === 'ready' && state.date === date) set({ stale: true, error: result.message || 'The latest refresh failed.' })
    else set({ status: 'error', date, key, rows: [], complete: false, error: result.message || 'Appointments could not be loaded.', stale: false })
    return { ok: result.ok }
  }
  return {
    get state() { return state },
    load: (date, key = null) => run(date, key),
    retry: () => (state.date ? run(state.date, state.key) : Promise.resolve({ ok: false })),
    // Skipped while a foreground load is in flight, so a poll can never cancel the load the user is waiting for.
    refresh: () => (state.status === 'ready' ? run(state.date, state.key, { background: true }) : Promise.resolve({ skipped: true })),
    invalidate: () => gate.invalidate(),
  }
}

import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'
import React from 'react'
import { renderToString } from 'react-dom/server'
import * as data from '../src/data.js'
import { setClockSource } from '../src/clock.js'
import { canAccessPage } from '../src/safeguards.js'
import { normalizeClinicState, sessionForRole } from '../src/contracts.js'
import { __resetCsrfCacheForTests } from '../src/api-client.js'
import {
  APPOINTMENT_STATUSES, DAY_MAX_PAGES, DAY_PAGE_SIZE, createDayLoader, defaultCalendarDate, groupByDentist, isCompletedStatus,
  isValidClinicDate, loadDayAppointments, sourceLabel,
  RANGE_MAX_PAGES, SERVER_MAX_RANGE_DAYS, dayTotals, groupByDate, loadPeriod, loadRangeAppointments, monthCells, monthRange, periodContains, periodRange,
  periodTarget, rangeDays, rangeWithinServerLimit, shiftPeriod, weekDays, weekRange, weekdayIndex, mapDayAppointment, shiftClinicDate, statusMeaning, daysInMonth, busynessStatus, COUNT_BUSYNESS_THRESHOLDS, shiftMonth, monthContains,
} from '../src/day-calendar.js'

// M6 read-only Staff Day Calendar. Fixture/unit checks only: the Laravel endpoint itself is covered by backend/tests/Feature/Appointments.
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
setClockSource(() => new Date('2026-09-19T02:08:00Z'))

const row = (n, fields = {}) => ({
  id: `01K0000000000000000A${String(n).padStart(6, '0')}`, code: `APT-2026-${String(n).padStart(6, '0')}`, status: 'Confirmed', source: 'online', revision: 1,
  date: '2026-09-19', start_time: '09:00', end_time: '09:30', duration_minutes: 30,
  patient: { id: `01K0000000000000000P${n}`, code: `PAT-${n}`, name: `Patient ${n}` }, branch: { id: 'b1', name: 'Dr. Dana Roxas Dental Clinic' },
  service: { id: 'svc1', name: 'Consultation' }, dentist: { id: 'd1', name: 'Dr. One' },
  notes: 'private booking note', history: [{ event: 'appointment.created' }], ...fields,
})

// ---- source checks ------------------------------------------------------------------------------------------------------
test('status labels equal the backend lifecycle; completion comes only from the Completed status', () => {
  const migration = read('backend/database/migrations/2026_09_28_000200_create_appointments_table.php')
  const allowed = migration.match(/appointments_status_check CHECK \(status IN \(([^)]*)\)\)/)[1].split(',').map(s => s.trim().replace(/'/g, ''))
  assert.deepEqual(Object.keys(APPOINTMENT_STATUSES), allowed)
  const model = read('backend/app/Models/Appointment.php')
  assert.match(model, /SCHEDULED_STATUSES = \['Pending', 'Confirmed'\]/)
  assert.match(model, /IN_PROGRESS_STATUSES = \['Checked In', 'In Treatment'\]/)
  assert.match(model, /ACTIVE_STATUSES = \[\.\.\.self::SCHEDULED_STATUSES, \.\.\.self::IN_PROGRESS_STATUSES\]/)
  assert.match(model, /TERMINAL_STATUSES = \['Completed', 'Cancelled', 'No-show'\]/)
  // Completed is written by the server when the Dentist completes the Treatment (TreatmentService), never derived from time.
  assert.match(read('backend/app/Services/Treatments/TreatmentService.php'), /'Completed'/)
  assert.equal(isCompletedStatus('Completed'), true)
  for (const s of ['Pending', 'Confirmed', 'Checked In', 'In Treatment', 'Cancelled', 'No-show', '', undefined]) assert.equal(isCompletedStatus(s), false, String(s))
  assert.match(statusMeaning('Mystery'), /not recognised/i)
  const page = read('src/pages/StaffDayCalendar.jsx')
  assert.doesNotMatch(page, /new Date\(\)|Date\.now|clinicNow\(\)\.time|isPast|isBefore/) // no completion/overdue inferred from the clock
})

test('the appointments list endpoint is paginated by the server, not capped like the queue list', () => {
  const controller = read('backend/app/Http/Controllers/AppointmentController.php')
  assert.match(controller, /paginate\(\$validated\['per_page'\] \?\? 50\)/)
  assert.ok(controller.includes("'per_page' => ['nullable', 'integer', 'min:1', 'max:100']"))
  assert.doesNotMatch(controller.slice(controller.indexOf('public function index'), controller.indexOf('public function show')), /limit\(500\)/)
  assert.equal(DAY_PAGE_SIZE, 100)
})

// ---- dates ---------------------------------------------------------------------------------------------------------------
test('date handling: Manila default, month/year/leap shifts, strict validation, no artificial window limit', () => {
  assert.equal(defaultCalendarDate(), '2026-09-19')
  setClockSource(() => new Date('2026-09-19T16:30:00Z')) // already tomorrow in Manila
  assert.equal(defaultCalendarDate(), '2026-09-20')
  setClockSource(() => new Date('2026-09-19T02:08:00Z'))
  assert.equal(shiftClinicDate('2026-09-30', 1), '2026-10-01')
  assert.equal(shiftClinicDate('2026-01-01', -1), '2025-12-31')
  assert.equal(shiftClinicDate('2028-02-28', 1), '2028-02-29')
  assert.equal(shiftClinicDate('2027-02-28', 1), '2027-03-01')
  assert.equal(shiftClinicDate('2024-06-15', -1), '2024-06-14') // far outside the shared ±90-day window is allowed
  assert.equal(shiftClinicDate('not-a-date', 1), 'not-a-date')
  for (const bad of ['', '2026-9-1', '2026-02-30', '2026-13-01', '19/09/2026', null, undefined, 20260919]) assert.equal(isValidClinicDate(bad), false, String(bad))
  assert.equal(isValidClinicDate('2026-09-19'), true)
})

test('booking source codes from the server read as plain words', () => {
  assert.deepEqual(['patient_portal', 'online', 'staff', '', null, undefined].map(sourceLabel), ['Patient portal', 'Online', 'Staff', '—', '—', '—'])
})

// ---- read model --------------------------------------------------------------------------------------------------------
test('rows keep only contract fields needed by the calendar: no notes, history or Patient public id', () => {
  const m = mapDayAppointment(row(1))
  assert.deepEqual(Object.keys(m).sort(), ['branchId', 'branchName', 'code', 'date', 'dentistId', 'dentistName', 'duration', 'end', 'id', 'intendedServiceName', 'patientCode', 'patientName', 'serviceName', 'source', 'start', 'status'])
  assert.equal(JSON.stringify(m).includes('private booking note'), false)
  assert.equal(mapDayAppointment(row(2, { dentist: null })).dentistId, null)
})

// ---- API: paging and completeness -------------------------------------------------------------------------------------------
let oldFetch
const calls = []
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
function mockServer(handler) {
  oldFetch = globalThis.fetch; calls.length = 0
  globalThis.fetch = async url => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    if (path === '/sanctum/csrf-cookie') return new Response(null, { status: 204 })
    calls.push(path)
    return handler(new URL(`http://x${path}`))
  }
}
afterEach(() => { if (oldFetch) globalThis.fetch = oldFetch; oldFetch = null; __resetCsrfCacheForTests() })
const paged = (total, perPage = 100) => url => {
  const page = Number(url.searchParams.get('page') || 1), last = Math.ceil(total / perPage) || 1
  const n = Math.max(0, Math.min(perPage, total - (page - 1) * perPage))
  return json(200, { data: Array.from({ length: n }, (_, i) => row((page - 1) * perPage + i)), meta: { current_page: page, last_page: last, per_page: perPage, total } })
}

test('the selected date is requested alone through ?date=, page by page, and 250 rows are complete (no 500 cap assumed)', async () => {
  mockServer(paged(250))
  const result = await loadDayAppointments('2026-09-19')
  assert.deepEqual([result.ok, result.complete, result.rows.length], [true, true, 250])
  assert.deepEqual(calls, ['1', '2', '3'].map(p => `/api/appointments?date=2026-09-19&per_page=100&page=${p}`))
  assert.equal(calls.some(c => c.includes('from=') || c.includes('to=')), false)
})

test('a day larger than the read limit is flagged incomplete, never complete; failures use the shared failure shape', async () => {
  mockServer(paged(DAY_MAX_PAGES * 100 + 1))
  const big = await loadDayAppointments('2026-09-19')
  assert.deepEqual([big.ok, big.complete, big.rows.length], [true, false, DAY_MAX_PAGES * 100])
  mockServer(() => json(500, { message: 'boom' }))
  const failed = await loadDayAppointments('2026-09-19')
  assert.equal(failed.ok, false); assert.ok(failed.message)
  mockServer(url => json(200, { data: [] }))
  assert.deepEqual(await loadDayAppointments('2026-09-19'), { ok: true, rows: [], complete: true })
  assert.equal((await loadDayAppointments('2026-02-31')).ok, false) // invalid date: no request is sent
  assert.equal(calls.length, 1)
})

// ---- grouping / filters ------------------------------------------------------------------------------------------------------
test('groups by Dentist with Unassigned last, sorts by start time, and filters by branch', () => {
  const rows = [
    mapDayAppointment(row(1, { start_time: '10:00', dentist: { id: 'd2', name: 'Dr. Two' } })),
    mapDayAppointment(row(2, { start_time: '09:00', dentist: { id: 'd2', name: 'Dr. Two' } })),
    mapDayAppointment(row(3, { start_time: '08:30', dentist: null })),
    mapDayAppointment(row(4, { start_time: '08:00', dentist: { id: 'd1', name: 'Dr. One' }, branch: { id: 'b2', name: 'Roxas - Cardinal Dental Center' } })),
    mapDayAppointment(row(5, { start_time: '08:00', dentist: { id: 'd1', name: 'Dr. One' } })),
  ]
  const all = groupByDentist(rows)
  assert.deepEqual(all.map(g => g.name), ['Dr. One', 'Dr. Two', 'Unassigned'])
  assert.deepEqual(all[1].rows.map(r => r.start), ['09:00', '10:00'])
  assert.deepEqual(all[0].rows.map(r => r.code), ['APT-2026-000004', 'APT-2026-000005']) // same start: stable by code
  assert.deepEqual(groupByDentist(rows, { branchId: 'b2' }).map(g => [g.name, g.rows.length]), [['Dr. One', 1]])
  assert.deepEqual(groupByDentist(rows, { branchId: 'b9' }), [])
  assert.deepEqual(groupByDentist(null), [])
})

// ---- request races -------------------------------------------------------------------------------------------------------------
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const good = rows => ({ ok: true, rows, complete: true })
function harness() {
  const pending = []
  const seen = []
  const loader = createDayLoader({ fetchDay: date => { const d = deferred(); pending.push({ date, ...d }); return d.promise }, onChange: s => seen.push(s), now: () => '2026-09-19' })
  return { loader, pending, seen }
}

test('rapid date changes: only the latest date is applied, even when an older response arrives last', async () => {
  const { loader, pending } = harness()
  const a = loader.load('2026-09-19', 'k'), b = loader.load('2026-09-20', 'k')
  pending[1].resolve(good([{ id: 'new' }])); await b
  pending[0].resolve(good([{ id: 'old' }])); await a
  assert.deepEqual([loader.state.date, loader.state.rows.map(r => r.id)], ['2026-09-20', ['new']])
})

test('retry supersedes the failed attempt; a late original response cannot overwrite the retry', async () => {
  const { loader, pending } = harness()
  const first = loader.load('2026-09-19', 'k')
  pending[0].resolve({ ok: false, message: 'down' }); await first
  assert.equal(loader.state.status, 'error')
  const retry = loader.retry(); assert.equal(loader.state.status, 'loading')
  pending[1].resolve(good([{ id: 'r' }])); await retry
  assert.deepEqual([loader.state.status, loader.state.rows.length], ['ready', 1])
  // a slow first attempt that finally fails after the retry succeeded changes nothing
  const slow = loader.load('2026-09-19', 'k'), quick = loader.retry()
  pending[3].resolve(good([{ id: 'q' }])); await quick
  pending[2].resolve({ ok: false, message: 'late' }); await slow
  assert.deepEqual([loader.state.status, loader.state.rows[0].id], ['ready', 'q'])
})

test('sign-out or session change invalidates in-flight responses', async () => {
  const { loader, pending } = harness()
  const p = loader.load('2026-09-19', 'user-1')
  loader.invalidate()
  pending[0].resolve(good([{ id: 'prev-user' }])); await p
  assert.equal(loader.state.status, 'loading') // nothing from the old session was applied
  assert.equal(loader.state.rows.length, 0)
})

test('background refresh: failure keeps the last complete list but marks it stale; it never cancels a foreground load', async () => {
  const { loader, pending } = harness()
  const first = loader.load('2026-09-19', 'k'); pending[0].resolve(good([{ id: 'a' }])); await first
  const refresh = loader.refresh(); pending[1].resolve({ ok: false, message: 'network' }); await refresh
  assert.deepEqual([loader.state.status, loader.state.stale, loader.state.rows.length, loader.state.error], ['ready', true, 1, 'network'])
  const again = loader.refresh(); pending[2].resolve(good([{ id: 'a' }, { id: 'b' }])); await again
  assert.deepEqual([loader.state.stale, loader.state.rows.length], [false, 2])
  const next = loader.load('2026-09-21', 'k')
  assert.deepEqual(await loader.refresh(), { skipped: true }) // loading: the poll is skipped
  pending[3].resolve(good([])); await next
  assert.deepEqual([loader.state.date, loader.state.complete, loader.state.rows.length], ['2026-09-21', true, 0])
})

test('an incomplete response is carried as incomplete so the page can refuse to say "empty"', async () => {
  const { loader, pending } = harness()
  const p = loader.load('2026-09-19', 'k'); pending[0].resolve({ ok: true, rows: [], complete: false }); await p
  assert.deepEqual([loader.state.status, loader.state.complete], ['ready', false])
})

// ---- access ----------------------------------------------------------------------------------------------------------------
test('Staff and the Owner may open the Day Calendar (F6, interview R2-02); Dentist and Patient are denied; navigation is hidden in the offline demo', () => {
  const seedKeys = { persons: 'PERSONS', services: 'SERVICES', branchServices: 'BRANCH_SERVICES', dentistServiceAssignments: 'DENTIST_SERVICE_ASSIGNMENTS', branches: 'BRANCHES', dentists: 'DENTISTS', staff: 'STAFF', patients: 'PATIENTS', users: 'USERS' }
  const seeds = Object.fromEntries(Object.entries(seedKeys).map(([k, n]) => [k, structuredClone(data[`INITIAL_${n}`])]))
  const state = normalizeClinicState({ ...seeds, appointments: [], queue: [], checkIns: [], treatments: [], invoices: [], prescriptions: [], followups: [], hmo: [], conversations: [], inquiries: [], notifications: [], workflowLog: [], audit: [] })
  for (const role of ['staff', 'owner']) assert.equal(canAccessPage(state, sessionForRole(role, state), 'calendar'), true, role)
  for (const role of ['dentist', 'patient']) assert.equal(canAccessPage(state, sessionForRole(role, state), 'calendar'), false, role)
  for (const role of ['dentist', 'patient']) assert.equal(data.NAV[role].some(([k]) => k === 'calendar'), false, `${role} navigation`)
  assert.deepEqual(data.NAV.staff.find(([k]) => k === 'calendar'), ['calendar', 'Appointment Calendar'])
  assert.deepEqual(data.NAV.owner.find(([k]) => k === 'calendar'), ['calendar', 'Appointment Calendar'])
  assert.match(read('src/layout.jsx'), /\['calendar','closures','hmos','wording'\]\.includes\(k\)\|\|serverSession/)
  assert.match(read('src/App.jsx'), /canAccessPage\(store\.state,store\.session,page\)\?page:'unavailable'/)
})

test('appointment management operations: reschedule, cancel, no-show, create actions are wired to appointmentFlow and store', () => {
  const page = read('src/pages/StaffDayCalendar.jsx'), lib = read('src/day-calendar.js')
  assert.match(page, /store\.appointmentFlow\.(cancel|noShow)/)
  assert.match(page, /AppointmentForm/)
  assert.match(page, /ConfirmDialog/)
  assert.doesNotMatch(lib, /from '\.\/store\.jsx'/)
})

// ---- render (offline demo + first paint) -----------------------------------------------------------------------------------------
// Hooks need the same React instance as react-dom/server, so React stays external and the bundle is written under node_modules.
const bundle = await build({ stdin: { contents: "export * from './src/pages/StaffDayCalendar.jsx'; export { setClockSource as setBundledClock } from './src/clock.js'", resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm', external: ['react', 'react-dom'], loader: { '.css': 'empty' } })
const bundleDir = new URL('../node_modules/.cache/', import.meta.url)
mkdirSync(bundleDir, { recursive: true })
const bundleFile = new URL('m6-day-calendar-test-bundle.mjs', bundleDir)
writeFileSync(bundleFile, bundle.outputFiles[0].text)
const ui = await import(bundleFile.href)
ui.setBundledClock(() => new Date('2026-09-19T02:08:00Z'))
const store = session => ({ session, state: { branches: [{ id: 'b1', name: 'Dr. Dana Roxas Dental Clinic' }, { id: 'b2', name: 'Roxas - Cardinal Dental Center' }] } })

test('offline demo shows an honest notice and no calendar; a server session paints loading, month navigation, and removes Day/Week view toggles', () => {
  const demo = renderToString(React.createElement(ui.StaffDayCalendar, { store: store({ role: 'staff' }) }))
  assert.match(demo, /isn’t available in the offline demo/); assert.doesNotMatch(demo, /No appointments/)
  const live = renderToString(React.createElement(ui.StaffDayCalendar, { store: store({ role: 'staff', serverUserId: 'u1', branchScopes: ['b1', 'b2'] }) })).replace(/<!-- -->/g, '')
  assert.match(live, /Loading this month(?:&#x27;|')s appointments/)
  assert.match(live, /Previous month/); assert.match(live, /Next month/); assert.match(live, /Today/)
  assert.match(live, /September 2026/)
  assert.match(live, /All my branches/) // several branches: a filter exists
  // Day, Week, and Month view-switching controls are removed (AC2)
  assert.doesNotMatch(live, /class="[^"]*daycal-views/)
  assert.doesNotMatch(live, /aria-label="Calendar view"/)
  assert.doesNotMatch(live, />Day</)
  assert.doesNotMatch(live, />Week</)
  const single = renderToString(React.createElement(ui.StaffDayCalendar, { store: store({ role: 'staff', serverUserId: 'u1', branchScopes: ['b1'] }) }))
  assert.doesNotMatch(single, /All my branches/)
})

// ======================================= Week / Month views ========================================================================
test('week is Monday–Sunday: boundaries, weekday index, year rollover', () => {
  assert.equal(weekdayIndex('2026-10-12'), 0) // Monday
  assert.equal(weekdayIndex('2026-10-18'), 6) // Sunday
  assert.deepEqual(weekRange('2026-10-12'), { from: '2026-10-12', to: '2026-10-18' })
  assert.deepEqual(weekRange('2026-10-18'), { from: '2026-10-12', to: '2026-10-18' }) // a Sunday belongs to the week that began Monday
  assert.deepEqual(weekRange('2026-10-14'), { from: '2026-10-12', to: '2026-10-18' })
  assert.deepEqual(weekRange('2026-01-01'), { from: '2025-12-29', to: '2026-01-04' }) // crosses the year
  assert.deepEqual(weekRange('2028-02-29'), { from: '2028-02-28', to: '2028-03-05' }) // leap day
  assert.deepEqual(weekDays('2026-10-15'), ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'])
})

test('month is the selected calendar month, including leap years and 28/30/31-day months', () => {
  assert.deepEqual(monthRange('2026-10-13'), { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(monthRange('2026-09-30'), { from: '2026-09-01', to: '2026-09-30' })
  assert.deepEqual(monthRange('2028-02-10'), { from: '2028-02-01', to: '2028-02-29' }) // leap
  assert.deepEqual(monthRange('2027-02-10'), { from: '2027-02-01', to: '2027-02-28' })
  assert.deepEqual(monthRange('1900-02-01'), { from: '1900-02-01', to: '1900-02-28' }) // century non-leap
  assert.deepEqual(monthRange('2000-02-01'), { from: '2000-02-01', to: '2000-02-29' }) // 400-year leap
  assert.deepEqual(periodRange('day', '2026-10-13'), { from: '2026-10-13', to: '2026-10-13' })
  assert.deepEqual(periodRange('week', '2026-10-13'), weekRange('2026-10-13'))
  assert.deepEqual(periodRange('month', '2026-10-13'), monthRange('2026-10-13'))
})

test('previous/next per view; month shifts clamp the day and cross years', () => {
  assert.equal(shiftPeriod('day', '2026-12-31', 1), '2027-01-01')
  assert.equal(shiftPeriod('week', '2026-10-13', 1), '2026-10-20')
  assert.equal(shiftPeriod('week', '2026-01-03', -1), '2025-12-27')
  assert.equal(shiftPeriod('month', '2026-12-15', 1), '2027-01-15')
  assert.equal(shiftPeriod('month', '2026-01-15', -1), '2025-12-15')
  assert.equal(shiftPeriod('month', '2027-01-31', 1), '2027-02-28')
  assert.equal(shiftPeriod('month', '2028-01-31', 1), '2028-02-29')
  assert.equal(shiftPeriod('month', '2028-03-31', -1), '2028-02-29')
  assert.equal(shiftPeriod('month', '2026-05-31', 1), '2026-06-30')
  assert.equal(shiftPeriod('week', 'bad', 1), 'bad')
  // Today is disabled only when the period already contains the clinic day
  assert.equal(periodContains('week', '2026-10-12', '2026-10-18'), true)
  assert.equal(periodContains('week', '2026-10-12', '2026-10-19'), false)
  assert.equal(periodContains('month', '2026-10-01', '2026-10-31'), true)
  assert.equal(periodContains('month', '2026-10-01', '2026-11-01'), false)
})

test('month grid: Monday-first, whole weeks, and adjacent-month padding is never a fetched (verifiable) date', () => {
  const cells = monthCells('2026-10-13') // Oct 1 2026 is a Thursday; Oct 31 a Saturday
  assert.equal(cells.length % 7, 0)
  assert.equal(weekdayIndex(cells[0].date), 0); assert.equal(weekdayIndex(cells.at(-1).date), 6)
  assert.deepEqual([cells[0].date, cells.at(-1).date], ['2026-09-28', '2026-11-01'])
  assert.equal(cells.filter(c => c.inMonth).length, 31)
  for (const c of cells) assert.equal(c.fetched, c.inMonth)
  assert.deepEqual(cells.filter(c => !c.fetched).map(c => c.date), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-11-01'])
  assert.equal(monthCells('2027-02-10').length, 28) // Feb 2027 starts Monday and ends Sunday: exactly four weeks
  assert.equal(monthCells('2028-02-10').filter(c => c.inMonth).length, 29)
  assert.equal(monthCells('2026-03-01').length, 42) // a month spanning six weeks
})

test('range limits: a month is far below the server cap; the helper refuses a 184-day range like the endpoint does', () => {
  assert.equal(rangeDays(monthRange('2026-10-13')), 31)
  assert.equal(rangeDays(weekRange('2026-10-13')), 7)
  assert.equal(SERVER_MAX_RANGE_DAYS, 184)
  assert.match(read('backend/app/Http/Controllers/AppointmentController.php'), /MAX_RANGE_DAYS = 184/)
  assert.equal(rangeWithinServerLimit({ from: '2026-01-01', to: '2026-06-02' }), true) // 153 days
  assert.equal(rangeWithinServerLimit({ from: '2026-01-01', to: '2026-07-03' }), false) // 184 days
  for (const view of ['week', 'month']) for (const d of ['2026-02-28', '2028-02-29', '2026-12-31']) assert.equal(rangeWithinServerLimit(periodRange(view, d)), true)
})

test('week/month fetch through the existing from/to endpoint, page by page, within a documented limit', async () => {
  mockServer(paged(250))
  const week = await loadRangeAppointments(weekRange('2026-10-13'))
  assert.deepEqual([week.ok, week.complete, week.rows.length], [true, true, 250])
  assert.deepEqual(calls, ['1', '2', '3'].map(p => `/api/appointments?from=2026-10-12&to=2026-10-18&per_page=100&page=${p}`))
  assert.equal(calls.some(c => c.includes('date=')), false)
  mockServer(paged(RANGE_MAX_PAGES * 100 + 1))
  const big = await loadPeriod(periodTarget('month', '2026-10-13'))
  assert.deepEqual([big.ok, big.complete, big.rows.length], [true, false, RANGE_MAX_PAGES * 100])
  assert.equal(calls.length, RANGE_MAX_PAGES); assert.ok(calls[0].startsWith('/api/appointments?from=2026-10-01&to=2026-10-31&'))
  mockServer(() => json(500, { message: 'boom' }))
  assert.equal((await loadPeriod('week|2026-10-13')).ok, false)
  mockServer(() => json(200, { data: [] }))
  assert.equal((await loadRangeAppointments({ from: '2026-10-31', to: '2026-10-01' })).ok, false) // reversed range: no request
  assert.equal((await loadRangeAppointments({ from: '2026-01-01', to: '2026-12-31' })).ok, false) // over the server cap: no request
  assert.equal(calls.length, 0)
  // a bare date target still means the Day view (`?date=`)
  mockServer(paged(1)); await loadPeriod('2026-10-13'); assert.equal(calls[0], '/api/appointments?date=2026-10-13&per_page=100&page=1')
  assert.equal(periodTarget('week', '2026-10-13'), 'week|2026-10-13')
})

test('per-day totals exist only for a complete response; an incomplete one yields none (no complete-looking zeros)', () => {
  const rows = [mapDayAppointment(row(1, { date: '2026-10-12' })), mapDayAppointment(row(2, { date: '2026-10-12', branch: { id: 'b2', name: 'Roxas - Cardinal Dental Center' } })), mapDayAppointment(row(3, { date: '2026-10-14' }))]
  assert.equal(dayTotals(rows, false), null)
  const all = dayTotals(rows, true)
  assert.deepEqual([all.get('2026-10-12'), all.get('2026-10-14'), all.get('2026-10-13')], [2, 1, undefined]) // an absent day is "no entry", rendered "No appointments" only when complete
  assert.equal(dayTotals(rows, true, { branchId: 'b2' }).get('2026-10-12'), 1)
  const byDate = groupByDate(rows)
  assert.deepEqual([...byDate.keys()], ['2026-10-12', '2026-10-14'])
  assert.equal(groupByDate(rows, { branchId: 'b9' }).size, 0)
  assert.equal(groupByDate(null).size, 0)
  // the page only draws counts / "No appointments" from `totals`, which is null when incomplete
  const page = read('src/pages/StaffDayCalendar.jsx')
  assert.match(page, /const totals = dayTotals\(rows, complete, \{ branchId: activeBranch \}\)/)
  assert.match(page, /const verified = totals !== null/)
  assert.match(page, /\{totals && list\.length > 0 &&/); assert.match(page, /\{complete && list\.length > shown\.length &&/)
  assert.match(page, /!c\.fetched\)\s*return/)
})

test('request races hold across views: a late week response cannot replace the month the user switched to', async () => {
  const { loader, pending } = harness()
  const week = loader.load(periodTarget('week', '2026-10-13'), 'k'), month = loader.load(periodTarget('month', '2026-10-13'), 'k')
  pending[1].resolve(good([{ id: 'month-row' }])); await month
  pending[0].resolve(good([{ id: 'week-row' }])); await week
  assert.deepEqual([loader.state.date, loader.state.rows[0].id], ['month|2026-10-13', 'month-row'])
})

test('the navigation label is "Appointment Calendar" for Staff only; the page key and access rule are unchanged', () => {
  assert.deepEqual(data.NAV.staff.find(([k]) => k === 'calendar'), ['calendar', 'Appointment Calendar'])
  assert.match(read('src/safeguards.js'), /staff:\['dashboard','appointments','calendar','checkin'/)
  assert.match(read('src/App.jsx'), /case 'calendar': content=<StaffDayCalendar store=\{store\}\/>/)
})

// ======================================= Interactive Calendar Acceptance Tests =======================================
test('AC1 & AC3: month navigation controls and current month header', () => {
  assert.equal(defaultCalendarDate(), '2026-09-19')
  assert.equal(shiftPeriod('month', '2026-09-19', -1), '2026-08-19')
  assert.equal(shiftPeriod('month', '2026-09-19', 1), '2026-10-19')
  assert.equal(periodContains('month', '2026-09-19', '2026-09-19'), true)
  assert.equal(periodContains('month', '2026-09-19', '2026-10-01'), false)
})

test('AC4 & AC5: month transitions cross December and January in past and future without artificial limits', () => {
  // December -> January across different years
  assert.equal(shiftPeriod('month', '2026-12-15', 1), '2027-01-15')
  assert.equal(shiftPeriod('month', '2029-12-31', 1), '2030-01-31')
  // January -> December across different years
  assert.equal(shiftPeriod('month', '2027-01-15', -1), '2026-12-15')
  assert.equal(shiftPeriod('month', '2025-01-01', -1), '2024-12-01')
  // Indefinite forward navigation (years into the future)
  let cursor = '2026-10-15'
  for (let i = 0; i < 24; i++) cursor = shiftPeriod('month', cursor, 1)
  assert.equal(cursor, '2028-10-15')
  // Indefinite backward navigation
  for (let i = 0; i < 24; i++) cursor = shiftPeriod('month', cursor, -1)
  assert.equal(cursor, '2026-10-15')
})

test('AC6: leap years and months of different lengths render correctly', () => {
  // Leap year Feb 2028 has 29 days
  assert.equal(daysInMonth(2028, 2), 29)
  assert.equal(monthRange('2028-02-15').to, '2028-02-29')
  // Non-leap year Feb 2027 has 28 days
  assert.equal(daysInMonth(2027, 2), 28)
  assert.equal(monthRange('2027-02-15').to, '2027-02-28')
  // 30-day and 31-day months
  assert.equal(daysInMonth(2026, 4), 30)
  assert.equal(daysInMonth(2026, 5), 31)
  // Day clamping when shifting from a 31-day month to a 30-day or 28/29-day month
  assert.equal(shiftPeriod('month', '2027-01-31', 1), '2027-02-28')
  assert.equal(shiftPeriod('month', '2028-01-31', 1), '2028-02-29')
  assert.equal(shiftPeriod('month', '2026-05-31', 1), '2026-06-30')
})

test('AC7 & AC8: appointment count and busyness indicators per day, including zero appointments', () => {
  const rows = [
    mapDayAppointment(row(1, { date: '2026-10-12' })),
    mapDayAppointment(row(2, { date: '2026-10-12' })),
    mapDayAppointment(row(3, { date: '2026-10-14' })),
  ]
  const totals = dayTotals(rows, true)
  assert.equal(totals.get('2026-10-12'), 2)
  assert.equal(totals.get('2026-10-14'), 1)
  assert.equal(totals.get('2026-10-13'), undefined) // 0 appointments on this date

  // Busyness indicator calculation
  // Closed date
  const closed = busynessStatus({ dayLoad: { closed: true, reason: 'Renovation' }, count: 0 })
  assert.deepEqual([closed.band, closed.label], ['closed', 'Closed'])
  // 0 appointments with no capacity
  const zero = busynessStatus({ count: 0 })
  assert.deepEqual([zero.band, zero.label], ['free', 'No appointments'])
  // Low activity (1-3)
  const low = busynessStatus({ count: 2 })
  assert.deepEqual([low.band, low.label], ['light', 'Low activity'])
  // Moderate activity (4-6)
  const mod = busynessStatus({ count: 5 })
  assert.deepEqual([mod.band, mod.label], ['busy', 'Moderate activity'])
  // High / Very busy (10+)
  const veryBusy = busynessStatus({ count: 12 })
  assert.deepEqual([veryBusy.band, veryBusy.label], ['crowded', 'Very busy'])
})

test('AC9 & AC10: chronological sorting of appointments and date switching in expanded view', () => {
  const rows = [
    mapDayAppointment(row(1, { date: '2026-10-12', start_time: '14:00', code: 'APT-2026-000001' })),
    mapDayAppointment(row(2, { date: '2026-10-12', start_time: '09:00', code: 'APT-2026-000002' })),
    mapDayAppointment(row(3, { date: '2026-10-12', start_time: '09:00', code: 'APT-2026-000003' })),
    mapDayAppointment(row(4, { date: '2026-10-13', start_time: '10:00', code: 'APT-2026-000004' })),
  ]
  const byDate = groupByDate(rows)
  const day12 = byDate.get('2026-10-12')
  // Chronological order: 09:00 before 14:00, secondary by code
  assert.deepEqual(day12.map(r => r.code), ['APT-2026-000002', 'APT-2026-000003', 'APT-2026-000001'])
  // Day 13 does not contain day 12 records
  const day13 = byDate.get('2026-10-13')
  assert.deepEqual(day13.map(r => r.code), ['APT-2026-000004'])
  assert.equal(byDate.get('2026-10-14'), undefined)
})

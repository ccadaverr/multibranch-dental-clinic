import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { dentistFixture, apiAppointment, today } from './support/den-ui-01-fixture.js'
import { calendarKeyTarget, clinicDateLabel, dayAgenda, dentistScopeKey, homeClinicalWork, ownDentistRows } from '../src/dentist-workspace.js'
import { createDayLoader, loadRangeAppointments, mapDayAppointment, monthCells } from '../src/day-calendar.js'

const require = createRequire(import.meta.url)
const result = await build({ stdin: { contents: "export * from './src/pages/DentistHome.jsx'; export * from './src/pages/DentistSchedule.jsx'; export * from './src/pages/DentistWorkspace.jsx'; export * from './src/clock.js';", resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.css': 'empty' }, plugins: [{ name: 'shared-react', setup(b) { b.onResolve({ filter: /^react$/ }, () => ({ path: pathToFileURL(require.resolve('react')).href, external: true })) } }] })
const ui = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
ui.setClockSource(() => new Date('2026-11-01T10:00:00+08:00'))
const render = (Component, props) => renderToString(React.createElement(Component, props))

test('DEN-UI-01: read projections reject other Dentists, revoked branches, inactive identities and other roles', () => {
  const { state, session } = dentistFixture()
  const rows = [{ id: 'own', dentistId: 'd1', branchId: 'b1' }, { id: 'second-branch', dentistId: 'd1', branchId: 'b2' }, { id: 'other', dentistId: 'd2', branchId: 'b1' }, { id: 'revoked', dentistId: 'd1', branchId: 'b3' }]
  assert.deepEqual(ownDentistRows(rows, state, session).map(x => x.id), ['own', 'second-branch'])
  const originalKey = dentistScopeKey(state, session)
  state.dentists[0].branchIds = ['b1']
  assert.notEqual(dentistScopeKey(state, session), originalKey)
  assert.deepEqual(ownDentistRows(rows, state, session).map(x => x.id), ['own'])
  assert.deepEqual(ownDentistRows(rows, state, { ...session, role: 'owner' }), [])
  assert.deepEqual(ownDentistRows(rows, state, { ...session, userId: 'other-user' }), [])
  state.users[0].accountStatus = 'Inactive'
  assert.equal(dentistScopeKey(state, session), '')
})

test('DEN-UI-01: selected-day agenda preserves separate same-day encounters and lifecycle statuses', () => {
  const rows = ['Pending', 'Confirmed', 'Checked In', 'In Treatment', 'Completed', 'Cancelled', 'No-show'].map((status, i) => mapDayAppointment(apiAppointment('a' + i, { status, start_time: i ? '10:00' : '09:00' })))
  rows.push(mapDayAppointment(apiAppointment('tomorrow', { date: '2026-11-02' })))
  assert.equal(dayAgenda(rows, today).length, 7)
  assert.equal(dayAgenda(rows, today, { status: 'Completed' })[0].id, 'a4')
  assert.equal(dayAgenda(rows, today, { search: 'consultation' }).length, 7)
  assert.equal(dayAgenda(rows, today, { search: 'missing name' }).length, 0)
})

test('DEN-UI-01: calendar keyboard movement crosses year/month and leap-day boundaries in Manila date space', () => {
  assert.equal(calendarKeyTarget('2026-12-31', 'ArrowRight'), '2027-01-01')
  assert.equal(calendarKeyTarget('2027-01-01', 'ArrowLeft'), '2026-12-31')
  assert.equal(calendarKeyTarget('2028-02-28', 'ArrowDown'), '2028-03-06')
  assert.equal(calendarKeyTarget('2026-11-01', 'Home'), '2026-10-26')
  assert.equal(calendarKeyTarget('2026-11-01', 'End'), '2026-11-01')
  assert.equal(calendarKeyTarget(today, 'Tab'), null)
  assert.ok(clinicDateLabel('2028-02-29', { year: 'numeric', month: 'long', day: 'numeric' }).includes('February 29, 2028'))
})

test('DEN-UI-01: Home prioritizes exact active Treatment, preserves queue order and includes current In Queue status', () => {
  const { state, session } = dentistFixture()
  state.queue = [{ id: 'waiting', patientId: 'p1', visitId: 'v1', branchId: 'b1', dentistId: 'd1', clinicDate: today, status: 'In Queue', position: 1 }, { id: 'ready', patientId: 'p1', visitId: 'v2', branchId: 'b1', dentistId: 'd1', clinicDate: today, status: 'Treatment Ready', position: 2 }, { id: 'away', branchId: 'b1', dentistId: 'd1', clinicDate: today, status: 'Temporarily Away' }, { id: 'done', branchId: 'b1', dentistId: 'd1', clinicDate: today, status: 'Done' }]
  let work = homeClinicalWork(state, session, today)
  assert.deepEqual(work.queue.map(q => q.id), ['waiting', 'ready'])
  assert.equal(work.context.visitId, 'v2')
  state.treatments = [{ id: 't-exact', server: true, status: 'In Treatment', visitId: 'old-visit', queueEntryId: 'old-queue', branchId: 'b2', dentistId: 'd1', patientId: 'p1', date: '2026-10-31' }]
  work = homeClinicalWork(state, session, today)
  assert.equal(work.context.treatmentId, 't-exact')
  assert.equal(work.context.visitId, 'old-visit')
  assert.equal(work.context.queueEntryId, 'old-queue')
})

test('DEN-UI-01: Home has operational hierarchy, truthful loading and no inferred duty or local task totals', () => {
  const fixture = dentistFixture()
  delete fixture.state.dentists[0].on_duty_today
  const html = render(ui.DentistHome, { store: { ...fixture, appointmentsStatus: 'loading' }, setPage() {} })
  for (const text of ['<h1>Home</h1>', 'Waiting patients', 'Branch follow-ups', 'Loading appointments', 'Duty status unavailable']) assert.ok(html.replace(/<!--.*?-->/g, '').includes(text), text)
  assert.doesNotMatch(html, /without the clutter|clinical-stat-stack|awaiting authorization|return-visit obligation/)
  assert.ok(html.indexOf('Current encounter') < html.indexOf('Your assigned patients'))
})

test('DEN-UI-01: active Home and Schedule fail closed for a non-Dentist profile', () => {
  const fixture = dentistFixture(); fixture.session.role = 'staff'
  assert.match(render(ui.DentistHome, { store: fixture, setPage() {} }), /workspace unavailable/)
  assert.match(render(ui.DentistSchedule, { store: fixture }), /Schedule unavailable/)
})

test('DEN-UI-01: Schedule renders the calendar immediately with one selected and tab-reachable day', () => {
  const read = { status: 'ready', complete: true, rows: [mapDayAppointment(apiAppointment())] }
  const html = render(ui.MonthCalendar, { date: today, today, read, onChange() {} })
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1)
  assert.equal((html.match(/tabindex="0"/g) || []).length, 1)
  assert.ok(html.includes('November 2026'))
  assert.ok(html.includes('November 1, 2026, 1 appointment'))
  assert.equal((html.match(/data-date=/g) || []).length, monthCells(today).length)
})

test('DEN-UI-01: unknown calendar counts are never advertised as zero', () => {
  for (const read of [{ status: 'loading' }, { status: 'error' }, { status: 'ready', complete: false, rows: [] }, { status: 'ready', complete: true, stale: true, rows: [] }]) {
    const html = render(ui.MonthCalendar, { date: today, today, read, onChange() {} })
    assert.doesNotMatch(html, /, 0 appointments/)
  }
})

test('DEN-UI-01: loading/error/incomplete/stale read states are distinct from empty appointments', () => {
  assert.match(render(ui.ReadState, { read: { status: 'loading' } }), /role="status"/)
  for (const read of [{ status: 'error', error: 'Unavailable' }, { status: 'ready', complete: false }, { status: 'ready', complete: true, stale: true }]) {
    const html = render(ui.ReadState, { read: { ...read, retry() {} } })
    assert.ok(html.includes('Try again')); assert.ok(html.includes('role="alert"')); assert.doesNotMatch(html, /No appointments scheduled/)
  }
})

test('DEN-UI-01: appointment statuses and end times are shown from actual records', () => {
  const rows = [mapDayAppointment(apiAppointment('one', { status: 'Pending', end_time: null })), mapDayAppointment(apiAppointment('two', { status: 'In Treatment' }))]
  const html = render(ui.AppointmentAgenda, { rows, onOpen() {} })
  assert.ok(html.includes('Pending') && html.includes('In Treatment'))
  assert.equal((html.match(/9:30 AM/g) || []).length, 1)
  assert.equal((html.match(/View appointment for /g) || []).length, 2)
})

test('DEN-UI-01: reused month loader reads every page and fails honestly', async () => {
  const before = globalThis.fetch, requests = []
  globalThis.fetch = async url => {
    const parsed = new URL(url); requests.push(parsed)
    return new Response(JSON.stringify({ data: [apiAppointment('p' + parsed.searchParams.get('page'))], meta: { current_page: Number(parsed.searchParams.get('page')), last_page: 2 } }), { status: 200 })
  }
  try {
    const result = await loadRangeAppointments({ from: today, to: '2026-11-30' })
    assert.equal(result.complete, true); assert.equal(result.rows.length, 2)
    assert.equal(requests[0].searchParams.get('from'), today)
    assert.equal(requests[1].searchParams.get('page'), '2')
    globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 })
    assert.equal((await loadRangeAppointments({ from: today, to: '2026-11-30' })).ok, false)
  } finally { globalThis.fetch = before }
})

test('DEN-UI-01: calendar month changes cannot be overwritten by slower responses', async () => {
  const pending = new Map()
  const loader = createDayLoader({ fetchDay: target => new Promise(resolve => pending.set(target, resolve)) })
  const old = loader.load('month|2026-11-01', 'scope1'), latest = loader.load('month|2026-12-01', 'scope1')
  pending.get('month|2026-12-01')({ ok: true, rows: [{ id: 'new' }], complete: true }); await latest
  pending.get('month|2026-11-01')({ ok: true, rows: [{ id: 'old' }], complete: true }); await old
  assert.equal(loader.state.rows[0].id, 'new')
  const revoked = loader.load('month|2027-01-01', 'scope1'); loader.invalidate()
  pending.get('month|2027-01-01')({ ok: true, rows: [{ id: 'revoked' }], complete: true }); await revoked
  assert.deepEqual(loader.state.rows, [])
  assert.equal(loader.state.status, 'loading')
})

test('DEN-UI-01: active routes and navigation use the redesigned Dentist components', () => {
  const read = path => readFileSync(path, 'utf8')
  assert.match(read('src/pages/Dashboards.jsx'), /role==='dentist'.*<DentistHome/)
  assert.match(read('src/pages/Scheduling.jsx'), /DentistSchedule as SchedulePage/)
  assert.match(read('src/App.jsx'), /case 'schedule': content=<SchedulePage store=\{store\}/)
  assert.ok(read('src/data.js').includes("['dashboard','Home'], ['schedule','My Schedule']"))
})

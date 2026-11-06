import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Authored, not executed. Synthetic SSR/source contracts; browser scenarios below remain deferred.
const require = createRequire(import.meta.url)
const bundle = await build({ entryPoints: ['src/pages/Staffing.jsx'], bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.css': 'empty' }, plugins: [{ name: 'react', setup(b) { b.onResolve({ filter: /^react$/ }, () => ({ path: pathToFileURL(require.resolve('react')).href, external: true })) } }] })
const { staffShiftSummary, staffScheduleProfiles, StaffShiftProfile, StaffScheduleProfiles } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const row = { id: 's1', name: 'Synthetic Staff A', title: 'Receptionist', branch: { id: 'b1', name: 'Synthetic Branch A' }, shift_start: '08:30', shift_end: '17:45', available: true }
const session = { serverUserId: 'account-staff', role: 'staff', active: true, branchScopes: ['b1'] }
const htmlFor = (record = row, role = 'staff', canEdit = false) => renderToStaticMarkup(React.createElement(StaffShiftProfile, { staff: staffShiftSummary(record), role, canEdit, branches: [{ id: 'b1', name: 'Synthetic Branch A' }] }))

test('SCHED-01 valid profile summary contains only returned shift and assignment data', () => {
  const html = htmlFor()
  assert.match(html, /8:30 AM–5:45 PM/)
  assert.match(html, /Synthetic Branch A/)
  assert.match(html, /Marked available/)
  assert.match(html, /Weekly Staff roster unavailable/)
  assert.doesNotMatch(html, /Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Day off/)
})

test('SCHED-01 missing information is not replaced with invented hours or availability', () => {
  const missing = staffShiftSummary({ id: 'missing' })
  assert.equal(missing.start, '')
  assert.equal(missing.end, '')
  assert.equal(missing.available, null)
  assert.equal(missing.branchRef, '')
  assert.equal(staffShiftSummary({ id: 'bad', shift_start: '25:00' }).start, '')
  assert.match(htmlFor({ id: 'missing' }), /Shift hours unavailable/)
  assert.match(htmlFor({ id: 'missing' }), /Availability not provided/)
})

test('SCHED-01 server defaults are disclosed without claiming confirmed weekday coverage', () => {
  const html = htmlFor({ ...row, shift_start: '09:00', shift_end: '18:00' })
  assert.match(html, /may substitute 09:00–18:00/)
  assert.match(html, /does not identify which values are defaults/)
  assert.match(html, /do not confirm attendance or coverage/)
  assert.doesNotMatch(html, /<ul class="st-week"/)
})

test('SCHED-01 Owner edit control exists; Staff and Dentist cannot obtain it through canEdit alone', () => {
  assert.match(htmlFor(row, 'owner', true), /Change shift profile/)
  assert.doesNotMatch(htmlFor(row, 'staff', true), /Change shift profile|<form/)
  assert.doesNotMatch(htmlFor(row, 'dentist', true), /Change shift profile|<form/)
  assert.doesNotMatch(htmlFor(row, 'owner', false), /Change shift profile|<form/)
})

test('SCHED-01 Staff branch scope is identity-specific and never falls back to demo rows', () => {
  const rows = [row, { ...row, id: 's2', branch: { id: 'b2', name: 'Other branch' } }, { ...row, id: 'unassigned', branch: null }]
  assert.deepEqual(staffScheduleProfiles({ staff: rows }, session, 'staff').map(s => s.id), ['s1'])
  assert.deepEqual(staffScheduleProfiles({ staff: rows }, { ...session, branchScopes: [] }, 'staff'), [])
  assert.deepEqual(staffScheduleProfiles({ staff: rows }, { ...session, serverUserId: null }, 'staff'), [])
  assert.deepEqual(staffScheduleProfiles({ staff: rows }, { ...session, active: false }, 'staff'), [])
  assert.deepEqual(staffScheduleProfiles({ staff: rows }, session, 'owner'), [])
  assert.equal(staffScheduleProfiles({ staff: rows }, { ...session, role: 'owner' }, 'owner').length, 3)
  assert.deepEqual(staffScheduleProfiles({ staff: [] }, session, 'staff'), [])
  const html = renderToStaticMarkup(React.createElement(StaffScheduleProfiles, { role: 'staff', session: { ...session, serverUserId: null } }))
  assert.match(html, /Historical workspace profiles are not shown/)
})

test('SCHED-01 update response time strings are normalized without losing the saved profile identity', () => {
  const summary = staffShiftSummary({ id: 's1', branchId: 'b2', branch: 'Saved Branch', shiftStart: '10:15:00', shiftEnd: '19:30:00', available: false })
  assert.equal(summary.id, 's1')
  assert.equal(summary.branchRef, 'b2')
  assert.equal(summary.start, '10:15')
  assert.equal(summary.end, '19:30')
  assert.equal(summary.available, false)
})

test('SCHED-01 source guards capture the target, block duplicate saves and suppress late results', () => {
  const source = readFileSync('src/pages/Staffing.jsx', 'utf8')
  const editor = source.slice(source.indexOf('export function StaffShiftProfile('), source.indexOf('function WeeklyGrid('))
  assert.match(editor, /!allowed.current \|\| !live.current \|\| pending.current/)
  assert.match(editor, /const id = staff.id, payload =/)
  assert.match(editor, /await updateStaffProfile\(id, payload\)/)
  assert.match(editor, /if \(!live.current \|\| !allowed.current\) return/)
  assert.match(editor, /if \(result.data\?\.id !== id\)/)
  assert.match(editor, /if \(!result.ok\) \{ setError\(firstError\(result\)\); return \}/)
  assert.doesNotMatch(editor, /setEditing\(false\);\s*setError\(firstError/)
  assert.match(source, /key=\{summary.id\}/)
  assert.match(source, /<select value=\{summary.id\} disabled=\{saving\}/)
  assert.match(source, /row.id === record.id/)
})

test('SCHED-01 source guards preserve keyboard form feedback and Dentist workflow wiring', () => {
  const source = readFileSync('src/pages/Staffing.jsx', 'utf8')
  assert.match(source, /aria-label=\{`Edit shift for \$\{staff.name\}`\}/)
  assert.match(source, /id="staff-shift-error" role="alert" tabIndex=\{0\}/)
  assert.match(source, /<fieldset disabled=\{saving\}/)
  assert.match(source, /controls.current\?\.querySelector\('button'\)\?\.focus\(\)/)
  assert.match(source, /<WeeklyGrid dentist=\{dentist\} data=\{data\}/)
  assert.match(source, /<Exceptions data=\{data\} dentist=\{dentist\}/)
  assert.match(source, /<AffectedAppointments rows=\{affected\}/)
})

// Deferred browser entry point for the synthetic fixture; invoke only during authorized acceptance.
export async function runSched01Browser(page, base = 'http://127.0.0.1:5176') {
  await page.goto(`${base}/tests/fixtures/sched01-staff-roster.html`)
  const select = page.getByLabel('Staff member', { exact: true })
  await select.waitFor()
  await select.selectOption('s2'); await select.selectOption('s1'); await select.selectOption('s2')
  await page.getByRole('button', { name: 'Change shift profile', exact: true }).click()
  assert.equal(await page.getByLabel('Shift start', { exact: true }).inputValue(), '10:00')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await select.selectOption('s1')
  await page.getByRole('button', { name: 'Change shift profile', exact: true }).click()
  await page.getByLabel('Shift start', { exact: true }).fill('09:15')
  await page.getByLabel('Shift end', { exact: true }).fill('18:15')
  await page.getByLabel('Assigned branch', { exact: true }).selectOption('b2')
  await page.evaluate(() => { window.sched01.fail = true })
  await page.getByRole('button', { name: 'Save shift profile', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByLabel('Shift start', { exact: true }).inputValue(), '09:15')
  assert.equal(await page.getByLabel('Assigned branch', { exact: true }).inputValue(), 'b2')
  await page.evaluate(() => { window.sched01.fail = false; window.sched01.hold = true })
  await page.getByRole('button', { name: 'Save shift profile', exact: true }).click()
  await page.waitForFunction(() => window.sched01.requests.length === 2 && window.sched01.release)
  assert.equal(await select.isDisabled(), true)
  assert.equal(await page.getByLabel('Shift start', { exact: true }).isDisabled(), true)
  await page.locator('form[aria-label]').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  assert.equal(await page.evaluate(() => window.sched01.requests.length), 2)
  // Losing the editor's Owner context must suppress a delayed response and its success feedback.
  await page.evaluate(() => window.sched01.setRole('staff'))
  await page.getByLabel('Staff member', { exact: true }).waitFor()
  await page.evaluate(() => { window.sched01.hold = false; window.sched01.release() })
  assert.equal(await page.getByRole('button', { name: 'Change shift profile', exact: true }).count(), 0)
  await page.evaluate(() => window.sched01.setRole('owner'))
  await page.getByLabel('Staff member', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Change shift profile', exact: true }).click()
  await page.getByRole('button', { name: 'Save shift profile', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Shift profile saved for Synthetic Staff A.' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Change shift profile', exact: true }).evaluate(el => el === document.activeElement), true)
  const calls = await page.evaluate(() => window.sched01.requests)
  assert.ok(calls.every(call => call.id === 's1'))
  assert.deepEqual(calls.at(-1).body, { shift_start: '09:15', shift_end: '18:15', branch_ref: 'b2' })
  await page.evaluate(() => window.sched01.setRole('staff'))
  await page.getByLabel('Staff member', { exact: true }).waitFor()
  assert.deepEqual(await page.getByLabel('Staff member', { exact: true }).locator('option').evaluateAll(options => options.map(option => option.value)), ['s2'])
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
}

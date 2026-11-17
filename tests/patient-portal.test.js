import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { dateLong, icsFor, splitAppointments, time12 } from '../src/patient/format.js'

// The Patient portal (src/patient): decisions 1-6, real data only, the booking calendar and the assistant stream.
const require = createRequire(import.meta.url)
const bundle = await build({ stdin: { contents: "export { Login } from './src/layout.jsx'; export * from './src/patient/ui.jsx'; export * from './src/patient/Portal.jsx';", resolveDir: process.cwd() }, bundle: true, write: false, loader: { '.css': 'empty' }, platform: 'node', format: 'esm',
  plugins: [{ name: 'react', setup(b) { b.onResolve({ filter: /^react$/ }, () => ({ path: pathToFileURL(require.resolve('react')).href, external: true })) } }] })
const ui = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const render = (C, props = {}) => renderToStaticMarkup(React.createElement(C, props))
const read = path => readFileSync(path, 'utf8')
const portalFiles = ['src/patient/Portal.jsx', 'src/patient/Assistant.jsx', 'src/patient/BookingCalendar.jsx', ...readdirSync('src/patient/pages').map(f => `src/patient/pages/${f}`)]

test('decision 1: a verified email opens sign-in with the address filled in and the message, never a signed-in session', () => {
  const app = read('src/App.jsx')
  const verify = app.slice(app.indexOf('const verifyRegistration'), app.indexOf('const resendRegistration'))
  assert.doesNotMatch(verify, /enterSession|bridgeBackendIdentity|setAuthPhase/)
  assert.match(verify, /Your account is verified\. Please sign in\./)
  const html = render(ui.Login, { onLogin: () => {}, initialEmail: 'new.patient@example.test', notice: 'Your account is verified. Please sign in.' })
  assert.match(html, /value="new\.patient@example\.test"/)
  assert.match(html, /Your account is verified\. Please sign in\./)
  assert.match(html, /type="password"[^>]*value=""/)
})

test('decisions 2, 3 and 5: the name is read-only with a front-desk link, email change asks for the current password, and no HMO or placeholder screens', () => {
  const account = read('src/patient/pages/Account.jsx')
  assert.match(account, /Need to correct your name\? Message the front desk/)
  assert.doesNotMatch(account, /updatePatientRecordRemote|first_name:/)
  assert.match(account, /label="Current password"/)
  assert.match(account, /requestEmailChange\(\{ newEmail: email\.trim\(\), currentPassword: password \}\)/)
  const portal = read('src/patient/Portal.jsx')
  // Prescriptions are real clinic-server data now (M19), so the portal has that page; the other placeholders stay out.
  for (const word of ['hmo', 'loyalty', 'followups', 'queue']) assert.doesNotMatch(portal, new RegExp(`\\['${word}'`), word)
})

test('Section 22 and decision 6: pay at booking via PayMongo, and messages are routed to a front desk with a Change link', () => {
  const book = read('src/patient/pages/Book.jsx')
  assert.match(book, /Pay at booking via PayMongo/i)
  assert.match(book, /checkout_url/)
  const messages = read('src/pages/ServerMessages.jsx')
  assert.match(messages, /To: <b>\{chosen\.name\} front desk<\/b>/)
  assert.match(messages, />Change<\/button>/)
})

test('the portal reads the clinic server only: no local mock state, sample people or invented counts', () => {
  for (const file of portalFiles) {
    const source = read(file)
    for (const banned of ['patient-view.js', 'data.js', 'store.state', 'Miguel Reyes', 'Math.random']) assert.ok(!source.includes(banned), `${file} uses ${banned}`)
  }
})

test('shared states: skeleton, empty and error states are accessible and the pill never shows a raw Issued', () => {
  assert.match(render(ui.Skeleton, { label: 'Loading your visits' }), /role="status" aria-label="Loading your visits"/)
  const empty = render(ui.EmptyState, { title: 'No appointments yet. Book your first visit.' })
  assert.match(empty, /No appointments yet\. Book your first visit\./)
  assert.match(render(ui.ErrorState, { text: 'Offline', onRetry: () => {} }), /role="alert"[\s\S]*Try again/)
  assert.match(render(ui.Pill, { children: 'Issued' }), /Payment due/)
})

test('booking calendar: only available days can be booked; a full day opens the waitlist only when booking passes onFullDay; closed and past days are disabled', () => {
  const source = read('src/patient/BookingCalendar.jsx')
  assert.match(source, /disabled=\{day\.status !== 'available' && !\(onFullDay && day\.status === 'full'\) && !\(\(day\.status === 'closed' \|\| day\.status === 'off'\) && day\.reason\)\}/)
  assert.match(source, /aria-disabled=\{day\.status === 'closed' \|\| day\.status === 'off' \? true : undefined\}/) // a closed day with a reason only shows the reason (F5)
  assert.match(source, /onFullDay = null/) // rescheduling does not pass it, so full days stay disabled there
  assert.match(source, /day\.status === 'closed' \|\| day\.status === 'off' \? setClosedNote\(day\) : day\.status === 'full' \? onFullDay\(day\.date\) : onChange\(day\.date\)/)
  assert.match(source, /'Morning'/); assert.match(source, /'Afternoon'/)
  assert.match(source, /disabled=\{!data\?\.previous_month/); assert.match(source, /disabled=\{!data\?\.next_month/)
})

test('formatting: 12-hour times, calendar dates without a timezone shift, upcoming split and an .ics file', () => {
  assert.equal(time12('09:00'), '9:00 AM'); assert.equal(time12('13:30'), '1:30 PM'); assert.equal(time12('00:15'), '12:15 AM')
  assert.equal(dateLong('2026-10-15'), 'Thu, Oct 15, 2026')
  const now = new Date('2026-10-14T10:00:00+08:00')
  const { upcoming, past } = splitAppointments([
    { id: 'a', status: 'Confirmed', starts_at: '2026-10-16T09:00:00+08:00' }, { id: 'b', status: 'Confirmed', starts_at: '2026-10-15T09:00:00+08:00' },
    { id: 'c', status: 'Cancelled', starts_at: '2026-10-20T09:00:00+08:00' }, { id: 'd', status: 'Completed', starts_at: '2026-10-01T09:00:00+08:00' }], now)
  assert.deepEqual(upcoming.map(a => a.id), ['b', 'a']); assert.deepEqual(past.map(a => a.id), ['c', 'd'])
  const ics = icsFor({ id: 'x1', service: 'Cleaning, basic', branchName: 'Dr. Dana Roxas Dental Clinic', branchAddress: 'Main; Bocaue', dentist: 'Dr. A', startsAt: '2026-10-15T09:00:00+08:00', endsAt: '2026-10-15T09:30:00+08:00', clinicName: 'Clinic' })
  assert.match(ics, /DTSTART:20261015T010000Z/); assert.match(ics, /DTEND:20261015T013000Z/)
  assert.match(ics, /SUMMARY:Cleaning\\, basic · Clinic/); assert.ok(ics.includes('LOCATION:Dr. Dana Roxas Dental Clinic\\, Main\\; Bocaue'))
  assert.ok(ics.includes('\r\nEND:VCALENDAR'))
})

test('assistant stream: events are parsed as they arrive, the final answer wins, and a broken stream is an honest failure', async () => {
  const { streamAssistant } = await import('../src/api-client.js')
  const sse = 'event: meta\ndata: {"mode":"ai"}\n\nevent: delta\ndata: {"text":"Hel"}\n\nevent: delta\ndata: {"text":"lo"}\n\nevent: done\ndata: {"answer":"Hello","outcome":"answered","mode":"ai","actions":[]}\n\n'
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    const seen = []
    const result = await streamAssistant('Hi', [], (name, data) => seen.push([name, data.text ?? data.answer ?? data.mode]))
    assert.equal(result.ok, true); assert.equal(result.data.answer, 'Hello')
    assert.deepEqual(seen, [['meta', 'ai'], ['delta', 'Hel'], ['delta', 'lo'], ['done', 'Hello']])
    globalThis.fetch = async () => new Response('event: delta\ndata: {"text":"Hal"}\n\n', { status: 200 })
    const broken = await streamAssistant('Hi')
    assert.equal(broken.ok, false)
  } finally { globalThis.fetch = original }
})

test('assistant panel: buttons only (never books, cancels or pays), a disclaimer and a front-desk handoff', () => {
  const source = read('src/patient/Assistant.jsx')
  assert.doesNotMatch(source, /createAppointment|cancelAppointment|createPayMongoCheckout/)
  assert.match(source, /Automated assistant\. For anything not covered, /)
  assert.match(source, /Not medical advice/)
  assert.match(source, /open_visits/)
  assert.match(source, /Talk to the front desk/)
  assert.match(source, /streamAssistant/)
})
test('patient portal sidebar segregation: navigation is grouped with section headers and all pages are mapped', () => {
  const portal = read('src/patient/Portal.jsx')
  assert.match(portal, /NAV_SECTIONS/)
  assert.match(portal, /pp-nav-groups/)
  assert.match(portal, /pp-nav-group-title/)
  assert.match(portal, /Appointments & Care/)
  assert.match(portal, /Records & Billing/)
  const css = read('src/patient/portal.css')
  assert.match(css, /\.pp-nav-groups/)
  assert.match(css, /\.pp-nav-group-title/)
})

test('Section 2.4: BillingPage resend receipt button calls resendBillingReceipt and handles transport_accepted, logged_only, suppressed, and error outcomes without falsely claiming sent', () => {
  const billing = read('src/patient/pages/Billing.jsx')
  assert.match(billing, /resendBillingReceipt\(id\)/)
  assert.match(billing, /Resend receipt/)
  assert.match(billing, /status === 'transport_accepted'/)
  assert.match(billing, /status === 'logged_only'\s*\?\s*'Receipt email was logged locally \(not sent to an external inbox in this environment\)\.'/)
  assert.match(billing, /status === 'suppressed'\s*\?\s*'Receipt email was suppressed because this account uses a test email address\.'/)
  assert.match(billing, /The receipt email could not be sent\./)
})

test('Section 2.4: BillingPage displays Receipt number, Payment reference, Payment status, and booking deposit adjustments', () => {
  const billing = read('src/patient/pages/Billing.jsx')
  assert.match(billing, /\['Receipt number', inv\.receipt\.number\]/)
  assert.match(billing, /\['Payment reference', inv\.receipt\.reference\]/)
  assert.match(billing, /\['Payment status'/)
  assert.match(billing, /Less: booking deposit applied/)
})

test('Section 2.1: PrescriptionsPage and TeethPage use shared PageHead and ErrorState retry button', () => {
  const prescriptions = read('src/patient/pages/Prescriptions.jsx')
  assert.match(prescriptions, /<PageHead/)
  assert.match(prescriptions, /<ErrorState text=\{error\} onRetry=\{\(\) => setAttempt\(a => a \+ 1\)\}\/>/)
  const teeth = read('src/patient/pages/Teeth.jsx')
  assert.match(teeth, /<PageHead/)
  assert.match(teeth, /<ErrorState text=\{error\} onRetry=\{\(\) => setAttempt\(a => a \+ 1\)\}\/>/)
})

test('Section 2.1: ProfilePage Open Family link navigates to FamilyPage where dependents are managed via myDependents/addDependent/inviteToClaim', () => {
  const account = read('src/patient/pages/Account.jsx')
  assert.match(account, /onNavigate\('family'\)/)
  assert.match(account, /Open Family/)
  const portal = read('src/patient/Portal.jsx')
  assert.match(portal, /case 'family': content = <FamilyPage[^\n]*session=\{store\.session\}[^\n]*getAuthGeneration=\{store\.getAuthGeneration\}/)
  assert.equal(ui.portalPageFromHash('#p/family'), 'family')
  const family = read('src/patient/pages/Family.jsx')
  assert.match(family, /myDependents\(\)/)
  assert.match(family, /createDependentCommand\(\{guardianId:session\.patientPublicId,payload,isCurrent:owns\}\)/)
  assert.match(family, /inviteToClaim\(d\.id, inviteEmail\)/)
})

test('Section 2.1: no internal module codes (M1-M26) or internal storage/enum tokens appear in patient-visible portal source', () => {
  const checkFiles = [...portalFiles, 'src/pages/PatientMe.jsx', 'src/pages/ServerMessages.jsx']
  for (const file of checkFiles) {
    const noComments = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
    assert.doesNotMatch(noComments, /\bM(?:[1-9]|1\d|2[0-6])\b/, `${file} must not expose M1-M26 module codes`)
    assert.doesNotMatch(noComments, /\b(?:legacy_ref|no_text_layer|unavailable_ocr_not_configured|not_performed)\b/, `${file} must not expose raw internal tokens`)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { publicViewFromHash } from '../src/public-route.js'
import { resolveBookingService } from '../src/patient/booking-flow.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('one-time email links open the respond page without signing in, and the token is dropped from the address bar', () => {
  assert.equal(publicViewFromHash('#respond/abc.def'), 'respond')
  assert.equal(publicViewFromHash('#respond'), 'respond')
  assert.equal(publicViewFromHash('#sign-in'), 'login')
  const app = read('src/App.jsx'), page = read('src/pages/RespondLink.jsx')
  assert.ok(app.indexOf("publicView==='respond'") < app.indexOf("if(authPhase==='checking')"), 'rendered before the session check')
  assert.match(page, /replaceState\(null, '', '#respond'\)/)
  // Cancelling and moving up always ask first; "I'll be there" and "On my way" are one click.
  assert.match(page, /d\.purpose === 'attend' \|\| d\.purpose === 'on_my_way'/)
  assert.match(page, /Yes, cancel my appointment/); assert.match(page, /Yes, move me to the earlier time/)
})

test('automations: a switch stays disabled until the wording is approved, and each default says where it came from', () => {
  const page = read('src/pages/Automations.jsx')
  assert.match(page, /const blocked = !row\.enabled && unapproved\.length > 0/)
  assert.match(page, /disabled=\{!!busy \|\| blocked\}/)
  assert.match(page, /from clinic interview R2 \(\$\{src\}\)/)
  assert.match(page, /recommended, not confirmed by the clinic/)
  assert.match(page, /sandbox="allow-same-origin" srcDoc=\{preview\.html\}/) // the email preview runs no script (no allow-scripts)
})

test('new pages are reachable only by their roles, and only with the clinic server', () => {
  const guards = read('src/safeguards.js'), layout = read('src/layout.jsx')
  assert.match(guards, /staff:\[[^\]]*'closures'/); assert.match(guards, /owner:\[[^\]]*'closures','hmos'/); assert.match(guards, /dentist:\[[^\]]*'wording'/)
  assert.doesNotMatch(guards.match(/patient:\[[^\]]*\]/)[0], /closures|hmos|wording/)
  assert.match(layout, /\['calendar','closures','hmos','wording'\]\.includes\(k\)\|\|serverSession/)
})

test('booking: consultation-first services book the consultation, hidden ones are not offered, and the policy shows in review', () => {
  const book = read('src/patient/pages/Book.jsx')
  assert.match(book, /s\.online_booking !== 'hidden'/)
  assert.match(book, /resolveBookingService\(all, s\.id\)/)
  const consultation = { id: 'consultation', status: 'Active', online_booking: 'bookable' }
  const treatment = { id: 'treatment', status: 'Active', online_booking: 'consultation_first', consultation_service_id: consultation.id }
  assert.equal(resolveBookingService([consultation, treatment], treatment.id).service.id, consultation.id)
  assert.equal(resolveBookingService([treatment], treatment.id).ok, false)
  assert.match(book, /Starts with a consultation/)
  assert.match(book, /r\.meta\?\.cancellation_policy/)
})

test('calendar load is a number and a band (never colour alone), and closed days carry their reason', () => {
  const cal = read('src/pages/StaffDayCalendar.jsx')
  assert.match(cal, /label: `\$\{day\.percent\}% booked/)
  assert.match(cal, /band: 'closed', label: 'Closed', detail: day\.reason/)
  assert.match(cal, /className="daycal-legend"/)
  assert.match(read('src/patient/BookingCalendar.jsx'), /\{closedNote\.status === 'off' \? 'not available' : 'closed'\} — \{closedNote\.reason\}/)
})

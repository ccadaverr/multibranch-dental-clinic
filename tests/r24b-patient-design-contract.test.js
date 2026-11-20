import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/patient/portal.css', import.meta.url), 'utf8')
const portal = readFileSync(new URL('../src/patient/Portal.jsx', import.meta.url), 'utf8')
const booking = readFileSync(new URL('../src/patient/pages/Book.jsx', import.meta.url), 'utf8')
const dentistCSS = readFileSync(new URL('../src/dentist-workspace.css', import.meta.url), 'utf8')
const workspaceCSS = readFileSync(new URL('../src/unified-workspace-r17.css', import.meta.url), 'utf8')
const notificationCSS = readFileSync(new URL('../src/notification-panel.css', import.meta.url), 'utf8')

const rule = selector => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))
  return match ?? []
}

test('Patient keeps six primary destinations; account moves to the shared footer menu and bell stays separate', () => {
  for (const label of ['Home', 'Appointments', 'Messages', 'Prescriptions', 'My Teeth', 'History']) {
    assert.ok(portal.includes(`'${label}'`), `Missing ${label}`)
  }
  assert.match(portal, /aria-label=\{`Notifications/)
  assert.match(portal, /<AccountMenu accountId=/)
  assert.match(portal, /<Brand className="pp-brand"\/>/)
})

test('Patient R02 desktop sidebar is compact rather than an oversized dashboard rail', () => {
  assert.match(css, /grid-template-columns:\s*216px\s+minmax\(0,\s*1fr\)/)
  assert.match(css, /\.pp-brand \.clinic-logo\s*\{\s*width:\s*42px/)
  assert.match(css, /\.pp-main\s*\{\s*padding:\s*28px 32px 64px/)
})

test('Booking offers three equal-width branch choices on desktop and keeps responsive tablet/mobile columns', () => {
  assert.match(booking, /className="pp-options pp-branch-grid"/)
  assert.match(booking, /\.map\(b => card\(b, false\)\)/)
  assert.match(css, /\.pp-branch-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
  assert.match(css, /@media \(min-width: 660px\)\s*\{\s*\.pp-branch-grid\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(css, /@media \(min-width: 960px\)\s*\{\s*\.pp-branch-grid\s*\{\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/)
  assert.doesNotMatch(css, /\.pp-branch\.is-recommended\s*\{\s*grid-column:\s*1\s*\/\s*-1/)
})

test('Patient large surfaces use flat quiet fills, with no decorative gradients or blur', () => {
  for (const selector of ['.pp-shell', '.pp-empty', '.pp-next', '.pp-success-card', '.pp-balance', '.aa-test']) {
    const rules = rule(selector)
    assert.ok(rules.length, `Missing ${selector}`)
    assert.ok(!rules.some(text => /linear-gradient|radial-gradient|backdrop-filter/.test(text)), `${selector} uses decorative paint`)
  }
  assert.match(workspaceCSS, /\.pp-shell \.pp-main\s*\{\s*background:\s*#f7f8f7;/)
  assert.match(css, /\.pp-next\s*\{[^}]*border-top:\s*3px solid var\(--brand\)/)
  assert.match(css, /\.pp-progress span\s*\{[^}]*background:\s*var\(--brand\)/)
})

test('Patient touch targets and reduced-motion gate are preserved', () => {
  assert.match(css, /\.pp-icon-btn\s*\{[^}]*width:\s*44px;\s*height:\s*44px/)
  assert.match(css, /\.pp-cal-day\s*\{[^}]*min-height:\s*44px/)
  assert.match(css, /@media \(prefers-reduced-motion:\s*no-preference\)/)
})

test('Dentist Home and Schedule share the clinical blue accent without changing semantic statuses', () => {
  assert.match(dentistCSS, /--den-accent:\s*var\(--brand,\s*#1865ac\)/)
  assert.match(dentistCSS, /--den-accent-soft:\s*var\(--brand-soft,\s*#eaf2fb\)/)
  assert.match(dentistCSS, /\.den-workspace\s+:is\(button, input, select\):focus-visible/)
})


test('Staff, Owner and Dentist inbox keeps unread meaning without broad blue-filled rows', () => {
  assert.match(notificationCSS, /\.a12-notifications \.notification-row\.unread\s*\{[^}]*background:\s*var\(--surface\)/)
  assert.match(notificationCSS, /\.a12-notifications \.notification-row\.unread\s*\{[^}]*box-shadow:\s*inset 2px 0 0 var\(--brand\)/)
  assert.match(notificationCSS, /\.notification-row\.unread \.notification-dot\s*\{[^}]*background:\s*var\(--brand\)/)
  assert.match(notificationCSS, /\.a12-notifications \.notification-failure/)
  assert.match(notificationCSS, /\.a12-notifications \.notification-scroll:focus-visible/)
})

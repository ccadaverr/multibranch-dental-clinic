import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSignOutAttempt } from '../src/signout-control.js'

const file = name => readFileSync(name, 'utf8')
const contrast = (a, b) => {
  const lum = color => {
    const channels = color.match(/[a-f\d]{2}/gi).map(n => parseInt(n, 16) / 255)
    const weighted = channels.map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
    return .2126 * weighted[0] + .7152 * weighted[1] + .0722 * weighted[2]
  }
  const x = lum(a), y = lum(b)
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05)
}

test('sign-out stays pending until the actual logout promise settles, then completes once', async () => {
  const submit = createSignOutAttempt()
  const phases = []
  let resolveLogout
  let requests = 0
  const logout = () => { requests++; return new Promise(resolve => { resolveLogout = resolve }) }
  const first = submit(logout, phase => phases.push(phase))
  assert.deepEqual(phases, [{ pending: true, error: '', finished: false }])
  assert.equal(await submit(logout, phase => phases.push(phase)), false)
  assert.equal(requests, 1, 'double click must not send a second logout POST')
  resolveLogout()
  assert.equal(await first, true)
  assert.deepEqual(phases.at(-1), { pending: false, error: '', finished: true })
})

test('rejected logout keeps confirmation recoverable and allows a genuine retry', async () => {
  const submit = createSignOutAttempt()
  const phases = []
  assert.equal(await submit(async () => { throw Error('secret transport failure') }, phase => phases.push(phase)), false)
  assert.match(phases.at(-1).error, /could not finish/i)
  assert.doesNotMatch(phases.at(-1).error, /secret transport failure/)
  assert.equal(phases.at(-1).finished, false)
  assert.equal(await submit(async () => {}, phase => phases.push(phase)), true)
  assert.equal(phases.at(-1).finished, true)
})

test('all four roles go through the same busy sign-out confirmation with no early dismissal', () => {
  const shell = file('src/layout.jsx')
  const patient = file('src/patient/Portal.jsx')
  const components = file('src/components.jsx')
  for (const source of [shell, patient]) {
    assert.match(source, /createSignOutAttempt\(\)/)
    assert.match(source, /busy=\{signingOut\}/)
    assert.match(source, /busyLabel="Signing out…"/)
    assert.doesNotMatch(source, /setLogoutConfirmOpen\(false\);\s*onLogout\(\)/)
  }
  assert.match(components, /closeDisabled=\{busy\}/)
  assert.match(components, /<Button variant="ghost" disabled=\{busy\}/)
  assert.match(components, /loading=\{busy\}/)
  assert.match(components, /role="status" aria-live="polite"/)
  assert.match(components, /disabled=\{disabled\|\|loading\}/)
})

test('the shared control system changes action appearance, not role navigation and clinical statuses', () => {
  const css = file('src/action-system.css')
  const main = file('src/main.jsx')
  const site = file('src/pages/PublicSite.jsx')
  assert.match(main, /import '\.\/action-system\.css'/)
  assert.match(css, /\.btn\.primary/)
  assert.match(css, /\.lp-btn\.lp-btn-primary/)
  assert.match(css, /\.public-auth \.auth-card \.btn\.primary/)
  assert.match(css, /\.ui-retry/)
  assert.match(css, /\.btn-progress/)
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.doesNotMatch(css, /!important|filter:\s*blur|backdrop-filter|linear-gradient|@import/)
  assert.match(site, /aria-pressed=\{currentBranch\.id === branch\.id\}/)
  assert.match(site, /currentBranch\.id === branch\.id && <Icon name="check"/)
})

test('the selected clinic always has a readable dark foreground on its light background', () => {
  const css = file('src/action-system.css')
  const selected = css.match(/\.lp-site \.lp-branches \.lp-branch-picker button\[aria-pressed="true"\] \{([^}]+)\}/)?.[1]
  assert.ok(selected, 'selected clinic must have its own explicit state rule')
  assert.match(selected, /background:\s*#eaf3f9/)
  assert.match(selected, /color:\s*#173c58/)
  assert.ok(contrast('eaf3f9', '173c58') >= 7, 'selected clinic contrast must comfortably exceed WCAG AA')
  assert.match(css, /button:focus-visible/)
})

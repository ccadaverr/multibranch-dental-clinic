import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { accountPhoto, changeAccountPassword, updateAccountName } from '../src/api-client.js'

const read = filename => readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8')
const layout = read('src/layout.jsx')
const portal = read('src/patient/Portal.jsx')
const menu = read('src/components/AccountMenu.jsx')
const css = read('src/components/account-menu.css')
const routes = read('backend/routes/api.php')
const settings = read('backend/app/Http/Controllers/AccountSettingsController.php')
const photo = read('backend/app/Http/Controllers/AccountPhotoController.php')
const audit = read('src/pages/AuditTrail.jsx')

test('all four roles have the same footer account control, not redundant top/side identity cards', () => {
  assert.match(layout, /<AccountMenu accountId=\{session\?\.serverUserId\}/)
  assert.match(portal, /<AccountMenu accountId=\{me\?\.id\}/)
  assert.doesNotMatch(layout, /<div className="role-card"/)
  assert.doesNotMatch(layout, /<div className="top-user"/)
  assert.doesNotMatch(portal, /items: \[\['profile', 'user', 'Account'\]\]/)
  assert.match(menu, /owner: 'Owner \/ Admin', staff: 'Staff', dentist: 'Dentist', patient: 'Patient'/)
  assert.match(menu, /roleSubtitles = \{ owner: 'Branch oversight'/)
  assert.match(menu, /className="account-menu-role"/)
  assert.match(menu, /className="account-menu-subtitle"/)
  assert.match(menu, /onSignOut/)
  assert.match(menu, />Profile<\/button>/)
  assert.match(menu, /aria-expanded=\{open\}/)
  assert.match(menu, /event.key === 'Escape'/)
})

test('profile popover remains anchored above the lower sidebar and respects keyboard/touch and reduced motion', () => {
  assert.match(css, /position: absolute; z-index: 80; bottom: calc\(100% \+ 8px\)/)
  assert.match(css, /min-height: 44px/)
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /object-fit: cover/)
  assert.doesNotMatch(css, /linear-gradient|@import|backdrop-filter:\s*blur\(/)
})

test('all profile operations are authenticated actor-only and the audit trail includes name edits', () => {
  for (const path of ['/me/name', '/me/password/change', '/me/photo']) assert.ok(routes.includes(`'${path}'`))
  assert.match(settings, /Person::whereKey\(\$actor->person_id\)->lockForUpdate\(\)/)
  assert.match(settings, /expected_first_name/)
  assert.match(settings, /abort\(409/)
  assert.match(settings, /account\.profile_name\.updated/)
  assert.match(settings, /DB::transaction/)
  assert.match(settings, /Hash::check\(\$data\['current_password'\]/)
  assert.match(settings, /account\.password\.changed/)
  assert.match(routes, /Route::post\('\/me\/password', \[\\App\\Http\\Controllers\\Auth\\PasswordResetController::class, 'change'\]/)
  assert.match(menu, /requestPasswordReset\(current.email\)/)
  assert.match(menu, /patientPassword: changePatientPassword/)
  assert.match(read('src/profile-draft.js'), /role === 'patient'[\s\S]*?await actions\.patientPassword/)
  assert.match(menu, /otpRequested/)
  assert.match(audit, /Account name changes/)
  assert.match(audit, /account\.profile_name\.updated/)
  assert.doesNotMatch(settings, /["']person_id["']\s*=>\s*\$request/)
})

test('photo is stored privately for all four roles with strict input validation and no public disk URL', () => {
  assert.match(photo, /Storage::disk\('local'\)/)
  assert.match(photo, /account-photos\//)
  assert.match(photo, /Cache-Control' => 'private, no-store'/)
  assert.match(photo, /X-Content-Type-Options' => 'nosniff'/)
  assert.match(photo, /dimensions:max_width=3000,max_height=3000/)
  assert.match(photo, /account\.profile_photo\.updated/)
  assert.match(photo, /staff-photos\//)
  assert.doesNotMatch(read('src/patient/pages/Account.jsx'), /patient_avatar_|readAsDataURL|localStorage\.setItem/)
  assert.match(menu, /URL\.revokeObjectURL/)
  assert.match(menu, /result\.data\?\.id !== accountId/)
})

test('GET photo is private, abortable, and no photo returns null rather than fake image', async () => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    return { ok: false, status: 404 }
  }
  try {
    const ctrl = new AbortController()
    assert.deepEqual(await accountPhoto(ctrl.signal), { ok: true, blob: null })
    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/api/me/photo'))
    assert.equal(calls[0].options.method, 'GET')
    assert.equal(calls[0].options.credentials, 'include')
    assert.equal(calls[0].options.signal, ctrl.signal)
  } finally { globalThis.fetch = original }
})

test('profile name and password changes require CSRF and preserve the exact submitted fields', async () => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts })
    if (String(url).includes('/sanctum/csrf-cookie')) return { ok: true }
    return { ok: true, status: 200, json: async () => ({ data: { id: 'account-A', name: 'New Name', sign_in_required: true } }) }
  }
  try {
    const name = { first_name: 'New', last_name: 'Name', expected_first_name: 'Old', expected_last_name: 'Name' }
    const changed = await updateAccountName(name, () => true)
    assert.equal(changed.ok, true)
    const pw = { current_password: 'original-pass', password: 'NewPassw0rd!', password_confirmation: 'NewPassw0rd!' }
    assert.equal((await changeAccountPassword(pw, () => true)).ok, true)
    const commands = calls.filter(row => row.url.includes('/api/me/'))
    assert.equal(commands.length, 2)
    assert.equal(commands[0].opts.method, 'PATCH')
    assert.deepEqual(JSON.parse(commands[0].opts.body), name)
    assert.equal(commands[1].opts.method, 'POST')
    assert.ok(commands[1].url.endsWith('/api/me/password/change'))
    assert.deepEqual(JSON.parse(commands[1].opts.body), pw)
    assert.ok(calls.some(row => row.url.includes('/sanctum/csrf-cookie')))
  } finally { globalThis.fetch = original }
})

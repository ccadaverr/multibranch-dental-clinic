import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { commitProfileDraft, profileChangePlan, validateProfileDraft } from '../src/profile-draft.js'

const current = { id: 'user-1', role: 'patient', first_name: 'Demo', last_name: 'Patient', email: 'demo@example.test' }
const same = { first_name: 'Demo', last_name: 'Patient' }
const empty = { current_password: '', password: '', password_confirmation: '' }
const newPassword = { current_password: 'OldPassw0rd', password: 'NewPassw0rd', password_confirmation: 'NewPassw0rd' }
const input = (overrides = {}) => ({ current, fields: same, photoAction: 'keep', photoFile: null, password: empty, otp: '', otpRequested: false, role: 'patient', ...overrides })
const operations = () => {
  const calls = []
  const actions = {
    name: async payload => { calls.push(['name', payload]); return { ok: true, data: { ...current, first_name: payload.first_name, last_name: payload.last_name } } },
    photoUpload: async file => { calls.push(['photoUpload', file]); return { ok: true, data: { updated: true } } },
    photoRemove: async () => { calls.push(['photoRemove']); return { ok: true, data: { removed: true } } },
    password: async payload => { calls.push(['password', payload]); return { ok: true, data: { sign_in_required: true } } },
    patientPassword: async payload => { calls.push(['patientPassword', payload]); return { ok: true } },
  }
  return { actions, calls }
}

test('unchanged details are a clean draft; whitespace-only edits do not produce spurious Person updates', () => {
  assert.deepEqual(profileChangePlan(current, same, 'keep', empty), { name: false, photo: false, security: false, dirty: false, first: 'Demo', last: 'Patient' })
  assert.equal(profileChangePlan(current, { first_name: '  Demo ', last_name: 'Patient' }, 'keep', empty).dirty, false)
  assert.equal(profileChangePlan(current, { first_name: 'Demi', last_name: 'Patient' }, 'keep', empty).name, true)
  assert.equal(profileChangePlan({ ...current, first_name: 'Jo  Ann' }, { first_name: 'Jo  Ann', last_name: 'Patient' }, 'keep', empty).dirty, false)
})

test('changing photo is staged, not uploaded before Save; invalid photo blocks all writes', async () => {
  const badFile = { type: 'image/svg+xml', size: 50 }
  const { actions, calls } = operations()
  const result = await commitProfileDraft({ ...input({ fields: { first_name: 'Demi', last_name: 'Patient' }, photoAction: 'replace', photoFile: badFile }), isCurrent: () => true, actions })
  assert.equal(result.ok, false)
  assert.match(result.error, /JPG, PNG or WebP/)
  assert.equal(calls.length, 0)
})

test('a valid staged photo is committed once with a single Save action', async () => {
  const photoFile = { type: 'image/png', size: 4000 }
  const { actions, calls } = operations()
  const result = await commitProfileDraft({ ...input({ photoAction: 'replace', photoFile }), isCurrent: () => true, actions })
  assert.deepEqual(result, { ok: true, saved: ['Photo'] })
  assert.deepEqual(calls, [['photoUpload', photoFile]])
})

test('a removed photo invokes only the remove command', async () => {
  const { actions, calls } = operations()
  const result = await commitProfileDraft({ ...input({ photoAction: 'remove' }), isCurrent: () => true, actions })
  assert.deepEqual(result.saved, ['Photo'])
  assert.deepEqual(calls, [['photoRemove']])
})

test('name edits require a first/last name and length <= 80', () => {
  assert.match(validateProfileDraft(input({ fields: { first_name: '', last_name: 'Patient' } })).error, /first and last/)
  assert.match(validateProfileDraft(input({ fields: { first_name: 'X'.repeat(81), last_name: 'Patient' } })).error, /80/)
})

test('incomplete password blocks all writes, even if name or photo is valid', async () => {
  const { actions, calls } = operations()
  const result = await commitProfileDraft({ ...input({ fields: { first_name: 'Demi', last_name: 'Patient' }, password: { ...empty, password: 'NewPassw0rd' } }), isCurrent: () => true, actions })
  assert.equal(result.ok, false)
  assert.equal(calls.length, 0)
  assert.match(result.error, /all three/)
})

test('password mismatch and weak input fail before any operation', () => {
  assert.match(validateProfileDraft(input({ role: 'staff', password: { ...newPassword, password_confirmation: 'otherP4ss' } })).error, /match/)
  assert.match(validateProfileDraft(input({ role: 'staff', password: { ...newPassword, password: 'weakpass', password_confirmation: 'weakpass' } })).error, /letter and a number/)
})

test('Patient password still requires a requested and valid six-digit email code', () => {
  assert.match(validateProfileDraft(input({ password: newPassword })).error, /verification/)
  assert.match(validateProfileDraft(input({ password: newPassword, otpRequested: true, otp: '111' })).error, /verification/)
  assert.equal(validateProfileDraft(input({ password: newPassword, otpRequested: true, otp: '123456' })).error, null)
  assert.equal(validateProfileDraft(input({ role: 'dentist', password: newPassword })).error, null)
})

test('all changes commit in name -> photo -> password order; password last invalidates the session', async () => {
  const { actions, calls } = operations()
  const progress = []
  const result = await commitProfileDraft({ ...input({ fields: { first_name: 'Demi', last_name: 'Patient' }, photoAction: 'replace', photoFile: { type: 'image/webp', size: 1000 }, password: newPassword, otpRequested: true, otp: '135790' }), isCurrent: () => true, actions, onStep: (step, data) => progress.push([step, data?.first_name]) })
  assert.deepEqual(result, { ok: true, saved: ['Name', 'Photo', 'Password'] })
  assert.deepEqual(calls.map(([name]) => name), ['name', 'photoUpload', 'patientPassword'])
  assert.deepEqual(progress, [['name', 'Demi'], ['photo', undefined], ['password', undefined]])
  assert.equal(calls[0][1].expected_first_name, 'Demo')
  assert.equal(calls[2][1].otp, '135790')
})

test('Staff uses authenticated password change instead of the Patient OTP path', async () => {
  const { actions, calls } = operations()
  const result = await commitProfileDraft({ ...input({ role: 'staff', current: { ...current, role: 'staff' }, password: newPassword }), isCurrent: () => true, actions })
  assert.deepEqual(result.saved, ['Password'])
  assert.deepEqual(calls.map(([name]) => name), ['password'])
})

test('a failed photo upload leaves earlier name save visible and prevents password command', async () => {
  const { actions, calls } = operations()
  actions.photoUpload = async () => { calls.push(['photoUpload']); return { ok: false, message: 'Photo upload rejected.' } }
  const progress = []
  const result = await commitProfileDraft({ ...input({ fields: { first_name: 'Demi', last_name: 'Patient' }, photoAction: 'replace', photoFile: { type: 'image/jpeg', size: 2048 }, password: newPassword, otpRequested: true, otp: '123456' }), isCurrent: () => true, actions, onStep: step => progress.push(step) })
  assert.equal(result.ok, false)
  assert.deepEqual(result.saved, ['Name'])
  assert.deepEqual(calls.map(([name]) => name), ['name', 'photoUpload'])
  assert.deepEqual(progress, ['name'])
  assert.match(result.error, /Name saved/)
  assert.match(result.error, /Photo upload rejected/)
})

test('a failed password change reports earlier saves and never claims sign-out', async () => {
  const { actions } = operations()
  actions.patientPassword = async () => ({ ok: false, message: 'Wrong OTP.' })
  const result = await commitProfileDraft({ ...input({ fields: { first_name: 'Demi', last_name: 'Patient' }, password: newPassword, otpRequested: true, otp: '123456' }), isCurrent: () => true, actions })
  assert.equal(result.ok, false)
  assert.deepEqual(result.saved, ['Name'])
  assert.match(result.error, /Name saved.*Wrong OTP/)
})

test('unverified name identities fail closed before a photo/password write', async () => {
  const { actions, calls } = operations()
  actions.name = async () => { calls.push(['name']); return { ok: true, data: { ...current, id: 'wrong' } } }
  const result = await commitProfileDraft({ ...input({ fields: { first_name: 'Demi', last_name: 'Patient' }, photoAction: 'remove' }), isCurrent: () => true, actions })
  assert.equal(result.ok, false)
  assert.deepEqual(calls.map(([name]) => name), ['name'])
  assert.match(result.error, /could not be verified/)
})

test('revoked context fails closed before commands and after any asynchronous step', async () => {
  const { actions, calls } = operations()
  const first = await commitProfileDraft({ ...input({ photoAction: 'remove' }), isCurrent: () => false, actions })
  assert.equal(first.cancelled, true)
  assert.equal(calls.length, 0)
  let currentSession = true
  actions.name = async () => { currentSession = false; return { ok: true, data: current } }
  const second = await commitProfileDraft({ ...input({ fields: { first_name: 'Demi', last_name: 'Patient' }, photoAction: 'remove' }), isCurrent: () => currentSession, actions })
  assert.equal(second.cancelled, true)
  assert.equal(calls.length, 0)
})

test('source exposes one Save button and guarded X/escape/backdrop confirmation for all four roles', () => {
  const ui = readFileSync(new URL('../src/components/AccountMenu.jsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/components/account-menu.css', import.meta.url), 'utf8')
  assert.match(ui, /const requestClose = \(\) =>/)
  assert.match(ui, /editor\.current\?\.isDirty\(\)/)
  assert.match(ui, /onClose=\{requestClose\}/)
  for (const label of ['Save your changes?', 'Keep editing', 'Discard changes', 'Save changes', 'Personal details', 'Password & security']) assert.ok(ui.includes(label))
  assert.doesNotMatch(ui, /Save name|Upload photo|Change password<\/Button>/)
  assert.match(ui, /<form className="account-editor" onSubmit=\{submit\} noValidate>/)
  assert.match(ui, /<Button type="submit" disabled=\{!!busy \|\| !plan\.dirty\}/)
  assert.match(ui, /setPhotoAction\('replace'\)/)
  assert.match(ui, /photoOverride=\{photoAction/)
  assert.match(ui, /requestPasswordReset\(current.email\)/)
  assert.match(css, /position: sticky; bottom: 0/)
  assert.match(css, /@media \(max-width: 550px\)/)
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.doesNotMatch(css, /linear-gradient|@import/)
})

test('image dimension check accepts valid images and rejects oversized or corrupt photos', async () => {
  const { validateProfilePhotoDimensions } = await import('../src/profile-draft.js')
  let closed = 0
  assert.equal(await validateProfilePhotoDimensions({}, async () => ({ width: 1200, height: 1800, close: () => closed++ })), null)
  assert.match(await validateProfilePhotoDimensions({}, async () => ({ width: 3200, height: 800, close: () => closed++ })), /3000/)
  assert.match(await validateProfilePhotoDimensions({}, async () => { throw Error('bad bitmap') }), /could not be opened/)
  assert.equal(closed, 2)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { documentationPayload } from '../src/treatments-api.js'

const page = readFileSync(new URL('../src/pages/EncounterWorkspace.jsx', import.meta.url), 'utf8')
const helpers = ['FOLLOWUP_REASONS', 'savedFollowupReasonOther', 'followupReasonOption', 'chooseFollowupReason', 'missingFollowupReason']
  .map(name => {
    const declaration = page.match(new RegExp(`^const ${name} = .+$`, 'm'))?.[0]
    assert.ok(declaration, `${name} is present`)
    return declaration
  })
const { savedFollowupReasonOther, followupReasonOption, chooseFollowupReason, missingFollowupReason } = runInNewContext(
  `${helpers.join(';')}; ({ savedFollowupReasonOther, followupReasonOption, chooseFollowupReason, missingFollowupReason })`
)

test('GEN-07: follow-up Other stays selected while its custom reason changes', () => {
  let form = { followupRequired: true, followupReason: '', followupReasonOther: false }
  assert.equal(followupReasonOption(form), '')
  assert.equal(missingFollowupReason(form), true)

  form = chooseFollowupReason(form, 'Other')
  assert.equal(followupReasonOption(form), 'Other')
  assert.equal(missingFollowupReason(form), true)
  form = { ...form, followupReason: '   ' }
  assert.equal(followupReasonOption(form), 'Other')
  assert.equal(missingFollowupReason(form), true)
  form = { ...form, followupReason: 'Review healing', followupDate: '2026-10-29' }
  assert.equal(followupReasonOption(form), 'Other')
  assert.equal(missingFollowupReason(form), false)

  form = chooseFollowupReason(form, 'Suture Removal')
  assert.equal(followupReasonOption(form), 'Suture Removal')
  assert.equal(form.followupReasonOther, false)
  assert.equal(form.followupReason, 'Suture Removal')
  assert.equal(missingFollowupReason(form), false)
})

test('GEN-07: saved custom reason remains editable and UI state stays out of the treatment payload', () => {
  assert.equal(savedFollowupReasonOther('Review healing'), true)
  assert.equal(savedFollowupReasonOther('Post-Op Check'), false)
  const form = { followupRequired: true, followupReason: 'Review healing', followupReasonOther: savedFollowupReasonOther('Review healing'), procedures: [] }
  assert.equal(followupReasonOption(form), 'Other')
  const payload = documentationPayload(form)
  assert.equal(payload.followup_reason, 'Review healing')
  assert.equal(Object.hasOwn(payload, 'followupReasonOther'), false)
  assert.match(page, /followupReasonOther:savedFollowupReasonOther\(t\?\.followupReason\)/)
  assert.match(page, /value=\{followupReasonOption\(form\)\}/)
  assert.match(page, /onChange=\{e => setForm\(chooseFollowupReason\(form,e\.target\.value\)\)\}/)
  assert.match(page, /\{form\.followupReasonOther && \(/)
  assert.match(page, /disabled=\{saving\|\|!canStart\|\|followupReasonMissing\|\|!fresh\}/)
  assert.match(page, /disabled=\{saving\|\|!dirty\|\|newer\|\|followupReasonMissing\|\|!fresh\}/)
  assert.match(page, /disabled=\{saving\|\|dirty\|\|newer\|\|followupReasonMissing\|\|!fresh\}/)
})

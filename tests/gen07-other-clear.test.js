import test from 'node:test'
import assert from 'node:assert/strict'
import { choiceHandler } from './support/jsx-choice-handler.js'

test('GEN-07: patient cancellation clears a hidden custom reason when leaving Other', () => {
  let reason = 'Other', detail = 'Earlier custom reason', error = 'Earlier error'
  const change = choiceHandler('src/patient/pages/Visits.jsx', 'reason', {
    setReason: value => { reason = value },
    setCustomReason: value => { detail = value },
    setError: value => { error = value },
  })
  change({ target: { value: 'Other' } })
  assert.equal(detail, 'Earlier custom reason')
  change({ target: { value: 'Schedule conflict' } })
  assert.equal(reason, 'Schedule conflict')
  assert.equal(detail, '')
  assert.equal(error, '')
  change({ target: { value: 'Other' } })
  assert.equal(detail, '')
})

test('GEN-07: staff follow-up clears a hidden custom reason when leaving Other', () => {
  let category = 'Other', detail = 'Earlier clinical reason', touched = true
  const change = choiceHandler('src/pages/ServerFollowups.jsx', 'reasonCategory', {
    setOtherTouched: value => { touched = value },
    setReasonCategory: value => { category = value },
    setCustomReason: value => { detail = value },
  })
  change({ target: { value: 'Other' } })
  assert.equal(detail, 'Earlier clinical reason')
  assert.equal(touched, false)
  change({ target: { value: 'Suture Removal' } })
  assert.equal(category, 'Suture Removal')
  assert.equal(detail, '')
  change({ target: { value: 'Other' } })
  assert.equal(detail, '')
})

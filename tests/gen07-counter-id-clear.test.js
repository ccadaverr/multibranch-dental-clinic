import test from 'node:test'
import assert from 'node:assert/strict'
import { choiceHandler } from './support/jsx-choice-handler.js'

test('STF-04 / GEN-07: counter confirmation clears Other ID detail on ordinary ID selection', () => {
  let type = 'other', detail = 'Company ID', touched = true
  const change = choiceHandler('src/pages/CounterIntake.jsx', 'idType', {
    setIdOtherTouched: value => { touched = value },
    setIdType: value => { type = value },
    setIdOther: value => { detail = value },
  })
  change({ target: { value: 'other' } })
  assert.equal(detail, 'Company ID')
  assert.equal(touched, false)
  change({ target: { value: 'philid' } })
  assert.equal(type, 'philid')
  assert.equal(detail, '')
  change({ target: { value: 'other' } })
  assert.equal(detail, '')
})

test('STF-04 / GEN-07: patient-record ID check clears Other detail on ordinary ID selection', () => {
  let type = 'other', detail = 'School ID', touched = true, failure = 'Earlier error'
  const change = choiceHandler('src/pages/CounterIntake.jsx', 'type', {
    setOtherTouched: value => { touched = value },
    setFailure: value => { failure = value },
    setType: value => { type = value },
    setOtherText: value => { detail = value },
  })
  change({ target: { value: 'other' } })
  assert.equal(detail, 'School ID')
  assert.equal(touched, false)
  assert.equal(failure, null)
  change({ target: { value: 'passport' } })
  assert.equal(type, 'passport')
  assert.equal(detail, '')
  change({ target: { value: 'other' } })
  assert.equal(detail, '')
})

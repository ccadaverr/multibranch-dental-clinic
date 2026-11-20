import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CALENDAR_CAPACITY_TIMEOUT_MS,
  DUTY_READ_BUDGET_MS,
  calendarCapacityIsComplete,
} from '../src/read-performance.js'

const dates = ['2026-11-02', '2026-11-03']
const branch = { id: 'b1', name: 'Synthetic Branch', closed: false, reason: null, partial_hours: null,
  appointments: 1, booked_minutes: 30, capacity_minutes: 120, percent: 25 }
const response = () => ({
  branches: [{ id: 'b1', name: 'Synthetic Branch' }],
  crowded_percent: 80,
  capacity_estimated: false,
  capacity_note: null,
  days: dates.map(date => ({ date, branches: [{ ...branch }], closed: false,
    appointments: 1, booked_minutes: 30, capacity_minutes: 120, percent: 25, crowded: false })),
})

test('DW-02 uses the agreed hard read budget of two seconds', () => {
  assert.equal(DUTY_READ_BUDGET_MS, 2000)
})

test('DW-10 capacity wait is finite and independent from the DW-02 duty budget', () => {
  assert.equal(CALENDAR_CAPACITY_TIMEOUT_MS, 15000)
  assert.notEqual(CALENDAR_CAPACITY_TIMEOUT_MS, DUTY_READ_BUDGET_MS)
})

test('DW-10 accepts a complete, date-ordered capacity projection', () => {
  assert.equal(calendarCapacityIsComplete(response(), dates), true)
  assert.equal(calendarCapacityIsComplete(response(), dates, 'b1'), true)
})

test('DW-10 rejects a missing, extra, reordered, or wrong-date day', () => {
  const missing = response(); missing.days.pop()
  const extra = response(); extra.days.push({ ...extra.days[1], date: '2026-11-04' })
  const reordered = response(); reordered.days.reverse()
  const wrongDate = response(); wrongDate.days[0].date = '2026-11-04'
  for (const candidate of [missing, extra, reordered, wrongDate]) {
    assert.equal(calendarCapacityIsComplete(candidate, dates), false)
  }
})

test('DW-10 rejects incomplete branch projections and duplicate branch identities', () => {
  const missingBranch = response(); missingBranch.days[0].branches = []
  const extraBranch = response(); extraBranch.days[0].branches.push({ ...branch, id: 'b2' })
  const duplicateTopLevel = response(); duplicateTopLevel.branches.push({ id: 'b1', name: 'Duplicate' })
  const inconsistentDay = response(); inconsistentDay.days[1].branches[0].id = 'b2'
  for (const candidate of [missingBranch, extraBranch, duplicateTopLevel, inconsistentDay]) {
    assert.equal(calendarCapacityIsComplete(candidate, dates), false)
  }
})

test('DW-10 refuses a response for a different selected branch', () => {
  assert.equal(calendarCapacityIsComplete(response(), dates, 'b2'), false)
})

test('DW-10 rejects malformed metrics instead of painting them as valid capacity', () => {
  const malformed = response(); malformed.days[0].capacity_minutes = '120'
  const malformedPercent = response(); malformedPercent.days[0].percent = '25'
  const missingThreshold = response(); delete missingThreshold.crowded_percent
  const missingCapacityStatus = response(); delete missingCapacityStatus.capacity_estimated
  for (const candidate of [malformed, malformedPercent, missingThreshold, missingCapacityStatus]) {
    assert.equal(calendarCapacityIsComplete(candidate, dates), false)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmedStaffShift, staffShiftCommand } from '../src/staff-shift-command.js'

const staff = { id: 's1', branchRef: 'b1', revision: 'a'.repeat(64) }
const operation = '11111111-1111-4111-8111-111111111111'
const command = staffShiftCommand(staff, '09:00', '17:00', 'b1', operation)
const receipt = { ok: true, data: { id: 's1', branchId: 'b1', shiftStart: '09:00:00', shiftEnd: '17:00:00', revision: 'b'.repeat(64) }, meta: { operation_id: operation, replayed: false } }

test('shift command binds the observed revision and operation without rewriting branch assignment', () => {
  assert.deepEqual(command, { shift_start: '09:00', shift_end: '17:00', expected_revision: staff.revision, operation_id: operation })
  assert.equal(staffShiftCommand(staff, '09:00', '17:00', 'b2', operation).branch_ref, 'b2')
  for (const revision of [undefined, '', 1, 'invalid']) assert.throws(() => staffShiftCommand({ ...staff, revision }, '09:00', '17:00', 'b1', operation))
})

test('success requires exact Staff, assignment, interval, revision and command receipt', () => {
  assert.equal(confirmedStaffShift(receipt, 's1', command, 'b1'), true)
  for (const patch of [{ id: 's2' }, { branchId: 'b2' }, { shiftStart: '10:00' }, { shiftEnd: '18:00' }, { revision: null }]) {
    assert.equal(confirmedStaffShift({ ...receipt, data: { ...receipt.data, ...patch } }, 's1', command, 'b1'), false)
  }
  assert.equal(confirmedStaffShift({ ...receipt, meta: { ...receipt.meta, operation_id: 'other' } }, 's1', command, 'b1'), false)
  assert.equal(confirmedStaffShift({ ...receipt, meta: undefined }, 's1', command, 'b1'), false)
  assert.equal(confirmedStaffShift({ ...receipt, meta: { ...receipt.meta, replayed: true } }, 's1', command, 'b1'), true)
})

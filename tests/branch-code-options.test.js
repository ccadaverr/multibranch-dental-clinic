import test from 'node:test'
import assert from 'node:assert/strict'
import { BRANCH_CODE_OPTIONS, isAllowedBranchCode } from '../src/branch-codes.js'

test('branch selections accept catalog values and only the same existing legacy code', () => {
  for (const code of BRANCH_CODE_OPTIONS) assert.equal(isAllowedBranchCode(code, 'EXISTING-LEGACY'), true)
  assert.equal(isAllowedBranchCode('EXISTING-LEGACY', 'EXISTING-LEGACY'), true)
  for (const code of ['NOT-AN-ALLOWED-CODE', 'EXISTING-LEGACY', 'brc-a', ' BRC-A ', '', null, 42, ['BRC-C']]) {
    assert.equal(isAllowedBranchCode(code, 'BRC-A'), false)
  }
  assert.equal(Object.isFrozen(BRANCH_CODE_OPTIONS), true)
})

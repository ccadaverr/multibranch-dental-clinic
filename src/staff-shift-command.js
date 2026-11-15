// Flat profile commands only. No weekday recurrence, attendance or dated duty is inferred here.
export const validStaffRevision = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

export function staffShiftCommand(staff, start, end, branch, operationId) {
  if (!validStaffRevision(staff.revision)) throw new Error('Refresh Staff profiles before editing. Safe shift updates are unavailable in this session.')
  const payload = { shift_start: start, shift_end: end, expected_revision: staff.revision, operation_id: operationId }
  // An unchanged assignment must never be sent as a new authorization instruction.
  if (branch && branch !== staff.branchRef) payload.branch_ref = branch
  return payload
}

export function confirmedStaffShift(result, id, payload, originalBranch) {
  const saved = result?.data
  const time = value => typeof value === 'string' ? value.slice(0, 5) : ''
  return result?.ok === true && saved?.id === id && validStaffRevision(saved.revision) &&
    result.meta?.operation_id === payload.operation_id && typeof result.meta?.replayed === 'boolean' &&
    time(saved.shiftStart) === payload.shift_start && time(saved.shiftEnd) === payload.shift_end &&
    (saved.branchId || '') === (payload.branch_ref ?? originalBranch)
}

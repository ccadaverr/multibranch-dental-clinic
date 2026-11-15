export function validRosterDraft(row, staffRef, date) {
  return !!row && typeof row.id==='string' && row.id.trim()!=='' && row.staff_ref===staffRef && row.date===date &&
    typeof row.branch_ref==='string' && !!row.branch_ref && row.status==='Draft' && row.published===false &&
    Number.isSafeInteger(row.revision) && row.revision>0 && /^([01]\d|2[0-3]):[0-5]\d$/.test(row.start_time) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(row.end_time) && row.start_time<row.end_time
}

export function rosterDraftReceipt(result, staffRef, payload) {
  const row=result?.data
  return result?.ok===true && validRosterDraft(row,staffRef,payload.date) && row.branch_ref===payload.branch_ref &&
    row.start_time===payload.start_time && row.end_time===payload.end_time && row.revision===payload.expected_revision+1 &&
    result.meta?.operation_id===payload.operation_id && typeof result.meta?.replayed==='boolean' && result.meta.publication_available===false
}

const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)
const dutyTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
export function validStaffDuty(row, staff, branch, date) {
  return row?.staff_ref === staff && row.branch_ref === branch && row.date === date &&
    Array.isArray(row.windows) && Array.isArray(row.approved_leave) && row.available === (row.windows.length > 0) &&
    row.windows.every(window => dutyTime(window?.start_time) && dutyTime(window.end_time) && window.start_time < window.end_time &&
      typeof window.publication_id === 'string' && !!window.publication_id && Number.isSafeInteger(window.revision) && window.revision > 0)
}
export function validRoster(row,staff,date) {
  return row?.staff_ref===staff && row.date===date && typeof row.id==='string' && !!row.id &&
    Number.isSafeInteger(row.revision)&&row.revision>0&&['Draft','Pending','Approved','Published'].includes(row.status)&&
    row.published===(row.status==='Published')&&typeof row.branch_ref==='string'&&!!row.branch_ref&&
    ['weekly','custom_hours','day_off'].includes(row.kind)&&Array.isArray(row.weekdays)&&Array.isArray(row.exceptions)
}
export function confirmedRoster(result,staff,command) {
  const row=result.data,body=command.body
  if(!result.ok||!validRoster(row,staff,body.date)||result.meta?.operation_id!==body.operation_id||typeof result.meta.replayed!=='boolean'||row.revision!==body.expected_revision+1)return false
  if(command.action!=='save')return row.id===command.reviewed?.id && row.branch_ref===command.reviewed?.branch_ref && row.status===(command.action==='approve'?'Approved':'Published') && (command.action!=='publish'||typeof row.publication_id==='string'&&!!row.publication_id&&row.published_revision===row.revision)
  return ['Draft','Pending'].includes(row.status)&&['branch_ref','kind','effective_from','effective_until','start_time','end_time'].every(k=>(row[k]??null)===(body[k]??null))&&canonical(row.weekdays)===canonical(body.weekdays)&&canonical(row.exceptions)===canonical(body.exceptions)
}

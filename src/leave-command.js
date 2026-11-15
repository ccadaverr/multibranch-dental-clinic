import { addDays } from './clock.js'

export const validLeaveRevision=value=>Number.isSafeInteger(value)&&value>0
export function confirmedLeaveCommand(command,result) {
  const row=result?.data,body=command.body
  if(!result?.ok||!row?.id||!validLeaveRevision(row.revision)||row.revision!==body.expected_revision+1||
    result.meta?.operation_id!==body.operation_id||typeof result.meta?.replayed!=='boolean')return false
  const status={create:'Pending',approve:'Approved',decline:'Declined',cancel:'Cancelled'}[command.action]
  if(row.status!==status||(command.action!=='create'&&row.id!==command.id))return false
  if(command.action!=='create')return true
  const start=`${body.start_date}T${body.start_time||'00:00'}:00+08:00`
  const end=`${body.end_time?body.end_date:addDays(body.end_date,1)}T${body.end_time||'00:00'}:00+08:00`
  return row.type===body.type&&row.starts_at===start&&row.ends_at===end&&(row.private_note||null)===(body.private_note||null)
}

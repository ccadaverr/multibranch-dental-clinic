import { dutyProjection } from './work-hours-duty.js'

// Owner personnel presentation consumes the established Doctor projection, never flat availability.
export function personnelDutyRows(duty, dentistId, branchIds, today) {
  if (!Array.isArray(branchIds) || !branchIds.length || new Set(branchIds).size !== branchIds.length) return []
  const projection = dutyProjection(duty, today, branchIds)
  if (!projection) return []
  return branchIds.map(branchId => {
    const row = projection.rows.find(row => row.dentist_id === dentistId && row.branch_id === branchId)
    return { branchId, branchName: row?.branch_name, status: row ? row.on_duty_today ? 'on' : 'off' : 'unknown', estimated: row?.estimated === true }
  })
}

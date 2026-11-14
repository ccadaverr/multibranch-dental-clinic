import { clinicDateAt } from './clock.js'

// Presentation only. The work-schedule API's dated, branch-scoped projection is authoritative.
export function dutyForBranch(duty, dentistId, branchId, today) {
  if (duty?.date !== today || !Array.isArray(duty?.rows)) return 'unknown'
  const matches = duty.rows.filter(item => item?.dentist_id === dentistId && item?.branch_id === branchId)
  const row = matches.length === 1 ? matches[0] : null
  return row?.on_duty_today === true ? 'on' : row?.on_duty_today === false ? 'off' : 'unknown'
}

// Validate the existing server projection; never infer duty from profile availability.
export function dutyProjection(duty, today, scopes) {
  if (!Array.isArray(scopes) || duty?.date !== today || typeof duty.as_of !== 'string' || clinicDateAt(duty.as_of) !== today || !Array.isArray(duty.rows)) return null
  const seen = new Set(), rows = []
  for (const row of duty.rows) {
    if (!row || ![row.dentist_id,row.branch_id].every(x => typeof x === 'string' && x.trim())) return null
    if (!scopes.includes(row.branch_id)) continue
    const key = JSON.stringify([row.dentist_id, row.branch_id])
    if (![row.dentist_id, row.branch_id, row.dentist_name, row.branch_name].every(x => typeof x === 'string' && x.trim()) || seen.has(key) ||
      typeof row.on_duty_today !== 'boolean' || typeof row.working_now !== 'boolean' || typeof row.estimated !== 'boolean' ||
      !Number.isSafeInteger(row.working_minutes) || row.working_minutes < 0 || row.working_minutes > 1440 ||
      row.on_duty_today !== (row.working_minutes > 0) || row.working_now && !row.on_duty_today) return null
    seen.add(key); rows.push(row)
  }
  return { date: duty.date, as_of: duty.as_of, rows }
}

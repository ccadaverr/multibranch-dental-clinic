/**
 * Read-only performance budgets and response-shape guards for Staff scheduling views.
 * These limits bound UI waiting; they do not replace server-side authorization or
 * prove a production latency SLA. Actual response time is measured in the browser.
 */
export const DUTY_READ_BUDGET_MS = 2_000
export const CALENDAR_CAPACITY_TIMEOUT_MS = 15_000

const nonNegativeInteger = value => Number.isSafeInteger(value) && value >= 0
const nullableNonNegativeInteger = value => value === null || nonNegativeInteger(value)

/**
 * A calendar-capacity response is usable only when every requested clinic date
 * and every returned branch is represented exactly once. This prevents a partial
 * payload from being painted as a complete month or from leaving stale capacity
 * bands visible after a branch/month change.
 */
export function calendarCapacityIsComplete(data, expectedDates, selectedBranch = null) {
  if (!data || !Array.isArray(expectedDates) || !expectedDates.length ||
      !Array.isArray(data.days) || !Array.isArray(data.branches) ||
      !Number.isSafeInteger(data.crowded_percent) || data.crowded_percent <= 0 ||
      typeof data.capacity_estimated !== 'boolean') return false

  const branchIds = data.branches.map(branch => branch?.id)
  if (!branchIds.length || data.branches.some(branch => typeof branch?.name !== 'string') ||
      branchIds.some(id => typeof id !== 'string' || !id.trim()) ||
      new Set(branchIds).size !== branchIds.length) return false
  if (selectedBranch && (branchIds.length !== 1 || branchIds[0] !== selectedBranch)) return false
  if (data.days.length !== expectedDates.length) return false

  return data.days.every((day, index) => {
    if (!day || day.date !== expectedDates[index] || typeof day.closed !== 'boolean' ||
        typeof day.crowded !== 'boolean' || !nonNegativeInteger(day.appointments) ||
        !nonNegativeInteger(day.booked_minutes) || !nonNegativeInteger(day.capacity_minutes) ||
        !nullableNonNegativeInteger(day.percent) || !Array.isArray(day.branches) ||
        day.branches.length !== branchIds.length) return false

    return day.branches.every((branch, branchIndex) =>
      branch && branch.id === branchIds[branchIndex] && typeof branch.name === 'string' &&
      typeof branch.closed === 'boolean' && nonNegativeInteger(branch.appointments) &&
      nonNegativeInteger(branch.booked_minutes) && nonNegativeInteger(branch.capacity_minutes) &&
      nullableNonNegativeInteger(branch.percent)
    )
  })
}

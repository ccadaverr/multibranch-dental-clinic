// Module 21: Operational Analytics & Executive Intelligence API
import * as api from './api-client.js'
import { normalizeFailure } from './appointments-api.js'
import { clinicDate, validDate } from './clock.js'
import { requestClinicCsv, saveClinicCsv } from './clinic-csv.js'

export { saveClinicCsv }

export async function fetchExecutiveSummary(params = {}, { signal } = {}) {
  const res = await api.getExecutiveSummary(params, { signal })
  if (!res.ok) throw normalizeFailure(res)
  return res.data
}

export async function fetchBranchPerformance(params = {}) {
  const res = await api.getBranchPerformance(params)
  if (!res.ok) throw normalizeFailure(res)
  return res.data
}

export async function fetchDailyRevenue(params = {}, { signal } = {}) {
  const res = await api.getDailyRevenue(params, { signal })
  if (!res.ok) throw normalizeFailure(res)
  return res.data
}

export async function fetchWeeklyRevenueHistogram(params = {}, { signal } = {}) {
  const res = await api.getWeeklyRevenueHistogram(params, { signal })
  if (!res.ok) throw normalizeFailure(res)
  return res.data
}

export async function requestAnalyticsCsv(params, { signal } = {}) {
  const { branch_id: branchId, period, date_from: from, date_to: to } = params ?? {}
  const hasDates = from != null || to != null
  const validPeriod = hasDates ? validDate(from) && validDate(to) && from <= to : typeof period === 'string' && !!period.trim()
  if (typeof branchId !== 'string' || !branchId || branchId !== branchId.trim() || !validPeriod) {
    throw new Error('Choose a report branch and valid dates or period before exporting.')
  }
  const result = await requestClinicCsv('/api/analytics/export', params, {
    signal,
    fallbackFilename: `operational-analytics-${clinicDate()}.csv`,
    failureMessage: 'Failed to export analytics report.',
  })
  if (result.blob.size === 0) throw new Error('The report file was empty. Try again.')
  return result
}

// Compatibility for the existing AnalyticsPage consumer. The new requester requires explicit scope.
export async function downloadAnalyticsCsv(params = {}, isCurrent = () => true) {
  if (!isCurrent()) return false
  let result
  try {
    result = await requestAnalyticsCsv({ ...params, branch_id: params.branch_id === null ? 'all' : params.branch_id })
  } catch (error) {
    if (!isCurrent()) return false
    throw error
  }
  if (!isCurrent()) return false
  saveClinicCsv(result)
  return true
}

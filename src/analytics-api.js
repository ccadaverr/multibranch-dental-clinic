// Module 21: Operational Analytics & Executive Intelligence API
import * as api from './api-client.js'
import { normalizeFailure } from './appointments-api.js'
import { clinicDate } from './clock.js'
import { requestClinicCsv, saveClinicCsv } from './clinic-csv.js'

export { saveClinicCsv }

export async function fetchExecutiveSummary(params = {}) {
  const res = await api.getExecutiveSummary(params)
  if (!res.ok) throw normalizeFailure(res)
  return res.data
}

export async function fetchBranchPerformance(params = {}) {
  const res = await api.getBranchPerformance(params)
  if (!res.ok) throw normalizeFailure(res)
  return res.data
}

export async function fetchDailyRevenue(params = {}) {
  const res = await api.getDailyRevenue(params)
  if (!res.ok) throw normalizeFailure(res)
  return res.data
}

export async function fetchWeeklyRevenueHistogram(params = {}) {
  const res = await api.getWeeklyRevenueHistogram(params)
  if (!res.ok) throw normalizeFailure(res)
  return res.data
}

export async function requestAnalyticsCsv(params, { signal } = {}) {
  const { branch_id: branchId, period } = params ?? {}
  if (typeof branchId !== 'string' || !branchId || branchId !== branchId.trim() || typeof period !== 'string' || !period.trim()) {
    throw new Error('Choose a report branch and period before exporting.')
  }
  return requestClinicCsv('/api/analytics/export', params, {
    signal,
    fallbackFilename: `operational-analytics-${clinicDate()}.csv`,
    failureMessage: 'Failed to export analytics report.',
  })
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

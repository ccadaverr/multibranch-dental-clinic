// Module 21: Operational Analytics & Executive Intelligence API
import * as api from './api-client.js'
import { normalizeFailure } from './appointments-api.js'
import { clinicDate } from './clock.js'

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

export async function downloadAnalyticsCsv(params = {}) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const url = `${api.apiBase()}/api/analytics/export${query ? `?${query}` : ''}`

  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) {
    throw new Error(res.status === 403 ? 'Analytics export is restricted to the clinic Owner.' : 'Failed to export analytics report.')
  }

  const contentType = res.headers?.get?.('Content-Type') || ''
  if (!/^text\/csv(?:\s*;|$)/i.test(contentType)) {
    throw new Error('The clinic server did not return a CSV file.')
  }
  const blob = await res.blob()
  const blobUrl = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = `operational-analytics-${clinicDate()}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(blobUrl)
}

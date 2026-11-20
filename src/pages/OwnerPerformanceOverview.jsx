import React, { useEffect, useState } from 'react'
import { Button, Notice } from '../components.jsx'
import { fetchDailyRevenue, fetchExecutiveSummary } from '../analytics-api.js'
import { startHomeRead, HomeReadDeadlineError } from '../home-read-deadline.js'
import { exactPeso, last30DayWindows, performanceChange, pesoCentavos, validateRevenueReport, validateRevenueScope } from '../owner-revenue-data.js'

function Growth({ current, previous }) {
  const change = performanceChange(current, previous)
  const direction = { up: 'increase', down: 'decrease', flat: 'no change', none: 'no comparable baseline' }[change.direction]
  return <span className={`owner-growth is-${change.direction}`} aria-label={`${change.text}, ${direction}, vs previous 30 days`}>
    <span aria-hidden="true">{{up:'↗',down:'↘',flat:'—',none:'—'}[change.direction]}</span> {change.text}
  </span>
}

function OverviewResource({ branchId, windows, refreshKey }) {
  const [state, setState] = useState({ loading: true })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setState({ loading: true })
    const current = { ...windows.current, branch_id: branchId }
    const previous = { ...windows.previous, branch_id: branchId }
    const task = startHomeRead(signal => Promise.all([
      fetchDailyRevenue(current, { signal }), fetchDailyRevenue(previous, { signal }),
      fetchExecutiveSummary(current, { signal }), fetchExecutiveSummary(previous, { signal }),
    ]), { timeoutMs: 12000, timeoutMessage: 'The performance overview took too long to load.' })
    task.response.then(([now, before, summary, priorSummary]) => {
      validateRevenueScope(validateRevenueReport(now, false, current), branchId)
      validateRevenueScope(validateRevenueReport(before, false, previous), branchId)
      validateRevenueScope(summary, branchId); validateRevenueScope(priorSummary, branchId)
      const visits = summary?.patient_flow?.total_visits
      const priorVisits = priorSummary?.patient_flow?.total_visits
      if (![visits, priorVisits].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Visit figures unavailable.')
      const outstanding = summary?.financials?.outstanding_balance_php
      pesoCentavos(outstanding)
      if (active) setState({ now: now.totals.gross_collected_php, before: before.totals.gross_collected_php, visits, priorVisits, outstanding })
    }).catch(error => {
      if (active) setState({ error: error instanceof HomeReadDeadlineError
        ? 'The overview took too long to load. Retry to retrieve current figures.'
        : 'The requested figures could not be verified. No values are shown.' })
    })
    return () => { active = false; task.cancel() }
  }, [retry, refreshKey, branchId, windows.current.date_from, windows.current.date_to, windows.previous.date_from, windows.previous.date_to])
  if (state.error) return <Notice tone="warning" title="Performance overview unavailable">{state.error} <Button size="sm" onClick={() => setRetry(n => n + 1)}>Retry overview</Button></Notice>
  if (state.loading) return <div className="owner-kpi-grid" role="status" aria-busy="true" aria-label="Loading 30-day performance">
    {['Gross Collections', 'Patient Visits', 'Outstanding Balance'].map(label => <div className="owner-kpi owner-kpi-placeholder" key={label}><span>{label}</span><div className="owner-kpi-skeleton" aria-hidden="true"/><p>Loading…</p></div>)}
  </div>
  return <div className="owner-kpi-grid">
    <article className="owner-kpi" aria-label="Gross Collections performance"><h3>Gross Collections</h3>
      <div className="owner-kpi-value"><strong>{exactPeso(state.now)}</strong><Growth current={pesoCentavos(state.now)} previous={pesoCentavos(state.before)}/></div>
      <p>vs previous 30 days: {exactPeso(state.before)}</p><small>Collected by payment date, before refunds.</small>
    </article>
    <article className="owner-kpi" aria-label="Patient Visits performance"><h3>Patient Visits</h3>
      <div className="owner-kpi-value"><strong>{state.visits.toLocaleString('en-PH')}</strong><Growth current={BigInt(state.visits)} previous={BigInt(state.priorVisits)}/></div>
      <p>vs previous 30 days: {state.priorVisits.toLocaleString('en-PH')}</p><small>Recorded arrivals; repeat visits count separately.</small>
    </article>
    <article className="owner-kpi" aria-label="Outstanding Balance scope"><h3>Outstanding Balance</h3>
      <div className="owner-kpi-value"><strong>{exactPeso(state.outstanding)}</strong></div>
      <p>Issued invoices created in this 30-day window.</p><small>Current unpaid amounts, not a historical debt snapshot. No comparison badge.</small>
    </article>
  </div>
}

export function OwnerPerformanceOverview({ branchId, branchName, today }) {
  const windows = last30DayWindows(today)
  const [refreshKey, setRefreshKey] = useState(0)
  return <section className="owner-performance" aria-label="Last 30 Days performance overview">
    <div className="owner-performance-heading"><div><span className="owner-revenue-eyebrow">Performance overview · fixed window</span><h2>Last 30 Days</h2></div>
      <div className="owner-period-actions"><span className="owner-period-chip">{windows.current.date_from} – {windows.current.date_to} · Asia/Manila</span><Button size="sm" variant="ghost" onClick={() => setRefreshKey(n => n + 1)} aria-label="Refresh performance overview">Refresh</Button></div></div>
    <p className="owner-comparison-note"><b>{branchName || 'All Branches'}</b> · Including today · vs previous 30 days ({windows.previous.date_from} – {windows.previous.date_to}). This fixed overview is independent of the daily report period selector.</p>
    <OverviewResource key={`${branchId || 'all'}:${today}`} branchId={branchId} windows={windows} refreshKey={refreshKey}/>
  </section>
}

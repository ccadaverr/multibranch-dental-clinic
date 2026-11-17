import React, { useEffect, useId, useState } from 'react'
import { Button, Card, Field, Notice } from '../components.jsx'
import { fetchDailyRevenue, fetchWeeklyRevenueHistogram } from '../analytics-api.js'
import { clinicDate, validDate } from '../clock.js'
import { exactPeso, revenueGeometry, validateRevenueReport, validateRevenueScope, weeklyChartAvailable } from '../owner-revenue-data.js'
import { OwnerPerformanceOverview } from './OwnerPerformanceOverview.jsx'
import '../owner-revenue.css'

function MoneySummary({ amounts }) {
  return <dl className="owner-revenue-totals">
    <div><dt>Gross collections</dt><dd>{exactPeso(amounts.gross_collected_php)}</dd></div>
    <div><dt>Refunds</dt><dd>{exactPeso(amounts.refunded_php)}</dd></div>
    <div><dt>Net cash flow</dt><dd>{exactPeso(amounts.net_cash_flow_php)}</dd></div>
  </dl>
}

/** Shared SVG presentation follows the existing dashboard chart pattern; money never uses float arithmetic. */
export function RevenuePlot({ data, weekly = false }) {
  const rows = weekly ? data.buckets : data.days
  const [active, setActive] = useState(null)
  const tooltipId = useId()
  const { points, ticks, zeroY } = revenueGeometry(rows, weekly)
  const point = active === null ? null : points[active]
  const description = row => `${row.date}. Gross collections ${exactPeso(row.gross_collected_php)}. Refunds ${exactPeso(row.refunded_php)}. Net cash flow ${exactPeso(row.net_cash_flow_php)}.`
  const label = weekly ? 'Monday–Saturday gross collections and net cash flow chart' : 'Daily gross collections line chart'
  return <>
    <MoneySummary amounts={data.totals}/>
    {weekly ? <div className="owner-revenue-legend"><span><i className="legend-gross"/>Gross collections · bars</span><span><i className="legend-net"/>Net cash flow · line</span><small>Not profit · Asia/Manila</small></div>
      : <p className="muted-copy">Gross collections by payment date, not profit. Exact refunds and net cash flow are included in each tooltip and table.</p>}
    <svg viewBox="0 0 620 232" role="group" aria-label={label} className="owner-revenue-plot">
      <title>{label}</title>
      {ticks.map(({ cents, y }) => {
        const magnitude = cents < 0n ? -cents : cents
        const amount = `${cents < 0n ? '-' : ''}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, '0')}`
        return <g key={String(cents)}><line x1="68" x2="580" y1={y} y2={y} className={cents === 0n ? 'owner-revenue-zero' : undefined}/><text x="62" y={y + 4} textAnchor="end">{exactPeso(amount)}</text></g>
      })}
      {!weekly && <path d={points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')} className="owner-revenue-line"/>}
      {points.map((p, i) => <g key={p.row.date} role="button" tabIndex={0} aria-label={description(p.row)}
        aria-describedby={active === i ? tooltipId : undefined} className={`owner-revenue-point ${active === i ? 'is-active' : ''}`}
        onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={() => setActive(i)}
        onKeyDown={e => { if (e.key === 'Escape') setActive(null); if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive(i) } }}>
        <title>{description(p.row)}</title>
        {weekly ? <><rect x={p.x - 26} y="25" width="52" height="175" className="owner-revenue-hit"/><rect x={p.x - 23} y={p.y} width="46" height={Math.max(0, zeroY - p.y)} rx="7" className="owner-revenue-bar"/>
          <circle cx={p.x} cy={p.netY} r="13" className="owner-revenue-hit"/>
        </> : <>
          <circle cx={p.x} cy={p.y} r="14" className="owner-revenue-hit"/><circle cx={p.x} cy={p.y} r="5"/>
        </>}
        {(weekly || i === 0 || i === rows.length - 1 || i % Math.max(1, Math.ceil(rows.length / 5)) === 0) && <text x={p.x} y="215" textAnchor="middle">{weekly ? p.row.short_day : p.row.date.slice(5)}</text>}
      </g>)}
      {weekly && <>
        <path d={points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.netY}`).join(' ')} className="owner-revenue-net-line" pointerEvents="none"/>
        {points.map((p,i) => <circle key={p.row.date} cx={p.x} cy={p.netY} r={active === i ? 6 : 4.5} className="owner-revenue-net-marker" pointerEvents="none"/>)}
      </>}
    </svg>
    <div className="owner-revenue-detail-slot">{point ? <div id={tooltipId} role="tooltip" className="owner-revenue-tooltip"><b>{point.row.date}</b><MoneySummary amounts={point.row}/></div>
      : <p className="muted-copy">Hover, tap or keyboard-focus a bar or marker for exact date and peso amounts.</p>}</div>
    <details className="owner-revenue-table"><summary>Exact amounts by date</summary><div>
      <table><caption>{weekly ? 'Monday–Saturday' : 'Daily'} collections and refunds in Philippine pesos</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Gross collections</th><th scope="col">Refunds</th><th scope="col">Net cash flow</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.date}><th scope="row">{row.date}</th><td>{exactPeso(row.gross_collected_php)}</td><td>{exactPeso(row.refunded_php)}</td><td>{exactPeso(row.net_cash_flow_php)}</td></tr>)}</tbody>
      </table></div></details>
  </>
}

function RevenueReport({ weekly = false, params, today }) {
  const [result, setResult] = useState({ loading: true })
  const [retry, setRetry] = useState(0)
  const [preview, setPreview] = useState(false)
  useEffect(() => {
    let active = true
    setResult({ loading: true })
    const fetcher = weekly ? fetchWeeklyRevenueHistogram : fetchDailyRevenue
    fetcher(params).then(value => {
      const data = validateRevenueScope(validateRevenueReport(value, weekly), params.branch_id)
      if (active) setResult({ data })
    }).catch(() => { if (active) setResult({ error: true }) })
    return () => { active = false }
  }, [retry]) // The parent keys each resource by every request filter, including branch and period/date.
  const { data } = result
  const available = !weekly || !data || weeklyChartAvailable(data, today, preview)
  const empty = data && data.totals.payments_count === 0 && data.totals.refunds_count === 0
  return <Card title={weekly ? 'Monday–Saturday revenue summary' : 'Daily revenue'}
    subtitle={data ? (weekly ? data.week_label : data.period_label) : 'Collections and refunds from the clinic server'}>
    {result.loading && <p role="status" aria-busy="true">Loading {weekly ? 'weekly' : 'daily'} revenue…</p>}
    {result.error && <Notice tone="warning" title="Revenue unavailable">No figures are shown. <Button size="sm" onClick={() => setRetry(n => n + 1)}>Retry revenue</Button></Notice>}
    {data && weekly && <p className="owner-revenue-week-status" role="status">{data.is_finalized ? 'Week finalized — Saturday has passed.' : data.week_end_date === today ? 'Saturday summary — in progress until the reporting day ends.' : 'In progress — not finalized.'}</p>}
    {data && !available && <Notice>Saturday summary is available on {data.week_end_date}. <Button size="sm" variant="soft" onClick={() => setPreview(true)}>Preview in-progress week</Button></Notice>}
    {data && available && <>
      {empty && <Notice title="No payments or refunds">No transactions were recorded for this reporting window.</Notice>}
      <RevenuePlot data={data} weekly={weekly}/>
    </>}
  </Card>
}

export function OwnerRevenueCharts({ branchId, branchName, period, serverSession, validBranch = true, dashboard = false, showWeekly = true }) {
  const today = clinicDate()
  const [weekDate, setWeekDate] = useState(today)
  const weekInput = React.useRef(null)
  if (!serverSession) return <Notice>Sign in with an Owner account to load revenue from payment and refund records.</Notice>
  if (!validBranch) return <Notice tone="warning">Select an available branch to view revenue.</Notice>
  const selectedWeek=dashboard?today:weekDate
  const validWeek = validDate(selectedWeek) && selectedWeek <= today
  return <section className="owner-revenue" aria-label={`Revenue analytics: ${branchName || 'All Branches'}`}>
    {!dashboard&&<OwnerPerformanceOverview branchId={branchId} branchName={branchName} today={today}/>}
    <p className="muted-copy">Daily revenue follows the report period.{showWeekly?' The weekly summary uses Monday–Saturday and the same branch filter; Sunday is excluded.':''}</p>
    <p className="muted-copy">Charts use payment and refund dates.{!dashboard?' Paid-invoice KPIs below use invoice creation dates and may differ.':''}</p>
    <div className={showWeekly?'owner-revenue-grid':''}>
      <RevenueReport key={`daily:${branchId || 'all'}:${period}:${today}`} params={{ period: period.toLowerCase(), branch_id: branchId }} today={today}/>
      {showWeekly&&<div>{!dashboard&&<div className="owner-report-controls">
        <Field label="Week containing date"><input ref={weekInput} type="date" aria-label="Week containing date" value={weekDate} max={today} onChange={e => setWeekDate(e.target.value)}/></Field>
        {weekDate !== today && <Button variant="soft" onClick={() => {
          setWeekDate(clinicDate())
          weekInput.current?.focus()
        }}>Current week</Button>}
      </div>}
        {validWeek ? <RevenueReport key={`weekly:${branchId || 'all'}:${selectedWeek}:${today}`} weekly params={{ date: selectedWeek, branch_id: branchId }} today={today}/>
          : <Notice tone="warning">Choose a valid date no later than today.</Notice>}
      </div>}
    </div>
  </section>
}

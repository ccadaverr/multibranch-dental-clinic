import { liveRecords } from '../appointment-projection.js'
import React from 'react'
import { PatientHome } from './PatientHome.jsx'
import { ROLE_INFO } from '../data.js'
import { Button, Card, Icon, MetricRow, Notice, PageHeader, Progress, StatCard, Status } from '../components.jsx'
import { branchCapacity, dentistName, displayTime, patientName, peso } from '../logic.js'

import { pendingHours } from '../phase3-contracts.js'
import { loadInquirySummary } from '../inquiries-api.js'
import { clinicDate } from '../clock.js'
import { isTodayQueue } from '../contracts.js'
import { countQueue } from '../queue-counts.js'
import { QueueByBranch, useQueueVisibility } from './QueueCounts.jsx'
import { clinicNow } from '../clock.js'
import { fetchDailyRevenue, fetchWeeklyRevenueHistogram } from '../analytics-api.js'
import { DentistHome } from './DentistHome.jsx'
import { StaffOnDuty } from './StaffOnDuty.jsx'

export function DashboardPage({ role, activeBranch, setPage, store }) {
  const { state }=store
  if (role==='patient') return <PatientHome store={store} setPage={setPage}/>
  if (role==='staff') return <StaffDashboard setPage={setPage} activeBranch={activeBranch} state={state} session={store.session} store={store}/>
  if (role==='dentist') return <DentistHome setPage={setPage} store={store}/>
  return <OwnerDashboard setPage={setPage} activeBranch={activeBranch} state={state} session={store.session} store={store}/>
}

function StaffDashboard({ activeBranch, setPage, state, session, store }) {
  // M16: in a clinic-server session the count comes ONLY from the server (this Staff member's scope). null = loading, 'unavailable' = the
  // request failed; neither is shown as zero. The browser's local demo inquiries are never counted.
  const [serverInquiries,setServerInquiries]=React.useState(null)
  React.useEffect(()=>{
    if(!session?.serverUserId)return
    let live=true
    loadInquirySummary().then(r=>{if(live)setServerInquiries(r.ok?r.open:'unavailable')})
    return()=>{live=false}
  },[session?.serverUserId])
  const branchFilter=x=>activeBranch==='All Branches'||x.branch===activeBranch
  const todays=state.appointments.filter(a=>a.date===clinicDate()&&a.status!=='Cancelled'&&branchFilter(a)).sort((a,b)=>a.start.localeCompare(b.start))
  const waiting=state.queue.filter(q=>q.status==='Waiting'&&isTodayQueue(q)&&branchFilter(q))
  // Clinic-server session: the live count is the server queue's awaiting-treatment tally (Waiting + Called + Treatment Ready),
  // shown only after a successful, complete response for today's clinic day. The browser demo keeps its own Waiting filter.
  const qvis=useQueueVisibility(store)
  const serverQueue=qvis.mode!=='demo'
  const qCounts=serverQueue&&qvis.mode==='ready'?countQueue(state.queue,{branchId:state.branches.find(b=>b.name===activeBranch)?.id??null,date:clinicNow().date}):null
  const waitingCount=serverQueue?qCounts?.awaiting:waiting.length
  const pendingHmo=liveRecords(state.hmo).filter(h=>['Pending','Missing Requirements','Ready for Submission','Returned','Escalated'].includes(h.status)&&branchFilter(h))
  // M16: in a clinic-server session inquiries live on the server; the browser's local demo inquiries are never counted as real.
  const demoOpenInquiries=session?.serverUserId?[]:state.inquiries.filter(i=>i.status==='Open'&&i.assignedUserId===(session?.userId||ROLE_INFO.staff.userId)&&i.branchId===(session?.branchId||ROLE_INFO.staff.branchId))
  const inquiryCountKnown=!session?.serverUserId||Number.isInteger(serverInquiries)
  const openInquiries=session?.serverUserId?(Number.isInteger(serverInquiries)?new Array(serverInquiries).fill(0):[]):demoOpenInquiries
  const overdueHmo=liveRecords(state.hmo).filter(h=>['Pending','Escalated'].includes(h.status)&&pendingHours(h,state.clock)>=12&&branchFilter(h))
  const branch=state.branches.find(b=>b.name===activeBranch)
  return <>
    <PageHeader kicker="Front desk workspace" title="Today’s clinic operations" text={`Keep arrivals, queues, appointments and patient requests moving smoothly${branch?` at ${branch.name}`:''}.`}/>
    <div className="stats-grid">
      <StatCard label="Appointments today" value={todays.length} hint="Confirmed and pending" icon={<Icon name="calendar" size={18}/>}/>
      <StatCard label={serverQueue?'Awaiting treatment':'Waiting now'} value={serverQueue?(qCounts?qCounts.awaiting:qvis.mode==='loading'?'…':'Unavailable'):waiting.length} hint={serverQueue?(qCounts?'Waiting + Called + Treatment Ready':qvis.message):'Across active dentist queues'} tone="blue" icon={<Icon name="queue" size={18}/>}/>
      <StatCard label="HMO needs action" value={pendingHmo.length} hint={`${overdueHmo.length} beyond follow-up threshold`} tone="amber" icon={<Icon name="shield" size={18}/>}/>
      <StatCard label="Open inquiries" value={session?.serverUserId?(serverInquiries===null?'…':serverInquiries==='unavailable'?'Unavailable':serverInquiries):demoOpenInquiries.length} hint={session?.serverUserId&&serverInquiries==='unavailable'?'The inquiry count could not be loaded':'Assigned to you'} tone="purple" icon={<Icon name="message" size={18}/>}/>
    </div>
    <StaffOnDuty session={session} activeBranch={activeBranch}/>
    <div className="ops-grid">
      <Card title="Today’s patient flow" subtitle="Upcoming arrivals and current statuses" actions={<button className="text-link" onClick={()=>setPage('appointments')}>View all appointments</button>}>
        <div className="schedule-board elevated">{todays.slice(0,6).map(a=><div key={a.id} className="schedule-chip"><div className="schedule-time-pill">{displayTime(a.start)}</div><div><strong>{patientName(a.patientId,state.patients)}</strong><small>{a.service} • {dentistName(a.dentistId,state.dentists)}</small></div><Status>{a.status}</Status></div>)}</div>
      </Card>
      <Card title="Needs attention" subtitle="Exceptions before routine work">
        <div className="alert-list">
          {overdueHmo.length>0&&<div className="alert warning"><span className="alert-icon"><Icon name="shield" size={18}/></span><div><b>{overdueHmo.length} HMO case{overdueHmo.length>1?'s':''} overdue</b><span>Follow-up threshold has been reached.</span></div><button onClick={()=>setPage('hmo')}>Review</button></div>}
          {waitingCount>0&&<div className="alert info"><span className="alert-icon"><Icon name="queue" size={18}/></span><div><b>{waitingCount} patient{waitingCount>1?'s':''} {serverQueue?'awaiting treatment':'waiting'}</b><span>{serverQueue?'Waiting, called or ready for the Dentist.':'Monitor queue age and dentist availability.'}</span></div><button onClick={()=>setPage('queue')}>Open queue</button></div>}
          {openInquiries.length>0&&<div className="alert neutral"><span className="alert-icon"><Icon name="message" size={18}/></span><div><b>{openInquiries.length} open inquir{openInquiries.length>1?'ies':'y'}</b><span>Waiting for a recorded response.</span></div><button onClick={()=>setPage('inquiries')}>Respond</button></div>}
          {!overdueHmo.length&&!waitingCount&&(!serverQueue||qCounts)&&!openInquiries.length&&inquiryCountKnown&&<div className="alert success"><span className="alert-icon"><Icon name="shield" size={18}/></span><div><b>Everything is on track</b><span>No urgent operational exceptions right now.</span></div></div>}
        </div>
      </Card>
    </div>
    {serverQueue?<div className="top-gap"><QueueByBranch store={store} activeBranch={activeBranch} vis={qvis} title="Live queue" actions={<button className="text-link" onClick={()=>setPage('queue')}>Open queue</button>}/></div>:<Card title="Capacity snapshot" subtitle="Live view of available chair-side capacity" className="top-gap"><div className="capacity-row-grid">{state.branches.filter(b=>activeBranch==='All Branches'||b.name===activeBranch).map(b=>{const c=branchCapacity(b.name,state);return <div key={b.id} className="capacity-tile"><div className="capacity-tile-head"><div><b>{b.name}</b><small>{b.city}</small></div><span className={c.overloaded?'risk':'healthy'}>{c.overloaded?'Attention':'Healthy'}</span></div><div className="capacity-main"><strong>{c.workload}%</strong><span>workload</span></div><Progress value={c.workload} threshold={c.threshold}/><div className="capacity-meta"><span>{c.activeDentists} dentists</span><span>{c.waiting} waiting</span><span>~{c.estimate} min</span></div></div>})}</div></Card>}
  </>
}

export function formatCurrencyPhp(value) {
  const num = typeof value === 'number' ? value : parseFloat(value) || 0
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num)
}

export function isSaturdayManila(dateStr = clinicDate()) {
  if (!dateStr || typeof dateStr !== 'string') return false
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return false
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return dayOfWeek === 6
}

export function DailyRevenueChart({
  activeBranch,
  activeBranchId,
  isServerSession,
  initialData = null,
  initialLoading = undefined,
  initialError = null,
}) {
  const [period, setPeriod] = React.useState('week')
  const [data, setData] = React.useState(initialData)
  const [loading, setLoading] = React.useState(initialLoading !== undefined ? initialLoading : !initialData)
  const [error, setError] = React.useState(initialError)
  const [hoveredPoint, setHoveredPoint] = React.useState(null)
  const [focusedPoint, setFocusedPoint] = React.useState(null)
  const activePoint = hoveredPoint || focusedPoint

  const loadData = React.useCallback(() => {
    let active = true
    setLoading(true)
    setError(null)
    setHoveredPoint(null)
    setFocusedPoint(null)

    fetchDailyRevenue({
      period,
      branch_id: activeBranchId,
    })
      .then(res => {
        if (!active) return
        setData(res)
        setLoading(false)
      })
      .catch(err => {
        if (!active) return
        setError(err?.message || 'Daily revenue trend is unavailable.')
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [period, activeBranchId])

  React.useEffect(() => {
    const cleanup = loadData()
    return () => {
      if (cleanup) cleanup()
    }
  }, [loadData])

  const days = data?.days || []
  const hasData = days.length > 0
  const totals = data?.totals

  const svgWidth = 600
  const svgHeight = 220
  const pad = { top: 30, right: 30, bottom: 40, left: 70 }
  const innerWidth = svgWidth - pad.left - pad.right
  const innerHeight = svgHeight - pad.top - pad.bottom

  const maxVal = Math.max(1000, ...days.map(d => parseFloat(d.gross_collected_php) || 0))
  const yTicks = [0, maxVal * 0.33, maxVal * 0.66, maxVal]

  const points = days.map((day, idx) => {
    const val = parseFloat(day.gross_collected_php) || 0
    const x = days.length > 1
      ? pad.left + (idx / (days.length - 1)) * innerWidth
      : pad.left + innerWidth / 2
    const y = pad.top + innerHeight - (val / maxVal) * innerHeight
    return { x, y, val, day }
  })

  const lineD = points.length > 0
    ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
    : ''
  const areaD = points.length > 0
    ? `${lineD} L ${points[points.length - 1].x.toFixed(1)} ${pad.top + innerHeight} L ${points[0].x.toFixed(1)} ${pad.top + innerHeight} Z`
    : ''

  return (
    <Card
      title="Daily Revenue Trend"
      subtitle={data?.period_label ? `${data.period_label} • Philippine Peso (PHP)` : 'Daily collections and net cash flow'}
      actions={
        <div className="tabs" role="group" aria-label="Revenue chart period">
          <button
            type="button"
            className={period === 'week' ? 'active' : ''}
            aria-pressed={period === 'week'}
            onClick={() => setPeriod('week')}
          >
            Week
          </button>
          <button
            type="button"
            className={period === 'month' ? 'active' : ''}
            aria-pressed={period === 'month'}
            onClick={() => setPeriod('month')}
          >
            Month
          </button>
        </div>
      }
    >
      {loading && (
        <div
          className="chart-skeleton"
          role="status"
          aria-busy="true"
          aria-label="Loading daily revenue chart"
          style={{
            height: '200px',
            background: 'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%)',
            backgroundSize: '200% 100%',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--muted, #64748b)',
            fontSize: '12px',
          }}
        >
          <span>Loading revenue trend…</span>
        </div>
      )}

      {!loading && error && (
        <Notice tone="warning" title="Revenue trend unavailable">
          <span>{error}</span>{' '}
          <Button size="sm" variant="ghost" onClick={loadData}>
            Try again
          </Button>
        </Notice>
      )}

      {!loading && !error && !hasData && (
        <Notice tone="info" title="No revenue data">
          No revenue transactions recorded for the selected period.
        </Notice>
      )}

      {!loading && !error && hasData && (
        <div>
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            preserveAspectRatio="xMidYMid meet"
            className="revenue-line-chart"
            role="img"
            aria-label={`Daily revenue line chart for ${data?.period_label || 'selected period'}`}
            style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
          >
            <defs>
              <linearGradient id="revenue-line-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--brand, #087c73)" stopOpacity="0.25" />
                <stop offset="100%" stopColor="var(--brand, #087c73)" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            <style>{`
              .chart-interactive-point:focus-visible {
                outline: 2px solid var(--brand, #087c73);
                outline-offset: 4px;
              }
            `}</style>

            {/* Grid lines & Y-axis labels */}
            {yTicks.map((tickVal, i) => {
              const y = pad.top + innerHeight - (tickVal / maxVal) * innerHeight
              return (
                <g key={i} className="chart-grid-line">
                  <line
                    x1={pad.left}
                    y1={y}
                    x2={pad.left + innerWidth}
                    y2={y}
                    stroke="var(--line, #e2e8f0)"
                    strokeDasharray={i === 0 ? 'none' : '3 3'}
                    strokeWidth="1"
                  />
                  <text
                    x={pad.left - 8}
                    y={y + 3}
                    textAnchor="end"
                    fill="var(--muted, #64748b)"
                    fontSize="10"
                    fontFamily="system-ui, sans-serif"
                  >
                    {formatCurrencyPhp(tickVal)}
                  </text>
                </g>
              )
            })}

            {/* Area fill */}
            {areaD && <path d={areaD} fill="url(#revenue-line-gradient)" />}

            {/* Line stroke */}
            {lineD && (
              <path
                d={lineD}
                fill="none"
                stroke="var(--brand, #087c73)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* X-axis labels */}
            {points.map((pt, idx) => {
              const showLabel = points.length <= 10 || idx === 0 || idx === points.length - 1 || idx % 3 === 0
              if (!showLabel) return null
              return (
                <text
                  key={idx}
                  x={pt.x}
                  y={pad.top + innerHeight + 18}
                  textAnchor="middle"
                  fill="var(--muted, #64748b)"
                  fontSize="10"
                  fontFamily="system-ui, sans-serif"
                >
                  {pt.day.label || pt.day.date?.slice(5) || ''}
                </text>
              )
            })}

            {/* Interactive data points */}
            {points.map((pt, idx) => {
              const isHovered = hoveredPoint?.day?.date === pt.day.date
              const isFocused = focusedPoint?.day?.date === pt.day.date
              const isHighlighted = isHovered || isFocused
              const amountPhp = formatCurrencyPhp(pt.day.gross_collected_php)
              const pointAria = `${pt.day.date}${pt.day.day_name ? ` (${pt.day.day_name})` : ''}: ${amountPhp}`
              return (
                <g
                  key={pt.day.date || idx}
                  role="button"
                  tabIndex={0}
                  className="chart-interactive-point"
                  aria-label={pointAria}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredPoint(pt)}
                  onMouseLeave={() => setHoveredPoint(null)}
                  onFocus={() => setFocusedPoint(pt)}
                  onBlur={() => setFocusedPoint(null)}
                >
                  <circle cx={pt.x} cy={pt.y} r={14} fill="transparent" />
                  {isFocused && (
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={9}
                      fill="none"
                      stroke="var(--ink, #0f172a)"
                      strokeWidth={2}
                      className="chart-focus-indicator"
                    />
                  )}
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={isHighlighted ? 6 : 3.5}
                    fill={isHighlighted ? 'var(--brand, #087c73)' : '#ffffff'}
                    stroke="var(--brand, #087c73)"
                    strokeWidth={isHighlighted ? 3 : 2}
                  />
                </g>
              )
            })}

            {/* SVG Tooltip */}
            {activePoint && (
              <g
                className="chart-tooltip"
                transform={`translate(${Math.max(pad.left + 65, Math.min(pad.left + innerWidth - 65, activePoint.x))}, ${Math.max(pad.top + 20, activePoint.y - 14)})`}
                pointerEvents="none"
              >
                <rect
                  x="-65"
                  y="-38"
                  width="130"
                  height="36"
                  rx="6"
                  fill="#0f172a"
                  fillOpacity="0.94"
                />
                <text
                  x="0"
                  y="-22"
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="10"
                  fontFamily="system-ui, sans-serif"
                >
                  {activePoint.day.date} {activePoint.day.day_name ? `• ${activePoint.day.day_name}` : ''}
                </text>
                <text
                  x="0"
                  y="-8"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="12"
                  fontWeight="bold"
                  fontFamily="system-ui, sans-serif"
                >
                  {formatCurrencyPhp(activePoint.day.gross_collected_php)}
                </text>
              </g>
            )}
          </svg>

          {/* Accessible Tooltip Detail Strip */}
          <div
            className="chart-detail-strip"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '12px',
              paddingTop: '10px',
              borderTop: '1px solid var(--line, #e2e8f0)',
              fontSize: '11px',
              color: 'var(--muted, #64748b)',
            }}
          >
            <div>
              {activePoint ? (
                <span>
                  Date: <strong>{activePoint.day.date}</strong>{activePoint.day.day_name ? ` (${activePoint.day.day_name})` : ''} — Gross Revenue:{' '}
                  <strong style={{ color: 'var(--ink, #0f172a)' }}>
                    {formatCurrencyPhp(activePoint.day.gross_collected_php)}
                  </strong>
                </span>
              ) : (
                <span>
                  Hover or focus a data point for details. Total collections:{' '}
                  <strong style={{ color: 'var(--ink, #0f172a)' }}>
                    {formatCurrencyPhp(totals?.gross_collected_php || 0)}
                  </strong>
                </span>
              )}
            </div>
            <div role="tooltip" aria-live="polite" className="sr-only">
              {activePoint
                ? `${activePoint.day.date}: ${formatCurrencyPhp(activePoint.day.gross_collected_php)}`
                : `Period total: ${formatCurrencyPhp(totals?.gross_collected_php || 0)}`}
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

export function WeeklyRevenueHistogram({
  activeBranch,
  activeBranchId,
  currentDate = clinicDate(),
  initialData = null,
  initialLoading = undefined,
  initialError = null,
}) {
  const [data, setData] = React.useState(initialData)
  const [loading, setLoading] = React.useState(initialLoading !== undefined ? initialLoading : !initialData)
  const [error, setError] = React.useState(initialError)
  const [hoveredBucket, setHoveredBucket] = React.useState(null)
  const [focusedBucket, setFocusedBucket] = React.useState(null)
  const activeBucket = hoveredBucket || focusedBucket

  const loadData = React.useCallback(() => {
    let active = true
    setLoading(true)
    setError(null)
    setHoveredBucket(null)
    setFocusedBucket(null)

    fetchWeeklyRevenueHistogram({
      branch_id: activeBranchId,
      date: currentDate,
    })
      .then(res => {
        if (!active) return
        setData(res)
        setLoading(false)
      })
      .catch(err => {
        if (!active) return
        setError(err?.message || 'Weekly revenue summary is unavailable.')
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [currentDate, activeBranchId])

  React.useEffect(() => {
    const cleanup = loadData()
    return () => {
      if (cleanup) cleanup()
    }
  }, [loadData])

  const buckets = data?.buckets || []
  const hasData = buckets.length > 0
  const totals = data?.totals

  const svgWidth = 600
  const svgHeight = 220
  const pad = { top: 30, right: 30, bottom: 40, left: 70 }
  const innerWidth = svgWidth - pad.left - pad.right
  const innerHeight = svgHeight - pad.top - pad.bottom

  const maxVal = Math.max(1000, ...buckets.map(b => parseFloat(b.gross_collected_php) || 0))
  const yTicks = [0, maxVal * 0.33, maxVal * 0.66, maxVal]
  const slotWidth = buckets.length > 0 ? innerWidth / buckets.length : innerWidth
  const barWidth = Math.min(48, slotWidth * 0.58)

  return (
    <Card
      title="Saturday Weekly Summary"
      subtitle={data?.week_label ? `${data.week_label} • Monday–Saturday` : 'Saturday end-of-week collection summary'}
    >
      {loading && (
        <div
          className="chart-skeleton"
          role="status"
          aria-busy="true"
          aria-label="Loading weekly revenue histogram"
          style={{
            height: '200px',
            background: 'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%)',
            backgroundSize: '200% 100%',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--muted, #64748b)',
            fontSize: '12px',
          }}
        >
          <span>Loading Saturday weekly summary…</span>
        </div>
      )}

      {!loading && error && (
        <Notice tone="warning" title="Weekly summary unavailable">
          <span>{error}</span>{' '}
          <Button size="sm" variant="ghost" onClick={loadData}>
            Try again
          </Button>
        </Notice>
      )}

      {!loading && !error && !hasData && (
        <Notice tone="info" title="No weekly revenue data">
          No transactions recorded for the week ending on Saturday.
        </Notice>
      )}

      {!loading && !error && hasData && (
        <div>
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            preserveAspectRatio="xMidYMid meet"
            className="revenue-histogram-chart"
            role="img"
            aria-label={`Weekly revenue histogram for ${data?.week_label || 'current week'}`}
            style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
          >
            <style>{`
              .chart-interactive-bar:focus-visible {
                outline: 2px solid var(--brand, #087c73);
                outline-offset: 3px;
              }
            `}</style>
            {/* Grid lines & Y-axis labels */}
            {yTicks.map((tickVal, i) => {
              const y = pad.top + innerHeight - (tickVal / maxVal) * innerHeight
              return (
                <g key={i} className="chart-grid-line">
                  <line
                    x1={pad.left}
                    y1={y}
                    x2={pad.left + innerWidth}
                    y2={y}
                    stroke="var(--line, #e2e8f0)"
                    strokeDasharray={i === 0 ? 'none' : '3 3'}
                    strokeWidth="1"
                  />
                  <text
                    x={pad.left - 8}
                    y={y + 3}
                    textAnchor="end"
                    fill="var(--muted, #64748b)"
                    fontSize="10"
                    fontFamily="system-ui, sans-serif"
                  >
                    {formatCurrencyPhp(tickVal)}
                  </text>
                </g>
              )
            })}

            {/* Bars */}
            {buckets.map((b, idx) => {
              const val = parseFloat(b.gross_collected_php) || 0
              const barHeight = val > 0 ? Math.max(3, (val / maxVal) * innerHeight) : 1
              const centerX = pad.left + (idx + 0.5) * slotWidth
              const x = centerX - barWidth / 2
              const y = pad.top + innerHeight - barHeight
              const isHovered = hoveredBucket?.date === b.date
              const isFocused = focusedBucket?.date === b.date
              const isHighlighted = isHovered || isFocused
              const amountPhp = formatCurrencyPhp(b.gross_collected_php)
              const barAria = `${b.short_day} (${b.date}): ${amountPhp}`

              return (
                <g
                  key={b.date || idx}
                  role="button"
                  tabIndex={0}
                  className="chart-interactive-bar"
                  aria-label={barAria}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredBucket(b)}
                  onMouseLeave={() => setHoveredBucket(null)}
                  onFocus={() => setFocusedBucket(b)}
                  onBlur={() => setFocusedBucket(null)}
                >
                  <rect
                    x={centerX - slotWidth / 2}
                    y={pad.top}
                    width={slotWidth}
                    height={innerHeight}
                    fill="transparent"
                  />
                  {isFocused && (
                    <rect
                      x={x - 3}
                      y={y - 3}
                      width={barWidth + 6}
                      height={barHeight + 6}
                      rx={6}
                      fill="none"
                      stroke="var(--ink, #0f172a)"
                      strokeWidth={2}
                      className="chart-focus-indicator"
                    />
                  )}
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    rx="4"
                    fill={isHighlighted ? 'var(--brand-dark, #065e57)' : 'var(--brand, #087c73)'}
                    stroke={isHighlighted ? 'var(--ink, #0f172a)' : 'transparent'}
                    strokeWidth={isHighlighted ? 2 : 0}
                  />
                  <text
                    x={centerX}
                    y={pad.top + innerHeight + 16}
                    textAnchor="middle"
                    fill={isHighlighted ? 'var(--ink, #0f172a)' : 'var(--muted, #64748b)'}
                    fontWeight={isHighlighted ? 'bold' : 'normal'}
                    fontSize="11"
                    fontFamily="system-ui, sans-serif"
                  >
                    {b.short_day}
                  </text>
                  <text
                    x={centerX}
                    y={pad.top + innerHeight + 28}
                    textAnchor="middle"
                    fill="var(--muted, #64748b)"
                    fontSize="9"
                    fontFamily="system-ui, sans-serif"
                  >
                    {b.date ? b.date.slice(5) : ''}
                  </text>
                </g>
              )
            })}

            {/* SVG Tooltip */}
            {activeBucket && (
              <g
                className="chart-tooltip"
                transform={`translate(${Math.max(pad.left + 65, Math.min(pad.left + innerWidth - 65, pad.left + (buckets.findIndex(x => x.date === activeBucket.date) + 0.5) * slotWidth))}, ${pad.top + 20})`}
                pointerEvents="none"
              >
                <rect
                  x="-65"
                  y="-38"
                  width="130"
                  height="36"
                  rx="6"
                  fill="#0f172a"
                  fillOpacity="0.94"
                />
                <text
                  x="0"
                  y="-22"
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="10"
                  fontFamily="system-ui, sans-serif"
                >
                  {activeBucket.short_day} • {activeBucket.date}
                </text>
                <text
                  x="0"
                  y="-8"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="12"
                  fontWeight="bold"
                  fontFamily="system-ui, sans-serif"
                >
                  {formatCurrencyPhp(activeBucket.gross_collected_php)}
                </text>
              </g>
            )}
          </svg>

          {/* Accessible Tooltip Detail Strip */}
          <div
            className="chart-detail-strip"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '12px',
              paddingTop: '10px',
              borderTop: '1px solid var(--line, #e2e8f0)',
              fontSize: '11px',
              color: 'var(--muted, #64748b)',
            }}
          >
            <div>
              {activeBucket ? (
                <span>
                  Day: <strong>{activeBucket.short_day}</strong> ({activeBucket.date}) — Gross Revenue:{' '}
                  <strong style={{ color: 'var(--ink, #0f172a)' }}>
                    {formatCurrencyPhp(activeBucket.gross_collected_php)}
                  </strong>
                </span>
              ) : (
                <span>
                  Hover or focus a bar for details. Saturday week total:{' '}
                  <strong style={{ color: 'var(--ink, #0f172a)' }}>
                    {formatCurrencyPhp(totals?.gross_collected_php || 0)}
                  </strong>
                </span>
              )}
            </div>
            <div role="tooltip" aria-live="polite" className="sr-only">
              {activeBucket
                ? `${activeBucket.short_day} (${activeBucket.date}): ${formatCurrencyPhp(activeBucket.gross_collected_php)}`
                : `Week total: ${formatCurrencyPhp(totals?.gross_collected_php || 0)}`}
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

export function OwnerDashboard({ activeBranch, setPage, state, session, store }) {
  const branchData=state.branches.filter(b=>activeBranch==='All Branches'||b.name===activeBranch).map(b=>branchCapacity(b.name,state))
  const qvis=useQueueVisibility(store)
  const serverQueue=qvis.mode!=='demo'
  const qCounts=qvis.mode==='ready'?countQueue(state.queue,{branchId:state.branches.find(b=>b.name===activeBranch)?.id??null,date:clinicNow().date}):null
  const appointments=state.appointments.filter(a=>a.date===clinicDate()&&a.status!=='Cancelled'&&(activeBranch==='All Branches'||a.branch===activeBranch))
  const pendingHmo=liveRecords(state.hmo).filter(h=>['Pending','Escalated'].includes(h.status)&&(activeBranch==='All Branches'||h.branch===activeBranch))
  // D5: revenue from legacy demo invoices (pre-cutover appointments) is excluded from live KPIs.
  const revenue=liveRecords(state.invoices).filter(i=>i.status==='Paid'&&(activeBranch==='All Branches'||i.branch===activeBranch)).reduce((s,i)=>s+i.total,0)
  const exceptions=[...(serverQueue?[]:branchData.filter(c=>c.overloaded)).map(c=>({title:`${c.branch} capacity exception`,detail:`${c.workload}% workload • ~${c.estimate} min wait`})),...pendingHmo.filter(h=>pendingHours(h,state.clock)>=12).map(h=>({title:'HMO follow-up threshold reached',detail:`${patientName(h.patientId,state.patients)} • ${h.provider} • ${pendingHours(h,state.clock).toFixed(1)}h pending`}))]
  const maxLoad=Math.max(100,...branchData.map(x=>x.workload))

  const activeBranchRecord = state.branches.find(b => b.name === activeBranch)
  const activeBranchId = activeBranch === 'All Branches' ? null : (activeBranchRecord?.publicId || activeBranchRecord?.id || null)
  const isSaturday = isSaturdayManila(clinicDate())

  return <>
    <PageHeader kicker="Owner overview" title="Executive dashboard" text="A focused view of clinic performance, exceptions and branch health." aside={<span className="context-chip"><Icon name="building" size={14}/>{activeBranch}</span>}/>
    <div className="stats-grid">
      <StatCard label="Appointments today" value={appointments.length} hint="Across visible branches" icon={<Icon name="calendar" size={18}/>}/>
      <StatCard label={serverQueue?'Awaiting treatment':'Waiting patients'} value={serverQueue?(qCounts?qCounts.awaiting:qvis.mode==='loading'?'…':'Unavailable'):branchData.reduce((s,c)=>s+c.waiting,0)} hint={serverQueue?(qCounts?'Waiting + Called + Treatment Ready':qvis.message):'Live patient flow'} tone="blue" icon={<Icon name="queue" size={18}/>}/>
      <StatCard label="HMO pending" value={pendingHmo.length} hint={`${pendingHmo.filter(h=>pendingHours(h,state.clock)>=12).length} beyond threshold`} tone="amber" icon={<Icon name="shield" size={18}/>}/>
      <StatCard label="Paid revenue" value={peso.format(revenue)} hint="Recorded demo transactions" tone="purple" icon={<Icon name="wallet" size={18}/>}/>
    </div>
    <div className={isSaturday ? 'grid-2 top-gap' : 'top-gap'}>
      <DailyRevenueChart
        activeBranch={activeBranch}
        activeBranchId={activeBranchId}
        isServerSession={!!session?.serverUserId}
      />
      {isSaturday && (
        <WeeklyRevenueHistogram
          activeBranch={activeBranch}
          activeBranchId={activeBranchId}
          currentDate={clinicDate()}
        />
      )}
    </div>
    <div className="owner-dashboard-grid top-gap">
      {serverQueue?<QueueByBranch store={store} activeBranch={activeBranch} vis={qvis} actions={<button className="text-link" onClick={()=>setPage('capacity')}>Branch details</button>}/>:<Card title="Branch workload" subtitle="Compare patient flow and staffing at a glance" actions={<button className="text-link" onClick={()=>setPage('capacity')}>Capacity details</button>}>
        <div className="branch-chart">{branchData.map(c=><div className="branch-chart-row" key={c.branch}><div className="branch-chart-label"><b>{c.branch}</b><span>{c.activeDentists} dentists • {c.waiting} waiting</span></div><div className="branch-chart-bar"><span style={{width:`${Math.min(100,(c.workload/maxLoad)*100)}%`}}/></div><strong>{c.workload}%</strong></div>)}</div>
        <div className="chart-caption"><span><i className="healthy"/>Healthy</span><span>Updated from live queue and staffing data</span></div>
      </Card>}
      <Card title="Priority exceptions" subtitle="Only the issues that may need a decision" actions={<button className="text-link" onClick={()=>setPage('analytics')}>Open analytics</button>}>
        <div className="exception-list">{exceptions.length?exceptions.slice(0,5).map((x,i)=><div className="exception-row" key={i}><span><Icon name="activity" size={17}/></span><div><b>{x.title}</b><small>{x.detail}</small></div><Icon name="chevron" size={16}/></div>):<div className="executive-clear"><span><Icon name="shield" size={22}/></span><div><b>No critical exceptions</b><small>{serverQueue?'No capacity or waiting-time limits are configured, so none are evaluated.':'Visible branches are operating within configured thresholds.'}</small></div></div>}</div>
      </Card>
    </div>
    <div className="cards-3 top-gap">
      <Card title="Scheduling health"><MetricRow label="Confirmed today" value={appointments.filter(a=>a.status==='Confirmed').length}/><MetricRow label="Pending confirmation" value={appointments.filter(a=>a.status==='Pending').length}/><button className="card-link" onClick={()=>setPage('analytics')}>See scheduling report <Icon name="arrow" size={14}/></button></Card>
      <Card title="HMO health"><MetricRow label="Pending provider response" value={pendingHmo.length}/><MetricRow label="Approved cases" value={liveRecords(state.hmo).filter(h=>h.status==='Approved').length}/><button className="card-link" onClick={()=>setPage('hmo')}>Open HMO overview <Icon name="arrow" size={14}/></button></Card>
      <Card title="Patient communication"><MetricRow label="Open inquiries" value={session?.serverUserId?'Not available to Owner':state.inquiries.filter(i=>i.status==='Open').length}/><MetricRow label="Active conversations" value={session?.serverUserId?'Not available to Owner':state.conversations.filter(c=>c.status==='Open').length}/><button className="card-link" onClick={()=>setPage('engagement')}>View engagement <Icon name="arrow" size={14}/></button></Card>
    </div>
  </>
}

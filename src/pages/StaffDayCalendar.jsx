import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, ConfirmDialog, Modal, Notice, PageHeader, RefreshButton, Status } from '../components.jsx'
import { displayTime, dateLabel } from '../logic.js'
import { clinicNow, clinicDate } from '../clock.js'
import { useVisibleRefresh } from '../use-visible-refresh.js'
import { calendarLoad, getAppointment } from '../api-client.js'
import { commandKey } from '../appointments-api.js'
import { mapAppointment } from '../appointments-api.js'
import { appointmentActionProblem, canSchedule, schedulingActorKey, useRequestOwner } from '../appointment-ui.js'
import { AppointmentForm, StaffCancellationDialog } from './Scheduling.jsx'
import '../b4-calendar.css'
import {
  VIEWS, WEEKDAYS, createDayLoader, dayTotals, defaultCalendarDate, groupByDate, isValidClinicDate, monthCells,
  periodContains, periodTarget, shiftPeriod, sourceLabel, statusMeaning, busynessStatus, COUNT_BUSYNESS_THRESHOLDS,
} from '../day-calendar.js'

// M6 interactive Staff/Owner Appointment Calendar: clean full monthly calendar by default with indefinite month navigation,
// daily appointment count previews, busyness indicators, and expandable daily appointment details with working actions
// (create, reschedule, cancel, pre-arrival no-show).

const fmt = (date, options) => new Date(`${date}T00:00:00`).toLocaleDateString('en-PH', options)
const longDate = date => fmt(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const shortDay = date => fmt(date, { weekday: 'short', month: 'short', day: 'numeric' })

function monthTitle(date) {
  if (!isValidClinicDate(date)) return 'Choose a date'
  return fmt(date, { month: 'long', year: 'numeric' })
}

/** Clinic day, re-read every 15 s so "Today" stays correct across Asia/Manila midnight. */
function useClinicToday() {
  const [today, setToday] = useState(() => clinicNow().date)
  useEffect(() => {
    const timer = setInterval(() => setToday(clinicNow().date), 15000)
    return () => clearInterval(timer)
  }, [])
  return today
}

// F6: a stable avatar colour per patient (from the record id) and the patient's initials.
const AVATAR = ['#1865ac', '#0c7f75', '#8a4baf', '#b26a00', '#c2412b', '#2f6f3e', '#5b6b7f', '#a33a6b']
const appointmentName = a => typeof a.patientName === 'string' && a.patientName.trim() ? a.patientName : 'Patient name unavailable'
const initials = name => (typeof name === 'string' && name.trim() ? name : '?').split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase()
const avatarColour = id => AVATAR[[...String(id || '')].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 997, 7) % AVATAR.length]

/** F6 (R2-02): how full a day is — booked minutes against the dentists' minutes — as a number and a band, never colour alone. */
export function loadBand(day, crowded = 80) {
  if (!day) return null
  if (day.closed) return { band: 'closed', label: 'Closed', detail: day.reason || 'Closed' }
  if (day.percent == null) return { band: 'none', label: 'No dentist hours', detail: '' }
  const band = day.percent >= crowded ? 'crowded' : day.percent >= 50 ? 'busy' : day.percent > 0 ? 'light' : 'free'
  return { band, label: `${day.percent}% booked${band === 'crowded' ? ' · crowded' : ''}`, detail: `${day.appointments} appointment${day.appointments === 1 ? '' : 's'}, ${day.booked_minutes} of ${day.capacity_minutes} dentist minutes` }
}

function LoadBadge({ day, count = 0, crowded = 80 }) {
  const b = loadBand(day, crowded)
  if (b) return <span className={`daycal-load is-${b.band}`} title={b.detail || b.label}><i aria-hidden="true"/>{b.band === 'none' ? 'No hours' : b.label}</span>
  const fallback = busynessStatus({ dayLoad: day, count, crowded })
  return <span className={`daycal-load is-${fallback.band}`} title={fallback.detail}><i aria-hidden="true"/>{fallback.shortLabel}</span>
}

function AppointmentButton({ a, onSelect, showDentist = false }) {
  return <button type="button" className="daycal-chip" aria-haspopup="dialog" onClick={e => { e.stopPropagation(); onSelect(a.id) }}>
    <PatientAvatar a={a}/>
    <span className="daycal-chip-time">{displayTime(a.start)}</span>
    <span className="daycal-chip-name">{appointmentName(a)}{a.serviceName ? <small> · {a.serviceName}</small> : null}</span>
    <span className="daycal-chip-status">{a.status}{showDentist && a.dentistName ? ` · ${a.dentistName}` : ''}</span>
  </button>
}

function PatientAvatar({ a, compact = false }) {
  const [failed, setFailed] = useState(false)
  // Only reuse a same-origin, authenticated image URL supplied by an authorized API.
  // Never synthesize a patient's photo URL or load remote tracking images.
  const value = a.patientPhotoUrl || a.patientAvatarUrl
  const photo = typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null
  return <span className={compact ? 'daycal-avatar-face is-compact' : 'daycal-avatar-face'}
    style={{ background: avatarColour(a.patientId || a.patientCode) }} aria-hidden="true">
    {photo && !failed ? <img src={photo} alt="" loading="lazy" onError={()=>setFailed(true)}/> : initials(a.patientName)}
  </span>
}

function AppointmentAvatarButton({ a, onSelect }) {
  const name = appointmentName(a)
  const tooltip = `${name} · ${displayTime(a.start)} · ${a.serviceName || a.service || 'Appointment'}`
  return (
    <button
      type="button"
      className="daycal-avatar-badge"
      title={tooltip}
      aria-label={`View appointment details: ${tooltip}`}
      aria-haspopup="dialog"
      onClick={e => { e.stopPropagation(); onSelect(a.id) }}
    >
      <PatientAvatar a={a} compact />
    </button>
  )
}

export function StaffDayCalendar({ store }) {
  const session = store.session
  // /api/me scopes are authorization, not the operational branch assignment. Canonical
  // membership avoids reloads for reordered scopes; a keyed mount gives A→B→A a fresh
  // loader/cache/detail lifetime, even when A's old requests are still pending.
  const scopes = Array.isArray(session?.branchScopes)
    ? [...new Set(session.branchScopes.filter(id => typeof id === 'string' && id))].sort()
    : []
  const authorizationKey = JSON.stringify([session?.serverUserId ?? null, session?.role ?? null, session?.active !== false, session?.role === 'owner' ? null : scopes, schedulingActorKey(store)])
  return <CalendarSession key={authorizationKey} store={store} scopes={scopes} authorizationKey={authorizationKey}/>
}

function CalendarSession({ store, scopes, authorizationKey }) {
  const session = store.session
  const role = session?.role || 'staff'
  const toast = store.toast || (() => {})
  const serverSession = !!session?.serverUserId
  const hasAccess = session?.active !== false && (session?.role === 'owner' || (session?.role === 'staff' && scopes.length > 0))
  const sessionKey = serverSession && hasAccess ? authorizationKey : null
  const live = useRef(false)
  React.useLayoutEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])
  const today = useClinicToday()
  const [date, setDate] = useState(defaultCalendarDate)
  const [branchId, setBranchId] = useState(() => role === 'staff' ? session?.branchId || 'all' : 'all')
  const [selectedId, setSelectedId] = useState(null)
  const [selectedDate, setSelectedDate] = useState(() => clinicNow().date)
  const [newOpen, setNewOpen] = useState(false)
  const [reschedule, setReschedule] = useState(null)
  const [cancelling, setCancelling] = useState(null)
  const cancellationKeys = useRef(new Map())
  const [missed, setMissed] = useState(null)
  const [actionError, setActionError] = useState('')
  const [resolving, setResolving] = useState(false)
  const actionOwner = useRequestOwner(authorizationKey, store.getAuthGeneration)
  const detailGeneration = useRef(0), latestRows = useRef([])
  const [snapshot, setSnapshot] = useState({ status: 'idle', date: null, key: null, rows: [], complete: false, error: '', stale: false })
  const calendarRef = useRef(null)
  const pendingFocusDate = useRef(null)
  const loaderRef = useRef(null)
  if (!loaderRef.current) loaderRef.current = createDayLoader({ onChange: setSnapshot })
  const loader = loaderRef.current
  const target = periodTarget('month', date)
  React.useLayoutEffect(() => {
    detailGeneration.current++; actionOwner.invalidate()
    setResolving(false); setReschedule(null); setCancelling(null); setMissed(null); setActionError('')
  }, [target, branchId, selectedDate])

  // Adjacent-month buttons are replaced by in-month controls after navigation.
  // Restore requested date focus; Previous/Next and the month input keep their focus.
  useEffect(() => {
    if (!pendingFocusDate.current) return
    calendarRef.current?.querySelector(`[data-calendar-date="${pendingFocusDate.current}"]`)?.focus()
    pendingFocusDate.current = null
  }, [date])

  // One request per month session. Leaving the effect invalidates every in-flight response.
  useEffect(() => {
    if (!sessionKey || !isValidClinicDate(date)) return undefined
    setSelectedId(null)
    loader.load(target, sessionKey)
    return () => loader.invalidate()
  }, [target, date, sessionKey, loader])
  useVisibleRefresh(() => { if (live.current && sessionKey) loader.refresh() }, { active: !!sessionKey, intervalMs: 60000 })

  // Staff reach only the branches scoped to them (/api/me branch_scopes); the Owner sees every open branch.
  const branches = useMemo(() => {
    if (session?.role === 'owner') return store.state.branches
    return store.state.branches.filter(b => scopes.includes(b.id))
  }, [store.state.branches, authorizationKey])

  const [load, setLoad] = useState({ key: null, days: {}, crowded: 80, error: '' })
  const [capacityRetry, setCapacityRetry] = useState(0)
  const loadParams = useMemo(() => {
    const branch = branches.length > 1 && branches.some(b => b.id === branchId) ? branchId : null
    const cells = monthCells(date)
    const r = { from: cells[0]?.date, to: cells[cells.length - 1]?.date }
    return { key: `${sessionKey}:${r.from}:${r.to}:${branch || 'all'}`, from: r.from, to: r.to, branch }
  }, [date, branchId, branches, sessionKey])

  useEffect(() => {
    if (!sessionKey || !loadParams?.from || !loadParams?.to) return undefined
    let live = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    calendarLoad({ from: loadParams.from, to: loadParams.to, branch_ref: loadParams.branch || undefined }, controller.signal).then(r => {
      if (!live) return
      setLoad(r.ok ? { key: loadParams.key, crowded: r.data.crowded_percent, note: r.data.capacity_note || null, error: '', days: Object.fromEntries((r.data.days || []).map(d => [d.date, d])) } :
        { key: loadParams.key, crowded: 80, days: {}, error: controller.signal.aborted ? 'Capacity timed out. Retry this month.' : 'Capacity information is unavailable for this month.' })
    }).finally(() => clearTimeout(timeout))
    return () => { live = false; controller.abort(); clearTimeout(timeout) }
  }, [sessionKey, loadParams?.key, capacityRetry])

  const crowdedThreshold = Number.isFinite(load.crowded) && load.crowded > 50 ? load.crowded : 80
  const [dayStatusFilter, setDayStatusFilter] = useState('All')
  useEffect(() => { setDayStatusFilter('All') }, [selectedDate])

  if (!serverSession) return <>
    <PageHeader kicker="Scheduling" title="Appointment Calendar" text="A read-only calendar of appointments from the clinic server."/>
    <Notice tone="info" title="Clinic server required">The Appointment Calendar reads appointments from the clinic server and isn’t available in the offline demo.</Notice>
  </>

  if (!hasAccess) return <>
    <PageHeader kicker="Scheduling" title="Appointment Calendar" text="Appointment access follows your current clinic permissions."/>
    <Notice tone="info" title="Calendar access unavailable">No authorized calendar branches are available for this account. Contact the clinic administrator to review access.</Notice>
  </>

  const current = snapshot.date === target && snapshot.key === sessionKey ? snapshot : null
  const status = current?.status ?? 'loading'
  const rows = status === 'ready' ? current.rows.filter(r => role === 'owner' || scopes.includes(r.branchId)) : []
  latestRows.current = rows
  const complete = status === 'ready' && current.complete
  const activeBranch = branches.length > 1 && branches.some(b => b.id === branchId) ? branchId : null
  const filtered = activeBranch ? rows.filter(r => r.branchId === activeBranch) : rows
  const byDate = groupByDate(rows, { branchId: activeBranch })
  const totals = dayTotals(rows, complete, { branchId: activeBranch })
  const verified = totals !== null
  const selected = rows.find(r => r.id === selectedId) || null
  const containsToday = periodContains('month', date, today)

  const goto = (next, focusDate = null) => {
    if (isValidClinicDate(next)) {
      pendingFocusDate.current = focusDate
      setDate(next)
      setSelectedDate(null)
      setSelectedId(null)
    }
  }

  const rowsOn = d => {
    const grouped = byDate.get(d) || []
    // Date-only values are authoritative clinic dates. Don't construct a browser-local
    // Date (which could move a booking to another day around midnight).
    const direct = filtered.filter(a => typeof a.date === 'string' && a.date.slice(0, 10) === d)
    return direct.length > grouped.length ? direct : grouped
  }
  const loadOf = d => (load.key === loadParams.key ? load.days[d] : null)
  const canManage = canSchedule(store)

  const handleRefresh = () => {
    if (!live.current || !sessionKey) return
    detailGeneration.current++; setResolving(false)
    loader.refresh()
    store.appointmentFlow?.refresh()
  }

  const resolveAppointment = async row => {
    const res = await getAppointment(row.id)
    if (!res.ok) throw Error(res.message || 'The appointment could not be loaded. Refresh and try again.')
    if (res.data?.id !== row.id || res.data.branch?.id !== row.branchId || !res.data.patient?.id ||
      !res.data.service?.id || !Number.isInteger(res.data.revision) || res.data.revision < 1) {
      throw Error('The appointment could not be matched to this selection. Refresh and review it again.')
    }
    return mapAppointment(res.data)
  }

  const startAction = async (a, action, select) => {
    if (!canSchedule(store, a.branchId)) return
    const request = ++detailGeneration.current, auth = store.getAuthGeneration?.()
    actionOwner.invalidate(); setActionError(''); setResolving(true)
    setReschedule(null); setCancelling(null); setMissed(null)
    try {
      const full = await resolveAppointment(a)
      if (!live.current || request !== detailGeneration.current || auth !== store.getAuthGeneration?.()) return
      const currentRow = latestRows.current.find(row => row.id === a.id && row.branchId === full.branchId)
      if (!currentRow || currentRow.status !== full.status) { setActionError('This appointment changed. Refresh and review it again.'); return }
      const problem = appointmentActionProblem(store, full, action)
      if (problem) { setActionError(problem); return }
      select(full)
    } catch (error) {
      if (live.current && request === detailGeneration.current && auth === store.getAuthGeneration?.()) setActionError(error.message || 'The appointment could not be loaded. Refresh and try again.')
    } finally { if (live.current && request === detailGeneration.current) setResolving(false) }
  }
  const onStartReschedule = a => startAction(a, 'reschedule', setReschedule)
  const onStartCancel = a => startAction(a, 'cancel', setCancelling)
  const onStartNoShow = a => startAction(a, 'noShow', setMissed)

  const selectDetail = id => {
    detailGeneration.current++; actionOwner.invalidate(); setResolving(false); setSelectedId(id)
  }
  const openNewAppointment = () => {
    detailGeneration.current++; actionOwner.invalidate(); setResolving(false)
    setReschedule(null); setCancelling(null); setMissed(null); setNewOpen(true)
  }
  const runAction = async (action, a, close, command, keepOpen = false) => {
    const problem = appointmentActionProblem(store, a, action)
    if (problem) { if (!keepOpen) close(null); setActionError(problem); return { ok: false, message: problem } }
    const ticket = actionOwner.begin()
    if (!ticket) return
    if (!keepOpen) close(null)
    setActionError('')
    try {
      const result = await command(a)
      if (!actionOwner.current(ticket)) return
      if (result.ok && result.warning) toast(result.warning, 'warning')
      if (!result.ok) setActionError(result.message)
      toast(result.ok ? (action === 'cancel' ? 'Appointment cancelled.' : 'Marked as No-show.') : result.message, result.ok ? 'success' : 'warning')
      if (result.ok) { if (keepOpen) close(null); handleRefresh() }
      return result
    } catch {
      if (!actionOwner.current(ticket)) return
      const message = 'Could not confirm the action. Refresh the appointment before retrying.'
      setActionError(message)
      return { ok: false, kind: 'network', message }
    }
    finally { actionOwner.finish(ticket) }
  }
  const cancel = (selection, key) => runAction('cancel', cancelling, setCancelling, a => store.appointmentFlow.cancel(a, key, selection), true)
  const markNoShow = () => runAction('noShow', missed, setMissed, a => store.appointmentFlow.noShow(a, commandKey()))

  const selectedRows = selectedDate ? rowsOn(selectedDate) : []
  const selectedLoad = selectedDate ? loadOf(selectedDate) : null
  const visibleDayRows = selectedRows.filter(a => {
    if (dayStatusFilter !== 'All' && a.status !== dayStatusFilter) return false
    return true
  })
  const monthControls = <>
    <Button variant="ghost" onClick={() => goto(shiftPeriod('month', date, -1))} aria-label="Previous month">‹ <span className="daycal-nav-text">Previous</span></Button>
    <label className="daycal-date">
      <span>Month</span>
      <input
        type="month"
        value={date.slice(0, 7)}
        onChange={e => /^\d{4}-\d{2}$/.test(e.target.value) && goto(`${e.target.value}-01`)}
        aria-describedby="daycal-heading"
      />
    </label>
    <Button variant="ghost" onClick={() => goto(shiftPeriod('month', date, 1))} aria-label="Next month"><span className="daycal-nav-text">Next</span> ›</Button>
    <Button variant="soft" disabled={containsToday} onClick={() => goto(today, today)}>Today</Button>
  </>

  return <>
    <PageHeader
      title="Calendar"
      text="Appointments by clinic date, with authorized details and actions."
      aside={role==='staff'?undefined:<div className="row-actions"><RefreshButton onClick={handleRefresh}/></div>}
    />
    {(resolving || actionOwner.busy) && <p role="status">{resolving ? 'Loading selected appointment…' : 'Saving appointment change…'}</p>}
    {actionError && <p role="alert">{actionError}</p>}

    <Card className="daycal-controls">
      <div className="daycal-bar">
        {role === 'staff' ? <div className="daycal-period-controls">{monthControls}</div> : monthControls}
        {branches.length > 1 && <label className="daycal-branch">
          <span className="sr-only">Authorized branch</span>
          <select aria-label="Filter calendar by authorized branch" title="Only branches assigned to your account appear here" value={activeBranch ?? 'all'} onChange={e => setBranchId(e.target.value)}>
            <option value="all">All authorized branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>}
      </div>
    </Card>

    {role==='staff' && load.key===loadParams.key && load.error &&
      <p role="alert" className="staff-r15-capacity-status">{load.error} <button type="button" onClick={() => setCapacityRetry(value => value + 1)}>Retry capacity</button></p>}
    {role==='staff' && <details className="staff-r13-capacity-key"><summary>Capacity key</summary>
    <div className="daycal-legend" aria-label="Scheduled dentist time utilization">
      <span className="daycal-load is-free"><i aria-hidden="true"/>0% booked</span>
      <span className="daycal-load is-light"><i aria-hidden="true"/>1–49%</span>
      <span className="daycal-load is-busy"><i aria-hidden="true"/>50–{crowdedThreshold - 1}%</span>
      <span className="daycal-load is-crowded"><i aria-hidden="true"/>{crowdedThreshold}%+ booked</span>
      <span className="daycal-load is-closed"><i aria-hidden="true"/>Closed</span>
      <small>Booked minutes / published Dentist hours</small>
      {load.note && <small className="daycal-estimate" role="note">{load.note}</small>}
    </div></details>}
    {role!=='staff' && <div className="daycal-legend" aria-label="Scheduled dentist time utilization">
      <span className="daycal-load is-free"><i aria-hidden="true"/>0% booked</span>
      <span className="daycal-load is-light"><i aria-hidden="true"/>1–49%</span>
      <span className="daycal-load is-busy"><i aria-hidden="true"/>50–{crowdedThreshold - 1}%</span>
      <span className="daycal-load is-crowded"><i aria-hidden="true"/>{crowdedThreshold}%+ booked</span>
      <span className="daycal-load is-closed"><i aria-hidden="true"/>Closed</span>
      <small>Booked minutes / published Dentist hours</small>
      {load.note && <small className="daycal-estimate" role="note">{load.note}</small>}
    </div>}

    <h2 id="daycal-heading" className="daycal-heading" tabIndex={-1} aria-live="polite" aria-atomic="true">
      {monthTitle(date)}{containsToday && <span className="daycal-today"> · This month</span>}
    </h2>

    {status === 'loading' && <p className="daycal-loading" role="status">Loading this month's appointments…</p>}
    {status === 'error' && <Notice tone="warning" title="Appointments couldn’t be loaded">{current.error} <Button size="sm" variant="ghost" onClick={() => loader.retry()}>Try again</Button></Notice>}
    {status === 'ready' && !current.complete && <Notice tone="warning" title="Only part of this month was loaded">This month has more appointments than this screen reads at once, so what is shown may be missing some. No totals are shown, and a date without appointments here is not confirmed empty. <Button size="sm" variant="ghost" onClick={() => loader.retry()}>Reload</Button></Notice>}
    {status === 'ready' && current.stale && <Notice tone="warning" title="Showing the last loaded list">The latest refresh failed: {current.error} This list may be out of date. <Button size="sm" variant="ghost" onClick={() => loader.retry()}>Try again</Button></Notice>}

    {complete && <p className="daycal-month-summary" role="status">
      {filtered.length ? `${filtered.length} appointment${filtered.length === 1 ? '' : 's'} this month` : activeBranch && rows.length ? `No appointments at this branch; ${rows.length} at other assigned branches` : 'No appointments scheduled this month'}
    </p>}

    <div className="daycal-master-detail">
      <div className="daycal-calendar-pane">
        <div ref={calendarRef} key={role === 'staff' ? target : undefined} className="daycal-month-grid" role="grid" aria-busy={status === 'loading'} aria-label={`${monthTitle(date)} by day`}>
          {WEEKDAYS.map(w => <div key={w} className="daycal-weekday" aria-hidden="true">{w.slice(0, 3)}</div>)}
          {monthCells(date).map(c => {
            if (!c.fetched) return <div key={c.date} className="daycal-cell is-outside" role="gridcell">
              <button type="button" className="daycal-daylink" data-calendar-date={c.date}
                aria-label={`Show calendar for ${longDate(c.date)}`}
                onClick={() => goto(c.date, c.date)}>{Number(c.date.slice(8))}</button>
              <span className="sr-only">Outside displayed month</span>
            </div>
            const list = rowsOn(c.date)
            const shown = list.slice(0, 3)
            const band = loadBand(loadOf(c.date), crowdedThreshold)
            const isSelected = selectedDate === c.date
            const isPrior = c.date < today

            return <div
              key={c.date}
              className={`daycal-cell${c.date === today ? ' is-today' : ''}${isPrior ? ' past-day is-past' : ''}${isSelected ? ' is-selected' : ''}${band ? ` load-${band.band}` : ''}`}
              onClick={e => {
                e.currentTarget.querySelector('.daycal-daylink')?.focus()
                setSelectedDate(prev => prev === c.date ? null : c.date)
              }}
              role="gridcell"
              aria-selected={isSelected}
            >
              <div className="daycal-cell-head">
                <button
                  type="button"
                  className="daycal-daylink"
                  data-calendar-date={c.date}
                  aria-expanded={isSelected}
                  aria-controls="daycal-day-details"
                  aria-current={c.date === today ? 'date' : undefined}
                  onClick={e => { e.stopPropagation(); setSelectedDate(prev => prev === c.date ? null : c.date) }}
                  aria-label={`${isSelected ? 'Hide' : 'Show'} ${longDate(c.date)}: ${verified ? `${list.length} appointment${list.length === 1 ? '' : 's'}` : 'appointment count not confirmed'}${band ? `, ${band.label}` : ''}`}
                >
                  {Number(c.date.slice(8))}
                </button>
                {c.date === today && <span className="daycal-today daycal-today-tag">Today</span>}
                {totals && list.length > 0 && <span className="daycal-count" aria-label={`${list.length} appointment${list.length === 1 ? '' : 's'}`}>{list.length}</span>}
              </div>

              {(band?.band === 'closed' || band?.band === 'none') && <div className="daycal-cell-meta">
                <LoadBadge day={loadOf(c.date)} count={list.length} crowded={crowdedThreshold}/>
              </div>}

              <div className="daycal-cell-chips daycal-avatars-row" aria-label={`${list.length} appointments`}>
                {shown.map(a => <AppointmentAvatarButton key={a.id} a={a} onSelect={selectDetail}/>)}
                {complete && list.length > shown.length && <button type="button" className="daycal-avatar-badge daycal-more-avatar" title={`+${list.length - shown.length} more appointments`} aria-label={`Show ${list.length - shown.length} more appointments for ${longDate(c.date)}`} aria-controls="daycal-day-details" aria-expanded={isSelected} onClick={e => { e.stopPropagation(); setSelectedDate(c.date) }}>+{list.length - shown.length}</button>}
              </div>
            </div>
          })}
        </div>
      </div>

      <aside id="daycal-day-details" className="daycal-details-pane">
        {selectedDate ? (
          <Card className="daycal-expanded-day" aria-labelledby="daycal-selected-heading">
            <div className="daycal-expanded-header">
              <div>
                <h3 id="daycal-selected-heading" className="daycal-expanded-title">
                  {longDate(selectedDate)}
                  {selectedDate === today && <span className="daycal-today daycal-today-tag">Today</span>}
                </h3>
                <p className="daycal-expanded-meta">
                  {verified
                    ? (selectedRows.length === 0 ? 'No appointments scheduled on this date.' : `${selectedRows.length} appointment${selectedRows.length === 1 ? '' : 's'} scheduled`)
                    : 'Reading appointment details from the clinic server…'}
                  {selectedLoad?.closed && ` · Closed (${selectedLoad.reason || 'Closed'})`}
                </p>
              </div>
              <div className="row-actions">
                <Button size="sm" variant="ghost" onClick={() => {
                  calendarRef.current?.querySelector(`[data-calendar-date="${selectedDate}"]`)?.focus()
                  setSelectedDate(null)
                }}>Close</Button>
              </div>
            </div>

            {verified && selectedRows.length === 0 && <div className="daycal-expanded-empty">
              <p className="muted-copy">No appointments are scheduled for this date.</p>
              {canManage && !selectedLoad?.closed && <Button size="sm" variant="soft" onClick={openNewAppointment} icon="plusCalendar">New appointment</Button>}
            </div>}

            {selectedRows.length > 0 && <div className="daycal-day-filter">
              <select
                id="daycal-status-filter"
                className="filter-select"
                aria-label="Filter selected day appointments by status"
                value={dayStatusFilter}
                onChange={e => setDayStatusFilter(e.target.value)}
              >
                <option value="All">All statuses ({selectedRows.length})</option>
                <option value="Confirmed">Confirmed</option>
                <option value="Pending">Pending</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
                <option value="No-show">No-show</option>
              </select>
            </div>}

            {selectedRows.length > 0 && visibleDayRows.length === 0 && <div className="daycal-expanded-empty">
              <p className="muted-copy">No appointments with status &ldquo;{dayStatusFilter}&rdquo; on this date.</p>
            </div>}

            {visibleDayRows.length > 0 && <ul className="daycal-expanded-list">
              {visibleDayRows.map(a => <li key={a.id} className="daycal-expanded-card">
                <div className="daycal-expanded-main">
                  <PatientAvatar a={a}/>
                  <div className="daycal-expanded-info">
                    <div className="daycal-expanded-patient">
                      <strong>{appointmentName(a)}</strong>
                      {a.patientCode && <small className="block-muted">{a.patientCode}</small>}
                    </div>
                    <div className="daycal-expanded-time">
                      <span className="daycal-time-badge">{displayTime(a.start)}–{displayTime(a.end)}</span>
                      {a.duration && <small className="block-muted">({a.duration} min)</small>}
                    </div>
                    <div className="daycal-expanded-details">
                      <span className="daycal-service-name">{a.serviceName || 'Service unavailable'}</span>
                      <span className="daycal-meta-dot" aria-hidden="true">·</span>
                      <span className="daycal-dentist-name">{a.dentistName || (a.dentistId ? 'Dentist name unavailable' : 'Unassigned Dentist')}</span>
                      {branches.length > 1 && a.branchName && <>
                        <span className="daycal-meta-dot" aria-hidden="true">·</span>
                        <span className="daycal-branch-name">{a.branchName}</span>
                      </>}
                    </div>
                  </div>
                  <div className="daycal-expanded-status">
                    <Status>{a.status}</Status>
                  </div>
                </div>
                <div className="daycal-expanded-actions">
                  <Button size="sm" variant="ghost" onClick={() => selectDetail(a.id)}>Details</Button>
                  {canManage && ['Confirmed', 'Pending'].includes(a.status) && <>
                    <Button size="sm" variant="soft" onClick={() => onStartReschedule(a)}>Reschedule</Button>
                    <Button size="sm" variant="ghost" disabled={actionOwner.busy} onClick={() => onStartCancel(a)}>Cancel</Button>
                    {a.date === clinicDate() && <Button size="sm" variant="ghost" disabled={actionOwner.busy} onClick={() => onStartNoShow(a)}>No-show</Button>}
                  </>}
                </div>
              </li>)}
            </ul>}
          </Card>
        ) : (
          <Card className="daycal-expanded-day daycal-details-empty">
            <div className="daycal-expanded-header">
              <div>
                <h3 className="daycal-expanded-title">Day Schedule</h3>
                <p className="daycal-expanded-meta">Select a date on the calendar</p>
              </div>
            </div>
            <div className="daycal-expanded-empty">
              <p className="muted-copy">Select a calendar date to inspect scheduled appointments and dentist capacity.</p>
              <Button size="sm" variant="soft" onClick={() => {
                if (!containsToday) goto(today, today)
                else calendarRef.current?.querySelector(`[data-calendar-date="${today}"]`)?.focus()
                setSelectedDate(today)
              }}>View Today ({shortDay(today)})</Button>
            </div>
          </Card>
        )}
      </aside>
    </div>

    <Modal open={newOpen} title="New appointment" wide onClose={() => setNewOpen(false)}>
      <AppointmentForm role={role} store={store} prefill={selectedDate ? { date: selectedDate, ...(activeBranch && activeBranch !== 'all' ? { branchId: activeBranch } : {}) } : null} onSaved={() => { setNewOpen(false); handleRefresh() }}/>
    </Modal>

    <Modal open={!!reschedule} title="Reschedule appointment" subtitle="The new time must pass the same conflict-prevention rules as a new booking." wide onClose={() => setReschedule(null)}>
      {reschedule && <AppointmentForm role={role} store={store} appointment={reschedule} submitLabel="Save new time" onSaved={() => { setReschedule(null); handleRefresh() }}/>}
    </Modal>

    {cancelling && <StaffCancellationDialog key={cancelling.id} appointment={cancelling} operationKeys={cancellationKeys.current}
      selectionDetailsAvailable={store.session?.selectionDetailsAvailable === true}
      onCancel={() => { setCancelling(null); handleRefresh() }} onConfirm={cancel}/> }

    <ConfirmDialog open={!!missed} title="Mark as No-show?" confirmLabel="Mark No-show" cancelLabel="Keep appointment" tone="danger" onConfirm={markNoShow} onCancel={() => setMissed(null)}>
      {missed && <p>{missed.code || missed.appointmentNo} • today at {displayTime(missed.start)} • {appointmentName(missed)}. Use this only when the patient did not arrive; no visit is created. A patient who has already checked in can’t be marked No-show.</p>}
    </ConfirmDialog>

    <Modal open={!!selected} title="Appointment details" subtitle="Clinic appointment record from the clinic server." wide onClose={() => setSelectedId(null)}>
      {selected && (
        <div className="appt-detail-container">
          <div className="appt-detail-header-card">
            <div className="appt-detail-header-left" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="daycal-avatar appt-detail-avatar" aria-hidden="true" style={{ background: avatarColour(selected.patientId || selected.patientCode), width: '40px', height: '40px', fontSize: '15px' }}>
                {initials(selected.patientName)}
              </span>
              <div>
                <h3 className="appt-detail-patient-name" style={{ margin: '0 0 2px', fontSize: '17px', fontWeight: 700 }}>{appointmentName(selected)}</h3>
                <div className="appt-detail-meta-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--muted)' }}>
                  {selected.patientCode && <span className="appt-detail-code">{selected.patientCode}</span>}
                  <span className="appt-detail-code-badge" style={{ padding: '1px 6px', background: 'var(--surface-2, #e2e8f0)', borderRadius: '4px', fontWeight: 600 }}>{selected.code || selected.appointmentNo || '—'}</span>
                </div>
              </div>
            </div>
            <div className="appt-detail-header-right" style={{ textAlign: 'right' }}>
              <Status>{selected.status}</Status>
              <small className="block-muted" style={{ display: 'block', marginTop: '4px', fontSize: '11px' }}>{statusMeaning(selected.status)}</small>
            </div>
          </div>

          <div className="appt-detail-grid">
            <div className="appt-detail-section">
              <h4 className="appt-detail-section-title">Schedule & Location</h4>
              <div className="appt-detail-row">
                <span className="appt-detail-label">Date</span>
                <span className="appt-detail-value font-semibold">{longDate(selected.date)}</span>
              </div>
              <div className="appt-detail-row">
                <span className="appt-detail-label">Time slot</span>
                <span className="appt-detail-value">{displayTime(selected.start)} – {displayTime(selected.end)} {selected.duration ? `(${selected.duration} min)` : ''}</span>
              </div>
              <div className="appt-detail-row">
                <span className="appt-detail-label">Branch</span>
                <span className="appt-detail-value">{selected.branchName || '—'}</span>
              </div>
            </div>

            <div className="appt-detail-section">
              <h4 className="appt-detail-section-title">Clinical & Care</h4>
              <div className="appt-detail-row">
                <span className="appt-detail-label">Service</span>
                <span className="appt-detail-value font-semibold">{selected.serviceName || '—'}</span>
              </div>
              {selected.intendedServiceName && <div className="appt-detail-row">
                <span className="appt-detail-label">Intended treatment</span>
                <span className="appt-detail-value">{selected.intendedServiceName}</span>
              </div>}
              <div className="appt-detail-row">
                <span className="appt-detail-label">Attending Dentist</span>
                <span className="appt-detail-value">{selected.dentistId ? selected.dentistName || '—' : 'Unassigned'}</span>
              </div>
              <div className="appt-detail-row">
                <span className="appt-detail-label">Booking channel</span>
                <span className="appt-detail-value">{sourceLabel(selected.source)}</span>
              </div>
            </div>
          </div>

          <div className="appt-detail-footer-bar">
            <div className="appt-detail-payment-status">
              <span className="appt-detail-label" style={{ marginRight: '6px' }}>Booking payment:</span>
              <span className="appt-detail-value font-semibold">
                {selected.bookingPaymentStatus === 'paid'
                  ? `Deposit paid${selected.bookingPaymentMethod ? ` (${selected.bookingPaymentMethod})` : ''}`
                  : selected.bookingPaymentStatus === 'held'
                  ? 'Pre-authorized (held)'
                  : selected.bookingPaymentStatus === 'refunded'
                  ? 'Refunded'
                  : selected.bookingPaymentStatus === 'forfeited'
                  ? 'Forfeited'
                  : selected.bookingPaymentStatus === 'unpaid' ? 'Unpaid' : 'Payment status unavailable'}
              </span>
            </div>
            <div className="appt-detail-actions" style={{ display: 'flex', gap: '8px' }}>
              {canManage && ['Confirmed', 'Pending'].includes(selected.status) && (
                <>
                  <Button size="sm" variant="soft" onClick={() => { const s = selected; setSelectedId(null); onStartReschedule(s) }}>
                    Reschedule
                  </Button>
                  <Button size="sm" variant="ghost" disabled={actionOwner.busy} onClick={() => { const s = selected; setSelectedId(null); onStartCancel(s) }}>
                    Cancel
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  </>
}

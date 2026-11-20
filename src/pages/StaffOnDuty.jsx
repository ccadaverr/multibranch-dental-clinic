import React from 'react'
import { Card, IconAction, Notice, ReadState } from '../components.jsx'
import { workSchedulesDuty } from '../api-client.js'
import { clinicDate } from '../clock.js'
import { dutyProjection, dutyRowsForSelection } from '../work-hours-duty.js'
import { useVisibleRefresh } from '../use-visible-refresh.js'
import { DUTY_READ_BUDGET_MS } from '../read-performance.js'
import '../stf07-on-duty.css'

/** Read-only Staff view of the server's branch-scoped scheduling projection. */
export function StaffOnDuty(props) {
  const s = props.session
  const identity = JSON.stringify([props.getAuthGeneration?.(), s?.serverUserId, s?.userId, s?.role, s?.active, s?.branchScopes])
  return <StaffDutySession key={identity} {...props}/>
}

function StaffDutySession({ session, activeBranch, getAuthGeneration }) {
  const auth = getAuthGeneration?.()
  const [day, setDay] = React.useState(clinicDate)
  const [snapshot, setSnapshot] = React.useState({ status: 'loading', duty: null, error: '', durationMs: null })
  const request = React.useRef(0), live = React.useRef(false), pending = React.useRef(null), observedDay = React.useRef(day)
  const active = !!session?.serverUserId && session.active === true && session.role === 'staff' &&
    Array.isArray(session.branchScopes) && (!getAuthGeneration || auth != null)
  const owns = () => live.current && active && auth === getAuthGeneration?.()
  React.useLayoutEffect(() => { live.current = true; return () => { live.current = false; request.current++; pending.current?.controller?.abort(); pending.current = null } }, [])

  const load = React.useCallback(async () => {
    if (!owns() || pending.current) return false
    // A read-only request must not leave an indefinite spinner on a slow dev DB.
    // Aborting this GET never changes duty or published rosters.
    const controller = new AbortController()
    const startedAt = globalThis.performance?.now?.() ?? Date.now()
    const ticket = {id: ++request.current, day: clinicDate(), controller, timedOut: false}
    pending.current = ticket
    let timeout
    setSnapshot(previous => ({ ...previous, status: previous.duty ? 'refreshing' : 'loading' }))
    try {
      const timeoutResult = new Promise(resolve => {
        timeout = setTimeout(() => { ticket.timedOut = true; controller.abort(); resolve({ timedOut: true }) }, DUTY_READ_BUDGET_MS)
      })
      const result = await Promise.race([workSchedulesDuty(controller.signal), timeoutResult])
      if (!live.current || ticket.id !== request.current) return false
      if (result?.timedOut && ticket.timedOut) {
        setSnapshot({ status: 'error', duty: null, error: 'Duty status did not load within 2 seconds. Retry when the connection is ready.', durationMs: DUTY_READ_BUDGET_MS })
        return false
      }
      if (!owns()) { setSnapshot({status:'error',duty:null,error:'Your session changed. Refresh your session before viewing duty status.',durationMs:null}); return false }
      const durationMs = Math.max(0, Math.round((globalThis.performance?.now?.() ?? Date.now()) - startedAt))
      if (ticket.timedOut || durationMs > DUTY_READ_BUDGET_MS) {
        setSnapshot({ status: 'error', duty: null, error: 'Duty status did not load within 2 seconds. Retry when the connection is ready.', durationMs })
        return false
      }
      const duty = ticket.day === clinicDate() && dutyProjection(result?.data?.duty, clinicDate(), session.branchScopes)
      if (result?.ok && duty) { setSnapshot({ status: 'ready', duty, error: '', durationMs }); return true }
      setSnapshot({ status: result?.kind === 'forbidden' ? 'forbidden' : 'error', duty: null, durationMs,
        error: result?.kind === 'forbidden' ? 'You do not have access to Dentist duty status.' : 'Duty status could not be verified. Try again.' })
      return false
    } catch {
      if (owns() && ticket.id === request.current) setSnapshot({status:'error',duty:null,error:ticket.timedOut ? 'Duty status did not load within 2 seconds. Retry when the connection is ready.' : 'Duty status could not be verified. Try again.',durationMs:Math.max(0, Math.round((globalThis.performance?.now?.() ?? Date.now()) - startedAt))})
      return false
    } finally { clearTimeout(timeout); if (pending.current === ticket) pending.current = null }
  }, [active, auth, getAuthGeneration])

  React.useEffect(() => { load() }, [load, day])
  React.useEffect(() => {
    const timer = setInterval(() => {
      const today = clinicDate()
      if (observedDay.current !== today) {
        observedDay.current = today; request.current++; pending.current?.controller?.abort(); pending.current = null; setDay(today)
      }
    }, 15000)
    return () => clearInterval(timer)
  }, [])
  useVisibleRefresh(load, { active, intervalMs: 60000 })

  const duty = snapshot.duty?.date === day ? snapshot.duty : null
  const rows = dutyRowsForSelection(duty, activeBranch)
  return <Card title="Dentists on duty" className="stf07-duty top-gap" actions={<IconAction icon="refresh" label="Refresh duty status" className="stf07-duty-refresh" onClick={load} disabled={!active || snapshot.status === 'loading' || snapshot.status === 'refreshing'} aria-busy={snapshot.status === 'loading' || snapshot.status === 'refreshing'}/>}>
    {!active && <Notice tone="info">Sign in to the clinic server to verify today’s Dentist duty status.</Notice>}
    {active && (snapshot.status === 'loading' || !duty && snapshot.status === 'refreshing') && <ReadState compact state="loading" message="Checking today’s duty status…"/>}
    {active && ['forbidden', 'error'].includes(snapshot.status) && <ReadState compact state="error" message={snapshot.error}/>}
    {active && duty && <>
      {snapshot.status === 'refreshing' && <span className="sr-only" role="status">Refreshing duty status…</span>}
      {rows === null ? <div role="alert"><Notice tone="warning">This branch name matches more than one branch. Duty status is unavailable for this selection.</Notice></div> : !rows.length ? <p className="muted-copy" role="status">No Dentist duty rows were returned for the selected branch.</p> :
        <ul className="stf07-duty-list">{rows.map(row => <li key={`${row.dentist_id}:${row.branch_id}`}>
          <div><b>{row.dentist_name}</b>{rows.some(item => item.branch_id!==row.branch_id) && <small>{row.branch_name}</small>}</div>
          <div className="stf07-duty-status"><span className={`fd-badge ${row.on_duty_today ? 'is-ok' : 'is-muted'}`}>{row.on_duty_today ? 'On duty today' : 'Off duty'}</span>
            {row.on_duty_today && <small>{row.working_now ? 'Working now' : 'Not working now'}</small>}
            {row.estimated && <small>Estimated from profile hours; weekday roster not confirmed.</small>}</div>
        </li>)}</ul>}
      <small className="stf07-duty-asof">Clinic date: {duty.date} · Updated {new Date(duty.as_of).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })}{Number.isFinite(snapshot.durationMs) ? ` · Verified in ${snapshot.durationMs} ms` : ''}</small><small className="sr-only" data-duty-load-ms={Number.isFinite(snapshot.durationMs) ? snapshot.durationMs : undefined}>{Number.isFinite(snapshot.durationMs) ? `${snapshot.durationMs} ms` : ''}</small>
    </>}
  </Card>
}

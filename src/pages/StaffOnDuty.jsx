import React from 'react'
import { RefreshButton, Card, Notice } from '../components.jsx'
import { workSchedules } from '../api-client.js'
import { clinicDate } from '../clock.js'
import { dutyProjection } from '../work-hours-duty.js'
import { useVisibleRefresh } from '../use-visible-refresh.js'
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
  const [snapshot, setSnapshot] = React.useState({ status: 'loading', duty: null, error: '' })
  const request = React.useRef(0), live = React.useRef(false), pending = React.useRef(null), observedDay = React.useRef(day)
  const active = !!session?.serverUserId && session.active === true && session.role === 'staff' &&
    Array.isArray(session.branchScopes) && (!getAuthGeneration || auth != null)
  const owns = () => live.current && active && auth === getAuthGeneration?.()
  React.useLayoutEffect(() => { live.current = true; return () => { live.current = false; request.current++; pending.current = null } }, [])

  const load = React.useCallback(async () => {
    if (!owns() || pending.current) return false
    const ticket = {id: ++request.current, day: clinicDate()}
    pending.current = ticket
    setSnapshot(previous => ({ ...previous, status: previous.duty ? 'refreshing' : 'loading' }))
    try {
      const result = await workSchedules()
      if (!live.current || ticket.id !== request.current) return false
      if (!owns()) { setSnapshot({status:'error',duty:null,error:'Your session changed. Refresh your session before viewing duty status.'}); return false }
      const duty = ticket.day === clinicDate() && dutyProjection(result?.data?.duty, clinicDate(), session.branchScopes)
      if (result?.ok && duty) { setSnapshot({ status: 'ready', duty, error: '' }); return true }
      setSnapshot({ status: result?.kind === 'forbidden' ? 'forbidden' : 'error', duty: null,
        error: result?.kind === 'forbidden' ? 'You do not have access to Dentist duty status.' : 'Duty status could not be verified. Try again.' })
      return false
    } catch {
      if (owns() && ticket.id === request.current) setSnapshot({status:'error',duty:null,error:'Duty status could not be verified. Try again.'})
      return false
    } finally { if (pending.current === ticket) pending.current = null }
  }, [active, auth, getAuthGeneration])

  React.useEffect(() => { load() }, [load, day])
  React.useEffect(() => {
    const timer = setInterval(() => {
      const today = clinicDate()
      if (observedDay.current !== today) {
        observedDay.current = today; request.current++; pending.current = null; setDay(today)
      }
    }, 15000)
    return () => clearInterval(timer)
  }, [])
  useVisibleRefresh(load, { active, intervalMs: 60000 })

  const duty = snapshot.duty?.date === day ? snapshot.duty : null
  const rows = duty?.rows.filter(row => activeBranch === 'All Branches' || row.branch_name === activeBranch) || []
  return <Card title="Dentists on duty today" subtitle="Based on branch hours, work schedules, closures and approved leave." className="stf07-duty top-gap"
    actions={active && <RefreshButton title="Refresh duty status" ariaLabel="Refresh duty status" onClick={load} loading={['loading', 'refreshing'].includes(snapshot.status)}/> }>
    {!active && <Notice tone="info">Sign in to the clinic server to verify today’s Dentist duty status.</Notice>}
    {active && (snapshot.status === 'loading' || !duty && snapshot.status === 'refreshing') && <p role="status">Checking today’s duty status…</p>}
    {active && ['forbidden', 'error'].includes(snapshot.status) && <Notice tone="warning">{snapshot.error}</Notice>}
    {active && duty && <>
      {snapshot.status === 'refreshing' && <p role="status">Refreshing duty status…</p>}
      {!rows.length ? <p className="muted-copy" role="status">No Dentist duty rows were returned for the selected branch.</p> :
        <ul className="stf07-duty-list">{rows.map(row => <li key={`${row.dentist_id}:${row.branch_id}`}>
          <div><b>{row.dentist_name}</b><small>{row.branch_name}</small></div>
          <div className="stf07-duty-status"><span className={`fd-badge ${row.on_duty_today ? 'is-ok' : 'is-muted'}`}>{row.on_duty_today ? 'On duty today' : 'Off duty'}</span>
            {row.on_duty_today && <small>{row.working_now ? 'Working now' : 'Not working now'}</small>}
            {row.estimated && <small>Estimated from profile hours; weekday roster not confirmed.</small>}</div>
        </li>)}</ul>}
      <small className="stf07-duty-asof">Clinic date: {duty.date} · Updated {new Date(duty.as_of).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })} (Manila)</small>
    </>}
  </Card>
}

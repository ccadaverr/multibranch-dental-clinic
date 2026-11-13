import React from 'react'
import { RefreshButton, Card, Notice } from '../components.jsx'
import { workSchedules } from '../api-client.js'
import { clinicDate } from '../clock.js'
import { useVisibleRefresh } from '../use-visible-refresh.js'
import '../stf07-on-duty.css'

/** Read-only Staff view of the server's branch-scoped scheduling projection. */
export function StaffOnDuty({ session, activeBranch }) {
  const [day, setDay] = React.useState(clinicDate)
  const [snapshot, setSnapshot] = React.useState({ status: 'loading', duty: null, error: '' })
  const request = React.useRef(0)
  const active = !!session?.serverUserId

  const load = React.useCallback(async () => {
    if (!active) return
    const id = ++request.current
    setSnapshot(previous => ({ ...previous, status: previous.duty ? 'refreshing' : 'loading' }))
    const result = await workSchedules()
    if (id !== request.current) return
    const duty = result.data?.duty
    if (result.ok && duty?.date === clinicDate() && Array.isArray(duty.rows)) {
      setSnapshot({ status: 'ready', duty, error: '' })
    } else {
      setSnapshot({ status: result.kind === 'forbidden' ? 'forbidden' : 'error', duty: null,
        error: result.kind === 'forbidden' ? 'You do not have access to Dentist duty status.' : result.message || 'Duty status could not be verified. Try again.' })
    }
  }, [active])

  React.useEffect(() => { load(); return () => { request.current++ } }, [load, day])
  React.useEffect(() => {
    const timer = setInterval(() => setDay(clinicDate()), 15000)
    return () => clearInterval(timer)
  }, [])
  useVisibleRefresh(load, { active, intervalMs: 60000 })

  const duty = snapshot.duty?.date === day ? snapshot.duty : null
  const rows = duty?.rows.filter(row => activeBranch === 'All Branches' || row.branch_name === activeBranch) || []
  return <Card title="Dentists on duty today" subtitle="Based on branch hours, work schedules, closures and approved leave." className="stf07-duty top-gap"
    actions={active && <RefreshButton title="Refresh duty status" ariaLabel="Refresh duty status" onClick={load} loading={['loading', 'refreshing'].includes(snapshot.status)}/>}>
    {!active && <Notice tone="info">Sign in to the clinic server to verify today’s Dentist duty status.</Notice>}
    {active && (snapshot.status === 'loading' || !duty && snapshot.status === 'refreshing') && <p role="status">Checking today’s duty status…</p>}
    {active && ['forbidden', 'error'].includes(snapshot.status) && <Notice tone="warning">{snapshot.error}</Notice>}
    {active && duty && <>
      {snapshot.status === 'refreshing' && <p role="status">Refreshing duty status…</p>}
      {!rows.length ? <p className="muted-copy" role="status">No Dentists are assigned to the selected branch.</p> :
        <ul className="stf07-duty-list">{rows.map(row => <li key={`${row.dentist_id}:${row.branch_id}`}>
          <div><b>{row.dentist_name}</b><small>{row.branch_name}</small></div>
          <div className="stf07-duty-status"><span className={`fd-badge ${row.on_duty_today ? 'is-ok' : 'is-muted'}`}>{row.on_duty_today ? 'On duty today' : 'Off duty'}</span>
            {row.on_duty_today && <small>{row.working_now ? 'Working now' : 'Not working now'}</small>}</div>
        </li>)}</ul>}
      <small className="stf07-duty-asof">Clinic date: {duty.date} · Updated {duty.as_of ? new Date(duty.as_of).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }) : 'recently'} (Manila)</small>
    </>}
  </Card>
}

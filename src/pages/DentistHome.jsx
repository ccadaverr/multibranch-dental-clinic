import React, { useState } from 'react'
import { Button, Card, Icon, Notice, RefreshButton, Status } from '../components.jsx'
import { followups } from '../api-client.js'
import { useVisibleRefresh } from '../use-visible-refresh.js'
import { useQueueVisibility, QueueCountsNotice } from './QueueCounts.jsx'
import { clinicDateLabel, dentistScopeKey, homeClinicalWork, dayAgenda } from '../dentist-workspace.js'
import { displayTime, patientName } from '../logic.js'
import { AppointmentAgenda, AppointmentDetails, ReadState, useClinicDay, useDentistPeriod } from './DentistWorkspace.jsx'

function BranchFollowups({ store, setPage, scope, refreshKey }) {
  const branchId = store.session.branchId
  const [read, setRead] = useState({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  React.useEffect(() => {
    let live = true
    setRead({ status: 'loading' })
    followups({ status: 'active', due: 'all', branch_ref: branchId }).then(r => {
      if (live) setRead(r.ok ? { status: 'ready', rows: (r.data || []).filter(t => t.branch?.id === branchId && ['Open', 'Contacted'].includes(t.status)) } : { status: 'error' })
    })
    return () => { live = false }
  }, [scope, branchId, attempt, refreshKey])
  useVisibleRefresh(() => setAttempt(a => a + 1), { active: !!scope })
  return <Card className="den-panel den-followup-panel" title="Branch follow-ups" subtitle="Shared with the front desk" actions={<button className="den-text-link" type="button" onClick={() => setPage('followups')}>View all<Icon name="chevron" size={15}/></button>}>
    {read.status === 'loading' && <p className="den-muted" role="status">Loading follow-ups...</p>}
    {read.status === 'error' && <p role="alert">Follow-ups are unavailable. <button type="button" className="den-text-link" onClick={() => setAttempt(a => a + 1)}>Try again</button></p>}
    {read.status === 'ready' && (read.rows.length ? <ul className="den-followups">{read.rows.slice(0, 3).map(t => <li key={t.id}><div><strong>{t.patient?.name || 'Patient name unavailable'}</strong><small>{t.due_on ? `Due ${clinicDateLabel(t.due_on, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Due date unavailable'}</small></div><Status>{t.status}</Status></li>)}</ul> : <p className="den-muted">No open follow-ups returned for this branch.</p>)}
  </Card>
}

export function DentistHome({ store, setPage }) {
  const { state, session } = store
  const scope = dentistScopeKey(state, session)
  const date = useClinicDay()
  const appointments = useDentistPeriod(store, 'day', date)
  const visibility = useQueueVisibility(store)
  const [detailId, setDetailId] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  useVisibleRefresh(() => store.appointmentFlow?.refresh(), { active: !!scope })
  if (!scope) return <Notice tone="warning" title="Dentist workspace unavailable">Your current Dentist profile or branch access could not be verified.</Notice>
  const doctor = state.dentists.find(d => d.id === session.dentistId)
  const branch = state.branches.find(b => b.id === session.branchId)
  const clinicalReady = store.appointmentsStatus === 'ready' && !store.appointmentsTruncated && ['ready', 'demo'].includes(visibility.mode)
  const work = clinicalReady ? homeClinicalWork(state, session, date) : null
  const active = work?.active
  const next = work?.ready
  const current = active || next
  const dayRows = dayAgenda(appointments.rows, date)
  const pending = dayRows.filter(a => ['Pending', 'Confirmed'].includes(a.status))
  const refresh = () => { setRefreshKey(key => key + 1); return Promise.all([appointments.retry(), store.appointmentFlow?.refresh()]) }
  return <section className="den-workspace dentist-home" aria-label="Dentist Home">
    <header className="den-page-heading"><div><p className="den-eyebrow">{clinicDateLabel(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} | Asia/Manila</p><h1>Home</h1><p>{branch?.name || 'Assigned branch unavailable'}</p></div><div className="den-heading-actions"><span className="den-duty">{doctor?.on_duty_today === true ? 'On duty today' : doctor?.on_duty_today === false ? 'Off duty today' : 'Duty status unavailable'}</span><RefreshButton ariaLabel="Refresh Home" onClick={refresh}/></div></header>
    <div className="den-home-layout">
        <Card className={`den-panel den-current ${current ? 'has-encounter' : ''}`} title={active ? 'Treatment in progress' : next ? 'Ready for your review' : 'Current encounter'}>
          {!clinicalReady && <><QueueCountsNotice vis={visibility} store={store}/>{['ready', 'demo'].includes(visibility.mode) && <p role="status">{store.appointmentsTruncated ? 'Clinical records are incomplete. Refresh before opening an encounter.' : 'Loading clinical records...'}</p>}</>}
          {clinicalReady && (current ? <><div className="den-current-person"><span className="den-patient-mark" aria-hidden="true"><Icon name="user" size={25}/></span><div><h2>{current.patientName || patientName(current.patientId, state.patients)}</h2><p>{state.branches.find(b => b.id === current.branchId)?.name || 'Branch unavailable'}</p></div><Status>{active ? active.status : next.status}</Status></div><div className="den-current-footer"><span>{active ? 'Continue the existing encounter.' : 'Review the admitted encounter before starting care.'}</span><Button icon="tooth" onClick={() => setPage('treatment', work.context)}>{active ? 'Continue treatment' : 'Open encounter'}</Button></div></> : <div className="den-empty den-empty-inline"><Icon name="tooth" size={26}/><p>No treatment in progress or patient ready for review. Waiting patients appear in My Queue.</p></div>)}
        </Card>
        <Card className="den-panel den-waiting-panel" title="Waiting patients" actions={<button type="button" className="den-text-link" onClick={() => setPage('queue')}>My Queue<Icon name="chevron" size={15}/></button>}>
          {!clinicalReady ? <p className="den-muted">Waiting list unavailable until clinical records refresh.</p> : work.queue.length ? <ul className="den-waiting">{work.queue.slice(0, 4).map(q => <li key={q.id}><span className="den-queue-number">{q.queueNumber != null ? `#${q.queueNumber}` : 'Unavailable'}</span><div><strong>{q.patientName || patientName(q.patientId, state.patients)}</strong><small>{q.checkedIn ? `Checked in ${displayTime(q.checkedIn)}` : 'Check-in time unavailable'}</small></div><Status>{q.status}</Status></li>)}</ul> : <p className="den-muted">No patients awaiting treatment in your queue.</p>}
        </Card>
        <Card className="den-panel den-today-agenda" title="Today's appointments" subtitle="Your assigned patients, in scheduled order" actions={<button className="den-text-link" type="button" onClick={() => setPage('schedule')}>My Schedule<Icon name="chevron" size={15}/></button>}>
          <ReadState read={appointments}/>
          {appointments.status === 'ready' && <><p className="den-agenda-summary">{appointments.complete && !appointments.stale ? `${pending.length} pending or confirmed | ${dayRows.length} scheduled in total` : 'Loaded appointments'}<span>All statuses remain visible below.</span></p><AppointmentAgenda rows={dayRows} empty={appointments.complete && !appointments.stale ? undefined : 'No appointments in the loaded portion. Refresh to retrieve the full day.'} onOpen={setDetailId}/></>}
        </Card>
        <BranchFollowups key={scope} store={store} setPage={setPage} scope={scope} refreshKey={refreshKey}/>
        <button className="den-prescription-link" type="button" onClick={() => setPage('prescriptions')}><Icon name="pill" size={20}/><span>Prescriptions<small>Review and authorize existing drafts</small></span><Icon name="chevron" size={16}/></button>
    </div>
    {detailId && <AppointmentDetails key={`${scope}:${detailId}`} id={detailId} store={store} onClose={() => setDetailId(null)}/>}
  </section>
}

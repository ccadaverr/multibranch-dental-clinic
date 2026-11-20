import React, { useEffect, useMemo, useState } from 'react'
import { Button, Icon, Modal, Notice, ReadState as SharedReadState, Status } from '../components.jsx'
import { clinicDate } from '../clock.js'
import { createDayLoader, mapDayAppointment, periodTarget, statusMeaning } from '../day-calendar.js'
import { fetchAppointment } from '../appointments-api.js'
import { startHomeRead, HomeReadDeadlineError } from '../home-read-deadline.js'
import { useVisibleRefresh } from '../use-visible-refresh.js'
import { clinicDateLabel, dentistScopeKey, ownDentistRows } from '../dentist-workspace.js'
import { displayTime } from '../logic.js'
import '../dentist-workspace.css'

export function useClinicDay() {
  const [date, setDate] = useState(clinicDate)
  useEffect(() => { const timer = setInterval(() => setDate(clinicDate()), 15000); return () => clearInterval(timer) }, [])
  return date
}

// Reuse Staff Calendar's pagination, bounded periods and latest-response gate. Never replace shared store collections.
export function useDentistPeriod(store, view, date) {
  const scope = dentistScopeKey(store.state, store.session)
  const target = periodTarget(view, date)
  const [snapshot, setSnapshot] = useState(null)
  const loader = useMemo(() => createDayLoader({ onChange: setSnapshot }), [scope])
  useEffect(() => {
    if (scope) loader.load(target, scope)
    return () => loader.invalidate()
  }, [loader, target, scope])
  useVisibleRefresh(() => loader.refresh(), { active: !!scope })
  useEffect(() => {
    if (!scope) return
    const refresh = () => loader.refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [loader, scope])
  const current = snapshot?.key === scope && snapshot?.date === target ? snapshot : null
  return { ...current, status: current?.status || 'loading', scope,
    rows: current?.status === 'ready' ? ownDentistRows(current.rows, store.state, store.session) : [],
    retry: () => loader.load(target, scope), refresh: () => loader.refresh() }
}

export function ReadState({ read, label = 'appointments' }) {
  if (read.status === 'loading' || read.status === 'idle') return <SharedReadState state="loading" compact message={`Loading ${label}…`}/>
  if (read.status === 'error') return <SharedReadState state="error" compact message={read.error || `Could not load ${label}.`} onRetry={read.retry}/>
  if (!read.complete || read.stale) return <SharedReadState state={read.stale ? 'stale' : 'incomplete'} compact
    message={read.stale ? 'Showing the last loaded appointments. The latest update failed.' : 'Some appointments may be missing. Complete counts are hidden.'} onRetry={read.retry}/>
  return null
}

export function AppointmentAgenda({ rows, onOpen, empty = 'No appointments scheduled for this day.' }) {
  if (!rows.length) return <div className="den-empty"><Icon name="calendar" size={26}/><p>{empty}</p></div>
  return <ol className="den-agenda">{rows.map(a => <li key={a.id}>
    <div className="den-agenda-time"><time>{displayTime(a.start)}</time>{a.end && <small>{displayTime(a.end)}</small>}</div>
    <div className="den-agenda-person"><strong>{a.patientName || 'Patient name unavailable'}</strong><span>{a.serviceName || 'Service unavailable'}</span>{a.intendedServiceName && <small>Intended treatment: {a.intendedServiceName}</small>}<small>{a.branchName || 'Branch unavailable'}{Number.isFinite(a.duration) ? ` | ${a.duration} min` : ''}</small></div>
    <div className="den-agenda-action"><Status>{a.status}</Status><button type="button" className="den-detail-link" aria-label={`View appointment for ${a.patientName || 'patient'} at ${displayTime(a.start)}`} onClick={() => onOpen(a.id)}>View details<Icon name="chevron" size={15}/></button></div>
  </li>)}</ol>
}

export function AppointmentDetails({ id, store, onClose }) {
  const scope = dentistScopeKey(store.state, store.session)
  const [read, setRead] = useState({ scope, status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setRead({ scope, status: scope ? 'loading' : 'error', error: scope ? '' : 'Your current Dentist access could not be verified.' })
    if (!scope) return () => { live = false }
    const task = startHomeRead(signal => fetchAppointment(id, { signal }), {
      timeoutMs: 12000,
      timeoutMessage: 'Appointment details took too long to load.',
    })
    task.response.then(result => {
      if (!live) return
      if (!result?.ok || !result.row) throw new Error('The appointment could not be verified.')
      const row = mapDayAppointment(result.row)
      if (row.id !== id || !ownDentistRows([row], store.state, store.session).length) {
        throw new Error('This appointment is outside your current access.')
      }
      setRead({ scope, status: 'ready', row })
    }).catch(error => {
      if (!live) return
      setRead({ scope, status: 'error', error: error instanceof HomeReadDeadlineError
        ? 'Appointment details took too long to load. Retry to check the current record.'
        : 'The appointment could not be verified for your current access. Retry or close this view.' })
    })
    return () => { live = false; task.cancel() }
  }, [id, scope, attempt])
  // Access can be revoked before effects run. Never show the previous Dentist's
  // patient details during that transition, even for a single render.
  const current = read.scope === scope && scope ? read : { status: 'error', error: 'Your current Dentist access could not be verified.' }
  const row = current.row
  return <Modal open title="Appointment details" onClose={onClose} className="den-detail-dialog"><div className="den-workspace den-details">
    {current.status === 'loading' && <SharedReadState state="loading" compact message="Loading appointment…"/>}
    {current.status === 'error' && <SharedReadState state="error" compact message={current.error || 'Appointment unavailable.'} onRetry={scope ? () => setAttempt(a => a + 1) : undefined}/>}
    {current.status === 'ready' && <><h2>{row.patientName || 'Patient name unavailable'}</h2><Status>{row.status}</Status><p>{statusMeaning(row.status)}</p><dl>
      <div><dt>When</dt><dd>{clinicDateLabel(row.date)} | {displayTime(row.start)}{row.end ? ` - ${displayTime(row.end)}` : ''}</dd></div>
      <div><dt>Service</dt><dd>{row.serviceName || 'Unavailable'}</dd></div><div><dt>Branch</dt><dd>{row.branchName || 'Unavailable'}</dd></div>
      {row.intendedServiceName && <div><dt>Intended treatment</dt><dd>{row.intendedServiceName}</dd></div>}
      <div><dt>Reference</dt><dd>{row.code || 'Unavailable'}</dd></div>
    </dl><p className="den-muted">Appointment status does not indicate payment settlement. Clinical care opens from the admitted encounter in My Queue.</p>
      <div className="den-details-footer"><Button size="sm" variant="ghost" onClick={() => setAttempt(a => a + 1)}>Refresh details</Button></div>
    </>}
  </div></Modal>
}

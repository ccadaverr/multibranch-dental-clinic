import React, { useEffect, useMemo, useState } from 'react'
import { Button, Icon, Modal, Notice, Status } from '../components.jsx'
import { clinicDate } from '../clock.js'
import { createDayLoader, mapDayAppointment, periodTarget, statusMeaning } from '../day-calendar.js'
import { fetchAppointment } from '../appointments-api.js'
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
  if (read.status === 'loading' || read.status === 'idle') return <p className="den-read-state" role="status">Loading {label}...</p>
  if (read.status === 'error') return <div className="den-read-state" role="alert"><Notice tone="warning" title={`Could not load ${label}`}>{read.error} <Button size="sm" variant="soft" onClick={read.retry}>Try again</Button></Notice></div>
  if (!read.complete || read.stale) return <div className="den-read-state" role="alert"><Notice tone="warning" title={read.stale ? 'Latest refresh failed' : 'Appointment list is incomplete'}>{read.stale ? 'Showing the last loaded appointments. Refresh before acting.' : 'Some appointments may be missing. No complete day counts are shown.'} <Button size="sm" variant="soft" onClick={read.retry}>Try again</Button></Notice></div>
  return null
}

export function AppointmentAgenda({ rows, onOpen, empty = 'No appointments scheduled for this day.' }) {
  if (!rows.length) return <div className="den-empty"><Icon name="calendar" size={26}/><p>{empty}</p></div>
  return <ol className="den-agenda">{rows.map(a => <li key={a.id}>
    <div className="den-agenda-time"><time>{displayTime(a.start)}</time>{a.end && <small>{displayTime(a.end)}</small>}</div>
    <div className="den-agenda-person"><strong>{a.patientName || 'Patient name unavailable'}</strong><span>{a.serviceName || 'Service unavailable'}</span><small>{a.branchName || 'Branch unavailable'}{Number.isFinite(a.duration) ? ` | ${a.duration} min` : ''}</small></div>
    <div className="den-agenda-action"><Status>{a.status}</Status><button type="button" className="den-detail-link" aria-label={`View appointment for ${a.patientName || 'patient'} at ${displayTime(a.start)}`} onClick={() => onOpen(a.id)}>View details<Icon name="chevron" size={15}/></button></div>
  </li>)}</ol>
}

export function AppointmentDetails({ id, store, onClose }) {
  const scope = dentistScopeKey(store.state, store.session)
  const [read, setRead] = useState({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setRead({ status: 'loading' })
    if (!scope) return () => { live = false }
    fetchAppointment(id).then(result => {
      if (!live) return
      if (!result.ok) return setRead({ status: 'error', error: result.message })
      const row = mapDayAppointment(result.row)
      if (row.id !== id || !ownDentistRows([row], store.state, store.session).length) return setRead({ status: 'error', error: 'This appointment is outside your current access.' })
      setRead({ status: 'ready', row })
    })
    return () => { live = false }
  }, [id, scope, attempt])
  const row = read.row
  return <Modal open title="Appointment details" onClose={onClose} className="den-detail-dialog"><div className="den-workspace den-details">
    {read.status === 'loading' && <p role="status">Loading appointment...</p>}
    {read.status === 'error' && <div role="alert"><Notice tone="warning" title="Appointment unavailable">{read.error} <Button variant="soft" onClick={() => setAttempt(a => a + 1)}>Try again</Button></Notice></div>}
    {read.status === 'ready' && <><h2>{row.patientName || 'Patient name unavailable'}</h2><Status>{row.status}</Status><p>{statusMeaning(row.status)}</p><dl>
      <div><dt>When</dt><dd>{clinicDateLabel(row.date)} | {displayTime(row.start)}{row.end ? ` - ${displayTime(row.end)}` : ''}</dd></div>
      <div><dt>Service</dt><dd>{row.serviceName || 'Unavailable'}</dd></div><div><dt>Branch</dt><dd>{row.branchName || 'Unavailable'}</dd></div>
      <div><dt>Reference</dt><dd>{row.code || 'Unavailable'}</dd></div>
    </dl><p className="den-muted">Appointment status does not indicate payment settlement. Clinical care opens from the admitted encounter in My Queue.</p></>}
  </div></Modal>
}

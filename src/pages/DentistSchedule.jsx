import React, { useLayoutEffect, useRef, useState } from 'react'
import { Button, Card, Icon, Notice, RefreshButton, Status } from '../components.jsx'
import { addDays, validDate } from '../clock.js'
import { APPOINTMENT_STATUSES, monthCells, monthRange, shiftPeriod, WEEKDAYS, weekDays } from '../day-calendar.js'
import { calendarKeyTarget, clinicDateLabel, dayAgenda, ownDentistRows } from '../dentist-workspace.js'
import { useQueueVisibility, QueueCountsNotice } from './QueueCounts.jsx'
import { useVisibleRefresh } from '../use-visible-refresh.js'
import { displayTime, patientName } from '../logic.js'
import { AppointmentAgenda, AppointmentDetails, ReadState, useClinicDay, useDentistPeriod } from './DentistWorkspace.jsx'

export function MonthCalendar({ date, today, onChange, read }) {
  const grid = useRef(null), focusDate = useRef(null)
  const navigate = next => { focusDate.current = next; onChange(next) }
  useLayoutEffect(() => {
    if (focusDate.current === date) { grid.current?.querySelector(`[data-date="${date}"]`)?.focus(); focusDate.current = null }
  }, [date])
  return <section className="den-month" aria-label="Appointment calendar">
    <div className="den-month-heading"><h2 aria-live="polite">{clinicDateLabel(date, { month: 'long', year: 'numeric' })}</h2><div><button type="button" aria-label="Previous month" onClick={() => onChange(shiftPeriod('month', date, -1))}><Icon name="chevronLeft" size={18}/></button><button type="button" aria-label="Next month" onClick={() => onChange(shiftPeriod('month', date, 1))}><Icon name="chevron" size={18}/></button></div></div>
    <div className="den-month-weekdays" aria-hidden="true">{WEEKDAYS.map(day => <span key={day}>{day.slice(0, 2)}</span>)}</div>
    <div className="den-month-grid" ref={grid} role="group" aria-label="Choose a calendar day">
      {monthCells(date).map(cell => {
        const showCount = cell.inMonth && read.status === 'ready' && read.complete && !read.stale
        const count = showCount ? read.rows.filter(a => a.date === cell.date).length : null
        return <button key={cell.date} type="button" data-date={cell.date} tabIndex={cell.date === date ? 0 : -1} aria-pressed={cell.date === date} aria-current={cell.date === today ? 'date' : undefined} className={`${cell.inMonth ? '' : 'is-outside'} ${cell.date === today ? 'is-today' : ''}`} aria-label={`${clinicDateLabel(cell.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${count !== null ? `, ${count} appointment${count === 1 ? '' : 's'}` : ''}`} onClick={() => onChange(cell.date)} onKeyDown={event => {
          const next = event.key === 'PageUp' ? shiftPeriod('month', cell.date, -1) : event.key === 'PageDown' ? shiftPeriod('month', cell.date, 1) : calendarKeyTarget(cell.date, event.key)
          if (next) { event.preventDefault(); navigate(next) }
        }}><span>{Number(cell.date.slice(8))}</span>{count > 0 && <i aria-hidden="true"/>}</button>
      })}
    </div>
    <p className="den-calendar-hint"><i aria-hidden="true"/> Scheduled appointments<span>Arrow keys move by day or week.</span></p>
  </section>
}

export function DentistSchedule({ store }) {
  const today = useClinicDay()
  const [date, setDate] = useState(today)
  const [search, setSearch] = useState(''), [status, setStatus] = useState('All'), [detailId, setDetailId] = useState(null)
  const read = useDentistPeriod(store, 'month', monthRange(date).from)
  const queueVisibility = useQueueVisibility(store)
  useVisibleRefresh(() => store.appointmentFlow?.refresh(), { active: !!read.scope && date === today })
  if (!read.scope) return <Notice tone="warning" title="Schedule unavailable">Your current Dentist profile or branch access could not be verified.</Notice>
  const rows = dayAgenda(read.rows, date, { search, status })
  const allDay = dayAgenda(read.rows, date)
  const walkins = ownDentistRows(store.state.queue, store.state, store.session).filter(q => q.walkIn && q.clinicDate === today)
  const walkinsReady = store.appointmentsStatus === 'ready' && ['ready', 'demo'].includes(queueVisibility.mode)
  return <section className="den-workspace dentist-schedule" aria-label="My Schedule">
    <header className="den-page-heading"><div><p className="den-eyebrow">Your clinical calendar | Asia/Manila</p><h1>My Schedule</h1><p>Assigned appointments across your authorized branches.</p></div><RefreshButton ariaLabel="Refresh schedule" onClick={() => Promise.all([read.retry(), store.appointmentFlow?.refresh()])}/></header>
    <div className="den-schedule-layout">
      <div className="den-calendar-panel">
        <MonthCalendar date={date} today={today} onChange={setDate} read={read}/>
        <label className="den-date-picker">Go to date<input type="date" aria-label="Schedule date" value={date} onChange={e => { if (validDate(e.target.value)) setDate(e.target.value) }}/></label>
        <p className="den-muted den-calendar-note">Select a date to review patients. Appointment markers show bookings, not available slots.</p>
      </div>
      <div className="den-schedule-main">
        <div className="den-day-heading"><div><p className="den-eyebrow">{date === today ? 'Today' : date < today ? 'Past appointments' : 'Upcoming appointments'}</p><h2 aria-live="polite"><time dateTime={date}>{clinicDateLabel(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</time></h2></div>
          <div className="den-day-controls"><Button variant="ghost" aria-label="Previous day" onClick={() => setDate(d => addDays(d, -1))}>Previous</Button><Button variant="soft" onClick={() => setDate(today)}>Today</Button><Button variant="ghost" aria-label="Next day" onClick={() => setDate(d => addDays(d, 1))}>Next</Button></div>
        </div>
        <nav className="den-week" aria-label="Schedule week"><button type="button" aria-label="Previous week" onClick={() => setDate(d => addDays(d, -7))}><Icon name="chevronLeft" size={17}/></button><div>{weekDays(date).map(day => <button type="button" key={day} aria-pressed={day === date} aria-label={clinicDateLabel(day, { weekday: 'long', month: 'long', day: 'numeric' })} onClick={() => setDate(day)}><small>{clinicDateLabel(day, { weekday: 'short' })}</small><b>{Number(day.slice(8))}</b></button>)}</div><button type="button" aria-label="Next week" onClick={() => setDate(d => addDays(d, 7))}><Icon name="chevron" size={17}/></button></nav>
        <Card className="den-panel" title="Scheduled patients" subtitle={read.status === 'ready' && read.complete && !read.stale ? `${allDay.length} appointment${allDay.length === 1 ? '' : 's'} | ${rows.length} shown` : 'Appointments for the selected date'}>
          <div className="den-agenda-filters"><label>Find a patient or service<input type="search" value={search} placeholder="Search this day" onChange={e => setSearch(e.target.value)}/></label><label>Status<select aria-label="Filter schedule by status" value={status} onChange={e => setStatus(e.target.value)}><option value="All">All statuses</option>{Object.keys(APPOINTMENT_STATUSES).map(s => <option key={s}>{s}</option>)}</select></label>{(search || status !== 'All') && <button className="den-text-link" type="button" onClick={() => { setSearch(''); setStatus('All') }}>Clear filters</button>}</div>
          <ReadState read={read}/>
          {read.status === 'ready' && <AppointmentAgenda rows={rows} onOpen={setDetailId} empty={search || status !== 'All' ? 'No appointments match these filters.' : read.complete ? 'No appointments scheduled for this day.' : 'No appointments in the loaded portion. Refresh to retrieve the full day.'}/>}
        </Card>
        {date === today && <Card className="den-panel den-walkin-panel" title="Today's walk-in visits" subtitle="Admitted visits, separate from scheduled appointments">
          {!walkinsReady ? <><QueueCountsNotice vis={queueVisibility} store={store}/>{['ready', 'demo'].includes(queueVisibility.mode) && <p role="status">Loading walk-in visits...</p>}</> : walkins.length ? <ul className="den-waiting">{walkins.map(q => <li key={q.id}><span className="den-queue-number">{q.queueNumber != null ? `#${q.queueNumber}` : 'Unavailable'}</span><div><strong>{q.patientName || patientName(q.patientId, store.state.patients)}</strong><small>{store.state.branches.find(b => b.id === q.branchId)?.name || 'Branch unavailable'}{q.checkedIn ? ` | Checked in ${displayTime(q.checkedIn)}` : ''}</small></div><Status>{q.displayStatus || q.status}</Status></li>)}</ul> : <p className="den-muted">No walk-in visits returned for today.</p>}
        </Card>}
      </div>
    </div>
    {detailId && <AppointmentDetails key={`${read.scope}:${detailId}`} id={detailId} store={store} onClose={() => setDetailId(null)}/>}
  </section>
}

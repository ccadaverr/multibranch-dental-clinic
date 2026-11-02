import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Icon } from '../components.jsx'
import { appointmentAvailability, bookingCalendar } from '../api-client.js'
import { dateLong, time12 } from './format.js'
import { ErrorState, Skeleton } from './ui.jsx'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LABEL = { available: 'available', full: 'fully booked', closed: 'closed', off: 'no dentist working', past: 'not bookable', outside: 'outside the booking window' }

/**
 * Month calendar for booking (and rescheduling), in the passport-appointment pattern: closed and fully booked days are disabled and
 * look different, available days are highlighted, today is marked, and the months move only within the online booking window.
 * Every state comes from GET /api/appointments/calendar, i.e. the same rules the booking command enforces.
 */
// `onFullDay` (booking only): a fully booked day stays selectable so the patient can join the waitlist for it (A5).
export function BookingCalendar({ branchId, serviceId, dentistId = null, appointmentId = null, forPatientId = null, value, onChange, onFullDay = null }) {
  const [month, setMonth] = useState(value ? value.slice(0, 7) : null)
  const [state, setState] = useState({ status: 'loading', data: null, error: '' })
  const [attempt, setAttempt] = useState(0)
  const [closedNote, setClosedNote] = useState(null) // F5: the reason of a closed day the patient tapped
  const loaded = useRef(null)
  useEffect(() => {
    const contextKey = selectedMonth => JSON.stringify([branchId, serviceId, dentistId, appointmentId, forPatientId, selectedMonth, attempt])
    if (loaded.current === contextKey(month)) return undefined
    // Once visible data is cleared, the previous key is no longer a usable
    // cache. Returning to it while another request is pending must reload it.
    loaded.current = null
    let live = true
    setState({ status: 'loading', data: null, error: '' })
    setClosedNote(null)
    bookingCalendar({ branch_ref: branchId, service_ref: serviceId, dentist_ref: dentistId, appointment_id: appointmentId, for_patient_id: forPatientId, month }).then(r => {
      if (!live) return
      loaded.current = r.ok ? contextKey(r.data.month) : null
      setState(r.ok ? { status: 'ready', data: r.data, error: '' } : { status: 'error', data: null, error: r.message || 'The calendar could not be loaded.' })
      if (r.ok && !month) setMonth(r.data.month)
    })
    return () => { live = false }
  }, [branchId, serviceId, dentistId, appointmentId, forPatientId, month, attempt])

  const cells = useMemo(() => {
    if (!state.data) return []
    const [y, m] = state.data.month.split('-').map(Number)
    const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
    return [...Array.from({ length: lead }, () => null), ...state.data.days]
  }, [state.data])

  if (state.status === 'error') return <ErrorState text={state.error} onRetry={() => setAttempt(a => a + 1)}/>
  const data = state.data
  const title = data ? new Date(`${data.month}-01T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'Loading…'
  const anyAvailable = data?.days.some(d => d.status === 'available')

  return <div className="pp-cal" aria-busy={state.status === 'loading'}>
    <div className="pp-cal-head">
      <Button size="sm" variant="ghost" aria-label="Previous month" disabled={!data?.previous_month || state.status === 'loading'} onClick={() => setMonth(data.previous_month)}><Icon name="chevronLeft" size={18}/></Button>
      <h3 aria-live="polite">{title}</h3>
      <Button size="sm" variant="ghost" aria-label="Next month" disabled={!data?.next_month || state.status === 'loading'} onClick={() => setMonth(data.next_month)}><Icon name="chevron" size={18}/></Button>
    </div>
    {!data ? <Skeleton lines={5} card={false} label="Loading the calendar"/> : <>
      <div className="pp-cal-grid pp-cal-anim" key={data.month} role="grid" aria-label={`Available days in ${title}`}>
        {WEEKDAYS.map(d => <span key={d} className="pp-cal-dow" role="columnheader" aria-hidden="true">{d}</span>)}
        {cells.map((day, i) => day === null ? <span key={`b${i}`} className="pp-cal-blank" aria-hidden="true"/> : <button
          key={day.date} type="button" role="gridcell"
          className={`pp-cal-day is-${day.status} ${day.date === data.today ? 'is-today' : ''} ${value === day.date ? 'is-selected' : ''}`}
          disabled={day.status !== 'available' && !(onFullDay && day.status === 'full') && !((day.status === 'closed' || day.status === 'off') && day.reason)}
          aria-disabled={day.status === 'closed' || day.status === 'off' ? true : undefined} aria-pressed={value === day.date} title={(day.status === 'closed' || day.status === 'off') && day.reason ? `${day.status === 'off' ? 'Not available' : 'Closed'}: ${day.reason}` : undefined}
          aria-label={`${dateLong(day.date)}, ${LABEL[day.status]}${(day.status === 'closed' || day.status === 'off') && day.reason ? `: ${day.reason}` : ''}${onFullDay && day.status === 'full' ? ', choose to join the waitlist' : ''}${day.date === data.today ? ', today' : ''}`}
          onClick={() => (day.status === 'closed' || day.status === 'off' ? setClosedNote(day) : day.status === 'full' ? onFullDay(day.date) : onChange(day.date))}>
          <span className="pp-cal-num">{Number(day.date.slice(8))}</span>
          {day.status === 'available' && <span className="pp-cal-dot" aria-hidden="true"/>}
        </button>)}
      </div>
      <div className="pp-cal-legend" aria-hidden="true"><span><i className="is-available"/>Available</span><span><i className="is-full"/>Fully booked</span><span><i className="is-closed"/>Closed or no dentist</span><span><i className="is-today"/>Today</span></div>
      {closedNote && <p className="pp-hint pp-closed-note" role="status">{dateLong(closedNote.date)}: {closedNote.status === 'off' ? 'not available' : 'closed'} — {closedNote.reason}</p>}
      {!anyAvailable && <p className="pp-hint">No open days in this month{data.next_month ? ' — try the next month.' : '.'}</p>}
    </>}
  </div>
}

const STANDARD_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
]

/** Time chips for one day, grouped Morning / Afternoon, from GET /api/appointments/availability. */
export function TimeSlots({ branchId, serviceId, dentistId = null, appointmentId = null, forPatientId = null, date, value, onChange }) {
  const [state, setState] = useState({ status: 'loading', slots: [], error: '' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!date) return undefined
    let live = true
    setState({ status: 'loading', slots: [], error: '' })
    appointmentAvailability({ branch_ref: branchId, service_ref: serviceId, date, dentist_ref: dentistId, appointment_id: appointmentId, for_patient_id: forPatientId }).then(r => {
      if (live) setState(r.ok ? { status: 'ready', slots: r.data?.slots || [], error: '' } : { status: 'error', slots: [], error: r.message || 'Times could not be loaded.' })
    })
    return () => { live = false }
  }, [branchId, serviceId, dentistId, appointmentId, forPatientId, date, attempt])

  if (!date) return null
  if (state.status === 'loading') return <Skeleton lines={2} card={false} label="Loading times"/>
  if (state.status === 'error') return <ErrorState text={state.error} onRetry={() => setAttempt(a => a + 1)}/>

  const availableMap = new Map((state.slots || []).map(s => [s.start_time, s]))
  const allTimes = Array.from(new Set([...STANDARD_SLOTS, ...(state.slots || []).map(s => s.start_time)])).sort()

  const items = allTimes.map(t => ({
    time: t,
    available: availableMap.has(t),
    slot: availableMap.get(t) || { start_time: t }
  }))

  const groups = [
    ['Morning', items.filter(i => i.time < '12:00')],
    ['Afternoon', items.filter(i => i.time >= '12:00')]
  ].filter(([, list]) => list.length)

  return <div className="pp-times pp-fade">
    {!state.slots.length && <p className="pp-hint">All appointment slots for this day are currently booked. Unavailable times are shown below.</p>}
    {groups.map(([label, list]) => <fieldset key={label} className="pp-time-group">
      <legend>{label}</legend>
      <div className="pp-chips">
        {list.map(item => {
          if (item.available) {
            const slot = item.slot
            return <button
              key={slot.start_time}
              type="button"
              className={`pp-chip ${value?.start_time === slot.start_time ? 'is-selected' : ''}`}
              aria-pressed={value?.start_time === slot.start_time}
              onClick={() => onChange(slot)}
            >
              <b>{time12(slot.start_time)}</b>
              {!dentistId && slot.dentist?.name && <small>{slot.dentist.name}</small>}
            </button>
          }
          return <button
            key={item.time}
            type="button"
            className="pp-chip is-unavailable"
            disabled
            aria-disabled="true"
            title="Unavailable / Booked"
            aria-label={`${time12(item.time)}, unavailable`}
          >
            <b>{time12(item.time)}</b>
            <small>Unavailable</small>
          </button>
        })}
      </div>
    </fieldset>)}
  </div>
}

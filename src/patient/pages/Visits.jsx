import { SelectionDetailsNotice } from '../../selection-details.jsx'
import { startHomeRead } from '../../home-read-deadline.js'
import React, { useEffect, useRef, useState } from 'react'
import { Button, Icon, Modal } from '../../components.jsx'
import { acceptSlotOffer, downloadAppointmentReceiptPdf, getAppointment, listAppointments, mySlotOffers, sayOnMyWay } from '../../api-client.js'
import { cancelAppointment, commandKey, rescheduleAppointment } from '../../appointments-api.js'
import { clinic } from '../../clinic-config.js'
import { BookingCalendar, TimeSlots } from '../BookingCalendar.jsx'
import { dateLong, downloadIcs, splitAppointments, time12, todayManila } from '../format.js'
import { EmptyState, ErrorState, LoadingState, PageHead, Pill, useLoad } from '../ui.jsx'
import { loadPatientAppointments } from '../visit-history.js'

const TABS = [['upcoming', 'Upcoming'], ['completed', 'Completed'], ['cancelled', 'Cancelled']]

export function VisitsPage({ selectionDetailsAvailable = false, context, onNavigate, toast, patientId }) {
  const [tab, setTab] = useState(TABS.some(([key]) => key === context?.tab) ? context.tab : 'upcoming')
  const linkedId = context?.appointmentId || context?.id || null
  const [detailId, setDetailId] = useState(linkedId)
  const focused = useRef(false)
  const list = useLoad(async signal => {
    const result = await loadPatientAppointments(params => listAppointments(params, signal))
    if (result.ok && result.data.some(row => !row?.id || typeof row.status !== 'string' || !row.date || !row.patient?.id)) {
      return { ok: false, kind: 'stale_context', message: 'The appointment list could not be verified. Try again.' }
    }
    return result
  }, [])
  const { upcoming, past } = splitAppointments(list.data)
  const groups = {
    upcoming,
    completed: past.filter(row => row.status === 'Completed'),
    cancelled: past.filter(row => row.status === 'Cancelled'),
  }
  const shown = groups[tab]

  useEffect(() => {
    if (context?.payment === 'success') {
      toast?.('You have returned from checkout. Payment is confirmed only after the clinic receives verification from PayMongo. Check your visit status below.', 'info')
    } else if (context?.payment === 'cancelled') {
      toast?.('Payment was cancelled. Your slot hold will expire.', 'warning')
    }
  }, [context?.payment])

  useEffect(() => {
    if (!linkedId || !list.data || focused.current) return
    focused.current = true
    const target = TABS.find(([key]) => groups[key].some(row => row.id === linkedId))
    if (target) setTab(target[0])
  }, [linkedId, list.data])

  return <div className="pp-page patient-appointments">
    <PageHead title="Appointments" actions={<Button icon="plusCalendar" onClick={() => onNavigate('book')}>Book appointment</Button>}/>
    <div className="pp-tabs" role="group" aria-label="Appointment status">
      {TABS.map(([key, label]) =>
        <button key={key} type="button" aria-pressed={tab === key} className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>
          {label}{list.data && <span className="patient-tab-count">{groups[key].length}</span>}
        </button>)}
    </div>
    {tab === 'upcoming' && <EarlierTimeOffers toast={toast} onMoved={list.reload}/>}
    {list.loading && !list.data && <LoadingState label="Loading appointments…"/>}
    {list.error && <ErrorState text={list.error} onRetry={list.reload}/>}
    {list.data && !shown.length && <EmptyState icon="calendar" title={`No ${tab} appointments`}
      text={tab === 'upcoming' ? 'Your next booking will appear here.' : undefined}/>}
    {shown.length > 0 && <ul className="patient-record-list" aria-label={`${tab} appointments`}>
      {shown.map(row => <li key={row.id} className="patient-record-row">
        <div className="patient-record-copy">
          <h2>{row.service?.name}</h2>
          <p>{row.branch?.name}{row.patient?.id && row.patient.id !== patientId ? ` · For ${row.patient.name}` : ''}</p>
          <time dateTime={row.starts_at}>{dateLong(row.date)}{row.start_time ? ` · ${time12(row.start_time)}` : ''}</time>
        </div>
        <div className="patient-record-actions">
          <Pill>{row.status}</Pill>
          <Button variant="soft" size="sm" onClick={() => setDetailId(row.id)} aria-label={`View appointment for ${row.service?.name}, ${dateLong(row.date)}`}>View details</Button>
        </div>
      </li>)}
    </ul>}
    {detailId && <AppointmentDetails key={detailId} id={detailId} toast={toast} onNavigate={onNavigate} onClose={() => setDetailId(null)}
      onChanged={list.reload} selectionDetailsAvailable={selectionDetailsAvailable}/>}
  </div>
}

export function AppointmentDetails({ id, onClose, onChanged, onNavigate, toast, selectionDetailsAvailable }) {
  const detail = useLoad(async signal => {
    const result = await getAppointment(id, signal)
    return result.ok && result.data?.id !== id ? { ok: false, kind: 'stale_context', message: 'The requested appointment could not be verified.' } : result
  }, [id])
  const [action, setAction] = useState(null)
  const a = detail.data
  const editable = a && ['Pending', 'Confirmed'].includes(a.status) && splitAppointments([a]).upcoming.length > 0
  const refresh = () => { detail.reload(); onChanged?.() }
  return <>
    <Modal open title={a?.service?.name || 'Appointment details'} className="patient-appointment-dialog" onClose={onClose}>
      {detail.loading && !a && <LoadingState label="Loading appointment details…"/>}
      {detail.error && <ErrorState text={detail.error} onRetry={detail.reload}/>}
      {a && <>
        <Pill>{a.status}</Pill>
        <dl className="patient-profile-fields">
          <div><dt>Date and time</dt><dd>{dateLong(a.date)} · {time12(a.start_time)}{a.end_time && ` – ${time12(a.end_time)}`}</dd></div>
          <div><dt>Branch</dt><dd>{a.branch?.name}</dd></div>
          <div><dt>Patient</dt><dd>{a.patient?.name}</dd></div>
          {a.dentist?.name && <div><dt>Dentist</dt><dd>{a.dentist.name}</dd></div>}
          {a.intended_service && <div><dt>Intended treatment</dt><dd>{a.intended_service.name}</dd></div>}
          <div><dt>Appointment reference</dt><dd>{a.code || a.id}</dd></div>
        </dl>
        {a.dentist_conversation_id ? <Button variant="soft" icon="message" onClick={() => onNavigate('messages', {conversationId:a.dentist_conversation_id,appointmentId:a.id,patientPublicId:a.patient.id,branchId:a.branch.id})}>Message your dentist</Button>
          : <p className="pp-hint">{({
              not_assigned: 'A Dentist has not been assigned to this appointment yet.',
              appointment_inactive: 'This appointment is no longer active.',
              grant_required: 'The clinic has not enabled a Dentist conversation for this appointment.',
              grant_unavailable: 'Direct Dentist messaging is currently unavailable.',
            })[a.dentist_conversation_state] || 'For questions about this appointment,'}{' '}
            <button type="button" className="link-button" onClick={() => onNavigate('messages', {compose:true, branchPublicId:a.branch?.public_id, text:`I have a question about appointment ${a.code}.`})}>Contact the front desk</button>.</p>}
        {a.cancellation_category && <p>{[a.cancellation_category, a.cancellation_detail].filter(Boolean).join(' · ')}</p>}
        {a.cancellation_refund && <p>{a.cancellation_refund.message}</p>}
        {a.status === 'Pending' && <p className="pp-hint">{a.booking_payment_status === 'held' ? 'Awaiting verified online payment. Your slot hold expires if payment is not completed.' : 'Waiting for the front desk to confirm this booking.'}</p>}
        {!detail.error && editable && a.date === todayManila() && <OnMyWay appointment={a} toast={toast}/>}
        {!detail.error && editable && <div className="pp-actions">
          <Button size="sm" variant="soft" icon="download" onClick={() => downloadIcs({ id: a.id, service: a.service?.name, branchName: a.branch?.name, dentist: a.dentist?.name, startsAt: a.starts_at, endsAt: a.ends_at, clinicName: clinic.name }, `${a.code || 'appointment'}.ics`)}>Add to calendar</Button>
          <Button size="sm" variant="ghost" onClick={() => setAction('reschedule')}>Reschedule</Button>
          <Button size="sm" variant="ghost" className="pp-danger" onClick={() => setAction('cancel')}>Cancel appointment</Button>
        </div>}
        {a.booking_payment_status === 'paid' && Number(a.booking_fee_php) > 0 && a.patient?.id &&
          <BookingDepositReceipt appointment={a} toast={toast}/>}
        {['Checked In', 'In Treatment', 'Completed'].includes(a.status) && <Button size="sm" variant="soft" icon="receipt" onClick={() => onNavigate('billing', { appointmentId: a.id, patientId: a.patient?.id, receiptOnly: true })}>Invoice and receipt</Button>}
      </>}
    </Modal>
    {action === 'cancel' && <CancelDialog selectionDetailsAvailable={selectionDetailsAvailable} appointment={a}
      onClose={() => setAction(null)} onDone={refund => {
        setAction(null)
        toast?.(refund ? 'Your appointment is cancelled. ' + refund.message : 'Your appointment is cancelled.', refund && refund.status !== 'refunded' ? 'warning' : 'success')
        refresh()
      }}/>}
    {action === 'reschedule' && <RescheduleDialog appointment={a}
      onClose={() => setAction(null)} onDone={() => {
        setAction(null)
        toast?.('Your appointment is moved.', 'success')
        refresh()
      }}/>}
  </>
}

/** A booking deposit receipt is not the post-Visit invoice or its settlement receipt. */
function BookingDepositReceipt({ appointment, toast }) {
  const [busy, setBusy] = useState(false)
  const pending = useRef(null)
  const live = useRef(false)
  useEffect(() => {
    live.current = true
    return () => { live.current = false; pending.current?.cancel() }
  }, [])
  const download = async () => {
    if (pending.current || !live.current) return
    const task = startHomeRead(signal => downloadAppointmentReceiptPdf(appointment.id, appointment.code, {
      patientId: appointment.patient.id, signal, isCurrent: () => live.current && !signal.aborted,
    }), { timeoutMs: 12000, timeoutMessage: 'The booking receipt took too long to load. Please retry.' })
    pending.current = task
    setBusy(true)
    try {
      const result = await task.response
      if (live.current && !result.ok) toast?.(result.message || 'The booking deposit receipt could not be verified.', 'warning')
    } catch (error) {
      if (live.current) toast?.(error.message || 'The booking deposit receipt is unavailable. Try again.', 'warning')
    } finally {
      if (pending.current === task) pending.current = null
      if (live.current) setBusy(false)
    }
  }
  return <div className="pp-actions">
    <Button size="sm" variant="soft" icon="download" disabled={busy} onClick={download}>
      {busy ? 'Preparing deposit receipt…' : 'Download booking deposit receipt'}
    </Button>
  </div>
}

function CancelDialog({ selectionDetailsAvailable = false, appointment, onClose, onDone }) {
  const [reason, setReason] = useState('Schedule conflict')
  const [customReason, setCustomReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const key = useRef(commandKey())

  const effectiveReason = reason === 'Other' ? customReason.trim() : reason

  const go = async () => {
    if (reason === 'Other' && !customReason.trim()) {
      return setError('Please provide a reason for cancelling.')
    }
    setBusy(true); setError('')
    const r = await cancelAppointment(appointment, key.current, { ...(selectionDetailsAvailable ? { reason_category: reason, ...(reason === 'Other' ? { reason_detail: effectiveReason } : {}) } : {reason:effectiveReason}), note: note.trim() })
    setBusy(false)
    if (!r.ok) return setError(r.message)
    onDone(r.row?.cancellation_refund)
  }
  return <Modal open title="Cancel this visit?" subtitle={`${appointment.service?.name} · ${dateLong(appointment.date)} at ${time12(appointment.start_time)}`} onClose={onClose}>
    <SelectionDetailsNotice available={selectionDetailsAvailable}/>
    <p>Your time will be released for other patients. You can book again any time.</p>
    <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <label className="field">
        <span>Reason for cancellation <b className="required" aria-hidden="true">*</b></span>
        <select value={reason} onChange={e => { setReason(e.target.value); if (e.target.value !== 'Other') setCustomReason(''); setError('') }}>
          <option value="Schedule conflict">Schedule conflict</option>
          <option value="No longer need the appointment">No longer need the appointment</option>
          <option value="Feeling unwell">Feeling unwell / Medical reason</option>
          <option value="Booked the wrong date, time, branch, or service">Booked wrong date/time/branch/service</option>
          <option value="Found another appointment">Found another appointment</option>
          <option value="Other">Other (specify below)</option>
        </select>
      </label>
      {reason === 'Other' && (
        <label className="field">
          <span>Specify reason <b className="required" aria-hidden="true">*</b></span>
          <input
            type="text"
            required
            placeholder="e.g., My work schedule changed"
            value={customReason}
            onChange={e => { setCustomReason(e.target.value); setError('') }}
            autoFocus
          />
        </label>
      )}
      <label className="field">
        <span>Optional note</span>
        <textarea
          rows={2}
          placeholder="Any additional details for the clinic staff (optional)"
          value={note}
          onChange={e => setNote(e.target.value)}
        />
      </label>
    </div>
    {error && <p className="pp-error-text" role="alert" style={{ marginTop: '10px' }}>{error}</p>}
    <div className="form-actions" style={{ marginTop: '18px' }}><Button variant="ghost" onClick={onClose}>Keep it</Button><Button className="pp-danger-solid" disabled={busy || (reason === 'Other' && !customReason.trim())} onClick={go}>{busy ? 'Cancelling…' : 'Cancel visit'}</Button></div>
  </Modal>
}

function RescheduleDialog({ appointment, onClose, onDone }) {
  const [date, setDate] = useState(''), [slot, setSlot] = useState(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const key = useRef(commandKey())
  const go = async () => {
    setBusy(true); setError('')
    const r = await rescheduleAppointment(appointment, { date, start: slot.start_time }, key.current)
    setBusy(false)
    if (!r.ok) { key.current = commandKey(); return setError(r.message) }
    onDone()
  }
  return <Modal open title="Choose a new time" subtitle={`${appointment.service?.name} at ${appointment.branch?.name}`} onClose={onClose} wide>
    <BookingCalendar branchId={appointment.branch?.id} serviceId={appointment.service?.id} appointmentId={appointment.id} value={date} onChange={d => { setDate(d); setSlot(null) }}/>
    {date && <TimeSlots branchId={appointment.branch?.id} serviceId={appointment.service?.id} appointmentId={appointment.id} date={date} value={slot} onChange={setSlot}/>}
    {error && <p className="pp-error-text" role="alert">{error}</p>}
    <div className="form-actions"><Button variant="ghost" onClick={onClose}>Keep current time</Button><Button disabled={!slot || busy} onClick={go}>{busy ? 'Moving…' : slot ? `Move to ${dateLong(date, { year: false })}, ${time12(slot.start_time)}` : 'Choose a time'}</Button></div>
  </Modal>
}

/** F2: today's visit — tell the front desk you're on your way (they see it on the Check-In page). */
function OnMyWay({ appointment, toast }) {
  const [state, setState] = useState('idle')
  const send = async () => {
    setState('busy')
    const r = await sayOnMyWay(appointment.id)
    setState(r.ok ? 'sent' : 'idle')
    if (!r.ok) toast?.(r.message || 'That did not work. Please call the branch.', 'warning')
  }
  return <div className="pp-onway" role="region" aria-label="Today’s visit">
    {state === 'sent' ? <p><Icon name="check" size={16}/> The front desk knows you’re on your way.</p>
      : <><p>Running late? Let the front desk know.</p><Button size="sm" disabled={state === 'busy'} onClick={send}>{state === 'busy' ? 'Sending…' : 'I’m on my way'}</Button></>}
  </div>
}

/** F3: "An earlier time is available" offers for your own visits. First to accept gets it; your time is kept otherwise. */
function EarlierTimeOffers({ toast, onMoved }) {
  const [offers, setOffers] = useState([]), [busy, setBusy] = useState(''), [confirming, setConfirming] = useState(null)
  const load = () => mySlotOffers().then(r => { if (r.ok) setOffers(r.data || []) })
  useEffect(() => { load() }, [])
  const when = iso => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
  const accept = async offer => {
    setBusy(offer.id)
    const r = await acceptSlotOffer(offer.id)
    setBusy(''); setConfirming(null)
    if (!r.ok) { toast?.(r.message || 'This time is no longer available.', 'warning'); return load() }
    toast?.('Moved to the earlier time.', 'success'); load(); onMoved()
  }
  if (!offers.length) return null
  return <section className="pp-card pp-offers" aria-label="Earlier times available">
    <h2><Icon name="clock" size={18}/> An earlier time is available</h2>
    <ul>{offers.map(o => <li key={o.id}>
      <p><b>{when(o.new_starts_at)}</b> instead of {when(o.current_starts_at)} · {o.branch}</p>
      {confirming === o.id
        ? <div className="pp-actions"><Button size="sm" disabled={busy === o.id} onClick={() => accept(o)}>{busy === o.id ? 'Moving…' : 'Yes, move me'}</Button><Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Keep my time</Button></div>
        : <Button size="sm" onClick={() => setConfirming(o.id)}>Take the earlier time</Button>}
    </li>)}</ul>
    <p className="pp-hint">The first patient to accept gets the time. If you do nothing, your appointment stays as it is.</p>
  </section>
}

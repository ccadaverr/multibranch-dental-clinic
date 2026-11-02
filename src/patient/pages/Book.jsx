import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Icon } from '../../components.jsx'
import { bookingBranchOptions, bookingDentistOptions, bookingOptions, cancelWaitlist, joinWaitlist, listServices, myDependents, publicFaq } from '../../api-client.js'
import { commandKey, createAppointment } from '../../appointments-api.js'
import { clinic } from '../../clinic-config.js'
import { BookingCalendar, TimeSlots } from '../BookingCalendar.jsx'
import { dateLong, downloadIcs, hoursSummary, time12 } from '../format.js'
import { EmptyState, ErrorState, PageHead, Skeleton, useLoad } from '../ui.jsx'

import { bookingFeedback, createBookingAttempt, resolveBookingService, bookingPaymentChoices } from '../booking-flow.js'

const STEPS = ['Service', 'Branch', 'Date & time', 'Review']

/**
 * One server-authoritative booking flow. Capability is a snapshot, never a
 * reservation or payment confirmation. Choices survive Back.
 */
export function BookPage({ prefill = null, onDone, onNavigate, toast }) {
  const [fullDay, setFullDay] = useState(null) // a fully booked day the patient may wait for (A5)
  const [step, setStep] = useState(0)
  const [choice, setChoice] = useState({ service: null, branch: null, dentist: null, date: '', slot: null, wanted: null })
  useEffect(() => { setFullDay(null) }, [step, choice.branch?.id, choice.service?.id, choice.dentist?.id])
  const [done, setDone] = useState(null)
  const [paymentMode, setPaymentMode] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [prefillError, setPrefillError] = useState('')
  const attempt = useRef(null)
  if (!attempt.current) attempt.current = createBookingAttempt(createAppointment, commandKey)
  const locked = busy || attempt.current.uncertain

  const services = useLoad(() => listServices(), [])
  // A guardian books for a dependent (intake, R2-12): "Booking for: Me / Ana (daughter)".
  const family = useLoad(() => myDependents(), [])
  const [forId, setForId] = useState(prefill?.forPatientId || 'self')
  const forPerson = forId === 'self' ? null : (family.data || []).find(d => d.id === forId)
  const [quote, setQuote] = useState(null), [quoteError, setQuoteError] = useState(''), [quoteAttempt, setQuoteAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setQuote(null); setQuoteError('')
    if (step !== 3) return () => { live = false }
    bookingOptions({ branch_ref: choice.branch?.id, service_ref: choice.service?.id, date: choice.date, for_patient_id: forId === 'self' ? null : forId }).then(r => {
      if (!live) return
      if (r.ok) setQuote(r.data)
      else setQuoteError(r.message || 'Payment options could not be checked.')
    })
    return () => { live = false }
  }, [step, choice.branch?.id, choice.service?.id, choice.date, forId, quoteAttempt])
  const paymentChoices = bookingPaymentChoices(quote, choice)
  const headRef = useRef(null)
  useEffect(() => { headRef.current?.focus({ preventScroll: false }) }, [step])

  // External prefills use exactly the same resolution as manual selection.
  const appliedPrefill = useRef(null)
  useEffect(() => {
    if (!prefill?.service || services.status !== 'ready' || appliedPrefill.current === prefill.service) return
    appliedPrefill.current = prefill.service
    const resolved = resolveBookingService(services.data, prefill.service)
    if (!resolved.ok) { setPrefillError(resolved.message); return }
    setChoice(c => ({ ...c, service: resolved.service, wanted: resolved.wanted, branch: null, dentist: null, date: '', slot: null }))
    setStep(1)
  }, [services.status, prefill?.service])

  const set = patch => {
    if (locked) return
    setPrefillError(''); setError('')
    setChoice(c => ({ ...c, ...patch }))
  }
  const confirm = async () => {
    if (attempt.current.busy) return
    if (!(paymentMode === 'cash' ? paymentChoices.cash : paymentMode === 'online' && paymentChoices.online)) { setError('Check the available payment options before submitting.'); return }
    if (forId !== 'self' && !forPerson) { setError('Please select an available dependent before booking.'); return }
    const submittedChoice = choice, submittedPerson = forPerson
    const payload = { branchId: choice.branch.id, serviceId: choice.service.id, date: choice.date, start: choice.slot.start_time, dentistId: null, forPatientId: forPerson?.id || null, payAtClinic: paymentMode === 'cash', paymentChoice: paymentMode }
    setBusy(true); setError('')
    const result = await attempt.current.run(payload)
    setBusy(false)
    if (!result.ok) { setError(result.message || 'This time could not be booked. Choose another time.'); return }
    const appointment = { ...result.row, serviceName: submittedChoice.service.name, branchName: submittedChoice.branch.name, branchAddress: submittedChoice.branch.address, forName: submittedPerson?.first_name || null }
    setDone(appointment)
    const feedback = bookingFeedback(appointment)
    toast?.(feedback.title, feedback.tone)
    onDone?.(appointment)
  }
  const go = n => setStep(Math.max(0, Math.min(STEPS.length - 1, n)))

  if (done) return <Success appointment={done} forName={done.forName} onNavigate={onNavigate}/>

  return <div className="pp-page pp-book">
    <PageHead eyebrow="Book a visit" title="Book an appointment" text="Choose a service, branch and available time. Payment options are explained before you confirm."/>
    {(family.data || []).length > 0 && <label className="pp-for"><span>Booking for</span>
      <select disabled={locked} value={forId} onChange={e => { setForId(e.target.value); setError(''); setChoice(c => ({ ...c, branch: null, date: '', slot: null })); setPaymentMode(''); go(choice.service ? 1 : 0) }} aria-label="Booking for">
        <option value="self">Me</option>{(family.data || []).map(d => <option key={d.id} value={d.id}>{d.first_name} ({d.relationship.toLowerCase()})</option>)}
      </select></label>}
    {prefillError && <p className="pp-error-text" role="alert">{prefillError}</p>}
    {busy && <p role="status">Checking your booking. You can go Back; another booking cannot be submitted while this request is in progress.</p>}
    {attempt.current.uncertain && <p className="pp-note">The last booking response could not be verified. Return to Review and retry the same booking to check its status, or <button className="link-button" onClick={() => onNavigate('visits')}>open My visits</button>. Booking details are kept until the status is known.</p>}
    {error && <p className="pp-error-text" role="alert">{error}</p>}
    <ol className="pp-steps" aria-label="Booking progress">
      {STEPS.map((label, i) => <li key={label} className={i < step ? 'is-done' : i === step ? 'is-current' : ''} aria-current={i === step ? 'step' : undefined}>
        <span className="pp-step-dot">{i < step ? <Icon name="check" size={14}/> : i + 1}</span><span className="pp-step-label">{label}</span>
      </li>)}
    </ol>
    <div className="pp-progress" aria-hidden="true"><span style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }}/></div>

    <section className="pp-card pp-step pp-slide" key={step} aria-labelledby="pp-step-title">
      <h2 id="pp-step-title" tabIndex={-1} ref={headRef}>{['Choose a service', 'Choose a branch', 'Choose a date and time', 'Review and confirm'][step]}</h2>
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {step === 0 && <ServiceStep services={services} value={choice.service} onPick={(s, wanted = null) => { set({ service: s, wanted, branch: choice.service?.id === s.id ? choice.branch : null, dentist: null, date: '', slot: null }); go(1) }}/>}
      {step > 0 && choice.wanted && <p className="pp-note"><Icon name="alert" size={18}/> {choice.wanted.name} starts with a consultation, so you are booking {choice.service.name}. Your dentist plans the next steps with you.</p>}
      {step === 1 && <BranchStep service={choice.service} forPatientId={forId === 'self' ? null : forId} value={choice.branch} preferred={prefill?.branch} onPick={b => { set({ branch: b, dentist: choice.branch?.id === b.id ? choice.dentist : null, date: '', slot: null }); go(2) }}/>}
      {step === 2 && <>
        <p className="pp-hint">{choice.branch.name} · {choice.service.name}. An eligible available dentist is assigned by the clinic.</p>
        <BookingCalendar branchId={choice.branch.id} serviceId={choice.service.id} forPatientId={forId === 'self' ? null : forId} value={choice.date} onChange={date => set({ date, slot: null })} onFullDay={forId === 'self' ? setFullDay : null}/>
        {forId !== 'self' && <p className="pp-hint">For a dependent’s waitlist request, contact the front desk.</p>}
        {fullDay && <WaitlistOffer key={fullDay} date={fullDay} choice={choice} toast={toast}/>}
        {choice.date && <TimeSlots branchId={choice.branch.id} serviceId={choice.service.id} forPatientId={forId === 'self' ? null : forId} date={choice.date} value={choice.slot} onChange={slot => { set({ slot }); go(3) }}/>}
      </>}
      </fieldset>
      {step === 3 && <Review choice={choice} forPerson={forPerson} onEdit={go} paymentMode={paymentMode} onPaymentChange={setPaymentMode} busy={busy} locked={locked} onConfirm={confirm} quote={quote} paymentChoices={paymentChoices} quoteError={quoteError} retryQuote={() => setQuoteAttempt(n => n + 1)}/>}
      <div className="pp-step-nav">
        {(busy || attempt.current.uncertain) && step !== 3 && <Button variant="soft" onClick={() => go(3)}>Return to Review</Button>}
        {step > 0 && <Button variant="ghost" icon="chevronLeft" onClick={() => go(step - 1)}>Back</Button>}
      </div>
    </section>
  </div>
}

function ServiceStep({ services, value, onPick }) {
  const [q, setQ] = useState('')
  const all = services.data || []
  // F7 (R2-17): hidden services are not offered online; a consultation-first one books its consultation instead.
  const active = all.filter(s => s.status === 'Active' && s.online_booking !== 'hidden')
  const consultationFor = s => { const r = resolveBookingService(all, s.id); return r.ok && r.wanted ? r.service : null }
  const pick = s => { const r = resolveBookingService(all, s.id); if (r.ok) onPick(r.service, r.wanted) }
  const filtered = active.filter(s => `${s.name} ${s.category} ${s.description || ''}`.toLowerCase().includes(q.trim().toLowerCase()))
  const groups = useMemo(() => [...new Set(filtered.map(s => s.category || 'Other'))].map(c => [c, filtered.filter(s => (s.category || 'Other') === c)]), [filtered])
  if (services.status === 'loading') return <Skeleton lines={4} card={false} label="Loading services"/>
  if (services.status === 'error') return <ErrorState text={services.error} onRetry={services.reload}/>
  if (!active.length) return <EmptyState icon="tooth" title="No services are open for booking" text="Please message the front desk to arrange a visit."/>
  return <>
    <label className="pp-search"><Icon name="search" size={18}/><span className="sr-only">Search services</span><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search services, e.g. cleaning"/></label>
    {!filtered.length && <p className="pp-hint">No service matches “{q}”.</p>}
    {groups.map(([category, list]) => <details key={category} className="pp-group" open={q.trim() ? true : undefined}>
      <summary className="pp-group-title">{category} ({list.length})</summary>
      <div className="pp-options">
        {list.map(s => <button key={s.id} type="button" className={`pp-option ${value?.id === s.id ? 'is-selected' : ''}`} aria-pressed={value?.id === s.id} disabled={!resolveBookingService(all, s.id).ok} onClick={() => pick(s)}>
          <span className="pp-option-icon" aria-hidden="true"><Icon name="tooth" size={20}/></span>
          <span className="pp-option-body"><b>{s.name}</b>{s.description && <small>{s.description}</small>}
            {!resolveBookingService(all, s.id).ok ? <em>{resolveBookingService(all, s.id).message}</em> : consultationFor(s) ? <em className="pp-consult"><Icon name="alert" size={14}/> Starts with a consultation: you book {consultationFor(s).name}</em> : <em><Icon name="clock" size={14}/> About {s.duration_minutes} minutes</em>}</span>
          {value?.id === s.id && <Icon name="check" size={18} className="pp-option-check"/>}
        </button>)}
      </div>
    </details>)}
    <p className="pp-hint">Prices are confirmed by the clinic. You’ll receive your invoice after your visit.</p>
  </>
}

/** Branch step: asks for the browser location once (explained, never stored) to rank by distance and earliest slot. */
function BranchStep({ service, forPatientId, value, preferred, onPick }) {
  const [geo, setGeo] = useState('idle')
  const [coords, setCoords] = useState(null)
  const [city, setCity] = useState('')
  const [state, setState] = useState({ status: 'loading', data: null, error: '' })
  const ask = () => {
    if (!navigator.geolocation) return setGeo('unavailable')
    setGeo('asking')
    navigator.geolocation.getCurrentPosition(p => { setCoords({ latitude: p.coords.latitude.toFixed(4), longitude: p.coords.longitude.toFixed(4) }); setGeo('granted') },
      () => setGeo('denied'), { maximumAge: 600000, timeout: 8000, enableHighAccuracy: false })
  }
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (geo === 'asking') return undefined
    let live = true
    setState(s => ({ ...s, status: 'loading' }))
    bookingBranchOptions({ service_ref: service.id, for_patient_id: forPatientId, ...(coords || {}) }).then(r => { if (live) setState(r.ok ? { status: 'ready', data: r.data, error: '' } : { status: 'error', data: null, error: r.message || 'Branches could not be loaded.' }) })
    return () => { live = false }
  }, [service.id, forPatientId, geo, coords?.latitude, coords?.longitude, attempt])

  const intro = <div className="pp-geo">
    <Icon name="pin" size={20}/>
    <p>{geo === 'granted' ? 'Sorted by distance from you and the earliest open time. Your location is used once and never saved.'
      : geo === 'asking' ? 'To suggest the closest branch, your browser will ask for your location. It is used once to sort branches and is never saved.'
        : geo === 'denied' ? 'Location is off, so branches are listed by the earliest open time. You can filter by city below.'
          : 'Branches are listed by the earliest open time.'}</p>
    {geo !== 'asking' && typeof navigator !== 'undefined' && navigator.geolocation && <Button size="sm" variant="soft" onClick={ask}>Find the best branch for me</Button>}
  </div>
  if (geo === 'asking' || state.status === 'loading') return <>{intro}<Skeleton lines={3} card={false} label="Finding branches"/></>
  if (state.status === 'error') return <>{intro}<ErrorState text={state.error} onRetry={() => setAttempt(a => a + 1)}/></>
  const branches = state.data.branches
  if (!branches.length) return <EmptyState icon="building" title="No branch offers this service online right now" text="Please message the front desk and they will help you book."/>
  const cities = [...new Set(branches.map(b => b.city).filter(Boolean))]
  const shown = branches.filter(b => !city || b.city === city)
  const recommended = shown.find(b => b.recommended) || null
  const others = shown.filter(b => b !== recommended).sort((a, b) => (b.id === preferred) - (a.id === preferred))
  const card = (b, highlight) => <button key={b.id} type="button" className={`pp-option pp-branch ${highlight ? 'is-recommended' : ''} ${value?.id === b.id ? 'is-selected' : ''}`} aria-pressed={value?.id === b.id} onClick={() => onPick(b)}>
    <span className="pp-option-icon" aria-hidden="true"><Icon name="building" size={20}/></span>
    <span className="pp-option-body">
      {highlight && <span className="pp-badge">Recommended · {b.reason}</span>}
      <b>{b.name}</b><small>{b.address}</small>
      <em><Icon name="clock" size={14}/> {hoursSummary(b.weekly_hours) || `${time12(b.open_time)} – ${time12(b.close_time)}`}{b.distance_km != null ? ` · ${b.distance_km} km away` : ''}</em>
      <em>{b.earliest ? `Earliest: ${b.earliest.label}` : 'No open time in the next month'}</em>
    </span>
  </button>
  return <>
    {intro}
    {(cities.length > 1 || city) && <div className="pp-filter" role="group" aria-label="Filter by city">
      <button type="button" className={`pp-chip ${!city ? 'is-selected' : ''}`} aria-pressed={!city} onClick={() => setCity('')}>All</button>
      {cities.map(c => <button key={c} type="button" className={`pp-chip ${city === c ? 'is-selected' : ''}`} aria-pressed={city === c} onClick={() => setCity(c)}>{c}</button>)}
    </div>}
    <div className="pp-options">{recommended && card(recommended, true)}{others.map(b => card(b, false))}</div>
  </>
}

function DentistStep({ service, branch, value, onPick }) {
  const dentists = useLoad(() => bookingDentistOptions({ branch_ref: branch.id, service_ref: service.id }), [branch.id, service.id])
  if (dentists.status === 'loading') return <Skeleton lines={3} card={false} label="Loading dentists"/>
  if (dentists.status === 'error') return <ErrorState text={dentists.error} onRetry={dentists.reload}/>
  return <div className="pp-options">
    <button type="button" className={`pp-option ${!value ? 'is-selected' : ''}`} aria-pressed={!value} onClick={() => onPick(null)}>
      <span className="pp-option-icon" aria-hidden="true"><Icon name="sparkles" size={20}/></span>
      <span className="pp-option-body"><b>Any available dentist</b><small>Shows the most open times. The clinic assigns a dentist who does this service.</small></span>
    </button>
    {(dentists.data || []).map(d => <button key={d.id} type="button" className={`pp-option ${value?.id === d.id ? 'is-selected' : ''}`} aria-pressed={value?.id === d.id} onClick={() => onPick(d)}>
      <span className="pp-avatar" aria-hidden="true">{d.name?.split(' ').map(p => p[0]).slice(0, 2).join('')}</span>
      <span className="pp-option-body"><b>{d.name}</b>{d.specialty && <small>{d.specialty}</small>}</span>
    </button>)}
  </div>
}

function Review({ choice, forPerson, onEdit, paymentMode, onPaymentChange, busy, locked, onConfirm, quote, paymentChoices, quoteError, retryQuote }) {
  const [policy, setPolicy] = useState(null)
  useEffect(() => { publicFaq().then(r => { if (r.ok) setPolicy(r.meta?.cancellation_policy || null) }) }, [])
  const rows = [...(forPerson ? [['Patient', `${forPerson.name} (${forPerson.relationship.toLowerCase()})`, 0]] : []), ['Service', choice.service.name, 0], ['Branch', <>{choice.branch.name}<small>{choice.branch.address}</small></>, 1],
    ['Dentist', 'Assigned by the clinic based on availability', null], ['Date', dateLong(choice.date), 2], ['Time', time12(choice.slot?.start_time), 2],
    ['Payment method', paymentMode === 'cash' ? 'Pay at the clinic' : paymentMode === 'online' ? 'Pay online' : 'Choose a payment option below', null]]
  return <>
    <dl className="pp-summary">{rows.map(([k, v, s]) => <div key={k}><dt>{k}</dt><dd>{v}</dd>{s !== null && <button type="button" className="link-button" onClick={() => onEdit(s)} aria-label={`Change ${k.toLowerCase()}`}>Change</button>}</div>)}</dl>
    {quoteError && <ErrorState text={quoteError} onRetry={retryQuote}/>}
    <fieldset disabled={locked} className="pp-payment-options" style={{ border: 0, padding: 0, margin: '14px 0' }}>
      <legend>Payment option</legend>
      {quoteError ? null : !quote ? <p role="status">Checking payment options…</p> : <>
      <p className="pp-hint">{paymentChoices.fee !== null ? `Booking fee: ${new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(paymentChoices.fee)}. This quote does not reserve the slot.` : 'The booking price has not been confirmed.'}</p>
      {!paymentChoices.online && <p className="pp-hint">Online payment is currently unavailable. No online payment will be started.</p>}
      {paymentChoices.online && <><p className="pp-hint">Pay at booking via PayMongo. Payment stays pending until verified by the clinic server.</p><label className="pp-for"><input type="radio" name="paymentOption" value="online" checked={paymentMode === 'online'} onChange={() => onPaymentChange('online')}/> Pay online</label></>}
      <label className="pp-for"><input type="radio" name="paymentOption" value="cash" disabled={!paymentChoices.cash} checked={paymentMode === 'cash'} onChange={() => onPaymentChange('cash')}/> Pay at the clinic</label>
      </>}
      {paymentMode==='cash'&&paymentChoices.cash&&<p className="pp-hint">No payment is collected online with this choice. Settle your charges at the clinic according to your invoice.</p>}
      {paymentMode==='online'&&paymentChoices.online&&<p className="pp-hint">Continue to online checkout after submitting. Payment remains pending until the clinic server verifies it.</p>}
    </fieldset>
    {policy && <p className="pp-note pp-policy" style={{ marginTop: '8px' }}><Icon name="calendar" size={18}/> {policy}</p>}
    <Button width="full" className="pp-primary" disabled={busy || !(paymentMode === 'cash' ? paymentChoices.cash : paymentMode === 'online' && paymentChoices.online)} onClick={onConfirm}>{busy ? 'Checking booking…' : paymentMode === 'online' ? 'Submit booking · pay online' : 'Submit booking · pay at clinic'}</Button>
  </>
}

function Success({ appointment, forName = null, onNavigate }) {
  const ics = () => downloadIcs({ id: appointment.id, service: appointment.serviceName || appointment.service?.name, branchName: appointment.branchName || appointment.branch?.name,
    branchAddress: appointment.branchAddress, dentist: appointment.dentistName || appointment.dentist?.name, startsAt: appointment.startsAt || appointment.starts_at,
    endsAt: appointment.endsAt || appointment.ends_at, clinicName: clinic.name })
  const date = appointment.date, start = appointment.start || appointment.start_time
  const feedback = bookingFeedback(appointment)
  return <div className="pp-page pp-success pp-fade">
    <div className="pp-card pp-success-card">
      <span className="pp-success-mark" aria-hidden="true"><Icon name={feedback.tone === 'success' ? 'check' : feedback.tone === 'warning' ? 'alert' : 'clock'} size={34}/></span>
      <h1>{feedback.tone === 'success' && forName ? `${forName} is booked!` : feedback.title}</h1>
      <p className="pp-lead">{appointment.serviceName || appointment.service?.name} on <b>{dateLong(date)}</b> at <b>{time12(start)}</b>, {appointment.branchName || appointment.branch?.name}.</p>
      <p className="pp-hint">{feedback.text}</p>
      {appointment.checkout_url && appointment.booking_payment_status === 'held' && <p><a href={appointment.checkout_url}>Continue the checkout issued for this booking</a></p>}
      <div className="pp-actions">
        {appointment.status === 'Confirmed' && appointment.booking_payment_status !== 'held' && <Button icon="download" variant="soft" onClick={ics}>Add to calendar</Button>}
        <Button onClick={() => onNavigate('visits')}>View my visits</Button>
        <Button variant="ghost" onClick={() => onNavigate('home')}>Back to home</Button>
      </div>
    </div>
  </div>
}

/**
 * A5: a fully booked day. The patient can ask to be told when a time opens (for example after a cancellation). Nothing is held:
 * the first person to book gets the time, through the normal booking rules.
 */
function WaitlistOffer({ date, choice, toast }) {
  const [entry, setEntry] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const join = async () => {
    setBusy(true); setError('')
    const r = await joinWaitlist({ branch_ref: choice.branch.id, service_ref: choice.service.id, dentist_ref: choice.dentist?.id || null, date })
    setBusy(false)
    if (!r.ok) return setError(r.kind === 'validation' ? Object.values(r.errors || {})[0]?.[0] || r.message : r.message || 'That did not work. Try again.')
    setEntry(r.data); toast?.('You’re on the waitlist.', 'success')
  }
  const leave = async () => {
    setBusy(true)
    const r = await cancelWaitlist(entry.id)
    setBusy(false)
    if (r.ok) { setEntry(r.data); toast?.('Removed from the waitlist.', 'success') }
  }
  const waiting = entry?.status === 'waiting'
  return <div className="pp-card pp-waitlist" role="region" aria-label="Waitlist">
    <h3>{dateLong(date)} is fully booked</h3>
    {waiting
      ? <><p>You’re on the waitlist. We’ll email you and show a notice here if a time opens. It’s first come, first served, and no time is held for you.</p>
        <Button variant="ghost" disabled={busy} onClick={leave}>Leave the waitlist</Button></>
      : <><p>We can tell you if a time opens on this day, for example after a cancellation. You can still choose another day.</p>
        {entry?.status === 'cancelled' && <p className="pp-hint">You left the waitlist for this day.</p>}
        <Button icon="bell" disabled={busy} onClick={join}>{busy ? 'Saving…' : 'Notify me if a time opens'}</Button></>}
    {error && <p className="pp-error-text" role="alert">{error}</p>}
  </div>
}

// Shared rules for manual selection and external service prefills. Never guess
// an alternative consultation when the configured service is unavailable.
export function bookingPaymentChoices(quote, choice) {
  const matches = quote && quote.branch_ref === choice.branch?.id && quote.service_ref === choice.service?.id && quote.date === choice.date &&
    (quote.intended_service_ref ?? null) === (choice.wanted?.id ?? null)
  const fee = matches && quote.currency === 'PHP' && quote.booking_fee_php !== null && quote.booking_fee_php !== '' && Number.isFinite(Number(quote.booking_fee_php)) && Number(quote.booking_fee_php) >= 0 ? Number(quote.booking_fee_php) : null
  return { cash: !!matches && quote.pay_at_clinic_available === true, online: !!matches && fee !== null && quote.online_payment_available === true && Array.isArray(quote.payment_methods) && quote.payment_methods.length > 0, fee }
}

export function resolveBookingService(services, id) {
  const wanted = (services || []).find(s => s.id === id)
  if (!wanted || wanted.status !== 'Active' || wanted.online_booking === 'hidden' || wanted.booking_internal) {
    return { ok: false, message: 'This service is not available for online booking. Please choose another service or message the front desk.' }
  }
  if (wanted.online_booking === 'consultation_first') {
    const service = services.find(s => s.id === wanted.consultation_service_id && s.status === 'Active' && s.online_booking === 'bookable')
    return service ? { ok: true, service, wanted }
      : { ok: false, message: `${wanted.name} requires a consultation, but its consultation is not available for online booking. Please message the front desk.` }
  }
  if (wanted.online_booking && wanted.online_booking !== 'bookable') {
    return { ok: false, message: 'This service cannot be booked online. Please message the front desk.' }
  }
  return { ok: true, service: wanted, wanted: null }
}

export function bookingFeedback(row) {
  const payment = row?.booking_payment_status
  if (['Cancelled', 'No-show'].includes(row?.status) || ['expired', 'failed', 'forfeited'].includes(payment)) {
    return { title: 'This booking is no longer active', text: 'The slot is not confirmed. Check My visits before choosing another time.', tone: 'warning' }
  }
  if (payment === 'held') return { title: 'Pending payment verification', text: 'Your appointment is not confirmed. Check My visits for payment verification and the slot hold status.', tone: 'info' }
  if (row?.status === 'Pending') return { title: 'Pending front-desk confirmation', text: 'The front desk still needs to confirm this booking. Check My visits for updates.', tone: 'info' }
  if (row?.status === 'Confirmed') return { title: 'Appointment confirmed', text: payment === 'paid' ? 'Your booking payment is verified and credited to your visit invoice.' : 'Your appointment is confirmed. Payment can be settled at the clinic according to your invoice.', tone: 'success' }
  if (['Checked In','In Treatment','Completed'].includes(row?.status)) return {title:row.status==='Completed'?'Visit completed':row.status==='In Treatment'?'Treatment in progress':'Checked in',text:'The current visit status was read from the clinic server. Open My visits for the saved details.',tone:'info'}
  return { title: 'Booking status needs checking', text: 'Confirmation has not been verified. Check My visits or contact the front desk before booking again.', tone: 'warning' }
}

// Owned by BookPage, not Review. Requests and keys survive step remounts.
// Failed commands store no key on the current server; ambiguous network errors
// must replay the same intent/key before the patient changes booking details.
export function bookingReceiptMatches(row, payload, selfPatientId, current = false) {
  const ulid = value => typeof value === 'string' && /^[0-7][0-9a-hjkmnp-tv-z]{25}$/i.test(value)
  return ulid(row?.id) && ulid(row.patient?.id) && row.patient.id === (payload.forPatientId || selfPatientId) &&
    typeof row.code === 'string' && !!row.code.trim() && Number.isSafeInteger(row.revision) && row.revision > 0 &&
    (current?['Pending','Confirmed','Checked In','In Treatment','Completed','Cancelled','No-show']:['Pending','Confirmed']).includes(row.status) && row.branch?.id === payload.branchId && row.service?.id === payload.serviceId &&
    (row.intended_service?.id ?? null) === (payload.intendedServiceId ?? null) &&
    typeof row.dentist?.id === 'string' && !!row.dentist.id && (!payload.dentistId || row.dentist.id === payload.dentistId) &&
    row.date === payload.date && row.start_time === payload.start && typeof row.starts_at === 'string' &&
    row.starts_at.startsWith(`${payload.date}T${payload.start}:`) && row.starts_at.endsWith('+08:00') &&
    Number.isSafeInteger(row.duration_minutes) && row.duration_minutes > 0 &&
    Date.parse(row.ends_at) - Date.parse(row.starts_at) === row.duration_minutes * 60000
}

// A journal replay proves the original booking. Read its exact ID for today's status; never substitute a list match.
export async function currentBookingReadback(receipt, payload, selfPatientId, read, isCurrent, timeoutMs = 30000) {
  let timer, result
  try { result = await Promise.race([Promise.resolve().then(()=>isCurrent()?read(receipt.id):null),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs)})]) }
  catch { result = null } finally { clearTimeout(timer) }
  if (!isCurrent()) return null
  const row=result?.row
  const known=result?.ok===true&&row?.id===receipt.id&&bookingReceiptMatches(row,{...payload,date:row.date,start:row.start_time,dentistId:null},selfPatientId,true)
  return {known,appointment:known?row:receipt,changed:!!known&&(row.date!==payload.date||row.start_time!==payload.start||row.dentist.id!==receipt.dentist.id)}
}

export function createBookingAttempt(send, newKey, {isCurrent = () => true, verify = () => true, timeoutMs = 30000} = {}) {
  const intents = new Map()
  let flight = null, uncertain = null
  return {
    get busy() { return flight !== null },
    get uncertain() { return uncertain !== null },
    run(payload) {
      if (!isCurrent()) return Promise.resolve({ok:false,kind:'stale_context',message:'Your booking session changed. Open My visits after signing in again.'})
      if (flight) return flight
      const fingerprint = JSON.stringify(payload)
      if (uncertain && fingerprint !== uncertain) return Promise.resolve({ ok: false, message: 'Retry the previous booking first so its status can be checked.' })
      let intent = intents.get(fingerprint)
      if (!intent) { intent = { key: newKey(), payload: Object.freeze(structuredClone(payload)) }; intents.set(fingerprint, intent) }
      if (intent.result?.ok) return Promise.resolve(intent.result)
      let timer
      const wasUncertain = uncertain === fingerprint
      flight = Promise.race([Promise.resolve().then(() => isCurrent() ? send(intent.payload, intent.key, isCurrent) : {ok:false,kind:'stale_context'}),
        new Promise(resolve => {timer = setTimeout(() => resolve({ok:false,kind:'network',message:'The booking response is unconfirmed. Retry this same booking or review My visits before booking again.'}),timeoutMs)})])
        .catch(() => ({ ok: false, kind: 'network', message: 'The booking response could not be verified. Retry to check the same booking, or open My visits.' }))
        .then(result => {
          if (!isCurrent()) return {ok:false,kind:'stale_context',message:'Your booking session changed. No result was adopted.'}
          if (result?.ok && !verify(result.row, intent.payload)) result = {ok:false,kind:'unverified',message:'The booking response did not match the selected Patient and appointment details. Retry this same booking or review My visits.'}
          if (!result || typeof result.ok !== 'boolean') result = {ok:false,kind:'unverified',message:'The booking response could not be verified. Retry this same booking or review My visits.'}
          uncertain = !result.ok && (wasUncertain || !['validation','conflict','not_found','forbidden','unauthenticated','rate_limited','stale_context'].includes(result.kind)) ? fingerprint : null
          intent.result = result
          return result
        }).finally(() => {clearTimeout(timer);flight = null})
      return flight
    },
  }
}

// Shared rules for manual selection and external service prefills. Never guess
// an alternative consultation when the configured service is unavailable.
export function bookingPaymentChoices(quote, choice) {
  const matches = quote && quote.branch_ref === choice.branch?.id && quote.service_ref === choice.service?.id && quote.date === choice.date
  const fee = matches && quote.currency === 'PHP' && quote.booking_fee_php !== null && quote.booking_fee_php !== '' && Number.isFinite(Number(quote.booking_fee_php)) && Number(quote.booking_fee_php) >= 0 ? Number(quote.booking_fee_php) : null
  return { cash: !!matches && quote.pay_at_clinic_available === true, online: !!matches && fee !== null && quote.online_payment_available === true && Array.isArray(quote.payment_methods) && quote.payment_methods.length > 0, fee }
}

export function resolveBookingService(services, id) {
  const wanted = (services || []).find(s => s.id === id)
  if (!wanted || wanted.status !== 'Active' || wanted.online_booking === 'hidden') {
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
  return { title: 'Booking status needs checking', text: 'Confirmation has not been verified. Check My visits or contact the front desk before booking again.', tone: 'warning' }
}

// Owned by BookPage, not Review. Requests and keys survive step remounts.
// Failed commands store no key on the current server; ambiguous network errors
// must replay the same intent/key before the patient changes booking details.
export function createBookingAttempt(send, newKey) {
  const intents = new Map()
  let flight = null, uncertain = null
  return {
    get busy() { return flight !== null },
    get uncertain() { return uncertain !== null },
    run(payload) {
      if (flight) return flight
      const fingerprint = JSON.stringify(payload)
      if (uncertain && fingerprint !== uncertain) return Promise.resolve({ ok: false, message: 'Retry the previous booking first so its status can be checked.' })
      let intent = intents.get(fingerprint)
      if (!intent) { intent = { key: newKey() }; intents.set(fingerprint, intent) }
      if (intent.result?.ok) return Promise.resolve(intent.result)
      flight = Promise.resolve().then(() => send(payload, intent.key))
        .catch(() => ({ ok: false, kind: 'network', message: 'The booking response could not be verified. Retry to check the same booking, or open My visits.' }))
        .then(result => {
          uncertain = !result.ok && result.kind === 'network' ? fingerprint : null
          intent.result = result
          return result
        }).finally(() => { flight = null })
      return flight
    },
  }
}

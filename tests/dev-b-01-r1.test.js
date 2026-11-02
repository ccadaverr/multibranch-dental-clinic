import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveBookingService, bookingFeedback, createBookingAttempt } from '../src/patient/booking-flow.js'
import { loadActiveAppointments, loadPatientAppointments, loadTreatmentHistory } from '../src/patient/visit-history.js'

const services = [
  { id: 'consult', name: 'Consultation', status: 'Active', online_booking: 'bookable' },
  { id: 'braces', name: 'Braces', status: 'Active', online_booking: 'consultation_first', consultation_service_id: 'consult' },
  { id: 'inactive', status: 'Inactive', online_booking: 'bookable' },
  { id: 'hidden', status: 'Active', online_booking: 'hidden' },
]
test('manual and prefilled service resolution: direct, consultation, unavailable and missing consultation', () => {
  assert.equal(resolveBookingService(services, 'consult').service.id, 'consult')
  const r = resolveBookingService(services, 'braces')
  assert.equal(r.service.id, 'consult'); assert.equal(r.wanted.id, 'braces')
  for (const id of ['inactive', 'hidden', 'missing']) assert.equal(resolveBookingService(services, id).ok, false)
  const unavailable = resolveBookingService(services.filter(s => s.id !== 'consult'), 'braces')
  assert.equal(unavailable.ok, false); assert.match(unavailable.message, /requires a consultation/)
  assert.equal(resolveBookingService(services.map(s => s.id === 'consult' ? { ...s, status: 'Inactive' } : s), 'braces').ok, false)
})
test('booking feedback distinguishes confirmed, held payment, front-desk pending and expired records', () => {
  assert.equal(bookingFeedback({ status: 'Confirmed', booking_payment_status: 'unpaid' }).tone, 'success')
  assert.match(bookingFeedback({ status: 'Confirmed', booking_payment_status: 'paid' }).text, /verified/)
  for (const status of ['Pending', 'Confirmed']) {
    const r = bookingFeedback({ status, booking_payment_status: 'held' })
    assert.equal(r.title, 'Pending payment verification'); assert.notEqual(r.tone, 'success')
  }
  assert.equal(bookingFeedback({ status: 'Pending', booking_payment_status: 'unpaid' }).title, 'Pending front-desk confirmation')
  assert.equal(bookingFeedback({ status: 'Pending', booking_payment_status: 'paid' }).title, 'Pending front-desk confirmation')
  for (const row of [{ status: 'Cancelled' }, { status: 'Pending', booking_payment_status: 'expired' }, {}]) assert.equal(bookingFeedback(row).tone, 'warning')
})
const payload = { branchId: 'b1', serviceId: 'consult', date: '2099-11-02', start: '09:00', dentistId: null, forPatientId: null, payAtClinic: true }
test('one in-flight attempt and key survive rapid confirm and Review remount consumers', async () => {
  let complete, calls = 0, keys = 0
  const gate = createBookingAttempt(async () => { calls++; return new Promise(resolve => { complete = resolve }) }, () => `k${++keys}`)
  const first = gate.run(payload), remountedReview = gate.run({ ...payload }), changed = gate.run({ ...payload, branchId: 'b2' })
  assert.equal(first, remountedReview); assert.equal(first, changed); assert.equal(gate.busy, true)
  await Promise.resolve(); assert.equal(calls, 1); assert.equal(keys, 1)
  complete({ ok: true, row: { id: 'record', status: 'Pending' } }); await first
  assert.equal(gate.busy, false)
  await gate.run({ ...payload }); assert.equal(calls, 1, 'successful intent is never created again')
})
test('known validation failure is recoverable; same intent reuses key and changed details get a new key', async () => {
  const keys = []; let count = 0
  const gate = createBookingAttempt(async (_, key) => { keys.push(key); return { ok: false, kind: 'validation', message: 'Slot expired' } }, () => `key-${++count}`)
  assert.equal((await gate.run(payload)).message, 'Slot expired')
  await gate.run({ ...payload }); await gate.run({ ...payload, start: '10:00' })
  assert.deepEqual(keys, ['key-1', 'key-1', 'key-2']); assert.equal(gate.uncertain, false)
})
test('network ambiguity locks intent until same-key replay resolves, including thrown transport errors', async () => {
  const keys = []; let calls = 0
  const gate = createBookingAttempt(async (_, key) => { keys.push(key); if (++calls === 1) throw Error('offline'); return { ok: true, row: { id: 'existing' } } }, () => 'stable')
  assert.equal((await gate.run(payload)).ok, false); assert.equal(gate.uncertain, true)
  assert.equal((await gate.run({ ...payload, forPatientId: 'dependent' })).ok, false); assert.equal(calls, 1)
  assert.equal((await gate.run({ ...payload })).row.id, 'existing'); assert.equal(gate.uncertain, false)
  assert.deepEqual(keys, ['stable', 'stable'])
})
test('Home active search stops before unrelated later pages and has no artificial future cutoff', async () => {
  const seen = []
  const row = { id: 'far-future', status: 'Confirmed', starts_at: '2099-11-02T09:00:00+08:00', date: '2099-11-02' }
  const r = await loadActiveAppointments(async params => {
    seen.push(params)
    if (params.status === 'Confirmed') return { ok: true, data: [row], meta: { last_page: 20 } }
    return { ok: true, data: [], meta: { last_page: 1 } }
  }, { firstOnly: true })
  assert.equal(r.data[0].id, 'far-future'); assert.equal(seen.length, 4)
  assert.ok(seen.every(p => !('from' in p) && !('to' in p)))
})
test('Visits active search follows every server page; full history stays available separately', async () => {
  const seen = []
  const r = await loadActiveAppointments(async p => {
    seen.push(p)
    return { ok: true, data: p.status === 'Confirmed' ? [{ id: `a${p.page}`, status: 'Confirmed', starts_at: '2099-11-02T09:00:00+08:00' }] : [], meta: { last_page: p.status === 'Confirmed' ? 2 : 1 } }
  })
  assert.equal(r.data.length, 2); assert.ok(seen.some(p => p.status === 'Confirmed' && p.page === 2))
  const history = await loadPatientAppointments(async p => ({ ok: true, data: [{ id: p.page, status: 'Completed' }], meta: { last_page: 2 } }))
  assert.equal(history.data.length, 2)
})
test('active search and treatment cursors report failures without pretending history is complete', async () => {
  assert.equal((await loadActiveAppointments(async () => ({ ok: false, message: 'Unavailable' }))).ok, false)
  const cursors = []
  const r = await loadTreatmentHistory(async p => { cursors.push(p.cursor); return p.cursor ? { ok: false, message: 'History offline' } : { ok: true, data: [{ id: 't1' }], meta: { next_cursor: 'next' } } })
  assert.deepEqual(cursors, [undefined, 'next']); assert.equal(r.message, 'History offline')
})

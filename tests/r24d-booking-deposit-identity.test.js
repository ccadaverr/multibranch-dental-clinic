import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { downloadAppointmentReceiptPdf } from '../src/api-client.js'

const APPOINTMENT = '01kb42hjkmnpqrsstvwxyz1234'
const PATIENT = '01kb42hjkmnpqrsstvwxyz5678'

function response({ appointmentId = APPOINTMENT, patientId = PATIENT, type = 'application/pdf', status = 200 } = {}) {
  const headers = new Headers({ 'Content-Type': type, 'Content-Disposition': 'attachment; filename="deposit.pdf"' })
  if (appointmentId !== null) headers.set('X-Appointment-Id', appointmentId)
  if (patientId !== null) headers.set('X-Patient-Id', patientId)
  return new Response(status === 200 ? '%PDF-1.4 synthetic' : 'Not found', { status, headers })
}

async function downloadWith(reply, options = {}) {
  const previousFetch = globalThis.fetch
  const previousDocument = globalThis.document
  const previousCreate = URL.createObjectURL
  const previousRevoke = URL.revokeObjectURL
  let downloaded = 0
  let fetched = 0
  globalThis.fetch = async (...args) => { fetched++; return typeof reply === 'function' ? reply(...args) : reply }
  globalThis.document = {
    cookie: '',
    createElement: () => ({ href: '', download: '', click: () => { downloaded++ }, remove() {} }),
    body: { appendChild() {} },
  }
  URL.createObjectURL = () => 'blob:synthetic'
  URL.revokeObjectURL = () => {}
  try {
    const result = await downloadAppointmentReceiptPdf(APPOINTMENT, 'APT-SYNTHETIC', { patientId: PATIENT, ...options })
    return { result, downloaded, fetched }
  } finally {
    globalThis.fetch = previousFetch
    globalThis.document = previousDocument
    URL.createObjectURL = previousCreate
    URL.revokeObjectURL = previousRevoke
  }
}

test('R24D: verified deposit receipt downloads once for exact appointment and Patient', async () => {
  const { result, downloaded, fetched } = await downloadWith(response())
  assert.equal(result.ok, true)
  assert.equal(downloaded, 1)
  assert.equal(fetched, 1)
})

test('R24D: wrong or missing appointment/Patient identity cannot download', async () => {
  for (const patch of [
    { appointmentId: 'wrong' }, { appointmentId: null },
    { patientId: 'wrong' }, { patientId: null },
  ]) {
    const { result, downloaded } = await downloadWith(response(patch))
    assert.equal(result.ok, false, JSON.stringify(patch))
    assert.equal(result.kind, 'unverified')
    assert.equal(downloaded, 0)
  }
})

test('R24D: a JSON or HTML 200 cannot be saved as a booking receipt PDF', async () => {
  for (const type of ['application/json', 'text/html']) {
    const { result, downloaded } = await downloadWith(response({ type }))
    assert.equal(result.kind, 'unverified')
    assert.equal(downloaded, 0)
  }
})

test('R24D: a missing/previously refunded receipt never generates a local success', async () => {
  const { result, downloaded } = await downloadWith(response({ status: 404 }))
  assert.equal(result.kind, 'not_found')
  assert.equal(downloaded, 0)
})

test('R24D: stale session prevents dispatch and download', async () => {
  const stopped = await downloadWith(response(), { isCurrent: () => false })
  assert.equal(stopped.result.kind, 'stale_context')
  assert.equal(stopped.fetched, 0)
  assert.equal(stopped.downloaded, 0)
  let current = true
  const midFlight = await downloadWith(() => { current = false; return response() }, { isCurrent: () => current })
  assert.equal(midFlight.result.kind, 'stale_context')
  assert.equal(midFlight.downloaded, 0)
})

test('R24D: booking deposit and final invoice remain separate patient actions', () => {
  const page = readFileSync('src/patient/pages/Visits.jsx', 'utf8')
  assert.match(page, /a\.booking_payment_status === 'paid' && Number\(a\.booking_fee_php\) > 0/)
  assert.match(page, /Download booking deposit receipt/)
  assert.match(page, /Invoice and receipt/)
  assert.match(page, /patientId: appointment\.patient\.id, signal, isCurrent:/)
  assert.match(page, /startHomeRead\(/)
  assert.match(page, /pending\.current\?\.cancel\(\)/)
})

test('R24D: PHP deposit endpoint emits scoped, private identity headers', () => {
  const php = readFileSync('backend/app/Http/Controllers/AppointmentController.php', 'utf8')
  const receipt = php.slice(php.indexOf('public function receiptPdf'), php.indexOf('public function receiptPdf') + 1300)
  assert.match(receipt, /Gate::denies\('view', \$appointment\)/)
  assert.match(receipt, /booking_payment_status === 'paid'/)
  assert.match(receipt, /'X-Appointment-Id' => \$appointment->public_id/)
  assert.match(receipt, /'X-Patient-Id' => \$appointment->patient->public_id/)
  assert.match(receipt, /'Cache-Control' => 'private, no-store'/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

test('STF-11: Check-in enforces ID check confirmation and provides cancellation with predefined reason and specify modal', () => {
  const patientFlow = read('src/pages/PatientFlow.jsx')

  // 1. Staff must confirm valid ID before completing check-in
  assert.match(patientFlow, /Valid ID presented/, 'CheckInPage must render valid ID checkbox')
  assert.match(patientFlow, /Confirm that the patient presented a valid ID before completing check-in, or cancel the appointment\./, 'checkScheduled must warn if ID is not confirmed')

  // 2. Option to cancel appointment directly from check-in
  assert.match(patientFlow, /Cancel appointment/, 'CheckInPage must provide Cancel appointment button')
  assert.match(patientFlow, /cancelModalOpen/, 'CheckInPage must track cancel modal visibility')

  // 3. Predefined cancellation reasons including "No valid ID presented" and "Other" with specify
  assert.match(read('src/appointments-api.js'), /'No valid ID presented'/, 'Predefined cancellation reasons must include No valid ID presented')
  assert.match(read('src/appointments-api.js'), /'Patient requested cancellation'/, 'Predefined reasons must include Patient requested cancellation')
  assert.match(patientFlow, /SelectWithOther/, 'Cancellation reason selector must support specify for Other')

  // 4. Appointment flow cancel forwards reason and note to API
  const appointmentFlow = read('src/appointment-flow.js')
  assert.match(appointmentFlow, /async cancel\(appointment, key, extra = \{\}\)/, 'flow.cancel must forward extra params')
  assert.match(appointmentFlow, /api\.cancelAppointment\(appointment, key, extra\)/, 'api.cancelAppointment must receive extra params')

  // 5. Backend controller passes reason and note to AppointmentService
  const controller = read('backend/app/Http/Controllers/AppointmentController.php')
  assert.match(controller, /\$request->safe\(\)->only\(\['expected_revision', 'reason', 'note', 'reason_category', 'reason_detail'\]\)/, 'AppointmentController must pass reason and note')

  // 6. Backend service records administrative audit log with cancellation reason
  const service = read('backend/app/Services/Appointments/AppointmentService.php')
  assert.match(service, /recordAdministrative\('appointment\.cancelled'/, 'AppointmentService must log administrative audit for cancellation')
})

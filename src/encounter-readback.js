// A persisted Treatment belongs to one exact Visit/queue/Patient tuple, including a null walk-in appointment.
const publicId = value => typeof value === 'string' && /^[0-7][0-9a-hjkmnp-tv-z]{25}$/i.test(value)
const instant = value => typeof value === 'string' && value.endsWith('+08:00') && Number.isFinite(Date.parse(value))
export function matchesEncounter(row, expected, started = false) {
  if (![expected.visitId,expected.queueEntryId,expected.patientPublicId].every(publicId) || !expected.branchId || !expected.dentistId ||
      !publicId(row?.id) || row.author !== true || !['In Treatment','Completed'].includes(row.status) || !instant(row.started_at) ||
      (row.status==='In Treatment' ? row.completed_at!==null : !instant(row.completed_at)) ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 || row.visit?.id !== expected.visitId ||
      row.patient?.id !== expected.patientPublicId || row.branch?.id !== expected.branchId || row.dentist?.id !== expected.dentistId ||
      (row.requested_service?.id ?? null) !== (expected.serviceId ?? null) ||
      (row.appointment?.id ?? null) !== (expected.appointmentId ?? null) || row.visit?.queue?.id !== expected.queueEntryId ||
      row.visit.status !== row.status || row.visit.queue.status !== 'Served' ||
      row.clinic_date !== expected.clinicDate || row.visit.source !== (expected.appointmentId ? 'appointment' : 'walk_in') ||
      (!expected.appointmentId && row.appointment!==null) ||
      (row.appointment && row.appointment.status !== row.status) || (expected.treatmentId && row.id !== expected.treatmentId)) return false
  return !started || row.status === 'In Treatment' && row.revision === 1 && row.completed_at === null &&
    row.visit.revision === expected.visitRevision + 1 && row.visit.queue.revision === expected.queueRevision + 1
}

// A timeout reports uncertainty; it never implies cancellation of a server transaction.
export async function boundedEncounter(work, timeoutMs = 30000) {
  let timer
  try { return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Encounter readback unavailable')), timeoutMs) })]) }
  finally { clearTimeout(timer) }
}

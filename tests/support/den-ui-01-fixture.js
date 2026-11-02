export const today = '2026-11-01'
export function dentistFixture() {
  const session = { role: 'dentist', active: true, userId: 'dentist-user', dentistId: 'd1', branchId: 'b1', serverUserId: 'fixture-dentist' }
  const state = { persons: [{ id: 'person1' }], users: [{ id: session.userId, personId: 'person1', branchId: 'b1', roleName: 'Dentist', accountStatus: 'Active', permissions: ['schedule', 'queue', 'clinical-records', 'treatment', 'prescriptions', 'followups', 'messages'] }],
    dentists: [{ id: 'd1', userId: session.userId, personId: 'person1', branchIds: ['b1', 'b2'], on_duty_today: true }],
    branches: [{ id: 'b1', name: 'Illustrative Central Branch', status: 'Open' }, { id: 'b2', name: 'Illustrative North Branch', status: 'Open' }], patients: [{ id: 'p1', name: 'Illustrative Patient', serverProjection: true }],
    appointments: [], queue: [], treatments: [], followups: [], prescriptions: [], notifications: [], conversations: [] }
  return { state, session }
}
export function apiAppointment(id = 'appointment-1', extra = {}) {
  return { id, code: 'Illustrative reference ' + id, date: today, start_time: '09:00', end_time: '09:30', duration_minutes: 30, status: 'Pending',
    patient: { id: 'p1', name: 'Illustrative Patient with a long family name', code: 'Illustrative code' }, branch: { id: 'b1', name: 'Illustrative Central Branch' }, service: { name: 'Consultation' }, dentist: { id: 'd1', name: 'Illustrative Dentist' }, ...extra }
}

import React from 'react'
import { createRoot } from 'react-dom/client'
import { WorkSchedulesPage } from '/src/pages/Staffing.jsx'
import '/src/styles.css'
import '/src/foundation.css'

const params = new URLSearchParams(location.search)
const role = params.get('role') || 'dentist'
const branches = [
  { id: 'b1', name: 'Fictional Main Branch', editable: role === 'owner' },
  { id: 'b2', name: 'Fictional Second Branch', editable: role === 'owner' },
]
const hours = Object.fromEntries([1, 2, 3, 4, 5, 6].map(day => [day, { open: '09:00', close: '18:00' }]))
const weekly = params.has('profile') ? [] : [
  { branch: branches[0], weekday: 1, start: '09:00', end: '17:00', break_start: '12:00', break_end: '13:00' },
  { branch: branches[1], weekday: 1, start: '10:00', end: '16:00', break_start: null, break_end: null },
  { branch: branches[0], weekday: 2, start: '09:00', end: '17:00', break_start: null, break_end: null },
]
const dentist = { id: 'd1', name: 'Dr. Fictional Provider', branches, weekly, profile_hours: params.has('profile') ? { start: '09:00', end: '17:00' } : null, demo: false }
const dutyRows = params.get('duty') === 'unknown' ? [] : [
  { dentist_id: 'd1', branch_id: 'b1', on_duty_today: true },
  { dentist_id: 'd1', branch_id: 'b2', on_duty_today: false },
]
const data = {
  dentists: params.has('empty') ? [] : [dentist], staff: [], exceptions: [],
  branches: branches.map(branch => ({ ...branch, hours })),
  weekdays: { 7: 'Sunday', 3: 'Wednesday', 1: 'Monday', 6: 'Saturday', 2: 'Tuesday', 5: 'Friday', 4: 'Thursday' },
  duty: { date: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), rows: role === 'staff' ? dutyRows.filter(row => row.branch_id === 'b1') : dutyRows },
  wording_approved: true,
}
window.den12 = { calls: [], messages: [], failSave: false, data }
window.fetch = async (url, options = {}) => {
  const path = String(url)
  if (path.includes('csrf-cookie')) return { ok: true, status: 204, json: async () => null }
  if (path.includes('/weekly')) {
    const body = JSON.parse(options.body)
    window.den12.calls.push(body)
    if (window.den12.failSave) return { ok: false, status: 422, json: async () => ({ message: 'Hours cannot be saved.', errors: { start_time: ['Hours cannot be saved.'] } }) }
    return { ok: true, status: 200, json: async () => ({ data: { affected: [] } }) }
  }
  if (path.includes('/affected')) return { ok: true, status: 200, json: async () => ({ data: { affected: [], wording_approved: true } }) }
  return { ok: true, status: 200, json: async () => ({ data }) }
}
const identity = {id:role === 'dentist' ? 'dentist-user' : 'staff-user',personId:'synthetic-person',role:role === 'owner' ? 'Owner / Admin' : role === 'dentist' ? 'Dentist' : 'Staff',status:'Active',branchId:'b1',permissions:role === 'owner' ? ['all'] : ['schedule','appointments']}
const store = { state: { users:[identity],persons:[{id:'synthetic-person'}],staff:[{userId:identity.id,personId:identity.personId,branchId:'b1'}],dentists:[{id:'d1',userId:identity.id,personId:identity.personId,branchIds:['b1','b2']}],branches: [] }, session: { serverUserId:'synthetic-account',active:true,branchId:'b1',branchScopes:['b1'],role, userId: role === 'dentist' ? 'dentist-user' : 'staff-user', dentistId: 'd1', name: 'Dr. Fictional Provider' }, toast: (message, tone) => window.den12.messages.push({ message, tone }) }
createRoot(document.getElementById('root')).render(<main style={{ maxWidth: 1200, margin: 'auto', padding: 16 }}><WorkSchedulesPage store={store} role={role}/></main>)

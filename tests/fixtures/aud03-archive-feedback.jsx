import React, { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { ArchivesPage } from '../../src/pages/ArchivesPage.jsx'
import { setClockSource } from '../../src/clock.js'
import '../../src/styles.css'
import '../../src/foundation.css'

setClockSource(() => new Date('2026-11-06T02:00:00Z'))
const harness = window.aud03 = { requests: [], refreshes: 0, audits: [], pending: [] }
window.fetch = async (...args) => { harness.requests.push(args); throw Error('AUD-03 refuses all HTTP operations') }
const row = { id: 'synthetic-appointment', code: 'SYN-APT', date: '2026-11-05', status: 'Confirmed', branchId: 'a', branchName: 'Synthetic Branch', dentistId: 'dentist', patientId: 'synthetic-patient', patientName: 'Synthetic Patient', serviceName: 'Synthetic service' }
const initial = {
  users: ['owner', 'staff', 'dentist', 'patient'].map(id => ({ id, personId: id, role: id === 'owner' ? 'Owner / Admin' : id[0].toUpperCase() + id.slice(1), status: 'Active', branchId: 'a', permissions: id === 'patient' ? ['patient-portal'] : ['all'] })),
  persons: ['owner', 'staff', 'dentist', 'patient'].map(id => ({ id })), staff: [{ userId: 'staff', personId: 'staff', branchId: 'a' }],
  dentists: [{ id: 'dentist', userId: 'dentist', personId: 'dentist', branchIds: ['a'], branches: ['Synthetic Branch'] }],
  branches: [{ id: 'a', name: 'Synthetic Branch' }], patients: [{ id: 'synthetic-patient', userId: 'patient', personId: 'patient' }],
  appointments: [], prescriptions: [], invoices: [],
}
const actor = (role = 'owner', branchScopes = ['a']) => ({ role, userId: role, serverUserId: 'synthetic-' + role, active: true, branchId: 'a', branchScopes, dentistId: 'dentist', patientId: 'synthetic-patient' })
function Fixture() {
  const [state, setState] = useState(initial), [session, setSession] = useState(actor())
  const [status, setStatus] = useState('ready'), [available, setAvailable] = useState(true), [mounted, setMounted] = useState(true)
  harness.configure = ({ status = 'ready', collection = 'empty', role = 'owner', scopes = ['a'], retry = true } = {}) => flushSync(() => {
    setState({ ...initial, appointments: collection === 'unavailable' ? undefined : collection === 'rows' ? [row] : [] })
    setSession(actor(role, scopes)); setStatus(status); setAvailable(retry); setMounted(true)
  })
  harness.patch = patch => flushSync(() => setState(previous => ({ ...previous, ...patch })))
  harness.setActor = (role, scopes = ['a']) => flushSync(() => setSession(actor(role, scopes)))
  harness.unmount = () => flushSync(() => setMounted(false))
  const refresh = async () => {
    harness.refreshes++
    setStatus(previous => previous === 'ready' ? previous : 'loading')
    if (available === 'reject-immediately') throw Error('Synthetic immediate read rejection')
    const result = await new Promise((resolve, reject) => harness.pending.push({ resolve, reject }))
    // Synthetic store adapter: production store owns its own identity generation gate.
    if (!result.superseded) {
      setStatus(result.ok ? 'ready' : 'error')
      if (result.ok) setState(previous => ({ ...previous, appointments: result.empty ? [] : [row] }))
    }
    return result
  }
  harness.complete = result => harness.pending.shift().resolve(result)
  harness.reject = () => harness.pending.shift().reject(Error('Synthetic rejected read'))
  const store = { state, session, appointmentsStatus: status, appointmentFlow: available ? { refresh } : {},
    actions: { logAudit: event => harness.audits.push(event) }, toast() {} }
  harness.store = store
  return mounted ? <ArchivesPage store={store} role={session.role}/> : <p>Fixture unmounted</p>
}
createRoot(document.getElementById('root')).render(<StrictMode><Fixture/></StrictMode>)

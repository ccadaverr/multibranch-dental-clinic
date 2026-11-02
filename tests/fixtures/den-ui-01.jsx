import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Shell } from '/src/layout.jsx'
import { DashboardPage } from '/src/pages/Dashboards.jsx'
import { SchedulePage } from '/src/pages/Scheduling.jsx'
import { setClockSource } from '/src/clock.js'
import { dentistFixture, today } from '../support/den-ui-01-fixture.js'
import '/src/styles.css'
import '/src/foundation.css'
import '/src/patient.css'
import '/src/polish.css'
setClockSource(() => new Date('2026-11-01T10:00:00+08:00'))
function Fixture() {
  const [page, setPage] = useState('dashboard'), [context, setContext] = useState(null)
  const [mode, setMode] = useState('populated'), [refreshes, setRefreshes] = useState(0)
  const { state, session } = dentistFixture()
  if (mode === 'revoked') state.dentists[0].branchIds = []
  if (mode === 'populated') {
    state.queue = [{ id: 'q1', walkIn: true, server: true, visitId: 'v1', dentistId: 'd1', branchId: 'b1', patientId: 'p1', patientName: 'Illustrative Waiting Patient', status: 'In Queue', clinicDate: today, checkedIn: '08:45', queueNumber: 1, position: 1 }]
    state.treatments = [{ id: 't1', server: true, status: 'In Treatment', visitId: 'v-old', queueEntryId: 'q-old', dentistId: 'd1', branchId: 'b1', patientId: 'p1', patientName: 'Illustrative Active Patient' }]
  }
  const go = (page, context = null) => { setContext(context); setPage(page) }
  window.denFixture = { go, setMode, getContext: () => context, getRefreshes: () => refreshes }
  const store = { state, session, appointmentsStatus: mode === 'clinical-error' ? 'error' : mode === 'loading' ? 'loading' : 'ready', appointmentsError: 'Illustrative connection failure', appointmentsTruncated: mode === 'incomplete', queueSnapshot: { date: today, truncated: false }, appointmentFlow: { refresh: async () => { setRefreshes(n => n + 1); return { ok: true } } }, toast() {} }
  return <Shell role="dentist" page={page} store={store} setPage={go} onLogout={() => {}} activeBranch="Illustrative Central Branch" setActiveBranch={() => {}}>
    <p style={{ fontSize: 12, color: '#526674' }}>Illustrative test data - component acceptance, no live patient records</p>
    {page === 'dashboard' ? <DashboardPage role="dentist" store={store} setPage={go}/> : page === 'schedule' ? <SchedulePage store={store}/> : <><h1>{page}</h1><p>Authorized navigation callback recorded by fixture.</p><button onClick={() => go('dashboard')}>Return to Home</button></>}
  </Shell>
}
createRoot(document.getElementById('root')).render(<Fixture/>)

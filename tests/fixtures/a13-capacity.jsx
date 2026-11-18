import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CapacityPage } from '../../src/pages/PatientFlow.jsx'
import { clinicDate } from '../../src/clock.js'
import '../../src/styles.css'
import '../../src/foundation.css'

const branch = { id: 'b1', name: 'Synthetic branch' }
const date = clinicDate()
const row = (id, status, fields = {}) => ({
  id, status, clinicDate: date, branchId: branch.id, branch: branch.name,
  patientName: 'Synthetic ' + id, ...fields,
})
const checkedIn = row('arrival', 'Waiting', { queueNumber: 1, visitStatus: 'Checked In', time: '10:00' })

function Fixture() {
  const [queue, setQueue] = useState([])
  return <>
    <button onClick={() => setQueue([checkedIn])}>Load checked-in Visit</button>
    <button onClick={() => setQueue([checkedIn, row('called', 'Called'), row('served', 'Served', { visitStatus: 'In Treatment' }), row('sparse', undefined)])}>Load mixed results</button>
    <CapacityPage activeBranch="All Branches" setPage={() => {}} store={{
      session: { serverUserId: 'staff', role: 'staff' },
      appointmentsStatus: 'ready', queueSnapshot: { date, truncated: false },
      state: { branches: [branch], queue, patients: [], dentists: [] },
    }}/>
  </>
}

createRoot(document.getElementById('root')).render(<Fixture/>)

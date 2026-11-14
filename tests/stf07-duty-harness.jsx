import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { StaffOnDuty } from '/src/pages/StaffOnDuty.jsx'
import { clinicNow, setClockSource } from '/src/clock.js'
import '/src/styles.css'
import '/src/foundation.css'

let instant = '2026-10-29T02:00:00Z'
setClockSource(() => new Date(instant))
window.stf07 = { mode: 'ready', calls: 0, setInstant(value) { instant = value } }

window.fetch = async () => {
  window.stf07.calls++
  if (window.stf07.mode === 'forbidden') return { ok: false, status: 403, json: async () => ({ message: 'Forbidden' }) }
  if (window.stf07.mode === 'error') return { ok: false, status: 500, json: async () => ({ message: 'Unavailable' }) }
  const rows = window.stf07.mode === 'empty' ? [] : [
    { dentist_id: 'd1', dentist_name: 'Dr. Fictional Long Name', branch_id: 'b1', branch_name: 'Fictional Main Branch', on_duty_today: true, working_now: true, working_minutes: 420, estimated:false },
    { dentist_id: 'd1', dentist_name: 'Dr. Fictional Long Name', branch_id: 'b2', branch_name: 'Fictional Secondary Branch', on_duty_today: false, working_now: false, working_minutes: 0, estimated:false },
  ]
  return { ok: true, status: 200, json: async () => ({ data: { duty: { date: clinicNow().date, as_of: clinicNow().timestamp, rows } } }) }
}

function Harness() {
  const [branch, setBranch] = useState('All Branches')
  return <main style={{maxWidth: '1200px', margin: '0 auto', padding: '16px'}}>
    <label>Branch view <select aria-label="Branch view" value={branch} onChange={event => setBranch(event.target.value)}><option>All Branches</option><option>Fictional Main Branch</option><option>Fictional Secondary Branch</option></select></label>
    <StaffOnDuty session={{ serverUserId: 'fictional-staff',role:'staff',active:true,branchScopes:['b1','b2'] }} activeBranch={branch}/>
  </main>
}
createRoot(document.getElementById('root')).render(<Harness />)

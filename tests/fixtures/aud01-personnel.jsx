import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Shell, ToastStack } from '/src/layout.jsx'
import { TeamPage } from '/src/pages/Admin.jsx'
import { Notice } from '/src/components.jsx'
import { canAccessPage } from '/src/safeguards.js'
import { createWorkflowActions } from '/src/workflow.js'
import { normalizeClinicState } from '/src/contracts.js'
import { personnelFixture } from '../support/aud01-personnel.js'
import '/src/styles.css'
import '/src/foundation.css'
import '/src/patient.css'
import '/src/polish.css'
import '/src/automations.css'

const params = new URLSearchParams(location.search)
const role = params.get('role') || 'owner'
const fixture = window.personnel = { writes:[], feedback:[], fail:false, hold:false }
// Block every request from reaching a live API, including shell notification polling.
window.fetch = async (url, options = {}) => {
  const path = new URL(url, location.href).pathname
  if (path === '/sanctum/csrf-cookie') return new Response(null, {status:204})
  if (path === '/api/notifications') return Response.json({data:[], unread_count:0})
  if (path === '/api/conversations') return Response.json({data:[]})
  if (path === '/api/presence') return Response.json({data:{}})
  if (options.method === 'PATCH' && /^\/api\/(dentists|staff)\//.test(path)) {
    const entry = { path, body:JSON.parse(options.body) }
    fixture.writes.push(entry)
    if (fixture.hold) await new Promise(resolve => { entry.release = resolve })
    if (fixture.fail) return Response.json({message:'Synthetic save refused'}, {status:422})
    const row = fixture.state.dentists.find(d => d.id === path.split('/').at(-1))
    return Response.json({data:{id:row.id, userId:row.userId, personId:row.personId, license_no:entry.body.license_no, specialty:entry.body.specialty, branch_ids:entry.body.branch_ids, service_ids:row.serviceIds || [], assistantStaffId:entry.body.assistant_staff_ref, shiftStart:entry.body.shift_start, shiftEnd:entry.body.shift_end, available:entry.body.available}})
  }
  return Response.json({message:'Unexpected synthetic request'}, {status:500})
}

function Fixture() {
  const initial = useRef(personnelFixture(role))
  const [state, setState] = useState(initial.current.state)
  const [page, setPage] = useState(params.get('page') || 'dashboard')
  const [toasts, setToasts] = useState([])
  const session = initial.current.session
  const latest = useRef(state); latest.current = state
  fixture.state = state
  fixture.go = setPage
  fixture.empty = () => setState(current => ({...current, dentists:[], staff:[]}))
  const actions = createWorkflowActions({getState:() => latest.current, getSession:() => session, commit:patch => setState(current => normalizeClinicState({...current, ...patch}))})
  const toast = (message, tone) => { fixture.feedback.push({message, tone}); setToasts(rows => [...rows, {id:String(rows.length), message, tone}]) }
  const store = {state, session, actions, toast}
  const go = key => { if (canAccessPage(state, session, key)) setPage(key) }
  return <><Shell role={role} page={page} store={store} setPage={go} onLogout={() => {}} activeBranch="All Branches" setActiveBranch={() => {}}>
    <p>Synthetic personnel acceptance — no live clinic data.</p>
    {!canAccessPage(state, session, page) ? <Notice>This screen is no longer available with your current permissions.</Notice> : page === 'team' ? <TeamPage store={store}/> : <h1>{page}</h1>}
  </Shell><ToastStack toasts={toasts}/></>
}
createRoot(document.getElementById('root')).render(<Fixture/>)

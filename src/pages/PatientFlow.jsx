import { DentistQueue } from './DentistQueue.jsx'
import React, { useEffect, useState, useRef } from 'react'
import { Button, Card, Field, FilterBar, Icon, Modal, Notice, PageHeader, Progress, RefreshButton, SelectWithOther, Status, Table } from '../components.jsx'
import { branchCapacity, dentistName, displayTime, patientName, queueWaitEstimate } from '../logic.js'
import { commandKey } from '../appointments-api.js'
import { findPatientConversation } from '../messaging-api.js'
import '../b4-queue.css'
import { useVisibleRefresh } from '../use-visible-refresh.js'
import { patientKeyResolver } from '../appointment-projection.js'
import { DEFAULT_COUNTRY, normalizePhoneNumber } from '../phone.js'
import { bookableBranches } from './Scheduling.jsx'

import { addCalendarMonths, clinicDate } from '../clock.js'
import { PatientQueuePage } from './PatientVisits.jsx'
import { PossibleNoShows } from './PossibleNoShows.jsx'
import { FrontDeskToday } from './FrontDeskToday.jsx'
import { CounterCode, IdCheck, SelfRegistered } from './CounterIntake.jsx'
import { QueueByBranch, QueueStatusCounts, useQueueVisibility } from './QueueCounts.jsx'
import { encounterContext, inScope, isActiveQueue, isTodayQueue, sessionForRole } from '../contracts.js'

// M8 front desk. Arrival is server-authoritative: a scheduled Check-In or a Walk-In opens a server Visit (the scheduled
// appointment moves to Checked In) and — when the Visit has a responsible Dentist — queues it, all in one server
// transaction (M9). Patients come from the server directory (or the minimal front-desk registration); nothing here
// writes an arrival or queue record locally.
export function CheckInPage({ store, context, setPage }) {
  const { state, toast }=store
  const session=store.session||sessionForRole('staff',state)
  const flow=store.appointmentFlow
  const [mode,setMode]=useState(context?.mode||'scheduled')
  const today=clinicDate()
  useEffect(()=>{ flow?.searchPatients?.('') }, [])
  // Today's server appointments awaiting arrival (no Visit yet), sorted chronologically earliest first.
  const eligible=state.appointments.filter(a=>inScope(a,session,state)&&a.date===today&&['Confirmed','Pending'].includes(a.status)&&!(state.visits||[]).some(v=>v.appointmentId===a.id)).sort((a,b)=>(a.start||'').localeCompare(b.start||''))
  // Today's server Visits that are checked in but not in a queue: only a Visit without a responsible Dentist (M9 Q4).
  // Shown honestly; no assignment workflow exists in this wave.
  const notQueued=(state.visits||[]).filter(v=>v.status==='Checked In'&&v.clinicDate===today&&inScope(v,session,state)&&!v.dentistId)
  const [appointmentId,setAppointmentId]=useState('')
  const selectedAppointment=eligible.find(a=>a.id===appointmentId)
  // One Idempotency-Key per confirm attempt, reused when retrying the same arrival.
  const checkInKey=useRef({appointmentId:null,key:null})
  const [busy,setBusy]=useState(false)
  const [idConfirmed, setIdConfirmed] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('No valid ID presented')
  const [cancelReasonOther, setCancelReasonOther] = useState('')
  const [cancelNote, setCancelNote] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const cancelKey = useRef(commandKey())

  const handleCancelAppointment = async () => {
    if (!selectedAppointment || cancelling) return
    const effectiveReason = cancelReason === 'Other' ? cancelReasonOther.trim() : cancelReason
    if (cancelReason === 'Other' && !cancelReasonOther.trim()) {
      return toast('Please specify the cancellation reason.', 'warning')
    }
    setCancelling(true)
    const result = await flow.cancel(selectedAppointment, cancelKey.current, {
      reason: effectiveReason,
      note: cancelNote.trim() || undefined,
    })
    setCancelling(false)
    if (!result.ok) {
      return toast(result.message || 'Failed to cancel appointment.', 'warning')
    }
    toast(`Appointment cancelled. Reason: ${effectiveReason}`, 'success')
    setCancelModalOpen(false)
    setAppointmentId('')
    setIdConfirmed(false)
    setCancelReason('No valid ID presented')
    setCancelReasonOther('')
    setCancelNote('')
    cancelKey.current = commandKey()
  }
  const checkScheduled=async()=>{
    if(!selectedAppointment||busy)return
    if(!idConfirmed){
      return toast('Confirm that the patient presented a valid ID before completing check-in, or cancel the appointment.', 'warning')
    }
    if(checkInKey.current.appointmentId!==selectedAppointment.id)checkInKey.current={appointmentId:selectedAppointment.id,key:commandKey()}
    setBusy(true)
    const result=await flow.checkIn(selectedAppointment.id,checkInKey.current.key)
    setBusy(false)
    if(!result.ok)return toast(result.message,'warning')
    checkInKey.current={appointmentId:null,key:null}
    setAppointmentId('');toast(result.queued?`Arrival recorded — queue number ${result.queueNumber}.`:'Arrival recorded.','success')
  }

  const branches=bookableBranches(state,session)
  const [walkIn,setWalkIn]=useState({patientPublicId:'',branchId:branches[0]?.id||'',dentistId:'',serviceId:''})
  const walkKey=useRef(commandKey())
  const [admitted,setAdmitted]=useState(false)
  const [search,setSearch]=useState('')
  const [patientMenuOpen,setPatientMenuOpen]=useState(false)
  const [activeIndex,setActiveIndex]=useState(-1)
  useEffect(()=>{if(search.trim().length>=2){const t=setTimeout(()=>flow?.searchPatients(search),250);return ()=>clearTimeout(t)}},[search])
  const directory=(store.directoryPatients||[]).filter(p=>!search.trim()||`${p.name} ${p.patientCode} ${p.phone}`.toLowerCase().includes(search.trim().toLowerCase()))
  const walkServices=state.services.filter(s=>s.status==='Active'&&state.branchServices.some(bs=>bs.branchId===walkIn.branchId&&bs.serviceId===s.id&&bs.active!==false))
  const walkDentists=state.dentists.filter(d=>d.available&&d.branchIds.includes(walkIn.branchId)&&state.dentistServiceAssignments.some(a=>a.dentistId===d.id&&a.serviceId===walkIn.serviceId&&a.isAuthorized!==false))
  const updateWalkin=(key,value)=>{
    setAdmitted(false);walkKey.current=commandKey()
    setWalkIn(previous=>({...previous,[key]:value,...(key==='branchId'?{serviceId:'',dentistId:''}:key==='serviceId'?{dentistId:''}:{})}))
  }
  const [walking,setWalking]=useState(false)
  const [registering,setRegistering]=useState(!!context?.register)
  const selectedPatient=(store.directoryPatients||[]).find(p=>p.id===walkIn.patientPublicId)
  // The Dentist is required here only because the browser-local M9 queue is organized per Dentist; the server Visit
  // itself allows an unresolved Dentist.
  const canWalkIn=!registering&&!!selectedPatient&&!!walkIn.branchId&&!!walkIn.serviceId&&!!walkIn.dentistId&&!walking&&!admitted
  const checkWalkin=async()=>{
    if(!canWalkIn)return
    setWalking(true)
    const patientId=patientKeyResolver({session,users:state.users,patients:state.patients})(walkIn.patientPublicId)
    const result=await flow.walkIn({...walkIn,patientId},walkKey.current)
    setWalking(false)
    if(!result.ok)return toast(result.message,'warning')
    setAdmitted(true);toast(result.queued?`Walk-in admitted — queue number ${result.queueNumber}.`:'Walk-in arrival recorded.','success')
  }

  // Minimal front-desk registration of a new walk-in Patient (Person + Patient on the server, no login account).
  const emptyPatient={firstName:'',lastName:'',phone:'',email:'',dob:''}
  const [newPatient,setNewPatient]=useState(emptyPatient)
  const registerKey=useRef(commandKey())
  const [registerError,setRegisterError]=useState('')
  const updateNewPatient=(key,value)=>{registerKey.current=commandKey();setRegisterError('');setNewPatient(previous=>({...previous,[key]:value}))}
  const register=async()=>{
    const phone=newPatient.phone.trim()?normalizePhoneNumber(DEFAULT_COUNTRY.dial,newPatient.phone):{ok:true,e164:''}
    if(!newPatient.firstName.trim()||!newPatient.lastName.trim())return setRegisterError('Enter the patient’s first and last name.')
    if(!phone.ok)return setRegisterError(phone.reason)
    const result=await flow.registerPatient({...newPatient,firstName:newPatient.firstName.trim(),lastName:newPatient.lastName.trim(),phone:phone.e164,email:newPatient.email.trim()},registerKey.current)
    if(!result.ok)return setRegisterError(result.message)
    flow?.searchPatients?.('')
    updateWalkin('patientPublicId',result.patient.id)
    setNewPatient(emptyPatient);setRegistering(false);registerKey.current=commandKey()
    toast(`Created registration: ${result.patient.name} (${result.patient.patientCode}).`,'success')
  }
  const selectCombPatient=p=>{updateWalkin('patientPublicId',p.id);setSearch(`${p.name} • ${p.patientCode}`);setPatientMenuOpen(false);setActiveIndex(-1)}

  return <>
    <PageHeader kicker="Front desk" title="Patient check-in" text="Confirm arrival and move the patient into the live queue. Arrivals are recorded by the clinic server; no repeated registration is needed for an existing patient."
      aside={<div className="row-actions">
        <RefreshButton size="sm" onClick={()=>flow?.refresh()}/>
      </div>}/>
    <AppointmentsLoadNotice store={store}/>
    <div className="checkin-shell">
      <div className="checkin-mode"><button className={mode==='scheduled'?'active':''} onClick={()=>setMode('scheduled')}><Icon name="calendar" size={18}/>Scheduled arrivals</button><button className={mode==='walkin'?'active':''} onClick={()=>setMode('walkin')}><Icon name="user" size={18}/>Walk-in admission</button></div>
      {mode==='scheduled'?<Card className="checkin-focus-card" title="Scheduled arrivals" subtitle="Select the patient who has arrived (earliest first).">
        <div className="checkin-select-row"><Field label="Today’s appointment"><select value={selectedAppointment?.id||''} onChange={e=>{setAppointmentId(e.target.value);setIdConfirmed(false)}}><option value="">Select appointment</option>{eligible.map(a=><option value={a.id} key={a.id}>{displayTime(a.start)} • {patientName(a.patientId,state.patients)} • {a.service}</option>)}</select></Field></div>
        {selectedAppointment?<div className="arrival-card"><div className="avatar large">{patientName(selectedAppointment.patientId,state.patients).split(' ').map(x=>x[0]).slice(0,2).join('')}</div><div className="arrival-main"><span>Arriving patient</span><h2>{patientName(selectedAppointment.patientId,state.patients)}</h2><p>{selectedAppointment.service} • {selectedAppointment.dentistName||dentistName(selectedAppointment.dentistId,state.dentists)}</p><div className="arrival-meta"><span><Icon name="calendar" size={15}/>{displayTime(selectedAppointment.start)}</span><span><Icon name="building" size={15}/>{selectedAppointment.branch}</span><span>{selectedAppointment.appointmentNo}</span></div></div><div className="arrival-action">
            <Status>{selectedAppointment.status}</Status>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', margin: '4px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={idConfirmed} onChange={e=>setIdConfirmed(e.target.checked)}/>
              <span>Valid ID presented</span>
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <Button onClick={checkScheduled} disabled={busy || cancelling} icon="checkin">{busy ? 'Recording…' : 'Confirm arrival'}</Button>
              <Button variant="ghost" onClick={() => { cancelKey.current = commandKey(); setCancelModalOpen(true) }} disabled={busy || cancelling}>Cancel appointment</Button>
            </div>
          </div></div>:<Notice>Select an appointment to check the patient in.</Notice>}
        {selectedAppointment?.patientPublicId&&session?.role==='staff'&&<IdCheck patientId={selectedAppointment.patientPublicId} toast={toast}/>}
        {cancelModalOpen && selectedAppointment && (
          <Modal title={`Cancel appointment: ${patientName(selectedAppointment.patientId, state.patients)}`} onClose={() => !cancelling && setCancelModalOpen(false)}>
            <div className="form-grid">
              <Notice tone="warning">Cancelling this appointment will mark it as Cancelled on the clinic server and reopen any linked follow-up.</Notice>
              <div className="span-2">
                <SelectWithOther
                  label="Cancellation reason"
                  required
                  value={cancelReason}
                  onChange={setCancelReason}
                  options={['No valid ID presented', 'Patient requested cancellation', 'Patient unable to proceed', 'Emergency / personal conflict', 'Other']}
                  otherValue={cancelReasonOther}
                  onOtherChange={setCancelReasonOther}
                  placeholder="e.g., Unreachable, Duplicate booking, Arrived late"
                />
              </div>
              <Field className="span-2" label="Additional note" hint="Optional note recorded in audit">
                <input value={cancelNote} maxLength={500} placeholder="Any specific context…" onChange={e => setCancelNote(e.target.value)} />
              </Field>
              <div className="span-2 row-actions" style={{ justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                <Button variant="ghost" onClick={() => setCancelModalOpen(false)} disabled={cancelling}>Keep appointment</Button>
                <Button
                  className="pp-danger-solid"
                  disabled={cancelling || (cancelReason === 'Other' && !cancelReasonOther.trim())}
                  onClick={handleCancelAppointment}
                >
                  {cancelling ? 'Cancelling…' : 'Confirm cancellation'}
                </Button>
              </div>
            </div>
          </Modal>
        )}
        <div className="checkin-note"><Icon name="shield" size={17}/><div><b>Fast admission</b><span>The existing patient profile and appointment already identify the patient. The clinic server records the arrival, opens the visit and adds it to the Dentist’s queue; a patient who did not arrive is marked No-show from Appointments.</span></div></div>
        {notQueued.length>0&&<div className="top-gap"><Notice tone="info" title="Checked in, not in a queue">These visits have no responsible Dentist yet, so they are not in a Dentist’s queue and treatment can’t start. Assigning a Dentist later isn’t available yet.</Notice>
          {notQueued.map(v=><div className="clinical-history" key={v.id}><div><b>{v.patientName||patientName(v.patientId,state.patients)}</b><p>{v.walkIn?'Walk-in':v.appointmentCode} • arrived {displayTime(v.checkedIn)} • No Dentist assigned</p></div></div>)}
        </div>}
      </Card>:<Card title="Walk-in admission" subtitle="Find an existing patient or register a new walk-in patient, then select branch, service and dentist."><div className="form-grid">
        <div className="span-2" style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: !registering ? 'bold' : 'normal' }}>
            <input type="radio" name="walkinType" checked={!registering} onChange={()=>setRegistering(false)}/> Existing registered patient
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: registering ? 'bold' : 'normal' }}>
            <input type="radio" name="walkinType" checked={registering} onChange={()=>{setRegistering(true);updateWalkin('patientPublicId','');setSearch('');setPatientMenuOpen(false);setActiveIndex(-1)}}/> New patient registration
          </label>
        </div>
        {!registering && <>
        {!registering && <div className="span-2 patient-combobox">
          <Field label="Patient" required hint="Search the clinic Patient directory by name, code or phone, then select in one step.">
            <input role="combobox" aria-expanded={patientMenuOpen} aria-autocomplete="list" aria-controls="walkin-patient-listbox" aria-activedescendant={patientMenuOpen&&directory[activeIndex]?`walkin-patient-option-${activeIndex}`:undefined} value={search} placeholder="Type name, patient code, or phone…" onFocus={()=>setPatientMenuOpen(true)} onBlur={()=>setTimeout(()=>setPatientMenuOpen(false),150)} onChange={e=>{setSearch(e.target.value);setPatientMenuOpen(true);setActiveIndex(-1);if(walkIn.patientPublicId)updateWalkin('patientPublicId','')}} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setPatientMenuOpen(true);setActiveIndex(i=>Math.min(i+1,Math.max(0,directory.length-1)))}else if(e.key==='ArrowUp'){e.preventDefault();setActiveIndex(i=>Math.max(0,i-1))}else if(e.key==='Enter'&&patientMenuOpen&&directory[activeIndex]){e.preventDefault();selectCombPatient(directory[activeIndex])}else if(e.key==='Escape'){setPatientMenuOpen(false);setActiveIndex(-1)}}}/>
          </Field>
          {selectedPatient&&<div className="patient-combobox-selected"><span>Selected: <b>{selectedPatient.name}</b> ({selectedPatient.patientCode})</span><button type="button" className="icon-btn" aria-label="Clear selected patient" onClick={()=>{updateWalkin('patientPublicId','');setSearch('');setPatientMenuOpen(true)}}><Icon name="x" size={14}/></button></div>}
          {patientMenuOpen&&<ul id="walkin-patient-listbox" role="listbox" className="patient-combobox-list">{directory.length?directory.map((p,idx)=><li key={p.id} id={`walkin-patient-option-${idx}`} role="option" aria-selected={walkIn.patientPublicId===p.id} className={`patient-combobox-option ${idx===activeIndex?'is-active':''} ${walkIn.patientPublicId===p.id?'is-selected':''}`.trim()} onMouseDown={e=>{e.preventDefault();selectCombPatient(p)}}><b>{p.name}</b><span>{p.patientCode}{p.phone?` • ${p.phone}`:''}</span></li>):<li className="patient-combobox-empty">No matching patients found.</li>}</ul>}
        </div>}

        </>}
        {registering && <div className="span-2 form-grid" style={{ padding: '14px', background: 'var(--surface-2)', borderRadius: '12px' }}>
          <Field label="First name" required><input value={newPatient.firstName} onChange={e=>updateNewPatient('firstName',e.target.value)}/></Field>
          <Field label="Last name" required><input value={newPatient.lastName} onChange={e=>updateNewPatient('lastName',e.target.value)}/></Field>
          <Field label="Mobile number" hint="Optional. 10 digits starting with 9 (no leading 0)."><input inputMode="tel" value={newPatient.phone} maxLength={10} placeholder="9171234567" onChange={e=>updateNewPatient('phone',e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10))}/></Field>
          <Field label="Email" hint="Optional. If this email is already on file, select that patient instead."><input type="email" value={newPatient.email} onChange={e=>updateNewPatient('email',e.target.value)}/></Field>
          <Field label="Date of birth" hint="Up to 120 years old"><input type="date" min={addCalendarMonths(today, -12 * 120)} max={today} value={newPatient.dob} onChange={e=>updateNewPatient('dob',e.target.value)}/></Field>
          <div className="span-2">{registerError&&<Notice tone="warning">{registerError}</Notice>}<div className="row-actions"><Button size="sm" onClick={register}>Register new patient</Button></div><small className="block-muted">Creates a clinic patient record only — no login account.</small></div>
        </div>}
        <Field label="Branch"><select value={walkIn.branchId} onChange={e=>updateWalkin('branchId',e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Requested service" required><select value={walkIn.serviceId} onChange={e=>updateWalkin('serviceId',e.target.value)}><option value="">Select service</option>{walkServices.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Dentist" required hint="The live queue is organized by Dentist, so choose one now."><select value={walkIn.dentistId} onChange={e=>updateWalkin('dentistId',e.target.value)}><option value="">Select dentist</option>{walkDentists.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        {walkIn.dentistId&&(()=>{
          const dentistQueue=state.queue.filter(q=>q.dentistId===walkIn.dentistId&&isActiveQueue(q)&&isTodayQueue(q))
          const upcomingAppt=state.appointments.find(a=>a.dentistId===walkIn.dentistId&&a.date===today&&['Confirmed','Pending'].includes(a.status))
          return <div className="span-2"><Notice tone={upcomingAppt?'warning':'info'}>
            <b>Dr. {walkDentists.find(d=>d.id===walkIn.dentistId)?.name||'Dentist'} queue load:</b> {dentistQueue.length} patient{dentistQueue.length===1?'':'s'} currently waiting/in chair.
            {upcomingAppt?` Upcoming scheduled appointment: ${displayTime(upcomingAppt.start)} (${upcomingAppt.service}). Walk-ins are queued behind scheduled arrivals and must not displace confirmed appointments.`:' No conflicting scheduled appointments today.'}
          </Notice></div>
        })()}
        <div className="span-2 walkin-action"><Notice tone="info">The clinic server checks branch hours, the service and the Dentist’s shift. A walk-in does not reserve Dentist appointment time.</Notice><Button disabled={!canWalkIn} onClick={checkWalkin} icon="checkin">{walking?'Admitting…':'Admit walk-in to queue'}</Button></div>
      </div></Card>}
    </div>
    <PossibleNoShows toast={toast} onChanged={()=>flow?.refresh()}/>
    <div className="fd-grid"><SelfRegistered toast={toast} store={store} onChanged={()=>flow?.refresh()}/></div>
    <FrontDeskToday toast={toast} onChanged={()=>flow?.refresh()}/>
  </>
}

function AppointmentsLoadNotice({ store }) {
  if(store.appointmentsStatus==='error')return <Notice tone="warning" title="Clinic records couldn’t be loaded">{store.appointmentsError} <Button size="sm" variant="ghost" onClick={()=>store.appointmentFlow?.refresh()}>Try again</Button></Notice>
  if(store.appointmentsStatus==='loading')return <Notice>Loading today’s appointments and visits…</Notice>
  return null
}

function QueueTable({ rows, columns, onOpen, nameOf }) {
  if (!rows.length) return <div className="queue-empty" role="status"><Icon name="users" size={24}/><h3>No patients match this view</h3><p>Try another status or dentist filter, or refresh the queue.</p></div>
  const isAction = target => target.closest?.('button, a, input, select, textarea, [role="button"]')
  return <div className="table-wrap queue-table"><table role="table">
    <caption className="sr-only">Live queue</caption>
    <thead role="rowgroup"><tr role="row">{columns.map(c => <th scope="col" role="columnheader" data-column={c.key} key={c.key}>{c.label}</th>)}</tr></thead>
    <tbody role="rowgroup">{rows.map(row => <tr role="row" key={row.id} className="queue-open-row" tabIndex={0}
      aria-label={`Open chart for ${nameOf(row)}. Press Enter or Space.`}
      onClick={e => { if (!isAction(e.target)) onOpen(row) }}
      onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(row) } }}>
      {columns.map(c => <td role="cell" data-column={c.key} key={c.key}><span className="mobile-cell-label" aria-hidden="true">{c.label}</span><div className="cell-value">{c.render ? c.render(row) : row[c.key]}</div></td>)}
    </tr>)}</tbody>
  </table></div>
}

export function QueuePage(props) {
  return props.role==='dentist'?<DentistQueue {...props}/>:<OperationalQueuePage {...props}/>
}
function OperationalQueuePage({ role, activeBranch, store, setPage }) {
  const { state, toast }=store
  const session=store.session||sessionForRole(role,state)
  const [dentistFilter,setDentistFilter]=useState('All Dentists')
  const [statusFilter,setStatusFilter]=useState('Active')
  const active=isActiveQueue
  const matchesStatusFilter = (q, filter) => {
    if (filter === 'All') return true
    if (filter === 'Active') return active(q)
    const s = q.displayStatus || q.status
    if (filter === 'In Queue') return ['In Queue', 'Waiting'].includes(s)
    if (filter === 'In Treatment') return ['In Treatment', 'Called', 'Treatment Ready'].includes(s)
    if (filter === 'Done') return ['Done', 'Served', 'Completed'].includes(s)
    return s === filter || q.status === filter
  }
  const visible=state.queue.filter(q=>{
    if(!inScope(q,session,state)||!isTodayQueue(q))return false
    if(role==='owner'&&activeBranch!=='All Branches'&&q.branch!==activeBranch)return false
    if(role==='staff'&&dentistFilter!=='All Dentists'&&q.dentistId!==dentistFilter)return false
    return matchesStatusFilter(q, statusFilter)
  }).sort((a,b)=>String(a.branch||'').localeCompare(String(b.branch||''))||String(dentistName(a.dentistId,state.dentists)||'').localeCompare(String(dentistName(b.dentistId,state.dentists)||''))||(a.position||999)-(b.position||999)||(a.queueNumber||0)-(b.queueNumber||0))
  // M9: every queue change is a server command (Idempotency-Key per attempt + expected revision); the server computes
  // numbers and positions. A second click while a command is in flight is ignored.
  const flow=store.appointmentFlow
  const [busy,setBusy]=useState(null)
  const [messageBusy,setMessageBusy]=useState(null)
  const run=async(entry,label,send)=>{
    if(busy)return
    setBusy(entry.id)
    const result=await send(commandKey())
    setBusy(null)
    toast(result.ok?label:(result.message||'The queue could not be updated. Refresh and try again.'),result.ok?'success':'warning')
  }
  const update=(entry,name,label)=>run(entry,label,key=>flow.queueCommand(entry,name,key))
  const openMessage=async entry=>{
    if(messageBusy)return
    setMessageBusy(entry.id)
    const result=await findPatientConversation(entry.patientPublicId,entry.branchId,entry.patientCode)
    setMessageBusy(null)
    if(!result.ok)return toast(result.message||'Conversations could not be checked. Try again.','warning')
    if(!result.conversation)return toast('No accessible conversation for this patient at this branch. Ask the patient to start a message from their portal.','warning')
    setPage('messages',{conversationId:result.conversation.id,conversation:result.conversation,patientCode:entry.patientCode,patientPublicId:entry.patientPublicId,branchId:entry.branchId})
  }
  const [restoreModalEntry, setRestoreModalEntry] = useState(null)
  const restore = entry => {
    setRestoreModalEntry(entry)
  }
  const submitRestore = (entry, reason) => {
    setRestoreModalEntry(null)
    run(entry, 'Normal queue place restored.', key => flow.queueRestoreOrder(entry, reason.trim(), key))
  }
  const operational=['staff','owner'].includes(role)
  const vis=useQueueVisibility(store)
  const demo=vis.mode==='demo'
  useVisibleRefresh(flow?.refresh,{active:role!=='patient'})
  if (role==='patient') return <PatientQueuePage store={store} setPage={setPage}/>
  return <>
    <PageHeader title={role==='dentist'?'My Patient Queue':'Patient Queue'} text="The clinic server keeps the queue: numbers, order and positions update for everyone. First-come, first-served arrival order decides positions inside each Dentist’s queue." aside={<RefreshButton onClick={()=>flow?.refresh()}/>}/>
    <FilterBar ariaLabel={role==='dentist'?'My queue filters':'Queue filters'} onClear={(dentistFilter!=='All Dentists'||statusFilter!=='Active')?()=>{setDentistFilter('All Dentists');setStatusFilter('Active')}:null}>
      <label>Branch <select value={activeBranch} disabled><option>{activeBranch}</option></select></label>
      {role!=='dentist'&&<label>Dentist <select value={dentistFilter} onChange={e=>setDentistFilter(e.target.value)}><option>All Dentists</option>{state.dentists.filter(d=>role==='owner'||d.branchIds.includes(session.branchId)).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
      <label>Status <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="Active">Active</option><option value="All">All</option><option value="In Queue">In Queue</option><option value="In Treatment">In Treatment</option><option value="Done">Done</option></select></label>
    </FilterBar>
    <AppointmentsLoadNotice store={store}/>
    {!demo&&<QueueStatusCounts store={store} activeBranch={role==='owner'?activeBranch:'All Branches'} vis={vis}/>}
    {operational&&!demo&&<SelfRegistered toast={toast} store={store} compact/>}
    {role==='staff'&&<Notice tone="info">A patient in the queue has already checked in. Marking them as having left or cancelling their visit isn’t available yet — the clinic still needs to decide how an admitted visit is closed. A patient who never arrived is marked No-show from Appointments.</Notice>}
    <Card title="Live queue" subtitle="Arrival order determines positions inside each dentist queue (first-come, first-served)." className="top-gap queue-live-card">
      <QueueTable rows={visible} onOpen={q=>setPage('patients',encounterContext(q))} nameOf={q=>q.patientName||patientName(q.patientId,state.patients)} columns={[
        {key:'queueNumber',label:'Queue',render:q=><div className="queue-order"><b className="queue-number"><span className="sr-only">Queue number </span>{q.queueNumber||'—'}</b><span className="queue-secondary">Position {q.position?`#${q.position}`:'—'}</span></div>},
        {key:'patient',label:'Patient',render:q=><div className="queue-identity">
          <div>
            <button type="button" className="queue-patient-link" title="Click to open patient chart" aria-label={`Open chart for ${q.patientName||patientName(q.patientId,state.patients)}`} onClick={()=>setPage('patients',encounterContext(q))}><b>{q.patientName||patientName(q.patientId,state.patients)}</b></button>
          </div>
          <small className="queue-secondary queue-patient-meta">{q.patientCode&&<span>{q.patientCode}</span>}<span>{q.appointmentCode||(q.walkIn?'Walk-in visit':'Scheduled visit')}</span></small>
          {q.lateArrival&&<span className="fd-badge is-late">Late arrival · queued last</span>}
        </div>},
        {key:'careTeam',label:'Dentist / Branch',render:q=><div className="queue-care-team"><b>{dentistName(q.dentistId,state.dentists)}</b><span className="queue-secondary">{q.branch}</span></div>},
        {key:'checkedIn',label:'Checked in',render:q=>displayTime(q.checkedIn)},
        ...(demo?[{key:'wait',label:'Est. wait (demo)',render:q=>`${queueWaitEstimate(q,state.queue,state.appointments,state.treatments,state.dentists)} min` }]:[]),
        {key:'status',label:'Status',render:q=><div className="queue-status"><Status>{q.displayStatus||q.status}</Status></div>},
        {key:'actions',label:'Actions',render:q=><div className="row-actions queue-actions" onClick={e=>e.stopPropagation()}>
          {['In Queue', 'Waiting'].includes(q.status)&&(operational||role==='dentist')&&<button type="button" className="icon-btn queue-call-btn" title="Call patient in queue" aria-label={`Call patient ${q.patientName||patientName(q.patientId,state.patients)} in queue`} disabled={!!busy} onClick={()=>update(q,'call','Patient called in queue.')}><Icon name="phone" size={16}/><span>Call</span></button>}
          {['staff','dentist'].includes(role)&&<button type="button" className="icon-btn queue-message-btn" title="Open patient conversation" aria-label={`Open conversation with ${q.patientName||patientName(q.patientId,state.patients)}`} disabled={!!messageBusy} onClick={()=>openMessage(q)}><Icon name="message" size={16}/><span>Message</span></button>}
          {role==='dentist'&&(['In Queue', 'Waiting', 'Called', 'Treatment Ready'].includes(q.status)||q.status==='Served'||q.visitStatus==='In Treatment')&&<Button size="sm" onClick={()=>setPage('treatment',encounterContext(q))}>{q.treatmentId?'Continue Treatment':'Open Treatment'}</Button>}

          {operational&&<>
            {active(q)&&q.lateArrival&&<Button size="sm" variant="ghost" disabled={!!busy} onClick={()=>restore(q)}>Restore normal place</Button>}
          </>}
        </div>}

      ]}/>
    </Card>
    {restoreModalEntry&&<RestoreModal entry={restoreModalEntry} onClose={()=>setRestoreModalEntry(null)} onConfirm={submitRestore}/>}
  </>
}

export function PriorityModal({ entry, onClose, onConfirm }) {
  const [category, setCategory] = useState('Senior Citizen')
  const [verified, setVerified] = useState(true)
  const [reason, setReason] = useState('Senior citizen priority')
  if (!entry) return null
  const isUrgent = category === 'Urgent'
  const priorityLevel = isUrgent ? 'Urgent' : 'Priority'

  const handleSubmit = e => {
    e.preventDefault()
    if (!reason.trim()) return
    const verificationStatus = verified ? 'verified' : 'pending'
    const verificationTag = verified ? 'ID/eligibility verified' : 'Pending verification'
    const fullReason = reason.trim().includes(verificationTag)
      ? reason.trim()
      : `${reason.trim()} [${category} · ${verificationTag}]`
    onConfirm(entry, priorityLevel, fullReason, { category, verificationStatus })
  }

  return (
    <Modal open title="Assign Queue Priority" subtitle="Prioritize waiting queue position for eligible patients or urgent accommodation" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <Notice tone="info">
          Operational priority reorders waiting entries (Urgent → Senior/PWD Priority → Normal, then arrival time). Patients already Called or Treatment Ready are never displaced. Do not record ID numbers or sensitive medical details here.
        </Notice>
        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Field label="Priority Category" required>
            <select value={category} onChange={e => {
              const val = e.target.value
              setCategory(val)
              if (val === 'Senior Citizen') setReason('Senior citizen priority')
              else if (val === 'PWD') setReason('Person with disability (PWD) priority')
              else if (val === 'Urgent') setReason('Urgent medical priority')
            }}>
              <option value="Senior Citizen">Senior Citizen (Priority)</option>
              <option value="PWD">Person with Disability - PWD (Priority)</option>
              <option value="Urgent">Urgent / Medical Priority (Urgent)</option>
            </select>
          </Field>
          <label className="au-check">
            <input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />
            <span>Eligibility / valid ID verified in person (stores category and verification status only; never ID numbers)</span>
          </label>
          <Field label="Operational Reason" required hint="Required for operational and audit records.">
            <input
              type="text"
              required
              placeholder="e.g. Senior citizen accommodation, PWD mobility assistance, acute pain"
              value={reason}
              onChange={e => setReason(e.target.value)}
              autoFocus
            />
          </Field>
        </div>
        <div className="row-actions" style={{ marginTop: '20px' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant={isUrgent ? 'danger' : 'primary'} disabled={!reason.trim()}>
            Apply {priorityLevel}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function RestoreModal({ entry, onClose, onConfirm }) {
  const [reason, setReason] = useState('Front desk schedule review')
  if (!entry) return null
  const handleSubmit = e => {
    e.preventDefault()
    if (!reason.trim()) return
    onConfirm(entry, reason.trim())
  }
  return (
    <Modal open title="Restore Normal Queue Place" subtitle="Staff override of late arrival order" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <Field label="Reason for Restoring Queue Order" required hint="Required for audit and operational records.">
          <input
            type="text"
            required
            placeholder="Reason for giving this late arrival their normal place..."
            value={reason}
            onChange={e => setReason(e.target.value)}
            autoFocus
          />
        </Field>
        <div className="row-actions" style={{ marginTop: '20px' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!reason.trim()}>Restore Normal Place</Button>
        </div>
      </form>
    </Modal>
  )
}

export function CapacityPage({ activeBranch, store, setPage }) {
  const vis=useQueueVisibility(store)
  useVisibleRefresh(store.appointmentFlow?.refresh,{active:vis.mode!=='demo'})
  // Clinic-server session: only factual queue counts. The workload %, thresholds, waiting-time estimates and cross-branch
  // alternatives below are unapproved prototype estimators and stay in the labelled offline demo only.
  if(vis.mode!=='demo')return <>
    <PageHeader title="Live Queue by Branch" text="Counts of today’s queue entries by status, from the clinic server. The clinic has not approved waiting-time estimates, workload percentages or capacity limits, so none is shown."/>
    <QueueByBranch store={store} activeBranch={activeBranch} vis={vis} title="Today’s queue"/>
    <BranchQueueDetailSection store={store} activeBranch={activeBranch} setPage={setPage}/>
  </>
  const { state }=store
  const branches=state.branches.filter(b=>activeBranch==='All Branches'||b.name===activeBranch)
  const cards=branches.map(b=>branchCapacity(b.name,state))
  const alternatives=state.branches.filter(b=>b.status==='Open'&&(activeBranch==='All Branches'||b.name!==activeBranch)).map(b=>branchCapacity(b.name,state)).filter(c=>c.activeDentists>0&&!c.overloaded).sort((a,b)=>a.workload-b.workload)
  return <>
    <PageHeader title="Waiting-Time & Cross-Branch Capacity (offline demo)" text="Offline demo estimates only, not clinic policy. Aggregate flow monitoring remains separate from individual queue ordering. It combines live queue load, active dentist capacity, bookings, and configurable branch thresholds."/>
    <div className="cards-3">{cards.map(c=><Card key={c.branch} title={c.branch} subtitle={`Threshold ${c.threshold}%`}><div className="capacity-number">{c.workload}% <span>workload</span></div><Progress value={c.workload} threshold={c.threshold}/><div className="metric-list"><Metric label="Active dentists" value={c.activeDentists}/><Metric label="Waiting" value={c.waiting}/><Metric label="Treatment-ready" value={c.ready}/><Metric label="Booked today" value={c.booked}/><Metric label="Estimated wait" value={`${c.estimate} min`}/></div>{c.overloaded?<Notice tone="warning" title="Capacity risk detected">Front desk and owner should be alerted and shown available capacity at another branch.</Notice>:<Notice tone="success">Branch is currently below its configured demo threshold.</Notice>}</Card>)}</div>
    <Card className="top-gap" title="Cross-branch alternatives" subtitle="Shown when a branch exceeds waiting-time or staffing thresholds">{alternatives.length?<div className="alternative-grid">{alternatives.map(c=><div className="alternative-card" key={c.branch}><b>{c.branch}</b><span>{c.workload}% load</span><small>{c.activeDentists} dentists • ~{c.estimate} min wait</small></div>)}</div>:<Notice tone="warning">No branch is currently below its capacity threshold.</Notice>}</Card>
  </>
}
function Metric({label,value}){return <div><span>{label}</span><b>{value}</b></div>}

function BranchQueueDetailSection({ store, activeBranch, setPage }) {
  const { state, toast } = store
  const [callingId, setCallingId] = useState(null)
  const [selectedBranchId, setSelectedBranchId] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [inspectEntry, setInspectEntry] = useState(null)
  const branches = state.branches.filter(b => activeBranch === 'All Branches' || b.name === activeBranch)

  const matchesOwnerFilter = (q, filter) => {
    if (filter === 'All') return true
    const s = q.displayStatus || q.status
    if (filter === 'In Queue') return ['In Queue', 'Waiting'].includes(s)
    if (filter === 'In Treatment') return ['In Treatment', 'Called', 'Treatment Ready'].includes(s)
    if (filter === 'Done') return ['Done', 'Served', 'Completed'].includes(s)
    return s === filter || q.status === filter
  }

  const queueEntries = (state.queue || []).filter(q => {
    if (!isTodayQueue(q)) return false
    if (selectedBranchId !== 'All' && q.branchId !== selectedBranchId && q.branch !== selectedBranchId) return false
    if (activeBranch !== 'All Branches' && q.branch !== activeBranch) return false
    return matchesOwnerFilter(q, statusFilter)
  }).sort((a, b) => (a.position || 999) - (b.position || 999) || (a.queueNumber || 0) - (b.queueNumber || 0))

  return (
    <Card
      className="top-gap"
      title="Live Queue Details"
      subtitle="Authorized patient queue records for today, organized by branch."
    >
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '14px' }}>
        {branches.length > 1 && (
          <select
            className="filter-select"
            aria-label="Filter queue details by branch"
            value={selectedBranchId}
            onChange={e => setSelectedBranchId(e.target.value)}
          >
            <option value="All">All visible branches</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
        <select
          className="filter-select"
          aria-label="Filter queue details by status"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="All">All statuses ({queueEntries.length})</option>
          <option value="In Queue">In Queue</option>
          <option value="In Treatment">In Treatment</option>
          <option value="Done">Done</option>
        </select>
      </div>

      <Table
        rows={queueEntries}
        empty="No patients matching your filter in today's live queue."
        columns={[
          { key: 'queueNumber', label: '#', render: q => <b>{q.queueNumber ? `#${q.queueNumber}` : (q.code || '—')}</b> },
          { key: 'patient', label: 'Patient', render: q => <div>
            <button
              type="button"
              className="queue-patient-link"
              title="Click to open patient chart"
              aria-label={`Open chart for ${q.patientName || patientName(q.patientId, state.patients)}`}
              onClick={() => setPage && setPage('patients', encounterContext(q))}
            >
              <b>{q.patientName || patientName(q.patientId, state.patients)}</b>
            </button>
          </div> },
          { key: 'service', label: 'Service', render: q => q.service || q.serviceName || 'Consultation' },
          { key: 'dentist', label: 'Dentist', render: q => q.dentistName || dentistName(q.dentistId, state.dentists) || 'Unassigned' },
          { key: 'branch', label: 'Branch', render: q => q.branch || 'Main' },
          { key: 'time', label: 'Time / Arrival', render: q => <small className="block-muted">{displayTime(q.time || q.start || q.arrival)}</small> },
          { key: 'status', label: 'Status', render: q => <Status>{displayQueueStatus(q)}</Status> },
          { key: 'action', label: 'Actions', render: q => <div className="row-actions">
            {['In Queue', 'Waiting'].includes(q.status) && (
              <button
                type="button"
                className="icon-btn queue-call-btn"
                title="Call patient in queue"
                aria-label={`Call patient ${q.patientName || patientName(q.patientId, state.patients)} in queue`}
                disabled={!!callingId}
                onClick={async () => {
                  if (callingId) return
                  setCallingId(q.id)
                  const result = await store.appointmentFlow.queueCommand(q, 'call', commandKey())
                  setCallingId(null)
                  toast(result.ok ? 'Patient called in queue.' : (result.message || 'The queue could not be updated. Refresh and try again.'), result.ok ? 'success' : 'warning')
                }}
              >
                <Icon name="phone" size={16}/>
              </button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setInspectEntry(q)}>Inspect</Button>
          </div> },
        ]}
      />

      <Modal open={!!inspectEntry} onClose={() => setInspectEntry(null)} title="Queue Entry Details" subtitle={inspectEntry ? `Queue #${inspectEntry.queueNumber || inspectEntry.code || '—'}` : ''}>
        {inspectEntry && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <div><small style={{ color: 'var(--muted)', display: 'block' }}>Patient</small><b>{inspectEntry.patientName || patientName(inspectEntry.patientId, state.patients)}</b></div>
              <div><small style={{ color: 'var(--muted)', display: 'block' }}>Status</small><Status>{displayQueueStatus(inspectEntry)}</Status></div>
              <div><small style={{ color: 'var(--muted)', display: 'block' }}>Service</small><b>{inspectEntry.service || inspectEntry.serviceName || 'Consultation'}</b></div>
              <div><small style={{ color: 'var(--muted)', display: 'block' }}>Dentist</small><b>{inspectEntry.dentistName || dentistName(inspectEntry.dentistId, state.dentists) || 'Unassigned'}</b></div>
              <div><small style={{ color: 'var(--muted)', display: 'block' }}>Branch</small><b>{inspectEntry.branch || 'Main'}</b></div>
              <div><small style={{ color: 'var(--muted)', display: 'block' }}>Arrival / Time</small><b>{displayTime(inspectEntry.time || inspectEntry.start || inspectEntry.arrival)}</b></div>
              <div><small style={{ color: 'var(--muted)', display: 'block' }}>Order</small><span>First-come, first-served (FIFO)</span></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
              <Button onClick={() => setInspectEntry(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  )
}

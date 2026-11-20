import {SelectionDetailsNotice} from '../selection-details.jsx'
import React, { useEffect, useId, useRef, useState } from 'react'
import { Button, Card, ConfirmDialog, Field, FilterBar, Icon, IconAction, Modal, Notice, PageHeader, RefreshButton, SelectWithOther, Status, Table } from '../components.jsx'
import { addMinutes, dateLabel, dentistName, displayTime, patientName } from '../logic.js'
import { canAccessPage } from '../safeguards.js'
import { checkInNavigationFor } from '../checkin-navigation.js'
import { clinicDate } from '../clock.js'
import { commandKey, selectedFollowupProblem, STAFF_CANCELLATION_REASONS } from '../appointments-api.js'
import { requestBookingRefund } from '../api-client.js'
import { publicPatientIdFor } from '../appointment-projection.js'
import { useDayAvailability } from '../booking-availability.js'
import { dentistsFor, servicesAt } from '../scheduling.js'
import { groupBookableServiceOptions } from '../service-options.js'
import { PatientAppointmentsPage } from './PatientVisits.jsx'
import { PatientBookingPage } from './PatientBook.jsx'
import { inScope, isTodayQueue, patientInScope, sessionForRole } from '../contracts.js'
import { appointmentActionProblem, canSchedule, schedulingActorKey, useRequestOwner } from '../appointment-ui.js'

// Staff/Owner appointment form (M6, server-authoritative). Used for a new front-desk booking, a reschedule, and a
// Dentist-requested follow-up. The Patient comes from the server Patient directory (public_id), branches are limited to
// the account's server authorization scopes (Owner: every open branch), start times come from server availability on the
// 30-minute Staff grid, and the server validates and assigns on confirm. Nothing here writes an appointment locally.
export function bookableBranches(state,session){
  const open=state.branches.filter(b=>b.status==='Open')
  if(session?.role==='staff')return open.filter(b=>Array.isArray(session.branchScopes)?session.branchScopes.includes(b.id):b.id===session.branchId)
  return open
}

// Resolve the exact projected identity; names/codes never identify a Patient.
export function appointmentRecordPatient(appointment,state,session) {
  if(session?.role!=='staff'||!canAccessPage(state,session,'patients')||!inScope(appointment,session,state))return null
  const patient=state.patients.find(p=>p.id===appointment.patientId)
  if(!patient?.serverProjection||!patientInScope(patient,state,session))return null
  const publicId=publicPatientIdFor(patient.id,{session,users:state.users,patients:state.patients})
  return publicId&&publicId===appointment.patientPublicId?patient:null
}

// `prefill` (M20 server follow-up task or calendar click): prefilled parameters; patient/branch locked only when patient is specified.
export function AppointmentForm({ role, store, appointment=null, followup=null, prefill=null, serverFollowupSelection, verifiedFollowupBackend, onSaved, submitLabel='Confirm appointment' }) {
  const selectedMode = serverFollowupSelection !== undefined
  const context = JSON.stringify([schedulingActorKey(store), selectedMode ? ['server-followup', serverFollowupSelection?.taskId, serverFollowupSelection?.expectedRevision, serverFollowupSelection?.patientPublicId, serverFollowupSelection?.branchId, serverFollowupSelection?.dentistId, verifiedFollowupBackend?.commit, verifiedFollowupBackend?.apiBase] : appointment ? ['appointment', appointment.id, appointment.patientPublicId, appointment.branchId, appointment.serviceId, appointment.dentistId] : followup ? ['followup', followup.id, followup.patientId, followup.branchId, followup.dentistId] : ['booking', prefill?.patientPublicId, prefill?.branchId, prefill?.date]])
  return <AppointmentEditor key={context} {...{role,store,appointment,followup,prefill,serverFollowupSelection,verifiedFollowupBackend,selectedMode,onSaved,submitLabel}}/>
}

function AppointmentEditor({ role, store, appointment: currentAppointment, followup, prefill, serverFollowupSelection, verifiedFollowupBackend, selectedMode, onSaved, submitLabel }) {
  // A refreshed row must not silently rebase an in-progress reschedule onto a newer revision.
  const [appointment]=useState(currentAppointment)
  const { state, toast }=store
  const session=store.session||sessionForRole(role,state)
  const key=useRef(commandKey())
  const [selection]=useState(()=>Object.freeze({...serverFollowupSelection}))
  const selectedAttempt=useRef(null), feedback=useRef(null), formElement=useRef(null), feedbackId=useId()
  const [selectedPhase,setSelectedPhase]=useState('idle')
  const branches=bookableBranches(state,session)
  const defaultBranch=branches.find(b=>b.id===session?.branchId)?.id || branches[0]?.id || ''
  const followupPatient=followup?publicPatientIdFor(followup.patientId,{session,users:state.users,patients:state.patients}):null
  const lockedPatient=!!(appointment||followup||prefill?.patientPublicId||prefill?.patientName)||selectedMode
  const lockedBranch=!!(appointment||followup||(prefill?.patientPublicId&&prefill?.branchId))||selectedMode
  const [form,setFormState]=useState(()=>{
    if(selectedMode)return {patientPublicId:selection.patientPublicId||'',branchId:selection.branchId||'',serviceId:prefill?.serviceId||'',dentistId:selection.dentistId||prefill?.dentistId||'',date:prefill?.date&&prefill.date>=clinicDate()?prefill.date:clinicDate(),start:'',notes:prefill?.notes||''}
    if(appointment)return {patientPublicId:appointment.patientPublicId,branchId:appointment.branchId,serviceId:appointment.serviceId,dentistId:appointment.dentistId,date:appointment.date>=clinicDate()?appointment.date:clinicDate(),start:'',notes:''}
    if(followup)return {patientPublicId:followupPatient,branchId:followup.branchId,serviceId:'',dentistId:followup.dentistId,date:followup.recommendedDate&&followup.recommendedDate>=clinicDate()?followup.recommendedDate:clinicDate(),start:'',notes:followup.reason||''}
    if(prefill)return {patientPublicId:prefill.patientPublicId,branchId:prefill.branchId||defaultBranch,serviceId:prefill.serviceId||'',dentistId:prefill.dentistId||'',date:prefill.date&&prefill.date>=clinicDate()?prefill.date:clinicDate(),start:'',notes:prefill.notes||''}
    return {patientPublicId:'',branchId:defaultBranch,serviceId:'',dentistId:'',date:clinicDate(),start:'',notes:''}
  })
  const [search,setSearch]=useState('')
  const [failure,setFailure]=useState(null)
  const owner=useRequestOwner(schedulingActorKey(store),store.getAuthGeneration), saving=owner.busy
  const selectedLocked=selectedMode&&!!selectedAttempt.current
  const [authConfirmed,setAuthConfirmed]=useState(false)
  const draftGeneration=useRef(0), draftVersion=draftGeneration.current
  const setForm=next=>{if(selectedMode&&selectedAttempt.current)return;draftGeneration.current++;key.current=commandKey();setFailure(null);setFormState(next)}
  const update=(name,value)=>{
    if(selectedMode&&selectedAttempt.current)return
    if(['patientPublicId','branchId','serviceId'].includes(name))setAuthConfirmed(false)
    setForm(previous=>{
    const next={...previous,[name]:value}
    if(name==='branchId'){next.serviceId='';next.dentistId=followup?previous.dentistId:'';next.start=''}
    if(name==='serviceId'){next.dentistId=followup||appointment||selection.dentistId?previous.dentistId:'';next.start=''}
    if(['date','dentistId','patientPublicId'].includes(name))next.start=''
    return next
    })
  }
  useEffect(()=>{if(!lockedPatient&&search.trim().length>=2){const t=setTimeout(()=>store.appointmentFlow?.searchPatients(search),250);return ()=>clearTimeout(t)}},[search,lockedPatient])
  useEffect(()=>{if(!lockedPatient){store.appointmentFlow?.searchPatients?.('')}},[lockedPatient])
  useEffect(()=>{if(selectedMode&&['unknown','refused','verified'].includes(selectedPhase))feedback.current?.focus()},[selectedMode,selectedPhase])

  const services=servicesAt(state,form.branchId)
  const serviceGroups=groupBookableServiceOptions(appointment?state.services.filter(s=>s.id===appointment.serviceId):services)
  const dentists=form.serviceId?dentistsFor(state,form.branchId,form.serviceId):[]
  const lockedDentist=!!followup||(selectedMode&&!!selection.dentistId)
  const selectedService=services.find(s=>s.id===form.serviceId)
  const isRestricted=selectedService?.onlineBooking==='consultation_first'||selectedService?.onlineBooking==='hidden'
  const selectionProblem=selectedMode?(role!=='staff'||session?.role!=='staff'||appointment||followup
    ?'Selected follow-up booking is available only to authorized Staff creating a new appointment.'
    :selectedFollowupProblem(form,selection,verifiedFollowupBackend)||
      (prefill?.patientPublicId&&prefill.patientPublicId!==selection.patientPublicId||prefill?.branchId&&prefill.branchId!==selection.branchId?'The selected follow-up context changed. Close this form and reload the selected follow-up.':'')||
      (typeof store.appointmentFlow?.beginSelectedFollowup!=='function'?'Selected follow-up booking is unavailable. Contact the clinic system administrator.':'')):''
  const day=useDayAvailability({branchId:form.branchId,serviceId:form.serviceId,date:form.date,patientPublicId:form.patientPublicId||null,
    ignoreAppointmentId:appointment?.id||null,dentistId:form.dentistId||null,enabled:!!form.serviceId&&!selectionProblem})
  const directory=(store.directoryPatients||[]).filter(p=>!search.trim()||`${p.name} ${p.patientCode} ${p.phone}`.toLowerCase().includes(search.trim().toLowerCase()))
  const selectedPatient=(store.directoryPatients||[]).find(p=>p.id===form.patientPublicId)

  if(selectionProblem)return <Notice tone="warning" title="Selected follow-up booking unavailable">{selectionProblem}</Notice>

  if(followup&&(followup.legacyAppointment||!followupPatient))return <Notice tone="warning" title="This follow-up can’t be booked here">
    {followup.legacyAppointment?'This follow-up belongs to historical demo records and is read-only.':'This Patient has no clinic account record on the server yet, so a server appointment can’t be created for them. Register the Patient first.'}
  </Notice>

  const saveSelected=async()=>{
    if(draftGeneration.current!==draftVersion||!canSchedule(store,form.branchId)||session?.role!=='staff')return
    if(['verified','refused','obsolete'].includes(selectedAttempt.current?.outcome))return
    const ticket=owner.begin()
    if(!ticket)return
    setFailure(null);setSelectedPhase('submitting')
    try{
      if(!selectedAttempt.current)selectedAttempt.current=store.appointmentFlow.beginSelectedFollowup(
        {...form,notes:form.notes||null,consultationAcknowledged:isRestricted?authConfirmed:null},
        {selection,backend:verifiedFollowupBackend,key:key.current,isCurrent:()=>owner.current(ticket)})
      const result=await selectedAttempt.current.submit()
      if(!owner.current(ticket)||!canSchedule(store,form.branchId))return
      if(!['verified','refused','unknown'].includes(result.outcome))return
      setSelectedPhase(result.outcome)
      if(!result.ok){setFailure(result);return}
      if(result.warning)toast(result.warning,'warning')
      toast('Appointment and selected follow-up link verified.','success')
      onSaved?.(result.record,{followupLink:result.followupLink})
    }catch{
      if(owner.current(ticket)&&selectedAttempt.current?.outcome!=='verified'){
        setSelectedPhase('unknown');setFailure({kind:'unverified',message:'The booking outcome could not be verified. Keep this form open and ask the front desk to review it before starting another booking.'})
      }
    }finally{owner.finish(ticket)}
  }
  const reviewSelected=()=>{
    if(saving||selectedAttempt.current?.outcome!=='refused')return
    selectedAttempt.current=null;key.current=commandKey();setFailure(null);setSelectedPhase('idle');day.reload()
    formElement.current?.querySelector('select:not(:disabled)')?.focus()
  }
  const save=async()=>{
    if(selectedMode)return saveSelected()
    if(draftGeneration.current!==draftVersion)return
    const problem=appointment?appointmentActionProblem(store,appointment):!canSchedule(store,form.branchId)?'Your appointment access changed. Refresh before continuing.':''
    if(problem){setFailure({kind:'forbidden',message:problem});return}
    const ticket=owner.begin()
    if(!ticket)return
    setFailure(null)
    try {
    const result=appointment
      ?await store.appointmentFlow.reschedule(appointment,{date:form.date,start:form.start,dentistId:form.dentistId&&form.dentistId!==appointment.dentistId?form.dentistId:null},key.current)
      :await store.appointmentFlow.create({branchId:form.branchId,serviceId:form.serviceId,date:form.date,start:form.start,notes:form.notes||null,patientPublicId:form.patientPublicId,dentistId:form.dentistId||null,consultationAcknowledged:isRestricted?authConfirmed:null},{key:key.current,followupId:followup?.id||null})
    if(!owner.current(ticket)||!canSchedule(store,form.branchId))return
    if(!result.ok){
      setFailure(result);toast(result.message,'warning')
      if(result.kind==='conflict'||result.kind==='validation'){key.current=commandKey();day.reload()}
      return
    }
    if(result.warning)toast(result.warning,'warning')
    toast(appointment?'Appointment rescheduled.':followup?'Follow-up appointment scheduled.':'Appointment confirmed.','success')
    onSaved?.(result.record)
    } catch {
      if(owner.current(ticket))setFailure({kind:'network',message:'Could not confirm the save. Your changes are retained. Check the appointment before retrying.'})
    } finally { owner.finish(ticket) }
  }
  const canSave=canSchedule(store,form.branchId)&&!!form.patientPublicId&&branches.some(b=>b.id===form.branchId)&&!!form.serviceId&&!!form.date&&!!form.start&&(!isRestricted||authConfirmed)&&!saving&&!selectedLocked
  const canReviewSelected=selectedPhase==='refused'&&((failure?.kind==='validation'&&!['selected_context_invalid','followup_patient_mismatch','followup_branch_mismatch','idempotency_key_reused'].includes(failure.code))||failure?.code==='schedule_conflict'||failure?.kind==='rate_limited')

  return <div className="booking-layout">
    <form ref={formElement} aria-label={appointment?'Reschedule appointment':'Create appointment'} aria-busy={saving} aria-describedby={selectedMode?feedbackId:undefined} onSubmit={e=>{e.preventDefault();if(canSave)save()}}>
      <fieldset className="form-grid" disabled={saving||selectedLocked} style={{border:0,padding:0,margin:0,minWidth:0}}>
      {lockedPatient
        ?<Field label="Patient"><input value={selectedMode?prefill?.patientName||selectedPatient?.name||'Selected follow-up patient':appointment?`${appointment.patientName||patientName(appointment.patientId,state.patients)} • ${appointment.patientCode||''}`:prefill?prefill.patientName||prefill.patientPublicId:patientName(followup.patientId,state.patients)} disabled/></Field>
        :<>
          <Field label="Find patient"><input value={search} placeholder="Type at least 2 characters" onChange={e=>setSearch(e.target.value)}/></Field>
          <Field label="Patient" required><select value={form.patientPublicId} onChange={e=>update('patientPublicId',e.target.value)}>
            <option value="">Select a patient</option>
            {directory.map(p=><option key={p.id} value={p.id}>{p.name} • {p.patientCode}{p.phone?` • ${p.phone}`:''}</option>)}
          </select></Field>
        </>}
      <Field label="Branch" required><select disabled={lockedBranch} value={form.branchId} onChange={e=>update('branchId',e.target.value)}>
        {!branches.length&&<option value="">No authorized branch</option>}
        {(lockedBranch?state.branches.filter(b=>b.id===form.branchId):branches).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
      </select></Field>
      <Field label="Service" required hint={selectedService ? `${selectedService.duration} min` : undefined}><select disabled={!!appointment} value={form.serviceId} onChange={e=>update('serviceId',e.target.value)}>
        <option value="">Select a service</option>
        {serviceGroups.map(group=><optgroup key={group.category} label={group.category}>{group.items.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}
      </select></Field>
      {isRestricted&&<div className="span-2">
        <Notice tone="warning" title="Restricted / Preliminary Consultation Required">
          <b>{selectedService?.name}</b> is marked for preliminary consultation or clinical authorization.
          {selectedService?.consultationServiceId&&<div style={{marginTop:'6px'}}>
            <Button size="sm" variant="soft" type="button" onClick={()=>update('serviceId',selectedService.consultationServiceId)}>Switch to Dental Consultation</Button>
          </div>}
          <label className="check-control" style={{marginTop:'8px',display:'flex',alignItems:'center',gap:'8px'}}>
            <input type="checkbox" checked={authConfirmed} onChange={e=>{if(selectedMode&&selectedAttempt.current)return;draftGeneration.current++;key.current=commandKey();setAuthConfirmed(e.target.checked)}}/>
            <span>Prior consultation / dentist clinical authorization confirmed by front desk</span>
          </label>
        </Notice>
      </div>}
      <Field label="Dentist" hint={lockedDentist?'Requesting Dentist':undefined}>
        <select disabled={lockedDentist} value={form.dentistId} onChange={e=>update('dentistId',e.target.value)}>
          {!lockedDentist&&<option value="">Assign automatically</option>}
          {(lockedDentist?state.dentists.filter(d=>d.id===form.dentistId):dentists).map(d=><option key={d.id} value={d.id}>{d.name} • {d.specialty}</option>)}
        </select></Field>
      <Field label="Date" required><input type="date" value={form.date} min={clinicDate()} onChange={e=>update('date',e.target.value)}/></Field>
      <Field label="Notes"><input value={form.notes} disabled={!!appointment} placeholder="Optional booking note" onChange={e=>update('notes',e.target.value)}/></Field>
      <div className="span-2">
        {!form.serviceId?<p className="staff-booking-prompt" role="status">Select a service to see available times.</p>
          :day.status==='loading'?<p className="block-muted" role="status">Loading available times…</p>
          :day.status==='error'?<Notice tone="warning" title="Availability couldn’t be loaded">{day.error} <Button size="sm" variant="ghost" onClick={day.reload}>Try again</Button></Notice>
          :day.slots.length?<div className="alternatives"><small>Available start times on {dateLabel(form.date)}</small><div className="chip-row" role="group" aria-label="Available start times">
            {day.slots.map(s=><button type="button" key={s.start} className={`chip ${form.start===s.start?'active':''}`} aria-pressed={form.start===s.start} onClick={()=>setForm(previous=>({...previous,start:s.start}))}>{displayTime(s.start)}{!form.dentistId&&s.dentist?` · ${s.dentist}`:''}</button>)}
          </div></div>
          :<Notice tone="warning" title="No open times">No bookable start times on {dateLabel(form.date)}. Try another date{lockedDentist?'':' or Dentist'}.</Notice>}
      </div>
      <div className="form-actions span-2"><Button type="submit" disabled={!canSave}>{saving?'Saving…':submitLabel}</Button></div>
      </fieldset>
      {saving&&<p role="status">Saving appointment…</p>}
      {selectedMode&&<div id={feedbackId} ref={feedback} tabIndex={-1} role={['unknown','refused'].includes(selectedPhase)?'alert':'status'}>
        {selectedPhase==='idle'&&<p>This booking will link the selected follow-up after the clinic verifies it.</p>}
        {selectedPhase==='unknown'&&<><p>{failure?.message}</p><Button disabled={saving} onClick={saveSelected}>Retry the same booking</Button><p>Keep this form open. Closing or reloading it loses the retry details; ask the front desk to review the outcome before booking again.</p></>}
        {selectedPhase==='refused'&&<><p>{failure?.kind==='not_found'?'The selected follow-up is unavailable. Close this form and reload the selected follow-up.':failure?.kind==='forbidden'||failure?.kind==='unauthenticated'?'Your access could not be confirmed. Sign in again and ask the front desk to review the selected follow-up.':failure?.code==='followup_conflict'?'The selected follow-up changed or is no longer available. Close this form and reload it before trying again.':failure?.message}</p>{canReviewSelected?<Button onClick={reviewSelected}>Review booking details</Button>:<p>Close this form and review the selected follow-up before starting another booking.</p>}</>}
        {selectedPhase==='verified'&&<p>Appointment and selected follow-up link verified.</p>}
      </div>}
    </form>
    {(failure&&!selectedMode)&&<div className="validation-card staff-booking-error" role="alert">
      {failure&&!selectedMode&&<>
        <Notice tone={failure.kind==='conflict'?'warning':'danger'} title={failure.kind==='conflict'?'Availability changed':'This slot can’t be booked'}>{failure.message}</Notice>
        {!!failure.alternatives?.length&&<div className="alternatives"><small>Other start times on this date</small><div className="chip-row">{failure.alternatives.map(t=><button type="button" className="chip" key={t} onClick={()=>setForm(previous=>({...previous,start:t}))}>{displayTime(t)}</button>)}</div></div>}
      </>}
    </div>}
  </div>
}

function AppointmentsStatusNotice({ store }) {
  if(store.appointmentsStatus==='loading')return <p className="block-muted" role="status">Loading appointments from the clinic server…</p>
  if(store.appointmentsStatus==='error')return <Notice tone="warning" title="Appointments couldn’t be loaded">{store.appointmentsError} <Button size="sm" variant="ghost" onClick={()=>store.appointmentFlow?.refresh()}>Try again</Button></Notice>
  if(store.appointmentsTruncated)return <Notice tone="warning">Only the first part of a very large appointment list was loaded. Narrow the view to see everything.</Notice>
  return null
}

export function BookingPage({ role, store, setPage, context }) {
  if(role==='patient')return <PatientBookingPage store={store} setPage={setPage} context={context}/>
  return <><PageHeader kicker="Scheduling" title="Create an appointment" text="Front-desk bookings are validated by the clinic server with the same conflict-prevention rules as patient self-booking."/><Card title="Appointment details"><AppointmentForm role={role} store={store}/></Card></>
}

export function AppointmentsPage({ role, store, setPage, context }) {
  if(role==='patient')return <PatientAppointmentsPage store={store} setPage={setPage} context={context}/>
  return <AppointmentManagement key={schedulingActorKey(store)} {...{role,store,setPage,context}}/>
}

function AppointmentManagement({ role, store, setPage, context }) {
  const { state, toast }=store
  const session=store.session||sessionForRole(role,state)
  const [reschedule,setReschedule]=useState(null)
  const [cancelling,setCancelling]=useState(null)
  const cancellationKeys = useRef(new Map())
  const [missed,setMissed]=useState(null)
  const [refunding,setRefunding]=useState(null)
  const [newOpen,setNewOpen]=useState(false)
  const [search,setSearch]=useState('')
  const [statusFilter,setStatusFilter]=useState('All')
  const [branchFilter,setBranchFilter]=useState('All')
  const [dateFilter,setDateFilter]=useState('')
  const owner=useRequestOwner(schedulingActorKey(store),store.getAuthGeneration)
  const [actionError,setActionError]=useState('')
  const openAction=(set,record)=>{owner.invalidate();setActionError('');set(record)}
  const branches=bookableBranches(state,session)
  const branchNames = new Map(state.branches.map(branch => [branch.id, branch.name]))
  const visible=state.appointments.filter(a=>{
    if(!inScope(a,session,state))return false
    if(statusFilter!=='All'&&a.status!==statusFilter)return false
    if(branchFilter!=='All'&&a.branchId!==branchFilter&&a.branch!==branchFilter)return false
    if(dateFilter&&a.date!==dateFilter)return false
    if(search.trim()){
      const q=search.trim().toLowerCase()
      const pName=(a.patientName||patientName(a.patientId,state.patients)||'').toLowerCase()
      const dName=(a.dentistName||dentistName(a.dentistId,state.dentists)||'').toLowerCase()
      const apptNo=(a.appointmentNo||'').toLowerCase()
      const service=(a.service||'').toLowerCase()
      if(!pName.includes(q)&&!dName.includes(q)&&!apptNo.includes(q)&&!service.includes(q))return false
    }
    return true
  }).sort((a,b)=>`${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))
  const runAction=async(action,a,close,command,keepOpen=false)=>{
    const problem=appointmentActionProblem(store,a,action)
    if(problem){if(!keepOpen)close(null);setActionError(problem);return {ok:false,message:problem}}
    const ticket=owner.begin()
    if(!ticket)return
    if(!keepOpen)close(null)
    setActionError('')
    try{
      const result=await command(a)
      if(!owner.current(ticket))return
      if(result.ok&&result.warning)toast(result.warning,'warning')
      if(!result.ok)setActionError(result.message)
      if(result.ok&&keepOpen)close(null)
      toast(result.ok?(action==='cancel'?'Appointment cancelled.':'Marked as No-show.'):result.message,result.ok?'success':'warning')
      return result
    }catch{if(owner.current(ticket)){const message='Could not confirm the action. Refresh the appointment before retrying.';setActionError(message);return {ok:false,kind:'network',message}}}
    finally{owner.finish(ticket)}
  }
  const cancel=(selection,key)=>runAction('cancel',cancelling,setCancelling,a=>store.appointmentFlow.cancel(a,key,selection),true)
  // Pre-arrival No-show (M6): a manual same-day Staff decision that the scheduled Patient did not arrive. No Visit is
  // created; once the Patient has checked in, No-show is no longer possible.
  const markNoShow=()=>runAction('noShow',missed,setMissed,a=>store.appointmentFlow.noShow(a,commandKey()))
  // Staff needs a readable worklist at normal desktop widths. Keep all actions,
  // payment semantics and exact appointment/Patient identities, but group related fields.
  const staffAppointmentColumns = [
    { key:'appointmentNo', label:'Appointment', render:a=><div className="staff-r11-cell">
      <b className="staff-r11-code">{a.appointmentNo}</b>
      <small>{a.source}</small>
      <small>{branchNames.get(a.branchId)||'Branch unavailable'}</small>
    </div> },
    { key:'patient', label:'Patient / service', render:a=><div className="staff-r11-cell">
      <b>{a.patientName||patientName(a.patientId,state.patients)}</b>
      <small>{a.service}</small>
    </div> },
    { key:'date', label:'When / dentist', render:a=><div className="staff-r11-cell">
      <b>{dateLabel(a.date)}</b>
      <span>{displayTime(a.start)}–{displayTime(addMinutes(a.start,a.duration))}</span>
      <small>{a.dentistName||dentistName(a.dentistId,state.dentists)}</small>
    </div> },
    { key:'status', label:'Status / payment', render:a=><div className="staff-r11-state-stack">
      <Status>{a.status}</Status>
      <BookingPaymentBadge status={a.bookingPaymentStatus} method={a.bookingPaymentMethod}/>
      {a.cancellationCategory&&<small className="staff-r11-cancel-note">{a.cancellationCategory}{a.cancellationDetail&&` — ${a.cancellationDetail}`}</small>}
      {a.cancellationRefund && <small className="staff-r11-cancel-note">{a.cancellationRefund.message}</small>}
    </div> },
    { key:'actions', label:'Actions', render:a=>{
      const checkIn=checkInNavigationFor(store,a)
      const patient=appointmentRecordPatient(a,state,session)
      const canChange=canSchedule(store,a.branchId)&&['Confirmed','Pending'].includes(a.status)
      return <div className="staff-r11-appt-actions">
        {canChange&&<IconAction icon="reschedule" intent="neutral" label={`Reschedule ${a.appointmentNo}`} onClick={()=>openAction(setReschedule,a)}/>}
        {canChange&&<Button size="sm" variant="danger" disabled={owner.busy} onClick={()=>openAction(setCancelling,a)}>Cancel</Button>}
        {patient&&<IconAction icon="eye" label={`View record for ${a.patientName||patientName(a.patientId,state.patients)}`} onClick={()=>setPage('patients',{patientId:patient.id})}/>}
        {checkIn&&<Button size="sm" variant="primary" onClick={()=>setPage('checkin',{mode:'scheduled',checkIn})}>Check in</Button>}
        {canChange&&a.date===clinicDate()&&<button type="button" className="ui-text-action" disabled={owner.busy} onClick={()=>openAction(setMissed,a)}>No-show</button>}
        {canSchedule(store,a.branchId)&&['paid','forfeited'].includes(a.bookingPaymentStatus)&&['Pending','Confirmed','Cancelled','No-show'].includes(a.status)&&
          <Button size="sm" variant="ghost" disabled={owner.busy} onClick={()=>openAction(setRefunding,a)}>Review refund</Button>}
      </div>
    } },
  ]
  return <>
    <PageHeader kicker="Scheduling" title="Appointment management" text={role === 'staff' ? 'Find bookings, confirm arrivals and manage appointment changes.' : undefined} aside={<div className="row-actions">{role!=='staff'&&<RefreshButton onClick={()=>store.appointmentFlow.refresh()}/>}<Button onClick={()=>openAction(setNewOpen,true)} icon="plusCalendar">New appointment</Button></div>}/>
    <AppointmentsStatusNotice store={store}/>
    {owner.busy&&<p role="status">Saving appointment change…</p>}
    {actionError&&<p role="alert">{actionError}</p>}
    <div className={role==='staff'?'staff-r15-appointment-filters':undefined}><FilterBar
      className={role==='staff'?'staff-r15-appt-filter-bar':''}
      ariaLabel="Search clinic appointments"
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search patient, appointment #, dentist, service…"
      onClear={(search||statusFilter!=='All'||branchFilter!=='All'||dateFilter)?()=>{setSearch('');setStatusFilter('All');setBranchFilter('All');setDateFilter('')}:null}
    >
      <input type="date" aria-label="Filter by appointment date" className="filter-date-input" value={dateFilter} onChange={e=>setDateFilter(e.target.value)}/>
      <select aria-label="Filter by appointment status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
        <option value="All">All statuses</option>
        <option value="Confirmed">Confirmed</option>
        <option value="Checked In">Checked In</option>
        <option value="In Treatment">In Treatment</option>
        <option value="Pending">Pending</option>
        <option value="Completed">Completed</option>
        <option value="Cancelled">Cancelled</option>
        <option value="No-show">No-show</option>
      </select>
      {branches.length>1&&<select aria-label="Filter by branch" value={branchFilter} onChange={e=>setBranchFilter(e.target.value)}>
        <option value="All">All branches</option>
        {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
      </select>}
    </FilterBar></div>
    <Card className={role==='staff'?'staff-r11-appointments-card':''} title={role==='staff'?undefined:'Clinic appointments'}>
      <Table caption="Appointments" rows={visible} empty="No appointments match the selected filters." columns={role==='staff'?staffAppointmentColumns:[
        {key:'appointmentNo',label:'Appointment',render:a=><div>
          <b>{a.appointmentNo}</b>
          <small className="block-muted">{a.source}</small>
          {role === 'staff' && <small className="block-muted">{branchNames.get(a.branchId) || 'Branch unavailable'}</small>}
        </div>},
        {key:'date',label:'Date & time',render:a=><div><b>{dateLabel(a.date)}</b><small className="block-muted">{displayTime(a.start)}–{displayTime(addMinutes(a.start,a.duration))}</small></div>},
        {key:'patient',label:'Patient',render:a=>a.patientName||patientName(a.patientId,state.patients)},
        {key:'service',label:'Service'},{key:'dentist',label:'Dentist',render:a=>a.dentistName||dentistName(a.dentistId,state.dentists)},
        {key:'status',label:'Appointment status',render:a=><div className="appointment-state">
          <Status>{a.status}</Status>
          {a.cancellationCategory && <small className="block-muted" style={{overflowWrap:'anywhere'}}>{a.cancellationCategory}{a.cancellationDetail && ` — ${a.cancellationDetail}`}</small>}
        </div>},
        {key:'bookingPaymentStatus',label:'Booking payment',render:a=><BookingPaymentBadge status={a.bookingPaymentStatus} method={a.bookingPaymentMethod}/>},
        {key:'actions',label:'Actions',render:a=><div className="row-actions">{checkInNavigationFor(store,a)&&<Button variant="primary" onClick={()=>{const checkIn=checkInNavigationFor(store,a);if(checkIn)setPage('checkin',{mode:'scheduled',checkIn})}}>Check in</Button>}{role==='staff'&&appointmentRecordPatient(a,state,session)&&<Button size="sm" variant="soft" onClick={()=>{const patient=appointmentRecordPatient(a,state,session);if(patient)setPage('patients',{patientId:patient.id})}}>Open Patient Record</Button>}{canSchedule(store,a.branchId)&&['Confirmed','Pending'].includes(a.status)&&<><Button size="sm" variant="soft" onClick={()=>openAction(setReschedule,a)}>Reschedule</Button><Button size="sm" variant="ghost" disabled={owner.busy} onClick={()=>openAction(setCancelling,a)}>Cancel</Button>{a.date===clinicDate()&&<Button size="sm" variant="ghost" disabled={owner.busy} onClick={()=>openAction(setMissed,a)}>No-show</Button>}</>}{canSchedule(store,a.branchId)&&['paid','forfeited'].includes(a.bookingPaymentStatus)&&['Pending','Confirmed','Cancelled','No-show'].includes(a.status)&&<Button size="sm" variant="ghost" disabled={owner.busy} onClick={()=>openAction(setRefunding,a)}>Review refund</Button>}</div>}
      ]}/>
    </Card>
    <Modal open={newOpen} title="New appointment" wide onClose={()=>setNewOpen(false)}><AppointmentForm role={role} store={store} onSaved={()=>setNewOpen(false)}/></Modal>
    <Modal open={!!reschedule} title="Reschedule appointment" subtitle="The new time must pass the same conflict-prevention rules as a new booking." wide onClose={()=>setReschedule(null)}>{reschedule&&<AppointmentForm role={role} store={store} appointment={reschedule} submitLabel="Save new time" onSaved={()=>setReschedule(null)}/>}</Modal>
    {cancelling && <StaffCancellationDialog selectionDetailsAvailable={store.session?.selectionDetailsAvailable===true} key={cancelling.id} appointment={cancelling} operationKeys={cancellationKeys.current} onCancel={()=>{setCancelling(null);store.appointmentFlow?.refresh()}} onConfirm={cancel}/>}
    {refunding && <BookingRefundDialog key={refunding.id} appointment={refunding} onClose={()=>{setRefunding(null);store.appointmentFlow?.refresh()}}/>}
    <ConfirmDialog open={!!missed} title="Mark as No-show?" confirmLabel="Mark No-show" cancelLabel="Keep appointment" tone="danger" onConfirm={markNoShow} onCancel={()=>setMissed(null)}>
      {missed&&<p>{missed.appointmentNo} • today at {displayTime(missed.start)} • {missed.patientName}. Use this only when the patient did not arrive; no visit is created. A patient who has already checked in can’t be marked No-show.</p>}
    </ConfirmDialog>
  </>
}

/** R23A: explicit manual review. Never say a requested refund is settled until PayMongo confirms it. */
function BookingRefundDialog({ appointment, onClose }) {
  const [reason,setReason]=useState('requested_by_customer')
  const [note,setNote]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [result,setResult]=useState(null)
  const key=useRef(commandKey())
  const submitted=useRef(false)
  const submit=async event=>{
    event.preventDefault()
    if(submitted.current || busy || (reason==='others'&&!note.trim()))return
    submitted.current=true
    setBusy(true);setError('')
    try {
      const response=await requestBookingRefund(appointment.id,{
        expected_revision:appointment.revision,reason,note:note.trim()||null,
      },key.current)
      if(response.ok){
        setResult(response.data)
      }else{
        setError(response.kind==='network'||response.kind==='server'
          ? 'The provider outcome may be unknown. Close this window and refresh the appointment before any further action. Do not send another refund request.'
          : response.message||'Refund could not be authorized. Review the current appointment and financial records.')
      }
    }catch{
      setError('The refund outcome could not be confirmed. Refresh the appointment before any further action.')
    }finally{setBusy(false)}
  }
  return <Modal open title="Review booking payment refund" onClose={()=>!busy&&onClose()}>
    <p><b>{appointment.appointmentNo}</b> · {appointment.patientName} · {appointment.bookingPaymentStatus==='forfeited'?'Booking fee withheld':'Captured booking fee'}.</p>
    <Notice tone="warning">PayMongo booking payment only. If the Patient has checked in, received treatment or an invoice has used the booking credit, stop and review the financial record. This cannot refund counter Cash or reverse an issued receipt.</Notice>
    {result ? <div role="status" aria-live="polite">
      <p>{result.outcome}</p>
      <p><b>Provider outcome:</b> {result.refund_status==='refunded'?'Confirmed refunded':result.refund_status==='unconfirmed'?'Unconfirmed — manual reconciliation needed':result.refund_status}</p>
      <Button onClick={onClose}>Close and refresh</Button>
    </div> : <>
      {error&&<Notice tone="warning" title="Refund not confirmed">{error}</Notice>}
      <form className="au-form" onSubmit={submit}>
        <Field label="Reason"><select aria-label="Refund reason" value={reason} disabled={busy||submitted.current} onChange={e=>setReason(e.target.value)}>
          <option value="requested_by_customer">Patient requested refund</option>
          <option value="duplicate">Duplicate payment</option>
          <option value="fraudulent">Reported fraudulent payment</option>
          <option value="others">Other, specify below</option>
        </select></Field>
        <Field label="Review note" required={reason==='others'}><textarea aria-label="Refund review note" rows={3} maxLength={500} value={note} disabled={busy||submitted.current} onChange={e=>setNote(e.target.value)} required={reason==='others'}/></Field>
        <div className="row-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Close</Button>
          <Button type="submit" disabled={busy||submitted.current||(reason==='others'&&!note.trim())}>{busy?'Checking provider…':'Request PayMongo refund'}</Button>
        </div>
      </form>
      {submitted.current&&error&&<Button onClick={onClose}>Close and refresh</Button>}
    </>}
  </Modal>
}

const BOOKING_PAYMENT_LABELS = {
  paid: ['Paid', 'paid'], unpaid: ['Unpaid', 'unpaid'], held: ['Awaiting payment', 'attention'],
  refunded: ['Refunded', 'neutral'], forfeited: ['Forfeited', 'attention'],
}

function BookingPaymentBadge({ status, method }) {
  const [label, tone] = BOOKING_PAYMENT_LABELS[status] ?? ['Unavailable', 'neutral']
  return <div className="booking-payment">
    <span className={`booking-payment-badge is-${tone}`}><Icon name="wallet" size={14}/>{label}</span>
    {status === 'paid' && method && <small>{method}</small>}
  </div>
}

export function StaffCancellationDialog({ selectionDetailsAvailable = false, appointment, operationKeys, onCancel, onConfirm }) {
  const [category, setCategory] = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const submitting = useRef(false)
  const ready = !!category && (category !== 'Other' || !!detail.trim())
  const submit = async event => {
    event.preventDefault()
    if (!ready || uncertain || submitting.current) return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      const selection = selectionDetailsAvailable
        ? { reason_category: category, ...(category === 'Other' ? { reason_detail: detail.trim() } : {}) }
        : { reason: category === 'Other' ? detail.trim() : category }
      const intent = JSON.stringify([appointment.id, appointment.revision, selection])
      if (!operationKeys.has(intent)) operationKeys.set(intent, commandKey())
      const result = await onConfirm(selection, operationKeys.get(intent))
      if (result?.ok === false) {
        const needsReview = ['server', 'network', 'unverified'].includes(result.kind)
        setUncertain(needsReview)
        setError(needsReview ? 'The outcome is unconfirmed. Close this dialog and review the appointment before making another change.' : result.message)
      }
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  return <Modal open title="Cancel this appointment?" onClose={()=>!busy&&onCancel()}>
    <p>{appointment.appointmentNo} · {appointment.patientName}. The reserved time will be released.</p>
    <form className="au-form" onSubmit={submit}>
      <SelectionDetailsNotice available={selectionDetailsAvailable}/>
      <fieldset disabled={busy || uncertain}>
        <SelectWithOther label="Cancellation reason" value={category} onChange={setCategory}
          options={[{value:'',label:'Select a reason'}, ...STAFF_CANCELLATION_REASONS]}
          placeholder="e.g., Duplicate booking" required otherValue={detail} onOtherChange={setDetail}/>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <div className="row-actions">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>{uncertain ? 'Close and review' : 'Keep appointment'}</Button>
        <Button type="submit" variant="danger" disabled={busy || uncertain || !ready}>{busy?'Cancelling…':'Cancel appointment'}</Button>
      </div>
    </form>
  </Modal>
}

// The active Dentist route delegates to the calendar-first workspace.
export { DentistSchedule as SchedulePage } from './DentistSchedule.jsx'

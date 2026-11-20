import { groupBookableServiceOptions } from '../service-options.js'
import { checkInActorKey, checkInAppointmentFor, checkInSelectionFor } from '../checkin-navigation.js'
import {SelectionDetailsNotice} from '../selection-details.jsx'
import { QueueOrderDialog } from './QueueOrderDialog.jsx'
import { DentistQueue } from './DentistQueue.jsx'
import React, { useEffect, useState, useRef } from 'react'
import { Button, Card, Field, FilterBar, Icon, Modal, Notice, PageHeader, Progress, RefreshButton, SelectWithOther, Status, Table } from '../components.jsx'
import { branchCapacity, dentistName, displayTime, patientName, queueWaitEstimate } from '../logic.js'
import { STAFF_CANCELLATION_REASONS, commandKey } from '../appointments-api.js'
import { compareBranchQueue, displayQueueStatus } from '../queue-api.js'
import { getAppointment } from '../api-client.js'
import { findPatientConversation } from '../messaging-api.js'
import '../b4-queue.css'
import '../checkin-reception.css'
import { useVisibleRefresh } from '../use-visible-refresh.js'
import { patientKeyResolver } from '../appointment-projection.js'
import { DEFAULT_COUNTRY, normalizePhoneNumber } from '../phone.js'
import { RecordedArrivals } from './ArrivalRecovery.jsx'
import { bookableBranches } from './Scheduling.jsx'
import { schedulingActorKey, useRequestOwner } from '../appointment-ui.js'
import { calledEncounterContext, commandGate } from '../encounter.js'

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
  const latestStore=useRef(store);latestStore.current=store
  const session=store.session||sessionForRole('staff',state)
  const flow=store.appointmentFlow
  const [arrivalPhase,setArrivalPhase]=useState('idle'),[arrivalMessage,setArrivalMessage]=useState(''),[arrivalResult,setArrivalResult]=useState(null)
  const arrivalAttempt=useRef(null),arrivalSending=useRef(false),arrivalLive=useRef(false),arrivalFeedback=useRef(null)
  const arrivalLocked=['submitting','unknown'].includes(arrivalPhase)
  React.useLayoutEffect(()=>{arrivalLive.current=true;return()=>{arrivalLive.current=false}},[])
  useEffect(()=>{if(['unknown','refused','verified'].includes(arrivalPhase))arrivalFeedback.current?.focus()},[arrivalPhase])
  const resetArrival=()=>{if(arrivalSending.current||arrivalAttempt.current?.outcome==='unknown'||cancelSending.current||cancelAttempt.current?.uncertain)return false;arrivalAttempt.current=null;setArrivalPhase('idle');setArrivalMessage('');setArrivalResult(null);return true}
  const submitArrival=async command=>{
    if(!command||arrivalSending.current)return
    arrivalSending.current=true;setArrivalPhase('submitting');setArrivalMessage('')
    try{
      const result=await command.submit()
      if(!arrivalLive.current||arrivalAttempt.current!==command)return
      if(result.outcome==='obsolete'){setArrivalPhase('unknown');setArrivalMessage('Your admission context changed. Review recorded arrivals before starting another admission.');return}
      if(!['unknown','refused','verified'].includes(result.outcome))return
      setArrivalPhase(result.outcome)
      if(!result.ok){setArrivalMessage(result.message||'The arrival was not confirmed. Review the current clinic records.');return}
      if(command.intent.kind==='walkin')setAdmitted(true)
      else{reviewedSelection.current=null;setSelectionContext(null);setAppointmentId('');setIdConfirmed(false)}
      setArrivalResult({...result,actorKey:checkInActorKey(store.session),authGeneration:store.getAuthGeneration?.()})
      setArrivalMessage(result.warning||'')
      toast(result.queued?`Arrival verified — queue number ${result.queueNumber}.`:'Arrival verified.','success')
    }catch{if(arrivalLive.current&&arrivalAttempt.current===command){setArrivalPhase('unknown');setArrivalMessage('The arrival outcome could not be confirmed. Review recorded arrivals before another admission.')}}finally{arrivalSending.current=false}
  }
  const [mode,setMode]=useState(context?.mode||'scheduled')
  const walkinPanel=useRef(null), walkinToggle=useRef(null)
  useEffect(()=>{if(mode==='walkin')walkinPanel.current?.focus({preventScroll:true})},[mode])
  const today=clinicDate()
  useEffect(()=>{ flow?.searchPatients?.('') }, [])
  // Today's server appointments awaiting arrival (no Visit yet), sorted chronologically earliest first.
  const eligible=state.appointments.filter(a=>inScope(a,session,state)&&a.date===today&&['Confirmed','Pending'].includes(a.status)&&!(state.visits||[]).some(v=>v.appointmentId===a.id)).sort((a,b)=>(a.start||'').localeCompare(b.start||''))
  // Today's server Visits that are checked in but not in a queue: only a Visit without a responsible Dentist (M9 Q4).
  // Shown honestly; no assignment workflow exists in this wave.
  const notQueued=(state.visits||[]).filter(v=>v.status==='Checked In'&&v.clinicDate===today&&inScope(v,session,state)&&!v.dentistId)
  const [appointmentId,setAppointmentId]=useState(context?.checkIn?.appointmentId || '')
  const [selectionContext,setSelectionContext]=useState(()=>context?.checkIn ? Object.freeze({...context.checkIn}) : null)
  const contextualAppointment=selectionContext ? checkInAppointmentFor(store,selectionContext) : null
  const selectedAppointment=contextualAppointment?.id===appointmentId ? contextualAppointment : null
  // One Idempotency-Key per confirm attempt, reused when retrying the same arrival.
  const checkInKey=useRef({selection:null,key:null}), scheduledPending=useRef(null), scheduledLive=useRef(true), reviewedSelection=useRef(selectionContext)
  reviewedSelection.current=selectionContext
  const [arrivalProblem,setArrivalProblem]=useState('')
  const selectScheduled=snapshot=>{
    if(!resetArrival())return
    cancelAttempt.current=null;setCancelModalOpen(false);setCancelUncertain(false);setCancelError('')
    const next=snapshot ? Object.freeze({...snapshot}) : null
    reviewedSelection.current=next;setSelectionContext(next);setAppointmentId(next?.appointmentId||'');setIdConfirmed(false);setArrivalProblem('')
  }
  useEffect(()=>{scheduledLive.current=true;return()=>{scheduledLive.current=false;scheduledPending.current=null}},[])
  const [busy,setBusy]=useState(false)
  const [idConfirmed, setIdConfirmed] = useState(false)
  useEffect(()=>{
    selectScheduled(context?.checkIn || null)
  },[context?.checkIn])
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('No valid ID presented')
  const [cancelReasonOther, setCancelReasonOther] = useState('')
  const [cancelNote, setCancelNote] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const cancelKey = useRef(commandKey())
  const cancelAttempt=useRef(null),cancelSending=useRef(false),cancelReading=useRef(false)
  const [reviewedCancellation, setReviewedCancellation] = useState(null)
  const [cancelUncertain,setCancelUncertain]=useState(false),[cancelError,setCancelError]=useState('')

  const handleCancelAppointment = async () => {
    if (cancelSending.current || !selectedAppointment&&!cancelAttempt.current) return
    const effectiveReason = cancelReason === 'Other' ? cancelReasonOther.trim() : cancelReason
    if (cancelReason === 'Other' && !cancelReasonOther.trim()) {
      return toast('Please specify the cancellation reason.', 'warning')
    }
    if(!cancelAttempt.current){
      if(!selectionContext||!checkInAppointmentFor(latestStore.current,selectionContext))return
      cancelAttempt.current={appointment:Object.freeze({...selectedAppointment}),reviewed:reviewedSelection.current,key:cancelKey.current,uncertain:false,actor:schedulingActorKey(store),auth:store.getAuthGeneration?.(),
        extra:Object.freeze({...(store.session?.selectionDetailsAvailable?{reason_category:cancelReason,...(cancelReason==='Other'?{reason_detail:effectiveReason}:{})}:{reason:effectiveReason}),note:cancelNote.trim()||undefined})}
    }
    const command=cancelAttempt.current
    const owns=()=>arrivalLive.current&&cancelAttempt.current===command&&reviewedSelection.current===command.reviewed&&command.auth===latestStore.current.getAuthGeneration?.()&&command.actor===schedulingActorKey(latestStore.current)
    if(!owns() || (command.uncertain && reviewedCancellation !== command)) return
    setReviewedCancellation(null)
    cancelSending.current=true;setCancelling(true);setCancelError('')
    try{
      let result
      let timer
      try{result=await Promise.race([flow.cancel(command.appointment,command.key,{...command.extra,beforeDispatch:()=>owns()&&(command.uncertain||!!checkInAppointmentFor(latestStore.current,command.reviewed))}),new Promise(resolve=>{timer=setTimeout(()=>resolve({ok:false,kind:'network'}),30000)})])}
      catch{result={ok:false,kind:'network'}}
      finally{clearTimeout(timer)}
      if(!owns())return
      if(!result.ok){
        command.uncertain=command.uncertain||!['validation','conflict','not_found','forbidden','unauthenticated','rate_limited','stale_context'].includes(result.kind)
        setCancelUncertain(command.uncertain)
        setCancelError(command.uncertain?'Cancellation is unconfirmed. Close this dialog and review the current appointment.':result.message||'Cancellation was refused. Review the appointment before trying again.')
        if(!command.uncertain){cancelAttempt.current=null;cancelKey.current=commandKey()}
        return
      }
      cancelAttempt.current=null;setCancelUncertain(false);setCancelModalOpen(false);reviewedSelection.current=null;setSelectionContext(null)
      setAppointmentId('');setIdConfirmed(false);setArrivalResult(null);setCancelReason('No valid ID presented');setCancelReasonOther('');setCancelNote('');cancelKey.current=commandKey()
      toast(result.warning||'Appointment cancelled.',result.warning?'warning':'success')
    }finally{cancelSending.current=false;if(arrivalLive.current)setCancelling(false)}
  }
  const reviewCancellation = async () => {
    const command = cancelAttempt.current
    if (!command?.uncertain || cancelReading.current || cancelSending.current) return
    cancelReading.current = true
    setReviewedCancellation(null)
    const owns = () => arrivalLive.current && cancelAttempt.current === command && command.auth === latestStore.current.getAuthGeneration?.()
      && command.actor === schedulingActorKey(latestStore.current)
    try {
      const result = await getAppointment(command.appointment.id)
      if (!owns()) return
      const row = result.data
      if (!result.ok || row?.id !== command.appointment.id) {
        setCancelError('The appointment could not be read. Try reviewing it again.')
        return
      }
      if (['Pending', 'Confirmed'].includes(row.status) && row.revision === command.appointment.revision) {
        setReviewedCancellation(command)
        setCancelError('The appointment still shows as active. You can recover the original cancellation using the same request.')
        return
      }
      cancelAttempt.current = null
      setCancelUncertain(false)
      reviewedSelection.current = null
      setSelectionContext(null)
      setAppointmentId('')
      setIdConfirmed(false)
      toast(row.status === 'Cancelled' ? 'The clinic record confirms this appointment is cancelled.' : 'The appointment changed. Review the latest record before acting.', 'warning')
      await flow.refresh()
    } catch {
      if (owns()) setCancelError('The appointment could not be read. Try reviewing it again.')
    } finally { cancelReading.current = false }
  }
  const checkScheduledLegacy=async()=>{
    const reviewed=reviewedSelection.current
    if(!selectedAppointment||!reviewed||busy||scheduledPending.current)return
    if(!idConfirmed){
      return toast('Confirm that the patient presented a valid ID before completing check-in, or cancel the appointment.', 'warning')
    }
    const selection=JSON.stringify(reviewed)
    if(checkInKey.current.selection!==selection)checkInKey.current={selection,key:commandKey()}
    const ticket={reviewed,key:checkInKey.current.key};scheduledPending.current=ticket;setBusy(true);setArrivalProblem('')
    let result
    try {result=await flow.checkIn(reviewed.appointmentId,ticket.key,{...reviewed,idConfirmed:true})}
    catch {result={ok:false,message:'The arrival outcome could not be confirmed. Refresh the appointment list before retrying; no new arrival was assumed.'}}
    if(scheduledPending.current!==ticket)return
    scheduledPending.current=null
    if(!scheduledLive.current)return
    setBusy(false)
    if(reviewedSelection.current!==reviewed||store.getAuthGeneration?.()!==reviewed.authGeneration||checkInActorKey(store.session)!==reviewed.actorKey)return
    if(!result.ok){setArrivalProblem(result.message);if(result.kind==='stale_context')setIdConfirmed(false);return toast(result.message,'warning')}
    checkInKey.current={selection:null,key:null};selectScheduled(null)
    toast(result.queued?`Arrival recorded — queue number ${result.queueNumber}.`:'Arrival recorded.','success')
  }

  const checkScheduled=async()=>{
    if(cancelSending.current||cancelAttempt.current?.uncertain)return
    if(typeof flow?.beginArrival!=='function')return checkScheduledLegacy()
    if(arrivalSending.current||arrivalLocked||!selectedAppointment||!selectionContext)return
    if(!idConfirmed)return toast('Confirm that the patient presented a valid ID before completing check-in, or cancel the appointment.','warning')
    const reviewed=reviewedSelection.current,a=selectedAppointment
    const command=flow.beginArrival({kind:'scheduled',appointmentId:a.id,expectedRevision:reviewed.revision,patientPublicId:a.patientPublicId,branchId:a.branchId,
      serviceId:a.serviceId||null,dentistId:a.dentistId||null,clinicDate:today,idConfirmed:true},
      {isCurrent:()=>arrivalLive.current&&arrivalAttempt.current===command,validateInitial:()=>reviewedSelection.current===reviewed&&!!checkInAppointmentFor(store,reviewed)})
    arrivalAttempt.current=command;await submitArrival(command)
  }

  const branches=bookableBranches(state,session)
  const [walkIn,setWalkIn]=useState({patientPublicId:'',branchId:branches[0]?.id||'',dentistId:'',serviceId:''})
  const walkKey=useRef(commandKey())
  const [admitted,setAdmitted]=useState(false)
  const [search,setSearch]=useState('')
  const [patientMenuOpen,setPatientMenuOpen]=useState(false)
  const [activeIndex,setActiveIndex]=useState(-1)
  const patientInput=useRef(null), patientBlur=useRef(null)
  useEffect(()=>()=>clearTimeout(patientBlur.current),[])
  const openPatientMenu=()=>{clearTimeout(patientBlur.current);setPatientMenuOpen(true)}
  useEffect(()=>{if(search.trim().length>=2){const t=setTimeout(()=>flow?.searchPatients(search),250);return ()=>clearTimeout(t)}},[search])
  const directory=(store.directoryPatients||[]).filter(p=>!search.trim()||`${p.name} ${p.patientCode} ${p.phone}`.toLowerCase().includes(search.trim().toLowerCase()))
  const directoryIdentity=JSON.stringify(directory.map(p=>p.id))
  useEffect(()=>{setActiveIndex(-1)},[directoryIdentity])
  const walkServices=state.services.filter(s=>s.status==='Active'&&state.branchServices.some(bs=>bs.branchId===walkIn.branchId&&bs.serviceId===s.id&&bs.active!==false))
  const walkDentists=state.dentists.filter(d=>d.available&&d.branchIds.includes(walkIn.branchId)&&state.dentistServiceAssignments.some(a=>a.dentistId===d.id&&a.serviceId===walkIn.serviceId&&a.isAuthorized!==false))
  const updateWalkin=(key,value)=>{
    if(!resetArrival())return
    setAdmitted(false);walkKey.current=commandKey()
    setWalkIn(previous=>({...previous,[key]:value,...(key==='branchId'?{serviceId:'',dentistId:''}:key==='serviceId'?{dentistId:''}:{})}))
  }
  const [walking,setWalking]=useState(false)
  const [registering,setRegistering]=useState(!!context?.register)
  const selectedPatient=(store.directoryPatients||[]).find(p=>p.id===walkIn.patientPublicId)
  // This explicit front-desk path chooses a Dentist so arrival can enter a Dentist queue; the server Visit
  // also supports an unresolved Dentist under its existing contract.
  const canWalkIn=!registering&&!!selectedPatient&&!!walkIn.branchId&&!!walkIn.serviceId&&!!walkIn.dentistId&&!walking&&!admitted&&!arrivalLocked
  const checkWalkinLegacy=async()=>{
    if(!canWalkIn)return
    setWalking(true)
    const patientId=patientKeyResolver({session,users:state.users,patients:state.patients})(walkIn.patientPublicId)
    const result=await flow.walkIn({...walkIn,patientId},walkKey.current)
    setWalking(false)
    if(!result.ok)return toast(result.message,'warning')
    setAdmitted(true);toast(result.queued?`Walk-in admitted — queue number ${result.queueNumber}.`:'Walk-in arrival recorded.','success')
  }

  const checkWalkin=async()=>{
    if(typeof flow?.beginArrival!=='function')return checkWalkinLegacy()
    if(!canWalkIn||arrivalSending.current||arrivalLocked)return
    const intent={...walkIn,kind:'walkin',clinicDate:today}
    const command=flow.beginArrival(intent,{isCurrent:()=>arrivalLive.current&&arrivalAttempt.current===command})
    arrivalAttempt.current=command;await submitArrival(command)
  }

  // Minimal front-desk registration of a new walk-in Patient (Person + Patient on the server, no login account).
  const emptyPatient={firstName:'',lastName:'',phone:'',email:'',dob:''}
  const [newPatient,setNewPatient]=useState(emptyPatient)
  const registerKey=useRef(commandKey())
  const registerSending = useRef(false)
  const [registerBusy, setRegisterBusy] = useState(false)
  const [registerUncertain, setRegisterUncertain] = useState(false)
  const [registerError,setRegisterError]=useState('')
  const updateNewPatient=(key,value)=>{registerKey.current=commandKey();setRegisterError('');setNewPatient(previous=>({...previous,[key]:value}))}
  const register=async()=>{
    if (registerSending.current) return
    const phone=newPatient.phone.trim()?normalizePhoneNumber(DEFAULT_COUNTRY.dial,newPatient.phone):{ok:true,e164:''}
    if(!newPatient.firstName.trim()||!newPatient.lastName.trim())return setRegisterError('Enter the patient’s first and last name.')
    if(!phone.ok)return setRegisterError(phone.reason)
    const actor = schedulingActorKey(store), auth = store.getAuthGeneration?.()
    const owns = () => arrivalLive.current && actor === schedulingActorKey(latestStore.current) && auth === latestStore.current.getAuthGeneration?.()
    registerSending.current = true
    setRegisterBusy(true)
    setRegisterError('')
    try {
      const result = await flow.registerPatient({...newPatient,firstName:newPatient.firstName.trim(),lastName:newPatient.lastName.trim(),phone:phone.e164,email:newPatient.email.trim()},registerKey.current)
      if (!owns()) return
      if (!result.ok) {
        const uncertain = registerUncertain || ['network', 'server', 'unverified'].includes(result.kind)
        setRegisterUncertain(uncertain)
        setRegisterError(uncertain ? 'Registration is unconfirmed. Retry this same registration to recover its result.' : result.message)
        return
      }
      setRegisterUncertain(false)
      flow?.searchPatients?.('')
      updateWalkin('patientPublicId',result.patient.id)
      setNewPatient(emptyPatient);setRegistering(false);registerKey.current=commandKey()
      toast('Created registration: ' + result.patient.name + ' (' + result.patient.patientCode + ').','success')
    } catch {
      if (!owns()) return
      setRegisterUncertain(true)
      setRegisterError('Registration is unconfirmed. Retry this same registration to recover its result.')
    } finally {
      registerSending.current = false
      if (owns()) setRegisterBusy(false)
    }
  }
  const selectCombPatient=p=>{updateWalkin('patientPublicId',p.id);setSearch(`${p.name} • ${p.patientCode}`);setPatientMenuOpen(false);setActiveIndex(-1)}

  return <>
    <PageHeader title="Check-in" aside={session?.role==='staff'?undefined:<div className="row-actions"><RefreshButton size="sm" onClick={()=>flow?.refresh()}/></div>}/>
    <AppointmentsLoadNotice store={store}/>
    {cancelUncertain&&(!cancelModalOpen||!selectedAppointment)&&<Notice tone="warning" title="Cancellation unconfirmed">{cancelError}<div className="row-actions"><Button onClick={reviewCancellation} disabled={cancelling}>Review appointment</Button>{reviewedCancellation && <Button onClick={handleCancelAppointment} disabled={cancelling}>Retry same cancellation</Button>}</div></Notice>}
    <div ref={arrivalFeedback} tabIndex={-1} role={['unknown','refused'].includes(arrivalPhase)?'alert':'status'}>
      {arrivalPhase==='submitting'&&<p>Recording the reviewed arrival…</p>}
      {arrivalMessage&&<p>{arrivalMessage}</p>}
      {arrivalPhase==='unknown'&&<><Button onClick={()=>submitArrival(arrivalAttempt.current)}>Retry the same arrival</Button><p>Details stay protected. After reload or sign-in, review today’s recorded arrivals before starting another admission.</p></>}
      {arrivalPhase==='refused'&&<Button onClick={()=>{if(resetArrival())flow?.refresh()}}>Review arrival details</Button>}
      {arrivalResult&&arrivalResult.actorKey===checkInActorKey(store.session)&&arrivalResult.authGeneration===store.getAuthGeneration?.()&&<Notice tone="success" title="Arrival receipt">
        {arrivalResult.patientName}: visit {arrivalResult.visitId}{arrivalResult.queued?` · Queue ${arrivalResult.queueNumber}`:' · No Dentist queue assigned'}. This confirms arrival, not treatment completion.
        {setPage&&<Button variant="soft" onClick={()=>setPage('queue')}>Open live queue</Button>}
      </Notice>}
    </div>
    <div className={`checkin-workspace is-${mode}`}>
    <div className="checkin-shell">
      <div className="checkin-mode" role="group" aria-label="Arrival type"><button disabled={arrivalLocked||cancelling||cancelUncertain} aria-pressed={mode==='scheduled'} className={mode==='scheduled'?'active':''} onClick={()=>setMode('scheduled')}><Icon name="calendar" size={18}/>Scheduled</button><button disabled={arrivalLocked||cancelling||cancelUncertain} aria-pressed={mode==='walkin'} aria-controls="walkin-admission-panel" ref={walkinToggle} className={mode==='walkin'?'active':''} onClick={()=>setMode('walkin')}><Icon name="user" size={18}/>Walk-in</button></div>
      {mode==='scheduled'?<Card className="checkin-focus-card" title="Scheduled arrivals" actions={eligible.length>0?<span className="staff-r11-arrival-count">{eligible.length} waiting</span>:null}>
        {arrivalProblem&&<Notice tone="warning">{arrivalProblem}</Notice>}
        {selectionContext&&!contextualAppointment&&<Notice tone="warning">The selected appointment changed or is no longer eligible. Refresh and explicitly select the current appointment; no patient was substituted.</Notice>}
        <div className="checkin-select-row">

          {eligible.length > 0 ? <div className="checkin-arrival-options" role="group" aria-label="Choose an appointment to check in">
            {eligible.map(a => <button
              type="button"
              key={a.id}
              className={`checkin-arrival-option${selectedAppointment?.id === a.id ? ' is-selected' : ''}`}
              aria-pressed={selectedAppointment?.id === a.id}
              disabled={busy||cancelling||cancelUncertain||arrivalLocked}
              onClick={() => selectScheduled(checkInSelectionFor(store, a))}
            >
              <span className="checkin-option-time">{displayTime(a.start)}</span>
              <span className="checkin-option-person"><strong>{patientName(a.patientId, state.patients)}</strong><small>{a.service}</small></span>
              <span className="checkin-option-status">{a.status}</span>
            </button>)}
          </div> : store.appointmentsStatus === 'loading'
            ? <p className="checkin-inline-state" role="status">Loading today's arrivals…</p>
            : store.appointmentsStatus === 'error'
            ? <p className="checkin-inline-state is-error">Arrivals could not be verified. Use Retry above before admitting a patient.</p>
            : <div className="checkin-empty" role="status"><Icon name="calendar" size={20}/><div><strong>No arrivals waiting</strong></div></div>}
        </div>
        {selectedAppointment?<div className="arrival-card"><div className="avatar large">{patientName(selectedAppointment.patientId,state.patients).split(' ').map(x=>x[0]).slice(0,2).join('')}</div><div className="arrival-main"><span>Arriving patient</span><h2>{patientName(selectedAppointment.patientId,state.patients)}</h2><p>{selectedAppointment.service} • {selectedAppointment.dentistName||dentistName(selectedAppointment.dentistId,state.dentists)}</p><div className="arrival-meta"><span><Icon name="calendar" size={15}/>{displayTime(selectedAppointment.start)}</span><span><Icon name="building" size={15}/>{selectedAppointment.branch}</span><span>{selectedAppointment.appointmentNo}</span></div></div><div className="arrival-action">
            <Status>{selectedAppointment.status}</Status>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', margin: '4px 0', cursor: 'pointer' }}>
              <input type="checkbox" disabled={busy||cancelling||cancelUncertain||arrivalLocked} checked={idConfirmed} onChange={e=>setIdConfirmed(e.target.checked)}/>
              <span>Valid ID presented</span>
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <Button onClick={checkScheduled} disabled={busy || cancelling || cancelUncertain || arrivalLocked} icon="checkin">{busy ? 'Recording…' : 'Confirm arrival'}</Button>
              <Button variant="ghost" onClick={() => { cancelKey.current = commandKey(); setCancelModalOpen(true) }} disabled={busy || cancelling || cancelUncertain || arrivalLocked}>Cancel appointment</Button>
            </div>
          </div></div>:null}
        {selectedAppointment?.patientPublicId&&session?.role==='staff'&&<IdCheck patientId={selectedAppointment.patientPublicId} toast={toast} getAuthGeneration={store.getAuthGeneration}/>}
        {cancelModalOpen && selectedAppointment && (
          <Modal open title={`Cancel appointment: ${patientName(selectedAppointment.patientId, state.patients)}`} onClose={() => !cancelling && setCancelModalOpen(false)}>
            <div className="form-grid">
              {cancelError&&<p className="span-2" role="alert">{cancelError}</p>}
              <Notice tone="warning">Cancelling this appointment will mark it as Cancelled on the clinic server and reopen any linked follow-up.</Notice>
              <fieldset className="span-2 form-grid" disabled={cancelling||cancelUncertain} style={{border:0,padding:0,margin:0,minWidth:0}}>
              <div className="span-2">
                <SelectionDetailsNotice available={store.session?.selectionDetailsAvailable}/>
                <SelectWithOther
                  label="Cancellation reason"
                  required
                  value={cancelReason}
                  onChange={setCancelReason}
                  options={STAFF_CANCELLATION_REASONS}
                  otherValue={cancelReasonOther}
                  onOtherChange={setCancelReasonOther}
                  placeholder="e.g., Unreachable, Duplicate booking, Arrived late"
                />
              </div>
              <Field className="span-2" label="Additional note" hint="Optional note recorded in audit">
                <input value={cancelNote} maxLength={500} placeholder="Any specific context…" onChange={e => setCancelNote(e.target.value)} />
              </Field>
              </fieldset>
              <div className="span-2 row-actions" style={{ justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                <Button variant="ghost" onClick={() => setCancelModalOpen(false)} disabled={cancelling}>{cancelUncertain ? 'Close and review' : 'Keep appointment'}</Button>
                <Button
                  className="pp-danger-solid"
                  disabled={cancelling || cancelUncertain || (cancelReason === 'Other' && !cancelReasonOther.trim())}
                  onClick={handleCancelAppointment}
                >
                  {cancelling ? 'Cancelling…' : cancelUncertain?'Retry same cancellation':'Confirm cancellation'}
                </Button>
              </div>
            </div>
          </Modal>
        )}
        <details className="checkin-help"><summary><Icon name="shield" size={16}/>How check-in works</summary><p>Verify the patient's identity before confirming arrival. Check-in creates a Visit and updates the queue together. Mark no-shows in Appointments.</p></details>
        {notQueued.length>0&&<div className="top-gap"><Notice tone="info" title="Checked in, not in a queue">These visits have no responsible Dentist yet, so they are not in a Dentist’s queue and treatment can’t start. Assigning a Dentist later isn’t available yet.</Notice>
          {notQueued.map(v=><div className="clinical-history" key={v.id}><div><b>{v.patientName||patientName(v.patientId,state.patients)}</b><p>{v.walkIn?'Walk-in':v.appointmentCode} • arrived {displayTime(v.checkedIn)} • No Dentist assigned</p></div></div>)}
        </div>}
      </Card>:null}
      <div id="walkin-admission-panel" className="walkin-panel-transition" ref={walkinPanel} tabIndex={-1} role="region" aria-label="Walk-in admission form" hidden={mode!=='walkin'} inert={mode!=='walkin'}
        onKeyDown={event=>{
          if(event.key!=='Escape'||arrivalLocked||cancelling||cancelUncertain||registerBusy||registerUncertain||patientMenuOpen)return
          event.preventDefault()
          setMode('scheduled')
          walkinToggle.current?.focus()
        }}><Card className="walkin-admission-panel" title="Walk-in admission"><fieldset className="form-grid" disabled={arrivalLocked} style={{border:0,padding:0,margin:0,minWidth:0}}>
        <div className="span-2 staff-r15-patient-mode">
          <span>{registering?'New patient':'Patient lookup'}</span>
          <button type="button" className="staff-r15-inline-action" disabled={registerBusy || registerUncertain} onClick={()=>{
            if (registering) setRegistering(false)
            else {setRegistering(true);updateWalkin('patientPublicId','');setSearch('');setPatientMenuOpen(false);setActiveIndex(-1)}
          }}>{registering?'Back to patient search':'Register new patient'}</button>
        </div>
        {!registering && <>
        {!registering && <div className="span-2 patient-combobox">
          <Field label="Patient" required hint="Select the matching patient before admitting a walk-in.">
            <input ref={patientInput} role="combobox" aria-expanded={patientMenuOpen} aria-autocomplete="list" aria-controls="walkin-patient-listbox" aria-activedescendant={patientMenuOpen&&directory[activeIndex]?`walkin-patient-option-${activeIndex}`:undefined} value={search} placeholder="Type name, patient code, or phone…" onFocus={openPatientMenu} onBlur={()=>{clearTimeout(patientBlur.current);patientBlur.current=setTimeout(()=>setPatientMenuOpen(false),150)}} onChange={e=>{setSearch(e.target.value);setPatientMenuOpen(true);setActiveIndex(-1);if(walkIn.patientPublicId)updateWalkin('patientPublicId','')}} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setPatientMenuOpen(true);setActiveIndex(i=>Math.min(i+1,Math.max(0,directory.length-1)))}else if(e.key==='ArrowUp'){e.preventDefault();setActiveIndex(i=>Math.max(0,i-1))}else if(e.key==='Enter'&&patientMenuOpen&&directory[activeIndex]){e.preventDefault();selectCombPatient(directory[activeIndex])}else if(e.key==='Escape'){setPatientMenuOpen(false);setActiveIndex(-1)}}}/>
          </Field>
          {selectedPatient&&<div className="patient-combobox-selected"><span>Selected: <b>{selectedPatient.name}</b> ({selectedPatient.patientCode})</span><button type="button" className="icon-btn" aria-label="Clear selected patient" onClick={()=>{updateWalkin('patientPublicId','');setSearch('');setActiveIndex(-1);openPatientMenu();patientInput.current?.focus()}}><Icon name="x" size={14}/></button></div>}
          {patientMenuOpen&&<ul id="walkin-patient-listbox" role="listbox" className="patient-combobox-list">{directory.length?directory.map((p,idx)=><li key={p.id} id={`walkin-patient-option-${idx}`} role="option" aria-selected={walkIn.patientPublicId===p.id} className={`patient-combobox-option ${idx===activeIndex?'is-active':''} ${walkIn.patientPublicId===p.id?'is-selected':''}`.trim()} onMouseDown={e=>e.preventDefault()} onClick={()=>selectCombPatient(p)}><b>{p.name}</b><span>{p.patientCode}{p.phone?` • ${p.phone}`:''}</span></li>):<li className="patient-combobox-empty">No matching patients found.</li>}</ul>}
        </div>}

        </>}
        {registering && <div className="span-2 form-grid" style={{ padding: '14px', background: 'var(--surface-2)', borderRadius: '12px' }}>
          <fieldset className="span-2 form-grid" disabled={registerBusy || registerUncertain} style={{border:0,padding:0,margin:0,minWidth:0}}>
          <Field label="First name" required><input value={newPatient.firstName} onChange={e=>updateNewPatient('firstName',e.target.value)}/></Field>
          <Field label="Last name" required><input value={newPatient.lastName} onChange={e=>updateNewPatient('lastName',e.target.value)}/></Field>
          <Field label="Mobile number" hint="Optional. 10 digits starting with 9 (no leading 0)."><input inputMode="tel" value={newPatient.phone} maxLength={10} placeholder="9171234567" onChange={e=>updateNewPatient('phone',e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10))}/></Field>
          <Field label="Email" hint="Optional. If this email is already on file, select that patient instead."><input type="email" value={newPatient.email} onChange={e=>updateNewPatient('email',e.target.value)}/></Field>
          <Field label="Date of birth" hint="Up to 120 years old"><input type="date" min={addCalendarMonths(today, -12 * 120)} max={today} value={newPatient.dob} onChange={e=>updateNewPatient('dob',e.target.value)}/></Field>
          </fieldset>
          <div className="span-2">{registerError&&<Notice tone="warning">{registerError}</Notice>}<div className="row-actions"><Button size="sm" onClick={register} disabled={registerBusy}>{registerBusy ? "Registering?" : registerUncertain ? "Retry same registration" : "Register new patient"}</Button></div><small className="block-muted">Creates a clinic patient record only — no login account.</small></div>
        </div>}
        <Field label="Branch"><select value={walkIn.branchId} onChange={e=>updateWalkin('branchId',e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Requested service" required><select value={walkIn.serviceId} onChange={e=>updateWalkin('serviceId',e.target.value)}><option value="">Select service</option>{groupBookableServiceOptions(walkServices).map(group=><optgroup key={group.category} label={group.category}>{group.items.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}</select></Field>
        <Field label="Dentist" required hint="The live queue is organized by Dentist, so choose one now."><select value={walkIn.dentistId} onChange={e=>updateWalkin('dentistId',e.target.value)}><option value="">Select dentist</option>{walkDentists.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        {walkIn.dentistId&&(()=>{
          const dentistQueue=state.queue.filter(q=>q.dentistId===walkIn.dentistId&&isActiveQueue(q)&&isTodayQueue(q))
          const upcomingAppt=state.appointments.find(a=>a.dentistId===walkIn.dentistId&&a.date===today&&['Confirmed','Pending'].includes(a.status))
          return <div className="span-2"><Notice tone={upcomingAppt?'warning':'info'}>
            <b>Dr. {walkDentists.find(d=>d.id===walkIn.dentistId)?.name||'Dentist'} queue load:</b> {dentistQueue.length} active queue entr{dentistQueue.length===1?'y':'ies'}.
            {upcomingAppt?` Scheduled appointment shown: ${displayTime(upcomingAppt.start)} (${upcomingAppt.service}). Queue order follows recorded arrivals and authorized queue controls; this does not reserve appointment time.`:' No pending or confirmed appointments are shown for this Dentist today.'}
          </Notice></div>
        })()}
        <div className="span-2 walkin-action"><p className="clinic-inline-help">Creates an arrival and queue entry. Does not reserve appointment time.</p><Button disabled={!canWalkIn} onClick={checkWalkin} icon="checkin">{walking?'Admitting…':'Admit walk-in to queue'}</Button></div>
      </fieldset></Card></div>
    </div>
    <section className="checkin-recorded" aria-label="Recorded arrivals"><RecordedArrivals store={store}/></section>
    </div>
    <PossibleNoShows toast={toast} onChanged={()=>flow?.refresh()}/>
    <div className="fd-grid"><SelfRegistered toast={toast} store={store} onChanged={()=>flow?.refresh()}/></div>
    <FrontDeskToday toast={toast} onChanged={()=>flow?.refresh()}/>
  </>
}

function AppointmentsLoadNotice({ store }) {
  if(store.appointmentsStatus==='error')return <Notice tone="warning" title="Clinic records couldn’t be loaded">{store.appointmentsError} <Button size="sm" variant="ghost" onClick={()=>store.appointmentFlow?.refresh()}>Try again</Button></Notice>
  if(store.appointmentsStatus==='loading')return <p className="checkin-inline-state" role="status">Loading appointments and visits…</p>
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
  const [queueSearch,setQueueSearch]=useState('')
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
    if(role==='staff'&&(!session?.branchId||q.branchId!==session.branchId))return false
    if(role==='owner'&&activeBranch!=='All Branches'&&q.branch!==activeBranch)return false
    if(role==='staff'&&dentistFilter!=='All Dentists'&&q.dentistId!==dentistFilter)return false
    if (role==='staff'&&queueSearch.trim()) {
      const needle=queueSearch.trim().toLocaleLowerCase()
      const values=[q.patientName||patientName(q.patientId,state.patients),q.patientCode,q.appointmentCode,q.dentistName||dentistName(q.dentistId,state.dentists)]
      if (!values.some(v=>String(v??'').toLocaleLowerCase().includes(needle))) return false
    }
    return matchesStatusFilter(q, statusFilter)
  }).sort(compareBranchQueue)
  // M9: every queue change is a server command (Idempotency-Key per attempt + expected revision); the server computes
  // numbers and positions. A second click while a command is in flight is ignored.
  const flow=store.appointmentFlow
  const [arrivalPhase,setArrivalPhase]=useState('idle'),[arrivalMessage,setArrivalMessage]=useState(''),[arrivalResult,setArrivalResult]=useState(null)
  const arrivalAttempt=useRef(null),arrivalSending=useRef(false),arrivalLive=useRef(false),arrivalFeedback=useRef(null)
  const arrivalLocked=['submitting','unknown'].includes(arrivalPhase)
  React.useLayoutEffect(()=>{arrivalLive.current=true;return()=>{arrivalLive.current=false}},[])
  useEffect(()=>{if(['unknown','refused','verified'].includes(arrivalPhase))arrivalFeedback.current?.focus()},[arrivalPhase])
  const resetArrival=()=>{if(arrivalSending.current||arrivalAttempt.current?.outcome==='unknown')return false;arrivalAttempt.current=null;setArrivalPhase('idle');setArrivalMessage('');return true}
  const submitArrival=async command=>{
    if(!command||arrivalSending.current)return
    arrivalSending.current=true;setArrivalPhase('submitting');setArrivalMessage('')
    try{
      const result=await command.submit()
      if(!arrivalLive.current||arrivalAttempt.current!==command)return
      if(result.outcome==='obsolete'){setArrivalPhase('unknown');setArrivalMessage('Your admission context changed. Review recorded arrivals before starting another admission.');return}
      if(!['unknown','refused','verified'].includes(result.outcome))return
      setArrivalPhase(result.outcome)
      if(!result.ok){setArrivalMessage(result.message||'The arrival was not confirmed. Review the current clinic records.');return}
      if(command.intent.kind==='walkin')setAdmitted(true)
      else{reviewedSelection.current=null;setSelectionContext(null);setAppointmentId('');setIdConfirmed(false)}
      setArrivalResult({...result,actorKey:checkInActorKey(store.session),authGeneration:store.getAuthGeneration?.()})
      setArrivalMessage(result.warning||'')
      toast(result.queued?`Arrival verified — queue number ${result.queueNumber}.`:'Arrival verified.','success')
    }finally{arrivalSending.current=false}
  }
  const queueContext=JSON.stringify([role,activeBranch,clinicDate(),schedulingActorKey(store),dentistFilter,statusFilter])
  const queueOwner=useRequestOwner(queueContext,store.getAuthGeneration),messageOwner=useRequestOwner(queueContext,store.getAuthGeneration)
  const latestQueueStore=useRef(store);latestQueueStore.current=store
  const busy=queueOwner.busy,messageBusy=messageOwner.busy
  const callGate=useRef(commandGate(commandKey)),[callFeedback,setCallFeedback]=useState(null)
  React.useLayoutEffect(()=>{callGate.current=commandGate(commandKey);setCallFeedback(null)},[queueContext])
  const callUncertain=!!callFeedback?.uncertain
  const callPatient=async entry=>{
    const gate=callGate.current
    if(gate.pending||gate.retry&&gate.retry.entry.id!==entry.id)return
    const current=latestQueueStore.current.state.queue.find(row=>row.id===entry.id)
    const same=row=>row&&['visitId','patientPublicId','branchId','dentistId','appointmentId','clinicDate'].every(key=>(row[key]??null)===(entry[key]??null))
    if(!same(current)||!isTodayQueue(current)||!inScope(current,latestQueueStore.current.session,latestQueueStore.current.state)||
      !gate.retry&&(current.revision!==entry.revision||!['Waiting','In Queue'].includes(current.status)))return setCallFeedback({ok:false,message:'This queue entry changed. Refresh before calling.'})
    const ticket=queueOwner.begin();if(!ticket)return
    const owns=()=>queueOwner.current(ticket)&&same(latestQueueStore.current.state.queue.find(row=>row.id===entry.id))
    setCallFeedback(null)
    try{
      const result=await gate.run({entry:Object.freeze({...entry})},async attempt=>{
        const result=await flow.queueCommand(attempt.entry,'call',attempt.keys.start,owns)
        if(!owns())return {ok:false,kind:'stale_context'}
        return result.ok&&!calledEncounterContext(result.row,attempt.entry)?
          {ok:false,uncertain:true,message:'The call receipt did not match this Patient and Visit. Retry the same call to verify it.'}:result
      })
      if(!owns())return
      setCallFeedback({...result,patientName:entry.patientName||patientName(entry.patientId,state.patients),
        uncertain:!!gate.retry,message:result.ok?'Call recorded. The current queue has been refreshed.':result.message||'The call was not confirmed.'})
    }finally{queueOwner.finish(ticket)}
  }
  const run=async(entry,label,send)=>{
    if(callGate.current.retry)return
    const ticket=queueOwner.begin();if(!ticket)return
    try{
      const result=await send(commandKey(),()=>queueOwner.current(ticket))
      if(!queueOwner.current(ticket))return
      toast(result.ok?label:(result.message||'The queue could not be updated. Refresh and try again.'),result.ok?'success':'warning')
    }catch{if(queueOwner.current(ticket))toast('The queue action could not be confirmed. Refresh the queue before retrying.','warning')}
    finally{queueOwner.finish(ticket)}
  }
  const update=(entry,name,label)=>name==='call'?callPatient(entry):run(entry,label,(key,owns)=>flow.queueCommand(entry,name,key,owns))
  const openMessage=async entry=>{
    const ticket=messageOwner.begin();if(!ticket)return
    const owns=()=>messageOwner.current(ticket)&&latestQueueStore.current.state.queue.some(row=>row.id===entry.id&&
      ['patientPublicId','patientCode','branchId','dentistId'].every(key=>row[key]===entry[key])&&isTodayQueue(row)&&inScope(row,latestQueueStore.current.session,latestQueueStore.current.state))
    try{
      const result=await findPatientConversation(entry.patientPublicId,entry.branchId,entry.patientCode,owns)
      if(!owns())return
      if(!result.ok)return toast(result.message||'Conversations could not be checked. Try again.','warning')
      if(!result.conversation)return toast('No accessible conversation for this patient at this branch. Ask the patient to start a message from their portal.','warning')
      setPage('messages',{conversationId:result.conversation.id,conversation:result.conversation,patientCode:entry.patientCode,patientPublicId:entry.patientPublicId,branchId:entry.branchId})
    }catch{if(owns())toast('Conversations could not be checked. Try again.','warning')}
    finally{messageOwner.finish(ticket)}
  }
  const [orderEntry,setOrderEntry]=useState(null)
  const [restoreModalEntry, setRestoreModalEntry] = useState(null)
  const restore = entry => {
    setRestoreModalEntry(entry)
  }
  const submitRestore = (entry, reason) => {
    setRestoreModalEntry(null)
    run(entry, 'Late-arrival flag cleared. Arrival order is unchanged.', key => flow.queueRestoreOrder(entry, reason.trim(), key))
  }
  const operational=['staff','owner'].includes(role)
  const vis=useQueueVisibility(store)
  const demo=vis.mode==='demo'
  useVisibleRefresh(flow?.refresh,{active:role!=='patient'})
  if (role==='patient') return <PatientQueuePage store={store} setPage={setPage}/>
  return <>
    <PageHeader title={role==='dentist'?'My Patient Queue':'Patient Queue'} text={role==='owner'?'Review branch arrival order and recorded queue changes.':'Call the next patient or open their branch conversation.'} aside={role==='staff'?undefined:<RefreshButton onClick={()=>flow?.refresh()}/>}/>
    <FilterBar ariaLabel={role==='dentist'?'My queue filters':'Queue filters'} onClear={!busy&&!callUncertain&&(dentistFilter!=='All Dentists'||statusFilter!=='Active'||queueSearch)?()=>{setDentistFilter('All Dentists');setStatusFilter('Active');setQueueSearch('')}:null}>
      {role==='staff'&&<label className="staff-r15-queue-search">Search <input type="search" value={queueSearch} onChange={e=>setQueueSearch(e.target.value)} placeholder="Patient, ID, appointment…" aria-label="Search loaded authorized queue entries" disabled={!!busy||callUncertain}/></label>}
      {role!=='staff'&&<label>Branch <select value={activeBranch} disabled><option>{activeBranch}</option></select></label>}
      {role!=='dentist'&&<label>Dentist <select disabled={busy||callUncertain} value={dentistFilter} onChange={e=>setDentistFilter(e.target.value)}><option>All Dentists</option>{state.dentists.filter(d=>role==='owner'||d.branchIds.includes(session.branchId)).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
      <label>Status <select disabled={busy||callUncertain} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="Active">Active</option><option value="All">All</option><option value="In Queue">In Queue</option><option value="In Treatment">In Treatment</option><option value="Done">Done</option></select></label>
    </FilterBar>
    <AppointmentsLoadNotice store={store}/>
    {callFeedback&&<div role={callFeedback.ok?'status':'alert'}><Notice tone={callFeedback.ok?'success':'warning'} title={callFeedback.patientName?`Queue call: ${callFeedback.patientName}`:'Queue call'}>
      {callFeedback.message}
      {callUncertain&&<Button disabled={busy} onClick={()=>callPatient(callGate.current.retry.entry)}>Retry same call</Button>}
    </Notice></div>}
    <div ref={arrivalFeedback} tabIndex={-1} role={['unknown','refused'].includes(arrivalPhase)?'alert':'status'}>
      {arrivalPhase==='submitting'&&<p>Recording the reviewed arrival…</p>}
      {arrivalMessage&&<p>{arrivalMessage}</p>}
      {arrivalPhase==='unknown'&&<><Button onClick={()=>submitArrival(arrivalAttempt.current)}>Retry the same arrival</Button><p>Details stay protected. After reload or sign-in, review today’s recorded arrivals before starting another admission.</p></>}
      {arrivalPhase==='refused'&&<Button onClick={()=>{if(resetArrival())flow?.refresh()}}>Review arrival details</Button>}
      {arrivalResult&&arrivalResult.actorKey===checkInActorKey(store.session)&&arrivalResult.authGeneration===store.getAuthGeneration?.()&&<Notice tone="success" title="Arrival receipt">
        {arrivalResult.patientName}: visit {arrivalResult.visitId}{arrivalResult.queued?` · Queue ${arrivalResult.queueNumber}`:' · No Dentist queue assigned'}. This confirms arrival, not treatment completion.
        {setPage&&<Button variant="soft" onClick={()=>setPage('queue')}>Open live queue</Button>}
      </Notice>}
    </div>
    {!demo&&<QueueStatusCounts store={store} activeBranch={role==='staff'?state.branches.find(b=>b.id===session?.branchId)?.name:role==='owner'?activeBranch:'All Branches'} vis={vis}/>}
    {operational&&!demo&&<SelfRegistered toast={toast} store={store} compact/>}
    {role==='staff'&&<details className="staff-r11-queue-guidance"><summary>Status meanings</summary><p>Served means treatment has started. No-show is managed in Appointments.</p></details>}
    <Card title={role==='staff'?undefined:'Live queue'} className="top-gap queue-live-card">
      {role==='staff' && !!queueSearch.trim() && !visible.length && <p className="staff-r15-no-results" role="status">No loaded queue entries match your search. Clear search to view the queue.</p>}
      <QueueTable rows={visible} onOpen={q=>setPage('patients',encounterContext(q))} nameOf={q=>q.patientName||patientName(q.patientId,state.patients)} columns={[
        {key:'queueNumber',label:'Queue',render:q=><div className="queue-order"><b className="queue-number"><span className="sr-only">Queue number </span>{q.queueNumber||'—'}</b><span className="queue-secondary queue-rank">Branch {q.branchPosition??'—'}<span aria-hidden="true"> · </span>Dentist {q.position??'—'}</span></div>},
        {key:'patient',label:'Patient',render:q=><div className="queue-identity">
          <div>
            <button type="button" className="queue-patient-link" title="Click to open patient chart" aria-label={`Open chart for ${q.patientName||patientName(q.patientId,state.patients)}`} onClick={()=>setPage('patients',encounterContext(q))}><b>{q.patientName||patientName(q.patientId,state.patients)}</b></button>
          </div>
          <small className="queue-secondary queue-patient-meta">{q.patientCode&&<span>{q.patientCode}</span>}<span>{q.appointmentCode||(q.walkIn?'Walk-in visit':'Scheduled visit')}</span></small>
          {q.lateArrival&&<span className="fd-badge is-late">Late arrival · arrival order retained</span>}
        </div>},
        {key:'careTeam',label:'Dentist / Branch',render:q=><div className="queue-care-team"><b>{q.dentistName||dentistName(q.dentistId,state.dentists)}</b><span className="queue-secondary">{q.branch}</span></div>},
        {key:'checkedIn',label:'Checked in',render:q=>displayTime(q.checkedIn)},
        ...(demo?[{key:'wait',label:'Est. wait (demo)',render:q=>`${queueWaitEstimate(q,state.queue,state.appointments,state.treatments,state.dentists)} min` }]:[]),
        {key:'status',label:'Status',render:q=><div className="queue-status"><Status>{q.displayStatus||q.status}</Status></div>},
        {key:'actions',label:'Actions',render:q=><div className="row-actions queue-actions" onClick={e=>e.stopPropagation()}>
          {['In Queue', 'Waiting'].includes(q.status)&&(operational||role==='dentist')&&<button type="button" className="icon-btn staff-icon-action queue-call-btn" title="Call patient in queue" aria-label={`Call patient ${q.patientName||patientName(q.patientId,state.patients)} in queue`} disabled={!!busy||callUncertain} onClick={()=>update(q,'call','Patient called in queue.')}><Icon name="phone" size={16}/><span className={role==='staff'?'sr-only':''}>Call</span></button>}
          {['staff','dentist'].includes(role)&&<button type="button" className="icon-btn staff-icon-action queue-message-btn" title="Open patient conversation" aria-label={`Open conversation with ${q.patientName||patientName(q.patientId,state.patients)}`} disabled={!!messageBusy} onClick={()=>openMessage(q)}><Icon name="message" size={16}/><span className="sr-only">Message</span></button>}
          {role==='dentist'&&(['In Queue', 'Waiting', 'Called', 'Treatment Ready'].includes(q.status)||q.status==='Served'||q.visitStatus==='In Treatment')&&<Button size="sm" onClick={()=>setPage('treatment',encounterContext(q))}>{q.treatmentId?'Continue Treatment':'Open Treatment'}</Button>}

          {operational&&<>
            {q.server&&['In Queue','Waiting'].includes(q.status)&&<Button size="sm" variant="soft" disabled={!!busy||callUncertain} onClick={()=>setOrderEntry(q)}>Move</Button>}
            {active(q)&&q.lateArrival&&<Button size="sm" variant="ghost" disabled={!!busy||callUncertain} onClick={()=>restore(q)}>Clear late flag</Button>}
          </>}
        </div>}

      ]}/>
    </Card>
    {orderEntry&&<QueueOrderDialog entry={orderEntry} store={store} onClose={()=>setOrderEntry(null)}/>}
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
          Priority records operational context. It does not change arrival order. An explicit queue move needs a separate reason and current-order review. Do not record ID numbers or sensitive medical details here.
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
    <Modal open title="Clear late-arrival flag" subtitle="Arrival time and queue order stay unchanged" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <Field label="Reason for clearing late flag" required hint="Required for audit and operational records.">
          <input
            type="text"
            required
            placeholder="Reason for clearing this late-arrival flag..."
            value={reason}
            onChange={e => setReason(e.target.value)}
            autoFocus
          />
        </Field>
        <div className="row-actions" style={{ marginTop: '20px' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!reason.trim()}>Clear late flag</Button>
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
  if(vis.mode!=='demo'){
    const staff=store.session?.role==='staff'
    const assigned=staff?store.state.branches.find(b=>b.id===store.session.branchId):null
    if(staff&&!assigned)return <><PageHeader title="Queue"/><Notice tone="warning">Your assigned branch is unavailable. Refresh or contact the clinic Owner.</Notice></>
    const branch=staff?assigned.name:activeBranch
    return <>
      <PageHeader title="Branch queue"/>
      {staff?<QueueStatusCounts store={store} activeBranch={branch} vis={vis}/>:<QueueByBranch store={store} activeBranch={branch} vis={vis} title="Today’s queue"/>}
      <BranchQueueDetailSection store={store} activeBranch={branch} setPage={setPage}/>
    </>
  }
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
    if (store.session?.role === 'staff' && (!store.session.branchId || q.branchId !== store.session.branchId || !inScope(q,store.session,state))) return false
    if (selectedBranchId !== 'All' && q.branchId !== selectedBranchId && q.branch !== selectedBranchId) return false
    if (activeBranch !== 'All Branches' && q.branch !== activeBranch) return false
    return matchesOwnerFilter(q, statusFilter)
  }).sort(compareBranchQueue)

  return (
    <Card
      className="top-gap"
      title="Queue entries"
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
          ...(store.session?.role === 'staff' ? [] : [{ key: 'branch', label: 'Branch', render: q => q.branch || 'Main' }]),
          { key: 'time', label: 'Time / Arrival', render: q => <small className="block-muted">{displayTime(q.time || q.start || q.arrival)}</small> },
          { key: 'status', label: 'Status', render: q => <Status>{displayQueueStatus(q)}</Status> },
          { key: 'action', label: 'Actions', render: q => <div className="row-actions">
            {['In Queue', 'Waiting'].includes(q.status) && (
              <button
                type="button"
                className="icon-btn staff-icon-action queue-call-btn"
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

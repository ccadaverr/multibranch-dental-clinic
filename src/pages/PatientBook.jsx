import React, { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Field, Notice, PageHeader, ShellActionsContext } from '../components.jsx'
import { addDays, clinicDate } from '../clock.js'
import { dateLabel, displayTime, uid } from '../logic.js'
import { commandKey, fetchAvailability, fetchRecommendation } from '../appointments-api.js'
import { flattenSlots, useDayAvailability, useWindowAvailability } from '../booking-availability.js'
import { bookingExitOutcome, buildDateStrip, draftStatus, groupSlotsByPeriod, patientBookingDraft, patientContext, servicesAt } from '../patient-view.js'
import { ChoiceGroup, DateStrip, DefinitionList, TimeSlotGroup } from '../patient-ui.jsx'

// Patient online booking (M6, server-authoritative). Laravel/PostgreSQL decides every rule: the booking window
// (tomorrow through one calendar month after tomorrow), the hourly start grid, Dentist eligibility and the
// deterministic Dentist assignment. Every date/time offered here comes from GET /api/appointments/availability or
// /recommendation, a suggestion reserves nothing, and the create command validates everything again. No Dentist choice
// is offered to the Patient. Payment preference is not collected here (it belongs to M11).

const NO_ACCOUNT=<Notice tone="warning" title="We couldn’t confirm your account">Reopen your workspace, or ask the clinic to check your account access.</Notice>
const emptyForm={branchId:'',serviceId:'',date:'',start:'',dentistId:'',dentist:''}
const draftCommandId=()=>uid('draft-save')
const STRIP_DAYS=14

function DraftBanner({ status, onResume, onDiscard }) {
  if(!status||!status.hasProgress)return null
  return <Notice tone="info" title="You have a booking in progress">
    <div className="row-actions top-gap">
      <Button size="sm" onClick={onResume}>Resume booking</Button>
      <Button size="sm" variant="ghost" onClick={onDiscard}>Discard</Button>
    </div>
  </Notice>
}

// A quiet, non-interactive progress indicator computed from the current stage.
const SMART_STEP_LABELS=['Service','Branch','Options','Review']
const MANUAL_STEP_LABELS=['Branch','Service','Date','Time','Review']
const SMART_STAGE_INDEX={'smart-service':0,'smart-branch':1,'smart-schedule':2,review:3}
const MANUAL_STAGE_INDEX={'manual-branch':0,'manual-service':1,'manual-date':2,'manual-time':3,review:4}
function BookProgress({ mode, stage }) {
  if(!mode||stage==='mode')return null
  const labels=mode==='smart'?SMART_STEP_LABELS:MANUAL_STEP_LABELS
  const current=(mode==='smart'?SMART_STAGE_INDEX:MANUAL_STAGE_INDEX)[stage]??0
  return <ol className="pt-book-progress" aria-label="Booking progress">
    {labels.map((label,index)=><li key={label} className={index<current?'is-done':index===current?'is-current':''} aria-current={index===current?'step':undefined}>
      <span className="pt-book-progress-dot" aria-hidden="true">{index<current?'✓':index+1}</span>
      <span className="pt-book-progress-label">{label}</span>
    </li>)}
  </ol>
}

function ModeChoice({ onChoose }) {
  return <div className="pt-book-modes" role="group" aria-label="How would you like to book?">
    <button type="button" className="pt-book-mode pt-book-mode-primary" onClick={()=>onChoose('smart')}>
      <span className="pt-book-mode-icon" aria-hidden="true">✦</span>
      <span className="pt-book-mode-eyebrow">Smart Find</span>
      <h2>Find the earliest available visit</h2>
      <p>We check real Dentist availability and suggest the earliest open time.</p>
    </button>
    <button type="button" className="pt-book-mode" onClick={()=>onChoose('manual')}>
      <span className="pt-book-mode-icon" aria-hidden="true">▤</span>
      <span className="pt-book-mode-eyebrow">Manual Appointment</span>
      <h2>Choose the branch, service, date and time yourself.</h2>
      <p>A Dentist is still assigned automatically based on availability.</p>
    </button>
  </div>
}

function StageHeader({ eyebrow, title, help, headingRef }) {
  return <div className="pt-stage-copy"><p className="pt-eyebrow">{eyebrow}</p><h2 ref={headingRef} tabIndex={-1}>{title}</h2>{help&&<p>{help}</p>}</div>
}

const Loading=({children})=><p className="pt-hint" role="status">{children}</p>
const LoadError=({message,onRetry})=><Notice tone="warning" title="Availability couldn’t be loaded">{message} <Button size="sm" variant="ghost" onClick={onRetry}>Try again</Button></Notice>

function ServiceStep({ services, serviceId, onPick, onBack, onContinue, headingRef, stepLabel }) {
  return <>
    <StageHeader eyebrow={stepLabel} title="What can we help you with?" headingRef={headingRef}/>
    {services.length?<ChoiceGroup legend="Service" name="book-service" value={serviceId} onChange={onPick}
      options={services.map(s=>({value:s.id,label:s.name,descriptionLabel:'Estimated time',description:`About ${s.duration} min`,meta:s.category}))}/>
      :<Notice tone="warning" title="No services available">No services are currently available here. Go back and choose again.</Notice>}
    <div className="pt-stage-footer">{onBack?<Button variant="ghost" onClick={onBack}>Back</Button>:<span/>}<Button icon="arrow" onClick={onContinue} disabled={!serviceId||!services.some(s=>s.id===serviceId)}>Continue</Button></div>
  </>
}

// Smart Find step 2: only branches the server says offer this service. "Use my location" appears only when the
// server reports real branch coordinates; otherwise location ranking stays unavailable and the Patient chooses.
function SmartBranchStep({ state, serviceId, branchId, onPick, onBack, onContinue, headingRef }) {
  const [lookup,setLookup]=useState({status:'loading',branches:[],error:''})
  const [locationState,setLocationState]=useState('idle')
  const load=()=>{setLookup({status:'loading',branches:[],error:''});fetchRecommendation({serviceId}).then(result=>setLookup(result.ok?{status:'ready',branches:result.eligibleBranches,error:''}:{status:'error',branches:[],error:result.message}))}
  useEffect(load,[serviceId])
  const locatable=lookup.branches.some(b=>b.hasCoordinates)
  const useLocation=()=>{
    if(typeof navigator==='undefined'||!navigator.geolocation){setLocationState('unsupported');return}
    setLocationState('requesting')
    navigator.geolocation.getCurrentPosition(
      position=>fetchRecommendation({serviceId,coords:{lat:position.coords.latitude,lng:position.coords.longitude}}).then(result=>{
        if(result.ok&&result.locationRanking==='distance'&&result.recommendation){onPick(result.recommendation.branchId);setLocationState('found')}
        else setLocationState('unavailable')
      }),
      ()=>setLocationState('denied'),
      {timeout:8000},
    )
  }
  const options=lookup.branches.map(b=>{const branch=state.branches.find(x=>x.id===b.id);return {value:b.id,label:b.name,description:branch?`${branch.city} • Confirm opening hours with the clinic`:undefined}})
  const chosen=lookup.branches.find(b=>b.id===branchId)
  return <>
    <StageHeader eyebrow="Smart Find · Step 2 of 3" title="Which branch works for you?" headingRef={headingRef}
      help={locatable?"You can use your location to suggest the nearest branch, or choose one yourself. Nothing is collected unless you choose to share it.":"Choose a branch that offers this service."}/>
    {lookup.status==='loading'&&<Loading>Checking which branches offer this service…</Loading>}
    {lookup.status==='error'&&<LoadError message={lookup.error} onRetry={load}/>}
    {locatable&&<div className="pt-location-row">
      <Button variant="soft" icon="building" onClick={useLocation} disabled={locationState==='requesting'}>{locationState==='requesting'?'Finding your location…':'Use my location'}</Button>
      {locationState==='unavailable'&&<p className="pt-hint">We can’t determine your nearest branch right now — choose one below.</p>}
      {locationState==='denied'&&<p className="pt-hint">Location wasn’t shared — choose a branch below.</p>}
      {locationState==='unsupported'&&<p className="pt-hint">Your browser doesn’t support location — choose a branch below.</p>}
      {locationState==='found'&&chosen&&<p className="pt-hint">Nearest branch with availability: <b>{chosen.name}</b>. You can change this below.</p>}
    </div>}
    {lookup.status==='ready'&&(options.length?<ChoiceGroup legend="Branch" name="smart-branch" value={branchId} onChange={onPick} options={options}/>
      :<Notice tone="warning" title="No branch offers this service">Go back and choose another service.</Notice>)}
    <div className="pt-stage-footer"><Button variant="ghost" onClick={onBack}>Back</Button><Button icon="arrow" onClick={onContinue} disabled={!branchId||!options.some(o=>o.value===branchId)}>Continue</Button></div>
  </>
}

// Smart Find step 3: the server's earliest valid suggestion (reserves nothing), plus other real times day by day.
function SmartScheduleStep({ form, onPick, onBack, onContinue, headingRef }) {
  const [suggestion,setSuggestion]=useState({status:'loading',value:null,error:'',rules:null})
  const load=()=>{setSuggestion({status:'loading',value:null,error:'',rules:null});fetchRecommendation({serviceId:form.serviceId,branchId:form.branchId}).then(result=>setSuggestion(result.ok?{status:'ready',value:result.recommendation,error:'',rules:result.rules}:{status:'error',value:null,error:result.message,rules:null}))}
  useEffect(load,[form.serviceId,form.branchId])
  const firstDate=suggestion.rules?.firstDate||addDays(clinicDate(),1)
  const window=useWindowAvailability({branchId:form.branchId,serviceId:form.serviceId,startDate:firstDate,days:STRIP_DAYS,enabled:suggestion.status==='ready'})
  const results=flattenSlots(window.byDate)
  const [selectedDate,setSelectedDate]=useState(null)
  const strip=useMemo(()=>buildDateStrip(results,firstDate,STRIP_DAYS,clinicDate()),[results,firstDate])
  const activeDate=selectedDate||form.date||results[0]?.date||null
  const dayResults=activeDate?results.filter(r=>r.date===activeDate):[]
  const grouped=groupSlotsByPeriod(dayResults)
  const best=suggestion.value
  return <>
    <StageHeader eyebrow="Smart Find · Step 3 of 3" title="Real availability, found for you" headingRef={headingRef}
      help="Suggestions come from the clinic’s live schedule. A time is only reserved once you confirm."/>
    {suggestion.status==='loading'&&<Loading>Finding the earliest available time…</Loading>}
    {suggestion.status==='error'&&<LoadError message={suggestion.error} onRetry={load}/>}
    {suggestion.status==='ready'&&!best&&<Notice tone="warning" title="No open times right now">No open times were found for this service at this branch within the online booking window. Go back and try another branch or service.</Notice>}
    {best&&<div className="pt-smart-explorer">
      <Notice tone="info" title={`Earliest available: ${dateLabel(best.date)} at ${displayTime(best.start)}`}>
        {best.dentist?`${best.dentist} is currently available. `:''}This suggestion is not reserved — the clinic confirms availability when you book.
        <div className="row-actions top-gap"><Button size="sm" onClick={()=>{setSelectedDate(best.date);onPick({date:best.date,start:best.start,dentistId:best.dentistId,dentist:best.dentist})}}>Choose this time</Button></div>
      </Notice>
      <p className="pt-card-label">Other times</p>
      {window.status==='loading'&&<Loading>Loading other times…</Loading>}
      {window.status==='error'&&<LoadError message={window.error} onRetry={window.reload}/>}
      {window.status==='ready'&&<>
        <DateStrip days={strip} value={activeDate} onChange={setSelectedDate}/>
        {dayResults.length?[['Morning',grouped.morning],['Afternoon',grouped.afternoon],['Evening',grouped.evening]].map(([label,slots])=><TimeSlotGroup key={label} legend={label}
          value={form.date===activeDate?form.start:''} onPick={value=>onPick(dayResults.find(r=>r.start===value))}
          slots={slots.map(r=>({value:r.start,label:displayTime(r.start)}))}/>)
          :<Notice tone="warning" title="No open times on this date">Choose a different date above, or use Manual Appointment to pick a later date.</Notice>}
      </>}
    </div>}
    <div className="pt-stage-footer"><Button variant="ghost" onClick={onBack}>Back</Button><Button icon="arrow" onClick={onContinue} disabled={!form.start}>Continue</Button></div>
  </>
}

function DateStep({ form, onChange, onBack, onContinue, headingRef }) {
  const firstDate=addDays(clinicDate(),1)
  const window=useWindowAvailability({branchId:form.branchId,serviceId:form.serviceId,startDate:firstDate,days:STRIP_DAYS})
  const days=useMemo(()=>buildDateStrip(flattenSlots(window.byDate),firstDate,STRIP_DAYS,clinicDate()),[window.byDate,firstDate])
  const rules=window.rules
  return <>
    <StageHeader eyebrow="Manual booking · Step 3 of 4" title="Pick a date" headingRef={headingRef}
      help={rules?.lastDate?`You can book online from ${dateLabel(rules.firstDate)} through ${dateLabel(rules.lastDate)}.`:undefined}/>
    {window.status==='loading'&&<Loading>Checking open dates…</Loading>}
    {window.status==='error'&&<LoadError message={window.error} onRetry={window.reload}/>}
    {window.status==='ready'&&<div className="pt-manual-dates"><p className="pt-card-label">Open dates in the next two weeks</p><DateStrip days={days} value={form.date} onChange={onChange}/></div>}
    <Field label="Choose another date"><input type="date" min={rules?.firstDate||firstDate} max={rules?.lastDate||undefined} value={form.date} onChange={event=>onChange(event.target.value)}/></Field>
    <div className="pt-stage-footer"><Button variant="ghost" onClick={onBack}>Back</Button><Button icon="arrow" onClick={onContinue} disabled={!form.date}>Continue</Button></div>
  </>
}

function TimeStep({ form, onPick, onBack, onContinue, headingRef }) {
  const day=useDayAvailability({branchId:form.branchId,serviceId:form.serviceId,date:form.date})
  const grouped=groupSlotsByPeriod(day.slots)
  return <>
    <StageHeader eyebrow="Manual booking · Step 4 of 4" title={`Available times on ${dateLabel(form.date)}`} headingRef={headingRef}
      help="Only times the clinic’s live schedule can accept are shown. A Dentist is assigned automatically."/>
    {day.status==='loading'&&<Loading>Loading available times…</Loading>}
    {day.status==='error'&&<LoadError message={day.error} onRetry={day.reload}/>}
    {day.status==='ready'&&(day.slots.length?[['Morning',grouped.morning],['Afternoon',grouped.afternoon],['Evening',grouped.evening]].map(([label,slots])=><TimeSlotGroup key={label} legend={label} value={form.start}
      onPick={value=>onPick(day.slots.find(r=>r.start===value))}
      slots={slots.map(r=>({value:r.start,label:displayTime(r.start)}))}/>)
      :<Notice tone="warning" title="No open times">There are no online booking times on {dateLabel(form.date)}. Try another date.</Notice>)}
    <div className="pt-stage-footer"><Button variant="ghost" onClick={onBack}>Back</Button><Button icon="arrow" onClick={onContinue} disabled={!form.start||!day.slots.some(r=>r.start===form.start)}>Continue</Button></div>
  </>
}

function ReviewStep({ state, mode, form, notes, onNotes, onBack, onConfirm, onPickAlternative, failure, confirming, headingRef }) {
  const branch=state.branches.find(b=>b.id===form.branchId)
  const service=state.services.find(s=>s.id===form.serviceId)
  return <>
    <StageHeader eyebrow="Review" title="Review your appointment" headingRef={headingRef}/>
    <DefinitionList items={[
      {label:'Booking mode',value:mode==='smart'?'Smart Find':'Manual booking'},
      {label:'Branch',value:branch?.name},
      {label:'Service',value:service?.name},
      {label:'Date',value:form.date?dateLabel(form.date):null},
      {label:'Time',value:form.start?displayTime(form.start):null},
      {label:'Dentist',value:form.dentist?`${form.dentist} (currently available)`:'Assigned when you confirm'},
    ]}/>
    <div className="pt-booking-payment-guidance">
      <strong>Pay online when available</strong>
      <p>Online payment can reduce time spent paying the booking fee at the clinic. The slot is held temporarily during checkout; confirmation depends on verified payment. You still need to check in when you arrive.</p>
      <p>Check the branch, date, time and service before continuing. Cancellation and rescheduling follow clinic policy. Refunds depend on eligibility and verified payment status, and are not guaranteed.</p>
    </div>
    <Field label="Optional note"><textarea value={notes} placeholder="Anything the clinic should know before your visit?" onChange={event=>onNotes(event.target.value)}/></Field>
    {failure&&<Notice tone="danger" title="This time couldn’t be booked">{failure.message}
      {!!failure.alternatives?.length&&<div className="row-actions top-gap" role="group" aria-label="Other times on this date">{failure.alternatives.map(time=><Button key={time} size="sm" variant="soft" onClick={()=>onPickAlternative(time)}>{displayTime(time)}</Button>)}</div>}
    </Notice>}
    <div className="pt-stage-footer">
      <Button variant="ghost" onClick={onBack}>{failure?.kind==='conflict'?'Choose another time':'Back'}</Button>
      <Button icon="checkin" onClick={onConfirm} disabled={confirming||!form.start}>{confirming?'Processing…':'Confirm & pay'}</Button>
    </div>
  </>
}

export function PatientBookingPage({ store, setPage, context }) {
  const { state, actions, toast }=store
  const session=store.session
  const shellActions=useContext(ShellActionsContext)
  const headingRef=useRef(null), moved=useRef(false)
  // One Idempotency-Key per confirm attempt: reused if the same attempt is retried, renewed whenever the choice changes.
  const confirmKey=useRef(commandKey())
  const autoResumedRef=useRef(false)
  const [mode,setMode]=useState(null) // null | 'smart' | 'manual'
  const [stage,setStage]=useState('mode')
  const [form,setFormState]=useState(emptyForm)
  const [notes,setNotes]=useState('')
  const [failure,setFailure]=useState(null)
  const [confirming,setConfirming]=useState(false)
  const [confirmed,setConfirmed]=useState(null)
  const [resumeDismissed,setResumeDismissed]=useState(false)
  useEffect(()=>{if(moved.current)headingRef.current?.focus();moved.current=true},[stage,confirmed])
  const setForm=next=>{confirmKey.current=commandKey();setFailure(null);setFormState(next)}

  const draft=patientBookingDraft(state,session)
  const status=draft?draftStatus(state,session,draft):null
  const persistenceError=store.persistenceErrors?.bookingDrafts||null
  const save=patch=>actions.saveBookingDraft(patch,draftCommandId())
  const change=(key,value)=>setForm(previous=>({...previous,[key]:value}))
  const openBranches=state.branches.filter(b=>b.status==='Open')
  const smartServices=useMemo(()=>{const seen=new Map();for(const b of openBranches)for(const s of servicesAt(state,b.id))seen.set(s.id,s);return [...seen.values()]},[state.branches,state.services,state.branchServices])

  // A resumed draft is revalidated against the server before any saved date/time is reused.
  const resumeDraft=async()=>{
    setResumeDismissed(true)
    const issues=[...status.issues]
    let slot=null
    if(status.branch&&status.service&&draft.date&&draft.start&&status.slotValid!==false){
      const day=await fetchAvailability({branchId:draft.branchId,serviceId:draft.serviceId,date:draft.date})
      slot=day.ok?day.slots.find(s=>s.start===draft.start)||null:null
      if(!slot)issues.push(day.ok&&day.rules.firstDate&&(draft.date<day.rules.firstDate||draft.date>day.rules.lastDate)
        ?'Your saved date is outside the online booking window. Choose another date.':'Your saved time is no longer available. Choose another time.')
    }
    const draftMode=draft.mode||'manual'
    const nextForm={...emptyForm,branchId:status.branch?draft.branchId:'',serviceId:status.branch&&status.service?draft.serviceId:'',
      date:slot?draft.date:(draftMode==='manual'&&status.branch&&status.service?draft.date||'':''),start:slot?.start||'',dentistId:slot?.dentistId||'',dentist:slot?.dentist||''}
    setForm(nextForm);setMode(draftMode)
    if(issues.length)toast(issues.join(' '),'warning')
    if(draftMode==='smart')setStage(!nextForm.serviceId?'smart-service':!nextForm.branchId?'smart-branch':slot?'review':'smart-schedule')
    else setStage(!nextForm.branchId?'manual-branch':!nextForm.serviceId?'manual-service':!nextForm.date?'manual-date':!nextForm.start?'manual-time':'review')
  }
  const discardDraft=()=>{actions.discardBookingDraft(uid('draft-discard'));setResumeDismissed(true)}

  // Lets Shell observe an in-app Patient navigation honestly — never blocks it.
  useEffect(()=>{
    if(!shellActions?.registerPatientNavListener)return undefined
    const listener=()=>{
      const outcome=bookingExitOutcome(stage,!!status?.hasProgress,!!confirmed,persistenceError)
      if(outcome)toast(outcome.message,outcome.tone)
    }
    shellActions.registerPatientNavListener(listener)
    return ()=>shellActions.registerPatientNavListener(null)
  },[shellActions,stage,status?.hasProgress,confirmed,persistenceError])

  useEffect(()=>{
    if(context?.resume&&!autoResumedRef.current&&status?.hasProgress){
      autoResumedRef.current=true
      resumeDraft()
    }
  },[context?.resume,status?.hasProgress])

  if(!patientContext(state,session))return NO_ACCOUNT

  // An upstream choice always invalidates every downstream one, in the draft as well as local state.
  const chooseMode=next=>{setMode(next);setForm(emptyForm);setStage(next==='smart'?'smart-service':'manual-branch');save({mode:next,branchId:null,serviceId:null,date:null,start:null})}
  const back=to=>{setFailure(null);setStage(to)}
  const pickSlot=option=>{setForm(previous=>({...previous,date:option.date,start:option.start,dentistId:option.dentistId||'',dentist:option.dentist||''}));save({date:option.date,start:option.start})}

  const confirm=async()=>{
    setConfirming(true);setFailure(null)
    const result=await store.appointmentFlow.create({branchId:form.branchId,serviceId:form.serviceId,date:form.date,start:form.start,notes},{key:confirmKey.current})
    setConfirming(false)
    if(!result.ok){
      setFailure(result);toast(result.message,'warning')
      // Someone else took the time (or the choice is no longer valid): a new attempt needs a new key.
      if(result.kind==='conflict'||result.kind==='validation')confirmKey.current=commandKey()
      return
    }
    if (result.row?.checkout_url) {
      toast('Redirecting to PayMongo checkout…', 'info')
      window.location.href = result.row.checkout_url
      return
    }
    if(result.warning)toast(result.warning,'warning')
    toast('Appointment confirmed.','success');setConfirmed(result.record)
  }
  const reset=()=>{confirmKey.current=commandKey();setConfirmed(null);setFailure(null);setMode(null);setFormState(emptyForm);setNotes('');setStage('mode')}

  if(confirmed){
    const branch=state.branches.find(b=>b.id===confirmed.branchId)
    return <div className="pt-page is-wide"><section className="pt-success motion-in" aria-labelledby="book-done">
      <p className="pt-eyebrow">Appointment confirmed</p><h2 id="book-done" ref={headingRef} tabIndex={-1}>You’re all set.</h2>
      <p>{confirmed.service} on {dateLabel(confirmed.date)} at {displayTime(confirmed.start)} in {branch?.name||'the clinic'}.</p>
      <DefinitionList items={[{label:'Dentist',value:confirmed.dentistName||null},{label:'Confirmation',value:confirmed.appointmentNo}]}/>
      <div className="row-actions"><Button icon="calendar" onClick={()=>setPage?.('appointments',{entityId:confirmed.id})}>View my visits</Button><Button variant="soft" onClick={reset}>Book another visit</Button></div>
    </section></div>
  }

  const timeStage=mode==='smart'?'smart-schedule':'manual-time'
  return <div className="pt-page is-wide pt-book-flow">
    <PageHeader kicker="Online booking" title="Book your visit" text="Choose an available slot. Online payment, when available, confirms your booking after the provider verifies payment."/>
    {!resumeDismissed&&stage==='mode'&&<DraftBanner status={status} onResume={resumeDraft} onDiscard={discardDraft}/>}
    {stage==='mode'&&<ModeChoice onChoose={chooseMode}/>}
    <BookProgress mode={mode} stage={stage}/>
    <section className="pt-stage motion-in" aria-live="polite" key={stage}>
      {stage==='smart-service'&&<ServiceStep services={smartServices} serviceId={form.serviceId} headingRef={headingRef} stepLabel="Smart Find · Step 1 of 3"
        onPick={value=>{setForm({...emptyForm,serviceId:value});save({mode:'smart',serviceId:value,branchId:null,date:null,start:null})}}
        onBack={()=>{setMode(null);setStage('mode')}} onContinue={()=>setStage('smart-branch')}/>}
      {stage==='smart-branch'&&<SmartBranchStep state={state} serviceId={form.serviceId} branchId={form.branchId} headingRef={headingRef}
        onPick={value=>{setForm(previous=>({...emptyForm,serviceId:previous.serviceId,branchId:value}));save({branchId:value,date:null,start:null})}}
        onBack={()=>back('smart-service')} onContinue={()=>setStage('smart-schedule')}/>}
      {stage==='smart-schedule'&&<SmartScheduleStep form={form} headingRef={headingRef} onPick={pickSlot}
        onContinue={()=>setStage('review')} onBack={()=>back('smart-branch')}/>}
      {stage==='manual-branch'&&<>
        <StageHeader eyebrow="Manual booking · Step 1 of 4" title="Which clinic works best for you?" headingRef={headingRef}/>
        <ChoiceGroup legend="Branch" name="manual-branch" value={form.branchId} onChange={value=>{setForm({...emptyForm,branchId:value});save({mode:'manual',branchId:value,serviceId:null,date:null,start:null})}}
          options={openBranches.map(b=>({value:b.id,label:b.name,description:`${b.city} • Confirm opening hours with the clinic`}))}/>
        <div className="pt-stage-footer"><Button variant="ghost" onClick={()=>{setMode(null);setStage('mode')}}>Back</Button><Button icon="arrow" onClick={()=>setStage('manual-service')} disabled={!form.branchId}>Continue</Button></div>
      </>}
      {stage==='manual-service'&&<ServiceStep services={servicesAt(state,form.branchId)} serviceId={form.serviceId} headingRef={headingRef} stepLabel="Manual booking · Step 2 of 4"
        onPick={value=>{setForm(previous=>({...emptyForm,branchId:previous.branchId,serviceId:value}));save({serviceId:value,date:null,start:null})}}
        onBack={()=>back('manual-branch')} onContinue={()=>setStage('manual-date')}/>}
      {stage==='manual-date'&&<DateStep form={form} headingRef={headingRef}
        onChange={value=>{setForm(previous=>({...previous,date:value,start:'',dentistId:'',dentist:''}));save({date:value,start:''})}}
        onBack={()=>back('manual-service')} onContinue={()=>setStage('manual-time')}/>}
      {stage==='manual-time'&&<TimeStep form={form} headingRef={headingRef} onPick={pickSlot}
        onContinue={()=>setStage('review')} onBack={()=>back('manual-date')}/>}
      {stage==='review'&&<ReviewStep state={state} mode={mode} form={form} notes={notes} onNotes={setNotes} headingRef={headingRef}
        onBack={()=>back(timeStage)} onConfirm={confirm} failure={failure} confirming={confirming}
        onPickAlternative={time=>{setForm(previous=>({...previous,start:time,dentistId:'',dentist:''}));save({start:time})}}/>}
    </section>
  </div>
}

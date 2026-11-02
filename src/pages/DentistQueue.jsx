import React, { useEffect, useRef, useState } from 'react'
import { Button, Notice, PageHeader, Status } from '../components.jsx'
import { inScope, isTodayQueue } from '../contracts.js'
import { commandKey } from '../appointments-api.js'
import { commandGate, encounterContextFor, clinicalSessionKey } from '../encounter.js'
import { useClinicalSession } from '../use-clinical-session.js'
import { useVisibleRefresh } from '../use-visible-refresh.js'
import { QueueCountsNotice, useQueueVisibility } from './QueueCounts.jsx'
import { findPatientConversation } from '../messaging-api.js'
import '../encounter-workspace.css'

export function DentistQueue({ store, setPage }) {
  const allowed=useClinicalSession(store)
  if(!allowed)return <Notice title="Clinical session unavailable">Patient information is hidden. Sign in again to open My Queue.</Notice>
  return <Worklist key={clinicalSessionKey(store.session)} store={store} setPage={setPage}/>
}
function Worklist({store,setPage}) {
  const {state,session}=store, flow=store.appointmentFlow
  const [filter,setFilter]=useState('active'), [search,setSearch]=useState(''), [busy,setBusy]=useState(null), [feedback,setFeedback]=useState(null)
  const [messageBusy,setMessageBusy]=useState(false)
  const gate=useRef(commandGate(commandKey)), live=useRef(true), messageLock=useRef(false)
  useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
  const vis=useQueueVisibility(store)
  useVisibleRefresh(flow?.refresh)
  const fresh=vis.mode==='ready' && store.appointmentsStatus==='ready' && !store.appointmentsTruncated
  const own=state.queue.filter(q=>q.server&&inScope(q,session,state)&&isTodayQueue(q))
  const activeTreatments=state.treatments.filter(t=>t.server&&t.author&&t.status==='In Treatment'&&inScope(t,session,state))
  const rows=own.filter(q=> !(q.status==='Served'&&q.visitStatus==='In Treatment') && (filter==='history'?q.visitStatus==='Completed':q.visitStatus!=='Completed'))
    .filter(q=>`${q.patientName||''} ${q.patientCode||''} ${q.queueNumber??''}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b)=>Number(!['Called','Treatment Ready'].includes(a.status))-Number(!['Called','Treatment Ready'].includes(b.status))||(a.position??Infinity)-(b.position??Infinity)||a.queueNumber-b.queueNumber)
  const call=async(entry)=>{
    if(!fresh||gate.current.pending)return
    const current=state.queue.find(q=>q.id===entry.id)
    if(!current||!inScope(current,session,state)||current.revision!==entry.revision)return setFeedback({ok:false,message:'This queue entry changed. Refresh before calling.'})
    setBusy(entry.id);setFeedback(null)
    const result=await gate.current.run({entry},attempt=>flow.queueCommand(attempt.entry,'call',attempt.keys.start))
    if(!live.current)return
    setBusy(null);setFeedback(result.ok?{ok:true,message:'Call confirmed by the clinic server. Open the encounter when the patient is ready.'}:result)
  }
  const openMessage=async entry=>{
    if(messageLock.current)return
    messageLock.current=true;setMessageBusy(true)
    try {
      const result=await findPatientConversation(entry.patientPublicId,entry.branchId,entry.patientCode)
      if(!live.current)return
      if(!result.ok||!result.conversation)return setFeedback({ok:false,message:result.message||'No accessible patient conversation was found at this branch.'})
      setPage('messages',{conversationId:result.conversation.id,conversation:result.conversation,patientPublicId:entry.patientPublicId,branchId:entry.branchId})
    } finally {messageLock.current=false;if(live.current)setMessageBusy(false)}
  }
  const open=record=>setPage('treatment',encounterContextFor(record))
  return <div className="enc-workspace enc-worklist">
    <PageHeader title="My Queue" text="Your assigned encounters, in the clinic's current queue order." aside={<Button variant="soft" onClick={()=>flow?.refresh()}>Refresh queue</Button>}/>
    <QueueCountsNotice vis={vis} store={store}/>
    {feedback&&<Notice tone={feedback.ok?'success':'warning'} title={feedback.ok?'Queue updated':'Command not confirmed'}>{feedback.message}{gate.current.retry&&<Button disabled={!!busy} onClick={()=>call(gate.current.retry.entry)}>Retry same call</Button>}</Notice>}
    {activeTreatments.length>0&&<section className="enc-current" aria-label="Current treatment"><h2>In treatment</h2>{activeTreatments.map(t=><article className="enc-current-row" key={t.id}><div><h3>{t.patientName||state.patients.find(p=>p.id===t.patientId)?.name}</h3><p>{state.branches.find(b=>b.id===t.branchId)?.name} · {t.date} · <Status>{t.status}</Status></p></div><Button onClick={()=>open(t)}>Continue treatment</Button></article>)}</section>}
    <div className="enc-filters"><label>Find patient or queue number<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>Worklist<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="active">Active queue</option><option value="history">Completed today</option></select></label></div>
    <section aria-label={filter==='history'?'Completed encounters':'Assigned worklist'}><h2>{filter==='history'?'Completed today':'Ready and waiting'}</h2>
    {!rows.length&&fresh&&<p role="status">{search?'No patients match this search.':'No encounters in this view.'}</p>}
    {rows.map(q=>{
      const t=state.treatments.find(t=>t.server&&t.visitId===q.visitId&&t.author&&inScope(t,session,state))
      const appointment=state.appointments.find(a=>a.id===q.appointmentId&&inScope(a,session,state))
      const ready=['Called','Treatment Ready'].includes(q.status)
      return <article key={q.id} className="enc-queue-row"><div className="enc-number"><span>Queue</span><b>{q.queueNumber??'Unavailable'}</b></div>
        <div className="enc-queue-identity"><h3>{q.patientName||state.patients.find(p=>p.id===q.patientId)?.name||'Identity unavailable'}</h3><p>{q.patientCode} · {q.walkIn?'Walk-in':'Appointment'}{appointment?.start?` · ${appointment.start}`:''}</p><p>{state.branches.find(b=>b.id===q.branchId)?.name} · {q.service||state.services.find(s=>s.id===q.serviceId)?.name}</p></div>
        <div className="enc-queue-state"><Status>{q.status==='Served'?q.visitStatus:q.status}</Status><small>Visit: {q.visitStatus||'Unavailable'}</small></div>
        <div className="enc-queue-actions">
          {q.status==='Waiting'&&<Button disabled={!fresh||!!busy} onClick={()=>call(q)}>{busy===q.id?'Calling...':'Call patient'}</Button>}
          {ready&&<Button disabled={!fresh||!!busy} onClick={()=>open(q)}>Open encounter</Button>}
          {q.visitStatus==='Completed'&&t&&<Button variant="soft" onClick={()=>open(t)}>View completed record</Button>}
          {!ready&&q.visitStatus!=='Completed'&&<Button variant="ghost" size="sm" onClick={()=>open(q)}>Review encounter</Button>}
          <Button variant="ghost" size="sm" disabled={messageBusy} onClick={()=>openMessage(q)}>Message</Button>
        </div>
      </article>
    })}</section>
  </div>
}

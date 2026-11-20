import React,{useState} from 'react'
import {Button,Status} from '../components.jsx'
import {arrivalReceipt as readReceipt} from '../api-client.js'
import {arrivalReceipt} from '../arrival-command.js'
import {checkInActorKey} from '../checkin-navigation.js'
import {clinicDate} from '../clock.js'
import {inScope} from '../contracts.js'

/** Current scoped Visits are distinct from this account's immutable original arrival receipts. */
export function RecordedArrivals({store}){
 const session=store.session
 if(session?.role!=='staff')return null
 const rows=(store.state.visits||[]).filter(v=>v.server&&v.clinicDate===clinicDate()&&inScope(v,session,store.state))
 return <details className="checkin-arrival-history">
  <summary><span className="checkin-history-label">Recorded arrivals</span><span className="checkin-history-count">{rows.length}</span><span className="checkin-history-hint">Review only when needed</span></summary>
  <div className="checkin-history-body">
    <p className="checkin-history-explainer">Already admitted? Use the original receipt to verify an uncertain outcome before attempting another Check-In. A missing receipt does not prove that an earlier request failed.</p>
    {store.appointmentsStatus!=='ready'?<p role="status">Clinic records are not ready. Refresh to review recorded arrivals.</p>:!rows.length?<p>No recorded arrivals are currently shown for today.</p>:
     <ul className="checkin-history-list">{rows.map(v=><ArrivalReview key={JSON.stringify([v.id,checkInActorKey(session),store.getAuthGeneration?.()])} visit={v} store={store}/>)}</ul>}
  </div>
 </details>
}
function ArrivalReview({visit,store}){
 const [result,setResult]=useState(null),[busy,setBusy]=useState(false)
 const live=React.useRef(false),pending=React.useRef(false),request=React.useRef(null),feedback=React.useRef(null),latest=React.useRef(store);latest.current=store
 React.useLayoutEffect(()=>{live.current=true;return()=>{live.current=false;request.current?.abort()}},[])
 React.useEffect(()=>{if(result)feedback.current?.focus()},[result])
 const review=async()=>{
  if(pending.current)return
  const generation=store.getAuthGeneration?.(),actor=checkInActorKey(store.session)
  const owns=()=>live.current&&Number.isSafeInteger(generation)&&generation===latest.current.getAuthGeneration?.()&&actor===checkInActorKey(latest.current.session)&&inScope(visit,latest.current.session,latest.current.state)
  if(!owns())return
  pending.current=true;setBusy(true);setResult(null)
  const controller=new AbortController();request.current=controller
  const timer=setTimeout(()=>controller.abort(),30000)
  let r
  try{r=await readReceipt(visit.id,{signal:controller.signal})}catch{r=null}finally{clearTimeout(timer)}
  pending.current=false
  if(!owns())return
  setBusy(false)
  const row=r?.data?.data
  const proof=r?.ok&&r.meta?.historical_receipt===true&&row?.id===visit.id?arrivalReceipt(row,{kind:visit.walkIn?'walkin':'scheduled',
   patientPublicId:visit.patientPublicId,branchId:visit.branchId,serviceId:visit.serviceId,dentistId:visit.dentistId,clinicDate:visit.clinicDate,
   appointmentId:visit.appointmentId,expectedRevision:(row.appointment?.revision??0)-1}):null
  setResult(proof?{proof}:{unavailable:true})
 }
 return <li className="checkin-history-row">
  <div className="checkin-history-person">
    <b>{visit.patientName}</b>
    <span>{[visit.patientCode,visit.walkIn?'Walk-in':visit.appointmentCode].filter(Boolean).join(' · ')}</span>
  </div>
  <div className="checkin-history-state"><Status>{visit.status}</Status></div>
  <Button size="sm" variant="soft" disabled={busy} aria-label={`Verify original arrival receipt for ${visit.patientName}`} onClick={review}>{busy?'Verifying…':'Verify receipt'}</Button>
  {busy&&<span className="sr-only" role="status">Checking the original arrival receipt…</span>}
  {result&&<div className="checkin-history-feedback" ref={feedback} tabIndex={-1} role={result.unavailable?'alert':'status'}>{result.proof
   ?<p>Arrival verified: Visit {result.proof.visitId}{result.proof.queued?` · Queue ${result.proof.queueNumber}`:' · No assigned Dentist queue'}. Current status may have changed since arrival.</p>
   :<p>Original receipt unavailable. Do not assume the prior admission failed or create a replacement without checking clinic records.</p>}</div>}
 </li>
}

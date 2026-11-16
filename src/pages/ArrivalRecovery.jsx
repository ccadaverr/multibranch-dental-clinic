import React,{useState} from 'react'
import {Button,Card,Notice,Status} from '../components.jsx'
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
 return <Card title="Today’s recorded arrivals" subtitle="Review a recorded visit after a reload or an unconfirmed admission. A missing original receipt does not prove an earlier request failed.">
  {store.appointmentsStatus!=='ready'?<p role="status">Refresh clinic records to review today’s arrivals.</p>:!rows.length?<p>No recorded arrivals are shown. This does not prove an unconfirmed request failed.</p>:
   <ul className="fd-list">{rows.map(v=><ArrivalReview key={JSON.stringify([v.id,checkInActorKey(session),store.getAuthGeneration?.()])} visit={v} store={store}/>)}</ul>}
 </Card>
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
 return <li><div><b>{visit.patientName} · {visit.patientCode}</b><p>{visit.walkIn?'Walk-in':visit.appointmentCode} · <Status>{visit.status}</Status></p>
  {busy&&<p role="status">Loading the original arrival receipt…</p>}
  {result&&<div ref={feedback} tabIndex={-1} role={result.unavailable?'alert':'status'}>{result.proof
   ?<p>Original arrival verified: visit {result.proof.visitId}{result.proof.queued?` · Queue ${result.proof.queueNumber}`:' · No Dentist queue assigned'}. The current visit status above may have changed since arrival.</p>
   :<p>No original arrival receipt could be verified for your account. The current visit is shown above; do not assume an earlier admission failed or create a replacement.</p>}</div>}
 </div><Button size="sm" variant="soft" disabled={busy} onClick={review}>Review arrival receipt</Button></li>
}

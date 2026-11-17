import React, {useEffect,useRef,useState} from 'react'
import {Button,Icon,RefreshButton} from '../../components.jsx'
import {listAppointments,myBillingInvoices,myDependents} from '../../api-client.js'
import {dateLong,greeting,money,splitAppointments,time12,todayManila} from '../format.js'
import {EmptyState,ErrorState,Pill,Skeleton} from '../ui.jsx'
import {readHomeAppointments,readHomeBalance} from '../home-read.js'
import {JoinQueueCard} from '../../pages/JoinQueueCard.jsx'

function useHomeRead(read,owner,owns) {
  const [result,setResult]=useState({status:'loading',data:null}),serial=useRef(0),live=useRef(false),latest=useRef();latest.current={read,owner,owns}
  const reload=async()=>{
    const ticket=++serial.current,scope=latest.current.owner
    setResult({status:'loading',data:null})
    const current=()=>live.current&&scope===latest.current.owner&&latest.current.owns()&&ticket===serial.current
    const r=await latest.current.read(current)
    if(!live.current||scope!==latest.current.owner||ticket!==serial.current)return
    setResult(current()&&r?.ok?{status:'ready',data:r.data}:{status:'error',data:null,error:r?.message||'Your session or records could not be verified. Sign in again or reload.'})
  }
  useEffect(()=>{live.current=true;reload();return()=>{live.current=false;serial.current++}},[owner])
  return {...result,reload}
}

/** Current server records only; no balance or visit is inferred from a partial read. */
export function HomePage({me,onNavigate,session,getAuthGeneration}) {
  const today=todayManila(),generation=getAuthGeneration?.(),patientId=session?.patientPublicId
  const owner=JSON.stringify([session?.serverUserId,patientId,generation,today])
  const owns=()=>session?.active===true&&session?.role==='patient'&&!!session?.serverUserId&&!!patientId&&me?.patient?.id===patientId&&(!getAuthGeneration||generation!=null&&getAuthGeneration()===generation)
  const visits=useHomeRead(current=>owns()?readHomeAppointments(listAppointments,myDependents,patientId,current):Promise.resolve({ok:false}),owner,owns)
  const invoices=useHomeRead(current=>owns()?readHomeBalance(myBillingInvoices,myDependents,patientId,current):Promise.resolve({ok:false}),owner,owns)
  const first=(me?.first_name||me?.name||'').split(' ')[0]
  const {upcoming}=splitAppointments(visits.data),next=upcoming[0]
  return <div className="pp-page pp-home care-home">
    <header className="care-heading"><div><p>{greeting()}</p><h1>{first?`Hi, ${first}`:'Welcome'}</h1><span>Your appointments and dental care, in one place.</span></div><RefreshButton title="Reload home" ariaLabel="Reload home" loading={visits.status==='loading'||invoices.status==='loading'} onClick={()=>Promise.all([visits.reload(),invoices.reload()])}/></header>
    <JoinQueueCard/>
    <div className="care-home-grid"><section className="care-next-section" aria-labelledby="pp-next-title">
      <div className="care-section-heading"><h2 id="pp-next-title">Your next visit</h2><Button variant="ghost" size="sm" onClick={()=>onNavigate('visits')}>All visits</Button></div>
      {visits.status==='loading'&&<Skeleton lines={4} label="Loading your next visit"/>}
      {visits.status==='error'&&<ErrorState text={visits.error} onRetry={visits.reload}/>}
      {visits.status==='ready'&&!next&&<EmptyState icon="calendar" title="No upcoming visits" text="Choose a service, branch and available time. Payment options are checked before you confirm."><Button icon="plusCalendar" onClick={()=>onNavigate('book')}>Book a visit</Button></EmptyState>}
      {visits.status==='ready'&&next&&<article className="pp-card care-next">
        <div className="care-next-top"><span className="care-calendar"><b>{Number(next.date.slice(8))}</b><span>{new Date(next.date+'T00:00:00+08:00').toLocaleDateString('en-PH',{month:'short',timeZone:'Asia/Manila'})}</span></span><div><Pill>{next.status}</Pill><h3>{next.service?.name||'Dental visit'}</h3><p>{dateLong(next.date)} · <strong>{time12(next.start_time)}</strong></p></div></div>
        <dl className="care-facts"><div><dt>Patient</dt><dd>{next.patient.name}{next.patient.code&&<small>{next.patient.code}</small>}</dd></div><div><dt>Branch</dt><dd>{next.branch.name}</dd></div>{next.dentist?.name&&<div><dt>Dentist</dt><dd>{next.dentist.name}</dd></div>}</dl>
        {next.status==='Pending'&&<p className="care-state-note">Confirmation is pending. Open the visit to check its current status.</p>}
        <div className="care-next-footer"><span>{next.code?`Appointment ${next.code}`:'Saved appointment'}</span><Button onClick={()=>onNavigate('visits',{appointmentId:next.id})}>View details</Button></div>
      </article>}
    </section><section className="care-attention" aria-labelledby="care-attention-title"><h2 id="care-attention-title">Your next steps</h2>
      {invoices.status==='loading'&&<Skeleton lines={2} label="Checking your invoices"/>}
      {invoices.status==='error'&&<ErrorState text={invoices.error} onRetry={invoices.reload}/>}
      {invoices.status==='ready'&&<div className="pp-card care-balance"><Icon name="wallet" size={22}/><h3>{invoices.data.count?money(invoices.data.minor/100):'No issued balance'}</h3><p>{invoices.data.count?`${invoices.data.count} issued ${invoices.data.count===1?'invoice':'invoices'} for you and your family.`:'No issued invoices with an unpaid balance were returned.'}</p><Button variant="soft" onClick={()=>onNavigate('billing')}>Review billing</Button></div>}
      {next&&<Button variant="ghost" icon="plusCalendar" onClick={()=>onNavigate('book')}>Book another visit</Button>}
    </section></div>
    <section className="care-library" aria-labelledby="care-library-title"><div className="care-section-heading"><div><h2 id="care-library-title">Your care records</h2><p>Saved records and people in your care.</p></div></div><nav className="care-link-grid" aria-label="Care records">
      {[['archives','archive','Treatment history','Completed visits and care'],['prescriptions','file','Prescriptions','Issued prescriptions and PDFs'],['documents','file','Documents','Your files and consent records'],['family','users','Family','Children and dependents']].map(([page,icon,label,hint])=><button type="button" className="care-link" key={page} onClick={()=>onNavigate(page)}><Icon name={icon} size={20}/><span><b>{label}</b><small>{hint}</small></span><Icon name="chevron" size={18}/></button>)}
    </nav></section>
    <nav className="care-footer-links" aria-label="More shortcuts"><Button variant="ghost" icon="calendar" onClick={()=>onNavigate('visits')}>My visits</Button><Button variant="ghost" icon="message" onClick={()=>onNavigate('messages')}>Ask the front desk</Button></nav>
  </div>
}

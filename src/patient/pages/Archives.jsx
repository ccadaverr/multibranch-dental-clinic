import { loadPatientAppointments, loadTreatmentHistory, treatmentSummaries } from '../visit-history.js'
import React, { useEffect, useRef, useState } from 'react'
import { Button, RefreshButton, FilterBar } from '../../components.jsx'
import { downloadAppointmentReceiptPdf, downloadBillingPdf, downloadPrescriptionPdf, listAppointments, myBillingInvoices, myPrescriptions, myTreatments, myDependents } from '../../api-client.js'
import { dateLong, money, time12 } from '../format.js'
import {readPatientPrescriptions} from '../prescription-read.js'
import {dateLabel} from '../../logic.js'
import {paymentMethodLabel} from '../../payment-method.js'
import {boundedClinicalRead} from '../../clinical-history.js'
import {confirmedBillingReceipt} from '../../billing-command.js'
import {invoiceMatches} from '../invoice-readback.js'
import {loadInvoiceHistory,readOwnedArchive} from '../archive-readback.js'
import { EmptyState, ErrorState, PageHead, Pill, Skeleton } from '../ui.jsx'

const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

export function ArchivesPage(props){return <ArchivesBody key={JSON.stringify([props.session?.serverUserId,props.session?.patientPublicId,props.getAuthGeneration?.()])} {...props}/>}
function ArchivesBody({ toast = () => {},session,getAuthGeneration,onNavigate }) {
  const [search,setSearch]=useState('')
  const [tab, setTab] = useState('visits') // visits | prescriptions | receipts
  const [visits, setVisits] = useState({ loading: true, data: [], error: '' })
  const [prescriptions, setPrescriptions] = useState({ loading: true, data: [], error: '' })
  const [invoices, setInvoices] = useState({ loading: true, data: [], error: '' })
  const [downloading, setDownloading] = useState('')

  const [attempt,setAttempt]=useState(0)
  const live=useRef(false),latest=useRef(null),downloadingNow=useRef(false)
  const generation=getAuthGeneration?.(),owner=JSON.stringify([session?.serverUserId,session?.patientPublicId,generation]);latest.current=owner
  const owns=()=>live.current&&latest.current===owner&&session?.active===true&&session?.role==='patient'&&(!getAuthGeneration||generation!=null&&getAuthGeneration()===generation)
  useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
  useEffect(() => {
    let current=true;const valid=()=>current&&owns()
    const fail=(setter,message)=>{if(valid())setter({loading:false,data:[],error:message})}
    for(const setter of [setVisits,setPrescriptions,setInvoices])setter({loading:true,data:[],error:''})
    if(!valid()){for(const setter of [setVisits,setPrescriptions,setInvoices])setter({loading:false,data:[],error:'Your Patient history session is unavailable. Sign in again.'});return}
    const family=myDependents()
    const appointments=readOwnedArchive(async guard=>{
      const f=await family;if(!f.ok||!Array.isArray(f.data)||f.meta?.me?.id!==session.patientPublicId)return {ok:false,message:'Authorized Patient history context could not be verified.'}
      const r=await loadPatientAppointments(guard(listAppointments)),allowed=[session.patientPublicId,...f.data.map(p=>p.id)]
      if(r.ok&&r.data.some(a=>!allowed.includes(a.patient?.id)))return {ok:false,message:'The returned appointments did not identify an authorized Patient.'}
      return r
    },valid)
    Promise.all([appointments,readOwnedArchive(guard=>loadTreatmentHistory(guard(myTreatments)),valid)]).then(([a,t])=>{
      if(!valid())return
      if(!a.ok||!t.ok)return fail(setVisits,a.message||t.message||'Some care history could not be loaded. Retry to read the saved records.')
      if(new Set(t.data.map(t=>t?.id)).size!==t.data.length||t.data.some(t=>typeof t?.id!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(t.date)||typeof t.procedure_summary!=='string'||!Array.isArray(t.services)||t.services.some(s=>typeof s?.name!=='string')||typeof t.dentist?.name!=='string'))return fail(setVisits,'The treatment history response could not be verified.')
      setVisits({loading:false,data:[...a.data.filter(a=>a.status==='Completed'),...treatmentSummaries(t.data)].sort((a,b)=>String(b.date).localeCompare(String(a.date))||a.id.localeCompare(b.id)),error:''})
    }).catch(()=>fail(setVisits,'Care history could not be loaded.'))
    readPatientPrescriptions(()=>myPrescriptions(),()=>family,session.patientPublicId,valid).then(r=>{
      if(!valid())return
      if(!r.ok)return fail(setPrescriptions,r.message||'Prescriptions could not be loaded.')
      setPrescriptions({loading:false,data:r.data,error:''})
    })
    Promise.all([readOwnedArchive(guard=>loadInvoiceHistory(guard(myBillingInvoices)),valid),appointments,family]).then(([inv,a,f])=>{
      if(!valid())return
      if(!inv.ok||!a.ok||!f.ok||!Array.isArray(f.data)||f.meta?.me?.id!==session.patientPublicId)return fail(setInvoices,inv.message||a.message||'Receipt history could not be verified.')
      const allowed=[session.patientPublicId,...f.data.map(p=>p.id)]
      if(inv.data.some(i=>!invoiceMatches(i,allowed)))return fail(setInvoices,'The returned invoice identities could not be verified.')
      const clinical=inv.data.filter(confirmedBillingReceipt)
      const deposits=a.data.filter(a=>a.booking_payment_status==='paid'&&Number(a.booking_fee_php)>0).map(a=>({
        id:`booking-${a.id}`,appointmentId:a.id,appointmentCode:a.code,patient:a.patient,isBookingDeposit:true,invoice_number:`DEP-${a.code||a.id.slice(0,8).toUpperCase()}`,branch:a.branch,serviceName:a.service?.name,
        receipt:{number:a.code,amount:Number(a.booking_fee_php),method:a.booking_payment_method,issued_at:a.booking_paid_at||a.date,reference:a.booking_payment_ref}
      }))
      setInvoices({loading:false,data:[...clinical,...deposits].sort((a,b)=>String(b.receipt.issued_at).localeCompare(String(a.receipt.issued_at))),error:''})
    }).catch(()=>fail(setInvoices,'Receipt history could not be loaded.'))
    return()=>{current=false}
  }, [attempt,owner])

  const download=async(token,read)=>{
    if(downloadingNow.current||!owns())return
    downloadingNow.current=true;let active=true;setDownloading(token)
    const r=await boundedClinicalRead(()=>read(()=>active&&owns()))
    active=false;downloadingNow.current=false
    if(!owns())return
    setDownloading('');if(!r.ok)toast(r.message||'The saved document could not be downloaded.','warning')
  }
  const handleDownloadPdf=(inv,kind)=>download(`${inv.id}:${kind}`,isCurrent=>downloadBillingPdf(inv.id,kind,{patientId:inv.patient.id,receiptId:kind==='receipt'?inv.receipt.id:null,isCurrent}))
  const handleDownloadBookingDeposit=(apptId,code)=>download(`${apptId}:receipt`,isCurrent=>downloadAppointmentReceiptPdf(apptId,code,{isCurrent}))
  const handleDownloadRx=(id,number)=>download(`rx:${id}`,isCurrent=>downloadPrescriptionPdf(id,number,{isCurrent}))

  const tabKey=(event,key)=>{const keys=['visits','prescriptions','receipts'],at=keys.indexOf(key);const next=event.key==='Home'?0:event.key==='End'?2:event.key==='ArrowRight'?(at+1)%3:event.key==='ArrowLeft'?(at+2)%3:null;if(next==null)return;event.preventDefault();setTab(keys[next]);setSearch('');event.currentTarget.parentElement.querySelectorAll('[role=tab]')[next]?.focus()}
  const matches=parts=>parts.filter(Boolean).join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  const visibleVisits=visits.data.filter(v=>matches([v.service?.name,v.patient?.name,v.patient?.code,v.dentist?.name,v.code,v.date,v.id]))
  const visibleRx=prescriptions.data.filter(p=>matches([p.number,p.patient?.name,p.patient?.code,p.branch,p.dentist]))
  const visibleReceipts=invoices.data.filter(i=>i.receipt&&matches([i.invoice_number,i.receipt.number,i.patient?.name,i.patient?.code,i.branch?.name,i.appointmentCode]))
  return <div className="pp-page pp-fade patient-history" aria-label="Historical records">
    <PageHead eyebrow="Medical Records" title="Historical records" text="Saved care, issued prescriptions and Payment Receipts." actions={<RefreshButton title="Reload historical records" ariaLabel="Reload historical records" loading={visits.loading||prescriptions.loading||invoices.loading} onClick={()=>setAttempt(a=>a+1)}/>}/>
    <div className="pp-tabs" role="tablist" aria-label="History categories">{[['visits',`Care records (${visits.data.length})`],['prescriptions',`Past Prescriptions (${prescriptions.data.length})`],['receipts',`Past Receipts (${invoices.data.length})`]].map(([key,label])=><button key={key} type="button" role="tab" aria-selected={tab===key} tabIndex={tab===key?0:-1} onKeyDown={event=>tabKey(event,key)} className={tab===key?'is-active':''} onClick={()=>{setTab(key);setSearch('')}}>{label}</button>)}</div>
    <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder={tab==='receipts'?'Search receipts…':tab==='prescriptions'?'Search saved prescriptions…':'Search care records…'} onClear={search.trim()?()=>setSearch(''):undefined}/>
    {tab==='visits'&&<section aria-label="Completed visits archive">
      {visits.loading?<Skeleton lines={4} label="Loading visit records"/>:visits.error?<ErrorState text={visits.error} onRetry={()=>setAttempt(a=>a+1)}/>:!visibleVisits.length?<EmptyState icon="calendar" title={search?'No matching care records':'No historical visits'} text={search?'Change or clear your search.':'Completed care will appear here.'}/>:<ul className="history-list">{visibleVisits.map(v=><li key={v.id} className="pp-card history-record">
        <header><div><p className="pp-eyebrow">{v.isTreatmentSummary?'Treatment summary':'Completed appointment'}</p><h2>{v.service?.name||'Dental Treatment'}</h2></div><Pill tone="neutral">{v.status}</Pill></header>
        <p>{dateLong(v.date)}{!v.isTreatmentSummary&&v.start_time?' · '+time12(v.start_time):''}</p>
        {v.patient&&<p>{v.patient.name} · {v.patient.code}</p>}
        <p className="pp-muted">{[v.branch?.name,v.dentist?.name].filter(Boolean).join(' · ')}</p>
        {v.isTreatmentSummary?<details><summary>Record details</summary><p>Summary {v.id.replace(/^treatment-/,'')}</p><p>The saved summary does not provide a Visit or appointment link.</p></details>:<><p className="pp-hint">Appointment {v.code||v.id}</p><Button variant="soft" onClick={()=>onNavigate?.('visits',{appointmentId:v.id,tab:'completed'})}>View appointment</Button></>}
      </li>)}</ul>}
    </section>}
    {tab==='prescriptions'&&<section aria-label="Prescriptions archive">
      {prescriptions.loading?<Skeleton lines={4} label="Loading prescriptions"/>:prescriptions.error?<ErrorState text={prescriptions.error} onRetry={()=>setAttempt(a=>a+1)}/>:!visibleRx.length?<EmptyState icon="pill" title={search?'No matching prescriptions':'No past prescriptions'} text="Issued prescriptions appear here."/>:<ul className="pp-rx-list">{visibleRx.map(p=><li key={p.id} className={`pp-card ${p.status==='Void'?'is-void':''}`}><header><h2>{p.number}</h2><Pill>{p.status}</Pill></header><p>{p.patient.name} · {p.patient.code}</p><p className="pp-hint">{dateLabel(p.issued_at)} · {p.dentist} · {p.branch}</p>{p.status==='Void'&&<p className="pp-void">VOID — do not use. {p.voided?.reason}</p>}<ol>{p.lines.map((l,i)=><li key={i}><b>{l.medicine}</b>{[l.dosage,l.frequency,l.duration].filter(Boolean).length?' — '+[l.dosage,l.frequency,l.duration].filter(Boolean).join(', '):''}{l.instructions?'. '+l.instructions:''}</li>)}</ol>{p.note&&<p>{p.note}</p>}<p className="pp-hint">Visit {p.visit}</p><Button variant="soft" icon="download" disabled={!!downloading} onClick={()=>handleDownloadRx(p.id,p.number)}>{downloading===`rx:${p.id}`?'Downloading…':'Download Prescription PDF'}</Button></li>)}</ul>}
    </section>}
    {tab==='receipts'&&<section aria-label="Receipts archive">
      {invoices.loading?<Skeleton lines={4} label="Loading receipts"/>:invoices.error?<ErrorState text={invoices.error} onRetry={()=>setAttempt(a=>a+1)}/>:!visibleReceipts.length?<EmptyState icon="receipt" title={search?'No matching receipts':'No archived receipts'} text="Payment Receipts appear after the server records payment."/>:<ul className="history-list">{visibleReceipts.map(inv=><li key={inv.id} className="pp-card history-record"><header><div><p className="pp-eyebrow">{inv.isBookingDeposit?'Booking payment':'Payment Receipt'}</p><h2>{inv.receipt.number}</h2></div><strong className="history-amount">{money(inv.receipt.amount)}</strong></header>
        <Pill tone="ok">{inv.isBookingDeposit?'Deposit Paid':'Paid'}</Pill><p>{inv.patient?.name} · {inv.patient?.code}</p><p className="pp-muted">{dateLabel(inv.receipt.issued_at)} · {inv.branch?.name}</p>
        <dl className="history-facts"><div><dt>{inv.isBookingDeposit?'Appointment':'Invoice'}</dt><dd>{inv.isBookingDeposit?inv.appointmentCode:inv.invoice_number}</dd></div><div><dt>Payment method</dt><dd>{inv.receipt.method?paymentMethodLabel(inv.receipt.method):'Not recorded'}</dd></div></dl>
        <div className="history-actions">{inv.isBookingDeposit?<Button variant="soft" icon="download" disabled={!!downloading} onClick={()=>handleDownloadBookingDeposit(inv.appointmentId,inv.appointmentCode)}>{downloading===`${inv.appointmentId}:receipt`?'Downloading…':'Download Receipt'}</Button>:<><Button onClick={()=>onNavigate?.('billing',{invoiceId:inv.id,patientId:inv.patient.id,receiptId:inv.receipt.id,receiptOnly:true})}>View saved receipt</Button><Button variant="soft" icon="download" disabled={!!downloading} onClick={()=>handleDownloadPdf(inv,'receipt')}>{downloading===`${inv.id}:receipt`?'Downloading…':'Download Receipt'}</Button></>}</div>
        <details><summary>Record details</summary><p>Patient {inv.patient?.id}</p>{inv.isBookingDeposit?<p>Appointment {inv.appointmentId}</p>:<><p>Invoice {inv.id}</p><p>Receipt {inv.receipt.id}</p><p>Visit {inv.visit_id}</p><Button variant="ghost" disabled={!!downloading} onClick={()=>handleDownloadPdf(inv,'invoice')}>Invoice PDF</Button></>}</details>
      </li>)}</ul>}
    </section>}
  </div>
}
export default ArchivesPage

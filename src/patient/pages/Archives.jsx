import { loadPatientAppointments, loadTreatmentHistory, treatmentSummaries } from '../visit-history.js'
import React, { useEffect, useRef, useState } from 'react'
import { Button, Icon } from '../../components.jsx'
import { downloadAppointmentReceiptPdf, downloadBillingPdf, downloadPrescriptionPdf, listAppointments, myBillingInvoices, myPrescriptions, myTreatments, myDependents } from '../../api-client.js'
import { dateLong, money, time12, todayManila } from '../format.js'
import {boundedClinicalRead} from '../../clinical-history.js'
import {confirmedBillingReceipt} from '../../billing-command.js'
import {invoiceMatches} from '../invoice-readback.js'
import {loadInvoiceHistory,readOwnedArchive} from '../archive-readback.js'
import { EmptyState, ErrorState, PageHead, Pill, Skeleton } from '../ui.jsx'

const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

export function ArchivesPage({ toast = () => {},session,getAuthGeneration,onNavigate }) {
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
    if(!valid()){setVisits({loading:false,data:[],error:'Your Patient history session is unavailable. Sign in again.'});return}
    const family=myDependents()
    const appointments=readOwnedArchive(async guard=>{
      const f=await family;if(!f.ok||!Array.isArray(f.data))return {ok:false,message:'Authorized Patient history context could not be verified.'}
      const r=await loadPatientAppointments(guard(listAppointments)),allowed=[session.patientPublicId,...f.data.map(p=>p.id)]
      if(r.ok&&r.data.some(a=>!allowed.includes(a.patient?.id)))return {ok:false,message:'The returned appointments did not identify an authorized Patient.'}
      return r
    },valid)
    Promise.all([appointments,readOwnedArchive(guard=>loadTreatmentHistory(guard(myTreatments)),valid)]).then(([a,t])=>{
      if(!valid())return
      if(!a.ok||!t.ok)return fail(setVisits,a.message||t.message||'Some care history could not be loaded. Retry to read the saved records.')
      if(t.data.some(t=>!t.id||!t.date||!Array.isArray(t.services)))return fail(setVisits,'The treatment history response could not be verified.')
      setVisits({loading:false,data:[...a.data.filter(a=>a.status==='Completed'),...treatmentSummaries(t.data)].sort((a,b)=>String(b.date).localeCompare(String(a.date))||a.id.localeCompare(b.id)),error:''})
    }).catch(()=>fail(setVisits,'Care history could not be loaded.'))
    readOwnedArchive(guard=>guard(myPrescriptions)(),valid).then(r=>{
      if(!valid())return
      if(!r.ok)return fail(setPrescriptions,r.message||'Prescriptions could not be loaded.')
      setPrescriptions({loading:false,data:r.data,error:''})
    })
    Promise.all([readOwnedArchive(guard=>loadInvoiceHistory(guard(myBillingInvoices)),valid),appointments,family]).then(([inv,a,f])=>{
      if(!valid())return
      if(!inv.ok||!a.ok||!f.ok||!Array.isArray(f.data))return fail(setInvoices,inv.message||a.message||'Receipt history could not be verified.')
      const allowed=[session.patientPublicId,...f.data.map(p=>p.id)]
      if(inv.data.some(i=>!invoiceMatches(i,allowed)))return fail(setInvoices,'The returned invoice identities could not be verified.')
      const clinical=inv.data.filter(confirmedBillingReceipt)
      const deposits=a.data.filter(a=>a.booking_payment_status==='paid'&&Number(a.booking_fee_php)>0).map(a=>({
        id:`booking-${a.id}`,appointmentId:a.id,appointmentCode:a.code,patient:a.patient,isBookingDeposit:true,invoice_number:`DEP-${a.code||a.id.slice(0,8).toUpperCase()}`,branch:a.branch,serviceName:a.service?.name,
        receipt:{number:`DEP-${a.code||a.id.slice(0,8).toUpperCase()}`,amount:Number(a.booking_fee_php),method:a.booking_payment_method||'PayMongo',issued_at:a.booking_paid_at||a.date,reference:a.booking_payment_ref}
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

  return (
    <div className="pp-page pp-fade" aria-label="Historical records">
      <PageHead
        eyebrow="Medical Records"
        title="Historical records"
        text="Historical records of your care, past completed appointments, digital prescriptions, and settled receipts."
      />

      <div className="pp-tabs" role="tablist" aria-label="History categories">
        {[
          ['visits', `Care records (${visits.data.length})`],
          ['prescriptions', `Past Prescriptions (${prescriptions.data.length})`],
          ['receipts', `Past Receipts (${invoices.data.filter(i => i.receipt).length})`],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'is-active' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'visits' && (
        <section aria-labelledby="archive-visits-heading">
          <h2 id="archive-visits-heading" className="sr-only">Completed Visits Archive</h2>
          {visits.loading && <Skeleton lines={4} label="Loading visit records"/>}
          {visits.error && <ErrorState text={visits.error} onRetry={()=>setAttempt(a=>a+1)}/>}
          {!visits.loading && !visits.error && !visits.data.length && (
            <EmptyState icon="calendar" title="No historical visits" text="Completed and past visits will be safely preserved here."/>
          )}
          {!visits.loading && visits.data.length > 0 && (
            <ul className="pp-list" aria-label="Completed visits archive">
              {visits.data.map(v => (
                <li key={v.id} className="pp-card pp-visit pp-fade">
                  <div className="pp-visit-date" aria-hidden="true">
                    <b>{v.date ? Number(v.date.slice(8)) : '—'}</b>
                    <span>{v.date ? new Date(`${v.date}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', timeZone: 'UTC' }) : ''}</span>
                  </div>
                  <div className="pp-visit-body">
                    {!v.isTreatmentSummary&&<Button variant="ghost" onClick={()=>onNavigate?.('visits',{appointmentId:v.id,tab:'completed'})}>View appointment</Button>}
                    {v.patient?.name&&<p>For {v.patient.name}</p>}
                    <h3>{v.isTreatmentSummary && <span className="pp-badge">Treatment summary </span>}{v.service?.name || 'Dental Treatment'}</h3>
                    <p>{dateLong(v.date)} · {time12(v.start_time)}</p>
                    <p className="pp-muted"><Icon name="pin" size={14}/> {v.branch?.name}{v.dentist?.name ? ` · Dr. ${v.dentist.name}` : ''}</p>
                    <p className="pp-muted">{v.code && <>Ref. {v.code} </>}<Pill tone="neutral">{v.status}</Pill></p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'prescriptions' && (
        <section aria-labelledby="archive-rx-heading">
          <h2 id="archive-rx-heading" className="sr-only">Prescriptions Archive</h2>
          {prescriptions.loading && <Skeleton lines={4} label="Loading prescriptions"/>}
          {prescriptions.error && <ErrorState text={prescriptions.error} onRetry={()=>setAttempt(a=>a+1)}/>}
          {!prescriptions.loading && !prescriptions.error && !prescriptions.data.length && (
            <EmptyState icon="pill" title="No past prescriptions" text="Past prescriptions issued by your dentist appear here."/>
          )}
          {!prescriptions.loading && prescriptions.data.length > 0 && (
            <ul className="pp-rx-list" aria-label="Prescriptions archive">
              {prescriptions.data.map(p => (
                <li key={p.id} className={`pp-card ${p.status === 'Void' ? 'is-void' : ''}`}>
                  <p>
                    <b>{p.number}</b> · {p.issued_at ? dateLong(p.issued_at.slice(0, 10)) : ''}
                    {p.status === 'Void' && <span className="pp-void"> VOID</span>}
                  </p>
                  <p className="pp-hint">{p.dentist} · {p.branch}</p>
                  <ol>
                    {(p.lines || []).map((l, i) => (
                      <li key={i}>
                        <b>{l.medicine}</b>
                        {[l.dosage, l.frequency, l.duration].filter(Boolean).length ? ` — ${[l.dosage, l.frequency, l.duration].filter(Boolean).join(', ')}` : ''}
                        {l.instructions ? `. ${l.instructions}` : ''}
                      </li>
                    ))}
                  </ol>
                  <Button
                    size="sm"
                    variant="soft"
                    icon="download"
                    disabled={downloading === `rx:${p.id}`}
                    onClick={() => handleDownloadRx(p.id, p.number)}
                  >
                    {downloading === `rx:${p.id}` ? 'Downloading…' : 'Download Prescription PDF'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'receipts' && (
        <section aria-labelledby="archive-receipts-heading">
          <h2 id="archive-receipts-heading" className="sr-only">Receipts Archive</h2>
          {invoices.loading && <Skeleton lines={4} label="Loading receipts"/>}
          {invoices.error && <ErrorState text={invoices.error} onRetry={()=>setAttempt(a=>a+1)}/>}
          {!invoices.loading && !invoices.error && !invoices.data.filter(i => i.receipt).length && (
            <EmptyState icon="receipt" title="No archived receipts" text="Saved Payment Receipts are recorded here."/>
          )}
          {!invoices.loading && invoices.data.filter(i => i.receipt).length > 0 && (
            <ul className="pp-list" aria-label="Archived receipts">
              {invoices.data.filter(i => i.receipt).map(inv => (
                <li key={inv.id} className="pp-card pp-fade">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                    <div>
                      <p className="pp-eyebrow">{inv.isBookingDeposit ? 'Booking Deposit' : `Receipt ${inv.receipt.number}`}</p>
                      {inv.patient?.name&&<p>For {inv.patient.name}</p>}
                      <h3>{inv.isBookingDeposit ? `Deposit Ref #${inv.receipt.number}` : `Invoice #${inv.invoice_number}`}</h3>
                      <p className="pp-muted">
                        {inv.receipt.issued_at ? dateLong(inv.receipt.issued_at.slice(0, 10)) : ''} · {inv.branch?.name || 'Dr. Dana Roxas Dental Clinic'}
                        {inv.serviceName ? ` · ${inv.serviceName}` : ''}
                      </p>
                      <p>
                        <b>Paid: {money(inv.receipt.amount)}</b> · Via {inv.receipt.method || 'PayMongo'}
                        {inv.receipt.reference ? ` (${inv.receipt.reference})` : ''}
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                      {inv.isBookingDeposit ? (
                        <>
                          <Pill tone="ok">Deposit Paid</Pill>
                          <Button
                            size="sm"
                            variant="soft"
                            icon="download"
                            disabled={downloading === `${inv.appointmentId || inv.id}:receipt`}
                            onClick={() => handleDownloadBookingDeposit(inv.appointmentId || inv.id, inv.receipt?.number)}
                          >
                            {downloading === `${inv.appointmentId || inv.id}:receipt` ? 'Downloading…' : 'Download Receipt'}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button variant="soft" onClick={()=>onNavigate?.('billing',{invoiceId:inv.id,patientId:inv.patient.id,receiptId:inv.receipt.id,receiptOnly:true})}>View saved receipt</Button>
                          <Button
                            size="sm"
                            variant="soft"
                            icon="download"
                            disabled={downloading === `${inv.id}:receipt`}
                            onClick={() => handleDownloadPdf(inv, 'receipt')}
                          >
                            {downloading === `${inv.id}:receipt` ? 'Downloading…' : 'Download Receipt'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon="file"
                            disabled={downloading === `${inv.id}:invoice`}
                            onClick={() => handleDownloadPdf(inv, 'invoice')}
                          >
                            Invoice PDF
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
export default ArchivesPage

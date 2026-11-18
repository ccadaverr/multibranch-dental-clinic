import React, { useEffect, useRef, useState } from 'react'
import { Button, RefreshButton } from '../../components.jsx'
import { downloadPrescriptionPdf, myPrescriptions, myDependents } from '../../api-client.js'
import {readPatientPrescriptions} from '../prescription-read.js'
import {boundedClinicalRead} from '../../clinical-history.js'
import { useVisibleRefresh } from '../../use-visible-refresh.js'
import { EmptyState, ErrorState, PageHead, Skeleton } from '../ui.jsx'

const day = iso => iso ? new Date(iso).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }) : ''

/** M19: the patient's (and their dependents') issued prescriptions, read-only, with the PDF. A void one is marked VOID. */
export function PrescriptionsPage(props) {
  const key=JSON.stringify([props.session?.serverUserId,props.session?.patientPublicId,props.getAuthGeneration?.()])
  return <PatientPrescriptions key={key} {...props}/>
}
function PatientPrescriptions({ toast = () => {}, session, getAuthGeneration }) {
  const [rows, setRows] = useState(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const live = useRef(false), serial = useRef(0), pending = useRef(false)
  const [loading,setLoading]=useState(true),[downloading,setDownloading]=useState('')
  const downloadPending=useRef(false), generation=getAuthGeneration?.()
  const owns=()=>live.current && session?.active===true && session?.role==='patient' && !!session?.patientPublicId &&
    (!getAuthGeneration || generation!=null && getAuthGeneration()===generation)
  const load = async () => {
    if (pending.current) return
    pending.current = true
    const ticket = ++serial.current
    setError('');setRows(null);setLoading(true)
    try {
      const r = await readPatientPrescriptions(()=>myPrescriptions(),()=>myDependents(),session?.patientPublicId,owns)
      if (!live.current || ticket !== serial.current) return
      if (!owns()) {setRows(null);setError('Your prescription session has ended. Sign in again.');return}
      if (!r.ok) {
        setRows(null); setError(r.message || 'Your prescriptions could not be verified. Try again.'); return
      }
      setRows(r.data)
    } catch { if (live.current && ticket === serial.current) { setRows(null); setError('Your prescriptions could not be loaded. Try again.') } }
    finally { if (ticket === serial.current) {pending.current = false; if(live.current)setLoading(false)} }
  }
  useEffect(() => { live.current = true; pending.current = false; load(); return () => { live.current = false; serial.current++; pending.current = false } }, [attempt])
  useVisibleRefresh(load)
  const download=async p=>{
    if(downloadPending.current || !owns())return
    downloadPending.current=true;setDownloading(p.id)
    let active=true
    const r=await boundedClinicalRead(()=>downloadPrescriptionPdf(p.id,p.number,{isCurrent:()=>active&&owns()}))
    active=false;downloadPending.current=false
    if(!owns())return
    setDownloading('');if(!r.ok)toast(r.message||'The PDF could not be downloaded.','warning')
  }
  return <div className="pp-page pp-fade care-prescriptions">
    <PageHead eyebrow="Records & Billing" title="Prescriptions" text="Prescriptions your dentist issued after a visit. Follow your dentist’s instructions; call the branch if you have a question." actions={<RefreshButton title="Reload my prescriptions" ariaLabel="Reload my prescriptions" loading={loading} onClick={load}/>}/>
    {error && <ErrorState text={error} onRetry={() => setAttempt(a => a + 1)}/>}
    {!rows && !error && <Skeleton lines={4} label="Loading your prescriptions"/>}
    {rows && !rows.length && <EmptyState icon="file" title="No prescriptions yet" text="Prescriptions issued by your dentist after a visit will appear here."/>}
    {rows && rows.length > 0 && <section aria-label="Issued and void prescriptions">
      <ul className="pp-rx-list">{rows.map(p => <li key={p.id} className={p.status === 'Void' ? 'is-void' : ''}>
        <header className="care-rx-heading"><div><h2>{p.number}</h2><p className="pp-hint">Issued {day(p.issued_at)}</p></div><span className={p.status === 'Void' ? 'pp-void' : 'care-rx-status'}>{p.status === 'Void' ? 'VOID — do not use' : 'Issued'}</span></header>
        <dl className="care-rx-facts">{p.patient?.name&&<div><dt>Patient</dt><dd>{p.patient.name}</dd></div>}<div><dt>Dentist</dt><dd>{p.dentist||'Not recorded'}</dd></div><div><dt>Branch</dt><dd>{p.branch}</dd></div></dl>
        <ol className="care-rx-medicines">{(p.lines || []).map((l, i) => <li key={i}><b>{l.medicine}</b>{[l.dosage, l.frequency, l.duration].filter(Boolean).length>0&&<p>{[l.dosage, l.frequency, l.duration].filter(Boolean).join(' · ')}</p>}{l.instructions&&<p>{l.instructions}</p>}</li>)}</ol>
        {p.note && <p className="pp-hint">Note: {p.note}</p>}
        {p.voided && <p className="pp-hint">Voided: {day(p.voided.at)}. Reason: {p.voided.reason}</p>}
        <Button size="sm" variant="soft" icon="download" aria-label={`Download PDF for ${p.number}`} aria-busy={downloading===p.id} disabled={!!downloading} onClick={()=>download(p)}>{downloading===p.id?'Downloading…':'Download PDF'}</Button>
      </li>)}</ul>
    </section>}
  </div>
}

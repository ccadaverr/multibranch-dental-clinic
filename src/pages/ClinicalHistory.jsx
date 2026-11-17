import React, {useEffect,useRef,useState} from 'react'
import {Button,Card,Notice,RefreshButton,Status} from '../components.jsx'
import {getTreatment,listTreatments} from '../api-client.js'
import {clinicalSessionKey} from '../encounter.js'
import {boundedClinicalRead,clinicalHistoryMatches} from '../clinical-history.js'
import {ChartView} from './DentalChart.jsx'
import {EncounterPrescriptions} from './EncounterPrescriptions.jsx'

/** Existing authorized Completed Treatment read, independent of the current queue/date-window projection. No mutations. */
export function ClinicalHistory({store,patient,selectedId=null}){
 return <History key={clinicalSessionKey(store.session)+'|'+store.getAuthGeneration?.()+'|'+patient.id} store={store} patient={patient} selectedId={selectedId}/>
}
function History({store,patient,selectedId}){
 const [rows,setRows]=useState([]),[detail,setDetail]=useState(null),[error,setError]=useState(''),[detailError,setDetailError]=useState(''),[loading,setLoading]=useState(false),[reading,setReading]=useState(false),[page,setPage]=useState(1),[last,setLast]=useState(1),[attempt,setAttempt]=useState(0),[picked,setPicked]=useState(selectedId),[chart,setChart]=useState(false)
 const live=useRef(false),latest=useRef(store),epoch=useRef(0);latest.current=store
 const owner=clinicalSessionKey(store.session),generation=store.getAuthGeneration?.()
 const owns=()=>live.current&&clinicalSessionKey(latest.current.session)===owner&&latest.current.getAuthGeneration?.()===generation
 useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
 useEffect(()=>{if(selectedId)setPicked(selectedId)},[selectedId])
 useEffect(()=>{
  let current=true;setLoading(true);setError('');setRows([])
  boundedClinicalRead(()=>listTreatments({patient_id:patient.id,status:'Completed',per_page:20,page})).then(r=>{
   if(!current||!owns())return
   setLoading(false)
   if(!r.ok||!Array.isArray(r.data)||r.data.some(t=>!clinicalHistoryMatches(t,patient.id))||!Number.isSafeInteger(r.meta?.last_page))return setError(r.message||'Patient history context could not be verified. No records were adopted.')
   setRows(r.data);setLast(r.meta.last_page)
  });return()=>{current=false}
 },[patient.id,page,attempt])
 useEffect(()=>{
  const request=++epoch.current;setDetail(null);setDetailError('');setChart(false)
  if(!picked)return
  setReading(true)
  boundedClinicalRead(()=>getTreatment(picked)).then(r=>{
   if(!owns()||request!==epoch.current)return
   setReading(false)
   if(!r.ok||!clinicalHistoryMatches(r.data,patient.id,picked))return setDetailError(r.message||'The selected encounter did not confirm this Patient. No record was adopted.')
   setDetail(r.data)
  });return()=>{epoch.current++}
 },[picked,patient.id,attempt])
 return <Card title="Completed encounter history" subtitle="Authorized completed records across dates. Historical documentation is read-only." actions={<RefreshButton title="Reload clinical history" ariaLabel="Reload clinical history" onClick={()=>setAttempt(a=>a+1)}/>}>
  {error&&<Notice tone="warning">{error}<Button onClick={()=>setAttempt(a=>a+1)}>Retry history</Button></Notice>}
  {loading&&<p role="status">Loading completed encounters…</p>}
  {!loading&&!error&&!rows.length&&<p>No authorized completed encounters were returned for this Patient.</p>}
  {rows.map(t=><article key={t.id} className="clinical-history"><div><b>{t.clinic_date} · {t.branch.name}</b><p>{t.procedure_summary||'No procedure summary recorded'}</p><small>{t.dentist.name} · Revision {t.revision}</small></div><Button variant="soft" onClick={()=>setPicked(t.id)}>Review encounter {t.clinic_date}</Button></article>)}
  {last>1&&<div className="row-actions"><Button disabled={page<=1||loading} onClick={()=>setPage(p=>p-1)}>Newer encounters</Button><span>Page {page} of {last}</span><Button disabled={page>=last||loading} onClick={()=>setPage(p=>p+1)}>Older encounters</Button></div>}
  {reading&&<p role="status">Verifying the selected historical encounter…</p>}
  {detailError&&<Notice tone="warning">{detailError}<Button onClick={()=>setAttempt(a=>a+1)}>Retry encounter</Button></Notice>}
  {detail&&<section aria-label="Historical encounter" style={{overflowWrap:'anywhere'}}>
   <h3>{detail.patient.name} · {detail.patient.code}</h3><p><Status>{detail.status}</Status> {detail.clinic_date} · {detail.branch.name} · {detail.dentist.name}</p>
   <p>Encounter {detail.id} · Visit {detail.visit.id}</p><p>{detail.appointment?'Appointment '+detail.appointment.code:'Walk-in Visit — no appointment is linked.'}</p>
   <dl>{[['Chief complaint',detail.chief_complaint],['Treatment plan',detail.treatment_plan],['Performed treatment',detail.procedure_summary],['Clinical notes',detail.clinical_notes]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'Not recorded'}</dd></div>)}</dl>
   <ul>{detail.procedures.map(p=><li key={p.id}>{p.service.name} × {p.quantity}{p.notes?' · '+p.notes:''}</li>)}</ul>
   <p>Completed {detail.completed_at} · Revision {detail.revision}. This completed documentation cannot be edited here.</p>
   <EncounterPrescriptions store={store} patientId={detail.patient.id} visitId={detail.visit.id} branchId={detail.branch.id}/>
   <details><summary>Documentation revision history</summary>{(detail.history||[]).map(h=><article key={h.revision}><p>Revision {h.revision} · {h.occurred_at} · {h.actor_role} · {h.to_status}</p>{h.snapshot&&<dl>{[['Chief complaint',h.snapshot.chief_complaint],['Treatment plan',h.snapshot.treatment_plan],['Performed treatment',h.snapshot.procedure_summary],['Clinical notes',h.snapshot.clinical_notes]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'Not recorded'}</dd></div>)}</dl>}</article>)}</details>
   <Button variant="soft" onClick={()=>setChart(v=>!v)} aria-expanded={chart}>Review current Patient chart</Button>
   {chart&&<><p>Current findings across visits. Select a tooth to review its dated history; this is separate from the completed encounter above.</p><ChartView patientId={patient.id} canRecord={false} toast={store.toast} store={store}/></>}
  </section>}
 </Card>
}

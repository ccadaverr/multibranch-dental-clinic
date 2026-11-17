import React, {useEffect,useRef,useState} from 'react'
import {Button,Card,Notice,RefreshButton,Status} from '../components.jsx'
import {getTreatment,listTreatments} from '../api-client.js'
import {clinicalSessionKey} from '../encounter.js'
import {readHistoryPage,readHistoryDetail} from '../history-read.js'
import '../history-experience.css'
import {ChartView} from './DentalChart.jsx'
import {EncounterPrescriptions} from './EncounterPrescriptions.jsx'

/** Existing authorized Completed Treatment read, independent of the current queue/date-window projection. No mutations. */
export function ClinicalHistory({store,patient,selectedId=null,expectedVisitId=null,expectedBranchId=null,allowChart=true,selectedOnly=false}){
 return <History key={clinicalSessionKey(store.session)+'|'+store.getAuthGeneration?.()+'|'+patient.id+'|'+(selectedId||'')+'|'+(expectedVisitId||'')+'|'+(expectedBranchId||'')} store={store} patient={patient} selectedId={selectedId} expectedVisitId={expectedVisitId} expectedBranchId={expectedBranchId} allowChart={allowChart} selectedOnly={selectedOnly}/>
}
function History({store,patient,selectedId,expectedVisitId,expectedBranchId,allowChart,selectedOnly}){
 const [rows,setRows]=useState([]),[detail,setDetail]=useState(null),[error,setError]=useState(''),[detailError,setDetailError]=useState(''),[loading,setLoading]=useState(false),[reading,setReading]=useState(false),[page,setPage]=useState(1),[last,setLast]=useState(1),[attempt,setAttempt]=useState(0),[picked,setPicked]=useState(selectedId?{id:selectedId,visitId:expectedVisitId,branchId:expectedBranchId}:null),[chart,setChart]=useState(false)
 const detailHeading=useRef(null),rowButtons=useRef(new Map()),restoreRow=useRef(null)
 const live=useRef(false),latest=useRef(store),epoch=useRef(0);latest.current=store
 const owner=clinicalSessionKey(store.session),generation=store.getAuthGeneration?.()
 const owns=()=>live.current&&clinicalSessionKey(latest.current.session)===owner&&latest.current.getAuthGeneration?.()===generation
 const choose=row=>{epoch.current++;setDetail(null);setDetailError('');setPicked({id:row.id,visitId:row.visit.id,branchId:row.branch.id,revision:row.revision})}
 const back=()=>{epoch.current++;restoreRow.current=picked?.id;setPicked(null);setDetail(null);setDetailError('');setReading(false)}
 React.useLayoutEffect(()=>{if(!picked&&restoreRow.current){rowButtons.current.get(restoreRow.current)?.focus();restoreRow.current=null}},[picked])
 useEffect(()=>{if(detail){detailHeading.current?.focus();detailHeading.current?.scrollIntoView({block:'start'})}},[detail?.id])
 useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
 useEffect(()=>{
  if(selectedOnly)return
  let current=true;setLoading(true);setError('');setRows([])
  readHistoryPage(listTreatments,{patientId:patient.id,page},()=>current&&owns()).then(r=>{
   if(!current||!owns())return
   setLoading(false)
   if(!r.ok)return setError(r.message||'Patient history context could not be verified. No records were adopted.')
   setRows(r.data);setLast(r.meta.last_page)
  });return()=>{current=false}
 },[patient.id,page,attempt,selectedOnly])
 useEffect(()=>{
  const request=++epoch.current;setDetail(null);setDetailError('');setChart(false)
  if(!picked){setReading(false);return}
  setReading(true)
  readHistoryDetail(getTreatment,patient.id,picked,()=>owns()&&request===epoch.current).then(r=>{
   if(!owns()||request!==epoch.current)return
   setReading(false)
   if(!r.ok)return setDetailError(r.message||'The selected encounter did not confirm this Patient. No record was adopted.')
   setDetail(r.data)
  });return()=>{epoch.current++}
 },[picked,patient.id,attempt])
 return <div className="clinical-history-workspace"><Card title="Completed encounter history" subtitle="Authorized completed records across dates. Historical documentation is read-only." actions={<RefreshButton title="Reload clinical history" ariaLabel="Reload clinical history" loading={loading||reading} onClick={()=>setAttempt(a=>a+1)}/>}>
  {error&&<Notice tone="warning">{error}<Button onClick={()=>setAttempt(a=>a+1)}>Retry history</Button></Notice>}
  {loading&&<p role="status">Loading completed encounters…</p>}
  {!picked&&!selectedOnly&&!loading&&!error&&!rows.length&&<p>No authorized completed encounters were returned for this Patient.</p>}
  {!selectedOnly&&picked&&<Button variant="ghost" onClick={back}>Back to encounter list</Button>}
  {!selectedOnly&&!picked&&<><div className="history-choices" aria-label="Completed encounter choices">{rows.map(t=><Button key={t.id} ref={node=>{if(node)rowButtons.current.set(t.id,node);else rowButtons.current.delete(t.id)}} className="history-choice" variant="ghost" aria-label={`Review encounter ${t.clinic_date}, ${t.appointment?.code||'walk-in'}, reference ${t.id}`} onClick={()=>choose(t)}><span className="history-choice-date">{t.clinic_date} · {t.appointment?.code||'Walk-in'}</span><span className="history-choice-summary">{t.procedure_summary||'No procedure summary recorded'}</span><small>{t.branch.name} · {t.dentist.name}</small><small>Encounter {t.id} · Revision {t.revision}</small></Button>)}</div>
  {last>1&&<nav className="row-actions history-pagination" aria-label="Encounter history pages"><Button disabled={page<=1||loading} onClick={()=>setPage(p=>p-1)}>Newer encounters</Button><span>Page {page} of {last}</span><Button disabled={page>=last||loading} onClick={()=>setPage(p=>p+1)}>Older encounters</Button></nav>}</>}
  {reading&&<p role="status">Verifying the selected historical encounter…</p>}
  {detailError&&<Notice tone="warning">{detailError}<Button onClick={()=>setAttempt(a=>a+1)}>Retry encounter</Button></Notice>}
  {detail&&<section aria-label="Historical encounter" style={{overflowWrap:'anywhere'}}>
   <h3 ref={detailHeading} tabIndex={-1}>{detail.patient.name} · {detail.patient.code}</h3><p><Status>{detail.status}</Status> {detail.clinic_date} · {detail.branch.name} · {detail.dentist.name}</p>
   <p>Encounter {detail.id} · Visit {detail.visit.id}</p><p>{detail.appointment?'Appointment '+detail.appointment.code:'Walk-in Visit — no appointment is linked.'}</p>
   <dl>{[['Chief complaint',detail.chief_complaint],['Treatment plan',detail.treatment_plan],['Performed treatment',detail.procedure_summary],['Clinical notes',detail.clinical_notes]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'Not recorded'}</dd></div>)}</dl>
   <ul>{detail.procedures.map(p=><li key={p.id}>{p.service.name} × {p.quantity}{p.notes?' · '+p.notes:''}</li>)}</ul>
   <p>Completed {new Date(detail.completed_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'})} · Revision {detail.revision}. This completed documentation cannot be edited here.</p>
   <EncounterPrescriptions store={store} patientId={detail.patient.id} visitId={detail.visit.id} branchId={detail.branch.id}/>
   <details><summary>Documentation revision history</summary>{(detail.history||[]).map(h=><article key={h.revision}><p>Revision {h.revision} · {h.occurred_at} · {h.actor_role} · {h.to_status}</p>{h.snapshot&&<dl>{[['Chief complaint',h.snapshot.chief_complaint],['Treatment plan',h.snapshot.treatment_plan],['Performed treatment',h.snapshot.procedure_summary],['Clinical notes',h.snapshot.clinical_notes]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'Not recorded'}</dd></div>)}</dl>}</article>)}</details>
   {allowChart&&<Button variant="soft" onClick={()=>setChart(v=>!v)} aria-expanded={chart}>Review current Patient chart</Button>}
   {allowChart&&chart&&<><p>Current findings across visits. Select a tooth to review its dated history; this is separate from the completed encounter above.</p><ChartView patientId={patient.id} canRecord={false} toast={store.toast} store={store}/></>}
  </section>}
 </Card></div>
}

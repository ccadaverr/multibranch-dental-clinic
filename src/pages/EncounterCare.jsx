import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Button, Notice, Status, RefreshButton } from '../components.jsx'
import { patientFollowups } from '../api-client.js'
import { EncounterPrescriptions } from './EncounterPrescriptions.jsx'
import {clinicalSessionKey} from '../encounter.js'
import {readEncounterFollowups} from '../encounter-care-read.js'

const InlineHistory=lazy(()=>import('./ClinicalHistory.jsx').then(m=>({default:m.ClinicalHistory})))
const InlineChart=lazy(()=>import('./DentalChart.jsx').then(m=>({default:m.ChartView})))

export function EncounterCare({ store, encounter, context, setPage }) {
  const { patient, treatment, record } = encounter
  const publicId=record.patientPublicId || patient.id
  const [chartOpen,setChartOpen]=useState(false),[historyOpen,setHistoryOpen]=useState(false)
  const [result,setResult]=useState(null),live=useRef(false),sequence=useRef(0),latest=useRef()
  const generation=store.getAuthGeneration?.(),scope=JSON.stringify([clinicalSessionKey(store.session),generation,publicId,record.branchId,treatment?.id,treatment?.revision])
  latest.current={scope,store}
  const owns=()=>live.current&&latest.current.scope===scope&&latest.current.store.session?.role==='dentist'&&latest.current.store.session?.active===true&&
    (!store.getAuthGeneration||generation!=null&&store.getAuthGeneration()===generation)
  const load=async()=>{
    if(treatment?.status!=='Completed'||!owns())return
    const ticket=++sequence.current;setResult({scope,loading:true})
    const fu=await readEncounterFollowups(patientFollowups,{patientId:publicId,branchId:record.branchId},owns)
    if(owns()&&ticket===sequence.current)setResult({scope,loading:false,fu})
  }
  useEffect(()=>{live.current=true;load();return()=>{live.current=false;sequence.current++}},[scope,treatment?.status])
  const care=result?.scope===scope?result:null,loading=treatment?.status==='Completed'&&(!care||care.loading)
  const prior=store.state.treatments.filter(t=>t.server&&!t.summaryOnly&&t.patientId===patient.id&&t.status==='Completed'&&t.id!==treatment?.id)
  const nav=(page)=>setPage(page,{...context,patientId:patient.id,patientPublicId:publicId,returnEncounter:context})
  return <aside className="enc-care" aria-label="Patient context and care tasks">
    <h2>Patient context</h2>
    <Notice title="Medical alerts unavailable">Verify allergies, medications and medical history through the clinic's approved process. No absence of risk is implied.</Notice>
    <div className="enc-care-links"><Button variant="soft" onClick={()=>nav('chart')}>Open dental chart</Button><Button variant="ghost" onClick={()=>nav('patients')}>Patient records</Button></div>
    <details className="enc-chart-preview" onToggle={event=>setChartOpen(event.currentTarget.open)}><summary>Review current chart here</summary><p>Current findings across visits, read-only here. Your treatment draft stays in place.</p>{chartOpen&&<Suspense fallback={<p role="status">Opening chart…</p>}><InlineChart patientId={publicId} canRecord={false} store={store} toast={store.toast} isCurrent={owns}/></Suspense>}</details>
    <details className="enc-history-preview" onToggle={event=>setHistoryOpen(event.currentTarget.open)}><summary>Review completed care here</summary><p>Read-only saved encounters across dates. Your treatment draft stays in place.</p>{historyOpen&&<Suspense fallback={<p role="status">Opening history…</p>}><InlineHistory store={store} patient={{id:publicId}} allowChart={false}/></Suspense>}</details>
    <Button variant="ghost" onClick={()=>setPage('patients',{...context,patientId:patient.id,historyTreatmentId:null,historyTab:true,returnEncounter:context})}>All completed Patient encounters</Button><details><summary>Earlier completed care ({prior.length} loaded)</summary><p className="muted-copy">Authorized server records in the loaded date window.</p>{prior.map(t=><article key={t.id}><h3>{t.date} · {t.dentistName}</h3><p>{t.procedure||'No procedure summary available'}</p><p>{t.notes}</p><Button variant="soft" onClick={()=>setPage('patients',{...context,patientId:patient.id,historyTreatmentId:t.id,returnEncounter:context})}>Review completed encounter</Button></article>)}{!prior.length&&<p>No earlier completed records are loaded.</p>}</details>
    <section><div className="enc-section-heading"><h2>Care after this encounter</h2>{treatment?.status==='Completed'&&<RefreshButton title="Reload care tasks" ariaLabel="Reload care tasks" loading={loading} onClick={load}/>}</div>
      {treatment?.status!=='Completed'?<p>Save the Dentist's prescription and follow-up decisions in the documentation. Tasks can be reviewed after completion.</p>:<>
        <h3>Prescriptions</h3><p>{treatment.prescriptionRequired?'Prescription indicated; clinical review and issuance are still separate actions.':'No prescription requirement was recorded.'}</p>
        <EncounterPrescriptions store={store} patientId={publicId} visitId={treatment.visitId} branchId={record.branchId}/>
        <Button variant="soft" onClick={()=>nav('prescriptions')}>Open visit prescriptions</Button>
        <h3>Follow-up</h3><p>{treatment.followupRequired?`Recommended: ${treatment.followupDate||treatment.followupInterval||'date not specified'}${treatment.followupReason?' · '+treatment.followupReason:''}. This is not a booking confirmation.`:'No follow-up requirement was recorded.'}</p>
        {loading&&<p role="status">Loading follow-up tasks…</p>}
        {care?.fu&&!care.fu.ok&&<Notice tone="warning">{care.fu.message||'Follow-up tasks could not be checked.'}</Notice>}
        {care?.fu?.ok&&<><p className="muted-copy">Patient tasks at this branch. The response does not identify which treatment created each task.</p>{care.fu.data.filter(f=>f.patient?.id===publicId&&f.branch?.id===record.branchId).map(f=><p key={f.id}><Status>{f.status}</Status> {f.due_on} · {f.reason}{f.appointment?` · Appointment ${f.appointment.code}`:''}</p>)}</>}
        <Button variant="ghost" onClick={()=>nav('followups')}>Open patient follow-ups</Button>
      </>}
    </section>
  </aside>
}

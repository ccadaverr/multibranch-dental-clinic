import React, { useEffect, useState } from 'react'
import { Button, Notice, Status } from '../components.jsx'
import { patientFollowups } from '../api-client.js'
import { EncounterPrescriptions } from './EncounterPrescriptions.jsx'

export function EncounterCare({ store, encounter, context, setPage }) {
  const { patient, treatment, record } = encounter
  const publicId=record.patientPublicId || patient.id
  const [care,setCare]=useState(null), [attempt,setAttempt]=useState(0)
  useEffect(()=>{
    let live=true;setCare(null)
    if(treatment?.status!=='Completed')return()=>{live=false}
    patientFollowups(publicId).then(fu=>{if(live)setCare({fu})}).catch(()=>{if(live)setCare({fu:{ok:false}})})
    return()=>{live=false}
  },[publicId,treatment?.id,treatment?.revision,attempt])
  const prior=store.state.treatments.filter(t=>t.server&&!t.summaryOnly&&t.patientId===patient.id&&t.status==='Completed'&&t.id!==treatment?.id)
  const nav=(page)=>setPage(page,{...context,patientId:patient.id,patientPublicId:publicId,returnEncounter:context})
  return <aside className="enc-care" aria-label="Patient context and care tasks">
    <h2>Patient context</h2>
    <Notice title="Medical alerts unavailable">Verify allergies, medications and medical history through the clinic's approved process. No absence of risk is implied.</Notice>
    <div className="enc-care-links"><Button variant="soft" onClick={()=>nav('chart')}>Open dental chart</Button><Button variant="ghost" onClick={()=>nav('patients')}>Patient records</Button></div>
    <Button variant="ghost" onClick={()=>setPage('patients',{...context,patientId:patient.id,historyTreatmentId:null,historyTab:true,returnEncounter:context})}>All completed Patient encounters</Button><details><summary>Earlier completed care ({prior.length} loaded)</summary><p className="muted-copy">Authorized server records in the loaded date window.</p>{prior.map(t=><article key={t.id}><h3>{t.date} · {t.dentistName}</h3><p>{t.procedure||'No procedure summary available'}</p><p>{t.notes}</p><Button variant="soft" onClick={()=>setPage('patients',{...context,patientId:patient.id,historyTreatmentId:t.id,returnEncounter:context})}>Review completed encounter</Button></article>)}{!prior.length&&<p>No earlier completed records are loaded.</p>}</details>
    <section><h2>Care after this encounter</h2>
      {treatment?.status!=='Completed'?<p>Save the Dentist's prescription and follow-up decisions in the documentation. Tasks can be reviewed after completion.</p>:<>
        <h3>Prescriptions</h3><p>{treatment.prescriptionRequired?'Prescription indicated; clinical review and issuance are still separate actions.':'No prescription requirement was recorded.'}</p>
        <EncounterPrescriptions store={store} patientId={publicId} visitId={treatment.visitId} branchId={record.branchId}/>
        <Button variant="soft" onClick={()=>nav('prescriptions')}>Open visit prescriptions</Button>
        <h3>Follow-up</h3><p>{treatment.followupRequired?`Recommended: ${treatment.followupDate||treatment.followupInterval||'date not specified'}${treatment.followupReason?' · '+treatment.followupReason:''}. This is not a booking confirmation.`:'No follow-up requirement was recorded.'}</p>
        {care&&!care.fu.ok&&<Notice tone="warning">Follow-up tasks could not be checked.</Notice>}
        {care?.fu.ok&&<><p className="muted-copy">Patient tasks at this branch. The response does not identify which treatment created each task.</p>{care.fu.data.filter(f=>f.patient?.id===publicId&&f.branch?.id===record.branchId).map(f=><p key={f.id}><Status>{f.status}</Status> {f.due_on} · {f.reason}{f.appointment?` · Appointment ${f.appointment.code}`:''}</p>)}</>}
        <Button variant="ghost" onClick={()=>nav('followups')}>Open patient follow-ups</Button>
        {care&&!care.fu.ok&&<Button variant="ghost" onClick={()=>setAttempt(attempt+1)}>Retry care tasks</Button>}
      </>}
    </section>
  </aside>
}

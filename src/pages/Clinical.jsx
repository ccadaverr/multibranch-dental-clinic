import { useClinicalSession } from '../use-clinical-session.js'
import { clinicalSessionKey, encounterKey } from '../encounter.js'
import React, { useState } from 'react'
import { ROLE_INFO } from '../data.js'
import { Button, Card, ConfirmDialog, Field, Modal, Notice, PageHeader, SearchInput, SelectWithOther, Status, Table, Tabs } from '../components.jsx'
import { dateLabel, dentistName, displayTime, patientName } from '../logic.js'
import { publicPatientIdFor } from '../appointment-projection.js'
import '../staff-workflow.css'
import { AppointmentForm } from './Scheduling.jsx'
import { IdCheck } from './CounterIntake.jsx'
import { HandoverPanel } from './Handovers.jsx'
import { FollowupPanel } from './ServerFollowups.jsx'
import { ChartView } from './DentalChart.jsx'

import { visibleHmo, HMO_PROVIDERS } from '../phase3-contracts.js'
import { visiblePrescriptions, prescriptionTasks, linkedTreatment, followupDisplayState } from '../phase2.js'
import { inScope, isTodayQueue, patientInScope, sessionForRole } from '../contracts.js'
import { loadPatientRecord, loadPatientRecordIndex, savePatientRecord } from '../patient-records-api.js'
import { commandKey } from '../appointments-api.js'
import { DEFAULT_COUNTRY, normalizePhoneNumber } from '../phone.js'
import { addCalendarMonths, clinicDate } from '../clock.js'
import { fetchDocuments, fetchDocument, submitDocumentUpload, retractDocument, fetchPatientConsents, grantConsent, withdrawConsent, downloadDocumentFile, DOCUMENT_CATEGORIES, CONSENT_TYPES } from '../documents-api.js'

export function PatientsPage(props) {
  const allowed=useClinicalSession(props.store)
  if(props.role==='dentist'&&!allowed)return <Notice>Clinical session unavailable. Patient information is hidden.</Notice>
  return <PatientRecordsBody key={clinicalSessionKey(props.store.session)+encounterKey(props.context)} {...props}/>
}
function PatientRecordsBody({ role, store, context, setPage }) {
  const { state, actions, toast, log }=store
  const session=store.session||sessionForRole(role,state)
  // M4 boundary: in a server-authenticated session only authoritative server Patients (public ids) are listed. The browser
  // collections (demo fixtures and local projections) stay in state for unfinished modules but are never shown here.
  const serverSession=!!session?.serverUserId
  const availablePatients=state.patients.filter(p=>(!serverSession||p.serverProjection)&&patientInScope(p,state,session))
  const branches=state.branches.filter(b=>role==='owner'||(session.branchScopes?session.branchScopes.includes(b.id):b.id===session.branchId))
  const [branchFilter,setBranchFilter]=useState('All')
  const [selected,setSelected]=useState(context?.patientId||availablePatients[0]?.id||'')
  React.useEffect(()=>{if(context?.patientId)setSelected(context.patientId)},[context?.patientId])
  const [bookingPatient,setBookingPatient]=useState(null)
  const [tab,setTab]=useState('summary')
  const [search,setSearch]=useState('')
  const filteredPatients=availablePatients.filter(p=>{
    if(branchFilter!=='All'&&p.preferredBranch!==branchFilter)return false
    const term=search.trim().toLowerCase()
    if(!term)return true
    return `${p.name} ${p.patientCode||''} ${p.phone||''}`.toLowerCase().includes(term)
  })
  const [newOpen,setNewOpen]=useState(false)
  const [newPatient,setNewPatient]=useState({firstName:'',lastName:'',dob:'',sex:'Female',sexOther:'',phone:'',email:'',address:'',preferredBranch:'Dr. Dana Roxas Dental Clinic',hmo:'None',hmoMember:'—',allergies:'None',medicalHistory:'',dentalHistory:'',emergencyContact:'',consent:false,createPortalAccount:false})
  const patient=availablePatients.find(p=>p.id===selected)
  const serverPatient=serverSession&&!!patient?.serverProjection
  const [searchError,setSearchError]=useState('')
  const [searchAttempt,setSearchAttempt]=useState(0)
  const [registering,setRegistering]=useState(false)
  React.useEffect(()=>{
    setSearchError('')
    if(!(serverSession&&role!=='dentist'&&search.trim().length>=2))return undefined
    let live=true
    const t=setTimeout(async()=>{const result=await store.appointmentFlow?.searchPatients(search);if(live&&result&&result.ok===false)setSearchError(result.message||'The patient directory could not be loaded.')},250)
    return ()=>{live=false;clearTimeout(t)}
  },[search,serverSession,role,searchAttempt])
  const visits=state.appointments.filter(a=>a.patientId===selected&&inScope(a,session,state)).sort((a,b)=>`${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`))
  // M5: server Treatments (already scoped by the server) first, then read-only pre-server history.
  const treatments=state.treatments.filter(t=>t.patientId===selected&&(!serverSession||t.server&&!t.summaryOnly)).sort((a,b)=>Number(!!b.server)-Number(!!a.server)||String(b.date).localeCompare(String(a.date)))
  const hmo=visibleHmo(state,session).filter(h=>h.patientId===selected)
  const encounter=state.queue.find(q=>q.id===context?.queueEntryId&&q.patientId===selected&&inScope(q,session,state)&&isTodayQueue(q))
  const saveRecord=({person,patient:patientPatch})=>{
    const result=actions.updatePatientRecord(selected,{person,patient:patientPatch})
    if(!result.ok)return toast(result.message,'warning')
    log(role==='dentist'?ROLE_INFO.dentist.name:ROLE_INFO.staff.name,`Updated permitted patient record fields ${selected}`,'patient')
    toast('Patient record updated.','success')
  }
  const emptyRegistration={firstName:'',lastName:'',phone:'',email:'',dob:''}
  const [registration,setRegistration]=useState(emptyRegistration)
  const [registrationError,setRegistrationError]=useState('')
  const registrationKey=React.useRef(commandKey())
  const updateRegistration=(key,value)=>{registrationKey.current=commandKey();setRegistrationError('');setRegistration(previous=>({...previous,[key]:value}))}
  const registerOnServer=async()=>{
    if(role!=='staff'||registering)return
    const phone=registration.phone.trim()?normalizePhoneNumber(DEFAULT_COUNTRY.dial,registration.phone):{ok:true,e164:''}
    if(!registration.firstName.trim()||!registration.lastName.trim())return setRegistrationError('Enter the patient’s first and last name.')
    if(!phone.ok)return setRegistrationError(phone.reason)
    setRegistering(true)
    const result=await store.appointmentFlow.registerPatient({...registration,firstName:registration.firstName.trim(),lastName:registration.lastName.trim(),phone:phone.e164,email:registration.email.trim()},registrationKey.current)
    setRegistering(false)
    if(!result.ok)return setRegistrationError(result.message)
    toast(`Patient ${result.patient.name} registered (${result.patient.patientCode}).`,'success')
    setSelected(result.patient.id);setTab('summary');setNewOpen(false);setRegistration(emptyRegistration);registrationKey.current=commandKey()
  }
  const createPatient=()=>{
    if(role!=='staff')return
    if(serverSession)return
    const result=actions.createPatientRecord({
      person:{firstName:newPatient.firstName,lastName:newPatient.lastName,dob:newPatient.dob,sex:newPatient.sex,sexOther:newPatient.sexOther,phone:newPatient.phone,email:newPatient.email,address:newPatient.address},
      patient:{preferredBranch:newPatient.preferredBranch,allergies:newPatient.allergies,medicalHistory:newPatient.medicalHistory,dentalHistory:newPatient.dentalHistory,emergencyContact:newPatient.emergencyContact,consent:newPatient.consent},
      createPortalAccount:newPatient.createPortalAccount
    })
    if(!result.ok)return toast(result.message,'warning')
    toast(result.record.userId?'Patient record and portal account created.':'Centralized patient record created.','success')
    setSelected(result.record.id);setNewOpen(false)
    setNewPatient({firstName:'',lastName:'',dob:'',sex:'Female',sexOther:'',phone:'',email:'',address:'',preferredBranch:'Dr. Dana Roxas Dental Clinic',hmo:'None',hmoMember:'—',allergies:'None',medicalHistory:'',dentalHistory:'',emergencyContact:'',consent:false,createPortalAccount:false})
  }
  const tabs=[{key:'summary',label:'Summary'},{key:'visits',label:'Visit history',count:visits.length},{key:'clinical',label:'Clinical',count:treatments.length},{key:'hmo',label:'HMO',count:hmo.length},{key:'documents',label:'Documents'}]
  return <>
    {role==='dentist'&&context?.returnEncounter&&<Button variant="ghost" onClick={()=>setPage('treatment',context.returnEncounter)}>Return to encounter</Button>}
    <PageHeader title="Centralized Patient Records" text="Identity and contact details are shared across the patient record. Staff may maintain approved demographics; dentists see those fields read-only and edit only clinical information." aside={role==='dentist'&&encounter&&(['Called','Treatment Ready'].includes(encounter.status)||encounter.status==='Served'&&encounter.visitStatus==='In Treatment')?<Button onClick={()=>setPage('treatment',context)}>{encounter.treatmentId?'Continue Treatment':'Open Treatment'}</Button>:null}/>
    {!patient&&!serverSession?<Notice>The selected patient is unavailable in your current scope. {availablePatients.length>0&&<Button onClick={()=>setSelected(availablePatients[0].id)}>Open an available patient</Button>}{role==='staff'&&<Button onClick={()=>setNewOpen(true)}>New Patient</Button>}</Notice>:<div className="records-layout">
      <Card className="patient-list" title="Patients" subtitle={`${filteredPatients.length} on file`} actions={role==='staff'?<Button size="sm" onClick={()=>setNewOpen(true)}>New Patient</Button>:null}>
        <SearchInput className="search-input" ariaLabel="Search patients" placeholder={serverSession&&role!=='dentist'?'Search the clinic directory…':'Search patient...'} value={search} onChange={setSearch} onClear={()=>setSearch('')}/>
        {branches.length>1&&<select className="filter-select" style={{width:'100%',margin:'6px 0 2px'}} aria-label="Filter patients by branch" value={branchFilter} onChange={e=>setBranchFilter(e.target.value)}>
          <option value="All">All branches</option>
          {branches.map(b=><option key={b.id} value={b.name}>{b.name}</option>)}
        </select>}
        {searchError&&<Notice tone="warning" title="Patient search unavailable">{searchError} <Button size="sm" variant="ghost" onClick={()=>setSearchAttempt(searchAttempt+1)}>Retry</Button></Notice>}
        {serverSession&&availablePatients.length===0&&!searchError&&<p className="muted">{role==='dentist'?'Patients appear here from your appointments and queue.':'Type at least 2 characters to search the clinic patient directory.'}</p>}
        <div className="patient-list-scroll">{filteredPatients.length?filteredPatients.map(p=><button key={p.id} className={selected===p.id?'selected':''} onClick={()=>{setSelected(p.id);setTab('summary')}}><span className="avatar">{p.name.split(' ').map(x=>x[0]).slice(0,2).join('')}</span><div><b>{p.name}</b><small>{p.serverProjection?p.patientCode:`${p.patientCode||p.id} • ${p.preferredBranch} • ${p.hmo}`}</small></div></button>):<p className="muted" style={{padding:'12px 8px'}}>No matching patients found.</p>}</div>
      </Card>
      {patient?      <div>
        <Card className={role==='staff'?'patient-header-card staff-workflow-record-header':'patient-header-card'} actions={role==='staff'&&session.role==='staff'?<Button disabled={!publicPatientIdFor(patient.id,{session,users:state.users,patients:state.patients})} onClick={()=>setBookingPatient(patient.id)}>Book Appointment</Button>:null}><div className="patient-record-head"><div className="avatar xl">{patient.name.split(' ').map(x=>x[0]).slice(0,2).join('')}</div><div><h2>{patient.name}</h2><p>{patient.serverProjection?patient.patientCode:<>{patient.patientCode||patient.id} • {patient.dob||'DOB not set'} • {patient.sex||'—'} • {patient.preferredBranch}</>}</p><div className="chip-row">{!patient.serverProjection&&<span className="mini-chip">Allergies: {patient?.['allergies']}</span>}{patient.consent&&<span className="mini-chip success">Consent on file</span>}</div></div></div></Card>
        <Tabs tabs={tabs} active={tab} onChange={setTab}/>
        {tab==='summary'&&(role==='dentist'?<DentistPatientSummary key={patient.id} patient={patient}/>:serverPatient
          ?<ServerPatientSummary key={patient.id} patient={patient} role={role} branches={state.branches} toast={toast} store={store}/>
          :<SummaryTab key={patient.id} patient={patient} role={role} onSave={saveRecord}/>)}
        {role==='staff'&&!publicPatientIdFor(patient.id,{session,users:state.users,patients:state.patients})&&<Notice>This patient has no verified clinic server identity. Select a server-backed record before booking.</Notice>}
        {tab==='visits'&&<Card title="Cross-branch visit history"><Table rows={visits} columns={[{key:'date',label:'Date',render:a=>dateLabel(a.date)},{key:'branch',label:'Branch'},{key:'service',label:'Service'},{key:'dentist',label:'Dentist',render:a=>dentistName(a.dentistId,state.dentists)},{key:'status',label:'Status',render:a=><Status>{a.status}</Status>}]} /></Card>}
        {tab==='clinical'&&<Card title="Treatment history" subtitle={role==='dentist'?'Clinic server records you may read: your own treatments and, while you treat this patient, their earlier completed treatments. Read-only unless you are the treating Dentist.':'Staff read-only clinical record'}>{treatments.length?treatments.map(t=><div className="clinical-history" key={t.id}><div><b>{dateLabel(t.date)} • {t.procedure||t.plan||'Treatment in progress'}</b>{t.complaint&&<p>Complaint: {t.complaint}</p>}{t.plan&&<p>Plan: {t.plan}</p>}{t.notes&&<p>{t.notes}</p>}{Array.isArray(t.procedures)&&t.procedures.length>0&&<p>{t.procedures.map(p=>`${p.serviceName||state.services.find(s=>s.id===p.serviceId)?.name||'Service'} × ${p.quantity}`).join(', ')}</p>}<small>{t.dentistName||dentistName(t.dentistId,state.dentists)} • {t.status}</small>{!t.server&&<small className="block-muted">{t.legacyAppointment?'Historical demo record':'Recorded before server treatment records'} — read-only</small>}</div><Status>{t.status}</Status></div>):<Notice>No treatment history recorded.</Notice>}</Card>}
        {tab==='hmo'&&<Card title="HMO record" subtitle="Server HMO cases for this patient's visits; earlier browser records are marked as history. Membership is recorded in HMO Management."><Table rows={hmo} columns={[{key:'provider',label:'Provider'},{key:'memberId',label:'Member ID'},{key:'clinicDate',label:'Visit',render:h=>h.clinicDate?dateLabel(h.clinicDate):h.legacy?'Earlier record':'—'},{key:'eligibility',label:'Eligibility',render:h=><Status>{h.eligibility}</Status>},{key:'status',label:'Status',render:h=><Status>{h.status}</Status>}]} /></Card>}
        {tab==='documents'&&<PatientDocumentsTab patient={patient} role={role} store={store}/>}
      </div>:<Card title="Patient record"><p>Select a patient from the list to open their record.</p></Card>}
    </div>}
    <Modal open={!!bookingPatient} onClose={()=>setBookingPatient(null)} title="Book Appointment" wide>
      {bookingPatient&&role==='staff'&&session.role==='staff'&&(()=>{
        const selectedPatient=availablePatients.find(p=>p.id===bookingPatient)
        const publicId=selectedPatient&&publicPatientIdFor(selectedPatient.id,{session,users:state.users,patients:state.patients})
        return publicId?<AppointmentForm key={bookingPatient} role={role} store={store} prefill={{patientPublicId:publicId,patientName:selectedPatient.name}} onSaved={()=>setBookingPatient(null)}/>:<Notice>The selected patient is unavailable for booking. Close this form and select an accessible server-backed patient.</Notice>
      })()}
    </Modal>
    {serverSession?<Modal open={newOpen} onClose={()=>setNewOpen(false)} title="Register patient" subtitle="Creates one clinic-wide patient record on the clinic server (no login account). If the email is already on file, select that patient instead."><div className="form-grid">
      <Field label="First name" required><input value={registration.firstName} onChange={e=>updateRegistration('firstName',e.target.value)}/></Field>
      <Field label="Last name" required><input value={registration.lastName} onChange={e=>updateRegistration('lastName',e.target.value)}/></Field>
      <Field label="Mobile number" hint="Optional. 10 digits starting with 9 (no leading 0)."><input inputMode="tel" value={registration.phone} maxLength={10} placeholder="9171234567" onChange={e=>updateRegistration('phone',e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10))}/></Field>
      <Field label="Email" hint="Optional."><input type="email" value={registration.email} onChange={e=>updateRegistration('email',e.target.value)}/></Field>
      <Field label="Date of birth" hint="Up to 120 years old"><input type="date" min={addCalendarMonths(clinicDate(), -12 * 120)} max={clinicDate()} value={registration.dob} onChange={e=>updateRegistration('dob',e.target.value)}/></Field>
      {registrationError&&<div className="span-2"><Notice tone="warning">{registrationError}</Notice></div>}
      <Button className="span-2" disabled={registering} onClick={registerOnServer}>{registering?'Registering…':'Register patient'}</Button>
    </div></Modal>:<Modal open={newOpen} onClose={()=>setNewOpen(false)} title="Create patient record" subtitle="Identity/contact fields create one PERSON record; PATIENTS stores only patient-specific information." wide><div className="form-grid">
      <Field label="First name" required><input value={newPatient.firstName} onChange={e=>setNewPatient({...newPatient,firstName:e.target.value})}/></Field>
      <Field label="Last name" required><input value={newPatient.lastName} onChange={e=>setNewPatient({...newPatient,lastName:e.target.value})}/></Field>
      <Field label="Phone" required><input value={newPatient.phone} maxLength={10} placeholder="9171234567" onChange={e=>setNewPatient({...newPatient,phone:e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 10)})}/></Field>
      <Field label="Date of birth"><input type="date" min={addCalendarMonths(clinicDate(), -12 * 120)} max={clinicDate()} value={newPatient.dob} onChange={e=>setNewPatient({...newPatient,dob:e.target.value})}/></Field>
      <SelectWithOther label="Sex" value={newPatient.sex} onChange={val=>setNewPatient(patient=>({...patient,sex:val}))} options={['Female','Male','Other']} otherValue={newPatient.sexOther} onOtherChange={val=>setNewPatient(patient=>({...patient,sexOther:val}))} placeholder="Please specify sex / gender"/>
      <Field label="Email"><input type="email" value={newPatient.email} onChange={e=>setNewPatient({...newPatient,email:e.target.value})}/></Field>
      <Field label="Preferred branch"><select value={newPatient.preferredBranch} onChange={e=>setNewPatient({...newPatient,preferredBranch:e.target.value})}>{state.branches.filter(b=>role==='owner'||b.id===session.branchId).map(b=><option key={b.id}>{b.name}</option>)}</select></Field>
      <Field label="Address"><textarea value={newPatient.address} onChange={e=>setNewPatient({...newPatient,address:e.target.value})}/></Field>
      <Field label="Emergency contact"><textarea value={newPatient.emergencyContact} onChange={e=>setNewPatient({...newPatient,emergencyContact:e.target.value})}/></Field>
      <Field label="HMO provider"><select value={newPatient.hmo||'None'} onChange={e=>setNewPatient({...newPatient,hmo:e.target.value})}><option value="None">None</option>{HMO_PROVIDERS.filter(p=>!p.legacy).map(p=><option key={p.id} value={p.name}>{p.name}</option>)}</select></Field>
      <label className="check-control"><input type="checkbox" checked={newPatient.consent} onChange={e=>setNewPatient({...newPatient,consent:e.target.checked})}/><span><b>Consent recorded</b><small>Frontend marker only; real consent evidence is stored separately.</small></span></label>
      <label className="check-control"><input type="checkbox" checked={newPatient.createPortalAccount} onChange={e=>setNewPatient({...newPatient,createPortalAccount:e.target.checked})}/><span><b>Create patient portal account</b><small>Optional. A patient record may exist without a login.</small></span></label>
      <Button className="span-2" disabled={newPatient.sex==='Other'&&!(newPatient.sexOther||'').trim()} onClick={createPatient}>Create Central Patient Record</Button>
    </div></Modal>}
  </>
}

function SummaryTab({ patient, role, onSave }) {
  const [form,setForm]=useState(patient)
  React.useEffect(()=>setForm(patient),[patient.id,patient.firstName,patient.lastName,patient.phone,patient.email,patient?.['allergies'],patient?.['medicalHistory'],patient?.['dentalHistory']])
  const update=(k,v)=>setForm({...form,[k]:v})
  const staff=role==='staff', dentist=role==='dentist'
  const save=()=>onSave({
    person:staff?{firstName:form.firstName,lastName:form.lastName,phone:form.phone,email:form.email,dob:form.dob,sex:form.sex,address:form.address}:{},
    patient:staff?{preferredBranch:form.preferredBranch,emergencyContact:form.emergencyContact,consent:form.consent}:{allergies:form.allergies,medicalHistory:form.medicalHistory,dentalHistory:form.dentalHistory}
  })
  return <Card title="Patient summary" subtitle={staff?'Staff maintains approved demographics/contact/HMO fields. Clinical history remains read-only.':'Patient identity/contact information is read-only for the dentist; only clinical fields can be updated.'}>
    <div className="form-grid">
      <Field label="Patient code"><input value={form.patientCode||form.id} disabled/></Field>
      <Field label="First name"><input value={form.firstName||''} disabled={dentist} onChange={e=>update('firstName',e.target.value)}/></Field>
      <Field label="Last name"><input value={form.lastName||''} disabled={dentist} onChange={e=>update('lastName',e.target.value)}/></Field>
      <Field label="Preferred branch"><input value={form.preferredBranch||''} disabled={dentist} onChange={e=>update('preferredBranch',e.target.value)}/></Field>
      <Field label="Phone"><input value={form.phone||''} disabled={dentist} onChange={e=>update('phone',e.target.value)}/></Field>
      <Field label="Email"><input value={form.email||''} disabled={dentist} onChange={e=>update('email',e.target.value)}/></Field>
      <Field label="Date of birth"><input type="date" value={form.dob||''} disabled={dentist} onChange={e=>update('dob',e.target.value)}/></Field>
      <Field label="Sex"><input value={form.sex||''} disabled={dentist} onChange={e=>update('sex',e.target.value)}/></Field>
      <Field label="Address"><textarea value={form.address||''} disabled={dentist} onChange={e=>update('address',e.target.value)}/></Field>
      {(form.hmo&&form.hmo!=='None'||form.hmoMember&&form.hmoMember!=='—')&&<Field label="Earlier HMO note" hint="Read-only earlier browser note. HMO membership is recorded on the clinic server in HMO Management."><input value={[form.hmo,form.hmoMember].filter(v=>v&&v!=='None'&&v!=='—').join(' • ')} disabled/></Field>}
      <Field label="Allergies" hint={staff?'Read-only for staff; clinical changes require a dentist.':''}><textarea value={form.allergies||''} disabled={staff} onChange={e=>update('allergies',e.target.value)}/></Field>
      <Field label="Medical history" hint={staff?'Read-only clinical field':''}><textarea value={form.medicalHistory||''} disabled={staff} onChange={e=>update('medicalHistory',e.target.value)}/></Field>
      <Field label="Dental history" hint={staff?'Read-only clinical field':''}><textarea value={form.dentalHistory||''} disabled={staff} onChange={e=>update('dentalHistory',e.target.value)}/></Field>
      <Field label="Emergency contact"><textarea value={form.emergencyContact||''} disabled={dentist} onChange={e=>update('emergencyContact',e.target.value)}/></Field>
      <Button className="span-2" onClick={save}>Save permitted changes</Button>
    </div>
  </Card>
}

// M4: the Patient profile of a server Patient, loaded from and saved to the clinic server. No browser or demo value is ever
// shown as the patient's profile: a failed load is an explicit error with Retry. Only Staff (front desk) may edit, and only
// the non-clinical fields; Dentist and Owner see a read-only projection. Clinical history has no server record yet.
function ServerPatientSummary({ patient, role, branches, toast, store }) {
  if (role === 'dentist') return <DentistPatientSummary patient={patient} toast={toast}/>
  return <StaffPatientSummary patient={patient} role={role} branches={branches} toast={toast} store={store}/>
}

export function DentistPatientSummary({ patient }) {
  return <Card title="Patient summary" subtitle="Identity from your authorized appointments and encounters.">
    <dl className="enc-identity"><div><dt>Patient</dt><dd>{patient.name}</dd></div><div><dt>Patient code</dt><dd>{patient.patientCode || 'Not available'}</dd></div></dl>
    <Notice title="Full patient record not available to Dentists yet">Medical alerts unavailable.There is no clinic-backed medical-alert record available here. Absence of information does not mean no allergies, conditions or medications. Verify the patient's clinical history through the clinic's approved process.</Notice>
    <p className="muted-copy">Earlier versions kept medical notes only in this browser. Those notes are not verified clinic records and are not displayed or changed here. Contact the clinic's authorized records custodian to arrange secure review and recovery.</p>
  </Card>
}

function StaffPatientSummary({ patient, role, branches, toast, store }) {
  const [load,setLoad]=useState({status:'loading',record:null,message:''})
  const [form,setForm]=useState(null)
  const [index,setIndex]=useState(null)
  const [saving,setSaving]=useState(false)
  const [problem,setProblem]=useState(null)
  const [attempt,setAttempt]=useState(0)
  React.useEffect(()=>{
    let live=true
    setLoad({status:'loading',record:null,message:''});setProblem(null)
    Promise.all([loadPatientRecord(patient.id),loadPatientRecordIndex(patient.id)]).then(([record,linked])=>{
      if(!live)return
      if(!record.ok)return setLoad({status:'error',record:null,message:record.message})
      setLoad({status:'ready',record:record.record,message:''});setForm(record.record);setIndex(linked.ok?linked:null)
    })
    return ()=>{live=false}
  },[patient.id,attempt])
  if(load.status==='loading')return <Card title="Patient summary"><p role="status">Loading the patient record from the clinic server…</p></Card>
  if(load.status==='error')return <Card title="Patient summary"><Notice tone="warning" title="Patient record unavailable">{load.message}</Notice><Button className="top-gap" onClick={()=>setAttempt(attempt+1)}>Retry</Button></Card>
  const record=load.record
  const full=record.access==='full'
  const editable=role==='staff'&&full
  const update=(key,value)=>{setProblem(null);setForm({...form,[key]:value})}
  const save=async()=>{
    let next=form
    if(form.phone!==record.phone){
      const phone=form.phone.trim()?normalizePhoneNumber(DEFAULT_COUNTRY.dial,form.phone):{ok:true,e164:''}
      if(!phone.ok)return setProblem({tone:'warning',message:phone.reason})
      next={...form,phone:phone.e164}
    }
    setSaving(true)
    const result=await savePatientRecord(record,next)
    setSaving(false)
    if(!result.ok)return setProblem({tone:'warning',message:result.kind==='conflict'?'This patient record was changed by someone else after you opened it. Reload it to see the latest details before saving again.':result.message,conflict:result.kind==='conflict'})
    setLoad({status:'ready',record:result.record,message:''});setForm(result.record);setProblem(null)
    toast(result.unchanged?'No changes to save.':'Patient record updated.','success')
  }
  const counts=index?.counts
  const subtitle=editable?'Staff maintains the non-clinical profile on the clinic server. Clinical history is not edited here.':full?'Read-only.':'Identity only. The full profile is shown to Staff for patients with an appointment or visit at their branches.'
  return <Card title="Patient summary" subtitle={subtitle}>
    <div className="form-grid">
      <Field label="Patient code"><input value={record.patientCode} disabled/></Field>
      <Field label="First name"><input value={form.firstName} disabled={!editable} onChange={e=>update('firstName',e.target.value)}/></Field>
      <Field label="Last name"><input value={form.lastName} disabled={!editable} onChange={e=>update('lastName',e.target.value)}/></Field>
      {record.preferredBranchId!==undefined&&<Field label="Preferred branch"><select value={form.preferredBranchId||''} disabled={!editable} onChange={e=>update('preferredBranchId',e.target.value||null)}><option value="">No preference</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
      <Field label="Mobile number" hint={editable?'10 digits after +63.':undefined}><input inputMode="tel" value={form.phone} disabled={!editable} onChange={e=>update('phone',e.target.value)}/></Field>
      {record.email!==undefined&&<Field label="Email" hint={record.hasPortalAccount?'This patient has a portal account; their email is changed through account management.':undefined}><input type="email" value={form.email} disabled={!editable||record.hasPortalAccount} onChange={e=>update('email',e.target.value)}/></Field>}
      <Field label="Date of birth"><input type="date" value={form.dob} disabled={!editable} onChange={e=>update('dob',e.target.value)}/></Field>
      {record.sex!==undefined&&<Field label="Sex"><input value={form.sex} disabled={!editable} onChange={e=>update('sex',e.target.value)}/></Field>}
      {record.address!==undefined&&<Field label="Address"><textarea value={form.address} disabled={!editable} onChange={e=>update('address',e.target.value)}/></Field>}
      {record.emergencyContact!==undefined&&<Field label="Emergency contact"><textarea value={form.emergencyContact} disabled={!editable} onChange={e=>update('emergencyContact',e.target.value)}/></Field>}
      {record.hmoProviderName!==undefined&&<Field label="HMO provider"><select value={form.hmoProviderName||''} disabled={!editable} onChange={e=>update('hmoProviderName',e.target.value||null)}><option value="">None / Not recorded</option>{HMO_PROVIDERS.filter(p=>!p.legacy).map(p=><option key={p.id} value={p.name}>{p.name}</option>)}</select></Field>}
      {record.hmoMemberNumber!==undefined&&<Field label="HMO member number"><input value={form.hmoMemberNumber||''} disabled={!editable} onChange={e=>update('hmoMemberNumber',e.target.value||null)} placeholder="e.g. 123456789"/></Field>}
      <div className="span-2"><Notice tone="info" title="Clinical history">Allergies, medical history and dental history are not stored on the clinic server yet, so they are not shown or editable here. They change only through an authorized Dentist workflow.</Notice></div>
      {counts&&<div className="span-2"><Notice tone="info" title="Linked records">{[['appointments','appointments'],['visits','visits'],['treatments','treatments'],['invoices','invoices'],['hmo_cases','HMO cases']].map(([key,label])=>`${counts[key]} ${label}`).join(' • ')}{index.limit&&Object.values(counts).some(n=>n>=index.limit)?` (showing up to ${index.limit} per list)`:''}. These records are kept in their own modules and open from the tabs above.</Notice></div>}
      {problem&&<div className="span-2"><Notice tone={problem.tone} title={problem.conflict?'Record changed':undefined}>{problem.message}{problem.conflict&&<> <Button size="sm" variant="ghost" onClick={()=>setAttempt(attempt+1)}>Reload record</Button></>}</Notice></div>}
      {editable&&<Button className="span-2" disabled={saving} onClick={save}>{saving?'Saving…':'Save changes'}</Button>}
      {editable&&<div className="span-2"><IdCheck patientId={patient.id} toast={toast}/></div>}
      {role==='staff'&&<div className="span-2"><HandoverPanel patientId={patient.id} toast={toast}/></div>}
      {role==='staff'&&full&&<div className="span-2"><section className="st-panel" aria-label="Dental chart"><h3 className="st-sub">Dental chart (read-only)</h3><ChartView patientId={patient.id} canRecord={false} toast={toast} store={store}/></section></div>}
      {role==='staff'&&full&&<div className="span-2"><FollowupPanel patientId={patient.id} toast={toast} store={store} branches={(branches||[]).filter(b=>b.status!=='Closed')}/></div>}
    </div>
  </Card>
}

function PatientDocumentsTab({ patient, role, store }) {
  const { toast, session } = store
  const [docs, setDocs] = useState([])
  const [consents, setConsents] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [retractTarget, setRetractTarget] = useState(null)
  const [retractReason, setRetractReason] = useState('')
  const [consentOpen, setConsentOpen] = useState(false)
  const [withdrawTarget, setWithdrawTarget] = useState(null)
  const [consentForm, setConsentForm] = useState({ consent_type: 'general_treatment', version: '1.0', notes: '' })
  const [fileToUpload, setFileToUpload] = useState(null)
  const [uploadCategory, setUploadCategory] = useState('clinical_attachment')
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploading, setUploading] = useState(false)
  const [expandedExtraction, setExpandedExtraction] = useState(null)
  const [extractionDetail, setExtractionDetail] = useState({})
  const [loadError, setLoadError] = useState('')
  const [consentError, setConsentError] = useState('')
  const [branchChoice, setBranchChoice] = useState('')
  const uploadKey = React.useRef(commandKey())
  // Staff upload into a branch they are authorized for; the server re-checks the scope.
  const branchOptions = (session?.branchScopes || []).map(id => ({ id, name: store.state.branches.find(b => b.id === id)?.name || id }))
  const uploadBranchId = branchChoice || branchOptions[0]?.id || ''
  const isStaff = role === 'staff'

  // M14 callers name a Patient by public_id only; a browser-only record has none and so loads no server documents.
  const patientIdentifier = patient?.publicId || null

  const reload = async () => {
    setLoading(true)
    setLoadError('')
    setConsentError('')
    if (!patientIdentifier) {
      setDocs([]); setConsents([]); setLoading(false)
      return setLoadError('This record has no clinic-server identity, so its documents cannot be loaded.')
    }
    const [documents, consentRecords] = await Promise.allSettled([
      fetchDocuments({ patient_id: patientIdentifier }),
      role === 'dentist' ? Promise.resolve(null) : fetchPatientConsents(patientIdentifier),
    ])
    if (documents.status === 'fulfilled') setDocs(documents.value)
    else { setDocs([]); setLoadError(documents.reason?.message || 'Documents could not be loaded.') }
    if (consentRecords.status === 'fulfilled') setConsents(consentRecords.value || [])
    else { setConsents([]); setConsentError(consentRecords.reason?.message || 'Consent records could not be loaded.') }
    setLoading(false)
  }

  React.useEffect(() => {
    reload()
  }, [patientIdentifier])

  const handleUpload = async (e) => {
    e.preventDefault()
    if (!fileToUpload) return toast('Please select a file to upload.', 'warning')
    const formData = new FormData()
    formData.append('file', fileToUpload)
    formData.append('patient_id', patientIdentifier)
    formData.append('category', uploadCategory)
    if (uploadTitle.trim()) formData.append('title', uploadTitle.trim())
    if (isStaff) {
      if (!uploadBranchId) return toast('You have no authorized branch to upload into.', 'warning')
      formData.append('branch_id', uploadBranchId)
    }

    setUploading(true)
    try {
      await submitDocumentUpload(formData, uploadKey.current)
      toast('Document uploaded successfully.', 'success')
      setUploadOpen(false)
      setFileToUpload(null)
      setUploadTitle('')
      uploadKey.current = commandKey()
      await reload()
    } catch (err) {
      toast(err.message || 'Upload failed.', 'warning')
    } finally {
      setUploading(false)
    }
  }

  const showExtraction = async (doc) => {
    if (expandedExtraction === doc.id) return setExpandedExtraction(null)
    setExpandedExtraction(doc.id)
    if (extractionDetail[doc.id]) return
    try { setExtractionDetail({ ...extractionDetail, [doc.id]: await fetchDocument(doc.id) }) }
    catch (err) { toast(err.message || 'The extracted text could not be loaded.', 'warning'); setExpandedExtraction(null) }
  }

  const handleDownload = async (doc) => {
    try {
      await downloadDocumentFile(doc.id, doc.originalFilename)
    } catch (err) {
      toast(err.message || 'Download failed.', 'warning')
    }
  }

  const handleRetract = async () => {
    if (!retractTarget) return
    if (!retractReason.trim()) return toast('Please provide a reason for retraction.', 'warning')
    try {
      await retractDocument(retractTarget.id, retractReason.trim())
      toast('Document retracted.', 'success')
      setRetractTarget(null)
      setRetractReason('')
      await reload()
    } catch (err) {
      toast(err.message || 'Retraction failed.', 'warning')
    }
  }

  const handleGrantConsent = async (e) => {
    e.preventDefault()
    try {
      await grantConsent(patientIdentifier, consentForm)
      toast('Consent granted on file.', 'success')
      setConsentOpen(false)
      setConsentForm({ consent_type: 'general_treatment', version: '1.0', notes: '' })
      await reload()
    } catch (err) {
      toast(err.message || 'Could not record consent.', 'warning')
    }
  }

  const handleWithdrawConsent = async (consentId) => {
    try {
      await withdrawConsent(patientIdentifier, consentId)
      toast('Consent withdrawn.', 'success')
      await reload()
    } catch (err) {
      toast(err.message || 'Could not withdraw consent.', 'warning')
    }
  }

  const isOwner = role === 'owner'
  const canRetract = doc => isStaff && doc.status === 'Active'

  return <>
    <Card
      title="Patient Documents & Forms"
      subtitle="Private clinic-server storage. A download needs your sign-in and permission for this record. Files are type-checked on upload but are not scanned for malware."
      actions={
        <div style={{ display: 'flex', gap: '8px' }}>
          {isStaff && <Button size="sm" disabled={!uploadBranchId} onClick={() => { uploadKey.current = commandKey(); setUploadOpen(true) }}>Upload Document</Button>}
          {isStaff && <Button size="sm" variant="soft" onClick={() => setConsentOpen(true)}>Record Consent</Button>}
        </div>
      }
    >
      {loading ? <Notice>Loading documents and consents...</Notice> : <>
        {role === 'dentist' && <Notice tone="info" title="Documents for your visits">You see documents attached to visits you are responsible for. Consent records and uploads are not available to Dentists yet (clinic decision pending).</Notice>}
        <div style={{ marginBottom: '20px' }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: '700' }}>Active Consents & Agreements</h4>
          {role === 'dentist' ? null : consentError ? (
            <Notice tone="warning" title="Consent records unavailable">{consentError} <Button size="sm" variant="ghost" onClick={reload}>Retry</Button></Notice>
          ) : consents.length === 0 ? (
            <Notice tone="info">No consent records found for this patient.</Notice>
          ) : (
            <Table
              rows={consents}
              columns={[
                { key: 'consentType', label: 'Consent Type', render: c => c.consentType?.replace(/_/g, ' ') },
                { key: 'version', label: 'Version' },
                { key: 'status', label: 'Status', render: c => <Status>{c.status}</Status> },
                { key: 'signedAt', label: 'Signed Date', render: c => dateLabel(c.signedAt) },
                { key: 'actions', label: 'Actions', render: c => (
                  c.status === 'Granted' && isStaff ? (
                    <Button size="sm" variant="ghost" onClick={() => setWithdrawTarget(c)}>Withdraw</Button>
                  ) : null
                )},
              ]}
            />
          )}
        </div>

        <div>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: '700' }}>Uploaded Patient Documents</h4>
          {loadError ? (
            <Notice tone="warning" title="Documents unavailable">{loadError} <Button size="sm" variant="ghost" onClick={reload}>Retry</Button></Notice>
          ) : docs.length === 0 ? (
            <Notice tone="info">No documents are on file for this patient{role === 'dentist' ? ' on your visits' : ''}.</Notice>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {docs.map(doc => (
                <div
                  key={doc.id}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    backgroundColor: doc.status === 'Retracted' ? 'rgba(0,0,0,0.02)' : 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px', flexWrap: 'wrap' }}>
                        <b style={{ fontSize: '12px' }}>{doc.title}</b>
                        <span className={`mini-chip ${doc.uploadedByPatient ? 'info' : 'brand'}`} style={{ fontSize: '9px', padding: '1px 6px' }}>
                          {doc.uploadedByPatient ? 'Patient upload' : 'Clinic-issued'}
                        </span>
                      </div>
                      <small style={{ color: 'var(--muted)', fontSize: '10px' }}>
                        {doc.originalFilename} • {doc.fileSizeFormatted} • {doc.category?.replace(/_/g, ' ')} • Source: {doc.uploadedByPatient ? 'Patient' : 'Clinic'} • Uploaded {dateLabel(doc.createdAt)}
                      </small>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <Status>{doc.status}</Status>
                      {doc.status === 'Active' && (
                        <>
                          <Button size="sm" variant="soft" onClick={() => handleDownload(doc)}>Download</Button>
                          {canRetract(doc) && <Button size="sm" variant="ghost" onClick={() => { setRetractTarget(doc); setRetractReason('') }}>Retract</Button>}
                        </>
                      )}
                    </div>
                  </div>

                  {doc.status === 'Retracted' && (
                    <Notice tone="warning">
                      Retracted on {dateLabel(doc.retractedAt)}: {doc.retractionReason}
                    </Notice>
                  )}

                  {doc.checksumSha256 && (
                    <small style={{ fontFamily: 'monospace', fontSize: '9px', color: 'var(--muted)' }}>
                      SHA-256: {doc.checksumSha256.slice(0, 16)}...{doc.checksumSha256.slice(-8)}
                    </small>
                  )}

                  {doc.textExtraction === 'draft_available' && doc.extractions.length > 0 ? (
                    <div style={{ marginTop: '4px' }}>
                      <Button size="sm" variant="ghost" onClick={() => showExtraction(doc)}>
                        {expandedExtraction === doc.id ? 'Hide extracted text (draft)' : 'View extracted text (draft)'}
                      </Button>
                      {expandedExtraction === doc.id && (() => {
                        const e = extractionDetail[doc.id]?.extractions?.[0]
                        return <div style={{ marginTop: '8px', padding: '10px', background: '#f8fafc', borderRadius: '6px', fontSize: '11px' }}>
                          <p style={{ margin: '0 0 6px 0', fontWeight: '600', color: 'var(--muted)' }}>
                            Draft — not verified. It is not used for any decision until a person confirms it in the owning workflow. Method: {doc.extractions[0].method === 'native_text' ? 'text read from the PDF (no OCR)' : doc.extractions[0].method}
                          </p>
                          {!e ? <p role="status">Loading the extracted text…</p> : <>
                            {e.rawText && <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '120px', overflow: 'auto', background: '#fff', padding: '8px', borderRadius: '4px', border: '1px solid var(--line)', fontSize: '10px' }}>{e.rawText}</pre>}
                            {e.candidates && <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
                              {[['provider_candidate', 'Provider (candidate)'], ['member_number_candidate', 'Member number (candidate)']].filter(([k]) => e.candidates[k]).map(([k, label]) => <li key={k}><b>{label}</b>: {String(e.candidates[k])}</li>)}
                              {Array.isArray(e.candidates.detected_dates) && e.candidates.detected_dates.length > 0 && <li><b>Dates found</b>: {e.candidates.detected_dates.join(', ')}</li>}
                            </ul>}
                          </>}
                        </div>
                      })()}
                    </div>
                  ) : (
                    <small style={{ color: 'var(--muted)', fontSize: '10px' }}>
                      {doc.textExtraction === 'no_text_layer' ? 'No readable text was found in this PDF.' : 'Text extraction is not available for images (OCR is not set up).'}
                    </small>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </>}
    </Card>

    <Modal open={uploadOpen} onClose={() => !uploading && setUploadOpen(false)} title="Upload Patient Document" subtitle="Files are kept in private clinic storage. They are type-checked but not scanned for malware.">
      <form onSubmit={handleUpload} className="form-grid">
        <Field label="Document File" required hint="PDF, JPG, PNG, or WebP. Max 10MB.">
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={e => {
              const file = e.target.files?.[0]
              setFileToUpload(file || null)
              if (file && !uploadTitle) setUploadTitle(file.name.replace(/\.[^/.]+$/, ''))
            }}
            required
          />
        </Field>
        <Field label="Title / Description">
          <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} placeholder="e.g. National ID or Panoramic X-Ray" />
        </Field>
        <Field label="Category" required>
          <select value={uploadCategory} onChange={e => setUploadCategory(e.target.value)}>
            {DOCUMENT_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        {branchOptions.length > 1 && <Field label="Branch" required hint="The branch this document belongs to.">
          <select value={uploadBranchId} onChange={e => setBranchChoice(e.target.value)}>{branchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </Field>}
        <div className="span-2" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
          <Button type="button" variant="ghost" onClick={() => setUploadOpen(false)} disabled={uploading}>Cancel</Button>
          <Button type="submit" disabled={uploading}>{uploading ? 'Uploading...' : 'Upload Document'}</Button>
        </div>
      </form>
    </Modal>

    <Modal open={!!retractTarget} onClose={() => setRetractTarget(null)} title="Retract Document" subtitle="Retracting revokes download access and marks the record as retracted with an audit trail.">
      <div className="form-grid">
        <Field label="Retraction Reason" required hint="Explain why this document is being retracted (e.g. incorrect patient file, corrupted scan).">
          <textarea value={retractReason} onChange={e => setRetractReason(e.target.value)} placeholder="Provide audit explanation..." rows={3} />
        </Field>
        <div className="span-2" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
          <Button type="button" variant="ghost" onClick={() => setRetractTarget(null)}>Cancel</Button>
          <Button type="button" variant="danger" onClick={handleRetract}>Confirm Retraction</Button>
        </div>
      </div>
    </Modal>

    <Modal open={consentOpen} onClose={() => setConsentOpen(false)} title="Record Patient Consent" subtitle="Records that a consent is on file for this patient. The consent types are the system's current list; the clinic has not yet confirmed its required forms.">
      <form onSubmit={handleGrantConsent} className="form-grid">
        <Field label="Consent Type" required>
          <select value={consentForm.consent_type} onChange={e => setConsentForm({ ...consentForm, consent_type: e.target.value })}>
            {CONSENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Version">
          <input value={consentForm.version} onChange={e => setConsentForm({ ...consentForm, version: e.target.value })} />
        </Field>
        <Field label="Notes / Witness" className="span-2">
          <textarea value={consentForm.notes} onChange={e => setConsentForm({ ...consentForm, notes: e.target.value })} placeholder="Signed in-person at clinic counter..." rows={2} />
        </Field>
        <div className="span-2" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
          <Button type="button" variant="ghost" onClick={() => setConsentOpen(false)}>Cancel</Button>
          <Button type="submit">Record Consent</Button>
        </div>
      </form>
    </Modal>
    <ConfirmDialog
      open={!!withdrawTarget}
      title="Withdraw patient consent?"
      confirmLabel="Withdraw Consent"
      tone="danger"
      onConfirm={async () => {
        const id = withdrawTarget.id
        setWithdrawTarget(null)
        await handleWithdrawConsent(id)
      }}
      onCancel={() => setWithdrawTarget(null)}
    >
      <p>Are you sure you want to withdraw <b>{withdrawTarget?.consentType?.replace(/_/g, ' ')}</b> consent for this patient? This action will mark the consent record as Withdrawn.</p>
    </ConfirmDialog>
  </>
}


export { TreatmentPage } from './EncounterWorkspace.jsx'

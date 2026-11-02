import React, { useEffect, useRef, useState } from 'react'
import { Button, Card, ConfirmDialog, Field, Notice, PageHeader, Status } from '../components.jsx'
import { commandKey } from '../appointments-api.js'
import { clinicalSessionKey, commandGate, encounterContextFor, encounterKey, resolveEncounter } from '../encounter.js'
import { useClinicalSession } from '../use-clinical-session.js'
import { useClinicalProtection } from '../clinical-navigation.jsx'
import { useVisibleRefresh } from '../use-visible-refresh.js'
import { useQueueVisibility } from './QueueCounts.jsx'
import { EncounterCare } from './EncounterCare.jsx'
import '../encounter-workspace.css'

// The editable Treatment form, derived from the server record (or empty before treatment starts). Unsaved changes live
// only in React memory; there are no browser Treatment drafts.
const FOLLOWUP_REASONS = ['Post-Op Check','Suture Removal','Crown / Bridge Fitting','Restoration Polish','Ortho Adjustment','Routine Cleaning / Recall']
const savedFollowupReasonOther = reason => !!reason && !FOLLOWUP_REASONS.includes(reason)
const followupReasonOption = form => form.followupReasonOther ? 'Other' : FOLLOWUP_REASONS.includes(form.followupReason) ? form.followupReason : ''
const chooseFollowupReason = (form, option) => ({...form, followupReason: option === 'Other' ? '' : option, followupReasonOther: option === 'Other'})
const missingFollowupReason = form => form.followupRequired && !form.followupReason.trim()
const treatmentForm=(t,dentist)=>({
  complaint:t?.complaint||'',plan:t?.plan||'',procedure:t?.procedure||'',notes:t?.notes||'',
  assistant:t?t.assistant||'Unassigned':dentist?.assistant||'Unassigned',
  prescriptionRequired:!!t?.prescriptionRequired,followupRequired:!!t?.followupRequired,
  followupDate:t?.followupDate||'',followupReason:t?.followupReason||'',followupReasonOther:savedFollowupReasonOther(t?.followupReason),followupInterval:t?.followupInterval||'',
  procedures:(t?.procedures||[]).map(p=>({id:p.id,serviceId:p.serviceId,quantity:p.quantity,notes:p.notes||''})),
})
const formKey=form=>JSON.stringify({...form,assistant:undefined,procedures:form.procedures.map(p=>({...p,quantity:String(p.quantity)}))})


export function TreatmentPage({ store, context, setPage }) {
  const allowed = useClinicalSession(store)
  if (!allowed) return <Notice title="Clinical session unavailable">Patient information is hidden. Sign in again or return to My Queue.</Notice>
  return <EncounterEditor key={clinicalSessionKey(store.session)+encounterKey(context)} store={store} context={context} setPage={setPage}/>
}
function EncounterEditor({ store, context, setPage }) {
  const { state, session } = store, flow = store.appointmentFlow
  const encounter = resolveEncounter(state, session, context)
  const treatment = encounter.ok ? encounter.treatment : null
  const queueEntry = encounter.ok ? encounter.queue : null
  const dentist = state.dentists.find(d=>d.id===session.dentistId)
  const [base, setBase] = useState(treatment)
  const [form, setForm] = useState(()=>treatmentForm(treatment, dentist))
  const [saving, setSaving] = useState(false), [problem, setProblem] = useState(null)
  const [confirmCompleteOpen, setConfirmCompleteOpen] = useState(false), [reloadOpen, setReloadOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const gate = useRef(commandGate(commandKey)), live = useRef(true)
  useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
  const dirty = formKey(form)!==formKey(treatmentForm(base,dentist))
  const newer = !!treatment && !!base && (treatment.id!==base.id || treatment.revision!==base.revision || treatment.status!==base.status)
  const vis = useQueueVisibility(store)
  const fresh = store.appointmentsStatus==='ready' && !store.appointmentsTruncated && (treatment || vis.mode==='ready')
  useClinicalProtection(dirty, saving)
  useVisibleRefresh(flow?.refresh)
  useEffect(()=>{
    if (encounter.ok && !dirty && !saving && !gate.current.retry && (!base || !treatment || treatment.revision>=base.revision && (base.status!=='Completed'||treatment.status==='Completed'))) { setBase(treatment); setForm(treatmentForm(treatment,dentist)) }
  },[treatment?.id,treatment?.revision,treatment?.status])
  const reloadLatest=()=>{if(base&&treatment&&(treatment.revision<base.revision||base.status==='Completed'&&treatment.status!=='Completed')){setReloadOpen(false);setProblem({message:'An older response was received. Refresh again; the newer record is retained.'});return}gate.current.clear();setBase(treatment);setForm(treatmentForm(treatment,dentist));setProblem(null);setNotice('Latest server record loaded.');setReloadOpen(false)}
  const readOnly = base?.status==='Completed' || !encounter.ok || !!treatment && !encounter.editable
  const canStart = encounter.ok && encounter.canStart
  const followupReasonMissing = missingFollowupReason(form)
  const run=async(mode, retry=false)=>{
    if (!encounter.ok || gate.current.pending || !fresh || (!retry && (newer || readOnly || mode==='start'&&!canStart || mode==='complete'&&dirty))) return
    setSaving(true);setProblem(null);setNotice('')
    const result=await gate.current.run({mode, entry:queueEntry, visit:encounter.visit, treatment:base, form:structuredClone(form)}, attempt=>{
      if(attempt.mode==='start')return flow.startTreatment(attempt.entry, attempt.form, attempt.keys.start, attempt.keys.save, attempt.visit)
      if(attempt.mode==='save')return flow.saveTreatment(attempt.treatment,attempt.form,attempt.keys.save)
      return flow.completeTreatment(attempt.treatment,null,{dirty:false,completeKey:attempt.keys.complete})
    })
    if(!live.current)return
    setSaving(false)
    if (!result.ok) {
      setProblem(result)
      if (result.partial && result.record) setBase(result.record)
      return
    }
    if (!result.record || result.record.visitId!==encounter.record.visitId || result.record.patientId!==encounter.patient.id) {
      setProblem({message:'The command returned no matching refreshed record. Your editor is retained. Refresh before continuing.'}); return
    }
    setBase(result.record);setForm(treatmentForm(result.record,dentist))
    setNotice(result.record.status==='Completed'?'Treatment completion confirmed by the clinic server.':`Saved on the clinic server. Revision ${result.record.revision}.`)
  }
  const line=(index,key,value)=>setForm({...form,procedures:form.procedures.map((p,i)=>i===index?{...p,[key]:value}:p)})
  if(!encounter.ok)return <div className="enc-workspace"><PageHeader title="Encounter unavailable"/><Notice tone="warning">{encounter.message}{dirty&&' Your unsaved editor is retained in memory while you refresh this encounter.'}</Notice><div className="row-actions"><Button onClick={()=>flow?.refresh()}>Refresh encounter</Button><Button variant="ghost" onClick={()=>setPage('queue')}>Back to My Queue</Button></div></div>
  const {patient,record,visit}=encounter
  const navContext=encounterContextFor(treatment||queueEntry)
  const performedServices=state.services.filter(s=>s.status==='Active'&&state.branchServices.some(bs=>bs.branchId===record.branchId&&bs.serviceId===s.id&&bs.active!==false)&&state.dentistServiceAssignments.some(a=>a.dentistId===session.dentistId&&a.serviceId===s.id&&a.isAuthorized!==false))
  return <div className="enc-workspace">
    <div className="enc-breadcrumb"><Button variant="ghost" size="sm" onClick={()=>setPage('queue')}>My Queue</Button><span> / Encounter</span></div>
    <header className="enc-header"><div><p className="enc-eyebrow">{patient.patientCode || 'Patient encounter'}{queueEntry?.queueNumber!=null?` / Queue ${queueEntry.queueNumber}`:''}</p><h1>{patient.name}</h1><p>{state.branches.find(b=>b.id===record.branchId)?.name} · {treatment?.dentistName||dentist?.name} · {visit.clinicDate}</p></div><Status>{base?.status==='Completed'?'Completed':treatment?.status||visit.status}</Status></header>
    <dl className="enc-identity"><div><dt>Visit</dt><dd>{visit.walkIn?'Walk-in':'Appointment'}{record.appointmentId?' · '+(state.appointments.find(a=>a.id===record.appointmentId)?.code||'Scheduled'):''}</dd></div><div><dt>Requested service</dt><dd>{state.services.find(s=>s.id===(queueEntry?.serviceId||treatment?.requestedServiceId))?.name||'Not available'}</dd></div><div><dt>Documentation</dt><dd>{base?`Revision ${base.revision}`:'Not started'}{dirty?' · Unsaved changes':''}</dd></div></dl>
    {!fresh&&<Notice tone="warning">The encounter could not be verified as current. Your text is retained; commands are paused. <Button size="sm" onClick={()=>flow?.refresh()}>Refresh encounter</Button></Notice>}
    {problem&&<Notice tone="warning" title="Command not confirmed">{problem.message}{gate.current.retry&&<><p>Retry sends the same command and documentation. Review the latest record before starting a different command.</p><Button disabled={saving||!fresh} onClick={()=>run(gate.current.retry.mode,true)}>Retry same command</Button><Button variant="ghost" onClick={()=>flow?.refresh()}>Check server record</Button><Button variant="ghost" onClick={()=>setReloadOpen(true)}>Review latest record</Button></>}</Notice>}
    {notice&&<p className="enc-feedback" role="status">{notice}</p>}
    <div className="enc-layout"><section className="enc-documentation" aria-labelledby="enc-documentation-title">
      <h2 id="enc-documentation-title">Clinical documentation</h2>
      {(base?.status==='Completed'||treatment?.status==='Completed')&&<Notice>This encounter is complete and read-only. Completed-record amendment is not available here.</Notice>}
      {newer&&dirty&&<Notice tone="warning" title="A newer version was saved">Your unsaved text is retained below; it is not the latest clinic record. Review the latest version before saving. <Button size="sm" variant="soft" onClick={()=>setReloadOpen(true)}>Review latest record</Button></Notice>}
      <fieldset disabled={readOnly||saving||!!gate.current.retry} style={{border:0,padding:0,margin:0,minWidth:0}}><div className="form-grid one-col">
        <Notice>Confirm the procedures actually performed. The booked service is visit context only.</Notice>
        {form.procedures.map((p,index)=><div className="form-grid" key={p.id||`new-${index}`}>
          <Field label={`Procedure ${index+1}`} required><select value={p.serviceId||''} onChange={e=>line(index,'serviceId',e.target.value)}><option value="">Select performed procedure</option>{performedServices.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}{p.serviceId&&!performedServices.some(s=>s.id===p.serviceId)&&<option value={p.serviceId}>{treatment?.procedures.find(x=>x.id===p.id)?.serviceName||p.serviceId}</option>}</select></Field>
          <Field label="Quantity" required><input type="number" min="1" step="1" value={p.quantity} onChange={e=>line(index,'quantity',e.target.value)}/></Field>
          <Field label="Procedure notes"><input value={p.notes||''} onChange={e=>line(index,'notes',e.target.value)}/></Field>
          <Button variant="ghost" onClick={()=>setForm({...form,procedures:form.procedures.filter((_,i)=>i!==index)})}>Remove procedure {index+1}</Button>
        </div>)}
        <Button variant="ghost" onClick={()=>setForm({...form,procedures:[...form.procedures,{serviceId:'',quantity:1,notes:''}]})}>Add performed procedure</Button>
        <Field label="Chief complaint"><textarea aria-label="Chief complaint" value={form.complaint} onChange={e=>setForm({...form,complaint:e.target.value})}/></Field>
        <Field label="Treatment plan"><textarea aria-label="Treatment plan" value={form.plan} onChange={e=>setForm({...form,plan:e.target.value})}/></Field>
        <Field label="Procedure / treatment performed"><textarea aria-label="Procedure / treatment performed" value={form.procedure} onChange={e=>setForm({...form,procedure:e.target.value})}/></Field>
        <Field label="Assigned assistant" hint="From the dentist profile when treatment started"><input value={form.assistant} readOnly/></Field>
        <Field label="Clinical notes"><textarea aria-label="Clinical notes" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></Field>
        <div className="check-pair"><label><input type="checkbox" checked={form.prescriptionRequired} onChange={e=>setForm({...form,prescriptionRequired:e.target.checked})}/> Dentist indicates prescription required</label><label><input type="checkbox" checked={form.followupRequired} onChange={e=>setForm({...form,followupRequired:e.target.checked})}/> Dentist indicates follow-up required</label></div>
        {form.followupRequired&&<div className="form-grid">
          <Field label="Recommended follow-up date"><input type="date" value={form.followupDate} onChange={e=>setForm({...form,followupDate:e.target.value})}/></Field>
          <Field label="Follow-up reason">
            <select
              aria-label="Follow-up reason"
              value={followupReasonOption(form)}
              onChange={e => setForm(chooseFollowupReason(form,e.target.value))}
            >
              <option value="">Select a reason</option>{[...FOLLOWUP_REASONS,'Other'].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          {form.followupReasonOther && (
            <Field label="Specify reason / instructions" required>
              <input
                value={form.followupReason}
                placeholder="Specify follow-up details..."
                onChange={e => setForm({ ...form, followupReason: e.target.value })}
                aria-required="true"
              />
            </Field>
          )}
          <Field label="Recommended interval"><input value={form.followupInterval} placeholder="e.g. 1 week, 2 weeks" onChange={e=>setForm({...form,followupInterval:e.target.value})}/></Field>
        </div>}
        {!readOnly&&<div className="form-actions">
          {!treatment?<Button disabled={saving||!canStart||followupReasonMissing||!fresh} onClick={()=>run('start')}>Start Treatment</Button>:<>
            <Button variant="ghost" disabled={saving||!dirty||newer||followupReasonMissing||!fresh} onClick={()=>run('save')}>Save Treatment Progress</Button>
            <Button disabled={saving||dirty||newer||followupReasonMissing||!fresh} onClick={()=>setConfirmCompleteOpen(true)}>Complete Treatment</Button></>}
        </div>}
        {!treatment&&queueEntry&&!canStart&&<Notice>Treatment can start once this patient is Called or Ready for treatment.</Notice>}
        {dirty&&!readOnly&&treatment&&<small className="block-muted">Unsaved changes — they are kept only on this screen until you save.</small>}
      </div></fieldset>
      {dirty&&treatment&&!readOnly&&<p className="muted-copy">Save documentation before completing this encounter.</p>}
    </section><EncounterCare store={store} encounter={encounter} context={navContext} setPage={setPage}/></div>
    <ConfirmDialog open={reloadOpen} title="Discard this unsaved draft?" confirmLabel="Discard draft and load latest" onCancel={()=>setReloadOpen(false)} onConfirm={reloadLatest}><p>Your current text will be replaced by the latest loaded server revision. This cannot recover unsaved edits later.</p></ConfirmDialog>
    <ConfirmDialog open={confirmCompleteOpen} title="Complete and finalize this treatment?" confirmLabel="Complete Treatment" tone="primary" onCancel={()=>setConfirmCompleteOpen(false)} onConfirm={()=>{setConfirmCompleteOpen(false);run('complete')}}><p>Finalize the saved documentation for <b>{patient.name}</b>. This closes the encounter and makes it read-only. A prescription requirement does not issue medication; follow-up recommendations do not book an appointment.</p></ConfirmDialog>
  </div>
}

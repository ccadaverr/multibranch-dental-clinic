import React,{useEffect,useRef,useState} from 'react'
import {Button,ConfirmDialog,Field,Notice,RefreshButton,Status} from '../components.jsx'
import {staffRoster,staffRosterCommand,staffRosterHistory,staffDuty} from '../api-client.js'
import {commandKey} from '../appointments-api.js'
import {clinicDate} from '../clock.js'
import {confirmedRoster,validRoster} from '../staff-roster-workflow.js'

const message=r=>Object.values(r?.errors||{})[0]?.[0]||r?.message||'The schedule could not be confirmed.'
const weekdays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
const blank=(date,branch)=>({branch_ref:branch,kind:'weekly',effective_from:date,effective_until:'',weekdays:[],exceptions:[],start_time:'',end_time:''})
const layout=typeof window==='undefined'?useEffect:React.useLayoutEffect

/** Staff schedule workflow inside the established Work schedules role tab. */
export function StaffRosterWorkflow({staff,branches,role,canRequest,getAuthGeneration,onPending,initialDate,onSaved}) {
  const [date,setDate]=useState(()=>initialDate||clinicDate()),[dutyDate,setDutyDate]=useState(clinicDate),[branch,setBranch]=useState(()=>branches.some(b=>b.id===staff.branchRef)?staff.branchRef:branches[0]?.id||'')
  const [row,setRow]=useState(null),[revision,setRevision]=useState(null),[form,setForm]=useState(()=>blank(clinicDate(),branch))
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[conflict,setConflict]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [duty,setDuty]=useState(null),[dutyBusy,setDutyBusy]=useState(false),[dutyError,setDutyError]=useState(''),[history,setHistory]=useState(null),[cursor,setCursor]=useState(null),[historyBusy,setHistoryBusy]=useState(false),[confirm,setConfirm]=useState(null)
  const live=useRef(false),pending=useRef(false),retained=useRef(null),generation=useRef(0),dutyGeneration=useRef(0),reading=useRef(false),historyPending=useRef(false)
  const auth=getAuthGeneration?.(),context=JSON.stringify([staff.id,date,auth]),current=useRef(context);current.current=context
  const dutyKey=JSON.stringify([staff.id,branch,dutyDate,auth]),currentDuty=useRef(dutyKey);currentDuty.current=dutyKey
  const owns=(key,observedAuth)=>live.current&&current.current===key&&observedAuth===getAuthGeneration?.()
  const editable=role==='owner'||canRequest
  const dirty=!!row&&['branch_ref','kind','effective_from','effective_until','start_time','end_time','weekdays','exceptions'].some(k=>JSON.stringify(form[k])!==JSON.stringify(row[k]))
  const locked=busy||uncertain||loading
  useEffect(()=>{onPending?.(busy||uncertain);return()=>onPending?.(false)},[busy,uncertain,onPending])
  const load=async()=>{
    if(!live.current||pending.current||reading.current||!editable)return
    const key=context,observedAuth=auth,ticket=++generation.current;reading.current=ticket;setLoading(true);setError('')
    try{
      const r=await staffRoster(staff.id,date)
      if(!owns(key,observedAuth)||ticket!==generation.current)return
      if(!r.ok||r.meta?.staff_ref!==staff.id||r.meta?.date!==date||r.data!==null&&!validRoster(r.data,staff.id,date)||r.meta?.revision!==(r.data?.revision??0)){setRevision(null);setRow(null);setError(message(r));return}
      setRow(r.data);setRevision(r.meta.revision);setForm(r.data?{...r.data}:blank(date,branch));setConflict(false);setUncertain(false);retained.current=null;setHistory(null);setCursor(null)
    }catch{if(owns(key,observedAuth))setError('Schedule could not be loaded. Try again.')}
    finally{if(reading.current===ticket)reading.current=false;if(owns(key,observedAuth)&&ticket===generation.current)setLoading(false)}
  }
  const loadDuty=async()=>{
    if(!branch||!dutyDate)return
    const key=dutyKey,ticket=++dutyGeneration.current,observedAuth=auth
    setDutyBusy(true);setDutyError('')
    try{
      const r=await staffDuty(staff.id,branch,dutyDate)
      if(!live.current||key!==currentDuty.current||ticket!==dutyGeneration.current||observedAuth!==getAuthGeneration?.())return
      if(!r.ok||r.data?.staff_ref!==staff.id||r.data?.branch_ref!==branch||r.data?.date!==dutyDate||!Array.isArray(r.data.windows)){setDuty(null);setDutyError(message(r));return}
      setDuty(r.data)
    }catch{if(live.current&&key===currentDuty.current&&ticket===dutyGeneration.current&&observedAuth===getAuthGeneration?.())setDutyError('Duty could not be refreshed. Try again.')}
    finally{if(live.current&&key===currentDuty.current&&ticket===dutyGeneration.current)setDutyBusy(false)}
  }
  layout(()=>{live.current=true;reading.current=false;historyPending.current=false;setHistoryBusy(false);setRow(null);setRevision(null);setHistory(null);setNotice('');load();return()=>{live.current=false;generation.current++;reading.current=false}},[context,editable])
  useEffect(()=>{setDuty(null);loadDuty();return()=>{dutyGeneration.current++}},[dutyKey])
  const perform=async(action)=>{
    if(pending.current||(!retained.current&&(revision===null||conflict)))return
    if(!retained.current&&action!=='save'&&dirty)return
    const command=retained.current||{action,reviewed:row,body:{date,expected_revision:revision,operation_id:commandKey(),...(action==='save'?{branch_ref:form.branch_ref,kind:form.kind,effective_from:form.kind==='weekly'?form.effective_from:date,effective_until:form.kind==='weekly'?form.effective_until:date,weekdays:form.kind==='weekly'?form.weekdays:[],exceptions:form.kind==='weekly'?form.exceptions:[],start_time:form.kind==='day_off'?null:form.start_time,end_time:form.kind==='day_off'?null:form.end_time}:{})}}
    const key=context,observedAuth=auth;let confirmed=false;retained.current=command;pending.current=true;setBusy(true);setError('');setNotice('')
    try{
      const r=await staffRosterCommand(staff.id,command.action,command.body,()=>owns(key,observedAuth))
      if(!owns(key,observedAuth))return
      if(!r.ok){const unknown=['network','server'].includes(r.kind);setUncertain(unknown);setConflict(r.kind==='conflict');if(!unknown)retained.current=null;setError(unknown?'The result is uncertain. Retry the original command to recover its recorded outcome.':message(r));return}
      if(!confirmedRoster(r,staff.id,command)){setUncertain(true);setError('The receipt did not match this schedule. Retry the original command.');return}
      setRow(r.data);setForm({...r.data});setRevision(r.data.revision);setUncertain(false);setConflict(false);retained.current=null;setHistory(null)
      confirmed=true
      setNotice(`Confirmed ${r.data.status}, revision ${r.data.revision}.${r.data.status==='Approved'?' Publish separately to change duty.':''}`)
      loadDuty()
      onSaved?.()
    }catch{if(owns(key,observedAuth)){setUncertain(true);setError('The result is uncertain. Retry the original command.')}}
    finally{pending.current=false;if(owns(key,observedAuth)){setBusy(false);if(confirmed)load()}}
  }
  const showHistory=async before=>{
    if(historyPending.current||locked)return
    const key=context,observedAuth=auth,ticket={generation:generation.current};historyPending.current=ticket;setHistoryBusy(true)
    try{const r=await staffRosterHistory(staff.id,date,before);if(!owns(key,observedAuth)||ticket.generation!==generation.current)return
      if(!r.ok||r.meta?.staff_ref!==staff.id||r.meta?.date!==date||!Array.isArray(r.data)||r.data.some(h=>h.draft?.staff_ref!==staff.id||h.draft?.date!==date)){setError('Schedule history could not be matched. Try again.');return}
      setHistory(previous=>before?[...(previous||[]),...r.data.filter(h=>!previous?.some(old=>old.id===h.id))]:r.data);setCursor(r.meta.next_before)
    }catch{if(owns(key,observedAuth)&&ticket.generation===generation.current)setError('Schedule history could not be loaded.')}finally{if(historyPending.current===ticket)historyPending.current=false;if(owns(key,observedAuth)&&ticket.generation===generation.current)setHistoryBusy(false)}
  }
  const change=(k,v)=>setForm(f=>({...f,[k]:v}))
  return <section className="st-gap" aria-label={`Staff roster for ${staff.name}`}>
    <h3>Published Staff duty</h3>
    <div className="st-pair"><Field label="Duty branch"><select aria-label="Duty branch" value={branch} disabled={busy||uncertain} onChange={e=>setBranch(e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field><Field label="Duty date"><input type="date" value={dutyDate} disabled={busy||uncertain} onChange={e=>setDutyDate(e.target.value)}/></Field></div>
    <RefreshButton title="Refresh Staff duty" ariaLabel="Refresh Staff duty" loading={dutyBusy} onClick={loadDuty}/>
    {dutyError&&<p role="alert">{dutyError}</p>}
    {dutyBusy?<p role="status">Loading published duty…</p>:duty&&<div role="region" aria-label="Effective Staff duty"><p><b>{duty.available?'Scheduled and available':'Unavailable / unscheduled'}</b> · {duty.date}</p>{duty.windows.map((w,i)=><p key={i}>{w.start_time}–{w.end_time} · Published revision {w.revision}</p>)}{duty.approved_leave.length>0&&<Notice>Approved leave applies to this date. Only the remaining available hours are shown.</Notice>}{!duty.windows.length&&<p>No effective working hours for this branch and date.</p>}</div>}
    {editable&&<>
      <h3>{role==='owner'?'Staff roster approval and publication':'My schedule change request'}</h3>
      <Notice>Saving records {role==='owner'?'a Draft':'a Pending request'}. Approval and publication are separate Owner actions. Current published duty remains effective while changes are reviewed.</Notice>
      <Field label="Schedule record date" hint="Choose the saved preparation date to review or revise that schedule."><input aria-label="Schedule record date" type="date" value={date} disabled={busy||uncertain} onChange={e=>setDate(e.target.value)}/></Field>
      <RefreshButton title="Reload roster for review" ariaLabel="Reload roster for review" loading={loading} disabled={busy||uncertain} onClick={load}/>
      {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {row&&<p>Current review: <Status>{row.status}</Status> · Revision {row.revision}{row.publication_id&&` · Effective published revision ${row.published_revision}`}</p>}
      {uncertain&&<Button disabled={busy} onClick={()=>perform()}>Retry original roster command</Button>}
      {conflict&&<Button disabled={busy} onClick={load}>Discard entries and reload roster</Button>}
      <form aria-label="Staff roster editor" onSubmit={e=>{e.preventDefault();perform('save')}}>
        <fieldset disabled={locked||conflict||revision===null} style={{border:0,padding:0,minWidth:0}}>
          <div className="st-pair"><Field label="Schedule branch"><select aria-label="Schedule branch" value={form.branch_ref} onChange={e=>change('branch_ref',e.target.value)} required><option value="">Choose branch</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field><Field label="Schedule type"><select aria-label="Schedule type" value={form.kind} onChange={e=>change('kind',e.target.value)}><option value="weekly">Weekly recurrence</option><option value="custom_hours">Date-specific hours</option><option value="day_off">Date-specific day off</option></select></Field></div>
          {form.kind==='weekly'&&<><div className="st-pair"><Field label="Effective from"><input type="date" value={form.effective_from} onChange={e=>change('effective_from',e.target.value)} required/></Field><Field label="Effective through (inclusive)"><input type="date" min={form.effective_from} value={form.effective_until} onChange={e=>change('effective_until',e.target.value)} required/></Field></div><fieldset><legend>Recurring weekdays</legend>{weekdays.map((label,i)=><label className="au-check" key={label}><input type="checkbox" checked={form.weekdays.includes(i+1)} onChange={e=>change('weekdays',e.target.checked?[...form.weekdays,i+1].sort((a,b)=>a-b):form.weekdays.filter(d=>d!==i+1))}/>{label}</label>)}</fieldset></>}
          {form.kind!=='day_off'&&<div className="st-pair"><Field label="Scheduled start"><input type="time" value={form.start_time||''} onChange={e=>change('start_time',e.target.value)} required/></Field><Field label="Scheduled end"><input type="time" value={form.end_time||''} onChange={e=>change('end_time',e.target.value)} required/></Field></div>}
          {form.kind==='weekly'&&<fieldset><legend>Date exceptions in this version</legend>{form.exceptions.map((e,i)=><div key={i} className="st-gap"><Field label={`Exception ${i+1} date`}><input type="date" value={e.date} required onChange={v=>change('exceptions',form.exceptions.map((old,j)=>i===j?{...old,date:v.target.value}:old))}/></Field><Field label={`Exception ${i+1} type`}><select aria-label={`Exception ${i+1} type`} value={e.kind} onChange={v=>change('exceptions',form.exceptions.map((old,j)=>i===j?{...old,kind:v.target.value,start_time:null,end_time:null}:old))}><option value="day_off">Day off</option><option value="custom_hours">Custom hours</option></select></Field>{e.kind==='custom_hours'&&<div className="st-pair">{['start_time','end_time'].map(k=><Field key={k} label={`Exception ${i+1} ${k==='start_time'?'start':'end'}`}><input type="time" required value={e[k]||''} onChange={v=>change('exceptions',form.exceptions.map((old,j)=>i===j?{...old,[k]:v.target.value}:old))}/></Field>)}</div>}<Button variant="ghost" onClick={()=>change('exceptions',form.exceptions.filter((_,j)=>j!==i))}>Remove exception from draft</Button></div>)}<Button variant="soft" onClick={()=>change('exceptions',[...form.exceptions,{date:'',kind:'day_off',start_time:null,end_time:null}])}>Add date exception</Button></fieldset>}
          <Button type="submit">{role==='owner'?'Save roster draft':'Submit schedule request'}</Button>
        </fieldset>
      </form>
      {dirty&&<p role="status">Unsaved changes. Save this version before approval or publication.</p>}
      <div className="row-actions">{role==='owner'&&['Draft','Pending'].includes(row?.status)&&<Button disabled={locked||conflict||dirty} onClick={()=>setConfirm('approve')}>Approve roster</Button>}{role==='owner'&&row?.status==='Approved'&&<Button disabled={locked||conflict||dirty} onClick={()=>setConfirm('publish')}>Publish approved roster</Button>}<Button variant="ghost" disabled={locked||historyBusy} onClick={()=>showHistory()}>Show roster history</Button></div>
      {history&&<div role="region" aria-label="Staff roster history"><ul>{history.map(h=><li key={h.id}>Revision {h.revision} · {h.draft.status} · {h.saved_at}{h.draft.publication_id&&` · Publication ${h.draft.publication_id}`}</li>)}</ul>{cursor&&<Button disabled={historyBusy} onClick={()=>showHistory(cursor)}>Load older roster history</Button>}</div>}
      <ConfirmDialog open={!!confirm} title={confirm==='approve'?'Approve this roster version?':'Publish the approved roster?'} confirmLabel={confirm==='approve'?'Approve roster':'Publish approved roster'} onCancel={()=>setConfirm(null)} onConfirm={()=>{const action=confirm;setConfirm(null);perform(action)}}><p>{confirm==='approve'?'Approval records your review. Duty changes only after a separate publication.':'Publication makes this exact approved version effective within its dates. Approved leave still overrides working hours. Clinical booking is unchanged.'}</p></ConfirmDialog>
    </>}
  </section>
}

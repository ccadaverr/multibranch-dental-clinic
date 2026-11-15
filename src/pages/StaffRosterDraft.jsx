import React, { useEffect, useRef, useState } from 'react'
import { Button, Field, Notice } from '../components.jsx'
import { staffRosterDraft, saveStaffRosterDraft, staffRosterDraftHistory } from '../api-client.js'
import { commandKey } from '../appointments-api.js'
import { clinicDate } from '../clock.js'
import { validRosterDraft, rosterDraftReceipt } from '../staff-roster-draft.js'

const errorText=r=>Object.values(r?.errors||{})[0]?.[0]||r?.message||'The dated draft could not be confirmed.'
const useLayout=typeof window==='undefined'?useEffect:React.useLayoutEffect

/** Owner-only preparation. No source here or in the API publishes duty or changes branch access. */
export function StaffRosterDraft({staff,branches,getAuthGeneration,enabled,onPending}) {
  const [date,setDate]=useState(clinicDate),[branch,setBranch]=useState(staff.branchRef||''),[start,setStart]=useState(''),[end,setEnd]=useState('')
  const [snapshot,setSnapshot]=useState(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [uncertain,setUncertain]=useState(false),[conflict,setConflict]=useState(false),[history,setHistory]=useState(null),[historyBusy,setHistoryBusy]=useState(false)
  const live=useRef(false),generation=useRef(0),pending=useRef(false),retained=useRef(null),current=useRef(null)
  const auth=getAuthGeneration?.(),key=JSON.stringify([staff.id,date,auth,enabled])
  useEffect(()=>{onPending?.(saving||uncertain);return()=>onPending?.(false)},[saving,uncertain,onPending])
  current.current=key
  const own=ticket=>live.current&&enabled&&current.current===ticket.key&&generation.current===ticket.generation&&ticket.auth===getAuthGeneration?.()
  const load=async()=>{
    if(!live.current||!enabled||pending.current||(getAuthGeneration&&auth==null))return
    const ticket={key,auth,generation:++generation.current}
    setLoading(true);setError('');setHistory(null);setHistoryBusy(false)
    try{
      const r=await staffRosterDraft(staff.id,date)
      if(!own(ticket))return
      if(!r.ok||r.meta?.staff_ref!==staff.id||r.meta?.date!==date||r.meta?.publication_available!==false||
        (r.data===null?r.meta.revision!==0:!validRosterDraft(r.data,staff.id,date)||r.meta.revision!==r.data.revision)){setSnapshot(null);setError(errorText(r));return}
      setSnapshot({key,row:r.data,revision:r.meta.revision});setBranch(r.data?.branch_ref||staff.branchRef||'');setStart(r.data?.start_time||'');setEnd(r.data?.end_time||'')
      retained.current=null;setUncertain(false);setConflict(false)
    }catch{if(own(ticket)){setSnapshot(null);setError('The dated draft could not be loaded. Try again.')}}
    finally{if(own(ticket))setLoading(false)}
  }
  useLayout(()=>{live.current=true;load();return()=>{live.current=false;generation.current++}},[key])
  const ready=snapshot?.key===key&&!loading
  const save=async event=>{
    event.preventDefault()
    if(!ready||!enabled||pending.current||conflict)return
    const payload=retained.current||{date,branch_ref:branch,start_time:start,end_time:end,expected_revision:snapshot.revision,operation_id:commandKey()}
    retained.current=payload;pending.current=true;setSaving(true);setError('');setNotice('')
    const ticket={key,auth,generation:generation.current}
    try{
      const r=await saveStaffRosterDraft(staff.id,payload,()=>own(ticket))
      if(!own(ticket))return
      if(!r.ok){const unknown=['network','server'].includes(r.kind);setUncertain(unknown);setConflict(r.kind==='conflict');if(!unknown)retained.current=null;setError(unknown?'The save is uncertain. Your entries are retained. Retry this draft save to recover its original result.':errorText(r));return}
      if(!rosterDraftReceipt(r,staff.id,payload)){setUncertain(true);setError('The draft receipt did not match. Retry this draft save to recover its original result.');return}
      setSnapshot({key,row:r.data,revision:r.data.revision});retained.current=null;setUncertain(false);setConflict(false);setHistory(null)
      setNotice(`Draft revision ${r.data.revision} saved. This is not published duty.`)
    }catch{if(own(ticket)){setUncertain(true);setError('The save is uncertain. Retry this draft save to recover its original result.')}}
    finally{pending.current=false;if(live.current)setSaving(false)}
  }
  const showHistory=async()=>{
    if(!ready||saving||historyBusy)return
    const ticket={key,auth,generation:generation.current};setHistoryBusy(true)
    try{
      const r=await staffRosterDraftHistory(staff.id,date)
      if(!own(ticket))return
      if(!r.ok||r.meta?.staff_ref!==staff.id||r.meta?.date!==date||!Array.isArray(r.data)||r.data.some(row=>!validRosterDraft(row.draft,staff.id,date))){setError('Saved draft history could not be matched. Try again.');return}
      setHistory(r.data)
    }catch{if(own(ticket))setError('Saved draft history could not be loaded.')}
    finally{if(own(ticket))setHistoryBusy(false)}
  }
  return <section className="st-gap" aria-label={`Dated draft for ${staff.name}`}>
    <h3>Dated Staff draft</h3>
    <Notice title="Preparation only">Drafts do not publish duty, change account branch access or affect booking. Recurrence, exceptions and leave/publication rules still require agreement.</Notice>
    <Field label="Draft date"><input type="date" required value={date} disabled={saving||uncertain} onChange={e=>{setNotice('');setDate(e.target.value)}}/></Field>
    {loading&&<p role="status">Loading dated draft…</p>}
    {notice&&<p role="status">{notice}</p>}
    {error&&<p role="alert">{error}</p>}
    {!uncertain&&<Button variant="soft" disabled={saving||loading} onClick={load}>{conflict?'Discard entries and reload draft':'Reload dated draft'}</Button>}
    {ready&&<form onSubmit={save} aria-label={`Prepare dated Staff draft for ${staff.name}`} aria-busy={saving}>
      <fieldset disabled={saving||uncertain||conflict} style={{border:0,padding:0,minWidth:0}}>
        <Field label="Draft branch"><select aria-label="Draft branch" required value={branch} onChange={e=>setBranch(e.target.value)}><option value="">Choose a branch</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <div className="st-pair"><Field label="Draft start"><input required type="time" value={start} onChange={e=>setStart(e.target.value)}/></Field><Field label="Draft end"><input required type="time" value={end} onChange={e=>setEnd(e.target.value)}/></Field></div>
      </fieldset>
      <div className="row-actions"><Button type="submit" disabled={saving||conflict}>{saving?'Saving dated draft…':uncertain?'Retry draft save':'Save dated draft'}</Button>
      <Button variant="ghost" disabled={saving||uncertain||historyBusy} onClick={showHistory}>{historyBusy?'Loading revisions…':'Show saved draft revisions'}</Button></div>
    </form>}
    {history&&<div role="region" aria-label="Saved draft revisions">{history.length?<ul>{history.map(row=><li key={row.id}>Revision {row.revision} · {row.draft.branch_name} · {row.draft.start_time}–{row.draft.end_time} · {row.saved_at} · Draft only</li>)}</ul>:<p>No saved revisions for this Staff member and date.</p>}</div>}
  </section>
}

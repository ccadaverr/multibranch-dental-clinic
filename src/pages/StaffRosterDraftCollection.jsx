import React,{useEffect,useRef,useState} from 'react'
import {Button,Field,Notice,RefreshButton,Status} from '../components.jsx'
import '../staff-roster-operations.css'
import {staffRosterDrafts,staffRosters} from '../api-client.js'
import {clinicDate} from '../clock.js'
import {validRosterDraft} from '../staff-roster-draft.js'
import {validRoster} from '../staff-roster-workflow.js'

const layout=typeof window==='undefined'?useEffect:React.useLayoutEffect
export function StaffRosterDraftCollection({branches,getAuthGeneration,disabled,onReview,refreshKey,workflow=false}) {
  const [branch,setBranch]=useState(branches[0]?.id||''),[date,setDate]=useState(clinicDate)
  const [snapshot,setSnapshot]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('')
  const live=useRef(false),generation=useRef(0),current=useRef(''),pending=useRef(null)
  const auth=getAuthGeneration?.(),key=JSON.stringify([branch,date,auth,refreshKey]);current.current=key
  const load=async before=>{
    if(!live.current||!branch||!date||(getAuthGeneration&&auth==null)||pending.current)return
    const ticket={key,auth,generation:++generation.current};pending.current=ticket;setLoading(true);setError('')
    const owns=()=>live.current&&current.current===ticket.key&&generation.current===ticket.generation&&ticket.auth===getAuthGeneration?.()
    try{
      const r=await (workflow?staffRosters:staffRosterDrafts)(branch,date,before)
      if(!owns())return
      const ids=new Set(),valid=r.ok&&r.meta?.branch_ref===branch&&r.meta?.date===date&&(workflow?r.meta?.workflow_available===true:r.meta?.publication_available===false)&&Array.isArray(r.data)&&r.data.every(row=>{
        if(typeof row.staff_ref!=='string'||!row.staff_ref||row.branch_ref!==branch||!(workflow?validRoster(row,row.staff_ref,row.date):validRosterDraft(row,row.staff_ref,date))||ids.has(row.id))return false
        ids.add(row.id);return true
      })&&(r.meta.next_before===null||typeof r.meta.next_before==='string')
      if(!valid){setError(r.message||'Draft collection could not be matched. Reload before reviewing.');return}
      setSnapshot(previous=>({key,rows:before&&previous?.key===key?[...previous.rows,...r.data.filter(row=>!previous.rows.some(old=>old.id===row.id))]:r.data,cursor:r.meta.next_before}))
    }catch{if(owns())setError('Draft collection could not be loaded. Try again.')}
    finally{if(pending.current===ticket)pending.current=null;if(owns())setLoading(false)}
  }
  layout(()=>{live.current=true;pending.current=null;setSnapshot(null);setLoading(false);load();return()=>{live.current=false;generation.current++;pending.current=null}},[key])
  const shown=snapshot?.key===key?snapshot:null
  return <section className="st-gap staff-roster-collection" aria-label={workflow?'Staff roster review by branch and date':'Unpublished Staff drafts by branch and date'}>
    <h3>{workflow?'Staff schedules by branch and date':'Unpublished drafts by branch and date'}</h3>
    <Notice>{workflow?'Review current requests and roster versions here. Published Staff duty is shown separately; Draft, Pending and Approved changes do not replace it.':'Preparation records only. A missing draft does not mean no duty, and a saved draft does not mean approved or published duty.'}</Notice>
    <div className="st-pair"><Field label="Roster branch"><select aria-label="Roster branch" value={branch} disabled={disabled} onChange={e=>setBranch(e.target.value)}><option value="">Choose branch</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}{b.status==='Closed'?' (Closed)':''}</option>)}</select></Field>
      <Field label="Roster date"><input type="date" value={date} disabled={disabled} onChange={e=>setDate(e.target.value)}/></Field></div>
    <RefreshButton title={workflow?'Refresh Staff roster review':'Reload unpublished drafts'} ariaLabel={workflow?'Refresh Staff roster review':'Reload unpublished drafts'} loading={loading} disabled={disabled||!branch||!date} onClick={()=>load()}/>
    {loading&&<p role="status">{workflow?'Loading Staff schedules…':'Loading unpublished drafts…'}</p>}
    {error&&<p role="alert">{error}</p>}
    {shown&&<>{shown.rows.length?<ul className="fd-list">{shown.rows.map(row=><li key={row.id}><div><b>{row.staff_name||'Staff member'}</b><span>{row.kind==='day_off'?'Day off':`${row.start_time}–${row.end_time}`} · Revision {row.revision}</span><Status>{workflow?row.status:'Unpublished'}</Status></div><Button variant="ghost" aria-label={`Review dated draft for ${row.staff_name||row.staff_ref}`} disabled={disabled||loading} onClick={()=>onReview(row.staff_ref,row.date)}>Review schedule</Button></li>)}</ul>:<p>No saved schedules for this branch and date. Review published duty separately.</p>}
      {shown.cursor&&<Button variant="ghost" disabled={disabled||loading} onClick={()=>load(shown.cursor)}>{workflow?'Load older schedules':'Load older unpublished drafts'}</Button>}</>}
  </section>
}

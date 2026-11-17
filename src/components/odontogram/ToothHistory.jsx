import React,{useEffect,useState} from 'react'
import {Button} from '../../components.jsx'
const day=d=>new Date(d+'T00:00:00+08:00').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric'})
/** Original saved entries. Pagination changes presentation only, never current findings or the editor. */
export function ToothHistory({history,currentEntries,onReviewEncounter}){
 const entries=history===null?currentEntries:history,currentIds=new Set(currentEntries.map(e=>e.id))
 const [page,setPage]=useState(1),last=Math.max(1,Math.ceil(entries.length/10)),shown=Math.min(page,last)
 useEffect(()=>setPage(1),[entries[0]?.id])
 return <section className="od-compact-history" aria-label={history===null?'Saved current record':'Recorded tooth history'}>
  <h5 className="od-section-title">{history===null?'Saved current record':'Recorded history'} <span>({entries.length})</span></h5>
  {!entries.length?<p className="od-muted">Nothing recorded yet for this tooth.</p>:<>
   {history!==null&&<p className="od-muted">Original entries. Active surfaces are shown in Current saved findings.</p>}
   <div className="od-history-list">{entries.slice((shown-1)*10,shown*10).map(item=><details key={item.id} className="od-history-entry">
    <summary><span><b>{item.status}</b><small>{day(item.recorded_on)} · {currentIds.has(item.id)?'Current entry':'Earlier entry'}</small></span><span>{item.surfaces?.length?'Surfaces '+item.surfaces.join(' · '):'Whole tooth'}</span></summary>
    <div className="od-history-body">
     {item.dentist&&<p>{item.dentist}</p>}{item.branch&&<p>{item.branch.name}</p>}
     {item.created_at&&<p>Recorded {new Date(item.created_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'})}</p>}
     {item.treatment_id&&<p>Encounter {item.treatment_id} · Visit {item.visit_id}</p>}
     {item.note&&<p className="od-card-note">{item.note}</p>}
     {onReviewEncounter&&item.treatment_id&&item.visit_id&&<Button variant="soft" onClick={()=>onReviewEncounter({id:item.treatment_id,visitId:item.visit_id,branchId:item.branch?.id,entryId:item.id})}>Review linked encounter</Button>}
    </div>
   </details>)}</div>
   {last>1&&<nav className="row-actions" aria-label="Tooth history pages"><Button variant="ghost" disabled={shown<=1} onClick={()=>setPage(p=>p-1)}>Newer findings</Button><span role="status">Page {shown} of {last}</span><Button variant="ghost" disabled={shown>=last} onClick={()=>setPage(p=>p+1)}>Older findings</Button></nav>}
  </>}
 </section>
}

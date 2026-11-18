import {boundedClinicalRead} from './clinical-history.js'
import {chartMatches} from './chart-command.js'
const text=v=>typeof v==='string'&&!!v.trim()
const optional=v=>v==null||typeof v==='string'
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00+08:00'))
const tooth=v=>typeof v==='string'&&/^([1-4][1-8]|[5-8][1-5])$/.test(v)
const surfaces=v=>Array.isArray(v)&&new Set(v).size===v.length&&v.every(s=>['M','O','D','B','L'].includes(s))
const baseline=e=>/^(healthy|sound)$/i.test(e.status.trim())
const key=(e,status=e.status)=>JSON.stringify([status,e.tooth,[...e.surfaces].sort()])
const entry=e=>!!e&&text(e.id)&&tooth(e.tooth)&&text(e.status)&&e.status.length<=40&&surfaces(e.surfaces)&&date(e.recorded_on)&&optional(e.note)&&optional(e.dentist)&&optional(e.dentist_id)&&optional(e.treatment_id)&&optional(e.visit_id)&&(e.branch==null||text(e.branch.id)&&text(e.branch.name))&&(e.created_at==null||text(e.created_at)&&Number.isFinite(Date.parse(e.created_at)))
/** Validate the existing projection, never derive a diagnosis or rewrite historical surfaces. */
export function clinicalChartValid(data,patientId){
 if(!text(patientId)||!chartMatches(data,patientId)||!optional(data.patient.name)||!['fdi','universal'].includes(data.settings?.numbering)||!Array.isArray(data.settings.statuses)||data.settings.statuses.some(s=>!text(s))||!Array.isArray(data.surfaces)||!surfaces(data.surfaces))return false
 if(data.current.some(e=>!entry(e))||new Set(data.current.map(e=>e.id)).size!==data.current.length)return false
 if(data.history!==null){
  if(data.history.some(e=>!entry(e))||new Set(data.history.map(e=>e.id)).size!==data.history.length)return false
  for(const c of data.current){const h=data.history.find(h=>h.id===c.id);if(!h||h.tooth!==c.tooth||h.status!==c.status||h.recorded_on!==c.recorded_on||['note','dentist','dentist_id','treatment_id','visit_id'].some(k=>(h[k]??null)!==(c[k]??null))||(h.branch?.id??null)!==(c.branch?.id??null)||c.surfaces.some(s=>!h.surfaces.includes(s)))return false}
 }
 if(data.tooth_revisions!=null){
  if(!data.tooth_revisions||typeof data.tooth_revisions!=='object'||Array.isArray(data.tooth_revisions)||Object.entries(data.tooth_revisions).some(([t,r])=>!tooth(t)||!Number.isSafeInteger(r)||r<0))return false
  if(data.history){const counts={};for(const e of data.history)counts[e.tooth]=(counts[e.tooth]||0)+1;if(Object.entries(counts).some(([t,r])=>data.tooth_revisions[t]!==r)||Object.entries(data.tooth_revisions).some(([t,r])=>r!==(counts[t]||0)))return false}
 }
 const expected=data.current.filter(e=>!baseline(e)).map(e=>key(e)).sort(),summary=[]
 for(const g of data.summary){if(!text(g?.status)||!Number.isSafeInteger(g.count)||!Array.isArray(g.teeth)||g.count!==g.teeth.length)return false;for(const t of g.teeth){if(!tooth(t?.tooth)||!surfaces(t.surfaces))return false;summary.push(key(t,g.status))}}
 return JSON.stringify(summary.sort())===JSON.stringify(expected)
}
export async function readClinicalChart(read,patientId,isCurrent,timeoutMs=30000){
 if(!text(patientId)||!isCurrent())return {ok:false,kind:'stale_context'}
 const r=await boundedClinicalRead(read,timeoutMs)
 if(!isCurrent())return {ok:false,kind:'stale_context'}
 if(!r?.ok)return {ok:false,message:r?.message||'The chart could not be read. Try again.'}
 return clinicalChartValid(r.data,patientId)?r:{ok:false,message:'The chart did not confirm this Patient, tooth identities and saved revisions. No findings were adopted.'}
}
/** Existing Visit API only: the Dentist's authorized last-30-day work, never the Staff directory. */
export async function readChartVisitPatients(read,{dentistId,from,to},isCurrent,timeoutMs=30000){
 if(!text(dentistId))return {ok:false,message:'Your Dentist identity is unavailable.'}
 let active=true
 try{return await boundedClinicalRead(async()=>{
  const patients=new Map(),seen=new Set();let page=1
  while(active&&isCurrent()){
   const r=await read({from,to,per_page:100,page})
   if(!active||!isCurrent())return {ok:false,kind:'stale_context'}
   if(!r?.ok)return r||{ok:false}
   if(!Array.isArray(r.data)||r.meta?.current_page!==page||!Number.isSafeInteger(r.meta.last_page)||r.meta.last_page<page||r.meta.last_page>1000||r.data.some(v=>!text(v?.id)||seen.has(v.id)||v.dentist?.id!==dentistId||!text(v.patient?.id)||!text(v.patient.code)||!text(v.patient.name)||!text(v.branch?.id)||!text(v.branch.name)))return {ok:false,message:'The visits did not confirm your Dentist and Patient identities. Reload to try again.'}
   for(const v of r.data){if(seen.has(v.id))return {ok:false,message:'Visit pages repeated a record. Reload to try again.'};seen.add(v.id);const previous=patients.get(v.patient.id);if(previous&&(previous.name!==v.patient.name||previous.code!==v.patient.code))return {ok:false,message:'Patient details changed while loading. Reload to review them.'};patients.set(v.patient.id,v.patient)}
   if(page>=r.meta.last_page)return {ok:true,data:[...patients.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.code.localeCompare(b.code))}
   page++
  }
  return {ok:false,kind:'stale_context'}
 },timeoutMs)}finally{active=false}
}

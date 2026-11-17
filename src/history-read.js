import {boundedClinicalRead,clinicalHistoryMatches} from './clinical-history.js'
import {addDays} from './clock.js'
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value
export function discoveryRange(from,to,today){
 if(!day(from)||!day(to)||!day(today)||from>to||to>today)return {ok:false,message:'Choose a valid past date range, with From before To.'}
 if((Date.parse(to)-Date.parse(from))/86400000>=184)return {ok:false,message:'Choose a range of 184 days or fewer.'}
 return {ok:true,from,to}
}
export function shiftDiscoveryRange(range,direction,today){
 const days=(Date.parse(range.to)-Date.parse(range.from))/86400000+1
 const to=direction<0?addDays(range.from,-1):[addDays(range.to,days),today].sort()[0]
 return {from:addDays(to,1-days),to}
}
export async function readHistoryPage(read,{patientId,page,perPage=20},isCurrent,timeout=30000){
 if(!isCurrent())return {ok:false,kind:'stale_context'}
 const r=await boundedClinicalRead(()=>read({patient_id:patientId,status:'Completed',per_page:perPage,page}),timeout)
 if(!isCurrent())return {ok:false,kind:'stale_context'}
 if(!r?.ok)return r||{ok:false}
 const m=r.meta
 if(!Array.isArray(r.data)||r.data.length>perPage||!Number.isSafeInteger(m?.last_page)||m.last_page<page||m.current_page!==page||m.per_page!==perPage||!Number.isSafeInteger(m.total)||m.total<0||m.last_page!==Math.max(1,Math.ceil(m.total/perPage))||r.data.length!==Math.min(perPage,Math.max(0,m.total-(page-1)*perPage))||new Set(r.data.map(t=>t?.id)).size!==r.data.length||r.data.some(t=>!clinicalHistoryMatches(t,patientId)))return {ok:false,message:'The history page did not confirm this Patient and page. Retry to read the saved records.'}
 return r
}
export async function readHistoryDetail(read,patientId,expected,isCurrent,timeout=30000){
 if(!expected?.id||!isCurrent())return {ok:false,kind:'stale_context'}
 const r=await boundedClinicalRead(()=>read(expected.id),timeout)
 if(!isCurrent())return {ok:false,kind:'stale_context'}
 if(!r?.ok)return r||{ok:false}
 const t=r.data
 if(!clinicalHistoryMatches(t,patientId,expected.id)||expected.visitId&&t.visit.id!==expected.visitId||expected.branchId&&t.branch.id!==expected.branchId||expected.revision&&t.revision!==expected.revision)return {ok:false,message:'The selected encounter did not confirm this Patient, Visit and saved revision. No record was adopted.'}
 return r
}

import {boundedClinicalRead} from './clinical-history.js'

export async function readEncounterFollowups(read,{patientId,branchId},owns,timeoutMs=30000) {
  if(!patientId||!branchId||!owns())return {ok:false,message:'This care context is unavailable.'}
  const r=await boundedClinicalRead(()=>read(patientId),timeoutMs)
  if(!owns())return {ok:false,kind:'stale_context'}
  if(!r?.ok)return r||{ok:false,message:'Follow-up tasks could not be checked.'}
  if(!Array.isArray(r.data)||new Set(r.data.map(t=>t?.id)).size!==r.data.length||r.data.some(t=>
    typeof t?.id!=='string'||!t.id||t.patient?.id!==patientId||typeof t.branch?.id!=='string'||!t.branch.id||
    !Number.isSafeInteger(t.revision)||t.revision<1||!['Open','Contacted','Booked','Closed'].includes(t.status)||typeof t.reason!=='string'||
    t.due_on!=null&&!/^\d{4}-\d{2}-\d{2}$/.test(t.due_on)||t.appointment!=null&&(typeof t.appointment.id!=='string'||typeof t.appointment.code!=='string'))) {
    return {ok:false,message:'Follow-up tasks did not confirm this Patient and branch. Reload to try again.'}
  }
  return {...r,data:r.data.filter(t=>t.branch.id===branchId)}
}

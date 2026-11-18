import {boundedClinicalRead} from './clinical-history.js'
import {readPrescriptionPage} from './prescription-list.js'

export const prescriptionContextMatches = (row, context) => !!context?.patientId && !!context.visitId && !!context.branchId &&
  row?.patient?.id === context.patientId && row.visit === context.visitId && row.branch_id === context.branchId

export async function readEncounterPrescriptions(read, context, isCurrent=()=>true, timeout=30000) {
  if (!context?.patientId || !context.visitId || !context.branchId) return {ok:false, message:'The encounter identity is unavailable. No prescriptions were loaded.'}
  let active=true
  try{return await boundedClinicalRead(async()=>{
    const rows=[],seen=new Set();let page=1
    while(active&&isCurrent()){
      const r=await readPrescriptionPage(read,{patient_id:context.patientId,visit_id:context.visitId,page,per_page:100},'dentist')
      if(!active||!isCurrent())return {ok:false,kind:'stale_context'}
      if(!r?.ok)return r
      if(r.meta.last_page>1000||r.data.some(p=>!prescriptionContextMatches(p,context)||seen.has(p.id)))return {ok:false,message:'The prescription pages did not confirm this exact encounter. No records were adopted.'}
      for(const p of r.data){seen.add(p.id);rows.push(p)}
      if(page>=r.meta.last_page)return {ok:true,data:rows}
      page++
    }
    return {ok:false,kind:'stale_context'}
  },timeout)}finally{active=false}
}

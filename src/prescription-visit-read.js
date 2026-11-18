import {boundedClinicalRead} from './clinical-history.js'
const text=value=>typeof value==='string'&&!!value.trim()
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value
/** Existing endpoints only. A linked exact Visit never depends on the recent 100-row suggestion list. */
export async function readPrescriptionVisitOptions(catalog,readVisit,context,isCurrent,timeout=30000){
 if(!isCurrent())return {ok:false,kind:'stale_context'}
 const linked=!!context?.visitId,patient=context?.patientPublicId||context?.patientId
 if(linked&&(!text(patient)||!text(context.branchId)))return {ok:false,message:'The prescription Patient, Visit and branch are unavailable.'}
 const r=await boundedClinicalRead(async()=>{
  const [options,exact]=await Promise.all([catalog(),linked?readVisit(context.visitId):null])
  if(!isCurrent())return {ok:false,kind:'stale_context'}
  if(!options?.ok)return options||{ok:false}
  if(!Array.isArray(options.data))return {ok:false,message:'The prescription Visit options could not be verified.'}
  if(!linked)return options
  if(!exact?.ok)return exact||{ok:false}
  const v=exact.data
  if(!date(v?.clinic_date)||!Number.isSafeInteger(v?.revision)||v.revision<1||v?.id!==context.visitId||v.patient?.id!==patient||v.branch?.id!==context.branchId||!text(v.patient?.name)||!text(v.patient?.code)||!text(v.branch?.name)||!['Checked In','In Treatment','Completed'].includes(v.status)||context.dentistId&&v.dentist?.id!==context.dentistId)return {ok:false,message:'The prescription Visit did not confirm this Patient, branch and Dentist. No Visit was adopted.'}
  return {ok:true,data:[{id:v.id,date:v.clinic_date,status:v.status,patient:{...v.patient,age:null},branch:v.branch.name,branch_id:v.branch.id,dentist:v.dentist?.name}],meta:options.meta}
 },timeout)
 return isCurrent()?r:{ok:false,kind:'stale_context'}
}

import {commandKey} from './appointments-api.js'
import {recordChartEntry} from './api-client.js'
export const chartReady = data => data?.write_contract?.version===1 && data.write_contract.revision_scheme==='tooth_entry_count' && data.write_contract.idempotency===true && !!data.tooth_revisions && !Array.isArray(data.tooth_revisions) && Array.isArray(data.history)
export function chartMatches(data,patientId){
 return data?.patient?.id===patientId && Array.isArray(data.current) && Array.isArray(data.summary) && (data.history===null||Array.isArray(data.history))
}
export function patientChartMatches(data,patientId){return !!patientId&&chartMatches(data,patientId)&&data.history===null&&data.current.every(e=>!Object.hasOwn(e,'note')&&!Object.hasOwn(e,'treatment_id')&&!Object.hasOwn(e,'visit_id'))}
export function chartReceiptMatches(result,patientId,payload,dentistId){
 const row=result?.data,proof=result?.meta?.chart_receipt
 if(!result?.ok||!chartMatches(row,patientId)||!chartReady(row)||proof?.patient_id!==patientId||proof.tooth!==payload.tooth||
   proof.revision!==payload.expected_revision+1||row.tooth_revisions[payload.tooth]!==proof.revision||proof.dentist_ref!==dentistId||
   (proof.treatment_id??null)!==(payload.treatment_id??null)||payload.branch_ref&&proof.branch_ref!==payload.branch_ref||
   payload.expected_treatment_revision&&proof.treatment_revision!==payload.expected_treatment_revision)return false
 const entry=row.history.find(e=>e.id===proof.entry_id)
 return !!entry && entry.tooth===payload.tooth && entry.status===payload.status && entry.recorded_on===payload.recorded_on &&
   (entry.note||null)===(payload.note||null)&&entry.branch?.id===proof.branch_ref&&entry.dentist_id===dentistId&&
   (entry.treatment_id??null)===(proof.treatment_id??null)&&(entry.visit_id??null)===(proof.visit_id??null)&&
   JSON.stringify([...(entry.surfaces||[])].sort())===JSON.stringify([...new Set(payload.surfaces||[])].sort())
}
export function beginChartCommand({patientId,payload,dentistId,isCurrent,key=commandKey(),send=recordChartEntry,timeoutMs=30000}){
 const intent=Object.freeze({...structuredClone(payload),surfaces:Object.freeze([...(payload.surfaces||[])])});let pending=false,phase='idle',uncertain=false
 const unknown=()=>{uncertain=true;phase='unknown';return {ok:false,uncertain:true,outcome:phase,message:'This finding is unconfirmed and may already be saved. Retry the same finding or review the saved chart before another entry.'}}
 return {intent,get outcome(){return phase},async submit(){
  if(pending)return {ok:false,outcome:'submitting'}
  if(!isCurrent())return {ok:false,outcome:'obsolete',message:'The chart session changed. No result was adopted.'}
  pending=true;phase='submitting';let timer,result
  try{
   try{result=await Promise.race([Promise.resolve().then(()=>isCurrent()?send(patientId,intent,key,isCurrent):null),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs)})])}catch{result=null}
   if(!isCurrent())return {ok:false,outcome:'obsolete',message:'The chart session changed. No result was adopted.'}
   if(!result?.ok){if(uncertain||!['validation','conflict','forbidden','not_found','unauthenticated','rate_limited','stale_context'].includes(result?.kind))return unknown();phase='refused';return {...result,outcome:phase}}
   if(!chartReceiptMatches(result,patientId,intent,dentistId))return unknown()
   phase='verified';return {...result,recovered:uncertain,outcome:phase,revision:result.meta.chart_receipt.revision,entryId:result.meta.chart_receipt.entry_id}
  }finally{clearTimeout(timer);pending=false}
 }}
}

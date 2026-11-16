import {addDependent,dependentCreationReceipt} from '../api-client.js'
import {commandKey} from '../appointments-api.js'
export const dependentReady=(r,guardianId)=>r?.ok&&r.meta?.me?.id===guardianId&&r.meta.creation_contract?.version===1&&r.meta.creation_contract.idempotency===true&&r.meta.creation_contract.durable_recovery===true&&Array.isArray(r.data)
export const dependentReceiptMatches=(r,guardianId,payload=null)=>!!r?.ok&&r.meta?.dependent_receipt?.guardian_id===guardianId&&r.meta.dependent_receipt.dependent_id===r.data?.id&&typeof r.meta.dependent_receipt.link_id==='string'&&!!r.meta.dependent_receipt.link_id&&!!r.data?.code&&typeof r.data.first_name==='string'&&typeof r.data.last_name==='string'&&typeof r.data.date_of_birth==='string'&&(!payload||r.data.first_name===payload.first_name&&r.data.last_name===payload.last_name&&r.data.date_of_birth===payload.date_of_birth&&r.data.relationship===payload.relationship&&(r.data.relationship_other||null)===(payload.relationship==='Other'?payload.relationship_other:null))
export async function boundedDependent(read,timeoutMs=30000){let timer;try{return await Promise.race([Promise.resolve().then(read),new Promise(r=>{timer=setTimeout(()=>r({ok:false,kind:'network',message:'The dependent operation timed out. Its saved outcome is still unconfirmed.'}),timeoutMs)})])}catch{return {ok:false,kind:'network',message:'The dependent operation could not be confirmed.'}}finally{clearTimeout(timer)}}
export function dependentRecoveryStore(userId,guardianId,storage=globalThis.sessionStorage){const name=`dentalops-v4-dependent-create:${userId}:${guardianId}`;return {read(){return storage.getItem(name)||null},write(key){storage.setItem(name,key);if(storage.getItem(name)!==key)throw Error('Recovery key unavailable')},clear(){storage.removeItem(name)}}}
export function createDependentCommand({guardianId,payload=null,key=commandKey(),isCurrent,send=addDependent,read=dependentCreationReceipt,timeoutMs=30000}){
 const intent=payload?Object.freeze(structuredClone(payload)):null;let pending=false,unknown=!payload
 return {key,intent,async run(recoverOnly=false){
  if(pending)return {ok:false,duplicate:true}
  if(!isCurrent())return {ok:false,obsolete:true}
  pending=true
  try{
   const r=await boundedDependent(()=>isCurrent()?recoverOnly||!intent?read(key):send(intent,key,isCurrent):{ok:false,kind:'stale_context'},timeoutMs)
   if(!isCurrent())return {ok:false,obsolete:true}
   if(dependentReceiptMatches(r,guardianId,intent))return {...r,verified:true}
   if(!unknown&&!r?.ok&&['validation','forbidden','unauthenticated','rate_limited'].includes(r?.kind))return {...r,refused:true}
   unknown=true;return {ok:false,uncertain:true,message:'The dependent creation is unconfirmed. '+(r?.message||'Recover the original result before adding another dependent.')}
  }finally{pending=false}
 }}
}

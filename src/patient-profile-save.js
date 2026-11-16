import {savePatientRecord} from './patient-records-api.js'

// One selected Patient owns one immutable observed profile revision, payload and key until its outcome is known.
export function beginProfileSave({record,form,key,isCurrent,send=savePatientRecord,timeoutMs=30000}) {
  const original=Object.freeze(structuredClone(record)),submitted=Object.freeze(structuredClone(form))
  let pending=false,phase='idle',uncertain=false,cached=null
  const unknown=()=>{uncertain=true;phase='unknown';return {ok:false,outcome:phase,message:'This save is unconfirmed and may already be recorded. Retry the same save or review the current Patient record before changing details.'}}
  return {
    get outcome(){return phase},
    async submit(){
      if(pending)return {ok:false,outcome:'submitting'}
      if(!isCurrent()){phase='obsolete';return {ok:false,outcome:phase}}
      if(phase==='verified')return cached
      if(['refused','obsolete'].includes(phase))return {ok:false,outcome:'settled'}
      if(typeof key!=='string'||!/^[\x21-\x7e]{1,255}$/.test(key)){phase='refused';return {ok:false,outcome:phase,message:'This save has no valid command identity. Review the record.'}}
      pending=true;phase='submitting';let timer,result
      try{
        try{result=await Promise.race([Promise.resolve().then(()=>isCurrent()?send(original,submitted,{key,beforeDispatch:isCurrent}):null),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs)})])}catch{result=null}
        if(!isCurrent()){phase='obsolete';return {ok:false,outcome:phase}}
        if(!result?.ok){
          if(uncertain||!['validation','conflict','not_found','forbidden','unauthenticated','rate_limited','stale_context'].includes(result?.kind))return unknown()
          phase='refused';return {...result,outcome:phase}
        }
        if(result.record?.id!==original.id || result.record.revision!==original.revision+1 && !(result.unchanged===true&&result.record.revision===original.revision))return unknown()
        phase='verified';cached={...result,outcome:phase};return cached
      }finally{clearTimeout(timer);pending=false}
    },
  }
}

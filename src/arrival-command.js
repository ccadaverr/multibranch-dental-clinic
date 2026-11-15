// One explicit admission owns an immutable intent/key. Server receipts, never projections, confirm completion.
import {mapVisit} from './visits-api.js'
const publicId=value=>typeof value==='string'&&/^[0-7][0-9a-hjkmnp-tv-z]{25}$/i.test(value)
export function arrivalReceipt(row,intent){
  if(!publicId(row?.id)||row.patient?.id!==intent.patientPublicId||row.branch?.id!==intent.branchId||
    row.source!==(intent.kind==='scheduled'?'appointment':'walk_in')||row.status!=='Checked In'||row.revision!==1||
    row.clinic_date!==intent.clinicDate||typeof row.arrived_at!=='string'||!row.arrived_at.startsWith(intent.clinicDate+'T')||!row.arrived_at.endsWith('+08:00')||
    !Number.isFinite(Date.parse(row.arrived_at))||
    (row.service?.id??null)!==(intent.serviceId||null)||(row.dentist?.id??null)!==(intent.dentistId||null))return null
  if(intent.kind==='scheduled'){
    if(row.appointment?.id!==intent.appointmentId||row.appointment.status!=='Checked In'||row.appointment.revision!==intent.expectedRevision+1)return null
  }else if(row.appointment!==null)return null
  if(intent.dentistId){
    if(!publicId(row.queue?.id)||row.queue.status!=='Waiting'||row.queue.revision!==1||!Number.isSafeInteger(row.queue.queue_number)||row.queue.queue_number<1)return null
  }else if(row.queue!==null)return null
  return Object.freeze({visitId:row.id,queueId:row.queue?.id??null,queueNumber:row.queue?.queue_number??null,queued:!!row.queue,
    patientPublicId:row.patient.id,patientName:row.patient.name,branchId:row.branch.id,appointmentId:row.appointment?.id??null,record:mapVisit(row)})
}

export function beginArrivalCommand({intent,key,isCurrent,validateInitial=()=>true,send,refresh,timeoutMs=30000}){
  const submitted=Object.freeze({...intent})
  let phase='idle',pending=false,uncertain=false
  const unknown=()=>{uncertain=true;phase='unknown';return{ok:false,outcome:phase,kind:'unverified',message:'The arrival outcome is unconfirmed. Retry the same arrival, or review today’s recorded arrivals before admitting again.'}}
  const bounded=async work=>{let timer;try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Arrival response unavailable')),timeoutMs)})])}finally{clearTimeout(timer)}}
  const owns=()=>typeof isCurrent==='function'&&isCurrent()
  const valid=()=>['scheduled','walkin'].includes(submitted.kind)&&publicId(submitted.patientPublicId)&&typeof submitted.branchId==='string'&&submitted.branchId&&
    /^\d{4}-\d{2}-\d{2}$/.test(submitted.clinicDate)&&typeof key==='string'&&/^[\x21-\x7e]{1,255}$/.test(key)&&!/[\r\n]/.test(key)&&
    (submitted.kind!=='scheduled'||publicId(submitted.appointmentId)&&Number.isSafeInteger(submitted.expectedRevision)&&submitted.expectedRevision>0&&submitted.idConfirmed===true)
  return{
    get outcome(){return phase},get intent(){return submitted},
    async submit(){
      if(pending)return{ok:false,outcome:'submitting'}
      if(['verified','refused','obsolete'].includes(phase))return{ok:false,outcome:'settled'}
      if(!owns()){phase='obsolete';return{ok:false,outcome:phase}}
      if(!valid()||!uncertain&&!validateInitial()){
        if(uncertain)return unknown()
        phase='refused';return{ok:false,outcome:phase,kind:'stale_context',message:'Review the exact Patient, appointment and current access before recording arrival.'}
      }
      pending=true;phase='submitting'
      try{
        let result
        try{result=await bounded(()=>owns()?send(submitted,key,()=>owns()&&(uncertain||validateInitial())):{ok:false,kind:'stale_context'})}
        catch{result={ok:false,kind:'network'}}
        if(!owns()){phase='obsolete';return{ok:false,outcome:phase}}
        if(!result?.ok){
          if(uncertain||!['validation','conflict','not_found','forbidden','unauthenticated','rate_limited','stale_context'].includes(result?.kind))return unknown()
          phase='refused';return{...result,outcome:phase}
        }
        const proof=arrivalReceipt(result.row,submitted)
        if(!proof)return unknown()
        phase='verified';let warning=''
        try{const r=await bounded(refresh);if(r?.ok===false)warning='Arrival verified. The clinic list could not be refreshed; review the recorded visit before another action.'}
        catch{warning='Arrival verified. The clinic list could not be refreshed; review the recorded visit before another action.'}
        if(!owns()){phase='obsolete';return{ok:false,outcome:phase}}
        return{ok:true,outcome:phase,...proof,warning}
      }finally{pending=false}
    },
  }
}

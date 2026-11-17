import {readOwnedArchive,loadInvoiceHistory} from './archive-readback.js'
import {loadActiveAppointments} from './visit-history.js'
import {invoiceMatches} from './invoice-readback.js'
import {moneyMinor} from '../billing-command.js'

const refused=message=>({ok:false,message})
async function familyIds(family,patientId) {
  if(typeof patientId!=='string'||!patientId.trim())return refused('Your Patient identity is unavailable. Sign in again.')
  const r=await family()
  if(!r?.ok || r.meta?.me?.id!==patientId || !Array.isArray(r.data) || r.data.some(p=>typeof p?.id!=='string'||!p.id)) return refused('Your Patient and family access could not be verified. Reload to try again.')
  return {ok:true,data:[patientId,...r.data.map(p=>p.id)]}
}

export function readHomeAppointments(read,family,patientId,owns,timeoutMs=30000) {
  return readOwnedArchive(async guard=>{
    const scope=await guard(()=>familyIds(family,patientId))()
    if(!scope.ok)return scope
    const pages=new Map()
    const r=await loadActiveAppointments(guard(async params=>{
      const key=params.status+':'+params.page
      if(pages.has(key)||params.page>1000)return refused('Appointment pages could not be verified. Reload to try again.')
      pages.set(key,true)
      const r=await read(params)
      if(!r?.ok)return r||refused('Appointments could not be read.')
      if(!Array.isArray(r.data)||!Number.isSafeInteger(r.meta?.last_page)||r.meta.last_page<params.page||r.data.some(a=>
        typeof a?.id!=='string'||!a.id||!scope.data.includes(a.patient?.id)||typeof a.patient?.name!=='string'||!a.patient.name||
        typeof a.branch?.id!=='string'||!a.branch.id||typeof a.branch?.name!=='string'||!a.branch.name||a.status!==params.status||
        a.service?.name!=null&&typeof a.service.name!=='string'||a.dentist?.name!=null&&typeof a.dentist.name!=='string'||a.code!=null&&typeof a.code!=='string'||
        !/^\d{4}-\d{2}-\d{2}$/.test(a.date)||!/^\d{2}:\d{2}/.test(a.start_time)||!Number.isFinite(Date.parse(a.starts_at))))return refused('The appointment response did not confirm your Patient and branch. No visits were adopted.')
      return r
    }),{firstOnly:true})
    if(r.ok&&new Set(r.data.map(a=>a.id)).size!==r.data.length)return refused('Appointments changed while loading. Reload to check the current records.')
    return r
  },owns,timeoutMs)
}

export function readHomeBalance(read,family,patientId,owns,timeoutMs=30000) {
  return readOwnedArchive(async guard=>{
    const scope=await guard(()=>familyIds(family,patientId))()
    if(!scope.ok)return scope
    let pages=0
    const r=await loadInvoiceHistory(guard(async params=>{
      if(++pages>1000)return refused('The invoice list is too large to summarize here. Open Billing to review it.')
      const r=await read({...params,status:'Issued'})
      if(!r?.ok)return r||refused('Invoices could not be read.')
      if(!r.meta||!Object.hasOwn(r.meta,'next_cursor')||!Array.isArray(r.data)||r.data.some(i=>i.status!=='Issued'||!invoiceMatches(i,scope.data)))return refused('The invoice response could not be verified. Open Billing or reload to try again.')
      return r
    }))
    if(!r.ok)return r
    if(new Set(r.data.map(i=>i.id)).size!==r.data.length)return refused('Invoice pages repeated a record. Reload before reviewing the balance.')
    let minor=0,count=0
    for(const i of r.data){const amount=moneyMinor(i.balance);if(amount>0){minor+=amount;count++}if(!Number.isSafeInteger(minor))return refused('The balance could not be summarized safely. Open Billing to review invoices.')}
    return {ok:true,data:{minor,count}}
  },owns,timeoutMs)
}

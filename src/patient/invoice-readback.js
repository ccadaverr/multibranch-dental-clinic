import {confirmedBillingReceipt,moneyMinor} from '../billing-command.js'
export function invoiceMatches(row,patientIds,{invoiceId=null,appointmentId=null,receiptId=null,patientId=null}={}){
 return !!row?.id&&(!invoiceId||row.id===invoiceId)&&patientIds.includes(row.patient?.id)&&(!patientId||row.patient.id===patientId)&&!!row.branch?.id&&
  (!appointmentId||row.appointment_id===appointmentId)&&(!receiptId||row.receipt?.id===receiptId)&&
  ['Draft','Review','Issued','Paid'].includes(row.status)&&Number.isSafeInteger(row.revision)&&row.revision>0&&Array.isArray(row.lines)&&
  ['gross_amount','patient_responsibility_amount','paid_amount','balance'].every(k=>moneyMinor(row[k])!==null)
}
export function verifiedPaid(row){return row?.status==='Paid'&&(confirmedBillingReceipt(row)||moneyMinor(row.patient_responsibility_amount)===0&&moneyMinor(row.paid_amount)===0&&moneyMinor(row.balance)===0&&!row.payment&&!row.receipt)}
export async function boundedInvoice(read,timeoutMs=30000){let timer;try{return await Promise.race([Promise.resolve().then(read),new Promise(resolve=>{timer=setTimeout(()=>resolve({ok:false,kind:'network',message:'The billing read timed out. Retry to read the saved invoice; no payment was requested.'}),timeoutMs)})])}catch{return {ok:false,kind:'network',message:'The saved billing record could not be read. Retry; no payment was requested.'}}finally{clearTimeout(timer)}}

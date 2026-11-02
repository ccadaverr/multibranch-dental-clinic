import test from 'node:test'
import assert from 'node:assert/strict'
import { bookingPaymentChoices } from '../src/patient/booking-flow.js'
import { createAppointment } from '../src/appointments-api.js'

const choice = {branch:{id:'b1'},service:{id:'s1'},date:'2099-11-02'}
const quote = {branch_ref:'b1',service_ref:'s1',date:choice.date,currency:'PHP',booking_fee_php:'500.00',online_payment_available:true,payment_methods:['gcash'],pay_at_clinic_available:true}
test('QA02 payment capability requires the exact branch, service and date snapshot',()=>{
  assert.deepEqual(bookingPaymentChoices(quote,choice),{online:true,cash:true,fee:500})
  for(const patch of [{branch_ref:'b2'},{service_ref:'s2'},{date:'2099-11-03'}]) assert.deepEqual(bookingPaymentChoices({...quote,...patch},choice),{online:false,cash:false,fee:null})
  assert.deepEqual(bookingPaymentChoices(null,choice),{online:false,cash:false,fee:null})
})
test('QA02 malformed prices and unavailable capabilities never enable online payment',()=>{
  for(const booking_fee_php of [null,undefined,'','unknown',-1,Infinity]) assert.equal(bookingPaymentChoices({...quote,booking_fee_php},choice).online,false)
  for(const patch of [{online_payment_available:false},{payment_methods:[]},{currency:'USD'},{online_payment_available:'true'}]) assert.equal(bookingPaymentChoices({...quote,...patch},choice).online,false)
  assert.equal(bookingPaymentChoices({...quote,online_payment_available:false},choice).cash,true)
})
test('QA02 online intent sends explicit false and preserves dependent, time and retry identity',async()=>{
  const original=globalThis.fetch, seen=[]
  globalThis.fetch=async(url,options={})=>{
    if(String(url).includes('csrf-cookie'))return new Response(null,{status:204})
    seen.push({body:JSON.parse(options.body),key:new Headers(options.headers).get('Idempotency-Key')})
    return Response.json({data:{id:'synthetic-appointment',status:'Pending',booking_payment_status:'held'}})
  }
  try{
    const payload={branchId:'b1',serviceId:'s1',date:choice.date,start:'09:00',forPatientId:'child',paymentChoice:'online'}
    const r=await createAppointment(payload,'stable-key')
    assert.equal(r.row.booking_payment_status,'held')
    assert.deepEqual(seen[0],{body:{branch_ref:'b1',service_ref:'s1',date:choice.date,start_time:'09:00',for_patient_id:'child',pay_at_clinic:false},key:'stable-key'})
  }finally{globalThis.fetch=original}
})

// Matched trials of unchanged J08/J09 Patient appointment and Dentist record screens.
// Component byte equality is recorded separately; these are not invented older baselines.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {browser,login,get,evidence,target,api,base} from './local-visit-support.mjs'
const f=JSON.parse(readFileSync(target.runtime+'/visit-fixture.json','utf8'))
const clinical=JSON.parse(readFileSync(target.runtime+'/j09-context.json','utf8'))
const result={accepted:false,appointmentTrials:[],recordTrials:[],baseline:'J08 component bytes equal J09; two matched trials on unchanged screens'}
let page
try{
 const patient=await login('sprint02.patient@example.test');page=patient.page
 for(const trial of ['reference','repeat']){
  const booked=await page.evaluate(async({f,trial})=>{
   const a=await import('/src/api-client.js'),commands=await import('/src/appointments-api.js')
   const date=new Date(Date.now()+8*3600e3+3*86400e3).toISOString().slice(0,10)
   const options=await a.bookingOptions({branch_ref:f.branch,service_ref:f.service,date})
   if(!options.ok||!options.data.pay_at_clinic_available)throw Error('Synthetic booking prerequisite unavailable')
   const available=await a.appointmentAvailability({branch_ref:f.branch,service_ref:f.service,date})
   if(!available.ok)throw Error('Synthetic availability unavailable')
   const slot=available.data.slots[0]
   if(!slot)throw Error('No actual synthetic slot available')
   const r=await commands.createAppointment({branchId:f.branch,serviceId:f.service,date,start:slot.start_time,payAtClinic:true,paymentChoice:'cash'},'j09-comparison-'+trial)
   if(!r.ok)throw Error('Synthetic booking refused '+r.kind)
   return r.row
  },{f,trial})
  assert.equal(booked.patient.id,f.patientId);assert.ok(['Pending','Confirmed'].includes(booked.status))
  await page.goto(base+'/?j09-appointment='+trial+'#p/home');await page.locator('.care-balance').waitFor()
  const requests=[],listen=r=>{if(new URL(r.url()).origin===api)requests.push({method:r.method(),path:new URL(r.url()).pathname})}
  page.on('request',listen)
  await page.getByRole('button',{name:/^(My visits|Visits)$/}).first().click()
  const row=page.locator('#visit-'+booked.id);await row.waitFor()
  await row.getByRole('button',{name:'Cancel',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Cancel this visit?',exact:true})
  await dialog.getByRole('combobox',{name:/Reason for cancellation/}).selectOption('Found another appointment')
  await dialog.getByRole('button',{name:'Cancel visit',exact:true}).click();await dialog.waitFor({state:'hidden'})
  page.off('request',listen)
  const persisted=(await get(page,'/api/appointments/'+booked.id)).body.data
  assert.equal(persisted.id,booked.id);assert.equal(persisted.patient.id,f.patientId);assert.equal(persisted.branch.id,f.branch);assert.equal(persisted.status,'Cancelled')
  result.appointmentTrials.push({trial,startingScreen:'Patient Home',startingStatus:booked.status,activations:3,selections:1,textEntries:0,reason:'Found another appointment',requests,completion:{appointment:booked.id,status:persisted.status,revision:persisted.revision}})
 }
 const dentist=await login('sprint02.dentist@example.test');page=dentist.page
 await page.getByRole('button',{name:'My Queue',exact:true}).first().click();await page.getByRole('button',{name:'Continue treatment',exact:true}).first().click();await page.getByRole('textbox',{name:'Clinical notes',exact:true}).waitFor()
 const before=(await get(page,'/api/treatments/'+clinical.treatment.id)).body.data
 for(const trial of ['reference','repeat']){
  const requests=[],listen=r=>{if(new URL(r.url()).origin===api)requests.push({method:r.method(),path:new URL(r.url()).pathname})};page.on('request',listen)
  await page.getByRole('button',{name:'Patient records',exact:true}).click();await page.getByRole('heading',{name:'Patient summary',exact:true}).waitFor();assert.ok(await page.getByText(f.patientCode,{exact:true}).count()>0)
  await page.getByText('Full patient record not available to Dentists yet',{exact:true}).waitFor()
  page.off('request',listen)
  result.recordTrials.push({trial,startingScreen:'Clean active treatment',startingStatus:'In Treatment',activations:1,textEntries:0,requests,completion:{patient:f.patientId,patientCode:f.patientCode,view:'Authorized identity summary; full clinical profile unavailable'}})
  await page.getByRole('button',{name:'Return to encounter',exact:true}).click();await page.getByRole('textbox',{name:'Clinical notes',exact:true}).waitFor()
 }
 assert.deepEqual((await get(page,'/api/treatments/'+clinical.treatment.id)).body.data,before)
 result.accepted=true;console.log('PASS matched Patient cancellation and Dentist identity-summary review; zero claimed click reduction')
}catch(error){if(page){writeFileSync(evidence+'/failure.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/failure.png',fullPage:true})}throw error}finally{writeFileSync(evidence+'/measurements.json',JSON.stringify(result,null,2));await browser.close()}

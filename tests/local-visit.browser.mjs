// Actual React → Laravel → PostgreSQL acceptance. Synthetic prerequisites only; no mocked success responses.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {browser,login,get,evidence,base,api,target} from './local-visit-support.mjs'
const fixture=JSON.parse(readFileSync(process.env.LOCAL_VISIT_FIXTURE || target.runtime+'/visit-fixture.json','utf8'))
const journal=evidence+'/journey.json',state=existsSync(journal)?JSON.parse(readFileSync(journal,'utf8')):{},results=[]
const save=()=>writeFileSync(journal,JSON.stringify(state,null,2))
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
async function response(page,path,work){const r=page.waitForResponse(r=>r.url()===api+path&&r.request().method()!=='GET');await work();const result=await r;const body=await result.json();if(result.status()>=300)console.log('REFUSAL',result.status(),JSON.stringify(body));assert.ok(result.status()<300);return body.data}
let page
try {
 const staff=await login('sprint02.staff@example.test');page=staff.page
 await page.getByRole('button',{name:'Appointments',exact:true}).click()
 if(!state.appointment){
  await page.getByRole('button',{name:'New appointment',exact:true}).click();const form=page.getByRole('dialog')
  await form.getByRole('textbox',{name:/^Find patient/}).fill(fixture.patientCode);await form.getByRole('combobox',{name:'Patient',exact:true}).selectOption(fixture.patientId)
  await form.getByRole('combobox',{name:'Service',exact:true}).selectOption(fixture.service)
  await form.getByLabel(/^Date/).fill(today)
  await form.getByRole('textbox',{name:'Notes',exact:true}).fill('Synthetic Sprint 02 local acceptance')
  await form.getByRole('group',{name:'Available start times',exact:true}).getByRole('button').first().click()
  state.appointment=await response(page,'/api/appointments',()=>form.getByRole('button',{name:'Confirm appointment',exact:true}).evaluate(b=>{b.click();b.click()}));save()
 }
 assert.equal(state.appointment.patient.id,fixture.patientId);assert.equal(state.appointment.branch.id,fixture.branch)
 await page.reload();assert.equal((await get(page,'/api/appointments/'+state.appointment.id)).body.data.id,state.appointment.id)
 console.log('PASS actual Staff appointment and persisted readback')
 await page.getByRole('button',{name:'Check-In',exact:true}).click()
 if(!state.visit){
  await page.getByRole('combobox',{name:'Today’s appointment'}).selectOption(state.appointment.id)
  await page.getByRole('button',{name:'Confirm arrival',exact:true}).click();await page.getByText(/Confirm that the patient presented a valid ID/).waitFor()
  await page.getByText('Loading patient ID status…',{exact:true}).waitFor({state:'hidden'});
  const idButton=page.getByRole('button',{name:'ID checked',exact:true})
  if(await idButton.count()){
    await page.getByRole('combobox',{name:'ID shown',exact:true}).selectOption('other');await page.getByRole('textbox',{name:'Specify ID type'}).fill('Synthetic Company ID')
    const id=await response(page,'/api/patients/'+fixture.patientId+'/verify-id',()=>idButton.click());state.intake=id;save()
  }
  await page.reload();await page.getByRole('button',{name:'Check-In',exact:true}).click();await page.getByRole('combobox',{name:'Today’s appointment'}).selectOption(state.appointment.id)
  await page.getByRole('checkbox',{name:'Valid ID presented',exact:true}).check()
  state.visit=await response(page,'/api/visits/check-in',()=>page.getByRole('button',{name:'Confirm arrival',exact:true}).evaluate(b=>{b.click();b.click()}));save()
 }
 await page.reload();const visit=await get(page,'/api/visits/'+state.visit.id);assert.equal(visit.body.data.appointment.id,state.appointment.id);assert.equal(visit.body.data.patient.id,fixture.patientId);assert.ok(visit.body.data.queue.id)
 console.log('PASS actual Staff ID intake, mandatory confirmation, Check-In and exact Visit/queue readback')
 const dentist=await login('sprint02.dentist@example.test');page=dentist.page
 await page.getByRole('button',{name:'My Queue',exact:true}).click()
 if(!state.treatment){
  const q=page.locator('article.enc-queue-row').filter({hasText:fixture.patientCode}).first();await q.waitFor()
  if(await q.getByRole('button',{name:'Call patient',exact:true}).count()) await response(page,'/api/queue/'+state.visit.queue.id+'/call',()=>q.getByRole('button',{name:'Call patient',exact:true}).click())
  await q.getByRole('button',{name:'Open encounter',exact:true}).click()
  await page.getByRole('button',{name:'Add performed procedure',exact:true}).click()
  await page.getByRole('combobox',{name:'Procedure 1',exact:true}).selectOption(fixture.service)
  await page.getByRole('textbox',{name:'Chief complaint',exact:true}).fill('Synthetic demo: routine examination requested')
  await page.getByRole('textbox',{name:'Treatment plan',exact:true}).fill('Synthetic demo documentation for accepted workflow')
  await page.getByRole('textbox',{name:'Procedure / treatment performed',exact:true}).fill('Synthetic demo cleaning performed')
  await response(page,'/api/visits/'+state.visit.id+'/treatment',()=>page.getByRole('button',{name:'Start Treatment',exact:true}).click())
  await page.getByText(/Saved on the clinic server/).waitFor()
  const treatments=await get(page,'/api/treatments?date='+today);state.treatment=treatments.body.data.find(t=>t.visit_id===state.visit.id || t.visit?.id===state.visit.id);assert.ok(state.treatment);save()
 }
 if(state.treatment.status!=='Completed'){
   // Reload and reopen the authoritative in-progress record before finalizing.
   await page.reload();await page.getByRole('button',{name:'My Queue',exact:true}).click();await page.getByRole('button',{name:'Continue treatment',exact:true}).first().click()
   await page.getByRole('textbox',{name:'Chief complaint',exact:true}).waitFor();assert.match(await page.getByRole('textbox',{name:'Chief complaint',exact:true}).inputValue(),/Synthetic demo/)
   await page.getByRole('button',{name:'Complete Treatment',exact:true}).click();state.treatment=await response(page,'/api/treatments/'+state.treatment.id+'/complete',()=>page.getByRole('dialog').getByRole('button',{name:'Complete Treatment',exact:true}).click());save()
 }
 assert.equal((await get(page,'/api/treatments/'+state.treatment.id)).body.data.status,'Completed');console.log('PASS separate Dentist queue, exact encounter documentation, reload and completion')
 page=staff.page;await page.getByRole('button',{name:'Billing & Payments',exact:true}).click()
 await page.getByText('Completed treatments awaiting billing',{exact:true}).waitFor()
 if(!state.invoice){
   const row=page.locator('.billing-worklist-row').filter({hasText:fixture.patientName});await row.getByRole('button',{name:'Create Draft',exact:true}).click()
   await page.getByText(/Invoice .*: Draft\./).waitFor();const invoices=await get(page,'/api/invoices');state.invoice=invoices.body.data.find(i=>i.treatment_id===state.treatment.id);assert.ok(state.invoice);save()
 }
 await page.reload();await page.getByRole('button',{name:'Billing & Payments',exact:true}).click();const details=page.locator('details').filter({hasText:state.invoice.invoice_number});await details.locator('summary').click();assert.match(await details.innerText(),new RegExp(fixture.serviceName))
 if(state.invoice.status==='Draft') {state.invoice=await response(page,'/api/invoices/'+state.invoice.id+'/review',()=>details.getByRole('button',{name:'Review Invoice',exact:true}).click());save();await page.getByText(/Invoice .*: Review\./).waitFor()}
 if(state.invoice.status==='Review'){await details.getByRole('button',{name:'Issue Invoice',exact:true}).click();state.invoice=await response(page,'/api/invoices/'+state.invoice.id+'/issue',()=>page.getByRole('dialog').getByRole('button',{name:'Issue invoice',exact:true}).click());save();await page.getByText(/Invoice .*: Issued\./).waitFor()}
 if(state.invoice.status==='Issued'){
   const path='/api/invoices/'+state.invoice.id+'/payment', commands=[]
   page.on('request',r=>{if(r.url()===api+path&&r.method()==='POST')commands.push({key:r.headers()['idempotency-key'],body:r.postDataJSON()})})
   const loseResponse=process.env.LOCAL_VISIT_DROP_PAYMENT_RESPONSE==='1'
   let committed
   if(loseResponse)await page.route(api+path,async route=>{const r=await route.fetch();assert.equal(r.status(),200);committed=(await r.json()).data;await route.abort('failed')},{times:1})
   await details.getByRole('button',{name:'Record full payment',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:/Record ₱/}).click()
   const confirm=()=>page.getByRole('dialog').filter({hasText:'Record payment and issue receipt?'}).getByRole('button',{name:/Confirm ₱/}).evaluate(b=>{b.click();b.click()})
   if(loseResponse){
     await confirm();await page.getByRole('button',{name:'Retry same command',exact:true}).waitFor()
     assert.equal((await get(page,'/api/invoices/'+state.invoice.id)).body.data.status,'Paid')
     assert.equal(await page.getByText(/Payment confirmed\. Receipt/).count(),0)
     state.invoice=await response(page,path,()=>page.getByRole('button',{name:'Retry same command',exact:true}).click())
     assert.deepEqual(commands[0],commands[1]);assert.equal(commands.length,2);assert.equal(committed.receipt.id,state.invoice.receipt.id)
     state.unknownOutcomeRecovered=true;console.log('PASS committed Cash payment with lost HTTP response, same-key UI retry and one exact receipt')
   }else{state.invoice=await response(page,path,confirm);assert.equal(commands.length,1)}
   save();await page.getByText('Payment confirmed. Receipt '+state.invoice.receipt.number+'.',{exact:true}).waitFor()
 }

 assert.equal(state.invoice.status,'Paid');assert.equal(state.invoice.balance,'0.00');assert.ok(state.invoice.receipt.number)
 await page.reload();assert.equal((await get(page,'/api/invoices/'+state.invoice.id)).body.data.receipt.number,state.invoice.receipt.number);console.log('PASS actual Staff draft, review, issue, Cash settlement and exact receipt readback')
 const patient=await login('sprint02.patient@example.test',390);page=patient.page
 await page.getByRole('button',{name:/^Billing/}).click();await page.getByRole('heading',{name:'Invoices and receipts',exact:true}).waitFor()
 await page.locator('li.pp-invoice').filter({hasText:state.invoice.invoice_number}).getByRole('button',{name:'View details',exact:true}).click();await page.getByText(state.invoice.receipt.number,{exact:true}).waitFor()
 const download=page.waitForEvent('download');await page.locator('li.pp-invoice').filter({hasText:state.invoice.invoice_number}).getByRole('button',{name:'Download Receipt',exact:true}).click();const pdf=await download;assert.equal(await pdf.failure(),null);await pdf.saveAs(evidence+'/payment-receipt.pdf');assert.equal(readFileSync(evidence+'/payment-receipt.pdf').subarray(0,5).toString(),'%PDF-')
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:evidence+'/patient-receipt-390.png',fullPage:true})
 await page.reload();await page.locator('li.pp-invoice').filter({hasText:state.invoice.invoice_number}).getByRole('button',{name:'View details',exact:true}).click();await page.getByText(state.invoice.receipt.number,{exact:true}).waitFor();console.log('PASS Patient mobile receipt, real PDF, refreshed persisted readback')
 state.accepted=true;save()
} catch(e){if(page){console.log((await page.locator('body').innerText()).slice(-7500));await page.screenshot({path:evidence+'/journey-failure.png',fullPage:true})}throw e} finally{await browser.close()}

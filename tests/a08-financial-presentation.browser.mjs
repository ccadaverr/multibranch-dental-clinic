// Real synthetic Cash settlement and read-only reporting. Never substitutes the B11 fixture amounts for this database.
import assert from 'node:assert/strict'
import {existsSync,readFileSync,writeFileSync} from 'node:fs'
import {addDays,clinicDateAt} from '../src/clock.js'
import {exactPeso,pesoCentavos} from '../src/owner-revenue-data.js'
const {browser,login,get,api,evidence}=await import('./local-visit-support.mjs')
const file=evidence+'/financial.json',state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{}
const save=()=>writeFileSync(file,JSON.stringify(state,null,2))
const command=(page,name,args)=>page.evaluate(async({name,args})=>(await import('/src/api-client.js'))[name](...args),{name,args})
let page
try{
 const patient=await login('patient@example.test'),staff=await login('staff.reception@example.test'),owner=await login('owner@example.test');page=owner.page
 if(!state.invoice){
  const rows=(await get(patient.page,'/api/invoices/mine?status=Issued&per_page=100')).body.data
  const invoice=rows.find(i=>i.status==='Issued'&&pesoCentavos(i.balance)>0n&&!i.payment)
  assert.ok(invoice,'Fresh synthetic seed must have its unpaid Patient invoice')
  state.invoice=(await get(staff.page,'/api/invoices/'+invoice.id)).body.data
  const today=clinicDateAt(new Date().toISOString()),issued=clinicDateAt(state.invoice.issued_at)
  state.before={}
  for(const date of new Set([today,addDays(today,1),issued])){
   const query='?date_from='+date+'&date_to='+date
   state.before[date]={daily:(await get(page,'/api/analytics/daily-revenue'+query)).body.data,summary:(await get(page,'/api/analytics/executive-summary'+query)).body.data}
  }
  save()
 }
 const invoice=state.invoice,key='a08-synthetic-cash-'+invoice.id,payload={expected_revision:invoice.revision,method:'Cash',amount:invoice.balance}
 if(!state.verified){
  await staff.page.route(api+'/api/invoices/'+invoice.id+'/payment',async route=>{
   const response=await route.fetch();assert.equal(response.status(),200);state.committed=(await response.json()).data;save();await route.abort('failed')
  },{times:1})
  assert.equal((await command(staff.page,'recordBillingPayment',[invoice.id,payload,key])).ok,false)
  const replay=await command(staff.page,'recordBillingPayment',[invoice.id,payload,key]);assert.equal(replay.ok,true)
  assert.equal(replay.data.payment.id,state.committed.payment.id);assert.equal(replay.data.receipt.id,state.committed.receipt.id)
  assert.equal(replay.data.revision,state.committed.revision);state.verified=true;save()
 }
 const paid=(await get(patient.page,'/api/invoices/'+invoice.id)).body.data
 assert.equal(paid.status,'Paid');assert.equal(paid.balance,'0.00');assert.equal(paid.visit_id,invoice.visit_id);assert.equal(paid.patient.id,invoice.patient.id)
 assert.equal(paid.receipt.id,state.committed.receipt.id);assert.equal(paid.history.length,invoice.history.length+1)
 const paymentDay=clinicDateAt(paid.payment.recorded_at),issuedDay=clinicDateAt(invoice.issued_at),query='?date_from='+paymentDay+'&date_to='+paymentDay
 const daily=(await get(page,'/api/analytics/daily-revenue'+query)).body.data
 assert.equal(pesoCentavos(daily.totals.gross_collected_php)-pesoCentavos(state.before[paymentDay].daily.totals.gross_collected_php),pesoCentavos(invoice.balance))
 const summary=(await get(page,'/api/analytics/executive-summary?date_from='+issuedDay+'&date_to='+issuedDay)).body.data
 assert.equal(pesoCentavos(summary.financials.total_collected_php)-pesoCentavos(state.before[issuedDay].summary.financials.total_collected_php),pesoCentavos(paid.paid_amount))
 const branches=(await get(page,'/api/branches')).body.data,branch=branches.find(b=>b.id===paid.branch.id||b.ref===paid.branch.id||b.legacy_ref===paid.branch.id)
 assert.ok(branch?.public_id)
 const scoped=(await get(page,'/api/analytics/daily-revenue'+query+'&branch_id='+branch.public_id)).body.data
 assert.equal(scoped.branch.public_id,branch.public_id)
 await page.getByRole('button',{name:'Open analytics',exact:true}).click()
 await page.getByRole('combobox',{name:'Report period',exact:true}).selectOption('Custom dates')
 await page.getByLabel('From date',{exact:true}).fill(paymentDay);await page.getByLabel('Through date',{exact:true}).fill(paymentDay)
 await page.getByRole('button',{name:'Apply dates',exact:true}).click()
 await page.locator('.branch-scope select').selectOption({label:branch.name})
 const card=page.locator('.owner-revenue .card').filter({has:page.getByRole('heading',{name:'Daily revenue',exact:true})})
 await card.locator('.owner-revenue-totals').getByText(exactPeso(scoped.totals.gross_collected_php),{exact:true}).first().waitFor()
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export Report CSV',exact:true}).click();const csv=await download
 assert.ok(csv.suggestedFilename().includes(paymentDay));await csv.saveAs(evidence+'/live-report.csv')
 const text=readFileSync(evidence+'/live-report.csv','utf8')
 assert.ok(text.includes('Invoice creation (Asia/Manila); collected amounts use Paid invoices'))
 assert.ok(text.includes('Payments recorded and refunds made (Asia/Manila)'))
 assert.ok(text.includes(paymentDay+','+scoped.totals.gross_collected_php+','+scoped.totals.refunded_php+','+scoped.totals.net_cash_flow_php))
 assert.ok(text.includes(branch.name))
 const pdfEvent=patient.page.waitForEvent('download')
 assert.equal((await command(patient.page,'downloadBillingPdf',[paid.id,'receipt',{receiptId:paid.receipt.id,patientId:paid.patient.id}])).ok,true)
 const pdf=await pdfEvent;await pdf.saveAs(evidence+'/patient-receipt.pdf');assert.equal(readFileSync(evidence+'/patient-receipt.pdf').subarray(0,5).toString(),'%PDF-')
 for(const account of [patient,staff,await login('dentist@example.test')])assert.equal((await get(account.page,'/api/analytics/export'+query)).status,403)
 for(const width of [375,390,430,768,1024,1440]){
  await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  await page.screenshot({path:evidence+'/report-'+width+'.png',fullPage:true})
 }
 state.accepted=true;state.paymentDay=paymentDay;state.issuedDay=issuedDay;state.report=scoped.totals;save()
 console.log('PASS real synthetic Cash exact replay, one receipt, invoice/Visit/Patient identity, payment-date and invoice-date deltas, scoped chart/CSV, Patient PDF and three-role report denial across six widths')
}catch(error){if(page){writeFileSync(evidence+'/failure-text.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/failure.png',fullPage:true})}throw error}
finally{await browser.close()}

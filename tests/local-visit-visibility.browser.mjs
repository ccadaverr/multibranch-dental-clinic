import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {browser,login,get,api,evidence} from './local-visit-support.mjs'
const state=JSON.parse(readFileSync(evidence+'/journey.json','utf8')),results=[]
async function inspect(page,name){
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' horizontal overflow')
 const unlabeled=await page.locator('main input:not([type=hidden]),main select,main textarea').evaluateAll(controls=>controls.filter(c=>!c.getAttribute('aria-label')&&!c.getAttribute('aria-labelledby')&&!c.labels?.length).map(c=>c.outerHTML.slice(0,100)))
 assert.deepEqual(unlabeled,[],name+' unlabeled fields')
 await page.screenshot({path:evidence+'/'+name+'.png',fullPage:true});results.push(name)
}
try {
 for(const [role,email] of [['staff','sprint02.staff@example.test'],['patient','sprint02.patient@example.test']]){
  const {page,context}=await login(email)
  await page.getByRole('button',{name:role==='patient'?'Billing':'Billing & Payments',exact:true}).click()
  if(role==='patient'){await page.locator('li.pp-invoice').filter({hasText:state.invoice.invoice_number}).getByRole('button',{name:'View details',exact:true}).click()}
  else {if(role==='owner')await page.getByRole('combobox',{name:'Filter invoices by branch'}).selectOption('sprint02');const summary=page.locator('details').filter({hasText:state.invoice.invoice_number}).locator('summary');await summary.focus();await page.keyboard.press('Enter');assert.equal(await summary.evaluate(e=>e.parentElement.open),true)}
  if(role==='owner'){assert.equal(await page.getByRole('button',{name:'Record full payment',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Create Draft',exact:true}).count(),0)}
  for(const width of [375,430,768,1024,1440]){await page.setViewportSize({width,height:1000});await inspect(page,`${role}-billing-${width}`)}
  await context.close()
 }
 const owner=await login('owner@example.test');assert.equal((await get(owner.page,'/api/invoices/'+state.invoice.id)).status,200);assert.equal(await owner.page.getByRole('button',{name:'Record full payment',exact:true}).count(),0);results.push('Owner financial read authorized; payment worklist remains unavailable');await owner.context.close()
 // Real authenticated negative reads: another Patient and branch-scoped Staff never receive financial/clinical evidence.
 for(const email of ['patient@example.test','staff.reception@example.test','dentist@example.test']){
  const {page,context}=await login(email)
  const invoice=await get(page,'/api/invoices/'+state.invoice.id);assert.equal(invoice.status,403)
  const pdf=await page.evaluate(async url=>{const r=await fetch(url,{credentials:'include',headers:{Accept:'application/json'}});return r.status},api+'/api/invoices/'+state.invoice.id+'/receipt-pdf');assert.ok([403,404].includes(pdf))
  const treatment=await get(page,'/api/treatments/'+state.treatment.id);assert.equal(treatment.status,403)
  results.push(email.split('@')[0]+' denied foreign invoice/PDF/encounter');await context.close()
 }
 const {page}=await login('sprint02.patient@example.test',390);await page.getByRole('button',{name:/^Billing/}).click();await page.locator('li.pp-invoice').filter({hasText:state.invoice.invoice_number}).getByRole('button',{name:'View details',exact:true}).click();await page.getByText(state.invoice.receipt.number,{exact:true}).waitFor();results.push('receipt survives a separate new Patient session')
 assert.equal((await get(page,'/api/invoices/00000000000000000000000000')).status,404);results.push('missing invoice returns 404')
 await page.getByRole('button',{name:'Home',exact:true}).click()
 await page.route(api+'/api/invoices/mine?**',r=>r.abort('failed'))
 await page.getByRole('button',{name:/^Billing/}).click();await page.getByRole('alert').filter({hasText:'Could not reach the clinic system'}).waitFor()
 assert.equal(await page.getByText(state.invoice.receipt.number,{exact:true}).count(),0)
 await page.unroute(api+'/api/invoices/mine?**');await page.getByRole('button',{name:'Try again',exact:true}).click()
 await page.locator('li.pp-invoice').filter({hasText:state.invoice.invoice_number}).getByRole('button',{name:'View details',exact:true}).click();await page.getByText(state.invoice.receipt.number,{exact:true}).waitFor();results.push('Patient failed read is truthful; Retry restores actual receipt')
 writeFileSync(evidence+'/responsive-isolation.json',JSON.stringify({results},null,2));console.log('PASS '+results.length+' responsive, keyboard/labels, role-isolation and new-session groups')
}finally{await browser.close()}

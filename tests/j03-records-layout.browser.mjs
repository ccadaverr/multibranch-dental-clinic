// Final populated UI evidence, after all source edits. Existing synthetic source journal only.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {browser,login,get,api,evidence,target,base} from './local-visit-support.mjs'
const state=JSON.parse(readFileSync(target.runtime+'/records-browser/journey.json','utf8')),f=JSON.parse(readFileSync(target.runtime+'/visit-fixture.json','utf8')),care=JSON.parse(readFileSync(target.runtime+'/clinical-browser/journey.json','utf8'))
assert.equal(state.accepted,true)
let page
try{
 const staff=await login('sprint02.staff@example.test');page=staff.page
 const shared=await page.evaluate(async({f,visit})=>{const a=await import('/src/api-client.js'),body=new FormData();body.append('file',new File(['%PDF-1.4\n1 0 obj\n<< >>\nstream\nBT (Synthetic clinic-shared file) Tj ET\nendstream\nendobj\n%%EOF'],'synthetic-shared.pdf',{type:'application/pdf'}));body.append('patient_id',f.patientId);body.append('branch_id',f.branch);body.append('visit_id',visit);body.append('category','referral');body.append('title','Synthetic clinic-shared referral — not clinical data');const r=await a.uploadDocument(body,'j03-shared-visual-fixture');if(!r.ok)throw Error(JSON.stringify(r));return r.data},{f,visit:care.visit.id})
 await staff.context.close();const patient=await login('sprint02.patient@example.test');page=patient.page
 const open=async name=>{await page.goto(base+'/?j03-layout='+Date.now()+'#p/'+name);await page.locator('.pp-shell').waitFor()}
 const ready=async label=>{await page.getByRole('button',{name:label,exact:true}).waitFor();await page.waitForFunction(label=>document.querySelector('[aria-label="'+label+'"]')?.getAttribute('aria-busy')==='false',label)}
 await open('documents');await ready('Reload documents and consents')
 const record=page.locator('#patient-doc-'+shared.id);await record.locator('summary').focus();await page.keyboard.press('Enter')
 assert.equal(await record.evaluate(el=>el.open),true);await record.getByText('Shared by clinic',{exact:true}).waitFor();assert.equal(await record.getByRole('button',{name:'Retract',exact:true}).count(),0)
 assert.equal((await page.evaluate(async({api,id})=>{const a=await import('/src/api-client.js');return a.retractDocument(id,{reason:'Synthetic prohibited Patient operation'})},{api,id:shared.id})).kind,'forbidden')
 assert.equal(await page.getByRole('button',{name:'Clear filters',exact:true}).count(),0)
 await page.getByRole('searchbox',{name:'Search documents…',exact:true}).fill('Synthetic');await page.getByRole('button',{name:'Clear filters',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Clear filters',exact:true}).count(),0)
 for(const width of [375,390,430,768,1024,1440]){
  await page.setViewportSize({width,height:1000});await ready('Reload documents and consents');await record.getByText(shared.id,{exact:true}).waitFor()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  const status=record.locator(':scope > summary > .status'),box=await status.boundingBox();assert.ok(box.height<32,'unbroken status at '+width)
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:evidence+'/final-documents-'+width+'.png',fullPage:true})
 }
 let release,started;const began=new Promise(r=>started=r),gate=new Promise(r=>release=r),downloads=[]
 page.on('download',file=>downloads.push(file))
 await page.route(api+'/api/documents/'+shared.id+'/download',async route=>{const response=await route.fetch();started();await gate;await route.fulfill({response})},{times:1})
 await record.getByRole('button',{name:'Download',exact:true}).click();await began
 await page.getByRole('button',{name:'Reload documents and consents',exact:true}).click();release();await ready('Reload documents and consents');await page.waitForTimeout(800);assert.equal(downloads.length,0,'reload must invalidate the earlier download')
 for(const [tab,label] of [['visits','Care records'],['prescriptions','Past Prescriptions'],['receipts','Past Receipts']]){
  await open('archives');await ready('Reload historical records');await page.getByRole('tab',{name:new RegExp(label)}).click()
  for(const width of [375,390,430,768,1024,1440]){
   await page.setViewportSize({width,height:1000});await ready('Reload historical records');await page.getByRole('tab',{name:new RegExp(label)}).click()
   if(tab==='visits')await page.locator('.history-record').filter({hasText:'Treatment summary'}).waitFor()
   if(tab==='prescriptions')await page.getByText(state.prescription.number,{exact:true}).waitFor()
   if(tab==='receipts')await page.getByText(state.invoice.receipt.number,{exact:true}).waitFor()
   assert.equal(await page.getByRole('button',{name:'Clear filters',exact:true}).count(),0)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
   await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:evidence+'/final-'+tab+'-'+width+'.png',fullPage:true})
  }
 }
 await page.getByRole('tab',{name:/Past Receipts/}).focus();await page.keyboard.press('Home');assert.equal(await page.getByRole('tab',{name:/Care records/}).getAttribute('aria-selected'),'true');await page.keyboard.press('End');assert.equal(await page.getByRole('tab',{name:/Past Receipts/}).getAttribute('aria-selected'),'true');await page.keyboard.press('ArrowLeft');await page.getByText(state.prescription.number,{exact:true}).waitFor();await page.keyboard.press('ArrowRight');await page.getByText(state.invoice.receipt.number,{exact:true}).waitFor()
 writeFileSync(evidence+'/layout-results.json',JSON.stringify({accepted:true,widths:[375,390,430,768,1024,1440],sharedDocument:shared.id,patient:f.patientId,visit:care.visit.id},null,2))
 console.log('PASS final populated documents/consents, clinic-sharing restriction, keyboard disclosure, inactive X and all three history tabs at six widths')
}catch(error){if(page&&!page.isClosed()){writeFileSync(evidence+'/layout-failure.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/layout-failure.png',fullPage:true})}throw error}finally{await browser.close()}

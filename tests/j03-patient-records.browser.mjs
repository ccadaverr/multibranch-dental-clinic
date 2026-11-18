// Actual authorized synthetic workflows only; successful API responses are never fabricated.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {browser,login,get,api,evidence,target,base} from './local-visit-support.mjs'
const f=JSON.parse(readFileSync(target.runtime+'/visit-fixture.json','utf8'))
const care=JSON.parse(readFileSync(target.runtime+'/clinical-browser/journey.json','utf8'));assert.equal(care.accepted,true)
const journal=evidence+'/journey.json',state=existsSync(journal)?JSON.parse(readFileSync(journal,'utf8')):{groups:[]};state.accepted=false
const save=()=>writeFileSync(journal,JSON.stringify(state,null,2)),pass=s=>{if(!state.groups.includes(s))state.groups.push(s);save();console.log('PASS '+s)}
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nstream\nBT (Synthetic J03 referral, no clinical data) Tj ET\nendstream\nendobj\n%%EOF')
const path=target.runtime+'/synthetic-j03.pdf';writeFileSync(path,pdf,{mode:0o600})
const widths=[375,390,430,768,1024,1440]
async function command(page,name,args){return page.evaluate(async({name,args})=>{const a=await import('/src/api-client.js'),r=await a[name](...args);if(!r.ok)throw Error(JSON.stringify(r));return r.data},{name,args})}
async function screen(page,name){for(const width of widths){await page.setViewportSize({width,height:1000});await page.evaluate(()=>window.scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow '+width);await page.screenshot({path:evidence+'/'+name+'-'+width+'.png',fullPage:true})}}
async function portal(page,name){await page.goto(base+'/?j03='+Date.now()+'#p/'+name);await page.locator('.pp-shell').waitFor()}
const loaded=page=>page.waitForFunction(()=>document.querySelector('[aria-label="Reload documents and consents"]')?.getAttribute('aria-busy')==='false')
let page
try{
 const patient=await login('sprint02.patient@example.test');page=patient.page
 await portal(page,'documents');await loaded(page)
 assert.match(await page.locator('.doc-owner').innerText(),new RegExp(f.patientId))
 if(!state.document){
  const before=(await get(page,'/api/documents/mine?per_page=100')).body.data.length
  await page.getByRole('button',{name:'Upload Document',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Upload Document',exact:true})
  assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)))
  await dialog.getByLabel(/^Document File/).setInputFiles(path)
  await dialog.getByRole('textbox',{name:'Title / Description',exact:true}).fill('Synthetic J03 referral — not clinical data')
  await dialog.getByRole('combobox',{name:'Category',exact:true}).selectOption('referral')
  const keys=[];page.on('request',r=>{if(r.url()===api+'/api/documents'&&r.method()==='POST')keys.push(r.headers()['idempotency-key'])})
  // CDP route.fetch omits binary multipart bytes. Inject only the failed response after the browser's real fetch commits.
  await page.evaluate(api=>{const real=window.fetch;let lose=true;window.fetch=async(input,options)=>{const response=await real(input,options);if(lose&&input===api+'/api/documents'&&options?.method==='POST'){lose=false;window.__j03UploadReceipt={status:response.status,body:await response.clone().json()};return new Response(JSON.stringify({message:'Synthetic committed upload response loss'}),{status:503,headers:{'Content-Type':'application/json'}})}return response}},api)
  await dialog.getByRole('button',{name:'Upload',exact:true}).evaluate(b=>{b.click();b.click()})
  await dialog.getByRole('button',{name:'Retry same upload',exact:true}).waitFor()
  const committed=await page.evaluate(()=>window.__j03UploadReceipt);if(committed.status!==201)writeFileSync(evidence+'/upload-refusal.json',JSON.stringify(committed.body));assert.equal(committed.status,201);state.document=committed.body.data;save()
  assert.equal(keys.length,1);assert.equal(await dialog.getByRole('textbox',{name:'Title / Description',exact:true}).isDisabled(),true);assert.equal(await dialog.getByRole('button',{name:'Cancel',exact:true}).isDisabled(),true)
  await dialog.getByRole('button',{name:'Retry same upload',exact:true}).focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'hidden'});await loaded(page)
  assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal((await get(page,'/api/documents/mine?per_page=100')).body.data.length,before+1)
 }
 assert.equal(state.document.patient.id,f.patientId);assert.equal(state.document.checksum_sha256,createHash('sha256').update(pdf).digest('hex'))
 pass('Patient upload: committed response loss, synchronous duplicate guard, immutable fields/key, keyboard retry and exact persisted document')
 if(!state.granted){state.granted=await command(page,'grantPatientConsent',[f.patientId,{consent_type:'data_privacy',version:'synthetic-j03',notes:'Synthetic recorded consent fixture only',document_id:state.document.id}]);save()}
 if(!state.withdrawn){let c=await command(page,'grantPatientConsent',[f.patientId,{consent_type:'photography_consent',version:'synthetic-j03',notes:'Synthetic withdrawn consent fixture only',document_id:state.document.id}]);state.withdrawn=await command(page,'withdrawPatientConsent',[f.patientId,c.id]);save()}
 await page.getByRole('button',{name:'Reload documents and consents',exact:true}).click();await loaded(page)
 await page.getByText('Synthetic recorded consent fixture only',{exact:true}).waitFor();await page.getByText('Withdrawn',{exact:true}).waitFor()
 const record=page.locator('#patient-doc-'+state.document.id)
 await page.getByRole('button',{name:'Review supporting document',exact:true}).first().click();assert.equal(await record.evaluate(el=>el.open),true);assert.ok(await record.locator('summary').evaluate(el=>el===document.activeElement))
 await record.getByText(f.patientCode,{exact:false}).waitFor()
 const download=page.waitForEvent('download');await record.getByRole('button',{name:'Download',exact:true}).click();const file=await download;await file.saveAs(evidence+'/verified-document.pdf');assert.deepEqual(readFileSync(evidence+'/verified-document.pdf'),pdf)
 await page.getByRole('searchbox',{name:'Search documents…',exact:true}).fill('missing-j03');await page.getByText('No matching documents',{exact:true}).waitFor();await page.getByRole('button',{name:'Clear filters',exact:true}).click()
 assert.equal(await page.getByRole('searchbox',{name:'Search documents…',exact:true}).inputValue(),'')
 await page.getByRole('combobox',{name:'Document category',exact:true}).selectOption('referral');await page.getByRole('button',{name:'Clear filters',exact:true}).click()
 await screen(page,'documents-consents');pass('Granted/Withdrawn consent readback, exact supporting file, real digest-verified download, shared search/X reset and six widths')
 // Adversarial read faults never establish a successful transition.
 await page.route(api+'/api/documents/mine?*',async route=>{const response=await route.fetch(),body=await response.json();body.data[0].patient.id='foreign';body.data[0].title='FOREIGN DOCUMENT SENTINEL';await route.fulfill({response,json:body})},{times:1})
 await page.getByRole('button',{name:'Reload documents and consents',exact:true}).click();await loaded(page);await page.getByText('The documents did not confirm your Patient identity. Reload to try again.',{exact:true}).waitFor();assert.equal(await page.getByText('FOREIGN DOCUMENT SENTINEL',{exact:false}).count(),0)
 await page.getByRole('button',{name:'Try again',exact:true}).click();await loaded(page)
 await record.locator('summary').click()
 await page.route(api+'/api/documents/'+state.document.id+'/download',async route=>{const response=await route.fetch();await route.fulfill({response,body:Buffer.alloc(pdf.length,120)})},{times:1})
 await record.getByRole('button',{name:'Download',exact:true}).click();await page.getByText('The downloaded file did not match its record. No file was downloaded.',{exact:true}).waitFor()
 let release,started;const began=new Promise(r=>started=r),gate=new Promise(r=>release=r),downloads=[]
 page.on('download',file=>downloads.push(file))
 await page.route(api+'/api/documents/'+state.document.id+'/download',async route=>{const response=await route.fetch();started();await gate;await route.fulfill({response})},{times:1})
 await record.getByRole('button',{name:'Download',exact:true}).click();await began;await page.getByRole('button',{name:'Home',exact:true}).first().click();release();await page.waitForTimeout(800);assert.equal(downloads.length,0)
 const other=await login('patient@example.test');assert.equal((await get(other.page,'/api/documents/'+state.document.id)).status,403);assert.equal((await get(other.page,'/api/patients/'+f.patientId+'/consents')).status,403);await other.context.close()
 pass('foreign document/consent denial, foreign-response refusal, corrupt-body rejection and abandoned download suppression')
 // Real synthetic financial lifecycle, in the isolated target only. No provider or email is invoked.
 const owner=await login('owner@example.test');page=owner.page
 if(!state.price){state.price=await command(page,'createServicePrice',[f.service,{branch_ref:f.branch,kind:'priced',amount:'125.50',effective_from:care.treatment.clinic_date},'j03-synthetic-price']);save()};await owner.context.close()
 const staff=await login('sprint02.staff@example.test');page=staff.page
 if(!state.invoice){state.invoice=await command(page,'createBillingDraft',[care.treatment.id,'j03-invoice-draft']);save()}
 if(state.invoice.status==='Draft'){state.invoice=await command(page,'reviewBillingInvoice',[state.invoice.id,{expected_revision:state.invoice.revision},'j03-invoice-review']);save()}
 if(state.invoice.status==='Review'){state.invoice=await command(page,'issueBillingInvoice',[state.invoice.id,{expected_revision:state.invoice.revision},'j03-invoice-issue']);save()}
 if(state.invoice.status==='Issued'){state.invoice=await command(page,'recordBillingPayment',[state.invoice.id,{expected_revision:state.invoice.revision,method:'Cash',amount:'125.50'},'j03-synthetic-cash']);save()}
 assert.equal(state.invoice.status,'Paid');assert.ok(state.invoice.receipt.id);assert.equal(state.invoice.visit_id,care.visit.id);await staff.context.close()
 const dentist=await login('sprint02.dentist@example.test');page=dentist.page
 if(!state.prescription){state.prescription=await page.evaluate(async visit=>{const a=await import('/src/api-client.js'),me=await a.me(),context=me.data.clinical_context;let r=await a.createPrescription({visit_id:visit,lines:[{medicine:'Synthetic J03 medicine — not for clinical use'}]},'j03-prescription',undefined,context);if(!r.ok)throw Error(JSON.stringify(r));r=await a.issuePrescription(r.data.id,r.data.revision,'j03-issue',undefined,context);if(!r.ok)throw Error(JSON.stringify(r));return r.data},care.visit.id);save()};await dentist.context.close()
 page=patient.page;await portal(page,'archives');await page.getByRole('button',{name:'Reload historical records',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="Reload historical records"]')?.getAttribute('aria-busy')==='false')
 await page.getByRole('searchbox',{name:'Search care records…',exact:true}).fill(care.treatment.id);const summary=page.locator('.history-record').filter({hasText:'Treatment summary'});await summary.locator('summary').click();await summary.getByText('Summary '+care.treatment.id,{exact:true}).waitFor();assert.equal(await summary.getByRole('button',{name:'View appointment',exact:true}).count(),0)
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();await screen(page,'care-history')
 await page.getByRole('tab',{name:/Past Prescriptions/}).click();await page.getByText(state.prescription.number,{exact:true}).waitFor();await page.getByText('Visit '+care.visit.id,{exact:true}).waitFor();await screen(page,'prescription-history')
 await page.getByRole('tab',{name:/Past Receipts/}).click();await page.getByText(state.invoice.receipt.number,{exact:true}).waitFor();await screen(page,'receipt-history')
 const financial=[];page.on('request',r=>{if(r.method()==='POST'&&/\/payment$/.test(new URL(r.url()).pathname))financial.push(r.url())})
 const receiptDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download Receipt',exact:true}).click();await (await receiptDownload).saveAs(evidence+'/verified-receipt.pdf');assert.equal(readFileSync(evidence+'/verified-receipt.pdf').subarray(0,5).toString(),'%PDF-')
 await page.getByRole('button',{name:'View saved receipt',exact:true}).click();await page.getByText(state.invoice.receipt.number,{exact:false}).first().waitFor();assert.equal((await get(page,'/api/invoices/'+state.invoice.id)).body.data.receipt.id,state.invoice.receipt.id);assert.equal(financial.length,0)
 pass('real synthetic receipt and issued prescription; exact Visit/receipt identity, six-width archives, real PDF and direct saved-receipt navigation without payment writes')
 const fresh=await login('sprint02.patient@example.test');page=fresh.page;await portal(page,'documents');await loaded(page)
 const saved=page.locator('#patient-doc-'+state.document.id);await saved.locator('summary').click();await saved.getByRole('button',{name:'Retract',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Retract Document',exact:true})
 await dialog.getByRole('textbox',{name:'Reason for Retraction',exact:true}).fill('Synthetic J03 obsolete copy')
 await page.route(api+'/api/documents/'+state.document.id+'/retract',async route=>{const response=await route.fetch();assert.equal(response.status(),200);await route.fulfill({status:503,json:{message:'Synthetic retraction response loss'}})},{times:1})
 await dialog.getByRole('button',{name:'Confirm Retraction',exact:true}).click();await dialog.getByText('Retraction is unconfirmed. Retry uses the original document and reason.',{exact:true}).waitFor();assert.equal(await dialog.getByRole('textbox',{name:'Reason for Retraction',exact:true}).isDisabled(),true);assert.equal(await dialog.getByRole('button',{name:'Cancel',exact:true}).isDisabled(),true)
 await dialog.getByRole('button',{name:'Confirm Retraction',exact:true}).click();await dialog.waitFor({state:'hidden'});await loaded(page)
 const result=await get(page,'/api/documents/'+state.document.id);assert.equal(result.body.data.status,'Retracted');assert.equal(result.body.data.retraction_reason,'Synthetic J03 obsolete copy');assert.equal(await page.locator('#patient-doc-'+state.document.id).count(),0);await page.getByText('Synthetic recorded consent fixture only',{exact:true}).waitFor()
 await page.screenshot({path:evidence+'/retracted-document-1440.png',fullPage:true});pass('new-session persisted documents; committed retraction recovers exact status without replacing reason or consent history')
 state.accepted=true;save()
}catch(error){if(page&&!page.isClosed()){writeFileSync(evidence+'/failure-text.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/failure.png',fullPage:true})}throw error}finally{await browser.close()}

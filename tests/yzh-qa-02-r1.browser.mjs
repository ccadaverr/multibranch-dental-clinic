import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'
import {readFile} from 'node:fs/promises'
import {transform} from 'esbuild'

const before=process.argv.includes('--before'), evidence=process.env.QA_EVIDENCE_DIR||'docs/ui-review/yzh-qa-02/r1'
const preCopy=process.argv.includes('--pre-r1-copy')
const selectedCase=process.argv.find(a=>a.startsWith('--case='))?.slice(7)
const browser=await chromium.launch({channel:'chrome',headless:true})
await mkdir(evidence,{recursive:true})
const results=[]
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
const frame=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
const boot=async(page,mode)=>{await page.goto('http://127.0.0.1:5187/tests/fixtures/yzh-qa-02.html');await page.waitForFunction(()=>window.qa02);if(mode)await page.evaluate(m=>window.qa02.setMode(m),mode)}
const button=(page,name)=>page.getByRole('button',{name,exact:true})

async function prescription(page,operation,failure=false,cancel=false){
 const calls=[],ready=deferred(),release=deferred();let bRefused=false
 const rows=['A','B'].map(id=>({id,visit:'v'+id,patient:{id:'p'+id,name:'Synthetic patient '+id},status:'Draft',revision:1,can_edit:true,can_void:false,lines:[{medicine:'Paracetamol',dosage:'500mg',frequency:'',duration:'',instructions:''}],note:'',branch:'Synthetic branch',dentist:'Synthetic dentist'}))
 await page.route('**/sanctum/**',r=>r.fulfill({status:204}))
 await page.route('**/api/**',async route=>{
  const req=route.request(),p=new URL(req.url()).pathname,method=req.method()
  if(method==='GET'){
   if(p==='/api/prescriptions')return route.fulfill({json:{data:rows}})
   if(p.endsWith('/visits'))return route.fulfill({json:{data:rows.map(r=>({id:r.visit,patient:r.patient,date:'2026-11-02',branch:r.branch})),meta:{allergy_notice:'Ask the patient'}}})
   if(p==='/api/prescriptions/A'||p==='/api/prescriptions/B')return route.fulfill({json:{data:rows.find(r=>r.id===p.split('/').at(-1))}})
   return route.fulfill({json:{data:[]}})
  }
  calls.push({path:p,method,body:req.postDataJSON()})
  assert(['PUT /api/prescriptions/A','PUT /api/prescriptions/B','POST /api/prescriptions/A/issue'].includes(method+' '+p),'unexpected mutation')
  const held=p==='/api/prescriptions/A'+(operation==='issue'?'/issue':'')
  if(held){ready.resolve();await release.promise}
  if(held&&failure)return route.fulfill({status:422,json:{message:'Synthetic A refused',errors:{note:['Synthetic A refused']}}})
  if(p==='/api/prescriptions/B'&&failure&&!bRefused){bRefused=true;return route.fulfill({status:422,json:{message:'Synthetic B refused',errors:{note:['Synthetic B refused']}}})}
  const row=rows.find(r=>p.includes('/'+r.id));row.revision++;row.status=p.endsWith('/issue')?'Issued':'Draft';row.can_edit=row.status==='Draft';row.lines=req.postDataJSON().lines||row.lines
  return route.fulfill({json:{data:row}})
 })
 try{
  await boot(page,'rx');await button(page,'Edit draft').first().click();await page.getByText('Edit draft for Synthetic patient A',{exact:true}).waitFor()
  if(operation==='issue'){await button(page,'Issue prescription').click();await page.getByRole('dialog',{name:'Issue and lock prescription?'}).getByRole('button',{name:'Issue prescription',exact:true}).click()}
  else await button(page,'Save draft').click()
  await ready.promise
  if(cancel){await button(page,'Cancel').click();await page.getByRole('combobox',{name:/^Visit/}).selectOption('vB');await page.getByRole('textbox',{name:/^Note \(optional\)/}).fill('Synthetic new draft after Cancel')}
  else{
   await button(page,'Edit draft').nth(1).click();await page.getByText('Edit draft for Synthetic patient B',{exact:true}).waitFor()
   await page.getByLabel('Select dosage 1',{exact:true}).selectOption('250mg')
   await page.getByRole('textbox',{name:/^Note \(optional\)/}).fill('Synthetic B typed draft')
   if(failure){await button(page,'Save draft').click();await page.getByText('Synthetic B refused',{exact:true}).waitFor()}
  }
  const response=page.waitForResponse(r=>r.request().method()!=='GET'&&new URL(r.url()).pathname==='/api/prescriptions/A'+(operation==='issue'?'/issue':''))
  release.resolve();await (await response).finished();await frame(page)
  assert.equal(await page.getByRole('dialog').count(),0,'stale A completion must not navigate or open a dialog')
  assert.deepEqual(await page.evaluate(()=>window.qa02Toasts),[],'stale result must not report success/error in another editor')
  if(cancel){assert.equal(await page.getByText('Edit draft for Synthetic patient A',{exact:true}).count(),0);assert.equal(await page.getByRole('textbox',{name:/^Note \(optional\)/}).inputValue(),'Synthetic new draft after Cancel')}
  else{
   await page.getByText('Edit draft for Synthetic patient B',{exact:true}).waitFor()
   assert.equal(await page.getByLabel('Select dosage 1',{exact:true}).inputValue(),'250mg')
   assert.equal(await page.getByRole('textbox',{name:/^Note \(optional\)/}).inputValue(),'Synthetic B typed draft')
   assert.equal(await page.getByText('Synthetic A refused',{exact:true}).count(),0)
   if(failure)assert.equal(await page.getByText('Synthetic B refused',{exact:true}).count(),1,'B retains its own error')
   assert.equal(calls[0].path,'/api/prescriptions/A');assert.equal(calls[0].body.lines[0].dosage,'500mg','pending A command never adopts B dosage')
   await button(page,'Save draft').click();await page.getByRole('dialog').waitFor()
   assert.equal(calls.at(-1).path,'/api/prescriptions/B');assert.equal(calls.at(-1).body.lines[0].dosage,'250mg');assert.equal(calls.at(-1).body.note,'Synthetic B typed draft')
   assert.equal((await page.evaluate(()=>window.qa02Toasts)).length,1,'current B Save still reports its own result')
  }
 }finally{release.resolve()}
}

async function booking(page,ambiguous=false,mode='cash',copy=false){
 if(preCopy){
  const source=await readFile('src/patient/pages/Book.jsx','utf8')
  const oldCopy=source.replace(/\{paymentMode==='cash'&&paymentChoices\.cash&&<p className="pp-hint">[^\n]+<\/p>\}/,'<p className="pp-hint">No payment is collected online with this choice. The clinic confirms your charges.</p>').replace(/\s*\{paymentMode==='online'&&paymentChoices\.online&&<p className="pp-hint">[^\n]+<\/p>\}/,'')
  assert.notEqual(source,oldCopy,'pre-R1 copy replay must replace the conditional copy')
  const transformed=await transform(oldCopy,{loader:'jsx',format:'esm'})
  const code=transformed.code.replace(/import React, \{([^}]+)\} from "react";/,'import React from "/node_modules/.vite/deps/react.js"; const {$1}=React;')
  await page.route('**/src/patient/pages/Book.jsx*',r=>r.fulfill({contentType:'text/javascript',body:code}))
 }
 let quoteMode='valid',abortFirst=ambiguous
 const posts=[],quotes=[],hold=deferred(),held=deferred()
 await page.route('**/sanctum/**',r=>r.fulfill({status:204}))
 await page.route('**/api/**',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname,params=Object.fromEntries(u.searchParams)
  const ok=data=>route.fulfill({json:{data}})
  if(p==='/api/services')return ok([{id:'consult',name:'Synthetic consultation',status:'Active',category:'General',online_booking:'bookable'}])
  if(p.endsWith('/dependents'))return ok([{id:'child',first_name:'Synthetic child',name:'Synthetic child',relationship:'Child'}])
  if(p.endsWith('/branch-options'))return ok({branches:[{id:'b1',name:'Synthetic Central',city:'Synthetic city',address:'Fixture'}]})
  if(p.endsWith('/calendar'))return ok({month:'2099-11',today:'2099-11-01',days:[{date:'2099-11-02',status:'available'}]})
  if(p.endsWith('/availability'))return ok({slots:[{start_time:'09:00'}]})
  if(p.endsWith('/booking-options')){
   quotes.push(params);if(quoteMode==='error')return route.fulfill({status:503,json:{message:'Synthetic quote unavailable'}})
   if(quoteMode==='held'){held.resolve();await hold.promise}
   return ok({...params,branch_ref:quoteMode==='mismatch'?'wrong-branch':params.branch_ref,currency:'PHP',booking_fee_php:'500.00',pay_at_clinic_available:true,online_payment_available:true,payment_methods:['gcash']})
  }
  if(p==='/api/public/faq')return ok([])
  assert.equal(req.method()+' '+p,'POST /api/appointments','unexpected mutation')
  posts.push({body:req.postDataJSON(),key:req.headers()['idempotency-key']})
  if(abortFirst){abortFirst=false;return route.abort()}
  return ok({id:'same-synthetic-booking',date:'2099-11-02',start_time:'09:00',status:'Pending',booking_payment_status:mode==='online'?'held':'unpaid'})
 })
 const submit=()=>page.getByRole('button',{name:/Submit booking/})
 try{
  await boot(page);await page.getByLabel('Booking for',{exact:true}).selectOption('child')
  await page.getByRole('button',{name:/Synthetic Central/}).click();await page.getByRole('gridcell',{name:/Nov 2, 2099/}).click()
  if(!ambiguous&&!copy)quoteMode='error'
  await button(page,'9:00 AM').click()
  if(copy){
   await page.getByRole('radio',{name:'Pay at the clinic',exact:true}).check()
   assert.equal(await page.getByText(/^No payment is collected online with this choice\./).count(),1)
   await page.getByRole('radio',{name:'Pay online',exact:true}).check()
   assert.equal(await page.getByText(/^No payment is collected online with this choice\./).count(),0,'online choice must not carry cash reassurance')
   await page.getByText('Continue to online checkout after submitting. Payment remains pending until the clinic server verifies it.',{exact:true}).waitFor()
   if(!before&&!preCopy)await page.screenshot({path:`${evidence}/online-${page.viewportSize().width}.png`,fullPage:true,animations:'disabled'})
   return
  }
  if(ambiguous){
   await page.getByRole('radio',{name:mode==='online'?'Pay online':'Pay at the clinic',exact:true}).check();await submit().click()
   await page.getByText(/The last booking response could not be verified/).waitFor();assert.equal(posts.length,1)
   quoteMode='error';await button(page,'Back').click();await button(page,'Return to Review').click()
  }
  await page.getByText('Synthetic quote unavailable',{exact:true}).waitFor();assert(await submit().isDisabled())
  const retry=button(page,'Try again');assert(await retry.isEnabled(),'quotation recovery must remain enabled while intent is locked')
  if(ambiguous&&mode==='cash'&&!before)await page.screenshot({path:`${evidence}/quote-retry-${page.viewportSize().width}.png`,fullPage:true,animations:'disabled'})
  quoteMode='held';await retry.click();await held.promise;assert(await submit().isDisabled(),'no quote means no submit')
  quoteMode='mismatch';const response=page.waitForResponse(r=>r.url().includes('/booking-options'));hold.resolve();await(await response).finished();await frame(page)
  assert(await submit().isDisabled(),'mismatched quote must not unlock Submit');assert.equal(posts.length,ambiguous?1:0,'retrying a read never resends the booking')
  quoteMode='valid';await button(page,'Back').click()
  if(ambiguous)await button(page,'Return to Review').click();else await button(page,'9:00 AM').click()
  await page.getByText('Booking fee:',{exact:false}).waitFor()
  if(!ambiguous)await page.getByRole('radio',{name:'Pay at the clinic',exact:true}).check()
  assert(await submit().isEnabled());assert.equal(await page.getByLabel('Booking for',{exact:true}).inputValue(),'child')
  const radio=page.getByRole('radio',{name:mode==='online'?'Pay online':'Pay at the clinic',exact:true});assert(await radio.isChecked())
  assert(quotes.every(q=>q.for_patient_id==='child'&&q.branch_ref==='b1'&&q.service_ref==='consult'&&q.date==='2099-11-02'))
  await submit().click();await page.getByRole('heading',{name:mode==='online'?'Pending payment verification':'Pending front-desk confirmation',exact:true}).waitFor()
  assert.equal(posts.length,ambiguous?2:1)
  assert.equal(posts.at(-1).body.for_patient_id,'child');assert.equal(posts.at(-1).body.pay_at_clinic,mode!=='online')
  if(ambiguous)assert.deepEqual(posts[1],posts[0],'explicit replay must preserve the exact body and idempotency key')
 }finally{hold.resolve()}
}

async function calendar(page,failure){
 const ready=deferred(),release=deferred();let bReads=0,aReads=0
 await page.route('**/api/**',async route=>{
  const u=new URL(route.request().url()),branch=u.searchParams.get('branch_ref')
  if(!u.pathname.endsWith('/calendar'))return route.fulfill({json:{data:[]}})
  if(branch==='b2'){bReads++;ready.resolve();await release.promise;if(failure)return route.fulfill({status:503,json:{message:'Synthetic B unavailable'}})}else aReads++
  return route.fulfill({json:{data:{month:'2099-11',today:'2099-11-01',days:[{date:'2099-11-02',status:branch==='b2'?'closed':'available',reason:branch==='b2'?'Synthetic B closure':null}]}}})
 })
 try{
  await boot(page,'calendar');await page.getByRole('gridcell',{name:/available/}).waitFor();assert.equal(aReads,1,'initial month is reused')
  await page.evaluate(()=>window.qa02.setBranch('b2'));await ready.promise
  await page.evaluate(()=>window.qa02.setBranch('b1'));await page.locator('.pp-cal[aria-busy="false"]').waitFor();await page.getByRole('gridcell',{name:/available/}).waitFor()
  const response=page.waitForResponse(r=>r.url().includes('/calendar')&&new URL(r.url()).searchParams.get('branch_ref')==='b2');release.resolve();await(await response).finished();await frame(page)
  await page.getByRole('gridcell',{name:/available/}).waitFor();assert.equal(await page.getByText(/Synthetic B/).count(),0);assert.equal(await page.locator('.pp-cal').getAttribute('aria-busy'),'false');assert.equal(aReads,2);assert.equal(bReads,1)
 }finally{release.resolve()}
}

async function voidPrescription(page,failure){
 const ready=deferred(),release=deferred(),calls=[]
 const row=id=>({id,visit:'v'+id,patient:{id:'p'+id,name:'Synthetic patient '+id},branch:'Synthetic branch',dentist:'Synthetic dentist',revision:1,status:id==='A'?'Issued':'Draft',can_edit:id==='B',can_void:id==='A',lines:[{medicine:'Paracetamol',dosage:'500mg'}]})
 await page.route('**/sanctum/**',r=>r.fulfill({status:204}))
 await page.route('**/api/**',async r=>{
  const req=r.request(),p=new URL(req.url()).pathname
  if(req.method()!=='GET'){assert.equal(p,'/api/prescriptions/A/void');calls.push(p);ready.resolve();await release.promise;return r.fulfill(failure?{status:422,json:{message:'Synthetic void refused'}}:{json:{data:{...row('A'),status:'Void'}}})}
  if(p==='/api/prescriptions')return r.fulfill({json:{data:[row('A'),row('B')]}})
  if(p.endsWith('/visits'))return r.fulfill({json:{data:[],meta:{}}})
  return r.fulfill({json:{data:['/api/prescriptions/A','/api/prescriptions/B'].includes(p)?row(p.split('/').at(-1)):[]}})
 })
 try{
  await boot(page,'rx');await button(page,'Open').first().click();await button(page,'Void…').click();await page.getByRole('textbox',{name:/^Reason for voiding/}).fill('Synthetic correction');await button(page,'Void this prescription').click();await ready.promise
  await button(page,'Close').click();await button(page,'Edit draft').click();await page.getByText('Edit draft for Synthetic patient B',{exact:true}).waitFor();await page.getByRole('textbox',{name:/^Note \(optional\)/}).fill('Synthetic B after void A')
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/A/void'));release.resolve();await(await response).finished();await frame(page)
  assert.deepEqual(calls,['/api/prescriptions/A/void']);assert.deepEqual(await page.evaluate(()=>window.qa02Toasts),[]);assert.equal(await page.getByRole('textbox',{name:/^Note \(optional\)/}).inputValue(),'Synthetic B after void A');assert.equal(await page.getByRole('dialog').count(),0)
 }finally{release.resolve()}
}

try{
 for(const width of before||preCopy?[390]:[390,768,1024,1440]){
  const cases=[['save-success',p=>prescription(p,'save')],['save-failure',p=>prescription(p,'save',true)],['issue-success',p=>prescription(p,'issue')],['issue-failure',p=>prescription(p,'issue',true)],['cancel-pending-save',p=>prescription(p,'save',false,true)],['void-success',p=>voidPrescription(p,false)],['void-failure',p=>voidPrescription(p,true)],['quote-initial-failure',p=>booking(p)],['quote-ambiguous-cash',p=>booking(p,true)],['quote-ambiguous-online',p=>booking(p,true,'online')],['payment-copy',p=>booking(p,false,'cash',true)],['calendar-late-success',p=>calendar(p,false)],['calendar-late-failure',p=>calendar(p,true)]]
  for(const [name,run]of cases){
   if(preCopy&&name!=='payment-copy')continue
   if(selectedCase&&name!==selectedCase)continue
   const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];page.setDefaultTimeout(3500);page.on('pageerror',e=>errors.push(e.message))
   try{await run(page);assert.deepEqual(errors,[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));results.push({width,name,status:'pass'});console.log('PASS '+width+' '+name)}
   catch(e){results.push({width,name,status:'fail',error:e.message});console.log('FAIL '+width+' '+name+': '+e.message);if(selectedCase)console.log(await page.locator('body').innerText())}
   finally{await context.close()}
  }
 }
 await mkdir(evidence,{recursive:true});await writeFile(`${evidence}/${preCopy?'copy-before':before?'before':selectedCase?'selected-'+selectedCase:'after'}-results.json`,JSON.stringify({authenticatedAcceptance:false,synthetic:true,results},null,2))
 console.log(JSON.stringify({passed:results.filter(r=>r.status==='pass').length,failed:results.filter(r=>r.status==='fail').length}));if(results.some(r=>r.status==='fail'))process.exitCode=1
}finally{await browser.close()}

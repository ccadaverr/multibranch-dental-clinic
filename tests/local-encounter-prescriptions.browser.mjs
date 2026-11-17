// Actual loopback PostgreSQL-backed draft creation, then strictly read-only encounter review.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
const {browser,login,get,api,evidence,target}=await import('./local-visit-support.mjs')
const original=JSON.parse(readFileSync(target.runtime+'/encounter-browser-batch03/journey.json','utf8')).scheduled
const groups=[],pass=s=>{groups.push(s);console.log('PASS '+s)};let page
try {
  const d=await login('sprint02.dentist@example.test');page=d.page;page.setDefaultTimeout(45000)
  const completed=(await get(page,'/api/treatments/'+original.id)).body.data;assert.equal(completed.status,'Completed')
  const created=await page.evaluate(async visit=>{
    const client=await import('/src/api-client.js')
    return client.createPrescription({visit_id:visit,lines:[{medicine:'Synthetic encounter review only'}]},'batch08-review-draft')
  },completed.visit.id)
  assert.equal(created.ok,true);assert.equal(created.data.status,'Draft');const rx=created.data
  assert.equal(rx.patient.id,completed.patient.id);assert.equal(rx.branch_id,completed.branch.id)
  const writes=[];page.on('request',r=>{if(r.url().startsWith(api+'/api/')&&r.method()!=='GET')writes.push(r.url())})
  await page.getByRole('button',{name:'Patient Records',exact:true}).first().click()
  const select=code=>page.locator('.patient-list-scroll button').filter({hasText:code}).click()
  await select(completed.patient.code);await page.getByRole('button',{name:/^Clinical/}).click()
  await page.getByRole('button',{name:'Review encounter '+completed.clinic_date,exact:true}).click()
  const region=page.getByRole('region',{name:'Encounter prescriptions',exact:true})
  const review=region.getByRole('button',{name:'Review draft prescription',exact:true});await review.waitFor()
  await review.focus();await page.keyboard.press('Enter')
  const dialog=page.getByRole('dialog');await dialog.getByText('Synthetic encounter review only',{exact:true}).waitFor()
  assert.equal(await dialog.getByRole('button',{name:/Edit draft|Void|Issue prescription/}).count(),0)
  pass('GEN-09 one keyboard action from exact encounter prescription summary opens verified saved detail; Draft remains unissued and view-only')
  for(const width of [375,390,430,768,1024,1440]){
    await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width)
    await page.screenshot({path:evidence+'/encounter-prescription-'+width+'.png',fullPage:true})
  }
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'})
  assert.equal(await review.evaluate(b=>b===document.activeElement),true)
  pass('review dialog fits all six widths; Escape closes and returns keyboard focus to its original encounter action')
  for(const patch of [{patient:{id:'foreign',name:'Foreign private Patient'}},{visit:'foreign-visit'},{branch_id:'foreign-branch'}]){
    await page.route(api+'/api/prescriptions/'+rx.id,async route=>{
      const response=await route.fetch();const body=await response.json();await route.fulfill({response,json:{...body,data:{...body.data,...patch,note:'FOREIGN PRIVATE NOTE'}}})
    })
    await review.click();await dialog.getByText(/did not match/).waitFor();assert.equal(await dialog.getByText('FOREIGN PRIVATE NOTE',{exact:true}).count(),0)
    await page.unroute(api+'/api/prescriptions/'+rx.id)
    await dialog.getByRole('button',{name:'Reload prescription',exact:true}).click();await dialog.getByText('Synthetic encounter review only',{exact:true}).waitFor()
    await page.keyboard.press('Escape')
  }
  pass('correct prescription ID with wrong Patient, Visit or branch cannot display content; explicit reload recovers the exact saved detail')
  await page.route(api+'/api/prescriptions?*',route=>route.fulfill({status:503,json:{message:'Synthetic encounter prescription read failure'}}))
  await page.getByRole('button',{name:'Reload clinical history',exact:true}).click()
  await region.getByText('Synthetic encounter prescription read failure',{exact:false}).waitFor()
  assert.equal(await region.getByText(/No authorized prescriptions/).count(),0)
  await page.unroute(api+'/api/prescriptions?*')
  await region.getByRole('button',{name:'Retry encounter prescriptions',exact:true}).click();await review.waitFor()
  pass('failed encounter prescription list stays unavailable instead of empty; Retry restores the saved prescription')
  let release,started;const held=new Promise(r=>{started=r}),barrier=new Promise(r=>{release=r})
  await page.route(api+'/api/prescriptions/'+rx.id,async route=>{const response=await route.fetch();started();await barrier;await route.fulfill({response})})
  await review.click();await held;await page.keyboard.press('Escape');await select('PAT-0002');release()
  await page.waitForTimeout(150);assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.getByText('Synthetic encounter review only',{exact:true}).count(),0)
  assert.deepEqual((await get(page,'/api/treatments/'+original.id)).body.data,completed)
  const after=(await get(page,'/api/prescriptions/'+rx.id)).body.data;assert.equal(after.id,rx.id);assert.equal(after.revision,rx.revision);assert.equal(after.status,'Draft')
  assert.equal(writes.length,0)
  pass('late prior-Patient detail cannot reappear after close/selection; all review steps perform zero mutations and preserve completed treatment/draft revision')
  writeFileSync(evidence+'/journey.json',JSON.stringify({accepted:true,groups},null,2))
} catch(e) {
  if(page&&!page.isClosed()){writeFileSync(evidence+'/failure-text.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/failure.png',fullPage:true})}
  throw e
} finally {await browser.close()}

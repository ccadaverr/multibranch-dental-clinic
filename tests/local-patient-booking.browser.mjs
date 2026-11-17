// Actual Patient booking: existing endpoints and existing pay-at-clinic policy only; no external checkout.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
const {browser,login,get,api,evidence,target}=await import('./local-visit-support.mjs')
const f=JSON.parse(readFileSync(target.runtime+'/visit-fixture.json','utf8'))
const file=evidence+'/journey.json',state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{groups:[]}
const save=()=>writeFileSync(file,JSON.stringify(state,null,2)),pass=name=>{if(!state.groups.includes(name))state.groups.push(name);save();console.log('PASS '+name)}
state.accepted=false;save();let page
try{
 const patient=await login('sprint02.patient@example.test',390);page=patient.page;page.setDefaultTimeout(45000)
 if(!state.booked){
  const date=await page.evaluate(()=>new Date(Date.now()+8*3600e3+86400e3).toISOString().slice(0,10))
  const options=await page.evaluate(async args=>(await import('/src/api-client.js')).bookingOptions(args),{branch_ref:f.branch,service_ref:f.service,date})
  assert.equal(options.ok,true);assert.equal(options.data.pay_at_clinic_available,true,'Existing policy must authorize synthetic at-clinic booking')
  await page.getByRole('button',{name:'Book',exact:true}).click()
  await page.getByRole('searchbox',{name:'Search services',exact:true}).fill('Oral Prophylaxis')
  await page.locator('button.pp-option').filter({hasText:'Oral Prophylaxis'}).click()
  await page.locator('button.pp-branch').filter({hasText:'Synthetic Sprint 02'}).click()
  await page.locator('.pp-cal-day.is-available').first().click()
  await page.locator('button.pp-chip:not([disabled])').first().click()
  await page.getByRole('radio',{name:'Pay at the clinic',exact:true}).check()
  const posts=[];page.on('request',r=>{if(r.url()===api+'/api/appointments'&&r.method()==='POST')posts.push({body:r.postDataJSON(),key:r.headers()['idempotency-key']})})
  await page.route(api+'/api/appointments',async route=>{if(route.request().method()!=='POST')return route.continue();const r=await route.fetch();assert.equal(r.status(),201);state.booked=(await r.json()).data;save();await route.fulfill({status:500,json:{message:'Synthetic response loss after committed booking'}})},{times:1})
  const submit=page.getByRole('button',{name:'Submit booking · pay at clinic',exact:true});await submit.evaluate(b=>{b.click();b.click()})
  await page.getByText(/The last booking response could not be verified/).waitFor()
  await submit.focus();await page.keyboard.press('Enter')
  await page.getByText(state.booked.code,{exact:true}).waitFor();assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);assert.equal(state.booked.patient.id,f.patientId)
  pass('committed Patient booking with HTTP 500 response locks original intent; keyboard retry returns the same appointment/key')
  await page.getByRole('button',{name:'View my visits',exact:true}).click()
  await page.locator('#visit-'+state.booked.id+'.is-focus').waitFor();pass('booking success shows authoritative reference and opens the exact focused My visits row')
 }
 const own=await get(page,'/api/appointments/'+state.booked.id);assert.equal(own.status,200);assert.equal(own.body.data.patient.id,f.patientId);assert.equal(own.body.data.branch.id,f.branch);assert.equal(own.body.data.service.id,f.service)
 const fresh=await login('sprint02.patient@example.test',390);page=fresh.page;await patient.context.close()
 await page.getByRole('button',{name:/^(My visits|Visits)$/}).first().click();await page.locator('#visit-'+state.booked.id).waitFor()
 pass('new authenticated Patient session reads the exact persisted appointment and current status')
 const other=await login('patient@example.test',390);assert.equal((await get(other.page,'/api/appointments/'+state.booked.id)).status,403);await other.context.close();pass('other Patient denied the resulting appointment')
 for(const width of [375,390,430,768,1024,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'overflow at '+width);await page.screenshot({path:evidence+'/patient-appointment-'+width+'.png',fullPage:true})}
 pass('Patient appointment readback fits six widths');state.accepted=true;save()
}catch(e){if(page){writeFileSync(evidence+'/failure-text.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/failure.png',fullPage:true})}throw e}finally{await browser.close()}

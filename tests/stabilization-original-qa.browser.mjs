// Whole original criteria only. Real role sessions and API-backed directory; no mocked success responses.
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {browser,login,get,api,evidence} from './local-visit-support.mjs'
const passes=[],details={},widths=[375,390,430,768,1024,1440]
const pass=(id,description)=>{passes.push({id,description});writeFileSync(evidence+'/results.json',JSON.stringify({passes,details},null,2));console.log('PASS '+id+' '+description)}
let page
try {
 details.bell=[]
 for(const [email,role] of [['owner@example.test','Owner'],['sprint02.staff@example.test','Staff'],['sprint02.dentist@example.test','Dentist'],['sprint02.patient@example.test','Patient']]){
  const signed=await login(email);page=signed.page
  const bell=page.locator('.top-icon-btn[aria-label^="Notifications"],.pp-bell').first()
  const styles=()=>bell.evaluate(e=>{const s=getComputedStyle(e);return {border:s.borderTopWidth,outline:s.outlineWidth,outlineStyle:s.outlineStyle,focusVisible:e.matches(':focus-visible')}})
  for(const width of widths){
   await page.setViewportSize({width,height:1000});await page.mouse.click(width-3,850);await page.mouse.move(width-3,850)
   const normal=await styles();assert.equal(normal.border,'0px');assert.equal(normal.outlineStyle,'none')
   await bell.hover();const hover=await styles();assert.equal(hover.border,'0px');assert.equal(hover.outlineStyle,'none')
   await bell.click();const clicked=await styles();assert.equal(clicked.border,'0px');assert.equal(clicked.outlineStyle,'none')
   // Close the actual notification surface, then trigger the keyboard modality before focusing the bell.
   const close=page.getByRole('button',{name:'Close notifications',exact:true});if(await close.count())await close.click();else await page.keyboard.press('Escape')
   await page.keyboard.press('Tab');await bell.focus();const keyboard=await styles();assert(keyboard.focusVisible);assert.equal(keyboard.outline,'2px');assert.equal(keyboard.outlineStyle,'solid')
   await page.keyboard.press('Enter');assert.equal(await bell.getAttribute('aria-expanded'),'true')
   if(await close.count())await close.click();else await page.keyboard.press('Escape')
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),role+' overflow '+width)
   details.bell.push({role,width,normal,hover,clicked,keyboard})
  }
  await signed.context.close()
 }
 pass('GEN-03','All four dashboards at six widths: no bell border/outline in normal, hover or pointer-click states; 2px keyboard-only focus indicator and Enter activation')
 const staff=await login('sprint02.staff@example.test');page=staff.page
 await page.getByRole('button',{name:'Check-In',exact:true}).first().click()
 await page.getByRole('heading',{name:'Patient check-in',exact:true}).waitFor()
 for(const width of widths){
  await page.setViewportSize({width,height:1000});const refresh=page.getByRole('button',{name:'Refresh',exact:true});assert.equal(await refresh.count(),1)
  assert.equal(await refresh.locator('svg').count(),1)
  await page.waitForFunction(()=>[...document.querySelectorAll('button[aria-label="Refresh"]')].every(button=>!button.disabled))
  const response=page.waitForResponse(r=>r.url().startsWith(api)&&new URL(r.url()).pathname==='/api/queue'&&r.request().method()==='GET'&&r.status()===200)
  await refresh.focus();await page.keyboard.press('Enter');await response
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Check-In overflow '+width)
 }
 pass('STF-10','One icon Refresh on Check-In at all six widths; keyboard activation reloads the authorized queue from Laravel')
 await page.setViewportSize({width:1440,height:1000})
 const patientName='Synthetic Search Acceptance '+Date.now(),phone='+63917555'+String(Date.now()).slice(-4)
 const created=await page.evaluate(async({api,name,phone})=>{
  await fetch(api+'/sanctum/csrf-cookie',{credentials:'include'});const token=decodeURIComponent(document.cookie.split('; ').find(x=>x.startsWith('XSRF-TOKEN='))?.slice(11)||'')
  const r=await fetch(api+'/api/patients',{method:'POST',credentials:'include',headers:{Accept:'application/json','Content-Type':'application/json','X-XSRF-TOKEN':token,'Idempotency-Key':name.replaceAll(' ','-')},body:JSON.stringify({first_name:name,last_name:'Synthetic',phone})});return {status:r.status,body:await r.json()}
 },{api,name:patientName,phone});assert.equal(created.status,201,JSON.stringify(created.body));const patient=created.body.data
 details.selectedPatient={id:patient.id,code:patient.code}
 await page.getByRole('button',{name:'Walk-in admission',exact:true}).click()
 const combo=page.getByRole('combobox',{name:/^Patient/})
 assert.equal(await combo.count(),1);assert.equal(await page.locator('select').filter({has:page.locator('option[value="'+patient.id+'"]')}).count(),0)
 for(const query of [patientName,phone]){
  await combo.fill(query);const option=page.getByRole('option').filter({hasText:patient.code});await option.waitFor()
  await combo.press('ArrowDown');await combo.press('Enter')
  await page.locator('.patient-combobox-selected').filter({hasText:patient.code}).waitFor()
  assert.equal(await combo.getAttribute('aria-expanded'),'false')
  await page.getByRole('button',{name:'Clear selected patient',exact:true}).click()
 }
 for(const width of widths){await page.setViewportSize({width,height:1000});await combo.fill(patientName);await page.getByRole('option').filter({hasText:patient.code}).waitFor();await combo.press('ArrowDown');await combo.press('Enter');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:evidence+'/checkin-'+width+'.png',fullPage:true});await page.getByRole('button',{name:'Clear selected patient',exact:true}).click()}
 const record=(await get(page,'/api/patients/'+patient.id));assert.equal(record.status,200);assert.equal(record.body.data.id,patient.id)
 pass('STF-12','One searchable Patient combobox; actual name and phone endpoint results, ArrowDown/Enter selection, exact Patient identity, clear/reselect and six-width acceptance')
 await staff.context.close()
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:evidence+'/failure.png',fullPage:true});throw error}finally{await browser.close()}

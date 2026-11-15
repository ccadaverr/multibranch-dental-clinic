// Actual authenticated readback, responsive controls and PDF authorization. No mocked success responses.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
assert.ok(process.env.LOCAL_SYSTEM_EVIDENCE,'Use the private evidence directory from the actual prescription journey')
const {browser,login,get,api,evidence}=await import('./local-visit-support.mjs')
const s=JSON.parse(readFileSync(evidence+'/journey.json','utf8')),results=[]
async function pdf(page,id){
 const url=api+'/api/prescriptions/'+id+'/pdf',response=page.waitForResponse(r=>r.url()===url)
 const result=await page.evaluate(async url=>{const r=await fetch(url,{credentials:'include',headers:{Accept:'application/json'}});return {status:r.status,type:r.headers.get('Content-Type'),cache:r.headers.get('Cache-Control'),size:(await r.arrayBuffer()).byteLength}},url)
 return {...result,nosniff:(await response).headers()['x-content-type-options']}
}
async function inspect(page,name){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow');const missing=await page.locator('main input:not([type=hidden]),main select,main textarea').evaluateAll(cs=>cs.filter(c=>!c.getAttribute('aria-label')&&!c.getAttribute('aria-labelledby')&&!c.labels?.length).map(c=>c.tagName));assert.deepEqual(missing,[]);await page.screenshot({path:evidence+'/'+name+'.png',fullPage:true});results.push(name)}
try{
 const d=await login('sprint02.dentist@example.test');let page=d.page;await page.getByRole('button',{name:'Prescriptions',exact:true}).first().click()
 const row=page.locator('ul.fd-list > li').filter({hasText:s.corrected.number});await row.getByRole('button',{name:'Open',exact:true}).click();await page.getByRole('dialog').getByText('Synthetic corrected medicine',{exact:true}).waitFor()
 for(const width of [375,430,768,1024,1440]){await page.setViewportSize({width,height:1000});await inspect(page,'dentist-prescription-'+width)}
 await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click()
 await page.getByRole('combobox',{name:/^Visit/}).selectOption(s.visit);await page.getByRole('combobox',{name:'Select medicine 1',exact:true}).selectOption('__other__');await page.getByRole('textbox',{name:'Specify medicine name',exact:true}).fill('Synthetic unsaved accessibility check')
 await page.getByRole('button',{name:'Add another medicine',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Remove medicine 2',exact:true}).click()
 for(const width of [375,430,768,1024,1440]){await page.setViewportSize({width,height:1000});await inspect(page,'dentist-prescription-form-'+width)}
 await page.getByRole('button',{name:'Issue prescription',exact:true}).click();const confirm=page.getByRole('dialog',{name:'Issue and lock prescription?',exact:true});await confirm.waitFor();await page.keyboard.press('Escape');await confirm.waitFor({state:'hidden'});assert.equal(await page.getByRole('textbox',{name:'Specify medicine name',exact:true}).inputValue(),'Synthetic unsaved accessibility check');results.push('keyboard Escape cancels Issue without losing draft');await d.context.close()
 const patient=await login('sprint02.patient@example.test',1440);page=patient.page;await page.getByRole('button',{name:'Prescriptions',exact:true}).first().click();await page.locator('ul.pp-rx-list > li').filter({hasText:s.corrected.number}).getByText('Synthetic corrected medicine',{exact:true}).waitFor()
 for(const width of [375,430,768,1024,1440]){await page.setViewportSize({width,height:1000});await inspect(page,'patient-prescriptions-'+width)}
 const ownPdf=await pdf(page,s.corrected.id);assert.equal(ownPdf.status,200);assert.match(ownPdf.cache,/private/);assert.match(ownPdf.cache,/no-store/);assert.equal(ownPdf.nosniff,'nosniff');assert.ok(ownPdf.size>1000);results.push('own Patient PDF response privacy and actual document bytes')
 await page.reload();await page.locator('ul.pp-rx-list > li').filter({hasText:s.corrected.number}).getByText('Synthetic corrected medicine',{exact:true}).waitFor();await patient.context.close()
 for(const [email,status] of [['patient@example.test',404],['dentist@example.test',404],['staff.reception@example.test',404],['owner@example.test',403],['sprint02.staff@example.test',200]]){
  const w=await login(email);const check=await pdf(w.page,s.corrected.id);assert.equal(check.status,status,email);if(status!==200)assert.ok(check.size<1000);if(email==='owner@example.test'){const meta=await get(w.page,'/api/prescriptions/'+s.corrected.id);assert.equal(meta.status,200);assert.ok(!meta.body.data.lines&&!meta.body.data.patient&&!meta.body.data.note)}results.push(email.split('@')[0]+' PDF authorization '+status);await w.context.close()
 }
 const anon=await browser.newContext(),a=await anon.newPage();await a.goto('http://127.0.0.1:5195');assert.equal((await pdf(a,s.corrected.id)).status,401);await anon.close();results.push('unauthenticated PDF refused')
 const renewed=await login('sprint02.patient@example.test',390);page=renewed.page;await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'More',exact:true}).getByRole('button',{name:'Prescriptions',exact:true}).click();await page.locator('ul.pp-rx-list > li').filter({hasText:s.corrected.number}).getByText('Synthetic corrected medicine',{exact:true}).waitFor();assert.equal((await pdf(page,'00000000000000000000000000')).status,404);results.push('new Patient session and invalid identifier refusal')
 // A real network refusal must not masquerade as an empty list; Retry restores actual records.
 await page.route(api+'/api/me/prescriptions',r=>r.abort('failed'));await page.reload();await page.getByRole('alert').filter({hasText:'Could not reach'}).waitFor();assert.equal(await page.getByText('No prescriptions yet',{exact:true}).count(),0);await page.unroute(api+'/api/me/prescriptions');await page.getByRole('button',{name:'Try again',exact:true}).click();await page.locator('ul.pp-rx-list > li').filter({hasText:s.corrected.number}).getByText('Synthetic corrected medicine',{exact:true}).waitFor();results.push('truthful Patient network failure and actual Retry readback')
 writeFileSync(evidence+'/visibility-results.json',JSON.stringify({results},null,2));console.log('PASS '+results.length+' prescription viewport, keyboard/labels, PDF authorization and recovery groups')
}finally{await browser.close()}

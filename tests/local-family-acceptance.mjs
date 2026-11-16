import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {browser,login,get,api,evidence} from './local-visit-support.mjs'

const results=[]
const ok=name=>{results.push(name);console.log('PASS',name)}
try{
 const {page}=await login('sprint02.patient@example.test')
 const own=await get(page,'/api/me/dependents');assert.equal(own.status,200)
 const guardian=own.body.meta.me.id,before=own.body.data.length
 await page.route('**/api/me/dependents',async route=>{
  if(route.request().method()==='GET')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic read interruption'})})
  return route.continue()
 })
 await page.goto('http://127.0.0.1:5195/?acceptance='+Date.now()+'#p/family')
 await page.getByText('Synthetic read interruption',{exact:true}).waitFor()
 await page.unroute('**/api/me/dependents')
 await page.getByRole('button',{name:/try again/i}).click()
 await page.getByRole('button',{name:'Add a child or dependent',exact:true}).waitFor()
 ok('Family read failure is visible and retry restores the authorized list')
 await page.getByRole('button',{name:'Add a child or dependent',exact:true}).click()
 const form=page.locator('form.pp-form')
 const inputs=form.locator('input:not([type=checkbox])')
 const unique='Synthetic'+Date.now()
 await inputs.nth(0).fill(unique);await inputs.nth(1).fill('Recovery')
 await form.locator('input[type=date]').fill('2016-02-02')
 await form.locator('select').selectOption('Other')
 const specify=form.getByPlaceholder('e.g., Niece, Nephew, Cousin')
 await specify.fill('   ');await form.locator('input[type=checkbox]').check()
 assert.equal(await form.getByRole('button',{name:'Add to my family',exact:true}).isDisabled(),true)
 await specify.fill('Niece');await form.locator('select').selectOption('Child');await form.locator('select').selectOption('Other');assert.equal(await specify.inputValue(),'')
 await specify.fill('Niece')
 let captured,committed,dispatches=0
 const lost=async route=>{
  if(route.request().method()!=='POST')return route.continue()
  dispatches++;captured={key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()}
  const response=await route.fetch();assert.equal(response.status(),201);committed=await response.json();await route.abort('failed')
 }
 await page.route('**/api/me/dependents',lost)
 await form.getByRole('button',{name:'Add to my family',exact:true}).evaluate(button=>{button.click();button.click()})
 await page.getByRole('button',{name:'Recover dependent creation',exact:true}).waitFor()
 assert.equal(dispatches,1);assert.equal(await inputs.nth(0).isDisabled(),true)
 assert.equal(committed.meta.dependent_receipt.guardian_id,guardian)
 const markers=await page.evaluate(()=>Object.entries(sessionStorage).filter(([key])=>key.startsWith('dentalops-v4-dependent-create:')))
 assert.equal(markers.length,1);assert.equal(markers[0][1],captured.key);assert.ok(!JSON.stringify(markers).includes(unique))
 ok('Other specification, duplicate dispatch, frozen intent and opaque recovery marker')
 await page.unroute('**/api/me/dependents',lost)
 await page.reload();await page.getByRole('button',{name:'Recover dependent creation',exact:true}).click()
 await page.getByText('Dependent '+committed.data.code+' creation verified. Reloading your current Family records.',{exact:true}).waitFor()
 assert.equal((await get(page,'/api/me/dependents')).body.data.length,before+1)
 const exact=await page.evaluate(async({api,key})=>{const r=await fetch(api+'/api/me/dependents/creation-receipt',{credentials:'include',headers:{Accept:'application/json','Idempotency-Key':key}});return {status:r.status,body:await r.json()}},{api,key:captured.key})
 assert.equal(exact.status,200);assert.deepEqual(exact.body,committed)
 ok('Committed response loss recovers the exact Patient after reload without another creation')
 const {page:second}=await login('sprint02.patient@example.test')
 const readKey=async p=>p.evaluate(async({api,key})=>{const r=await fetch(api+'/api/me/dependents/creation-receipt',{credentials:'include',headers:{Accept:'application/json','Idempotency-Key':key}});return {status:r.status,body:await r.json()}},{api,key:captured.key})
 assert.deepEqual((await readKey(second)).body,committed)
 const {page:foreign}=await login('patient@example.test');assert.equal((await readKey(foreign)).status,404)
 ok('New authenticated session recovers the receipt; foreign Patient is denied')
 for(const width of [375,390,430,768,1024,1440]){
  await page.setViewportSize({width,height:1000})
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Family overflow at '+width)
  const button=page.getByRole('button',{name:'Add a child or dependent',exact:true});await button.focus();assert.equal(await button.evaluate(el=>el===document.activeElement),true)
  const box=await button.boundingBox();assert.ok(box.height>=40)
  await page.screenshot({path:evidence+'/family-'+width+'.png',fullPage:true})
 }
 ok('Family keyboard focus and six responsive widths')
 writeFileSync(evidence+'/family-results.json',JSON.stringify({results,guardian,dependent:committed.data.id,code:committed.data.code},null,2),{mode:0o600})
}finally{await browser.close()}

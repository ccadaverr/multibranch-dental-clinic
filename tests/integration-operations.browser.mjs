// Real integrated component/API/database acceptance; synthetic prerequisites and no mocked success responses.
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {browser,login,get,api,evidence} from './local-visit-support.mjs'
const passes=[],key='integration-'+Date.now();let page
const pass=s=>{passes.push(s);console.log('PASS '+s);writeFileSync(evidence+'/results.json',JSON.stringify({passes},null,2))}
async function change(page,path,body,method='POST',id=key){return page.evaluate(async({api,path,body,method,id})=>{await fetch(api+'/sanctum/csrf-cookie',{credentials:'include'});const token=decodeURIComponent(document.cookie.split('; ').find(x=>x.startsWith('XSRF-TOKEN='))?.slice(11)||'');const r=await fetch(api+path,{method,credentials:'include',headers:{Accept:'application/json','Content-Type':'application/json','X-XSRF-TOKEN':token,'Idempotency-Key':id},body:JSON.stringify(body)});return {status:r.status,body:await r.json()}},{api,path,body,method,id})}
try{
 const owner=await login('owner@example.test');page=owner.page
 await page.getByRole('button',{name:'Branches',exact:true}).first().click()
 await page.locator('.branch-overview-card').filter({hasText:'Synthetic Sprint 02'}).getByRole('button',{name:/Configure/}).click()
 const code=page.getByRole('combobox',{name:'Branch code',exact:true});await code.waitFor()
 const options=await code.locator('option').evaluateAll(xs=>xs.map(x=>({value:x.value,disabled:x.disabled})))
 const current=await code.inputValue(),next=options.find(x=>x.value&&x.value!==current&&!x.disabled);assert(next)
 await code.selectOption(next.value)
 const saved=page.waitForResponse(r=>r.url()===api+'/api/branches/sprint02'&&r.request().method()==='PATCH')
 await page.getByRole('button',{name:'Publish Branch Changes',exact:true}).click();assert.equal((await saved).status(),200)
 const branches=(await get(page,'/api/branches')).body.data;assert.equal(branches.find(b=>b.id==='sprint02').branch_code,next.value)
 const other=branches.find(b=>b.id!=='sprint02');const refused=await change(page,'/api/branches/sprint02',{branch_code:other.branch_code},'PATCH');assert.equal(refused.status,422)
 await page.reload();await page.getByRole('button',{name:'Branches',exact:true}).first().click();await page.locator('.branch-overview-card').filter({hasText:'Synthetic Sprint 02'}).getByRole('button',{name:/Configure/}).click();assert.equal(await page.getByLabel('Branch code',{exact:true}).inputValue(),next.value)
 pass('OWN-02 actual Owner dropdown, allowed code persistence/reload and duplicate refusal')
 let reason='Synthetic integrated closure '+key
 const date=new Date(Date.now()+40*86400000).toISOString().slice(0,10)
 const existing=(await get(page,'/api/branch-closures')).body.data.find(c=>c.branch?.id==='sprint02'&&c.date===date&&c.reason?.startsWith('Synthetic integrated closure '));
 if(existing)reason=existing.reason;else{const closure=await change(page,'/api/branch-closures',{branch_ref:'sprint02',date,reason});assert.equal(closure.status,201)}
 const staff=await login('sprint02.staff@example.test');page=staff.page
 await page.getByRole('button',{name:'Closed Dates',exact:true}).first().click()
 const search=page.getByPlaceholder(/Filter closures by date or reason/)
 for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await search.fill(reason);await page.locator('.cd-row').filter({hasText:reason}).waitFor();assert.equal(await page.locator('.filter-bar').count(),1);const clear=page.getByRole('button',{name:'Clear filters',exact:true});await clear.focus();await page.keyboard.press('Enter');assert.equal(await search.inputValue(),'');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:evidence+'/closures-'+width+'.png',fullPage:true})}
 pass('STF-09 actual persisted closure search/shared filter styling/keyboard X reset at390 and1440')
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Social Inquiries',exact:true}).first().click()
 assert.equal(await page.getByRole('combobox',{name:/branch/i}).count(),0)
 const name='Synthetic integration contact '+key
 await page.getByRole('textbox',{name:'Contact name',exact:true}).fill(name);await page.getByRole('textbox',{name:'What they asked',exact:true}).fill('Synthetic integration workflow verification only')
 const records=[];page.on('request',r=>{if(r.url()===api+'/api/inquiries'&&r.method()==='POST')records.push(r.postDataJSON())})
 const created=page.waitForResponse(r=>r.url()===api+'/api/inquiries'&&r.request().method()==='POST')
 await page.getByRole('button',{name:'Record inquiry',exact:true}).evaluate(b=>{b.click();b.click()});const result=await created;assert.equal(result.status(),201);const inquiry=(await result.json()).data
 assert.equal(inquiry.branch.id,'sprint02');assert.equal(records.length,1);assert.equal(records[0].branch_ref,'sprint02')
 await page.reload();await page.getByRole('button',{name:'Social Inquiries',exact:true}).first().click();await page.getByText(name,{exact:true}).waitFor();assert((await get(page,'/api/inquiries')).body.data.some(i=>i.id===inquiry.id&&i.branch.id==='sprint02'))
 pass('STF-20 actual Staff session scope, no branch selector, double-click one write and persisted reload')
 for(const [email,role]of [['owner@example.test','owner'],['sprint02.staff@example.test','staff'],['sprint02.dentist@example.test','dentist'],['sprint02.patient@example.test','patient']]){
  const signed=await login(email);page=signed.page;assert.equal((await get(page,'/api/me')).status,200)
  for(const width of [375,390,430,768,1024,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),role+' overflow at'+width);await page.screenshot({path:evidence+'/'+role+'-'+width+'.png',fullPage:true})}
  await page.reload();assert.equal((await get(page,'/api/me')).status,200)
  if(role!=='patient'){await page.getByRole('button',{name:'Sign out',exact:true}).first().click();const closed=page.waitForResponse(r=>r.url()===api+'/api/logout'&&r.request().method()==='POST');await page.getByRole('dialog',{name:'Sign out?',exact:true}).getByRole('button',{name:'Sign out',exact:true}).click();assert.equal((await closed).status(),204);await page.getByRole('textbox',{name:/email/i}).waitFor();assert.equal((await get(page,'/api/me')).status,401)}
  await signed.context.close()
 }
 pass('Four actual Sanctum logins/reload, internal-role logout invalidation and six-width dashboard review')
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:evidence+'/failure.png',fullPage:true});throw error}finally{await browser.close()}

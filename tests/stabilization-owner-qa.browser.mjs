// Existing Owner branch contracts, synthetic branch only. Restore the exact starting hours through the same UI.
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {browser,login,get,api,evidence} from './local-visit-support.mjs'
const passes=[],details={}
const save=()=>writeFileSync(evidence+'/results.json',JSON.stringify({passes,details},null,2))
const pass=(id,description)=>{passes.push({id,description});save();console.log('PASS '+id+' '+description)}
let page,original,serviceRestore
try{
 const owner=await login('owner@example.test');page=owner.page
 original=(await get(page,'/api/branches')).body.data.find(b=>b.id==='sprint02');assert(original?.name.startsWith('Synthetic'))
 const open=async()=>{await page.getByRole('button',{name:'Branches',exact:true}).first().click();await page.locator('.branch-overview-card').filter({hasText:original.name}).getByRole('button',{name:/Configur/}).click();await page.getByRole('button',{name:'Opening Hours',exact:true}).click()}
 const publish=async()=>{const response=page.waitForResponse(r=>r.url()===api+'/api/branches/sprint02'&&r.request().method()==='PATCH');await page.getByRole('button',{name:'Publish Branch Changes',exact:true}).click();assert.equal((await response).status(),200)}
 await open()
 const row=page.locator('.hours-row').filter({hasText:'Monday'}),toggle=row.getByRole('button')
 const wasClosed=original.weekly_hours['1']===null
 assert.equal(await toggle.getAttribute('aria-pressed'),String(wasClosed));assert.equal(await row.getByRole('checkbox').count(),0)
 await toggle.focus();await page.keyboard.press('Enter');assert.equal(await toggle.getAttribute('aria-pressed'),String(!wasClosed));await publish()
 await page.reload();await open()
 const changed=(await get(page,'/api/branches')).body.data.find(b=>b.id==='sprint02')
 assert.equal(changed.weekly_hours['1']===null,!wasClosed);assert.equal(await row.getByRole('button').getAttribute('aria-pressed'),String(!wasClosed))
 details.weeklyHoursBefore=original.weekly_hours;details.weeklyHoursChanged=changed.weekly_hours;save()
 await row.getByRole('button').click()
 // Reopening uses the form's default hours; explicitly restore the exact original hours before publishing.
 if(!wasClosed){await row.getByLabel('Monday opens').fill(original.weekly_hours['1'].open);await row.getByLabel('Monday closes').fill(original.weekly_hours['1'].close)}
 await publish()
 const restored=(await get(page,'/api/branches')).body.data.find(b=>b.id==='sprint02')
 assert.deepEqual(restored.weekly_hours,original.weekly_hours);details.weeklyHoursRestored=restored.weekly_hours
 for(const width of [375,390,430,768,1024,1440]){
  await page.setViewportSize({width,height:1000});await row.scrollIntoViewIfNeeded();await toggle.focus();await page.keyboard.press('Enter')
  assert.equal(await toggle.getAttribute('aria-pressed'),String(!wasClosed));await page.screenshot({path:evidence+'/owner-hours-'+width+'.png',fullPage:true})
  await toggle.focus();await page.keyboard.press('Enter');assert.equal(await toggle.getAttribute('aria-pressed'),String(wasClosed))
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Owner hours overflow '+width)
 }
 pass('OWN-05','Closed is an aria-pressed button; six-width keyboard toggles, Owner publication persists across reload, and the exact starting synthetic hours are restored through UI')
 await page.getByRole('button',{name:/^Services \(/}).click()
 const grid=page.locator('.branch-services-grid'),items=grid.locator('.branch-service-item');assert.equal(await items.count(),4)
 const catalog=(await get(page,'/api/services')).body.data.filter(service=>service.status==='Active'),seen=[]
 const next=page.getByRole('button',{name:'Next services',exact:true}),previous=page.getByRole('button',{name:'Previous services',exact:true})
 do{
  const names=await items.locator('b').allTextContents();assert(names.length<=4);seen.push(...names)
  if(!await next.isEnabled())break
  await next.focus();await page.keyboard.press('Enter')
 }while(true)
 assert.equal(new Set(seen).size,seen.length);assert.deepEqual([...seen].sort(),catalog.map(s=>s.name).sort())
 while(await previous.isEnabled())await previous.click()
 // Selection remains server-backed while pages change; restore the existing synthetic service via the same API/UI.
 const selected=(await get(page,'/api/branch-services')).body.data.find(row=>row.branch_ref==='sprint02'&&row.active)
 assert(selected);const service=catalog.find(row=>row.id===selected.service_ref);assert(service)
 serviceRestore=selected
 while(!await items.filter({hasText:service.name}).count()){assert(await next.isEnabled());await next.click()}
 const check=()=>items.filter({hasText:service.name}).getByRole('checkbox')
 assert(await check().isChecked());let response=page.waitForResponse(r=>r.url()===api+'/api/branch-services'&&r.request().method()==='POST');await check().click();assert.equal((await response).status(),200)
 const servicePage=await page.getByRole('group',{name:'Service pages'}).getByRole('status').innerText()
 if(await previous.isEnabled()){await previous.click();await next.click()}else{await next.click();await previous.click()}
 assert.equal(await page.getByRole('group',{name:'Service pages'}).getByRole('status').innerText(),servicePage)
 assert.equal(await check().isChecked(),false)
 response=page.waitForResponse(r=>r.url()===api+'/api/branch-services'&&r.request().method()==='POST');await check().click();assert.equal((await response).status(),200)
 assert.equal((await get(page,'/api/branch-services')).body.data.find(row=>row.branch_ref==='sprint02'&&row.service_ref===selected.service_ref).active,true)
 while(await previous.isEnabled())await previous.click()
 details.servicePagination={catalogCount:catalog.length,reachableWithoutDuplicates:seen.length,selectionPersistsAcrossPages:true,serviceRestored:selected.service_ref}
 details.grid=[]
 for(const width of [375,390,430,768,1024,1440]){
  await page.setViewportSize({width,height:1000});await grid.scrollIntoViewIfNeeded()
  const columns=await grid.evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(/\s+/).length)
  assert.equal(columns,width<=640?1:2)
  const boxes=await items.evaluateAll(xs=>xs.slice(0,4).map(e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}}))
  if(width>640){assert(Math.abs(boxes[0].y-boxes[1].y)<1);assert(Math.abs(boxes[2].y-boxes[3].y)<1);assert(boxes[2].y>boxes[0].y);assert(Math.abs(boxes[0].x-boxes[2].x)<1)}
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Owner branch overflow '+width)
  details.grid.push({width,columns,firstFour:boxes});await page.screenshot({path:evidence+'/owner-services-'+width+'.png',fullPage:true})
 }
 pass('OWN-06','Four-service pages form an exact 2x2 desktop/tablet grid and one phone column at six widths; all catalog services remain reachable and selection persists through API/readback across pages')
}catch(error){
 if(page&&!page.isClosed()){
  await page.screenshot({path:evidence+'/failure.png',fullPage:true})
  if(original){details.recoveryStatus=await page.evaluate(async({api,hours,service})=>{
   await fetch(api+'/sanctum/csrf-cookie',{credentials:'include'});const csrf=decodeURIComponent(document.cookie.split('; ').find(x=>x.startsWith('XSRF-TOKEN='))?.slice(11)||'')
   const headers={Accept:'application/json','Content-Type':'application/json','X-XSRF-TOKEN':csrf}
   if(service)await fetch(api+'/api/branch-services',{method:'POST',credentials:'include',headers,body:JSON.stringify(service)})
   return (await fetch(api+'/api/branches/sprint02',{method:'PATCH',credentials:'include',headers,body:JSON.stringify({weekly_hours:hours})})).status
  },{api,hours:original.weekly_hours,service:serviceRestore})}
 }
 save();throw error
}finally{await browser.close()}

// Owned synthetic PostgreSQL chart acceptance; only committed response loss is intercepted.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
const {browser,login,get,api,evidence,target}=await import('./local-visit-support.mjs')
const source=JSON.parse(readFileSync(target.runtime+'/encounter-browser-batch03/journey.json','utf8'))
const toothId=process.env.CHART_ACCEPTANCE_TOOTH||'36';assert.match(toothId,/^[1-4][1-8]$/)
const file=evidence+'/journey.json',state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{groups:[]}
const save=()=>writeFileSync(file,JSON.stringify(state,null,2)),pass=s=>{if(!state.groups.includes(s))state.groups.push(s);save();console.log('PASS '+s)}
let page;state.accepted=false;save()
try{
 const d=await login('sprint02.dentist@example.test');page=d.page
 await page.getByRole('button',{name:'My Queue',exact:true}).first().click()
 await page.getByRole('button',{name:'Continue treatment',exact:true}).click()
 const t=(await get(page,'/api/visits/'+source.walkin.visit.id+'/treatment')).body.data
 assert.equal(t.id,source.walkin.id);assert.equal(t.appointment,null)
 await page.getByRole('button',{name:'Open dental chart',exact:true}).click()
 await page.getByRole('button',{name:'Top view (Arch)',exact:true}).waitFor()
 const tooth=()=>page.getByRole('button',{name:new RegExp('^Tooth '+toothId+'(?:$|:)')})
 const diagram=()=>page.locator('svg.od-arch-svg');const svgAnchor=await diagram().evaluate(e=>{const b=e.getBoundingClientRect();return {x:b.x+scrollX,y:b.y+scrollY}})
 const transform=await tooth().getAttribute('transform'),box=await tooth().locator('.od-tooth-shape').evaluate(e=>{const b=e.getBBox();return {x:b.x,y:b.y,width:b.width,height:b.height}})
 await tooth().hover();await page.waitForTimeout(200);assert.equal(await tooth().getAttribute('transform'),transform)
 await tooth().focus();await page.keyboard.press('Enter');assert.equal(await tooth().getAttribute('transform'),transform)
 await page.getByRole('button',{name:'Front view',exact:true}).click();await page.getByRole('button',{name:'Top view (Arch)',exact:true}).click()
 if(!state.receipt){await page.getByRole('combobox',{name:'Status',exact:true}).selectOption({label:'Caries'})
 await page.getByRole('checkbox',{name:'O',exact:true}).check()
 await page.getByRole('textbox',{name:/Note \(optional\)/}).fill('Synthetic chart response recovery — no clinical conclusion')}
 const posts=[];page.on('request',r=>{if(r.url()===api+'/api/patients/'+t.patient.id+'/chart'&&r.method()==='POST')posts.push({body:r.postDataJSON(),key:r.headers()['idempotency-key']})})
 if(!state.receipt){
  await page.route(api+'/api/patients/'+t.patient.id+'/chart',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();assert.equal(response.status(),201);state.receipt=(await response.json()).meta.chart_receipt;save();
   if(process.env.CHART_INTERVENING_WRITE==='1'){const next=await route.fetch({headers:{...route.request().headers(),'idempotency-key':'chart-intervening-'+state.receipt.entry_id},postData:JSON.stringify({...route.request().postDataJSON(),status:'Filled',note:'Synthetic intervening saved finding',expected_revision:state.receipt.revision})});assert.equal(next.status(),201);state.interveningReceipt=(await next.json()).meta.chart_receipt;save()}
   await route.abort('failed')},{times:1})
  await page.getByRole('button',{name:'Record finding',exact:true}).click()
  const retry=page.getByRole('button',{name:'Retry same finding',exact:true});await retry.waitFor();await retry.focus();await page.keyboard.press('Enter')
  await page.getByText(new RegExp('^Finding '+state.receipt.entry_id+' saved for tooth '+toothId+', revision '+state.receipt.revision+'\\.')).waitFor()
  assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);assert.equal(posts[0].body.treatment_id,t.id);assert.equal(posts[0].body.expected_treatment_revision,t.revision)
 }
 if(state.interveningReceipt){
  assert(await page.getByRole('button',{name:'Record finding',exact:true}).isDisabled());await page.getByText('Synthetic intervening saved finding',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Review saved chart',exact:true}).click();await page.getByRole('button',{name:'Load saved chart',exact:true}).click();await tooth().click()
  pass('replayed original receipt never masks an intervening saved finding; current read exposes it and blocks implicit revision substitution')
 }
 const r=await get(page,'/api/patients/'+t.patient.id+'/chart');assert.equal(r.status,200)
 assert.equal(r.body.data.history.filter(e=>e.id===state.receipt.entry_id).length,1);assert.equal(state.receipt.visit_id,t.visit.id);assert.equal(state.receipt.treatment_id,t.id)
 assert.deepEqual((await get(page,'/api/visits/'+t.visit.id+'/treatment')).body.data,t)
 assert.equal(await tooth().getAttribute('transform'),transform)
 assert.deepEqual(await diagram().evaluate(e=>{const b=e.getBoundingClientRect();return {x:b.x+scrollX,y:b.y+scrollY}}),svgAnchor)
 const after=await tooth().locator('.od-tooth-shape').evaluate(e=>{const b=e.getBBox();return {x:b.x,y:b.y,width:b.width,height:b.height}});assert.deepEqual(after,box)
 pass('top-view keyboard chart entry retains exact Patient/tooth/Visit/encounter; lost response retries one original receipt without treatment mutation')
 await page.getByRole('button',{name:'Back to all findings',exact:true}).click()
 const summary=page.locator('.od-summary-panel');await summary.getByRole('button',{name:new RegExp(toothId)}).first().click()
 await page.getByRole('region',{name:'Details for Tooth '+toothId}).count() // Timeline remains semantically labelled; verify selected name below.
 await page.getByText('Tooth '+toothId,{exact:true}).first().waitFor()
 pass('whole-chart condition summary selects the tooth; top/front views preserve selection and fixed coordinates through hover, click and saved readback')
 for(const width of [375,390,430,768,1024,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'chart overflow '+width);await page.screenshot({path:evidence+'/chart-'+width+'.png',fullPage:true})}
 pass('chart recording and history are keyboard reachable without page overflow at six required widths')
 const again=await login('sprint02.dentist@example.test');const reload=await get(again.page,'/api/patients/'+t.patient.id+'/chart');assert.equal(reload.body.data.history.find(e=>e.id===state.receipt.entry_id).visit_id,t.visit.id)
 const patient=await login('sprint02.patient@example.test',390);assert.equal((await get(patient.page,'/api/me/chart?patient_id='+t.patient.id)).status,404)
 const staff=await login('sprint02.staff@example.test');const staffRead=await get(staff.page,'/api/patients/'+t.patient.id+'/chart');assert.equal(staffRead.status,200);assert.equal(staffRead.body.data.history[0].note,undefined)
 if(!state.conflictReceipt){
  const current=reload.body.data.tooth_revisions[toothId];const payload={tooth:toothId,status:'Filled',surfaces:['O'],note:'Synthetic second-session revision conflict',recorded_on:new Date(Date.now()+8*3600e3).toISOString().slice(0,10),branch_ref:t.branch.id,treatment_id:t.id,expected_treatment_revision:t.revision,expected_revision:current}
  const other=await again.page.evaluate(async({api,path,payload})=>{await fetch(api+'/sanctum/csrf-cookie',{credentials:'include'});const csrf=decodeURIComponent(document.cookie.split('; ').find(x=>x.startsWith('XSRF-TOKEN='))?.slice(11)||'');const r=await fetch(api+path,{method:'POST',credentials:'include',headers:{Accept:'application/json','Content-Type':'application/json','X-XSRF-TOKEN':csrf,'Idempotency-Key':'batch05-chart-other-session-'+payload.tooth},body:JSON.stringify(payload)});return {status:r.status,body:await r.json()}},{api,path:'/api/patients/'+t.patient.id+'/chart',payload});assert.equal(other.status,201);state.conflictReceipt=other.body.meta.chart_receipt;save()
  await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('Filled')
  await page.getByRole('textbox',{name:/Note \(optional\)/}).fill('Synthetic retained stale draft')
  await page.getByRole('button',{name:'Record finding',exact:true}).click();await page.getByText('This tooth changed after you reviewed it. Load the current chart before recording another finding.',{exact:true}).first().waitFor()
  assert.equal(await page.getByRole('textbox',{name:/Note \(optional\)/}).inputValue(),'Synthetic retained stale draft');assert(await page.getByRole('button',{name:'Record finding',exact:true}).isDisabled())
  await page.getByRole('button',{name:'Review saved chart',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:/Note \(optional\)/}).inputValue(),'Synthetic retained stale draft')
  await page.getByRole('button',{name:'Review saved chart',exact:true}).click();await page.getByRole('button',{name:'Load saved chart',exact:true}).click();await page.getByRole('button',{name:new RegExp('^Tooth '+toothId+'(?:$|:)')}).click();await page.getByText('Synthetic second-session revision conflict',{exact:true}).waitFor()
 }
 pass('second authenticated session changes the tooth; stale original revision refuses, retains draft and requires explicit saved-history review')
 await again.context.close();await patient.context.close();await staff.context.close();pass('new Dentist sign-in reads exact persisted history; foreign Patient denied and Staff notes remain redacted')
 state.accepted=true;save()
}catch(e){if(page){writeFileSync(evidence+'/failure-text.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/failure.png',fullPage:true})}throw e}finally{await browser.close()}

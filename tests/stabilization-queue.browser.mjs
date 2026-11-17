// Real React/API/PostgreSQL queue acceptance. Only synthetic Patients on the verified integration target.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {browser,login,get,api,evidence,target} from './local-visit-support.mjs'
const fixture=JSON.parse(readFileSync(target.runtime+'/visit-fixture.json','utf8'))
let state
try {state=JSON.parse(readFileSync(evidence+'/journey.json','utf8'))} catch {state={key:'s01-fifo-'+Date.now(),patients:[],visits:[]}}
const key=state.key, passes=[]
const save=()=>writeFileSync(evidence+'/journey.json',JSON.stringify({...state,passes},null,2))
const pass=s=>{passes.push(s);save();console.log('PASS '+s)}
async function change(page,path,body,id){return page.evaluate(async({api,path,body,id})=>{
 await fetch(api+'/sanctum/csrf-cookie',{credentials:'include'});
 const token=decodeURIComponent(document.cookie.split('; ').find(x=>x.startsWith('XSRF-TOKEN='))?.slice(11)||'');
 const r=await fetch(api+path,{method:'POST',credentials:'include',headers:{Accept:'application/json','Content-Type':'application/json','X-XSRF-TOKEN':token,'Idempotency-Key':id},body:JSON.stringify(body)});
 return {status:r.status,body:await r.json()};
},{api,path,body,id})}
let page
try {
 const staff=await login('sprint02.staff@example.test');page=staff.page
 for(let i=0;i<3;i++){
  if(state.visits[i])continue
  const patient=await change(page,'/api/patients',{first_name:'Synthetic FIFO '+key,last_name:'Patient '+(i+1)},key+'-patient-'+i)
  assert.equal(patient.status,201);state.patients.push(patient.body.data);save()
  const visit=await change(page,'/api/visits/walk-in',{patient_id:patient.body.data.id,branch_ref:fixture.branch,service_ref:fixture.service,dentist_ref:fixture.dentist},key+'-arrival-'+i)
  assert.equal(visit.status,201);state.visits.push(visit.body.data);save()
 }
 await page.reload();await page.getByRole('button',{name:'Live Queue',exact:true}).first().click()
 const ids=state.visits.map(v=>v.queue.id), names=state.patients.map(p=>p.name)
 let rows=(await get(page,'/api/queue')).body.data.filter(r=>ids.includes(r.id)).sort((a,b)=>a.branch_position-b.branch_position)
 assert.deepEqual(rows.map(r=>r.id),ids)
 const arrivalFacts=Object.fromEntries(rows.map(r=>[r.id,r.visit.arrived_at]))
 let selected=page.locator('.queue-open-row').filter({hasText:names[2]})
 await selected.getByRole('button',{name:'Move',exact:true}).click()
 let dialog=page.getByRole('dialog',{name:'Move waiting Patient',exact:true})
 await dialog.getByRole('combobox',{name:'Move before',exact:true}).selectOption(ids[0])
 await dialog.getByRole('textbox',{name:'Reason for move',exact:true}).fill('Synthetic FIFO browser audit and lost-response test')
 let dropped=false;const requests=[]
 const reorderUrl=api+'/api/queue/'+ids[2]+'/reorder'
 await page.route(reorderUrl,async route=>{
  requests.push({payload:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']})
  if(!dropped){const response=await route.fetch();assert.equal(response.status(),200);dropped=true;await route.abort('failed')}
  else await route.continue()
 })
 await dialog.getByRole('button',{name:'Record move',exact:true}).click()
 await dialog.getByRole('button',{name:'Retry same move',exact:true}).click()
 await dialog.getByText(/Move recorded: branch position/).waitFor()
 assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1])
 await dialog.getByRole('button',{name:'Return to live queue',exact:true}).click()
 await page.reload();await page.getByRole('button',{name:'Live Queue',exact:true}).first().click()
 rows=(await get(page,'/api/queue')).body.data.filter(r=>ids.includes(r.id)).sort((a,b)=>a.branch_position-b.branch_position)
 assert.deepEqual(rows.map(r=>r.id),[ids[2],ids[0],ids[1]])
 assert.deepEqual(Object.fromEntries(rows.map(r=>[r.id,r.visit.arrived_at])),arrivalFacts)
 const history=(await get(page,'/api/queue/'+ids[2])).body.data.history
 assert.equal(history.filter(h=>h.event==='queue.reordered').length,1)
 pass('Staff queue move persisted across reload; dropped committed response retries the identical key/payload, with one history event and unchanged arrivals')
 // A new arrival after review invalidates the order snapshot rather than being silently displaced.
 selected=page.locator('.queue-open-row').filter({hasText:names[1]});await selected.getByRole('button',{name:'Move',exact:true}).click()
 dialog=page.getByRole('dialog',{name:'Move waiting Patient',exact:true})
 await dialog.getByRole('combobox',{name:'Move before',exact:true}).selectOption(ids[2])
 const another=await change(page,'/api/patients',{first_name:'Synthetic FIFO stale '+key,last_name:'Patient 4'},key+'-patient-4');assert.equal(another.status,201)
 const arrival=await change(page,'/api/visits/walk-in',{patient_id:another.body.data.id,branch_ref:fixture.branch,service_ref:fixture.service,dentist_ref:fixture.dentist},key+'-arrival-4');assert.equal(arrival.status,201)
 await dialog.getByRole('textbox',{name:'Reason for move',exact:true}).fill('Synthetic stale review must be refused')
 await dialog.getByRole('button',{name:'Record move',exact:true}).click()
 await dialog.getByRole('button',{name:'Reload current order',exact:true}).waitFor()
 assert.equal((await get(page,'/api/queue/'+ids[1])).body.data.revision,1)
 await dialog.getByRole('button',{name:'Reload current order',exact:true}).click()
 await dialog.getByRole('button',{name:'Record move',exact:true}).waitFor()
 pass('New arrival invalidates a reviewed move, preserves typed reason and allows explicit reload without a write')
 // Real dialog, keyboard focus and viewport safety at each requested width.
 for(const width of [375,390,430,768,1024,1440]){
  await page.setViewportSize({width,height:1000})
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow '+width)
  const bounds=await dialog.boundingBox();assert(bounds.x>=-1&&bounds.x+bounds.width<=width+1,'dialog overflow '+width)
  const reason=dialog.getByRole('textbox',{name:'Reason for move',exact:true});await reason.focus();assert(await reason.evaluate(e=>e===document.activeElement))
  await page.screenshot({path:evidence+'/queue-order-'+width+'.png',fullPage:true})
 }
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'})
 assert(await page.evaluate(()=>document.activeElement?.textContent==='Move'),'focus returns to initiating Move')
 pass('Queue order dialog fits six widths; reason accepts keyboard focus and Escape returns focus to Move')
 state.accepted=true;save()
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:evidence+'/failure.png',fullPage:true});save();throw error}finally{await browser.close()}

// Authorized Staff and Patient chart readback on the owned synthetic target.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
const {browser,login,get,api,evidence,target}=await import('./local-visit-support.mjs')
const original=JSON.parse(readFileSync(target.runtime+'/encounter-browser-batch03/journey.json','utf8')).scheduled
const foreign=JSON.parse(readFileSync(target.runtime+'/encounter-browser-batch03/journey.json','utf8')).walkin
const file=evidence+'/journey.json',state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{groups:[]}
const save=()=>writeFileSync(file,JSON.stringify(state,null,2)),pass=s=>{if(!state.groups.includes(s))state.groups.push(s);save();console.log('PASS '+s)};state.accepted=false;save();let page
try{
 const d=await login('sprint02.dentist@example.test');page=d.page
 const t=(await get(page,'/api/visits/'+original.visit.id+'/treatment')).body.data;assert.equal(t.status,'Completed')
 if(!state.entry){const chart=(await get(page,'/api/patients/'+t.patient.id+'/chart')).body.data;const payload={tooth:'16',status:'To monitor',surfaces:[],note:'Synthetic private chart readback note',recorded_on:new Date(Date.now()+8*3600e3).toISOString().slice(0,10),branch_ref:t.branch.id,treatment_id:t.id,expected_treatment_revision:t.revision,expected_revision:chart.tooth_revisions['16']||0};const result=await page.evaluate(async({api,path,payload})=>{const client=await import('/src/api-client.js');return client.recordChartEntry(path,payload,'batch05-patient-chart-readback')},{api,path:t.patient.id,payload});assert.equal(result.ok,true,JSON.stringify(result));state.entry=result.meta.chart_receipt;save()}
 assert.deepEqual((await get(page,'/api/visits/'+t.visit.id+'/treatment')).body.data,t);await d.context.close()
 const staff=await login('sprint02.staff@example.test');page=staff.page
 await page.getByRole('button',{name:'Patient Records',exact:true}).first().click();await page.getByRole('searchbox',{name:'Search patients',exact:true}).fill(t.patient.code);await page.locator('.patient-list-scroll button').filter({hasText:t.patient.code}).click()
 const chart=page.getByRole('region',{name:'Dental chart',exact:true});await chart.getByRole('button',{name:'Select tooth 16',exact:true}).waitFor();await chart.getByRole('button',{name:'Select tooth 16',exact:true}).focus();await page.keyboard.press('Enter');await chart.getByText('Tooth 16',{exact:true}).waitFor();assert.equal(await chart.getByRole('button',{name:'Record finding',exact:true}).count(),0);assert.equal(await chart.getByText('Synthetic private chart readback note',{exact:true}).count(),0)
 const tooth=chart.getByRole('button',{name:/^Tooth 16(?:$|:)/});const anchored=await tooth.getAttribute('transform');await tooth.hover();assert.equal(await tooth.getAttribute('transform'),anchored)
 for(const width of [375,390,430,768,1024,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Staff chart overflow '+width);await page.screenshot({path:evidence+'/staff-chart-'+width+'.png',fullPage:true})}
 pass('Staff full Patient record shares stable chart and whole-chart summary, keyboard tooth selection, read-only redacted history at six widths');await staff.context.close()
 const patient=await login('sprint02.patient@example.test');page=patient.page
 await page.route(api+'/api/me/chart',r=>r.fulfill({json:{data:{patient:{id:foreign.patient.id},current:[{tooth:'18',status:'Synthetic foreign finding'}],summary:[],history:null}}}))
 await page.getByRole('button',{name:'My teeth',exact:true}).first().click();await page.getByText('The returned chart did not confirm your Patient identity. No findings were adopted.',{exact:true}).waitFor();assert.equal(await page.getByText('Synthetic foreign finding',{exact:true}).count(),0)
 await page.unroute(api+'/api/me/chart');await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByRole('button',{name:'Select tooth 16',exact:true}).waitFor();await page.getByRole('button',{name:'Select tooth 16',exact:true}).click();assert.equal(await page.getByText('Synthetic private chart readback note',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Record finding',exact:true}).count(),0)
 pass('Patient rejects foreign chart payload; Retry reads own persisted current finding without notes/history or write controls')
 let release,started;const held=new Promise(r=>{started=r}),barrier=new Promise(r=>{release=r})
 await page.route(api+'/api/me/chart',async route=>{const response=await route.fetch();started();await barrier;await route.fulfill({response})},{times:1});await page.getByRole('button',{name:'Reload my chart',exact:true}).click();await held;await page.getByRole('button',{name:'Home',exact:true}).first().click();release();await page.waitForTimeout(100);assert.equal(await page.getByRole('heading',{name:'My teeth',exact:true}).count(),0)
 await page.getByRole('button',{name:'My teeth',exact:true}).first().click();await page.getByRole('button',{name:'Select tooth 16',exact:true}).waitFor()
 for(const width of [375,390,430,768,1024,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Patient chart overflow '+width);await page.screenshot({path:evidence+'/patient-chart-'+width+'.png',fullPage:true})}
 pass('late chart response after navigation is suppressed; own chart reload and six required widths pass')
 state.accepted=true;save()
}catch(e){if(page&&!page.isClosed()){writeFileSync(evidence+'/failure-text.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/failure.png',fullPage:true})}throw e}finally{await browser.close()}

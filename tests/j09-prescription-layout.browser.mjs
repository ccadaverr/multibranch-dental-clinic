// Final source, read-only persisted-record comparison. No clinical writes.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {browser,login,get,evidence,target,api,base} from './local-visit-support.mjs'
const state=JSON.parse(readFileSync(target.runtime+'/j09-context.json','utf8'))
const measured=JSON.parse(readFileSync(target.runtime+'/reliability-browser/after-results.json','utf8'))
assert.equal(measured.accepted,true)
const id=measured.flows.dirtyDraftIssue.completion.id,widths=[375,390,430,768,1024,1440]
let page
async function capture(name){for(const width of widths){await page.setViewportSize({width,height:1000});await page.evaluate(()=>window.scrollTo(0,0));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:evidence+'/final-'+name+'-'+width+'.png',fullPage:true})}}
try{
 const dentist=await login('sprint02.dentist@example.test');page=dentist.page
 const rx=(await get(page,'/api/prescriptions/'+id)).body.data,care=(await get(page,'/api/treatments/'+state.treatment.id)).body.data
 await page.getByRole('button',{name:'My Queue',exact:true}).first().click();await page.getByRole('button',{name:'Continue treatment',exact:true}).first().click();await page.getByRole('button',{name:'Open visit prescriptions',exact:true}).click()
 await page.getByRole('region',{name:'Prescription Patient and Visit',exact:true}).waitFor()
 await page.getByRole('combobox',{name:'Select medicine 1',exact:true}).selectOption('__other__')
 const medicine=page.getByRole('textbox',{name:'Specify medicine name',exact:true});await medicine.fill('Synthetic J09 retained visual draft')
 await page.locator('.fd-list>li').filter({hasText:rx.number}).waitFor();await capture('composer')
 await page.route(api+'/api/visits/'+state.visit.id,r=>r.abort('failed'))
 await page.getByRole('button',{name:'Reload prescriptions',exact:true}).click();await page.getByRole('button',{name:'Retry loading visits',exact:true}).waitFor()
 assert.equal(await medicine.inputValue(),'Synthetic J09 retained visual draft');assert.equal(await page.getByRole('button',{name:'Issue prescription',exact:true}).isDisabled(),true)
 await capture('visit-error');await page.unroute(api+'/api/visits/'+state.visit.id)
 await page.getByRole('button',{name:'Retry loading visits',exact:true}).focus();await page.keyboard.press('Enter')
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Issue prescription')?.disabled)
 assert.equal(await medicine.inputValue(),'Synthetic J09 retained visual draft')
 await page.locator('.fd-list>li').filter({hasText:rx.number}).getByRole('button',{name:'Open',exact:true}).click();await page.getByRole('dialog').getByText(rx.lines[0].medicine,{exact:true}).waitFor();await capture('issued')
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await medicine.inputValue(),'Synthetic J09 retained visual draft')
 assert.deepEqual((await get(page,'/api/prescriptions/'+id)).body.data,rx);assert.deepEqual((await get(page,'/api/treatments/'+state.treatment.id)).body.data,care)
 const patient=await login('sprint02.patient@example.test');page=patient.page;await page.goto(base+'/?j09-final-layout#p/prescriptions');await page.getByRole('heading',{name:rx.number,exact:true}).waitFor();await capture('patient-prescriptions')
 writeFileSync(evidence+'/layout-results.json',JSON.stringify({accepted:true,widths,readOnly:true,prescription:id,visit:state.visit.id},null,2));console.log('PASS final six-width composer, retained-error draft, keyboard recovery, issued review and Patient records; clinical rows unchanged')
}finally{await browser.close()}

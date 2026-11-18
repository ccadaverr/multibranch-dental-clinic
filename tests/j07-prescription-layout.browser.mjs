// Final-source populated layout and safe repeated review. No prescription or treatment writes.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {browser,login,get,evidence,target} from './local-visit-support.mjs'
const state=JSON.parse(readFileSync(target.runtime+'/clinical-browser/journey.json','utf8'));assert.equal(state.accepted,true)
const widths=[375,390,430,768,1024,1440]
async function capture(page,name){for(const width of widths){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.evaluate(()=>{window.scrollTo(0,0);return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))});await page.screenshot({path:evidence+'/final-'+name+'-'+width+'.png',fullPage:true})}}
let page
try{
 const d=await login('sprint02.dentist@example.test');page=d.page
 const before=(await get(page,'/api/prescriptions/'+state.issued.id)).body.data,treatment=(await get(page,'/api/treatments/'+state.treatment.id)).body.data
 await page.getByRole('button',{name:'My Queue',exact:true}).first().click();await page.getByRole('button',{name:'Continue treatment',exact:true}).first().click();await page.getByRole('button',{name:'Open visit prescriptions',exact:true}).click();await page.getByRole('region',{name:'Prescription Patient and Visit',exact:true}).waitFor()
 assert.equal(await page.getByRole('combobox',{name:/^Visit/}).inputValue(),state.visit.id)
 await page.getByRole('combobox',{name:'Select medicine 1',exact:true}).selectOption('__other__');const input=page.getByRole('textbox',{name:'Specify medicine name',exact:true});await input.fill('Synthetic J07 unsaved layout draft');await capture(page,'prescription-compose')
 const row=page.locator('.fd-list>li').filter({hasText:state.issued.number});await row.getByRole('button',{name:'Open',exact:true}).click();await page.getByRole('dialog').getByText(state.issued.lines[0].medicine,{exact:true}).waitFor();await capture(page,'prescription-issued');await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();assert.equal(await input.inputValue(),'Synthetic J07 unsaved layout draft')
 assert.deepEqual((await get(page,'/api/prescriptions/'+state.issued.id)).body.data,before);assert.deepEqual((await get(page,'/api/treatments/'+state.treatment.id)).body.data,treatment)
 writeFileSync(evidence+'/layout-results.json',JSON.stringify({accepted:true,widths,readOnly:true,visit:state.visit.id,prescription:state.issued.id},null,2));console.log('PASS final linked prescription layout, repeated issued review, retained unsaved editor and unchanged clinical records at six widths')
}catch(error){if(page&&!page.isClosed()){writeFileSync(evidence+'/layout-failure.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/layout-failure.png',fullPage:true})}throw error}finally{await browser.close()}

// Final populated captures from accepted J05 data. No clinical writes or discarded drafts.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {browser,login,get,evidence,target} from './local-visit-support.mjs'
const f=JSON.parse(readFileSync(target.runtime+'/visit-fixture.json','utf8')),state=JSON.parse(readFileSync(target.runtime+'/history-browser/j05-state.json','utf8'));assert.equal(state.accepted,true)
const widths=[375,390,430,768,1024,1440]
async function capture(page,name){for(const width of widths){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.evaluate(()=>{window.scrollTo(0,0);return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))});await page.screenshot({path:evidence+'/final-'+name+'-'+width+'.png',fullPage:true})}}
let page
try{
 const treatment=await login('sprint02.dentist@example.test');page=treatment.page
 await page.getByRole('button',{name:'My Queue',exact:true}).first().click();await page.getByRole('button',{name:'Continue treatment',exact:true}).first().click()
 const notes=page.getByRole('textbox',{name:'Clinical notes',exact:true});await notes.fill('Synthetic J05 final layout unsaved treatment draft')
 const before=(await get(page,'/api/treatments/'+state.treatment.id)).body.data,inline=page.locator('.enc-history-preview');await inline.locator(':scope > summary').click();await inline.getByText('Page 1 of 11',{exact:true}).waitFor();await inline.getByRole('button',{name:/Review encounter/}).first().click();await inline.getByRole('region',{name:'Historical encounter',exact:true}).waitFor()
 await capture(page,'inline-history');assert.equal(await notes.inputValue(),'Synthetic J05 final layout unsaved treatment draft')
 assert.deepEqual((await get(page,'/api/treatments/'+state.treatment.id)).body.data,before)
 const chart=await login('sprint02.dentist@example.test');page=chart.page
 await page.getByRole('button',{name:'Dental Chart',exact:true}).first().click();await page.waitForFunction(()=>document.querySelector('[aria-label="Reload authorized visits"]')?.getAttribute('aria-busy')==='false')
 await page.getByRole('searchbox',{name:'Search chart Patients',exact:true}).fill(f.patientCode);await page.locator('.patient-picker-list button').filter({hasText:f.patientCode}).click();await page.getByRole('combobox',{name:'Choose tooth',exact:true}).selectOption('16')
 const chartBefore=(await get(page,'/api/patients/'+f.patientId+'/chart')).body.data,note=page.getByRole('textbox',{name:/Note \(optional\)/});await note.fill('Synthetic J05 final layout unsaved finding draft')
 const history=page.getByRole('region',{name:'Recorded tooth history',exact:true});await history.getByRole('button',{name:'Older findings',exact:true}).click();await history.locator('.od-history-entry').first().locator('summary').click();await history.getByRole('button',{name:'Review linked encounter',exact:true}).click();await page.getByRole('region',{name:'Linked encounter review',exact:true}).getByRole('region',{name:'Historical encounter',exact:true}).waitFor()
 await capture(page,'linked-history');assert.equal(await note.inputValue(),'Synthetic J05 final layout unsaved finding draft');assert.equal(await notes.inputValue(),'Synthetic J05 final layout unsaved treatment draft')
 assert.deepEqual((await get(page,'/api/patients/'+f.patientId+'/chart')).body.data,chartBefore)
 writeFileSync(evidence+'/layout-results.json',JSON.stringify({accepted:true,widths,readOnly:true,treatment:state.treatment.id,patient:f.patientId},null,2));console.log('PASS final six-width inline/linked history layout, both retained drafts and unchanged persisted chart/treatment')
}catch(error){if(page&&!page.isClosed()){writeFileSync(evidence+'/layout-failure.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/layout-failure.png',fullPage:true})}throw error}finally{await browser.close()}

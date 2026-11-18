// Final source screenshots and neighboring Staff/Patient read-only safeguards. No clinical writes.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {browser,login,get,evidence,target} from './local-visit-support.mjs'
const f=JSON.parse(readFileSync(target.runtime+'/visit-fixture.json','utf8')),s=JSON.parse(readFileSync(target.runtime+'/workspace-browser/journey.json','utf8'));assert.equal(s.accepted,true)
let page
try{
 const dentist=await login('sprint02.dentist@example.test');page=dentist.page
 await page.getByRole('button',{name:'My Queue',exact:true}).first().click();await page.getByRole('combobox',{name:'Worklist',exact:true}).selectOption('history');await page.getByRole('button',{name:'View completed record',exact:true}).click()
 await page.getByRole('button',{name:'Open dental chart',exact:true}).click();await page.getByRole('button',{name:'Review saved chart',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="Review saved chart"]')?.getAttribute('aria-busy')==='false')
 await page.getByRole('combobox',{name:'Choose tooth',exact:true}).selectOption('16')
 for(const width of [375,390,430,768,1024,1440]){
  await page.setViewportSize({width,height:1000});await page.getByRole('region',{name:'Current saved findings',exact:true}).getByText('Filled',{exact:true}).waitFor();assert.match(await page.locator('.chart-context').innerText(),new RegExp(s.visit.id));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.equal(await page.getByRole('button',{name:'Record finding',exact:true}).isDisabled(),true)
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:evidence+'/final-dentist-chart-'+width+'.png',fullPage:true})
 }
 const before=(await get(page,'/api/treatments/'+s.treatment.id)).body.data
 await page.getByRole('button',{name:'Return to encounter',exact:true}).click();const inline=page.locator('.enc-chart-preview');await inline.locator('summary').click();await inline.getByRole('button',{name:'Review saved chart',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="Review saved chart"]')?.getAttribute('aria-busy')==='false');assert.equal(await inline.getByRole('button',{name:'Record finding',exact:true}).count(),0)
 for(const width of [375,390,430,768,1024,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:evidence+'/final-encounter-preview-'+width+'.png',fullPage:true})}
 assert.deepEqual((await get(page,'/api/treatments/'+s.treatment.id)).body.data,before)
 console.log('PASS final six-width Dentist chart/encounter review, explicit new-entry status and unchanged completed treatment')
 const staff=await login('sprint02.staff@example.test');page=staff.page
 await page.getByRole('button',{name:'Patient Records',exact:true}).first().click();await page.getByRole('searchbox',{name:'Search patients',exact:true}).fill(f.patientCode);await page.locator('.patient-list-scroll button').filter({hasText:f.patientCode}).click()
 const chart=page.getByRole('region',{name:'Dental chart',exact:true});await chart.getByRole('combobox',{name:'Choose tooth',exact:true}).waitFor();await chart.getByRole('combobox',{name:'Choose tooth',exact:true}).selectOption('16')
 assert.equal(await chart.getByRole('button',{name:'Record finding',exact:true}).count(),0)
 for(const text of ['Synthetic J04 private tooth observation','Synthetic J04 newer saved revision'])assert.equal(await chart.getByText(text,{exact:true}).count(),0)
 for(const width of [390,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:evidence+'/final-staff-readonly-'+width+'.png',fullPage:true})}
 console.log('PASS neighboring Staff chart read-only UI and note redaction at phone/desktop widths')
 const patient=await login('sprint02.patient@example.test',390);page=patient.page
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('dialog',{name:'More',exact:true}).getByRole('button',{name:'My teeth',exact:true}).click();await page.getByRole('combobox',{name:'Choose tooth',exact:true}).waitFor();await page.getByRole('combobox',{name:'Choose tooth',exact:true}).selectOption('16')
 assert.equal(await page.getByRole('button',{name:'Record finding',exact:true}).count(),0)
 for(const text of ['Synthetic J04 private tooth observation','Synthetic J04 newer saved revision'])assert.equal(await page.getByText(text,{exact:true}).count(),0)
 assert.equal((await get(page,'/api/me/chart')).body.data.history,null)
 for(const width of [390,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:evidence+'/final-patient-readonly-'+width+'.png',fullPage:true})}
 console.log('PASS neighboring Patient current-only chart, private-note exclusion and read-only UI')
 writeFileSync(evidence+'/readonly-results.json',JSON.stringify({accepted:true,dentistWidths:[375,390,430,768,1024,1440],neighborWidths:[390,1440],visit:s.visit.id,treatment:s.treatment.id},null,2))
}catch(error){if(page&&!page.isClosed()){writeFileSync(evidence+'/readonly-failure.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/readonly-failure.png',fullPage:true})}throw error}finally{await browser.close()}

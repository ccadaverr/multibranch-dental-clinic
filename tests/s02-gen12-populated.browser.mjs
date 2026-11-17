import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {browser,login,api,evidence} from './local-visit-support.mjs'
const checks=[];let page
async function measure(locator,label,width){
 const rows=await locator.evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()).map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {name:n.getAttribute('aria-label')||n.textContent.trim(),width:r.width,height:r.height,font:parseFloat(s.fontSize)}}))
 assert(rows.length,label+' has controls')
 for(const r of rows){assert(r.name);assert(r.height>=31.5,label+' small height '+r.name);if(width<=640)assert(r.width>=43.5&&r.height>=43.5,label+' touch target '+r.name);assert(r.font>=12.9,label+' font '+r.name)}
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' page overflow')
 checks.push({label,width,controls:rows})
}
try{
 const staff=await login('sprint02.staff@example.test');page=staff.page
 await page.getByRole('button',{name:'Live Queue',exact:true}).first().click();const rows=page.locator('.queue-open-row');await rows.first().waitFor();assert(await rows.count()>0)
 for(const width of [375,390,430,768,1024,1440]){
  await page.setViewportSize({width,height:1000});await measure(rows.locator('.queue-actions button'),'populated Staff queue',width)
  const move=rows.first().getByRole('button',{name:'Move',exact:true});await move.click();const dialog=page.getByRole('dialog',{name:'Move waiting Patient',exact:true});await dialog.getByRole('combobox').waitFor()
  await measure(dialog.locator('button'),'real queue move dialog',width);await page.keyboard.press('Escape');assert(await move.evaluate(n=>n===document.activeElement));await page.screenshot({path:evidence+'/queue-'+width+'.png',fullPage:true})
 }
 await staff.context.close();const dentist=await login('sprint02.dentist@example.test');page=dentist.page
 await page.getByRole('button',{name:'My Queue',exact:true}).first().click();await page.locator('.enc-queue-row').first().waitFor()
 for(const width of [375,390,430,768,1024,1440]){await page.setViewportSize({width,height:1000});await measure(page.locator('.enc-queue-row button'),'populated Dentist queue',width)}
 writeFileSync(evidence+'/results.json',JSON.stringify({passed:true,checks,limitation:'Representative populated queue/move dialog; all administrative and clinical modal coverage remains incomplete.'},null,2))
 console.log('PASS real populated Staff/Dentist queues and queue move dialog; six widths and Escape focus; no queue/clinical mutation')
}catch(e){if(page&&!page.isClosed())await page.screenshot({path:evidence+'/failure.png',fullPage:true});throw e}finally{await browser.close()}

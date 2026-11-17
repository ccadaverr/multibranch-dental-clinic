// Final scoped status-wrap regression; no financial command is issued.
import assert from 'node:assert/strict'
import {browser,login,base,evidence} from './local-visit-support.mjs'
try{
 const {page}=await login('sprint02.patient@example.test')
 await page.goto(base+'/?j02-billing='+Date.now()+'#p/billing')
 const status=page.locator('.pp-invoice-head>.pp-pill').first();await status.waitFor()
 for(const width of [375,390,430,768,1024,1440]){
  await page.setViewportSize({width,height:1000})
  assert.equal(await status.innerText(),'Payment due')
  const box=await status.boundingBox();assert.ok(box.height<32,'Payment due must stay on one line at '+width)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await page.screenshot({path:evidence+'/patient-billing-'+width+'.png',fullPage:true})
 }
 console.log('PASS six-width unpaid invoice status without broken words; no payment')
}finally{await browser.close()}

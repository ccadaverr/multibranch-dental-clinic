import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {writeFile,mkdir} from 'node:fs/promises'
const browser=await chromium.launch({channel:'chrome',headless:true})
const page=await browser.newPage();page.setDefaultTimeout(6000)
const errors=[],results=[];page.on('pageerror',e=>errors.push(e.message))
await page.route('**/api/**',r=>r.fulfill({status:403,json:{message:'Synthetic ancillary panel unavailable'}}))
try{
 for(const width of [390,768,1024,1440]){
  await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:5187/tests/fixtures/yzh-qa-02.html');await page.waitForFunction(()=>window.qa02);await page.evaluate(()=>window.qa02.setMode('staff'))
  await page.getByRole('combobox',{name:/Today/}).selectOption('synthetic-appt')
  await page.getByRole('checkbox',{name:'Valid ID presented'}).check();await page.getByRole('button',{name:'Confirm arrival',exact:true}).click()
  await page.getByText('Arrival recorded — queue number 1.',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.qaStaffCalls),['synthetic-appt'])
  await page.getByRole('button',{name:'Walk-in admission',exact:true}).click()
  const combo=page.getByRole('combobox',{name:/Patient/});await combo.fill('Synthetic patient');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter')
  await page.getByText('Selected:',{exact:false}).waitFor();assert.equal(await combo.getAttribute('aria-expanded'),'false')
  await page.getByRole('button',{name:'Clear selected patient'}).click();assert.equal(await combo.inputValue(),'');await combo.focus();await page.keyboard.press('Escape');assert.equal(await combo.getAttribute('aria-expanded'),'false')
  await combo.fill('no matching synthetic record');await page.getByText('No matching patients found.',{exact:true}).waitFor();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab')
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  results.push({width,scheduledCheckInActions:3,combobox:'pass'})
 }
 assert.deepEqual(errors,[]);await mkdir('docs/ui-review/yzh-qa-02',{recursive:true});await writeFile('docs/ui-review/yzh-qa-02/staff-results.json',JSON.stringify({results,errors,callbackFixture:true,authenticatedAcceptance:false},null,2));console.log(JSON.stringify({results,errors}))
}finally{await browser.close()}

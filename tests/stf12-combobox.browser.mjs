// Synthetic UI only. No admission or database operation is performed.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE)
const url=process.env.STF12_URL||'http://127.0.0.1:5194/tests/fixtures/staff-workflow-a8.html'
const browser=await chromium.launch({headless:true,channel:'chrome'}),completed=[]
try{
 for(const width of [390,1440])for(const mode of ['click','keyboard-results','touch','focus','target']){
  if(process.env.QA_CASE&&process.env.QA_CASE!==mode)continue
  const page=await browser.newPage({viewport:{width,height:1000},hasTouch:true}),errors=[];page.setDefaultTimeout(4000);page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort())
  await page.route('**/api/**',r=>new URL(r.request().url()).pathname==='/api/front-desk/today'?r.fulfill({json:{data:{settings:{},late:[],replies:[],released:[],free_times:[],confirmations:[]}}}):r.fulfill({status:403,json:{message:'Synthetic ancillary access unavailable'}}))
  try{
   await page.goto(url);await page.waitForFunction(()=>window.fixture);await page.evaluate(()=>window.fixture.navigate('checkin',{mode:'walkin'}))
   const combo=page.getByRole('combobox',{name:/^Patient/});await combo.fill('Synthetic')
   const first=page.getByRole('option').filter({hasText:'Synthetic Selected Patient'}),selected=page.locator('.patient-combobox-selected')
   if(mode==='click'){await first.evaluate(e=>e.click());await selected.waitFor();assert.match(await selected.textContent(),/Synthetic Selected Patient/)}
   if(mode==='touch'){await first.tap();await selected.waitFor();assert.match(await selected.textContent(),/Synthetic Selected Patient/)}
   if(mode==='target'){const box=await first.boundingBox();assert.ok(box.height>=44,'GEN-12: match existing 44px shared control target; got '+box.height)}
   if(mode==='keyboard-results'){
    await combo.press('ArrowDown');assert.ok(await combo.getAttribute('aria-activedescendant'))
    await page.evaluate(()=>{window.fixture.state.patients.reverse();window.fixture.refreshUI()})
    await page.waitForFunction(()=>document.querySelector('[role="combobox"]').getAttribute('aria-activedescendant')===null)
    await combo.press('Enter');assert.equal(await selected.count(),0,'new results need a fresh explicit choice')
    await combo.press('ArrowDown');await combo.press('Enter');await selected.waitFor();assert.match(await selected.textContent(),/Synthetic Other Patient/)
   }
   if(mode==='focus'){
    await combo.press('ArrowDown');await combo.press('Enter');await selected.waitFor()
    const clear=page.getByRole('button',{name:'Clear selected patient',exact:true});await clear.focus();await clear.press('Enter')
    assert.equal(await combo.inputValue(),'');assert.equal(await combo.evaluate(e=>e===document.activeElement),true,'focus returns to surviving combobox')
    await page.waitForTimeout(200);assert.equal(await combo.getAttribute('aria-expanded'),'true','obsolete blur timer cannot close refocused results')
    await combo.fill('TEST-002');assert.equal(await page.getByRole('listbox').getByRole('option').count(),1);await combo.press('ArrowDown');await combo.press('Enter');assert.match(await selected.textContent(),/Synthetic Other Patient/)
    await clear.click();await combo.fill('000001');assert.equal(await page.getByRole('listbox').getByRole('option').count(),1);await combo.press('Escape');assert.equal(await combo.getAttribute('aria-expanded'),'false')
   }
   assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.checkIns?.length||0),0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));completed.push({width,mode});console.log('PASS '+width+' '+mode)
  }finally{await page.close()}
 }
 console.log(JSON.stringify({passed:completed.length,completed}))
}finally{await browser.close()}

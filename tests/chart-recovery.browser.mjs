// Real React editor state, synthetic callback only. No API, database, auth or server-receipt claim.
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
const {browser,base,evidence}=await import('./local-visit-support.mjs')
const page=await browser.newPage({viewport:{width:1440,height:1000}})
await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort())
try{
  await page.goto(base+'/tests/fixtures/chart-recovery.html')
  const branch=page.getByRole('combobox',{name:/^Clinic Branch/}),note=page.getByRole('textbox',{name:/Note \(optional\)/})
  await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('Caries')
  await branch.selectOption('b2');await note.fill('Synthetic original finding')
  const save=page.getByRole('button',{name:'Record finding',exact:true});await save.focus();await page.keyboard.press('Enter')
  await page.waitForFunction(()=>window.chartRecovery.calls.length===1);await page.evaluate(()=>window.chartRecovery.reject())
  await page.getByRole('alert').filter({hasText:'Check the chart before retrying with different details.'}).waitFor()
  assert(await branch.isDisabled());assert(await note.isDisabled())
  for(const width of [375,390,430,768,1024,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'uncertain state overflow '+width);assert(await branch.isDisabled());await page.screenshot({path:evidence+'/chart-uncertain-'+width+'.png',fullPage:true})}
  const retry=page.getByRole('button',{name:'Retry same finding',exact:true});await retry.focus();await page.keyboard.press('Enter')
  await page.waitForFunction(()=>window.chartRecovery.calls.length===2)
  const calls=await page.evaluate(()=>window.chartRecovery.calls);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1].branch_ref,'b2');assert.equal(calls[1].expected_revision,7);assert.equal(calls[1].tooth,'16')
  await page.evaluate(()=>window.chartRecovery.confirm());await save.waitFor();assert.equal(await note.inputValue(),'');assert.equal(await branch.inputValue(),'b2');assert.equal(await page.getByRole('combobox',{name:'Status',exact:true}).inputValue(),'');assert.equal(await save.isDisabled(),true)
  for(const width of [375,390,430,768,1024,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width);await page.screenshot({path:evidence+'/chart-recovery-'+width+'.png',fullPage:true})}
  writeFileSync(evidence+'/chart-recovery.json',JSON.stringify({accepted:true,scope:'Real React synthetic callback; exact original payload/revision, frozen uncertain fields, keyboard and six widths. Server receipt/key covered separately.'},null,2))
  console.log('PASS chart exception wording, frozen original payload/revision, keyboard same-finding retry and six widths')
}finally{await browser.close()}

import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const root=process.env.CLIN04_URL||'http://127.0.0.1:5195'
const evidence=process.env.CLIN04_EVIDENCE_DIR||path.join(os.tmpdir(),'yzh-clin-04-visual')
await mkdir(evidence,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[]
try {
  for(const width of [390,768,1024,1440]) {
    const context=await browser.newContext({viewport:{width,height:1000},hasTouch:true,reducedMotion:'reduce'}),p=await context.newPage()
    await p.route('**/api/**',r=>r.abort())
    await p.goto(root+'/tests/fixtures/yzh-clin-04.html');await p.locator('.od-tooth[data-tooth="18"]').waitFor()
    await p.getByRole('button',{name:'Before chart',exact:true}).focus()
    for(let i=0;i<10&&!(await p.locator('.od-tooth:focus').count());i++)await p.keyboard.press('Tab')
    await p.screenshot({path:path.join(evidence,width+'-keyboard-focus.png'),fullPage:true,animations:'disabled'})
    await p.keyboard.press('Enter');await p.getByRole('textbox',{name:/^Note \(optional\)/}).fill('Synthetic draft for Tooth 18')
    await p.locator('.od-tooth[data-tooth="17"]').focus();await p.keyboard.press('Enter');await p.getByRole('dialog').waitFor()
    await p.screenshot({path:path.join(evidence,width+'-confirmation.png'),fullPage:true,animations:'disabled'})
    await p.keyboard.press('Escape')
    await p.getByRole('button',{name:'Front view',exact:true}).click()
    assert.equal(await p.getByRole('textbox',{name:/^Note \(optional\)/}).inputValue(),'Synthetic draft for Tooth 18')
    await p.screenshot({path:path.join(evidence,width+'-front-editor.png'),fullPage:true,animations:'disabled'})
    results.push({width,reducedMotion:true,overflow:await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)})
    await context.close()
  }
  assert(results.every(r=>!r.overflow))
  await writeFile(path.join(evidence,'results.json'),JSON.stringify(results,null,2))
  console.log(JSON.stringify({passed:results.length,evidence}))
}finally{await browser.close()}

import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
const {chromium}=await import(pathToFileURL(process.argv[2]).href),base=process.argv[3]||'http://127.0.0.1:5198'
const browser=await chromium.launch({channel:'chrome',headless:true}),failures=[]
try{
 for(const name of ['receipt selection','cancellation recovery','cancellation timeout','late message']){
  const page=await browser.newPage({viewport:{width:390,height:1000}});page.setDefaultTimeout(4000)
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort())
  if(name==='cancellation timeout')await page.clock.install()
  try{
   await page.goto(base+'/tests/fixtures/a06-reception.html?mode='+(name==='late message'?'queue':'checkin'))
   await page.waitForFunction(()=>window.a06?.store)
   if(name==='late message'){
    await page.evaluate(()=>{window.a06.holdMessage=true})
    await page.getByRole('button',{name:/Open conversation with/}).click();await page.waitForFunction(()=>window.a06.releaseMessage)
    await page.evaluate(()=>window.a06.setView('elsewhere'));await page.getByRole('heading',{name:'Synthetic destination'}).waitFor()
    await page.evaluate(()=>window.a06.releaseMessage());await page.waitForTimeout(150)
    assert.equal(await page.evaluate(()=>window.a06.events.some(e=>e.page==='messages')),false,'An unmounted queue must not navigate on late lookup')
   }else{
    const selection=page.getByRole('combobox',{name:/Today.s appointment/})
    await selection.selectOption(await page.evaluate(()=>window.a06.ids.A))
    if(name==='receipt selection'){
     await page.getByRole('checkbox',{name:'Valid ID presented',exact:true}).check();await page.getByRole('button',{name:'Confirm arrival',exact:true}).click()
     await page.locator('.notice').filter({hasText:'Arrival receipt'}).waitFor()
     await selection.selectOption(await page.evaluate(()=>window.a06.ids.A2))
     assert.equal(await page.locator('.notice').filter({hasText:'Arrival receipt'}).count(),0,'Previous Patient receipt must clear on new selection')
     assert.equal(await page.getByRole('checkbox',{name:'Valid ID presented',exact:true}).isChecked(),false)
    }else{
     if(name==='cancellation timeout')await page.evaluate(()=>{window.a06.cancelMode='hold'})
     await page.getByRole('button',{name:'Cancel appointment',exact:true}).click();await page.getByRole('button',{name:'Confirm cancellation',exact:true}).click()
     if(name==='cancellation timeout')await page.clock.runFor(30001)
     const retry=page.getByRole('button',{name:'Retry same cancellation',exact:true});await retry.waitFor()
     assert.equal(await page.getByRole('button',{name:'Keep appointment',exact:true}).isDisabled(),true)
     assert.equal(await page.getByRole('textbox',{name:/^Additional note/}).isDisabled(),true)
     await page.evaluate(()=>{window.a06.cancelMode='success'});await retry.click();await retry.waitFor({state:'hidden'})
     if(name==='cancellation timeout')await page.evaluate(()=>window.a06.releaseCancel())
     const calls=await page.evaluate(()=>window.a06.cancelCalls);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1])
    }
   }
   assert.deepEqual(errors,[]);console.log('PASS '+name)
  }catch(error){failures.push(name+': '+error.message);console.log('FAIL '+name+': '+error.message.split('\n')[0])}finally{await page.close()}
 }
 assert.deepEqual(failures,[])
}finally{await browser.close()}

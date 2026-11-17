import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
const {chromium}=await import(pathToFileURL(process.argv[2]).href),base=process.argv[3]||'http://127.0.0.1:5208'
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 for(const mode of ['network','wrong']){
  const page=await browser.newPage({viewport:{width:390,height:1000}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-11-17T10:00:00Z')})
  await page.goto(base+'/tests/fixtures/a06-reception.html?mode=queue');await page.waitForFunction(()=>window.a06?.store)
  await page.evaluate(mode=>{window.a06.queueMode=mode},mode)
  const call=page.getByRole('button',{name:/^Call patient .* in queue$/})
  assert.equal(await call.innerText(),'');assert.equal(await call.getAttribute('title'),'Call patient in queue')
  await call.evaluate(b=>{b.click();b.click()})
  const retry=page.getByRole('button',{name:'Retry same call',exact:true});await retry.waitFor()
  assert.equal(await page.evaluate(()=>window.a06.queueCalls.length),1)
  assert.equal(await call.isDisabled(),true)
  await page.evaluate(()=>{window.a06.queueMode='success'});await retry.focus();await page.keyboard.press('Enter')
  await page.getByText('Call recorded. The current queue has been refreshed.',{exact:true}).waitFor()
  const commands=await page.evaluate(()=>window.a06.queueCalls);assert.equal(commands.length,2);assert.deepEqual(commands[0],commands[1])
  assert.equal(await retry.count(),0);assert.deepEqual(errors,[])
  console.log('PASS Staff '+mode+' call failure retains exact identity, original revision/key and keyboard retry; duplicate dispatch suppressed')
  await page.close()
 }
}finally{await browser.close()}

import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
const {chromium}=await import(pathToFileURL(process.argv[2]).href)
const base=process.argv[3]||'http://127.0.0.1:5195'
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
  for(const width of [390,1440]){
    const page=await browser.newPage({viewport:{width,height:1000}}),errors=[]
    page.on('pageerror',error=>errors.push(error.message))
    await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort())
    await page.goto(base+'/tests/fixtures/cal02-calendar-scope.synthetic.html?all')
    await page.locator('.daycal-avatar-badge:not(.daycal-more-avatar)').first().waitFor()
    await page.evaluate(()=>{
      const original=window.fetch
      window.privacy={deny:true,reads:0}
      window.fetch=(url,options)=>{
        if(new URL(url,location.href).pathname==='/api/appointments/A'){
          window.privacy.reads++
          if(window.privacy.deny)return Promise.resolve(Response.json({message:'Appointment not found.'},{status:404}))
        }
        return original(url,options)
      }
    })
    await page.locator('.daycal-avatar-badge:not(.daycal-more-avatar)').first().click()
    const details=page.getByRole('dialog',{name:'Appointment details',exact:true})
    await details.getByRole('button',{name:'Cancel',exact:true}).click()
    await page.getByText('That record could not be found.',{exact:true}).waitFor()
    assert.equal(await page.getByRole('dialog',{name:'Cancel this appointment?',exact:true}).count(),0)
    assert.equal(await page.evaluate(()=>window.cal02.commands.length),0)
    await page.evaluate(()=>{window.privacy.deny=false})
    await page.locator('.daycal-avatar-badge:not(.daycal-more-avatar)').first().click()
    await details.getByRole('button',{name:'Cancel',exact:true}).click()
    await page.getByRole('dialog',{name:'Cancel this appointment?',exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>window.privacy.reads),2)
    assert.equal(await page.evaluate(()=>window.cal02.commands.length),0,'recovering the read does not execute cancellation')
    await page.keyboard.press('Escape')
    assert.deepEqual(errors,[])
    console.log(`Appointment read 404/retry recovery PASS ${width}`)
    await page.close()
  }
}finally{await browser.close()}

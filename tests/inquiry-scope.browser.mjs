import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
const {chromium}=await import(pathToFileURL(process.argv[2]).href)
const base=process.argv[3]||'http://127.0.0.1:5195'
const browser=await chromium.launch({channel:'chrome',headless:true})
try {
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}}),posts=[],keys=[],errors=[]
  let holdCreate=false,releaseCreate,receivedCreate,loseResponse=false,records=[]
  const created={id:'synthetic-inquiry',source:'Facebook',contact:{name:'Replacement draft',detail:null},topic:'Replacement question',status:'Open',revision:1,branch:{id:'b2',name:'Synthetic B2'},assigned:{name:'Synthetic Staff'},received_at:'2026-11-16T10:00:00+08:00'}
  page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort())
  await page.route('**/sanctum/**',route=>route.fulfill({status:204}))
  await page.route('**/api/inquiries**',async route=>{
   if(route.request().method()==='POST'){
    posts.push(route.request().postDataJSON());keys.push(route.request().headers()['idempotency-key'])
    if(holdCreate){receivedCreate();await new Promise(resolve=>{releaseCreate=resolve})}
    else records=[created]
    if(loseResponse){loseResponse=false;return route.abort('failed')}
    return route.fulfill({status:201,json:{data:created}})
   }
   return route.fulfill({json:{data:records,meta:{next_cursor:null}}})
  })
  await page.goto(base+'/tests/fixtures/inquiry-scope.html')
  const name=page.getByRole('textbox',{name:'Contact name',exact:true}),topic=page.getByRole('textbox',{name:'What they asked',exact:true})
  await name.fill('Synthetic original draft');await topic.fill('Synthetic original question')
  await page.evaluate(()=>window.inquiryFixture.setBranch('b2'))
  await page.locator('#synthetic-branch').getByText('b2',{exact:true}).waitFor()
  assert.equal(await name.inputValue(),'','A draft must not silently retarget to another branch')
  assert.equal(await topic.inputValue(),'')
  assert.equal(posts.length,0)
  await page.evaluate(()=>window.inquiryFixture.setScopes([]))
  await page.getByText('Inquiries unavailable',{exact:true}).waitFor()
  assert.equal(await name.count(),0)
  await page.evaluate(()=>{window.inquiryFixture.setScopes(['b1','b2']);window.inquiryFixture.setRole('staff')})
  await name.fill('Original pending draft');await topic.fill('Original pending question')
  holdCreate=true
  const received=new Promise(resolve=>{receivedCreate=resolve})
  const record=page.getByRole('button',{name:'Record inquiry',exact:true})
  await record.evaluate(button=>{button.click();button.click()});await received
  assert.equal(posts.length,1)
  assert.equal(await name.isDisabled(),true)
  await page.evaluate(()=>window.inquiryFixture.setAccount('B'))
  await name.fill('Replacement draft');await topic.fill('Replacement question')
  const late=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/inquiries')
  releaseCreate();await (await late).finished()
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  assert.equal(await name.inputValue(),'Replacement draft')
  assert.deepEqual(await page.evaluate(()=>window.inquiryFixture.feedback),[])
  holdCreate=false;loseResponse=true
  await record.click()
  await page.waitForFunction(()=>window.inquiryFixture.feedback.length===1)
  assert.equal(await name.inputValue(),'Replacement draft')
  assert.equal((await page.evaluate(()=>window.inquiryFixture.feedback))[0][1],'warning')
  await record.focus();await page.keyboard.press('Enter')
  await page.waitForFunction(()=>window.inquiryFixture.feedback.some(row=>row[1]==='success'))
  assert.equal(posts.length,3)
  assert.equal(posts[1].branch_ref,'b2')
  assert.equal(keys[1],keys[2],'Unknown response retries retain the original operation identity')
  assert.equal(await name.inputValue(),'')
  await page.getByText('Replacement draft',{exact:true}).waitFor()
  await page.evaluate(()=>{window.inquiryFixture.setScopes(['b1','b2']);window.inquiryFixture.setRole('owner')})
  await page.getByText('Inquiries unavailable',{exact:true}).waitFor()
  assert.equal(await name.count(),0)
  assert.deepEqual(errors,[])
  await page.close();process.stdout.write(`Inquiry actor/branch scope passed at ${width}px\n`)
 }
}finally{await browser.close()}

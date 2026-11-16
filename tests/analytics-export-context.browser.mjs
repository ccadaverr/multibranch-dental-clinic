import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
const {chromium}=await import(pathToFileURL(process.argv[2]).href)
const browser=await chromium.launch({channel:'chrome',headless:true})
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),exports=[],errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/api/analytics/**',route=>{
    if(new URL(route.request().url()).pathname.endsWith('/export')){
      exports.push(new URL(route.request().url()))
      return route.fulfill({contentType:'text/csv',body:'Branch,Value\nb2,0'})
    }
    return route.fulfill({status:503,json:{message:'Synthetic report unavailable'}})
  })
  await page.route('**/api/me',route=>route.fulfill({json:{data:{id:'synthetic-owner',role:'owner',account_status:'Active'}}}))
  await page.goto('http://127.0.0.1:5195/tests/fixtures/analytics-export-context.html')
  const buttons=[page.getByRole('button',{name:'Export Report CSV',exact:true}),page.getByRole('button',{name:'Export Executive Analytics CSV',exact:true})]
  for(const button of buttons)assert.equal(await button.isDisabled(),true)
  assert.equal(exports.length,0)
  await page.evaluate(()=>window.analyticsContext.setBranch('Synthetic B2'))
  await buttons[0].waitFor();await page.waitForFunction(()=>!document.querySelector('button[disabled]')?.textContent?.includes('Export Report CSV'))
  await page.getByRole('combobox',{name:'Report period',exact:true}).selectOption('This Week')
  const [download]=await Promise.all([page.waitForEvent('download'),buttons[0].click()])
  assert.ok(download.suggestedFilename().startsWith('operational-analytics-'))
  await page.getByLabel('Export result',{exact:true}).getByText('Operational analytics CSV exported successfully.',{exact:true}).waitFor()
  assert.equal(exports.length,1);assert.equal(exports[0].searchParams.get('branch_id'),'b2');assert.equal(exports[0].searchParams.get('period'),'this week')
  let release
  await page.route('**/api/analytics/export?**',async route=>{
    await new Promise(resolve=>release=resolve)
    try{await route.fulfill({contentType:'text/csv',body:'Branch,Value\nb2,0'})}catch{/* Cancelled transport. */}
  })
  await buttons[0].focus();await page.keyboard.press('Enter')
  const cancel=page.getByRole('button',{name:'Cancel analytics export',exact:true})
  await cancel.waitFor()
  await cancel.focus();await page.keyboard.press('Enter')
  await page.getByText('Analytics export cancelled. No file was downloaded.',{exact:true}).waitFor()
  release()
  for(const session of [{serverUserId:'other',role:'staff',active:true},{serverUserId:'synthetic-owner',role:'owner',active:false},{role:'owner',active:true}]){
    await page.evaluate(session=>window.analyticsContext.setSession(session),session)
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].filter(b=>['Export Report CSV','Export Executive Analytics CSV'].includes(b.textContent.trim())).every(b=>b.disabled))
    for(const button of buttons)assert.equal(await button.isDisabled(),true)
  }
  assert.equal(exports.length,1);assert.deepEqual(errors,[])
  console.log(JSON.stringify({synthetic:true,unresolvedBranchNoDispatch:true,exactBranchPeriodCsv:true,bothControlsRoleGuarded:true,keyboardCancel:true}))
}finally{await browser.close()}

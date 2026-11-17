import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {clinicDate,addDays} from '../src/clock.js'
const container=process.env.A05_CONTAINER,targetPath=process.env.A05_TARGET,evidence=process.env.A05_EVIDENCE
assert(container&&targetPath&&evidence&&process.env.PLAYWRIGHT_MODULE)
const privateRead=path=>execFileSync('docker',['exec',container,'cat',path],{encoding:'utf8'}).trim()
const target=JSON.parse(privateRead(targetPath))
assert.equal(target.host,'127.0.0.1');assert.equal(target.demo_database,'dental_clinic_demo')
assert.equal(privateRead(target.runtime+'/synthetic-runtime'),target.cluster_id)
const password=privateRead(target.runtime+'/demo-login-password'),base='http://127.0.0.1:5198',api='http://127.0.0.1:8124'
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[]
mkdirSync(evidence,{recursive:true})
async function login(email){
 const context=await browser.newContext({viewport:{width:390,height:900},timezoneId:'America/Los_Angeles'}),page=await context.newPage()
 page.setDefaultTimeout(20000)
 await page.route('**/*',r=>[base,api].includes(new URL(r.request().url()).origin)?r.continue():r.abort())
 await page.goto(base+'/#sign-in');await page.getByRole('textbox',{name:/email/i}).fill(email);await page.locator('input[type=password]').fill(password)
 await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:/^Notifications/}).first().waitFor()
 return {context,page}
}
const read=(page,path)=>page.evaluate(async({api,path})=>{const r=await fetch(api+path,{credentials:'include',headers:{Accept:'application/json'}});return {status:r.status,body:await r.json()}},{api,path})
const matches=(response,params)=>{const url=new URL(response.url());return url.origin===api&&url.pathname==='/api/audit-logs'&&Object.entries(params).every(([k,v])=>url.searchParams.get(k)===v)}
try{
 const owner=await login('owner@example.test')
 try{
  const {page}=owner
  await page.getByRole('button',{name:'Open navigation',exact:true}).click()
  await page.getByRole('button',{name:'Audit Trail',exact:true}).click()
  const loaded=await read(page,'/api/audit-logs')
  assert.equal(loaded.status,200)
  const row=loaded.body.data.find(r=>r.auditable_type&&r.auditable_id&&r.branch?.id)
  assert(row,'Seeded persisted operational audit target required')
  const branches=await read(page,'/api/branches');assert.equal(branches.status,200)
  const canonical=branches.body.data.filter(branch=>branch.public_id===row.branch.id)
  assert.equal(canonical.length,1,'Audit public branch identity resolves to one canonical selector ID')
  const branch=canonical[0].id
  const filtered=page.waitForResponse(r=>matches(r,{branch_id:branch}))
  await page.locator('#main-content').getByRole('combobox',{name:'Branch',exact:true}).selectOption(branch);assert.equal((await filtered).status(),200)
  const exact={branch_id:branch,target_type:row.auditable_type,target_id:row.auditable_id}
  const response=page.waitForResponse(r=>matches(r,exact))
  const shortcut=page.getByRole('button',{name:`Show record history for ${row.auditable_type} ${row.auditable_id}`,exact:true}).first()
  await shortcut.focus();await page.keyboard.press('Enter')
  const history=await response;assert.equal(history.status(),200)
  const data=(await history.json()).data;assert(data.length>0)
  assert(data.every(r=>r.auditable_type===row.auditable_type&&r.auditable_id===row.auditable_id&&r.branch?.id===row.branch.id))
  const status=page.getByRole('status').filter({hasText:'Record filter:'});assert(await status.evaluate(el=>el===document.activeElement))
  for(const [button,from] of [['Last 7 days',addDays(clinicDate(),-6)],['Today',clinicDate()]]){
   const dates={...exact,date_from:from,date_to:clinicDate()}
   const query=page.waitForResponse(r=>matches(r,dates));await page.getByRole('button',{name:button,exact:true}).click()
   const result=await query;assert.equal(result.status(),200)
   const entries=(await result.json()).data;assert(entries.length>0)
   assert(entries.every(r=>r.auditable_type===row.auditable_type&&r.auditable_id===row.auditable_id&&r.branch?.id===row.branch.id))
   assert.equal(await page.getByLabel('From:').inputValue(),from);assert.equal(await page.getByLabel('To:').inputValue(),clinicDate())
  }
  for(const width of [375,390,430,768,1024,1440]){
   await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
   await page.screenshot({path:evidence+'/audit-'+width+'.png',fullPage:true})
  }
  results.push({role:'owner',exactPersistedRecord:true,preservedBranch:true,manilaRanges:true,keyboardFocus:true,widths:[375,390,430,768,1024,1440]})
 }finally{await owner.context.close()}
 for(const [role,email] of [['staff','staff.reception@example.test'],['dentist','dentist@example.test'],['patient','patient@example.test']]){
  const user=await login(email)
  try{
   assert.equal((await read(user.page,'/api/audit-logs')).status,403)
   if(role==='staff'){
    const result=await read(user.page,'/api/work-schedules');assert.equal(result.status,200)
    assert.equal(result.body.data.duty.date,clinicDate())
    const branchName=await user.page.locator('.branch-lock b').innerText()
    const expected=result.body.data.duty.rows.filter(row=>row.branch_name===branchName)
    assert(expected.length>0);assert.equal(new Set(expected.map(row=>row.branch_id)).size,1)
    const panel=user.page.locator('.stf07-duty');await panel.getByText(/Clinic date:/).waitFor()
    assert.equal(await panel.locator('li').count(),expected.length)
    for(const row of expected){const item=panel.locator('li').filter({hasText:row.dentist_name});assert.equal(await item.count(),1);await item.getByText(row.on_duty_today?'On duty today':'Off duty',{exact:true}).waitFor();assert(await item.getByText(row.branch_name,{exact:true}).count())}
    results.push({role,auditDenied:true,persistedScopedDutyMatches:true,clinicDate:clinicDate()})
   }else results.push({role,auditDenied:true})
  }finally{await user.context.close()}
 }
 writeFileSync(evidence+'/results.json',JSON.stringify(results,null,2))
 console.log('PASS B05 real Owner record history/date/branch readback, six widths and three non-Owner refusals')
}finally{await browser.close()}

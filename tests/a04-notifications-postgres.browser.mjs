// Actual login, cookie sessions and persisted notifications on an explicitly owned synthetic demo.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
const container=process.env.A04_CONTAINER,targetPath=process.env.A04_TARGET,evidence=process.env.A04_EVIDENCE
assert(container&&targetPath&&evidence&&process.env.PLAYWRIGHT_MODULE)
const readPrivate=path=>execFileSync('docker',['exec',container,'cat',path],{encoding:'utf8'}).trim()
const target=JSON.parse(readPrivate(targetPath))
assert.equal(target.host,'127.0.0.1');assert.equal(target.demo_database,'dental_clinic_demo')
assert.equal(readPrivate(target.runtime+'/synthetic-runtime'),target.cluster_id)
const password=readPrivate(target.runtime+'/demo-login-password')
const fixture=JSON.parse(readPrivate(target.runtime+'/operations-browser-fixture.json'))
const base=process.env.A04_BASE||'http://127.0.0.1:5198',api=process.env.A04_API||'http://127.0.0.1:8124'
for(const origin of [base,api])assert.equal(new URL(origin).hostname,'127.0.0.1')
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const browser=await chromium.launch({headless:true,channel:'chrome'}),results=[]
mkdirSync(evidence,{recursive:true})
async function request(page,path,method='GET'){
 return page.evaluate(async({api,path,method})=>{
  const csrf=decodeURIComponent(document.cookie.split('; ').find(c=>c.startsWith('XSRF-TOKEN='))?.slice(11)||'')
  const response=await fetch(api+path,{method,credentials:'include',headers:{Accept:'application/json','X-XSRF-TOKEN':csrf}})
  return {status:response.status,body:response.status===204?null:await response.json()}
 },{api,path,method})
}
try{
 for(const [role,email] of [['patient','patient@example.test'],['staff','staff.reception@example.test'],['dentist','dentist@example.test'],['owner','owner@example.test']]){
  const context=await browser.newContext({viewport:{width:390,height:900},timezoneId:'America/Los_Angeles'}),page=await context.newPage()
  page.setDefaultTimeout(20000)
  await page.route('**/*',r=>[base,api].includes(new URL(r.request().url()).origin)?r.continue():r.abort())
  try{
   await page.goto(base+'/#sign-in');await page.getByRole('textbox',{name:/email/i}).fill(email)
   await page.locator('input[type=password]').fill(password)
   const login=page.waitForResponse(r=>r.url()===api+'/api/login'&&r.request().method()==='POST')
   await page.getByRole('button',{name:'Sign in',exact:true}).click();assert.equal((await login).status(),200)
   const bell=page.getByRole('button',{name:/^Notifications/}).first();await bell.waitFor()
   const initial=await request(page,'/api/notifications');assert.equal(initial.status,200)
   const id=fixture.notification_ids[role],title='Operations QA archive example '+fixture.run_id
   assert(initial.body.data.some(n=>n.id===id&&!n.read&&!n.archived))
   // Real server commits; only the response is lost. Retry must recover the immutable receipt.
   await page.route(api+'/api/notifications/'+id+'/archive',async route=>{await route.fetch();await route.abort('failed')},{times:1})
   await bell.click();const dialog=page.getByRole('dialog',{name:'Notifications'})
   await dialog.getByRole('button',{name:'Archive '+title,exact:true}).click()
   await dialog.getByRole('button',{name:'Retry archive',exact:true}).click()
   await dialog.getByRole('button',{name:'Archive '+title,exact:true}).waitFor({state:'hidden'})
   const active=await request(page,'/api/notifications');assert.equal(active.body.meta.unread,initial.body.meta.unread-1)
   const archived=await request(page,'/api/notifications?collection=archived')
   const row=archived.body.data.find(n=>n.id===id);assert(row?.archived&&!row.read)
   const repeat=await request(page,'/api/notifications/'+id+'/archive','POST')
   assert.equal(repeat.body.meta.archive_receipt.replayed,true);assert.equal(repeat.body.meta.archive_receipt.archived_at,row.archived_at)
   const foreign=fixture.notification_ids[role==='owner'?'patient':'owner']
   const denied=await request(page,'/api/notifications/'+foreign+'/archive','POST')
   const absent=await request(page,'/api/notifications/01aaaaaaaaaaaaaaaaaaaaaaaa/archive','POST')
   assert.equal(denied.status,404);assert.equal(absent.status,404)
   assert.equal(denied.body.message,absent.body.message)
   await page.reload();await bell.waitFor();await bell.click()
   await dialog.getByRole('button',{name:role==='patient'?'Archived':'Archived notifications',exact:true}).click()
   await dialog.getByText(title,{exact:false}).first().waitFor()
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
   await page.screenshot({path:evidence+'/'+role+'.png',fullPage:true})
   const persisted=await request(page,'/api/notifications?collection=archived')
   assert.equal(persisted.body.data.find(n=>n.id===id)?.archived_at,row.archived_at)
   await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'})
   assert(await bell.evaluate(el=>el===document.activeElement))
   const logout=await request(page,'/api/logout','POST');assert.equal(logout.status,204)
   assert.equal((await request(page,'/api/notifications')).status,401)
   results.push({role,login:true,reloadSession:true,archiveRetry:true,persistedArchive:true,unreadSeparate:true,recipientIsolation:true,logoutRevoked:true})
   console.log('PASS '+role+' real login/reload, lost archive response/retry, persisted history, isolation and logout')
  }finally{await context.close()}
 }
 writeFileSync(evidence+'/results.json',JSON.stringify({synthetic:true,results},null,2))
}finally{await browser.close()}

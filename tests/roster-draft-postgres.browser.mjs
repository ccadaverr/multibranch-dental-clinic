import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
const container='dentalops-joevan-ops-20261115',target='/private/roster-batch4/target.json'
const run=(...args)=>execFileSync('docker',['exec',container,...args],{encoding:'utf8'})
const status=JSON.parse(run('python3','scripts/local-system.py','--target',target,'--profile','demo','status'))
assert.equal(status.classification,'owned isolated development');assert.equal(status.appliedMigrations,85)
const password=run('cat','/private/roster-batch4/demo-login-password').trim() // process memory only
const {chromium}=await import(pathToFileURL(process.argv[2]).href)
const browser=await chromium.launch({channel:'chrome',headless:true})
const api='http://127.0.0.1:8104',frontend='http://127.0.0.1:5195'
const headers=async c=>({'X-XSRF-TOKEN':decodeURIComponent((await c.cookies(api)).find(v=>v.name==='XSRF-TOKEN').value),Origin:frontend,Referer:frontend+'/'})
const read=async(c,path)=>{const r=await c.request.get(api+path,{headers:{Origin:frontend,Referer:frontend+'/'}});assert.equal(r.status(),200);return r.json()}
async function signIn(){
 const c=await browser.newContext({viewport:{width:1440,height:900}})
 await c.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort())
 const p=await c.newPage();await p.goto(frontend+'/#sign-in');await p.locator('.login-button').waitFor()
 await c.request.get(api+'/sanctum/csrf-cookie')
 assert.equal((await c.request.post(api+'/api/login',{headers:await headers(c),data:{email:'owner@example.test',password}})).status(),200)
 await p.reload();await p.getByRole('button',{name:'Work Schedules',exact:true}).first().click()
 await p.getByRole('tab',{name:'Staff schedules',exact:true}).click()
 return {c,p}
}
try{
 const {c,p}=await signIn()
 const before=(await read(c,'/api/staff')).data;assert.equal(Array.isArray(before),true)
 const chooser=p.getByLabel('Staff member',{exact:true});await chooser.waitFor();const staff=await chooser.inputValue()
 await p.getByLabel('Draft date',{exact:true}).fill('2026-11-16')
 await p.getByLabel('Draft start',{exact:true}).fill('10:00');await p.getByLabel('Draft end',{exact:true}).fill('16:00')
 const requests=[];p.on('request',r=>{if(r.method()==='PUT'&&r.url().endsWith('/roster-draft'))requests.push(r.postData())})
 let receipt,drop=true
 await p.route('**/api/staff/*/roster-draft',async route=>{
  if(route.request().method()!=='PUT'||!drop)return route.continue()
  drop=false;const response=await route.fetch();assert.equal(response.status(),200);receipt=await response.json();await route.abort('failed')
 })
 await p.getByRole('button',{name:'Save dated draft',exact:true}).click()
 await p.getByRole('button',{name:'Retry draft save',exact:true}).waitFor()
 assert.equal(await chooser.isDisabled(),true,'Uncertain save must retain Staff context')
 await p.getByRole('button',{name:'Retry draft save',exact:true}).click()
 await p.getByText(/Draft revision \d+ saved\. This is not published duty\./).waitFor()
 assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);assert.equal(receipt.data.published,false)
 await p.getByRole('button',{name:'Show saved draft revisions',exact:true}).click();await p.getByRole('region',{name:'Saved draft revisions'}).waitFor()
 assert.deepEqual((await read(c,'/api/staff')).data,before,'Draft save cannot alter profiles or assignment')
 await c.close()
 const next=await signIn();await next.p.getByLabel('Staff member',{exact:true}).selectOption(staff)
 await next.p.getByLabel('Draft date',{exact:true}).fill('2026-11-16')
 await next.p.waitForFunction(()=>[...document.querySelectorAll('input[type=time]')].some(e=>e.value==='16:00'))
 const saved=await read(next.c,'/api/staff/'+staff+'/roster-draft?date=2026-11-16')
 assert.equal(saved.data.id,receipt.data.id);assert.equal(saved.data.revision,receipt.data.revision);assert.equal(saved.data.published,false)
 await next.c.close()
 console.log(JSON.stringify({postgresBrowser:true,exactLostResponseRecovery:true,staffContextPreserved:true,history:true,newSessionReadback:true,profileUnchanged:true,published:false}))
}finally{await browser.close()}

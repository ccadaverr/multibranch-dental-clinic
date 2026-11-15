import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
const container='dentalops-joevan-ops-20261115',target='/private/leave-batch5/target.json'
const run=(...args)=>execFileSync('docker',['exec',container,...args],{encoding:'utf8'})
const status=JSON.parse(run('python3','scripts/local-system.py','--target',target,'--profile','demo','status'));assert.equal(status.classification,'owned isolated development');assert.equal(status.appliedMigrations,86)
const password=run('cat','/private/leave-batch5/demo-login-password').trim()
const {chromium}=await import(pathToFileURL(process.argv[2]).href),browser=await chromium.launch({channel:'chrome',headless:true})
const api='http://127.0.0.1:8104',frontend='http://127.0.0.1:5195',c=await browser.newContext({viewport:{width:1440,height:900}})
const headers=async()=>({'X-XSRF-TOKEN':decodeURIComponent((await c.cookies(api)).find(v=>v.name==='XSRF-TOKEN').value),Origin:frontend,Referer:frontend+'/'})
const read=async path=>{const r=await c.request.get(api+path,{headers:{Origin:frontend,Referer:frontend+'/'}});assert.equal(r.status(),200);return r.json()}
try{
 await c.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort())
 const p=await c.newPage();p.setDefaultTimeout(15000)
 await p.goto(frontend+'/#sign-in');await p.locator('.login-button').waitFor();await c.request.get(api+'/sanctum/csrf-cookie')
 assert.equal((await c.request.post(api+'/api/login',{headers:await headers(),data:{email:'owner@example.test',password}})).status(),200)
 await p.reload();await p.getByRole('button',{name:'Work Schedules',exact:true}).first().click();await p.getByRole('tab',{name:'Staff schedules',exact:true}).click()
 const chooser=p.getByLabel('Staff member',{exact:true});await chooser.waitFor();const staff=await chooser.inputValue(),before=(await read('/api/staff')).data
 const d=new Date();d.setUTCDate(d.getUTCDate()+1);while(d.getUTCDay()!==1)d.setUTCDate(d.getUTCDate()+1)
 let date
 for(let n=0;n<52;n++){date=d.toISOString().slice(0,10);if((await read('/api/staff/'+staff+'/roster-draft?date='+date)).data===null)break;d.setUTCDate(d.getUTCDate()+7)}
 await p.getByLabel('Draft date',{exact:true}).fill(date);await p.getByLabel('Draft start',{exact:true}).fill('10:00');await p.getByLabel('Draft end',{exact:true}).fill('16:00')
 const branch=await p.getByLabel('Draft branch',{exact:true}).inputValue()
 await p.getByRole('button',{name:'Save dated draft',exact:true}).click();await p.getByText('Draft revision 1 saved. This is not published duty.',{exact:true}).waitFor()
 // Persist more than50 actual immutable revisions; UI must expose the remainder, never silently truncate.
 for(let revision=1;revision<51;revision++){
  const r=await c.request.put(api+'/api/staff/'+staff+'/roster-draft',{headers:await headers(),data:{date,branch_ref:branch,start_time:'10:00',end_time:revision%2?'16:30':'16:00',expected_revision:revision,operation_id:randomUUID()}})
  assert.equal(r.status(),200)
 }
 const collection=p.getByRole('region',{name:'Unpublished Staff drafts by branch and date',exact:true})
 await collection.getByLabel('Roster branch',{exact:true}).selectOption(branch);await collection.getByLabel('Roster date',{exact:true}).fill(date)
 await collection.getByText(/Draft revision 51/).waitFor()
 await collection.getByRole('button',{name:/Review dated draft for/}).focus();await p.keyboard.press('Enter')
 assert.equal(await chooser.inputValue(),staff);assert.equal(await p.getByLabel('Draft date',{exact:true}).inputValue(),date)
 await p.getByRole('button',{name:'Show saved draft revisions',exact:true}).click()
 const history=p.getByRole('region',{name:'Saved draft revisions',exact:true});await history.getByText(/Revision 51 /).waitFor()
 assert.equal(await history.getByRole('listitem').count(),50)
 await p.getByRole('button',{name:'Load older draft revisions',exact:true}).click();await history.getByText(/^Revision 1 /).waitFor()
 assert.equal(await history.getByRole('listitem').count(),51);assert.equal(await p.getByRole('button',{name:'Load older draft revisions',exact:true}).count(),0)
 const next=new Date(date+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1)
 await p.getByLabel('Draft date',{exact:true}).fill(next.toISOString().slice(0,10))
 await collection.getByRole('button',{name:/Review dated draft for/}).click()
 assert.equal(await p.getByLabel('Draft date',{exact:true}).inputValue(),date,'Reviewing the same row again must restore its exact date')
 const other=await collection.getByLabel('Roster branch',{exact:true}).locator('option').evaluateAll(options=>options.map(o=>o.value).find(value=>value&&value!==document.querySelector('select[aria-label="Roster branch"]').value))
 let release,started;const held=new Promise(r=>release=r),began=new Promise(r=>started=r)
 await p.route('**/api/staff-roster-drafts?*',async route=>{if(new URL(route.request().url()).searchParams.get('branch_ref')!==other)return route.continue();const response=await route.fetch();started();await held;await route.fulfill({response})})
 await collection.getByLabel('Roster branch',{exact:true}).selectOption(other);await began
 await collection.getByLabel('Roster branch',{exact:true}).selectOption(branch);await collection.getByText(/Draft revision 51/).waitFor();release();await p.waitForTimeout(150)
 assert.equal(await collection.getByText(/Draft revision 51/).count(),1)
 assert.deepEqual((await read('/api/staff')).data,before)
 assert.equal((await read('/api/staff/'+staff+'/roster-draft?date='+date)).data.published,false)
 for(const width of [375,390,430,768,1024,1440]){await p.setViewportSize({width,height:900});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Draft review fits '+width)}
 console.log(JSON.stringify({postgresBrowser:true,branchDateCollection:true,exactReviewTarget:true,all51RevisionsLoaded:true,obsoleteBranchIgnored:true,profileUnchanged:true,published:false,widths:[375,390,430,768,1024,1440]}))
}finally{await c.close();await browser.close()}

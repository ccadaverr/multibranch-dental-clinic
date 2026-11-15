import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
const container='dentalops-joevan-ops-20261115',target='/private/leave-batch5/target.json'
const run=(...args)=>execFileSync('docker',['exec',container,...args],{encoding:'utf8'})
const status=JSON.parse(run('python3','scripts/local-system.py','--target',target,'--profile','demo','status'))
assert.equal(status.classification,'owned isolated development');assert.equal(status.appliedMigrations,86)
const password=run('cat','/private/leave-batch5/demo-login-password').trim()
const {chromium}=await import(pathToFileURL(process.argv[2]).href),browser=await chromium.launch({channel:'chrome',headless:true})
const api='http://127.0.0.1:8104',frontend='http://127.0.0.1:5195',contexts=[]
const headers=async c=>({'X-XSRF-TOKEN':decodeURIComponent((await c.cookies(api)).find(v=>v.name==='XSRF-TOKEN').value),Origin:frontend,Referer:frontend+'/'})
const read=async(c,path)=>{const r=await c.request.get(api+path,{headers:{Origin:frontend,Referer:frontend+'/'}});assert.equal(r.status(),200);return r.json()}
async function signIn(email,owner=false){
 const c=await browser.newContext({viewport:{width:1440,height:900}});contexts.push(c)
 await c.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort())
 const p=await c.newPage();p.setDefaultTimeout(15000)
 await p.goto(frontend+'/#sign-in');await p.locator('.login-button').waitFor();await c.request.get(api+'/sanctum/csrf-cookie')
 assert.equal((await c.request.post(api+'/api/login',{headers:await headers(c),data:{email,password}})).status(),200)
 await p.reload();await p.getByRole('button',{name:owner?'Leave Requests':'Leave',exact:true}).first().click()
 return {c,p}
}
async function loseResponse(p,pattern){let drop=true;await p.route(pattern,async route=>{if(route.request().method()!=='POST'||!drop)return route.continue();drop=false;const response=await route.fetch();assert.ok([200,201].includes(response.status()));await route.abort('failed')})}
try{
 const staff=await signIn('staff.reception@example.test'),p=staff.p
 const mine=(await read(staff.c,'/api/leave/mine')).data
 let d=new Date();d.setUTCDate(d.getUTCDate()+2);let date
 for(let n=0;n<200;n++){date=d.toISOString().slice(0,10);if(!mine.some(l=>l.starts_at.slice(0,10)<=date&&l.ends_at.slice(0,10)>=date))break;d.setUTCDate(d.getUTCDate()+1)}
 const note='Synthetic leave recovery '+randomUUID(),posts=[]
 p.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/leave')posts.push(r.postData())})
 await p.getByLabel('From',{exact:true}).fill(date);await p.getByLabel('Only part of the day',{exact:true}).check()
 assert.equal(await p.getByLabel('To (last day)',{exact:true}).inputValue(),date)
 await p.getByLabel('From (time on selected date)',{exact:true}).fill('13:00');await p.getByLabel('Until (time on selected date)',{exact:true}).fill('15:00')
 await p.getByLabel(/Private note \(optional\)/).fill(note)
 await loseResponse(p,'**/api/leave');await p.getByRole('button',{name:'Request leave',exact:true}).click()
 await p.getByRole('button',{name:'Retry original leave command',exact:true}).waitFor()
 assert.equal(await p.getByLabel('From',{exact:true}).inputValue(),date)
 assert.equal(await p.getByLabel('From',{exact:true}).isDisabled(),true)
 await p.getByRole('button',{name:'Retry original leave command',exact:true}).focus();await p.keyboard.press('Enter')
 await p.getByText(/Confirmed Pending, revision 1/).waitFor();assert.equal(posts.length,2);assert.equal(posts[0],posts[1])
 const saved=(await read(staff.c,'/api/leave/mine')).data.find(l=>l.private_note===note);assert.ok(saved);assert.equal(saved.starts_at,date+'T13:00:00+08:00')
 const owner=await signIn('owner@example.test',true),row=owner.p.locator('.st-leave').filter({hasText:note}),decisions=[]
 owner.p.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/decide'))decisions.push(JSON.parse(r.postData()))})
 await row.getByRole('button',{name:'Accept leave request',exact:true}).click()
 await loseResponse(owner.p,'**/api/leave/*/decide')
 await owner.p.getByRole('dialog',{name:'Accept leave request?',exact:true}).getByRole('button',{name:'Accept leave request',exact:true}).click()
 await row.getByRole('button',{name:'Retry original leave command',exact:true}).click()
 await owner.p.getByText(/Confirmed Approved, revision 2/).first().waitFor();assert.equal(decisions.length,2);assert.deepEqual(decisions[0],decisions[1])
 // Requester's retained Pending revision must conflict, rather than quietly cancel the newly approved leave.
 const ownRow=p.locator('.fd-list li').filter({hasText:note})
 await ownRow.getByRole('button',{name:'Cancel',exact:true}).click()
 await p.getByRole('alert').filter({hasText:/changed/}).waitFor()
 assert.equal((await read(staff.c,'/api/leave/'+saved.id)).data.status,'Approved')
 await p.getByRole('button',{name:'Refresh My leave',exact:true}).click()
 await ownRow.getByText(/revision 2/).waitFor()
 await loseResponse(p,'**/api/leave/*/cancel');await ownRow.getByRole('button',{name:'Cancel',exact:true}).click()
 await p.getByRole('button',{name:'Retry original leave command',exact:true}).click();await p.getByText(/Confirmed Cancelled, revision 3/).waitFor()
 const replay=await owner.c.request.post(api+'/api/leave/'+saved.id+'/decide',{headers:await headers(owner.c),data:decisions[0]})
 assert.equal(replay.status(),200);const old=await replay.json();assert.equal(old.meta.replayed,true);assert.equal(old.data.status,'Approved');assert.equal(old.data.revision,2)
 const fresh=await signIn('owner@example.test',true),current=(await read(fresh.c,'/api/leave/'+saved.id)).data
 assert.equal(current.status,'Cancelled');assert.equal(current.revision,3)
 let release,started
 const delayed=new Promise(r=>started=r),hold=new Promise(r=>release=r)
 await fresh.p.route('**/api/leave?*',async route=>{
  if(new URL(route.request().url()).searchParams.get('status')!=='Approved')return route.continue()
  const response=await route.fetch();started();await hold;await route.fulfill({response})
 })
 await fresh.p.getByLabel('Leave status',{exact:true}).selectOption('Approved');await delayed
 await fresh.p.getByLabel('Leave status',{exact:true}).selectOption('Cancelled')
 await fresh.p.locator('.st-leave').filter({hasText:note}).waitFor();release()
 await fresh.p.waitForTimeout(200)
 assert.equal(await fresh.p.locator('.st-leave').filter({hasText:note}).count(),1,'Obsolete Approved response cannot replace Cancelled results')
 await fresh.p.unroute('**/api/leave?*')
 await fresh.p.route('**/api/leave?*',route=>route.abort('failed'),{times:1})
 await fresh.p.getByRole('button',{name:'Refresh leave requests',exact:true}).click()
 await fresh.p.getByRole('alert').filter({hasText:'Leave requests could not be loaded.'}).waitFor()
 await fresh.p.getByRole('button',{name:'Refresh leave requests',exact:true}).click()
 await fresh.p.locator('.st-leave').filter({hasText:note}).waitFor()
 for(const width of [375,390,430,768,1024,1440]){await p.setViewportSize({width,height:900});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Leave recovery fits '+width)}
 console.log(JSON.stringify({postgresBrowser:true,partialDay:true,createReplay:true,decisionReplay:true,cancellationReplay:true,staleRevisionPreserved:true,explicitReview:true,newSessionReadback:true,obsoleteFilterIgnored:true,failedListRecovered:true,keyboard:true,widths:[375,390,430,768,1024,1440]}))
}finally{for(const c of contexts)await c.close();await browser.close()}

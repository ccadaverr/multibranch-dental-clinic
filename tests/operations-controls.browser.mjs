import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'

// Explicit owned synthetic runtime only. No fixture mutation, external traffic, screenshots or credentials in output.
const container='dentalops-joevan-ops-20261115',target='/private/leave-batch5/target.json'
const run=(...args)=>execFileSync('docker',['exec',container,...args],{encoding:'utf8'})
assert.equal(JSON.parse(run('python3','scripts/local-system.py','--target',target,'--profile','demo','status')).classification,'owned isolated development')
const password=run('cat','/private/leave-batch5/demo-login-password').trim()
const {chromium}=await import(pathToFileURL(process.argv[2]).href)
const browser=await chromium.launch({channel:'chrome',headless:true}),api='http://127.0.0.1:8104',base='http://127.0.0.1:5195'
const context=await browser.newContext({viewport:{width:1440,height:1000}})
try {
 await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
 const p=await context.newPage(),errors=[];p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message))
 await p.goto(base+'/#sign-in');await p.locator('.login-button').waitFor();await context.request.get(api+'/sanctum/csrf-cookie')
 const headers={Origin:base,Referer:base+'/','X-XSRF-TOKEN':decodeURIComponent((await context.cookies(api)).find(c=>c.name==='XSRF-TOKEN').value)}
 assert.equal((await context.request.post(api+'/api/login',{headers,data:{email:'owner@example.test',password}})).status(),200)
 await p.reload();await p.getByRole('heading',{name:'Executive dashboard',exact:true}).waitFor()
 const widths=[375,390,430,768,1024,1440]
 async function responsive(button) {
  for(const width of widths){await p.setViewportSize({width,height:1000});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No page overflow at '+width);if(button){const box=await button.boundingBox();assert.ok(box.width>=44&&box.height>=44,'Reachable refresh target')}}
  await p.setViewportSize({width:1440,height:1000})
 }
 async function refresh(nav,label,endpoint) {
  await p.getByRole('button',{name:nav,exact:true}).click()
  const button=p.getByRole('button',{name:label,exact:true});await button.waitFor();await p.waitForFunction(label=>!document.querySelector(`[aria-label="${label}"]`)?.disabled,label)
  assert.equal(await button.innerText(),'');assert.equal(await button.getAttribute('title'),label)
  let release,started,calls=0;const held=new Promise(r=>release=r),began=new Promise(r=>started=r)
  const handler=async route=>{if(new URL(route.request().url()).pathname!==endpoint)return route.continue();calls++;const response=await route.fetch();started();await held;await route.fulfill({response})}
  await p.route('**/api/**',handler)
  await button.focus();await p.keyboard.press('Enter');await Promise.race([began,new Promise((_,reject)=>setTimeout(()=>reject(Error('Refresh did not reach '+endpoint)),12000))])
  assert.equal(await button.isDisabled(),true);assert.equal(await button.getAttribute('aria-busy'),'true');assert.match(await button.getAttribute('class'),/is-spinning/)
  await button.evaluate(b=>{b.dispatchEvent(new MouseEvent('click',{bubbles:true}));b.dispatchEvent(new MouseEvent('click',{bubbles:true}))})
  await p.waitForTimeout(100);assert.equal(calls,1,'Pending refresh cannot start duplicate reads')
  release();await p.waitForFunction(label=>document.querySelector(`[aria-label="${label}"]`)?.getAttribute('aria-busy')==='false',label)
  await p.unroute('**/api/**',handler);await responsive(button)
 }
 await refresh('Dentist & Staff','Refresh duty','/api/work-schedules')
 await refresh('Leave Requests','Refresh leave requests','/api/leave')

 await p.getByRole('button',{name:'Audit Trail',exact:true}).click()
 const clear=p.getByRole('button',{name:'Clear filters',exact:true})
 assert.equal(await clear.count(),0,'Default audit filters must not show clear')
 const action=p.getByLabel('Operational activity',{exact:true})
 await action.selectOption('notification.archived');await clear.waitFor()
 await p.getByLabel('Category',{exact:true}).selectOption('administrative')
 await p.getByLabel('Severity',{exact:true}).selectOption('warning')
 const branch=p.getByLabel('Branch',{exact:true});await branch.selectOption(await branch.locator('option').nth(1).getAttribute('value'))
 await p.getByPlaceholder('Action, actor, target ID, IP…').fill('synthetic')
 await p.getByLabel('From:',{exact:true}).fill('2026-01-01');await p.getByLabel('To:',{exact:true}).fill('2026-12-31')
 const response=p.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==='/api/audit-logs'&&u.searchParams.get('per_page')==='50'&&!['action','search','category','severity','branch_id','date_from','date_to'].some(k=>u.searchParams.has(k))})
 await clear.focus();await p.keyboard.press('Enter');assert.equal((await response).status(),200)
 assert.equal(await action.inputValue(),'');assert.equal(await p.getByLabel('Category',{exact:true}).inputValue(),'all');assert.equal(await p.getByLabel('Severity',{exact:true}).inputValue(),'all')
 assert.equal(await branch.inputValue(),'')
 assert.equal(await p.getByLabel('From:',{exact:true}).inputValue(),'');assert.equal(await p.getByLabel('To:',{exact:true}).inputValue(),'');assert.equal(await p.getByPlaceholder('Action, actor, target ID, IP…').inputValue(),'');assert.equal(await clear.count(),0)
 await responsive()
 await p.getByRole('button',{name:'User Management',exact:true}).click()
 assert.equal(await clear.count(),0)
 const search=p.getByPlaceholder('Search accounts by name, email, or phone…')
 const accounts=p.locator('.card').filter({has:p.getByRole('heading',{name:'User accounts',exact:true})})
 await search.fill('owner');await accounts.getByLabel('Role',{exact:true}).selectOption('owner')
 await clear.focus();await p.keyboard.press('Enter');assert.equal(await search.inputValue(),'');assert.equal(await accounts.getByLabel('Role',{exact:true}).inputValue(),'all');assert.equal(await clear.count(),0)
 await responsive();assert.deepEqual(errors,[])
 console.log(JSON.stringify({qa:['GEN-02','GEN-13'],scope:'Owner personnel, leave review, Audit Trail and Access & Roles',livePrivateAPI:true,iconRefresh:true,keyboard:true,busySingleFlight:true,allAuditFiltersReset:true,accountFiltersReset:true,clearOnlyWhenActive:true,widths}))
} finally {await context.close();await browser.close()}

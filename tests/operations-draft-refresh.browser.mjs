import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'

// Read-only acceptance on the existing, identity-verified private demo profile.
const container='dentalops-joevan-ops-20261115',target='/private/leave-batch5/target.json'
const run=(...args)=>execFileSync('docker',['exec',container,...args],{encoding:'utf8'})
assert.equal(JSON.parse(run('python3','scripts/local-system.py','--target',target,'--profile','demo','status')).classification,'owned isolated development')
const password=run('cat','/private/leave-batch5/demo-login-password').trim()
const {chromium}=await import(pathToFileURL(process.argv[2]).href)
const browser=await chromium.launch({channel:'chrome',headless:true})
const api='http://127.0.0.1:8104',base='http://127.0.0.1:5195'
const context=await browser.newContext({viewport:{width:1440,height:1000}})
try {
  await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
  const p=await context.newPage(),errors=[];p.setDefaultTimeout(15000)
  p.on('pageerror',e=>errors.push(e.message))
  await p.goto(base+'/#sign-in');await p.locator('.login-button').waitFor()
  await context.request.get(api+'/sanctum/csrf-cookie')
  const headers={Origin:base,Referer:base+'/','X-XSRF-TOKEN':decodeURIComponent((await context.cookies(api)).find(c=>c.name==='XSRF-TOKEN').value)}
  assert.equal((await context.request.post(api+'/api/login',{headers,data:{email:'owner@example.test',password}})).status(),200)
  await p.reload()
  await p.getByRole('button',{name:'Work Schedules',exact:true}).first().click()
  await p.getByRole('tab',{name:'Staff schedules',exact:true}).click()
  await p.getByLabel('Staff member',{exact:true}).waitFor()
  const widths=[375,390,430,768,1024,1440]
  for(const [label,matches] of [
    ['Reload unpublished drafts',url=>url.pathname==='/api/staff-roster-drafts'],
    ['Reload dated draft',url=>/^\/api\/staff\/[^/]+\/roster-draft$/.test(url.pathname)],
  ]) {
    const button=p.getByRole('button',{name:label,exact:true})
    await p.waitForFunction(label=>document.querySelector(`[aria-label="${label}"]`)?.disabled===false,label)
    assert.equal(await button.innerText(),'');assert.equal(await button.getAttribute('title'),label)
    let release,started,calls=0,before,after
    const held=new Promise(r=>release=r),began=new Promise(r=>started=r)
    const handler=async route=>{
      if(!matches(new URL(route.request().url())))return route.continue()
      calls++;const response=await route.fetch();assert.equal(response.status(),200)
      before=await response.json();started();await held;await route.fulfill({response})
    }
    await p.route('**/api/**',handler)
    await button.focus();await p.keyboard.press('Enter')
    await Promise.race([began,new Promise((_,reject)=>setTimeout(()=>reject(Error('No refresh request: '+label)),12000))])
    assert.equal(await button.isDisabled(),true)
    assert.equal(await button.getAttribute('aria-busy'),'true')
    assert.match(await button.getAttribute('class'),/is-spinning/)
    await button.evaluate(b=>{b.dispatchEvent(new MouseEvent('click',{bubbles:true}));b.dispatchEvent(new MouseEvent('click',{bubbles:true}))})
    await p.waitForTimeout(100);assert.equal(calls,1,'One pending refresh per control')
    release()
    await p.waitForFunction(label=>document.querySelector(`[aria-label="${label}"]`)?.getAttribute('aria-busy')==='false',label)
    await p.unroute('**/api/**',handler)
    // Failed reads report the error and permit an explicit retry of the same read.
    const failure=route=>matches(new URL(route.request().url()))?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic read failure'})}):route.continue()
    await p.route('**/api/**',failure)
    await button.click();await p.getByRole('alert').filter({hasText:'Synthetic read failure'}).waitFor()
    await p.waitForFunction(label=>document.querySelector(`[aria-label="${label}"]`)?.disabled===false,label)
    await p.unroute('**/api/**',failure)
    const retry=async route=>{
      if(!matches(new URL(route.request().url())))return route.continue()
      const response=await route.fetch();assert.equal(response.status(),200);after=await response.json();await route.fulfill({response})
    }
    await p.route('**/api/**',retry)
    await button.click()
    await p.waitForFunction(label=>document.querySelector(`[aria-label="${label}"]`)?.disabled===false,label)
    assert.deepEqual(after,before,'Refresh/retry preserves authoritative draft state')
    assert.equal(await p.getByRole('alert').count(),0)
    await p.unroute('**/api/**',retry)
    for(const width of widths){
      await p.setViewportSize({width,height:1000})
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No overflow at '+width)
      const box=await button.boundingBox();assert.ok(box.width>=44&&box.height>=44)
    }
    await p.setViewportSize({width:1440,height:1000})
  }
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({qa:'GEN-13',livePrivateAPI:true,controls:2,keyboard:true,busySingleFlight:true,errorRetry:true,unchangedReadback:true,widths}))
} finally {await context.close();await browser.close()}

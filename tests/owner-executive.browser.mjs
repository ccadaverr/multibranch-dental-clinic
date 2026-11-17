import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {exactPeso} from '../src/owner-revenue-data.js'
const container=process.env.LOCAL_SYSTEM_CONTAINER||'dentalops-joevan-ops-20261115',target=process.env.LOCAL_SYSTEM_TARGET||'/private/leave-batch5/target.json'
const run=(...args)=>execFileSync('docker',['exec',container,...args],{encoding:'utf8'})
const status=JSON.parse(run('python3','scripts/local-system.py','--target',target,'--profile','test','status'));assert.equal(status.classification,'owned isolated development')
const manifest=JSON.parse(run('cat',target))
const evidence=JSON.parse(run('cat',manifest.runtime+'/owner-dashboard-evidence.json'))
const {chromium}=await import(pathToFileURL(process.argv[2]).href),browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const c=await browser.newContext({viewport:{width:1440,height:1000}})
 await c.addInitScript(value=>{window.ownerEvidence=value},evidence)
 await c.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
 const p=await c.newPage();p.setDefaultTimeout(12000)
 const requests=[],errors=[];const releases=[];let mode='normal',heldBranch=null,started,runtimeDate=evidence.date
 p.on('pageerror',e=>errors.push(e.message))
 await p.route('**/api/analytics/**',async route=>{
  const url=new URL(route.request().url());requests.push(url)
  const branch=url.searchParams.get('branch_id'),key=evidence.branches.find(b=>b.publicId===branch)?.id||'all'
  const weekly=url.pathname.endsWith('/weekly-histogram')
  if(branch&&branch===heldBranch)await new Promise(resolve=>{releases.push(resolve);started?.()})
  if(mode==='error'||runtimeDate!==evidence.date)return route.fulfill({status:503,json:{message:'Unavailable in this acceptance window'}})
  const scope=mode==='wrong-scope'?'b2':key
  const data=weekly?evidence.reports[scope].weekly:evidence.reports[scope].daily[url.searchParams.get('period')||'week']
  return route.fulfill({status:200,json:{data}})
 })
 await p.goto((process.env.LOCAL_SYSTEM_BASE||'http://127.0.0.1:5195')+'/tests/fixtures/owner-executive.html')
 const charts=p.getByRole('region',{name:/Revenue analytics:/}),daily=charts.locator('.card').filter({has:p.getByRole('heading',{name:'Daily revenue',exact:true})}),weekly=charts.locator('.card').filter({has:p.getByRole('heading',{name:'Monday–Saturday revenue summary',exact:true})})
 await daily.locator('svg.owner-revenue-plot').waitFor();await weekly.locator('svg.owner-revenue-plot').waitFor()
 const beforeAmbiguity=requests.length
 await p.evaluate(()=>window.executive.setAmbiguous(true))
 await p.getByText('Select an available branch to view this dashboard.',{exact:true}).waitFor()
 assert.equal(requests.length,beforeAmbiguity,'Ambiguous branch names must not send a financial read for the first match')
 await p.evaluate(()=>window.executive.setAmbiguous(false));await daily.locator('svg.owner-revenue-plot').waitFor()
 assert.equal(await p.getByText('Recorded demo transactions',{exact:true}).count(),0)
 for(const card of [daily,weekly]){
  await card.getByRole('button',{name:/2026-09-28\. Gross collections/}).locator('.owner-revenue-hit').first().hover()
  const tooltip=card.getByRole('tooltip');await tooltip.waitFor()
  for(const field of ['gross_collected_php','refunded_php','net_cash_flow_php'])assert.equal((await tooltip.innerText()).includes(exactPeso(evidence.reports.all.weekly.buckets[0][field])),true)
  await card.getByRole('button',{name:/2026-09-30\. Gross collections/}).focus()
  assert.equal((await card.getByRole('tooltip').innerText()).includes('-₱750.25'),true)
  await p.keyboard.press('Escape');assert.equal(await card.getByRole('tooltip').count(),0)
 }
 await p.getByLabel('Revenue chart period',{exact:true}).selectOption('month')
 await daily.getByText('No payments or refunds',{exact:true}).waitFor()
 assert.equal(requests.some(u=>u.searchParams.get('period')==='month'),true)
 await p.getByLabel('Revenue chart period',{exact:true}).selectOption('week');await daily.locator('svg.owner-revenue-plot').waitFor()
 let began=new Promise(r=>started=r);heldBranch=evidence.branches[0].publicId
 await p.evaluate(name=>window.executive.setBranch(name),evidence.branches[0].name);await began
 await p.evaluate(name=>window.executive.setBranch(name),evidence.branches[1].name)
 await daily.getByText('₱2,000.00',{exact:true}).first().waitFor()
 heldBranch=null;releases.splice(0).forEach(resolve=>resolve());await p.waitForTimeout(150)
 assert.equal((await charts.innerText()).includes('₱6,000.00'),false,'Old branch figures cannot replace the selected branch')
 mode='wrong-scope';await p.evaluate(name=>window.executive.setBranch(name),evidence.branches[0].name)
 await daily.getByText('Revenue unavailable',{exact:true}).waitFor();assert.equal(await daily.locator('svg.owner-revenue-plot').count(),0)
 mode='normal';await daily.getByRole('button',{name:'Retry revenue',exact:true}).click();await daily.locator('svg.owner-revenue-plot').waitFor()
 mode='error';await p.getByLabel('Revenue chart period',{exact:true}).selectOption('year');await daily.getByText('Revenue unavailable',{exact:true}).waitFor()
 mode='normal';await daily.getByRole('button',{name:'Retry revenue',exact:true}).click();await daily.locator('svg.owner-revenue-plot').waitFor()
 for(const width of [375,390,430,768,1024,1440]){await p.setViewportSize({width,height:1000});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Executive charts fit '+width)}
 runtimeDate='2026-10-07';await p.evaluate(date=>window.executive.setDate(date),runtimeDate)
 assert.equal(await p.getByRole('heading',{name:'Monday–Saturday revenue summary',exact:true}).count(),0)
 runtimeDate='2026-10-10';await p.evaluate(date=>window.executive.setDate(date),runtimeDate)
 await p.getByRole('heading',{name:'Monday–Saturday revenue summary',exact:true}).waitFor()
 await p.waitForFunction(()=>document.querySelectorAll('.owner-revenue .notice').length>0)
 assert.equal(requests.some(u=>u.pathname.endsWith('/weekly-histogram')&&u.searchParams.get('date')==='2026-10-10'),true,'A newly reached Saturday must request its own week')
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({qa:'OWN-01',source:'captured PostgreSQL aggregate API responses, synthetic billing fixture rolled back',hoverExact:true,keyboardExact:true,negativeRefundDay:true,branchSwitch:true,scopeMismatchRefused:true,periodEmptyAndFailureRecovery:true,saturdayOnly:true,newSaturdayContext:true,widths:[375,390,430,768,1024,1440]}))
 await c.close()
}finally{await browser.close()}

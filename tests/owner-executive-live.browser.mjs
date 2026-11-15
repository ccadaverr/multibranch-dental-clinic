import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {exactPeso} from '../src/owner-revenue-data.js'
const container='dentalops-joevan-ops-20261115',target='/private/leave-batch5/target.json'
const run=(...args)=>execFileSync('docker',['exec',container,...args],{encoding:'utf8'})
const status=JSON.parse(run('python3','scripts/local-system.py','--target',target,'--profile','demo','status'));assert.equal(status.classification,'owned isolated development')
const password=run('cat','/private/leave-batch5/demo-login-password').trim()
const {chromium}=await import(pathToFileURL(process.argv[2]).href),browser=await chromium.launch({channel:'chrome',headless:true})
const api='http://127.0.0.1:8104',frontend='http://127.0.0.1:5195',c=await browser.newContext({viewport:{width:1440,height:1000}})
try{
 await c.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
 const p=await c.newPage();p.setDefaultTimeout(15000)
 await p.goto(frontend+'/#sign-in');await p.locator('.login-button').waitFor();await c.request.get(api+'/sanctum/csrf-cookie')
 const headers={'X-XSRF-TOKEN':decodeURIComponent((await c.cookies(api)).find(v=>v.name==='XSRF-TOKEN').value),Origin:frontend,Referer:frontend+'/'}
 assert.equal((await c.request.post(api+'/api/login',{headers,data:{email:'owner@example.test',password}})).status(),200)
 await p.reload();await p.getByRole('heading',{name:'Executive dashboard',exact:true}).waitFor()
 await p.locator('.owner-revenue svg.owner-revenue-plot').first().waitFor()
 const branches=await (await c.request.get(api+'/api/branches',{headers})).json()
 const branch=branches.data[0]
 await p.locator('.branch-scope select').selectOption({label:branch.name})
 const dataResponse=await c.request.get(api+'/api/analytics/daily-revenue?period=week&branch_id='+branch.public_id,{headers})
 assert.equal(dataResponse.status(),200);const report=(await dataResponse.json()).data
 const gross=p.locator('.owner-revenue .card').first().locator('.owner-revenue-totals').first().locator('div').filter({has:p.getByText('Gross collections',{exact:true})}).locator('dd')
 await p.waitForFunction(value=>document.querySelector('.owner-revenue .owner-revenue-totals dd')?.textContent===value,exactPeso(report.totals.gross_collected_php))
 assert.equal(await gross.innerText(),exactPeso(report.totals.gross_collected_php))
 assert.equal(await p.getByText('Recorded demo transactions',{exact:true}).count(),0)
 const saturday=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',weekday:'short'}).format(new Date())==='Sat'
 assert.equal(await p.getByRole('heading',{name:'Monday–Saturday revenue summary',exact:true}).count(),saturday?1:0)
 for(const width of [375,390,430,768,1024,1440]){await p.setViewportSize({width,height:1000});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Live Owner dashboard fits '+width)}
 console.log(JSON.stringify({liveOwnerLogin:true,actualDashboardEntry:true,branchScopeMatchesAPI:true,exactGrossMatchesAPI:true,saturdayGateMatchesManila:true,noDemoRevenueFallback:true,syntheticPrivateDatabase:true,widths:[375,390,430,768,1024,1440]}))
}finally{await c.close();await browser.close()}

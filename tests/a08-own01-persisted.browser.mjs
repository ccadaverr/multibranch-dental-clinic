import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {exactPeso} from '../src/owner-revenue-data.js'
const container=process.env.LOCAL_SYSTEM_CONTAINER,target=process.env.LOCAL_SYSTEM_TARGET,base=process.env.LOCAL_SYSTEM_BASE
assert.ok(container&&target&&base)
const read=path=>execFileSync('docker',['exec',container,'cat',path],{encoding:'utf8'})
const manifest=JSON.parse(read(target)),data=JSON.parse(read(manifest.runtime+'/own01-combined-evidence.json'))
assert.equal(data.reports.all.weekly.totals.net_cash_flow_php,'116.38')
assert.equal(data.reports.all.sundayDaily.totals.net_cash_flow_php,'37.03')
const {chromium}=await import(pathToFileURL(process.argv[2]).href),browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(value=>{window.ownerEvidence=value},data)
 await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort())
 await page.route('**/api/analytics/**',route=>{
  const u=new URL(route.request().url()),branch=data.branches.find(b=>b.publicId===u.searchParams.get('branch_id'))?.id||'all'
  const sunday=(u.searchParams.get('date')||u.searchParams.get('date_to'))===data.sunday
  const report=data.reports[branch][u.pathname.endsWith('/weekly-histogram')?(sunday?'finalWeekly':'weekly'):(sunday?'sundayDaily':'daily')]
  return route.fulfill({status:200,json:{data:report}})
 })
 for(const width of [375,390,430,768,1024,1440]){
  await page.setViewportSize({width,height:1000});await page.goto(base+'/tests/fixtures/a08-own01.html')
  const cards=page.locator('.owner-revenue .card'),daily=cards.first(),weekly=cards.last()
  await daily.locator('svg').waitFor();await weekly.locator('svg').waitFor()
  await page.getByText('Saturday summary — in progress until the reporting day ends.',{exact:true}).waitFor()
  for(const card of [daily,weekly]){
   const point=card.getByRole('button',{name:/^2026-10-31\. Gross collections/})
   await point.locator('.owner-revenue-hit').first().hover()
   const text=await card.getByRole('tooltip').innerText()
   for(const field of ['gross_collected_php','refunded_php','net_cash_flow_php'])assert.ok(text.includes(exactPeso(data.reports.all.weekly.totals[field])))
   await point.focus();await page.keyboard.press('Escape');assert.equal(await card.getByRole('tooltip').count(),0)
   await point.focus();await page.keyboard.press('Enter');await card.getByRole('tooltip').waitFor()
  }
  await page.evaluate(day=>window.reports.setDay(day),data.sunday)
  await daily.getByText('₱37.03',{exact:true}).first().waitFor();await weekly.getByText('Week finalized — Saturday has passed.',{exact:true}).waitFor()
  await weekly.getByText('₱116.38',{exact:true}).first().waitFor()
  for(const b of data.branches){
   await page.evaluate(({day,branch})=>{window.reports.setDay(day);window.reports.setBranch(branch)},{day:data.saturday,branch:b.id})
   await daily.getByText(exactPeso(data.reports[b.id].weekly.totals.net_cash_flow_php),{exact:true}).first().waitFor()
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  console.log('PASS '+width+'px: persisted Saturday 116.38 and Sunday 37.03, exact daily/histogram hover and keyboard, both branch scopes, Saturday progress and Sunday finalization')
 }
 assert.deepEqual(errors,[])
}finally{await browser.close()}

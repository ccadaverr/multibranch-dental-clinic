import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {browser,login,get,api,target,evidence} from './local-visit-support.mjs'
const [own,other]=JSON.parse(readFileSync(target.runtime+'/batch07-message-fixture.json','utf8'))
const results=[],ok=name=>{results.push(name);console.log('PASS',name)}
let activePage
try{
 const {page}=await login('sprint02.staff@example.test')
 activePage=page
 await page.getByRole('button',{name:'Messages',exact:true}).click()
 const search=page.getByRole('searchbox',{name:'Search messages or contacts',exact:true})
 await search.fill(own.code)
 const row=page.locator('.chat-row').filter({hasText:own.code})
 await row.waitFor();await row.locator('mark').first().waitFor()
 await row.click()
 await page.locator('.chat-bubble').first().waitFor()
 await search.fill('Needle%_')
 await page.locator('.chat-search-results .chat-bubble mark').first().waitFor()
 assert.equal(await page.locator('.chat-search-results .chat-bubble img').count(),0)
 assert.ok((await page.locator('.chat-search-results .chat-bubble').allTextContents()).some(s=>s.includes('<img src=x onerror=alert(1)>')))
 ok('Authorized contact and literal encrypted-body search highlights without HTML execution')
 await page.getByRole('button',{name:'Older matches',exact:true}).click()
 await page.waitForFunction(()=>document.querySelectorAll('.chat-search-results .chat-bubble').length===60)
 await page.getByRole('button',{name:'Older matches',exact:true}).click()
 await page.getByText('Needle%_ <img src=x onerror=alert(1)> 0',{exact:true}).waitFor()
 ok('Older matches recover history beyond the newest message page')
 await search.fill('ImpossibleBatch07NoMatch')
 await page.getByText('No matching messages or contacts',{exact:true}).waitFor()
 ok('Empty search result is explicit')
 await search.fill('Needle%_')
 await page.locator('.chat-search-results .chat-bubble').first().waitFor()
 const bad='**/api/conversations/'+own.id+'/messages?*'
 let corrupted=false
 const mismatch=async route=>{
  if(!new URL(route.request().url()).searchParams.has('q'))return route.continue()
  const response=await route.fetch(),body=await response.json()
  body.meta.context.patient_id=other.patientId;corrupted=true
  await route.fulfill({response,body:JSON.stringify(body)})
 }
 await page.route(bad,mismatch)
 await search.fill('Needle')
 await page.getByText('The returned messages did not confirm the selected conversation and Patient. No messages were adopted.',{exact:false}).waitFor()
 assert.equal(corrupted,true)
 assert.equal(await page.locator('.chat-search-results .chat-bubble').count(),0)
 await page.unroute(bad,mismatch)
 await page.getByRole('button',{name:'Retry search',exact:true}).last().click()
 await page.locator('.chat-search-results .chat-bubble').first().waitFor()
 ok('Wrong-Patient read context is rejected and explicit retry recovers the authorized result')
 let release,held=false
 const delayed=async route=>{
  if(new URL(route.request().url()).searchParams.get('q')!=='Needle%_')return route.continue()
  const response=await route.fetch();held=true
  await new Promise(r=>{release=r})
  await route.fulfill({response})
 }
 await page.route(bad,delayed);await search.fill('Needle%_')
 for(let i=0;i<100&&!held;i++)await page.waitForTimeout(50)
 assert.equal(held,true)
 await search.fill(other.code);await page.locator('.chat-row').filter({hasText:other.code}).click()
 release();await page.unroute(bad,delayed)
 await search.fill('Foreign separate history');await page.locator('.chat-search-results .chat-bubble').first().waitFor()
 assert.ok((await page.locator('.chat-search-results .chat-bubble').allTextContents()).every(text=>!text.includes('Needle')))
 ok('Delayed results cannot cross selected Patient or query lifetimes')
 for(const width of [375,390,430,768,1024,1440]){
  await page.setViewportSize({width,height:1000})
  const back=page.getByRole('button',{name:'Back to conversations',exact:true})
  if(await back.isVisible())await back.click()
  await search.focus();assert.equal(await search.evaluate(el=>el===document.activeElement),true)
  await page.locator('.chat-row').filter({hasText:other.code}).click()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Messages overflow at '+width)
  await page.screenshot({path:evidence+'/message-search-'+width+'.png',fullPage:true})
 }
 ok('Message thread and search remain usable at all six responsive widths')
 await page.context().close();activePage=null
 for(const email of ['sprint02.dentist@example.test','sprint02.patient@example.test']){
  console.log('VERIFY synthetic role search',email)
  const {page:p}=await login(email)
  activePage=p
  await p.getByRole('button',{name:'Messages',exact:true}).click()
  await p.getByRole('searchbox',{name:'Search messages or contacts',exact:true}).fill('Needle%_')
  await p.locator('.chat-row').filter({hasText:'Synthetic Batch07 search history 0'}).click();await p.locator('.chat-search-results .chat-bubble mark').first().waitFor()
  await p.context().close();activePage=null
 }
 ok('Dentist and Patient use the same authorized exact-context search')
 const {page:foreign}=await login('patient@example.test')
 assert.equal((await get(foreign,'/api/conversations/'+own.id+'/messages?q=Needle')).status,403)
 ok('Foreign Patient cannot read the conversation')
 writeFileSync(evidence+'/message-search-results.json',JSON.stringify({results,conversation:own.id},null,2),{mode:0o600})
}catch(error){if(activePage)writeFileSync(evidence+'/message-search-failure.txt',await activePage.locator('body').innerText(),{mode:0o600});throw error}finally{await browser.close()}

// OWN-04: actual seeded PostgreSQL branch identities, Owner writes/recovery and six-width presentation.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
const container=process.env.S03_CONTAINER,manifest=process.env.S03_TARGET,evidence=process.env.S03_EVIDENCE
assert(container&&manifest&&evidence&&process.env.PLAYWRIGHT_MODULE)
const target=JSON.parse(execFileSync('docker',['exec',container,'cat',manifest],{encoding:'utf8'}))
assert.equal(target.host,'127.0.0.1');assert.equal(target.demo_database,'dental_clinic_demo')
assert.equal(execFileSync('docker',['exec',container,'cat',target.runtime+'/synthetic-runtime'],{encoding:'utf8'}).trim(),target.cluster_id)
const password=execFileSync('docker',['exec',container,'cat',target.runtime+'/demo-login-password'],{encoding:'utf8'}).trim()
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const browser=await chromium.launch({headless:true,channel:'chrome'}),base='http://127.0.0.1:5198',api='http://127.0.0.1:8124'
mkdirSync(evidence,{recursive:true});const checks=[],errors=[];let page
async function login(email){
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage()
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>[base,api].includes(new URL(r.request().url()).origin)?r.continue():r.abort())
 await page.goto(base+'/#sign-in');await page.getByRole('textbox',{name:/email/i}).fill(email)
 await page.locator('input[type=password]').fill(password)
 const response=page.waitForResponse(r=>r.url()===api+'/api/login'&&r.request().method()==='POST')
 await page.getByRole('button',{name:'Sign in',exact:true}).click();assert.equal((await response).status(),200)
 if(email==='patient@example.test')await page.locator('.pp-shell').waitFor()
 else await page.getByRole('button',{name:'Sign out',exact:true}).waitFor()
 return {context,page}
}
async function read(page){return page.evaluate(async api=>{const r=await fetch(api+'/api/branches',{credentials:'include',headers:{Accept:'application/json'}});return {status:r.status,data:(await r.json()).data}},api)}
try{
 const owner=await login('owner@example.test');page=owner.page
 const before=await read(page);assert.equal(before.status,200);assert.equal(before.data.length,3)
 await page.getByRole('button',{name:'Branches',exact:true}).first().click()
 const cards=page.locator('.branch-overview-card');await cards.first().waitFor();assert.equal(await cards.count(),before.data.length)
 for(const width of [375,390,430,768,1024,1440]){
  await page.setViewportSize({width,height:1000})
  for(let i=0;i<before.data.length;i++){
   const card=cards.filter({hasText:before.data[i].name});await card.scrollIntoViewIfNeeded()
   const button=card.getByRole('button',{name:/Configur/});await button.focus();await page.keyboard.press('Enter')
   assert.equal(await button.getAttribute('aria-pressed'),'true')
   assert(await card.evaluate(n=>n.contains(document.activeElement)))
   await card.hover()
   const styles=await card.evaluate(n=>{
    const s=getComputedStyle(n),badge=n.querySelector('.branch-code-badge'),b=getComputedStyle(badge),button=n.querySelector('button'),a=getComputedStyle(button),status=n.querySelector('.status')
    const rgb=color=>color.match(/[\d.]+/g).map(Number).slice(0,3)
    const lum=color=>rgb(color).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0)
    const ratio=(fg,bg)=>(Math.max(lum(fg),lum(bg))+.05)/(Math.min(lum(fg),lum(bg))+.05)
    return {background:s.backgroundColor,border:s.borderColor,badgeBackground:b.backgroundColor,badgeColor:b.color,
     actionBackground:a.backgroundColor,actionColor:a.color,actionHeight:button.getBoundingClientRect().height,
     badgeContrast:ratio(b.color,b.backgroundColor),actionContrast:ratio(a.color,a.backgroundColor),
     statusContrast:ratio(getComputedStyle(status).color,getComputedStyle(status).backgroundColor),status:status.textContent,
     headerContrast:ratio(getComputedStyle(n.querySelector('b')).color,s.backgroundColor),
     text:n.querySelector('b').textContent,font:parseFloat(getComputedStyle(n.querySelector('b')).fontSize)}
   })
   assert.equal(styles.text,before.data[i].name);assert(styles.font>=14)
   assert.notEqual(styles.badgeColor,styles.badgeBackground);assert.notEqual(styles.actionColor,styles.actionBackground)
   assert.notEqual(styles.background,'rgba(0, 0, 0, 0)');assert(styles.actionHeight>=(width<=640?43.5:31.5))
   for(const key of ['badgeContrast','actionContrast','statusContrast','headerContrast'])assert(styles[key]>=4.5,key+' '+styles[key])
   assert.equal(styles.status,before.data[i].status)
   checks.push({width,branch:before.data[i].id,styles})
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow '+width)
  await page.screenshot({path:evidence+'/branches-'+width+'.png',fullPage:true})
 }
 // A failed publication retains the exact draft, then the supported retry persists the same values.
 const branch=before.data[0];await cards.filter({hasText:branch.name}).getByRole('button',{name:/Configur/}).click()
 await page.getByRole('button',{name:'Details & Contact',exact:true}).click()
 const publish=page.getByRole('button',{name:'Publish Branch Changes',exact:true})
 await page.route(api+'/api/branches/'+branch.id,r=>r.request().method()==='PATCH'?r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic temporary refusal'})}):r.continue(),{times:1})
 await publish.click();await page.getByText('Synthetic temporary refusal',{exact:true}).first().waitFor()
 assert.equal(await page.getByRole('textbox',{name:'Branch name',exact:true}).inputValue(),branch.name)
 const response=page.waitForResponse(r=>r.url()===api+'/api/branches/'+branch.id&&r.request().method()==='PATCH')
 await publish.focus();await page.keyboard.press('Enter');assert.equal((await response).status(),200)
 await page.reload();await page.getByRole('button',{name:'Branches',exact:true}).first().click()
 const after=await read(page)
 for(const old of before.data){const actual=after.data.find(b=>b.id===old.id);for(const field of ['id','name','phone','branch_code','weekly_hours'])assert.deepEqual(actual[field],old[field])}
 for(const email of ['staff.reception@example.test','dentist@example.test','patient@example.test']){
  const other=await login(email)
  const status=await other.page.evaluate(async({api,id})=>{
   const token=decodeURIComponent(document.cookie.split('; ').find(c=>c.startsWith('XSRF-TOKEN='))?.split('=').slice(1).join('=')||'')
   const r=await fetch(api+'/api/branches/'+id,{method:'PATCH',credentials:'include',headers:{Accept:'application/json','Content-Type':'application/json','X-XSRF-TOKEN':token},body:JSON.stringify({name:'Forbidden synthetic edit'})});return r.status
  },{api,id:branch.id})
  assert.equal(status,403);await other.context.close()
 }
 assert.deepEqual(errors,[])
 writeFileSync(evidence+'/results.json',JSON.stringify({accepted:['OWN-04'],checks,ownerPublishRecovery:true,allNonOwnerWriteDenied:true,realPersistedReadback:true,errors,limitation:'Focused original criterion acceptance, not a formal accessibility audit.'},null,2))
 console.log('PASS OWN-04 actual Branches cards/headers/status/actions, keyboard, six widths, Owner retry/readback and non-Owner write denial')
}catch(e){if(page)await page.screenshot({path:evidence+'/failure.png',fullPage:true});throw e}finally{await browser.close()}

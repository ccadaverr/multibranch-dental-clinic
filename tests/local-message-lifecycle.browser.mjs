// Actual owned synthetic Staff/Dentist message writes and persisted reads. No participant switching or external delivery.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
const {browser,login,get,api,target,evidence}=await import('./local-visit-support.mjs')
const [own]=JSON.parse(readFileSync(target.runtime+'/batch07-message-fixture.json','utf8'))
const groups=[],pass=s=>{groups.push(s);console.log('PASS '+s)}
const marker='Synthetic sprint09 '+Date.now()
let page
async function open(email){
  const session=await login(email);page=session.page;page.setDefaultTimeout(45000)
  await page.getByRole('button',{name:'Messages',exact:true}).first().click()
  const search=page.getByRole('searchbox',{name:'Search messages or contacts',exact:true})
  await search.fill(own.code);await page.locator('.chat-row').filter({hasText:own.code}).click()
  await page.getByRole('log',{name:'Messages',exact:true}).locator('.chat-bubble').first().waitFor()
  await search.fill('');return session
}
const bottom=p=>p.waitForFunction(()=>{const e=document.querySelector('.chat-log');return e&&e.scrollHeight-e.scrollTop-e.clientHeight<3})
try{
  const staff=await open('sprint02.staff@example.test'),p=staff.page
  const sent=[];let savedId
  p.on('request',r=>{if(r.url()===api+'/api/conversations/'+own.id+'/messages'&&r.method()==='POST')sent.push({key:r.headers()['idempotency-key'],body:r.postDataJSON()})})
  await p.route(api+'/api/conversations/'+own.id+'/messages',async route=>{
    if(route.request().method()!=='POST')return route.continue()
    const r=await route.fetch();assert.equal(r.status(),201);savedId=(await r.json()).data.id;await route.abort('failed')
  },{times:1})
  await p.getByRole('textbox',{name:/^Message to/}).fill(marker+' from Staff')
  await p.getByRole('button',{name:'Send',exact:true}).evaluate(b=>{b.click();b.click()})
  const pending=p.locator('.chat-bubble.is-unconfirmed').filter({hasText:marker})
  await pending.waitFor();assert.equal(sent.length,1)
  const retry=pending.getByRole('button',{name:'Retry',exact:true});await retry.focus();await p.keyboard.press('Enter')
  await pending.waitFor({state:'hidden'});await p.locator('.chat-log .chat-bubble.mine').filter({hasText:marker+' from Staff'}).waitFor()
  assert.equal(sent.length,2);assert(sent[0].key);assert.deepEqual(sent[0],sent[1]);await bottom(p)
  const saved=await get(p,'/api/conversations/'+own.id+'/messages?q='+encodeURIComponent(marker));assert.equal(saved.status,200)
  assert.equal(saved.body.data.filter(m=>m.body===marker+' from Staff').length,1);assert.equal(saved.body.data[0].id,savedId)
  assert.equal(saved.body.meta.context.patient_id,own.patientId);assert.equal(saved.body.meta.context.branch_id,own.branchId)
  pass('Staff committed-response loss and same-tick double activation recover one exact saved message through same-key keyboard Retry')

  const dentist=await open('sprint02.dentist@example.test'),d=dentist.page
  await d.locator('.chat-log .chat-bubble.theirs').filter({hasText:marker+' from Staff'}).waitFor()
  await d.getByRole('textbox',{name:/^Message to/}).fill(marker+' from Dentist')
  await d.getByRole('button',{name:'Send',exact:true}).click()
  await d.locator('.chat-log .chat-bubble.mine:not(.is-sending)').filter({hasText:marker+' from Dentist'}).waitFor();await bottom(d)
  await p.bringToFront();await p.locator('.chat-log .chat-bubble.theirs').filter({hasText:marker+' from Dentist'}).waitFor();await bottom(p)
  pass('Dentist receives Staff message and sends its own; Staff polling receives the reply and latest-message auto-scroll reaches the bottom')

  for(const [role,rolePage] of [['staff',p],['dentist',d]]){
    await rolePage.bringToFront()
    const log=rolePage.getByRole('log',{name:'Messages',exact:true})
    assert(await log.evaluate(e=>e.scrollHeight>e.clientHeight),'long thread must overflow')
    const count=await log.locator('.chat-bubble').count();await log.evaluate(e=>{e.scrollTop=0})
    await log.getByRole('button',{name:'Load older messages',exact:true}).click()
    await rolePage.waitForFunction(n=>document.querySelectorAll('.chat-log .chat-bubble').length>n,count)
    assert(await log.evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight>20),'older paging must retain history position')
    for(const scheme of ['light','dark']){
      await rolePage.emulateMedia({colorScheme:scheme})
      const styles=await log.evaluate(e=>['mine','theirs'].map(kind=>{
        const b=e.querySelector('.chat-bubble.'+kind+':not(.is-sending)'),s=getComputedStyle(b)
        return {background:s.backgroundColor,align:s.alignSelf,text:getComputedStyle(b.querySelector('p')).color}
      }))
      assert.notEqual(styles[0].background,styles[1].background);assert.equal(styles[0].align,'flex-end');assert.equal(styles[1].align,'flex-start')
      const luminance=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]}
      for(const style of styles){const a=luminance(style.background),b=luminance(style.text);assert((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,'message text contrast')}
    }
    for(const width of [375,390,430,768,1024,1440]){
      await rolePage.setViewportSize({width,height:1000});assert(await rolePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),role+' overflow '+width)
      const composer=rolePage.getByRole('textbox',{name:/^Message to/});await composer.focus();assert(await composer.evaluate(e=>e===document.activeElement))
      await rolePage.screenshot({path:evidence+'/'+role+'-messages-'+width+'.png',fullPage:true})
    }
  }
  pass('Staff and Dentist long threads page/scroll without jumping to latest; distinct aligned bubbles pass body contrast in both OS color preferences, keyboard and six widths')
  for(const rolePage of [p,d]){
    await rolePage.bringToFront();await rolePage.setViewportSize({width:1440,height:1000})
    const back=rolePage.getByRole('button',{name:'Back to conversations',exact:true});if(await back.isVisible())await back.click()
    await rolePage.getByRole('searchbox',{name:'Search messages or contacts',exact:true}).fill('')
    const list=rolePage.getByRole('region',{name:'Conversations',exact:true}),more=list.getByRole('button',{name:'Load more conversations',exact:true})
    await more.waitFor();const count=await list.locator('.chat-row').count();await more.click()
    await rolePage.waitForFunction(n=>document.querySelectorAll('.chat-list .chat-row').length>n,count)
    assert(await list.locator('ul').evaluate(e=>e.scrollHeight>e.clientHeight),'inbox list must overflow')
    await list.locator('ul').evaluate(e=>{e.scrollTop=e.scrollHeight});assert(await list.locator('ul').evaluate(e=>e.scrollTop>0))
    for(const width of [375,390,430,768,1024,1440]){await rolePage.setViewportSize({width,height:1000});if(await back.isVisible())await back.click();assert(await rolePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'inbox overflow '+width);await list.locator('.chat-row').last().focus();assert(await list.locator('.chat-row').last().evaluate(e=>e===document.activeElement))}
  }
  pass('Staff and Dentist actual PostgreSQL-backed inboxes page beyond 25 rows, scroll and retain keyboard reachability at all six widths')
  await p.setViewportSize({width:1440,height:1000})
  await p.reload();await p.getByRole('button',{name:'Messages',exact:true}).first().click();await p.getByRole('searchbox',{name:'Search messages or contacts',exact:true}).fill(own.code);await p.locator('.chat-row').filter({hasText:own.code}).click()
  await p.locator('.chat-log .chat-bubble').filter({hasText:marker+' from Staff'}).waitFor();await p.locator('.chat-log .chat-bubble').filter({hasText:marker+' from Dentist'}).waitFor()
  await staff.context.close();await dentist.context.close()
  const foreign=await login('patient@example.test');page=foreign.page
  assert.equal((await get(page,'/api/conversations/'+own.id+'/messages')).status,403)
  pass('Both messages persist after reload; a foreign Patient cannot read the conversation')
  writeFileSync(evidence+'/message-lifecycle.json',JSON.stringify({accepted:true,groups,limits:'Local synthetic PostgreSQL and polling; no active-Dentist switch, separate dark palette or external delivery acceptance.'},null,2))
}catch(e){if(page&&!page.isClosed()){writeFileSync(evidence+'/message-lifecycle-failure.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/message-lifecycle-failure.png',fullPage:true})}throw e}finally{await browser.close()}

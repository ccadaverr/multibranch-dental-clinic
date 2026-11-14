// Synthetic actual-component QA only. All API/provider requests are intercepted.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE)
const base=process.env.QA_URL||'http://127.0.0.1:5194'
const browser=await chromium.launch({headless:true,channel:'chrome'}),results=[]
async function check(name,run){
 if(process.env.QA_CASE&&!name.includes(process.env.QA_CASE))return
 const p=await browser.newPage({viewport:{width:390,height:1000}});p.setDefaultTimeout(10000)
 const errors=[];p.on('pageerror',e=>errors.push(e.message))
 await p.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort())
 try{await run(p);assert.deepEqual(errors,[]);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));results.push({name,ok:true});console.log('PASS '+name)}
 catch(e){results.push({name,ok:false,error:e.message});console.log('FAIL '+name+': '+e.message)}finally{await p.close()}
}
async function leave(p,{calendar='empty',hold=false,rows=[],postResult,role='staff'}={}){
 const calls=[];let release,mode=calendar
 await p.route('**/api/**',async r=>{
  const u=new URL(r.request().url()),req=r.request()
  if(req.method()==='POST'){
   calls.push({path:u.pathname,body:req.postDataJSON()})
   if(hold)await new Promise(resolve=>{release=resolve})
   if(postResult){const result=typeof postResult==='function'?postResult(req.postDataJSON()):postResult;if(u.pathname==='/api/leave'&&result.data?.id)rows.push(result.data);return r.fulfill({json:result})}
   return r.fulfill({status:422,json:{message:'Synthetic refusal; draft retained'}})
  }
  if(u.pathname==='/api/leave/calendar')return mode==='error'?r.fulfill({status:503,json:{message:'Synthetic calendar unavailable'}}):r.fulfill({json:{data:[]}})
  return r.fulfill({json:{data:u.pathname==='/api/leave/mine'?rows:[],meta:{}}})
 })
 await p.route('**/sanctum/csrf-cookie',r=>r.fulfill({status:204}))
  await p.goto(base+'/tests/b3-leave-harness.html?role='+role)
 await p.getByRole('heading',{name:'My leave',exact:true}).waitFor()
 return{calls,setCalendar:v=>{mode=v},release:()=>release?.()}
}
try{
 await check('OWN-11 editor unmount during CSRF prevents the PATCH',async p=>{
  await p.goto(base+'/tests/fixtures/sched01-staff-roster.html')
  await p.evaluate(()=>{const original=window.fetch;window.fetch=async(url,options)=>{
   if(String(url).includes('/sanctum/csrf-cookie'))await new Promise(r=>{window.sched01.csrfRelease=r})
   return original(url,options)
  }})
  await p.getByRole('button',{name:'Change shift profile',exact:true}).click();await p.getByRole('button',{name:'Save shift profile',exact:true}).click()
  await p.waitForFunction(()=>window.sched01.csrfRelease);await p.evaluate(()=>window.sched01.setMounted(false));await p.getByText('Fixture unmounted',{exact:true}).waitFor()
  await p.evaluate(()=>window.sched01.csrfRelease());await p.waitForTimeout(150)
  assert.equal(await p.evaluate(()=>window.sched01.requests.length),0)
 })
 await check('OWN-11 stale branch during edit refuses reassignment until explicit review',async p=>{
  await p.goto(base+'/tests/fixtures/sched01-staff-roster.html?direct=1')
  const open=p.getByRole('button',{name:'Change shift profile',exact:true}),save=p.getByRole('button',{name:'Save shift profile',exact:true})
  await open.click();await p.getByLabel('Shift start',{exact:true}).fill('09:15')
  await p.evaluate(()=>window.sched01.replaceProfile({branch:{id:'b2',name:'Synthetic Branch B'}}))
  await save.click();await p.getByRole('alert').filter({hasText:'This Staff profile changed'}).waitFor()
  assert.equal(await p.evaluate(()=>window.sched01.requests.length),0)
  await p.getByRole('button',{name:'Cancel',exact:true}).click();await open.click();await save.click()
  await p.getByText(/Shift profile saved for/).waitFor()
  assert.equal(await p.evaluate(()=>Object.hasOwn(window.sched01.requests[0].body,'branch_ref')),false)
 })
 await check('OWN-11 invalid shift interval is refused before POST',async p=>{
  await p.goto(base+'/tests/fixtures/sched01-staff-roster.html')
  await p.getByRole('button',{name:'Change shift profile',exact:true}).click()
  await p.getByLabel('Shift start',{exact:true}).fill('18:00');await p.getByLabel('Shift end',{exact:true}).fill('09:00')
  await p.getByRole('button',{name:'Save shift profile',exact:true}).click()
  await p.getByRole('alert').filter({hasText:'The shift end must be after its start.'}).waitFor()
  assert.equal(await p.evaluate(()=>window.sched01.requests.length),0)
 })
 for(const field of ['hours','branch'])await check('OWN-11 inconsistent '+field+' receipt is not success',async p=>{
  await p.goto(base+'/tests/fixtures/sched01-staff-roster.html')
  await p.getByRole('button',{name:'Change shift profile',exact:true}).click()
  await p.getByLabel('Shift start',{exact:true}).fill('09:15')
  await p.getByLabel('Shift end',{exact:true}).fill('18:15')
  await p.evaluate(field=>{
   const original=window.fetch;window.fetch=async(url,options)=>String(url).includes('/api/staff/')?
    Response.json({data:{id:'s1',branchId:field==='branch'?'b2':'b1',branch:'Synthetic Branch',shiftStart:field==='hours'?'07:00:00':'09:15:00',shiftEnd:'18:15:00'}}):original(url,options)
  },field)
  await p.getByRole('button',{name:'Save shift profile',exact:true}).click()
  await p.getByRole('alert').filter({hasText:'could not be confirmed'}).waitFor()
  assert.equal(await p.getByText(/Shift profile saved for/).count(),0)
  assert.equal(await p.getByLabel('Shift start',{exact:true}).inputValue(),'09:15')
 })
 await check('STF-08/DEN-13 calendar failure is unknown, never nobody-away',async p=>{
  const f=await leave(p,{calendar:'error'})
  await p.getByRole('alert').filter({hasText:'Leave calendar could not be loaded'}).waitFor()
  assert.equal(await p.getByText('Nobody is away in the next two weeks.',{exact:true}).count(),0)
  f.setCalendar('empty');await p.getByRole('button',{name:'Retry leave calendar',exact:true}).click()
  await p.getByText('Nobody is away in the next two weeks.',{exact:true}).waitFor()
 })
 await check('GEN-07 Other leave has native required Specify',async p=>{
  await leave(p);await p.getByRole('combobox',{name:'Type',exact:true}).selectOption('other')
  const reason=p.getByRole('textbox',{name:/^Specify reason/})
  assert.equal(await reason.evaluate(e=>e.required),true)
  assert.equal(await reason.evaluate(e=>e.validity.valueMissing),true)
  await reason.fill('Synthetic reason');assert.equal(await reason.evaluate(e=>e.checkValidity()),true)
  await p.getByRole('combobox',{name:'Type',exact:true}).selectOption('vacation')
  assert.equal(await p.getByRole('textbox',{name:/^Private note \(optional\)/}).evaluate(e=>e.required),false)
 })
 await check('STF-08/DEN-13 cancellation duplicates are latched',async p=>{
  const f=await leave(p,{hold:true,rows:[{id:'leave-A',label:'Synthetic leave',type_label:'Vacation',status:'Pending',can_cancel:true}]})
  await p.getByRole('button',{name:'Cancel',exact:true}).evaluate(e=>{e.click();e.click()})
  await p.waitForTimeout(150);assert.equal(f.calls.length,1)
  assert.equal(f.calls[0].path,'/api/leave/leave-A/cancel');f.release()
  await p.getByRole('button',{name:'Cancel',exact:true}).waitFor({state:'visible'})
 })
 await check('STF-08/DEN-13 cancellation confirms exact receipt without promising availability',async p=>{
  const rows=[{id:'leave-A',label:'Synthetic leave',type_label:'Vacation',status:'Approved',can_cancel:true}]
  await leave(p,{rows,postResult:()=>{rows[0]={...rows[0],status:'Cancelled',can_cancel:false};return{data:rows[0]}}})
  await p.getByRole('button',{name:'Cancel',exact:true}).click()
  await p.waitForFunction(()=>window.leaveFixture.feedback.length===1)
  assert.deepEqual(await p.evaluate(()=>window.leaveFixture.feedback),[['Leave cancelled. Check current availability before booking.','success']])
  await p.getByRole('listitem').getByText('Cancelled',{exact:true}).waitFor()
  assert.equal(await p.getByRole('button',{name:'Cancel',exact:true}).count(),0)
 })
 await check('STF-08/DEN-13 cancellation wrong-ID receipt remains unverified',async p=>{
  const f=await leave(p,{rows:[{id:'leave-A',label:'Synthetic leave',type_label:'Vacation',status:'Approved',can_cancel:true}],postResult:{data:{id:'leave-B',status:'Cancelled'}}})
  await p.getByRole('button',{name:'Cancel',exact:true}).click();await p.waitForFunction(()=>window.leaveFixture.feedback.length===1)
  const feedback=await p.evaluate(()=>window.leaveFixture.feedback);assert.equal(feedback[0][1],'warning');assert.match(feedback[0][0],/outcome is unverified/)
  assert.equal(await p.getByRole('button',{name:'Cancel',exact:true}).isDisabled(),true)
  assert.equal(f.calls.length,1)
 })
 await check('STF-08/DEN-13 missing request receipt is uncertain and retains draft',async p=>{
  await leave(p,{postResult:{data:{}}})
  const date=await p.locator('input[type=date]').first().getAttribute('min');await p.locator('input[type=date]').first().fill(date)
  await p.getByRole('button',{name:'Request leave',exact:true}).click()
  await p.getByRole('alert').filter({hasText:'outcome is unverified'}).waitFor()
  assert.equal(await p.locator('input[type=date]').first().inputValue(),date)
  assert.deepEqual(await p.evaluate(()=>window.leaveFixture.feedback),[])
  assert.equal(await p.getByRole('button',{name:'Request leave',exact:true}).isDisabled(),true)
  await p.getByRole('button',{name:'Refresh My leave',exact:true}).click()
  await p.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Request leave'&&!b.disabled))
 })
 await check('STF-08/DEN-13 confirmed full-day receipt preserves the supported request flow',async p=>{
  const f=await leave(p,{postResult:body=>({data:{id:'leave-A',label:'Synthetic confirmed pending request',type_label:'Vacation',type:body.type,status:'Pending',starts_at:body.start_date+'T00:00:00+08:00',ends_at:new Date(Date.parse(body.end_date+'T00:00:00Z')+864e5).toISOString().slice(0,10)+'T00:00:00+08:00',private_note:null}})})
  const date=await p.locator('input[type=date]').first().getAttribute('min');await p.locator('input[type=date]').first().fill(date)
  await p.getByRole('button',{name:'Request leave',exact:true}).press('Enter')
  await p.getByText('Synthetic confirmed pending request',{exact:true}).waitFor()
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.end_date,date)
  assert.equal(await p.locator('input[type=date]').first().inputValue(),'')
  assert.deepEqual(await p.evaluate(()=>window.leaveFixture.feedback),[['Leave requested. An authorized approver can review it.','success']])
 })
 await check('STF-08/DEN-13 pre-command read cannot unlock an uncertain receipt',async p=>{
  const f=await leave(p,{postResult:{data:{}}});let finish
  await p.route('**/api/leave/mine',r=>new Promise(resolve=>{finish=async()=>{await r.fulfill({json:{data:[]}});resolve()}}))
  await p.getByRole('button',{name:'Refresh My leave',exact:true}).click();await p.waitForTimeout(100);assert.ok(finish)
  const date=await p.locator('input[type=date]').first().getAttribute('min');await p.locator('input[type=date]').first().fill(date)
  await p.getByRole('button',{name:'Request leave',exact:true}).click();await p.getByRole('alert').filter({hasText:'outcome is unverified'}).waitFor()
  await finish();await p.waitForTimeout(100)
  assert.equal(await p.getByRole('button',{name:'Request leave',exact:true}).isDisabled(),true)
  assert.equal(f.calls.length,1)
 })
 await check('STF-08/DEN-13 obsolete account read cannot expose prior private leave',async p=>{
  let phase='old';const held=[]
  await p.route('**/api/**',async r=>{
   const path=new URL(r.request().url()).pathname
   if(phase==='old'&&path==='/api/leave/mine')return new Promise(resolve=>held.push(async()=>{await r.fulfill({json:{data:[{id:'old-leave',label:'SYNTHETIC_OLD_PRIVATE',private_note:'SYNTHETIC_OLD_NOTE',status:'Pending'}]}});resolve()}))
   return r.fulfill({json:{data:[],meta:{}}})
  })
  await p.goto(base+'/tests/b3-leave-harness.html?role=staff');await p.waitForFunction(()=>window.leaveFixture)
  await p.waitForTimeout(100);assert.equal(held.length,1);phase='new'
  await p.evaluate(()=>window.leaveFixture.setAccount('B'));await p.getByText('No leave requested yet.',{exact:true}).waitFor()
  await held[0]();await p.waitForTimeout(100)
  assert.equal(await p.getByText(/SYNTHETIC_OLD_/).count(),0)
  assert.deepEqual(await p.evaluate(()=>window.leaveFixture.feedback),[])
 })
 await check('STF-08/DEN-13 changed account during CSRF prevents the POST',async p=>{
  const f=await leave(p);let release
  await p.route('**/sanctum/csrf-cookie',r=>new Promise(resolve=>{release=async()=>{await r.fulfill({status:204});resolve()}}))
  const date=await p.locator('input[type=date]').first().getAttribute('min');await p.locator('input[type=date]').first().fill(date)
  await p.getByRole('button',{name:'Request leave',exact:true}).click();await p.waitForTimeout(100);assert.ok(release)
  await p.evaluate(()=>window.leaveFixture.setAccount('B'));await p.waitForTimeout(100)
  await release();await p.waitForTimeout(150);assert.equal(f.calls.length,0)
  assert.deepEqual(await p.evaluate(()=>window.leaveFixture.feedback),[])
 })
 for(const width of [375,430,768,1024,1440])await check('OWN-11/DEN-12/GEN-12 keyboard, role and layout '+width,async p=>{
  await p.setViewportSize({width,height:1000});await p.goto(base+'/tests/fixtures/sched01-staff-roster.html')
  const open=p.getByRole('button',{name:'Change shift profile',exact:true});await open.focus();await open.press('Enter')
  assert.equal(await p.getByLabel('Shift start',{exact:true}).evaluate(e=>e===document.activeElement),true)
  await p.getByRole('button',{name:'Save shift profile',exact:true}).press('Enter');await p.getByText(/Shift profile saved for/).waitFor()
  assert.equal(await open.evaluate(e=>e===document.activeElement),true)
  assert.equal(await p.evaluate(()=>Object.hasOwn(window.sched01.requests[0].body,'branch_ref')),false)
  await p.evaluate(()=>window.sched01.setRole('staff'));await p.getByRole('combobox',{name:'Staff member',exact:true}).waitFor()
  assert.equal(await p.getByRole('button',{name:'Change shift profile',exact:true}).count(),0)
  await leave(p,{role:'dentist'});await p.getByRole('combobox',{name:'Type',exact:true}).selectOption('other')
  await p.getByRole('textbox',{name:/^Specify reason/}).fill('Synthetic reason');await p.getByRole('textbox',{name:/^Specify reason/}).press('Tab')
  assert.equal(await p.getByRole('button',{name:'Request leave',exact:true}).isDisabled(),true,'date remains required')
 })
 await check('STF-08/DEN-13 duplicate partial leave sends one exact payload and retains draft',async p=>{
  const f=await leave(p,{hold:true}),date=await p.locator('input[type=date]').first().getAttribute('min')
  await p.locator('input[type=date]').first().fill(date)
  await p.getByRole('checkbox',{name:'Only part of the day',exact:true}).check()
  await p.getByLabel('From (time on selected date)',{exact:true}).fill('10:15')
  await p.getByLabel('Until (time on selected date)',{exact:true}).fill('11:30')
  await p.getByRole('textbox',{name:/^Private note \(optional\)/}).fill('Synthetic private note')
  await p.getByRole('button',{name:'Request leave',exact:true}).evaluate(e=>{
   e.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));e.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
  })
  await p.waitForTimeout(100);assert.equal(f.calls.length,1,'same-tick duplicate submission must be latched')
  assert.deepEqual(f.calls[0].body,{type:'vacation',start_date:date,end_date:date,private_note:'Synthetic private note',start_time:'10:15',end_time:'11:30'})
  assert.equal(await p.getByRole('textbox',{name:/^Private note \(optional\)/}).isDisabled(),true)
  f.release();await p.getByRole('alert').filter({hasText:'Synthetic refusal'}).waitFor()
  assert.equal(await p.getByRole('textbox',{name:/^Private note \(optional\)/}).inputValue(),'Synthetic private note')
  assert.equal(await p.getByRole('button',{name:'Request leave',exact:true}).isEnabled(),true)
 })
 console.log(JSON.stringify({passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,results},null,2))
 if(results.some(r=>!r.ok))process.exitCode=1
}finally{await browser.close()}

// Actual production components, synthetic records, loopback only; no backend/providers.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE)
const base=process.env.QA_URL||'http://127.0.0.1:5194',results=[]
const browser=await chromium.launch({channel:'chrome',headless:true})
async function check(name,run){
 if(process.env.QA_CASE&&!name.includes(process.env.QA_CASE))return
 const p=await browser.newPage({viewport:{width:390,height:1000},hasTouch:true}),errors=[];p.setDefaultTimeout(7000)
 p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort())
 await p.route('**/sanctum/**',r=>r.fulfill({status:204}));await p.route('**/api/**',r=>r.fulfill({json:{data:[]}}))
 try{await run(p);assert.deepEqual(errors,[]);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));results.push({name,ok:true});console.log('PASS '+name)}catch(e){results.push({name,ok:false,error:e.message});console.log('FAIL '+name+': '+e.message)}finally{await p.close()}
}
async function rx(p,{hold=false,fail=false,draft=null}={}){
 const calls=[];let release,failed=fail
 await p.route('**/api/**',async r=>{
  const path=new URL(r.request().url()).pathname,req=r.request()
  if(req.method()!=='GET'){
   calls.push({path,body:req.postDataJSON()});if(hold)await new Promise(resolve=>{release=resolve})
   if(failed)return r.fulfill({status:422,json:{message:'Synthetic draft refusal'}})
   const body=req.postDataJSON();return r.fulfill({json:{data:{id:'rx1',visit:'v1',patient:{id:'p1',name:'Synthetic patient'},status:'Draft',can_edit:true,revision:(body.expected_revision||1)+1,lines:body.lines,note:body.note}}})
  }
  if(path==='/api/prescriptions/visits')return r.fulfill({json:{data:[{id:'v1',date:'2026-11-01',patient:{id:'p1',name:'Synthetic patient',age:null},branch:'Synthetic branch'}],meta:{}}})
  if(draft&&path==='/api/prescriptions/rx1')return r.fulfill({json:{data:draft}})
  return r.fulfill({json:{data:draft?[draft]:[]}})
 })
 await p.goto(base+'/tests/fixtures/qa-batch05.html')
 if(draft){await p.getByRole('button',{name:'Edit draft',exact:true}).click();await p.getByRole('heading',{name:'Edit draft for Synthetic patient',exact:true}).waitFor()}
 else await p.getByRole('combobox',{name:/^Visit/}).selectOption('v1')
 return{calls,release:()=>{hold=false;release?.()},setFail:v=>{failed=v}}
}
const fields=[['medicine','Specify medicine name','Select medicine 1','Amoxicillin'],['dosage','Specify custom dosage','Select dosage 1','500mg'],['frequency','Specify custom frequency','Select frequency 1','Once daily'],['duration','Specify custom duration','Select duration 1','3 days']]
async function recovery(p){
 await p.goto(base+'/tests/fixtures/qa-batch05.html?mode=encounter')
 await p.getByRole('heading',{name:'Clinical documentation',exact:true}).waitFor()
 await p.getByLabel('Clinical notes',{exact:true}).fill('Synthetic unsaved draft')
 await p.getByRole('button',{name:'Save Treatment Progress',exact:true}).click()
 await p.locator('.notice').filter({hasText:'Synthetic unknown save outcome'}).waitFor()
 return p.getByRole('button',{name:'Check server record',exact:true})
}
try{
 for(const [field,label,select,standard]of fields)await check('GEN-07 native Specify '+field,async p=>{
  const f=await rx(p);await p.getByRole('combobox',{name:'Select medicine 1',exact:true}).selectOption('Amoxicillin')
  await p.getByRole('combobox',{name:select,exact:true}).selectOption('__other__');const input=p.getByRole('textbox',{name:label,exact:true})
  assert.equal(await input.evaluate(e=>e.required),true);assert.equal(await input.evaluate(e=>e.validity.valueMissing),true)
  await input.fill('   ');assert.equal(await p.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true)
  await input.evaluate(e=>e.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await p.getByRole('alert').filter({hasText:'Specify the selected Other'}).waitFor();assert.equal(f.calls.length,0)
  await input.fill('Synthetic custom value');await p.getByRole('combobox',{name:select,exact:true}).selectOption(standard);assert.equal(await input.count(),0)
  await p.getByRole('combobox',{name:select,exact:true}).selectOption('__other__');assert.equal(await input.inputValue(),'')
 })
 await check('GEN-07 valid trimmed payload duplicate guard and error recovery',async p=>{
  const f=await rx(p,{hold:true,fail:true})
  for(const [,label,select]of fields){await p.getByRole('combobox',{name:select,exact:true}).selectOption('__other__');await p.getByRole('textbox',{name:label,exact:true}).fill('  Synthetic '+label+'  ')}
  await p.getByRole('button',{name:'Save draft',exact:true}).evaluate(e=>{e.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));e.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})
  await p.waitForTimeout(100);assert.equal(f.calls.length,1)
  for(const [field,label]of fields)assert.equal(f.calls[0].body.lines[0][field],'Synthetic '+label)
  assert.equal(Object.keys(f.calls[0].body.lines[0]).some(k=>k.endsWith('Other')),false)
  f.release();await p.getByRole('alert').filter({hasText:'Synthetic draft refusal'}).waitFor();assert.equal(await p.getByRole('textbox',{name:'Specify medicine name',exact:true}).inputValue(),'  Synthetic Specify medicine name  ')
  f.setFail(false);await p.getByRole('button',{name:'Save draft',exact:true}).press('Enter');await p.getByRole('dialog').waitFor();assert.equal(f.calls.length,2);assert.equal(f.calls[1].body.visit_id,'v1')
 })
 await check('GEN-12 shared disabled false cannot enable a pending refresh',async p=>{
  await p.goto(base+'/tests/fixtures/qa-batch05.html?mode=shared');const b=p.getByRole('button',{name:'Synthetic refresh',exact:true});await b.press('Enter')
  await p.waitForFunction(()=>window.qa05.reads.length===1);assert.equal(await b.getAttribute('aria-busy'),'true');assert.equal(await b.isDisabled(),true)
  await b.evaluate(e=>{e.dispatchEvent(new MouseEvent('click',{bubbles:true}));e.dispatchEvent(new MouseEvent('click',{bubbles:true}))});assert.equal(await p.evaluate(()=>window.qa05.reads.length),1)
  await p.evaluate(()=>window.qa05.resolve(0,{ok:true}));await p.waitForFunction(()=>!document.querySelector('.refresh-btn').disabled)
 })
 for(const [field,label]of fields)await check('GEN-07 loaded whitespace Other '+field+' is refused',async p=>{
  const draft={id:'rx1',visit:'v1',patient:{id:'p1',name:'Synthetic patient'},status:'Draft',can_edit:true,revision:7,lines:[{medicine:'Amoxicillin',dosage:'',frequency:'',duration:'',instructions:'',[field]:'   '}]}
  const f=await rx(p,{draft});await p.getByRole('textbox',{name:label,exact:true}).waitFor()
  assert.equal(await p.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true)
  await p.getByRole('textbox',{name:label,exact:true}).evaluate(e=>e.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  await p.getByRole('alert').filter({hasText:'Specify the selected Other'}).waitFor()
  assert.equal(f.calls.length,0)
 })
 await check('GEN-13 encounter recovery refresh is icon-only and read-only',async p=>{
  const b=await recovery(p);assert.equal(await b.textContent(),'');assert.equal(await b.locator('svg').count(),1)
  await b.press('Enter');await p.waitForFunction(()=>window.qa05.reads.length===1);assert.equal(await b.getAttribute('aria-busy'),'true');assert.equal(await b.isDisabled(),true)
  await b.evaluate(e=>{e.click();e.click()});assert.equal(await p.evaluate(()=>window.qa05.reads.length),1)
  await p.evaluate(()=>window.qa05.resolve(0,{ok:false}));await p.getByRole('alert').filter({hasText:'could not be refreshed'}).waitFor()
  await p.waitForFunction(()=>!document.querySelector('[aria-label="Check server record"]').disabled);await b.tap();await p.waitForFunction(()=>window.qa05.reads.length===2)
  await p.evaluate(()=>window.qa05.resolve(1,{ok:true}));await p.waitForTimeout(100)
  assert.equal(await p.getByLabel('Clinical notes',{exact:true}).inputValue(),'Synthetic unsaved draft');assert.equal(await p.evaluate(()=>window.qa05.commands.length),1)
  assert.equal(await p.locator('.notice').filter({hasText:'Synthetic unknown save outcome'}).count(),1)
 })
 await check('GEN-07 encounter Other has native required and retains exact decision',async p=>{
  await p.goto(base+'/tests/fixtures/qa-batch05.html?mode=encounter');await p.getByRole('checkbox',{name:'Dentist indicates follow-up required',exact:true}).check()
  await p.getByRole('combobox',{name:'Follow-up reason',exact:true}).selectOption('Other');const input=p.getByRole('textbox',{name:'Specify reason / instructions',exact:true})
  assert.equal(await input.evaluate(e=>e.required),true);assert.equal(await input.evaluate(e=>e.validity.valueMissing),true)
  await input.fill('   ');assert.equal(await p.getByRole('button',{name:'Save Treatment Progress',exact:true}).isDisabled(),true)
  await input.fill('Synthetic discarded reason');await p.getByRole('combobox',{name:'Follow-up reason',exact:true}).selectOption('Post-Op Check');assert.equal(await input.count(),0)
  await p.getByRole('combobox',{name:'Follow-up reason',exact:true}).selectOption('Other');assert.equal(await input.inputValue(),'')
  await input.fill('Synthetic reviewed follow-up');await p.getByRole('button',{name:'Save Treatment Progress',exact:true}).click();await p.waitForFunction(()=>window.qa05.commands.length===1)
  assert.equal(await p.evaluate(()=>window.qa05.commands[0].form.followupReason),'Synthetic reviewed follow-up')
 })
 for(const role of ['staff','dentist','owner'])await check('GEN-13 queue recovery icon pending and read-only '+role,async p=>{
  await p.goto(base+'/tests/fixtures/qa-batch05.html?mode=queue');await p.evaluate(role=>window.qa05.setRole(role),role)
  const b=p.getByRole('button');await b.waitFor();assert.equal(await b.locator('svg').count(),1);assert.equal(await b.getAttribute('aria-label'),'Refresh live queue counts');assert.equal(await b.textContent(),'')
  await b.press('Enter');await p.waitForFunction(()=>window.qa05.reads.length===1);assert.equal(await b.isDisabled(),true)
  await b.evaluate(e=>{e.click();e.click()});assert.equal(await p.evaluate(()=>window.qa05.reads.length),1)
  await p.evaluate(()=>window.qa05.reject(0));await p.waitForFunction(()=>!document.querySelector('.refresh-btn').disabled)
  await b.tap();await p.waitForFunction(()=>window.qa05.reads.length===2);await p.evaluate(()=>window.qa05.resolve(1,{ok:false}))
  assert.equal(await p.evaluate(()=>window.qa05.commands.length),0);await p.getByText('Synthetic live queue unavailable',{exact:true}).waitFor()
 })
 await check('GEN-13 stale refresh after auth advance cannot report or permanently block',async p=>{
  const b=await recovery(p);await b.click();await p.waitForFunction(()=>window.qa05.reads.length===1)
  await p.evaluate(()=>window.qa05.advanceAuth());await p.evaluate(()=>window.qa05.resolve(0,{ok:false}));await p.waitForFunction(()=>!document.querySelector('[aria-label="Check server record"]').disabled)
  assert.equal(await p.getByRole('alert').filter({hasText:'could not be refreshed'}).count(),0)
  assert.equal(await p.evaluate(()=>window.qa05.commands.length),1)
 })
 await check('GEN-13 refresh never rebases a draft or replaces the frozen retry',async p=>{
  const b=await recovery(p);await b.click();await p.waitForFunction(()=>window.qa05.reads.length===1)
  const first=await p.evaluate(()=>window.qa05.commands[0]);await p.evaluate(()=>window.qa05.replaceTreatment({revision:2,notes:'Synthetic newer server notes'}))
  await p.evaluate(()=>window.qa05.resolve(0,{ok:true,superseded:true,record:{patientId:'p2',revision:99}}));await p.waitForTimeout(100)
  assert.equal(await p.getByLabel('Clinical notes',{exact:true}).inputValue(),'Synthetic unsaved draft')
  await p.getByRole('button',{name:'Retry same command',exact:true}).click();await p.waitForFunction(()=>window.qa05.commands.length===2)
  assert.deepEqual(await p.evaluate(()=>window.qa05.commands[1]),first)
  assert.equal(await p.getByText(/Treatment completion confirmed/).count(),0)
 })
 await check('GEN-13 failed refresh completion after unmount has no stale feedback',async p=>{
  const b=await recovery(p);await b.click();await p.waitForFunction(()=>window.qa05.reads.length===1)
  await p.evaluate(()=>window.qa05.setMode('away'));await p.getByRole('heading',{name:'Synthetic destination',exact:true}).waitFor()
  await p.evaluate(()=>window.qa05.reject(0));await p.waitForTimeout(100);assert.equal(await p.getByRole('alert').count(),0)
  assert.equal(await p.evaluate(()=>window.qa05.commands.length),1);assert.deepEqual(await p.evaluate(()=>window.qa05.feedback),[])
 })
 await check('GEN-13 prescription read recovery is icon-only, deduplicated and identity checked',async p=>{
  const draft={id:'rx1',visit:'v1',patient:{id:'p1',name:'Synthetic patient'},status:'Draft',can_edit:true,revision:7,lines:[{medicine:'Amoxicillin',dosage:'',frequency:'',duration:'',instructions:''}]}
  const f=await rx(p,{draft});await p.getByRole('button',{name:'Cancel',exact:true}).click()
  let mode='fail',reads=0,release
  await p.route('**/api/prescriptions/rx1',async r=>{
   reads++;if(mode==='hold')await new Promise(resolve=>{release=resolve})
   if(mode==='fail')return r.fulfill({status:503,json:{message:'Synthetic record read failure'}})
   return r.fulfill({json:{data:{...draft,id:mode==='wrong'?'other-rx':'rx1'}}})
  })
  await p.getByRole('button',{name:'Open',exact:true}).click();const dialog=p.getByRole('dialog');const b=dialog.getByRole('button',{name:'Reload prescription',exact:true})
  await b.waitFor();assert.equal(await b.textContent(),'');assert.equal(await b.locator('svg').count(),1)
  mode='hold';await b.evaluate(e=>{e.click();e.click()});await p.waitForTimeout(100);assert.equal(reads,2,'initial failed GET plus one recovery GET')
  await dialog.getByText('Loading…',{exact:true}).waitFor();mode='wrong';release()
  await dialog.getByText(/response did not match this record/).waitFor();mode='good';await dialog.getByRole('button',{name:'Reload prescription',exact:true}).press('Enter')
  await p.getByRole('dialog',{name:'Draft · Synthetic patient',exact:true}).waitFor();assert.equal(f.calls.length,0)
 })
 await check('GEN-12 externally disabled refresh stays disabled and sends no read',async p=>{
  await p.goto(base+'/tests/fixtures/qa-batch05.html?mode=shared');await p.evaluate(()=>window.qa05.setDisabled(true));const b=p.getByRole('button',{name:'Synthetic refresh',exact:true})
  assert.equal(await b.isDisabled(),true);await b.evaluate(e=>e.dispatchEvent(new MouseEvent('click',{bubbles:true})));assert.equal(await p.evaluate(()=>window.qa05.reads.length),0)
 })
 for(const role of ['staff','owner'])await check('GEN-07 prescription editor stays unavailable to '+role,async p=>{
  await p.goto(base+'/tests/fixtures/qa-batch05.html');await p.waitForFunction(()=>window.qa05);await p.evaluate(role=>window.qa05.setRole(role),role)
  assert.equal(await p.getByRole('button',{name:'Save draft',exact:true}).count(),0);assert.equal(await p.getByRole('button',{name:'Issue prescription',exact:true}).count(),0)
 })
 for(const width of [375,430,768,1024,1440]){
  await check('GEN-12 GEN-08 Specify keyboard focus and layout '+width,async p=>{
   await p.setViewportSize({width,height:1000});await rx(p)
   for(const [,label,select]of fields){
    const combo=p.getByRole('combobox',{name:select,exact:true});await combo.selectOption('__other__');await combo.focus()
    const input=p.getByRole('textbox',{name:label,exact:true});await input.waitFor()
    // Dosage/frequency selectors share a row before their custom-input row.
    // Follow that native Tab order; the custom input must be reachable without
    // a mouse, a trap, or an unrelated navigation action.
    for(let tabs=0;tabs<3&&!(await input.evaluate(e=>e===document.activeElement));tabs++)await p.keyboard.press('Tab')
    assert.equal(await input.evaluate(e=>e===document.activeElement),true);assert.equal(await input.getAttribute('aria-required'),'true')
    assert.ok(await input.evaluate(e=>getComputedStyle(e).outlineStyle!=='none'||getComputedStyle(e).boxShadow!=='none'))
    await input.fill('Synthetic custom value')
   }
   const box=await p.getByRole('button',{name:'Save draft',exact:true}).boundingBox();assert.ok(box.width>=44&&box.height>=44,JSON.stringify(box))
  })
  await check('GEN-12 GEN-08 encounter refresh focus target and layout '+width,async p=>{
   await p.setViewportSize({width,height:1000});const b=await recovery(p);await p.keyboard.press('Tab');await b.focus();assert.ok(await b.evaluate(e=>getComputedStyle(e).outlineStyle!=='none'))
   const box=await b.boundingBox();assert.ok(box.width>=44&&box.height>=44,JSON.stringify(box));assert.equal(await b.getAttribute('title'),'Check server record')
   await b.press('Space');await p.waitForFunction(()=>window.qa05.reads.length===1);await p.evaluate(()=>window.qa05.resolve(0,{ok:true}))
   assert.equal(await p.evaluate(()=>window.qa05.commands.length),1)
  })
 }
 console.log(JSON.stringify({passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,results},null,2));if(results.some(r=>!r.ok))process.exitCode=1
}finally{await browser.close()}

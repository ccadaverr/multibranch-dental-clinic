// Real Staff Patient-record edit/recovery on the owned synthetic target. No raw local profile writes.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
const {browser,login,get,api,evidence,target}=await import('./local-visit-support.mjs')
const f=JSON.parse(readFileSync(target.runtime+'/visit-fixture.json','utf8'))
const arrivals=JSON.parse(readFileSync(target.runtime+'/arrival-browser-batch02/journey.json','utf8'))
const file=evidence+'/journey.json',state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{groups:[]}
const save=()=>writeFileSync(file,JSON.stringify(state,null,2)),pass=name=>{if(!state.groups.includes(name))state.groups.push(name);save();console.log('PASS '+name)}
state.accepted=false;save();let page
try{
 const staff=await login('sprint02.staff@example.test');page=staff.page;page.setDefaultTimeout(45000)
 const open=async code=>{await page.getByRole('button',{name:'Patient Records',exact:true}).first().click();await page.getByRole('searchbox',{name:'Search patients',exact:true}).fill(code);await page.locator('.patient-list-scroll button').filter({hasText:code}).click();await page.getByRole('textbox',{name:'Emergency contact',exact:true}).waitFor()}
 if(!state.updated){
  await open(f.patientCode);const original=await get(page,'/api/patients/'+f.patientId);state.observed=original.body.data.revision;state.contact='Synthetic profile recovery '+Date.now();save()
  await page.getByRole('textbox',{name:'Emergency contact',exact:true}).fill(state.contact)
  const posts=[];page.on('request',r=>{if(r.method()==='PATCH'&&r.url()===api+'/api/patients/'+f.patientId)posts.push({body:r.postDataJSON(),key:r.headers()['idempotency-key']})})
  await page.route(api+'/api/patients/'+f.patientId,async route=>{if(route.request().method()!=='PATCH')return route.continue();const r=await route.fetch();assert.equal(r.status(),200);state.updated=(await r.json()).data;save();await route.fulfill({status:500,json:{message:'Synthetic profile response loss after commit'}})},{times:1})
  await page.getByRole('button',{name:'Save changes',exact:true}).evaluate(b=>{b.click();b.click()})
  const retry=page.getByRole('button',{name:'Retry same profile save',exact:true});await retry.waitFor();assert.equal(await page.getByRole('textbox',{name:'Emergency contact',exact:true}).isDisabled(),true)
  await retry.focus();await page.keyboard.press('Enter');await page.getByText(`Profile save verified for ${f.patientCode}, revision ${state.observed+1}.`,{exact:true}).waitFor()
  assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);assert.equal(posts[0].body.expected_revision,state.observed);assert.equal(state.updated.id,f.patientId)
  pass('committed profile HTTP 500 loss → frozen form → same-key/revision keyboard retry → exact Patient receipt')
 }
 const fresh=await login('sprint02.staff@example.test');await staff.context.close();page=fresh.page;page.setDefaultTimeout(45000)
 await open(f.patientCode);assert.equal(await page.getByRole('textbox',{name:'Emergency contact',exact:true}).inputValue(),state.contact)
 const r=await get(page,'/api/patients/'+f.patientId);assert.equal(r.body.data.revision,state.observed+1);assert.equal(r.body.data.emergency_contact,state.contact)
 pass('new authenticated Staff session reads one persisted profile revision and exact saved values')
 // Hold an actual authorized A response while Staff selects B. Releasing A must not change B's summary.
 await page.getByRole('searchbox',{name:'Search patients',exact:true}).fill('PAT-')
 const select=code=>page.locator('.patient-list-scroll button').filter({hasText:code}).click()
 await select(arrivals.walkPatient.code);await page.getByRole('textbox',{name:'Patient code',exact:true}).waitFor()
 let release,started;const held=new Promise(resolve=>{started=resolve}),barrier=new Promise(resolve=>{release=resolve})
 await page.route(api+'/api/patients/'+f.patientId,async route=>{const response=await route.fetch();started();await barrier;await route.fulfill({response})},{times:1})
 await select(f.patientCode);await held;await select(arrivals.walkPatient.code)
 await page.getByRole('textbox',{name:'Patient code',exact:true}).filter({visible:true}).waitFor();await page.waitForFunction(code=>document.querySelector('.patient-header-card')?.textContent.includes(code),arrivals.walkPatient.code)
 release();await page.waitForTimeout(100)
 assert.equal(await page.getByRole('textbox',{name:'Patient code',exact:true}).inputValue(),arrivals.walkPatient.code)
 assert.notEqual(await page.getByRole('textbox',{name:'Emergency contact',exact:true}).inputValue(),state.contact)
 pass('delayed earlier Patient profile response cannot replace the newly selected Patient summary')
 // Wrong identity from the exact request is refused, never rendered as another Patient's successful profile.
 const wrong=route=>route.fulfill({status:200,json:{data:{id:arrivals.walkPatient.id,profile_access:'full',name:'Synthetic mismatched response'}}})
 await page.route(api+'/api/patients/'+f.patientId,wrong)
 await select(f.patientCode);await page.getByText('Patient record unavailable',{exact:true}).waitFor();assert.equal(await page.getByText('Synthetic mismatched response',{exact:true}).count(),0)
 await page.unroute(api+'/api/patients/'+f.patientId,wrong)
 await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('textbox',{name:'Emergency contact',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Emergency contact',exact:true}).inputValue(),state.contact)
 pass('mismatched Patient read is refused with recovery; original authorized profile reloads')
 if(!state.placeholderPatient){const created=await page.evaluate(async()=>{const api=await import('/src/api-client.js');return api.registerPatient({first_name:'OtherField',last_name:'Synthetic QA'},'batch04-other-patient')});assert.equal(created.ok,true);state.placeholderPatient=created.data;save()}
 if(!state.placeholderAppointment){
  if(!state.placeholderIntent){
   const date=await page.evaluate(()=>new Date(Date.now()+8*3600e3+86400e3).toISOString().slice(0,10))
   const availability=await page.evaluate(async args=>(await import('/src/api-client.js')).appointmentAvailability(args),{branch_ref:f.branch,service_ref:f.service,dentist_ref:f.dentist,patient_id:state.placeholderPatient.id,date})
   assert.equal(availability.ok,true);const slot=availability.data.slots[0];assert.ok(slot)
   state.placeholderIntent={patient_id:state.placeholderPatient.id,branch_ref:f.branch,service_ref:f.service,dentist_ref:f.dentist,date,start_time:slot.start_time};save()
  }
  const booked=await page.evaluate(async body=>(await import('/src/api-client.js')).createAppointment(body,'batch04-other-booking'),state.placeholderIntent);assert.equal(booked.ok,true);state.placeholderAppointment=booked.data;save()
 }
 await open(state.placeholderPatient.code)
 await page.getByRole('combobox',{name:'ID shown',exact:true}).selectOption('other')
 const specify=page.getByRole('textbox',{name:/^Specify ID type/});assert.equal(await specify.getAttribute('placeholder'),'e.g. Company ID');assert.equal(await specify.getAttribute('required'),'')
 await specify.fill('   ');assert.equal(await page.getByRole('button',{name:'ID checked',exact:true}).isDisabled(),true)
 await page.getByRole('combobox',{name:'ID shown',exact:true}).selectOption('passport');assert.equal(await specify.count(),0)
 await page.getByRole('combobox',{name:'ID shown',exact:true}).selectOption('other');assert.equal(await specify.inputValue(),'')
 pass('DEN-10 supported Patient Records Other ID shows required Specify with example placeholder; whitespace refused and detail clears')
 for(const width of [375,390,430,768,1024,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'overflow at '+width);await page.screenshot({path:evidence+'/patient-profile-'+width+'.png',fullPage:true})}
 pass('profile recovery and explicit feedback fit all six widths');state.accepted=true;save()
}catch(e){if(page){writeFileSync(evidence+'/failure-text.txt',await page.locator('body').innerText());await page.screenshot({path:evidence+'/failure.png',fullPage:true})}throw e}finally{await browser.close()}

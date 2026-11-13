// Real CheckInPage -> real command flow -> real Visit HTTP adapter. Only the
// canonical projection and loopback HTTP responses are synthetic; no backend runs.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE)
const url=process.env.STAFF_A8_URL||'http://127.0.0.1:5194/tests/fixtures/staff-workflow-a8.html'
const browser=await chromium.launch({headless:true,channel:'chrome'}),results=[]
try {
 for(const width of [390,1440]){
  async function check(name,run){
   if(process.env.QA_CASE&&!name.includes(process.env.QA_CASE))return
   const p=await browser.newPage({viewport:{width,height:1000},hasTouch:true}),posts=[],errors=[]
   let hold=false,held=[],outcome='validation'
   p.setDefaultTimeout(6000);p.on('pageerror',e=>errors.push(e.message))
   await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort())
   await p.route('**/api/**',r=>r.fulfill({status:403,json:{message:'Synthetic ancillary read unavailable'}}))
   await p.route('**/sanctum/csrf-cookie',r=>r.fulfill({status:204}))
   const respond=r=>outcome==='network'?r.abort():r.fulfill({status:outcome==='success'?201:422,json:outcome==='success'?{data:{id:'synthetic-visit',queue:{queue_number:1}}}:{message:'Synthetic arrival refused'}})
   await p.route('**/api/visits/check-in',async r=>{
    posts.push({body:r.request().postDataJSON(),key:r.request().headers()['idempotency-key']})
    if(hold)await new Promise(resolve=>held.push(resolve))
    await respond(r)
   })
   const button=()=>p.getByRole('button',{name:'Confirm arrival',exact:true}),id=()=>p.getByRole('checkbox',{name:'Valid ID presented',exact:true})
   const sent=async count=>{const deadline=Date.now()+6000;while(posts.length<count&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));assert.equal(posts.length,count,'wait for the intercepted mutation, not a fixed delay')}
   const idle=()=>p.waitForFunction(()=>{const b=document.querySelector('.arrival-action button');return !b||!b.disabled})
   const release=()=>{hold=false;for(const r of held.splice(0))r()}
   try{
    await p.goto(url);await p.waitForFunction(()=>window.fixture)
    await p.getByRole('button',{name:'Check in',exact:true}).click()
    assert.equal(posts.length,0,'shortcut navigation never admits')
    await id().check()
    await p.evaluate(async()=>{
     const f=window.fixture,{createAppointmentFlow}=await import('/src/appointment-flow.js')
     window.dispatchContext={state:f.state,session:f.store.session,generation:1}
     const flow=createAppointmentFlow({getState:()=>window.dispatchContext.state,getSession:()=>window.dispatchContext.session,getAuthGeneration:()=>window.dispatchContext.generation,getActions:()=>({}),refresh:async()=>({ok:true})});window.checkInSettled=0
     window.checkInDispatch=async(...args)=>{try{return await flow.checkIn(...args)}finally{window.checkInSettled++}}
    })
    await run({p,posts,button,id,idle,sent,hold:()=>{hold=true},release,outcome:v=>{outcome=v}})
    assert.deepEqual(errors,[]);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
    results.push({width,name,posts});console.log('PASS '+width+' '+name)
   }finally{release();await p.close()}
  }
  for(const change of ['revision','patient','branch','permissions','eligibility','auth','Dentist','service'])await check('unseen '+change+' refuses POST',async({p,posts,button})=>{
   await p.evaluate(change=>{
    const c=window.dispatchContext,a={...c.state.appointments[0]},session={...c.session};let state={...c.state}
    if(change==='revision')a.revision++
    if(change==='patient'){a.patientId='replacement';a.patientPublicId='replacement'}
    if(change==='branch')a.branchId='b2'
    if(change==='permissions')state.users=state.users.map(u=>({...u,permissions:['appointments']}))
    if(change==='eligibility')a.status='Cancelled'
    if(change==='auth')c.generation++
    if(change==='Dentist')a.dentistId='replacement'
    if(change==='service')a.serviceId='replacement'
    state.appointments=[a];c.state=state;c.session=session
    document.querySelector('.arrival-action button').click()
   },change)
   await p.waitForFunction(()=>{const b=document.querySelector('.arrival-action button');return !b||!b.disabled})
   assert.deepEqual(posts,[],'stale confirmation never reaches the mutation adapter')
   if(change!=='auth')await p.locator('.notice').filter({hasText:'Refresh, review and confirm'}).waitFor()
   assert.equal(await p.getByText(/Arrival recorded/).count(),0)
  })
  for(const activation of ['keyboard','touch'])await check('unchanged '+activation+' sends observed payload',async({p,posts,button,idle})=>{
   if(activation==='keyboard'){await button().focus();await button().press('Enter')}else await button().tap()
   await p.locator('.notice').filter({hasText:'Synthetic arrival refused'}).waitFor();await idle()
   assert.equal(posts.length,1);assert.deepEqual(posts[0].body,{appointment_id:'appt1',expected_revision:1});assert.ok(posts[0].key)
  })
  await check('ordinary Check-In permission and manual selection',async({p,posts,button,id})=>{
   await p.evaluate(()=>{window.fixture.state.users[0].permissions=['checkin'];window.dispatchContext.state=window.fixture.state;window.fixture.navigate('checkin')})
   const select=p.getByRole('combobox',{name:/^Today.s appointment/});await p.waitForFunction(()=>document.querySelector('.checkin-select-row select').value==='')
   await select.selectOption('appt1');await id().check();await button().focus();await button().press('Enter')
   await p.locator('.notice').filter({hasText:'Synthetic arrival refused'}).waitFor();assert.equal(posts.length,1);assert.deepEqual(posts[0].body,{appointment_id:'appt1',expected_revision:1})
  })
  await check('successful reviewed arrival clears only its own selection',async({p,posts,button,outcome})=>{
   outcome('success');await button().click();await p.locator('#feedback').filter({hasText:'Arrival recorded'}).waitFor()
   assert.equal(posts.length,1);assert.deepEqual(posts[0].body,{appointment_id:'appt1',expected_revision:1});assert.equal(await p.getByRole('combobox',{name:/^Today.s appointment/}).inputValue(),'');assert.equal(await p.locator('.notice').filter({hasText:'selected appointment changed'}).count(),0)
  })
  await check('unchanged retry preserves key and body',async({p,posts,button,idle})=>{
   await button().click();await p.locator('.notice').filter({hasText:'Synthetic arrival refused'}).waitFor();await idle();await button().click();await idle()
   assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1])
  })
  await check('explicit new review permits revision 2',async({p,posts,button,id})=>{
   await p.evaluate(()=>{const c=window.dispatchContext;c.state={...c.state,appointments:[{...c.state.appointments[0],revision:2}]};document.querySelector('.arrival-action button').click()})
   await p.locator('.notice').filter({hasText:'Refresh, review and confirm'}).waitFor();assert.equal(posts.length,0)
   await p.evaluate(()=>{window.fixture.state.appointments=window.dispatchContext.state.appointments;window.dispatchContext.state=window.fixture.state;window.fixture.refreshUI()})
   const select=p.getByRole('combobox',{name:/^Today.s appointment/});assert.equal(await select.inputValue(),'')
   await select.selectOption('appt1');assert.equal(await id().isChecked(),false);await id().check();await button().click()
   await p.locator('.notice').filter({hasText:'Synthetic arrival refused'}).waitFor();assert.equal(posts.length,1);assert.equal(posts[0].body.expected_revision,2)
  })
  await check('duplicate confirmation dispatches once',async({p,posts,button,hold,release,idle,sent})=>{
   hold();await button().evaluate(e=>{e.click();e.click();e.click()});await sent(1);assert.equal(posts.length,1);assert.equal(await p.locator('.arrival-action button').first().isDisabled(),true);release();await idle();assert.equal(posts.length,1)
  })
  await check('late response cannot clear a newer selected task',async({p,posts,button,hold,release,outcome,idle,id,sent})=>{
   hold();outcome('success');await button().click();await sent(1);assert.equal(posts.length,1)
   await p.evaluate(async()=>{const f=window.fixture,{checkInNavigationFor}=await import('/src/checkin-navigation.js'),a=f.state.appointments[0],patient=f.state.patients[1];const next={...a,id:'appt2',patientId:patient.id,patientPublicId:patient.publicId};f.state.appointments=[a,next];window.dispatchContext.state=f.state;f.navigate('checkin',{checkIn:checkInNavigationFor(f.store,next)})})
   const select=p.getByRole('combobox',{name:/^Today.s appointment/});await p.waitForFunction(()=>document.querySelector('.checkin-select-row select').value==='appt2');release();await idle()
   assert.equal(await select.inputValue(),'appt2');assert.equal(await id().isChecked(),false);assert.equal(await p.getByText(/Arrival recorded/).count(),0);assert.equal(posts.length,1)
  })
  await check('unmount suppresses old success feedback',async({p,posts,button,hold,release,outcome,sent})=>{
   hold();outcome('success');await button().click();await sent(1);assert.equal(posts.length,1);await p.evaluate(()=>window.fixture.navigate('appointments'));release();await p.waitForFunction(()=>window.checkInSettled===1)
   assert.equal(await p.locator('#feedback').textContent(),'');assert.equal(await p.getByText(/Arrival recorded/).count(),0)
  })
  await check('replacement auth suppresses old success feedback',async({p,posts,button,hold,release,outcome,idle,sent})=>{
   hold();outcome('success');await button().click();await sent(1);assert.equal(posts.length,1);await p.evaluate(()=>window.dispatchContext.generation++);release();await idle()
   assert.equal(await p.locator('#feedback').textContent(),'');assert.equal(await p.getByText(/Arrival recorded/).count(),0)
  })
  await check('unknown outcome keeps selection and same-key retry',async({p,posts,button,outcome,idle})=>{
   outcome('network');await button().click();await idle();assert.equal(posts.length,1);assert.equal(await p.getByText(/Arrival recorded/).count(),0)
   outcome('validation');await button().click();await idle();assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1])
  })
 }
 if(process.env.QA_EVIDENCE_DIR){await mkdir(process.env.QA_EVIDENCE_DIR,{recursive:true});await writeFile(process.env.QA_EVIDENCE_DIR+'/race-browser-results.json',JSON.stringify(results,null,2))}
 console.log(JSON.stringify({passed:results.length,results},null,2))
}finally{await browser.close()}

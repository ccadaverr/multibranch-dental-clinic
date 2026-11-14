import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {mkdir,writeFile} from 'node:fs/promises'

// Synthetic form -> real shared flow -> real adapter -> intercepted cookie/CSRF transport.
// This fixture is deliberately separate from ServerFollowups and never contacts Laravel or PostgreSQL.
export async function runSelectedFollowupAcceptance(page,base,evidenceDir){
  const results=[],errors=[]
  page.setDefaultTimeout(7000)
  page.on('pageerror',error=>errors.push(error.message))
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  const fresh=async config=>{
    await page.goto(base+'/tests/fixtures/aud10-shared-booking.html')
    await page.waitForFunction(()=>window.aud10?.configure)
    if(config)await page.evaluate(value=>window.aud10.configure(value),config)
  }
  const choose=()=>page.getByRole('button',{name:'10:00 AM',exact:true}).click()
  const submit=()=>page.getByRole('button',{name:'Confirm appointment',exact:true})
  const retry=()=>page.getByRole('button',{name:'Retry the same booking',exact:true})
  const unknown=()=>page.getByRole('alert').filter({hasText:'booking outcome could not be verified'})
  const release=index=>page.evaluate(i=>window.aud10.requests[i].release(),index)
  const run=async(name,work)=>{
    try{await work();results.push({name,pass:true})}
    catch(error){results.push({name,pass:false,error:error.message})}
  }
  for(const width of [375,430,768,1024,1440])await run('protected draft, keyboard same-command retry and verified proof at '+width,async()=>{
    await page.setViewportSize({width,height:1000});await fresh();await choose()
    await page.getByRole('textbox',{name:'Notes',exact:true}).fill('Synthetic retained draft')
    const storage=await page.evaluate(()=>({local:JSON.stringify(localStorage),session:JSON.stringify(sessionStorage)}))
    await page.evaluate(()=>{window.aud10.mode='network'})
    await submit().evaluate(button=>{button.click();button.click();button.form.requestSubmit()})
    await page.waitForFunction(()=>window.aud10.requests.length===1)
    assert.equal(await page.locator('form').getAttribute('aria-busy'),'true')
    assert.equal(await page.getByRole('textbox',{name:'Notes',exact:true}).isDisabled(),true)
    const first=await page.evaluate(()=>window.aud10.requests[0])
    assert.equal(first.body.followup_task_id,await page.evaluate(()=>window.aud10.ids.B))
    assert.equal(first.body.followup_expected_revision,7)
    assert.equal(first.credentials,'include');assert.equal(first.csrf,'synthetic-csrf')
    await release(0);await unknown().waitFor()
    assert.equal(await page.getByRole('textbox',{name:'Notes',exact:true}).inputValue(),'Synthetic retained draft')
    assert.equal(await page.getByRole('textbox',{name:'Notes',exact:true}).isDisabled(),true)
    assert.equal(await unknown().evaluate(el=>el===document.activeElement),true)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'page overflow')
    await page.screenshot({path:evidenceDir+'/unknown-'+width+'.png',fullPage:true})
    await page.evaluate(()=>{window.aud10.mode='valid'})
    await retry().focus();await page.keyboard.press('Enter')
    await page.waitForFunction(()=>window.aud10.requests.length===2)
    await page.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit()})
    assert.equal(await page.evaluate(()=>window.aud10.requests.length),2)
    const second=await page.evaluate(()=>window.aud10.requests[1])
    assert.equal(second.key,first.key);assert.deepEqual(second.body,first.body)
    await release(1);await page.waitForFunction(()=>window.aud10.saved.length===1)
    assert.equal(await page.evaluate(()=>window.aud10.saved[0].proof.followupLink.task_id),first.body.followup_task_id)
    assert.equal(await page.evaluate(()=>window.aud10.saved[0].record.id),await page.evaluate(()=>window.aud10.ids.AP))
    assert.equal(await page.evaluate(()=>window.aud10.events.length),0)
    assert.equal(await submit().isDisabled(),true)
    await release(1);await settle();assert.equal(await page.evaluate(()=>window.aud10.saved.length),1)
    assert.deepEqual(await page.evaluate(()=>({local:JSON.stringify(localStorage),session:JSON.stringify(sessionStorage)})),storage)
    await page.screenshot({path:evidenceDir+'/verified-'+width+'.png',fullPage:true})
    await fresh();await choose()
    await page.evaluate(()=>Object.assign(window.aud10,{mode:'refusal',refusalStatus:409,refusalCode:'followup_conflict'}))
    await submit().click();await page.waitForFunction(()=>window.aud10.requests.length===1);await release(0)
    const refused=page.getByRole('alert').filter({hasText:'selected follow-up changed'})
    await refused.waitFor();assert.equal(await refused.evaluate(el=>el===document.activeElement),true)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'refusal overflow')
    assert.equal(await submit().isDisabled(),true)
    await page.screenshot({path:evidenceDir+'/refused-'+width+'.png',fullPage:true})
  })
  for(const mode of ['missing-proof','wrong-task','wrong-appointment','wrong-status','wrong-revision','wrong-patient','wrong-branch'])await run('unverified successful response retains recovery: '+mode,async()=>{
    await fresh();await choose();await page.evaluate(value=>{window.aud10.mode=value},mode)
    await submit().click();await page.waitForFunction(()=>window.aud10.requests.length===1);await release(0);await unknown().waitFor()
    assert.deepEqual(await page.evaluate(()=>window.aud10.saved),[]);assert.deepEqual(await page.evaluate(()=>window.aud10.feedback),[])
    assert.equal(await retry().isEnabled(),true);assert.equal(await page.getByRole('textbox',{name:'Notes',exact:true}).isDisabled(),true)
  })
  await run('verified creation survives a failed appointment refresh',async()=>{
    await fresh();await choose();await page.evaluate(()=>{window.aud10.refreshFail=true})
    await submit().click();await page.waitForFunction(()=>window.aud10.requests.length===1);await release(0)
    await page.waitForFunction(()=>window.aud10.saved.length===1)
    assert.equal(await page.evaluate(()=>window.aud10.requests.length),1)
    assert.equal(await page.evaluate(()=>window.aud10.feedback.filter(([,tone])=>tone==='success').length),1)
    assert.ok(await page.evaluate(()=>window.aud10.feedback.some(([text])=>text.includes('list could not be refreshed'))))
    assert.equal(await retry().count(),0)
  })
  for(const [name,config] of [['unverified backend',{gate:false}],['null selection',{selection:null}],['incomplete selection',{selection:{taskId:'123'}}]])await run('fail-closed selected interface: '+name,async()=>{
    await fresh(config)
    await page.getByRole('status').filter({hasText:'Selected follow-up booking unavailable'}).waitFor()
    assert.equal(await page.locator('form').count(),0);assert.equal(await page.evaluate(()=>window.aud10.requests.length),0)
  })
  await run('Owner cannot enter selected-task mode',async()=>{
    await fresh();await page.evaluate(()=>window.aud10.setSession({role:'owner'}))
    await page.getByRole('status').filter({hasText:'Selected follow-up booking unavailable'}).waitFor()
    assert.equal(await page.evaluate(()=>window.aud10.requests.length),0)
  })
  await run('definite scheduling refusal requires deliberate review before a new command',async()=>{
    await fresh();await choose();await page.evaluate(()=>{window.aud10.mode='refusal'})
    await submit().click();await page.waitForFunction(()=>window.aud10.requests.length===1);await release(0)
    await page.getByRole('alert').filter({hasText:'Synthetic scheduling refusal'}).waitFor()
    assert.equal(await submit().isDisabled(),true)
    await page.getByRole('button',{name:'Review booking details',exact:true}).click()
    await page.getByRole('textbox',{name:'Notes',exact:true}).fill('Synthetic deliberately revised draft')
    await page.evaluate(()=>{window.aud10.mode='valid'});await submit().click()
    await page.waitForFunction(()=>window.aud10.requests.length===2)
    assert.equal(await page.evaluate(()=>window.aud10.requests[0].key!==window.aud10.requests[1].key),true)
    await release(1);await page.waitForFunction(()=>window.aud10.saved.length===1)
  })
  for(const [status,code] of [[409,'followup_conflict'],[404,'synthetic'],[403,'synthetic'],[401,'synthetic'],[422,'idempotency_key_reused']])await run('refusal preserves context and never rotates automatically: '+status+'/'+code,async()=>{
    await fresh();await choose();await page.evaluate(({status,code})=>{Object.assign(window.aud10,{mode:'refusal',refusalStatus:status,refusalCode:code})},{status,code})
    await submit().click();await page.waitForFunction(()=>window.aud10.requests.length===1);await release(0)
    await page.getByRole('alert').waitFor();assert.equal(await submit().isDisabled(),true)
    assert.equal(await page.getByRole('button',{name:'Review booking details',exact:true}).count(),0)
    assert.equal(await page.evaluate(()=>window.aud10.requests.length),1);assert.deepEqual(await page.evaluate(()=>window.aud10.saved),[])
    if(status===404)assert.doesNotMatch(await page.getByRole('alert').innerText(),/Synthetic scheduling refusal|01ARZ/)
  })
  await run('a refusal after uncertainty keeps same-command recovery locked',async()=>{
    await fresh();await choose();await page.evaluate(()=>{window.aud10.mode='network'})
    await submit().click();await page.waitForFunction(()=>window.aud10.requests.length===1);await release(0);await unknown().waitFor()
    await page.evaluate(()=>Object.assign(window.aud10,{mode:'refusal',refusalStatus:403}))
    await retry().click();await page.waitForFunction(()=>window.aud10.requests.length===2);await release(1);await unknown().waitFor()
    assert.equal(await page.getByRole('button',{name:'Review booking details',exact:true}).count(),0)
    assert.equal(await page.evaluate(()=>window.aud10.requests[0].key===window.aud10.requests[1].key),true)
    assert.deepEqual(await page.evaluate(()=>window.aud10.saved),[])
  })
  for(const change of ['auth-generation','account','branch','unmount','selection','A-B-A'])await run('obsolete '+change+' completion cannot close, notify or refresh',async()=>{
    await fresh();await choose();await submit().click();await page.waitForFunction(()=>window.aud10.requests.length===1)
    await page.evaluate(change=>{
      if(change==='auth-generation')window.aud10.auth++
      if(change==='account')window.aud10.setSession({serverUserId:'replacement'})
      if(change==='branch')window.aud10.setSession({scopeBranchId:'b2'})
      if(change==='unmount')window.aud10.configure({mounted:false})
      if(change==='selection')window.aud10.configure({selection:{taskId:window.aud10.ids.A,expectedRevision:7,patientPublicId:window.aud10.ids.P,branchId:'b1'}})
      if(change==='A-B-A'){
        window.aud10.configure({selection:{taskId:window.aud10.ids.A,expectedRevision:7,patientPublicId:window.aud10.ids.P,branchId:'b1'}})
        window.aud10.configure({selection:{taskId:window.aud10.ids.B,expectedRevision:7,patientPublicId:window.aud10.ids.P,branchId:'b1'}})
      }
    },change)
    await settle();await release(0);await settle()
    assert.deepEqual(await page.evaluate(()=>window.aud10.saved),[]);assert.deepEqual(await page.evaluate(()=>window.aud10.feedback),[])
    assert.equal(await page.evaluate(()=>window.aud10.refreshes),0)
  })
  await run('ordinary Patient-record/calendar prefill stays ordinary through the shared form',async()=>{
    await fresh({selected:false});await choose();await submit().click();await page.waitForFunction(()=>window.aud10.requests.length===1)
    const body=await page.evaluate(()=>window.aud10.requests[0].body)
    assert.equal('followup_task_id' in body,false);assert.equal('followup_expected_revision' in body,false)
    await release(0);await page.waitForFunction(()=>window.aud10.saved.length===1)
    assert.equal(await page.evaluate(()=>window.aud10.feedback.some(([text])=>text==='Appointment confirmed.')),true)
  })
  await run('ordinary Owner booking retains the ordinary result and request',async()=>{
    await fresh({selected:false});await page.evaluate(()=>window.aud10.setSession({role:'owner'}));await choose()
    await submit().click();await page.waitForFunction(()=>window.aud10.requests.length===1);await release(0)
    await page.waitForFunction(()=>window.aud10.saved.length===1)
    assert.equal(await page.evaluate(()=>'followup_task_id' in window.aud10.requests[0].body),false)
  })
  await run('ordinary date-only calendar prefill retains Patient and service selection',async()=>{
    await fresh({selected:false,prefill:{date:'2026-11-20'}})
    await page.getByRole('combobox',{name:'Patient',exact:true}).selectOption(await page.evaluate(()=>window.aud10.ids.P))
    await page.getByRole('combobox',{name:'Service',exact:true}).selectOption('svc1');await choose()
    await submit().click();await page.waitForFunction(()=>window.aud10.requests.length===1);await release(0)
    await page.waitForFunction(()=>window.aud10.saved.length===1)
    assert.equal(await page.evaluate(()=>'followup_task_id' in window.aud10.requests[0].body),false)
  })
  assert.deepEqual(errors,[],'browser runtime errors')
  return {synthetic:true,liveBackend:false,database:false,widths:[375,430,768,1024,1440],results,errors}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const base=process.env.AUD10_FIXTURE_BASE||'http://127.0.0.1:5193'
  const evidenceDir=process.env.AUD10_EVIDENCE_DIR||'/private/tmp/aud10-fe-shared-browser'
  await mkdir(evidenceDir,{recursive:true})
  const modulePath=process.env.AUD10_PLAYWRIGHT_MODULE||'playwright'
  const {chromium}=await import(modulePath)
  const browser=await chromium.launch({headless:true,executablePath:process.env.AUD10_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
  try{
    const page=await browser.newPage()
    await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort())
    const result=await runSelectedFollowupAcceptance(page,base,evidenceDir)
    await writeFile(evidenceDir+'/browser-results.json',JSON.stringify(result,null,2)+'\n')
    console.log(JSON.stringify({passed:result.results.filter(r=>r.pass).length,failed:result.results.filter(r=>!r.pass),synthetic:true}))
    if(result.results.some(r=>!r.pass))process.exitCode=1
  }finally{await browser.close()}
}

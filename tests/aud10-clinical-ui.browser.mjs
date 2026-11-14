import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'

// Actual clinical page, Modal, shared AppointmentForm and HTTP read adapters; intercepted responses only.
export async function runClinicalAcceptance(page,base,evidence){
  const results=[],errors=[]
  page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message))
  const fresh=async()=>{await page.goto(base+'/tests/fixtures/aud10-clinical-ui.html');await page.getByRole('button',{name:'Book follow-up',exact:true}).first().waitFor()}
  const row=()=>page.locator('.fd-list > li').nth(1)
  const book=()=>row().getByRole('button',{name:'Book follow-up',exact:true})
  const read=()=>row().getByRole('button',{name:'Review current task',exact:true})
  const run=async(name,work)=>{try{await work();results.push({name,pass:true})}catch(e){results.push({name,pass:false,error:e.message})}console.log((results.at(-1).pass?'PASS ':'FAIL ')+name);await writeFile(evidence+'/progress.json',JSON.stringify(results,null,2)+'\n')}
  const noPost=async()=>{assert.equal(await page.evaluate(()=>window.clinical.posts.length),0);assert.deepEqual(await page.evaluate(()=>window.clinical.unexpected),[])}
  for(const width of [375,430,768,1024,1440])await run('actual non-oldest B row, unavailable gate and keyboard close at '+width,async()=>{
    await page.setViewportSize({width,height:1000});await fresh()
    assert.deepEqual(await page.locator('.fd-list').evaluate(el=>({display:getComputedStyle(el).display,list:getComputedStyle(el).listStyleType})),{display:'grid',list:'none'},'production Follow-ups CSS is applied')
    assert.equal(await page.evaluate(()=>performance.getEntriesByType('resource').some(r=>new URL(r.name).pathname==='/src/automations.css')),true,'Follow-ups stylesheet loaded')
    await book().focus();await page.keyboard.press('Enter')
    const dialog=page.getByRole('dialog');await dialog.waitFor()
    const text=await dialog.innerText()
    assert.match(text,/Selected patient: Synthetic patient • SYN-P/);assert.match(text,/Synthetic branch/);assert.match(text,/Synthetic service/);assert.match(text,/Nov 20/)
    assert.doesNotMatch(text,/Nov 13/)
    await dialog.getByText('Selected follow-up booking unavailable',{exact:true}).waitFor()
    assert.equal(await dialog.locator('form').count(),0)
    assert.equal(await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)),true)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'page overflow')
    assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'dialog overflow')
    await page.screenshot({path:evidence+'/closed-gate-'+width+'.png',fullPage:true})
    await noPost();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'})
    assert.equal(await book().evaluate(el=>document.activeElement===el),true,'focus returns to selected row')
    await page.getByText('Unverified earlier booking?',{exact:true}).waitFor();await noPost()
    await page.evaluate(()=>{const c=window.clinical;c.reviewResult={data:[{...c.rows[1],status:'Booked',revision:7,appointment:{id:c.ids.AP,code:'CONTRADICTORY-LINK',when:'date'}}]}})
    await read().click();const unverified=row().getByRole('alert').filter({hasText:'The current task could not be verified'})
    await unverified.waitFor();assert.equal(await unverified.isVisible(),true)
    assert.equal(await unverified.evaluate(el=>document.activeElement===el),true,'unverified read feedback receives focus')
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'unverified feedback overflow')
    assert.equal(await page.getByText(/CONTRADICTORY-LINK/).count(),0);await noPost()
    await page.screenshot({path:evidence+'/unverified-read-'+width+'.png',fullPage:true})
  })
  for(const status of ['Open','Contacted'])await run('eligible '+status+' retains exact B selection without fallback',async()=>{
    await fresh();await page.evaluate(status=>{const c=window.clinical;c.rows[1]={...c.rows[1],status,revision:8};c.rerender()},status)
    // Reload list projections through the real page filter.
    await page.getByRole('combobox',{name:'Status',exact:true}).selectOption(status)
    await book().click();await page.getByRole('dialog').getByText('Selected follow-up booking unavailable',{exact:true}).waitFor();await noPost()
  })
  for(const status of ['Closed','Booked'])await run(status+' exposes no Book follow-up action',async()=>{
    await fresh();await page.evaluate(status=>{const c=window.clinical;c.rows[1]={...c.rows[1],status,revision:8,can_book:false,appointment:status==='Booked'?{id:c.ids.AP,code:'SYN-APT-B',when:'2026-11-20'}:null};c.rerender()},status)
    await page.getByRole('combobox',{name:'Status',exact:true}).selectOption(status)
    await row().getByText(status,{exact:true}).waitFor();assert.equal(await book().count(),0);await noPost()
  })
  for(const mode of ['bigint','branch','permission'])await run('selection fails closed: '+mode,async()=>{
    await fresh();await page.evaluate(mode=>{const c=window.clinical;if(mode==='bigint')c.rows[1].id='123';if(mode==='branch')c.rows[1].branch.id='b2';if(mode==='permission')c.configure({permission:false});c.rerender()},mode)
    if(mode!=='permission')await page.getByRole('combobox',{name:'Due',exact:true}).selectOption('week')
    if(mode==='branch')await page.getByText(/The follow-up list did not match/).waitFor()
    else assert.equal(await book().isDisabled(),true)
    await noPost()
  })
  for(const role of ['owner','patient','dentist'])await run('no selected booking authority for '+role,async()=>{
    await fresh();await page.evaluate(role=>window.clinical.setSession({role}),role)
    await page.waitForFunction(()=>document.querySelectorAll('.fd-list button').length===0||![...document.querySelectorAll('button')].some(b=>b.textContent==='Book follow-up'))
    assert.equal(await page.getByRole('button',{name:'Book follow-up',exact:true}).count(),0);await noPost()
  })
  for(const width of [375,1440])await run('current Booked relationship is not a command receipt at '+width,async()=>{
    await page.setViewportSize({width,height:1000});await fresh()
    await page.evaluate(()=>{const c=window.clinical;c.reviewResult={data:[{...c.rows[1],status:'Booked',revision:8,appointment:{id:c.ids.AP,code:'SYN-APT-B',when:'2026-11-20'}}]}})
    await read().focus();await page.keyboard.press('Enter')
    const status=row().getByRole('status').filter({hasText:'Current task status: Booked'})
    await status.waitFor();assert.match(await status.innerText(),/SYN-APT-B/);assert.match(await status.innerText(),/does not verify the original booking command/)
    assert.equal(await status.evaluate(el=>document.activeElement===el),true)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
    assert.deepEqual(await page.evaluate(()=>window.clinical.feedback),[]);await noPost()
    await page.screenshot({path:evidence+'/current-link-'+width+'.png',fullPage:true})
  })
  for(const mode of ['absent','duplicate','wrongPatient','wrongBranch','stale','forbidden','network'])await run('bounded reconciliation remains unresolved: '+mode,async()=>{
    await fresh();await page.evaluate(mode=>{const c=window.clinical,t={...c.rows[1]};if(mode==='wrongPatient')t.patient={id:c.ids.A};if(mode==='wrongBranch')t.branch={id:'b2'};if(mode==='stale')t.revision=6;c.reviewResult={data:mode==='absent'?[]:mode==='duplicate'?[t,t]:[t]};c.reviewMode=mode},mode)
    await read().click();const alert=row().getByRole('alert');await alert.waitFor()
    assert.match(await alert.innerText(),/does not prove that an earlier booking failed/)
    assert.doesNotMatch(await alert.innerText(),/raw diagnostic/)
    assert.equal(await alert.evaluate(el=>el===document.activeElement),true);await noPost()
  })
  await run('unchanged Open read does not prove failure or launch a replacement',async()=>{
    await fresh();await read().click();await row().getByText(/No linked appointment is shown/).waitFor();await noPost()
  })
  for(const status of ['Contacted','Booked','Closed'])await run('unchanged revision cannot adopt Open to '+status,async()=>{
    await fresh();await page.evaluate(status=>{const c=window.clinical;c.reviewResult={data:[{...c.rows[1],status,revision:7,appointment:status==='Booked'?{id:c.ids.AP,code:'CONTRADICTORY-LINK',when:'date'}:null}]}},status)
    await read().click();await row().getByRole('alert').filter({hasText:'The current task could not be verified'}).waitFor()
    assert.equal(await row().getByText(new RegExp('Current task status: '+status)).count(),0)
    assert.equal(await page.getByText(/CONTRADICTORY-LINK/).count(),0);assert.deepEqual(await page.evaluate(()=>window.clinical.feedback),[]);await noPost()
  })
  for(const status of ['Contacted','Closed'])await run('advanced revision recognizes current '+status+' without booking success',async()=>{
    await fresh();await page.evaluate(status=>{const c=window.clinical;c.reviewResult={data:[{...c.rows[1],status,revision:8}]}},status)
    await read().click();await row().getByText(new RegExp('Current task status: '+status)).waitFor()
    assert.equal(await book().isDisabled(),true,'older row must be reloaded, not rebased')
    assert.deepEqual(await page.evaluate(()=>window.clinical.feedback),[]);await noPost()
  })
  await run('repeated readbacks cannot regress newer continuity or silently rebase the task',async()=>{
    await fresh()
    for(const [revision,status,accepted] of [[8,'Booked',true],[7,'Open',false],[8,'Closed',false],[8,'Booked',true],[9,'Closed',true]]){
      await page.evaluate(({revision,status})=>{const c=window.clinical;c.reviewResult={data:[{...c.rows[1],revision,status,appointment:status==='Booked'?{id:c.ids.AP,code:'CURRENT-LINK',when:'date'}:null}]}},{revision,status})
      await read().click()
      if(accepted)await row().getByText(new RegExp('Current task status: '+status)).waitFor()
      else await row().getByRole('alert').filter({hasText:'The current task could not be verified'}).waitFor()
      assert.equal(await book().isDisabled(),true);await noPost()
    }
    assert.deepEqual(await page.evaluate(()=>window.clinical.feedback),[])
    // A filter reload must not replace the accepted revision with the stale fixture row.
    await page.getByRole('combobox',{name:'Due',exact:true}).selectOption('week')
    await page.getByText(/The follow-up list did not match/).waitFor();await noPost()
  })
  await run('a newer continuity snapshot during a pending read prevents obsolete adoption',async()=>{
    await fresh();await page.evaluate(()=>{const c=window.clinical;c.holdReview=true;c.reviewResult={data:[{...c.rows[1],revision:8,status:'Booked',appointment:{id:c.ids.AP,code:'OUTDATED-READ',when:'date'}}]}})
    await read().click();await page.waitForFunction(()=>!!window.clinical.releaseReview)
    await row().evaluate(el=>{
      // Simulate the existing shared guard observing a newer server snapshot in another surface.
      let fiber=el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))]
      while(fiber&&!fiber.memoizedProps?.pendingTasks)fiber=fiber.return
      const c=window.clinical
      if(!fiber)throw Error('Follow-up continuity guard not found')
      fiber.memoizedProps.pendingTasks.verified.set(c.ids.B,{patientId:c.ids.P,branchId:'b1',revision:9,status:'Booked'})
      c.releaseReview()
    })
    await row().getByRole('alert').filter({hasText:'The current task could not be verified'}).waitFor()
    assert.equal(await page.getByText(/OUTDATED-READ/).count(),0);assert.deepEqual(await page.evaluate(()=>window.clinical.feedback),[]);await noPost()
  })
  await run('same-tick duplicate read is guarded and pending feedback is perceivable',async()=>{
    await fresh();await page.evaluate(()=>{window.clinical.holdReview=true})
    await read().evaluate(b=>{b.click();b.click()})
    await row().getByRole('status').filter({hasText:'Loading current follow-up state'}).waitFor()
    assert.equal(await page.evaluate(()=>window.clinical.requests.filter(r=>r.path.includes('/patients/')).length),1)
    await page.evaluate(()=>window.clinical.releaseReview());await row().getByText(/Current task status: Open/).waitFor();await noPost()
  })
  for(const mode of ['auth','account','branch','permission','permission-cycle','unmount'])await run('obsolete read cannot adopt a response after '+mode,async()=>{
    await fresh();await page.evaluate(()=>{const c=window.clinical;c.holdReview=true;c.reviewResult={data:[{...c.rows[1],status:'Booked',revision:8,appointment:{id:c.ids.AP,code:'OBSOLETE-LINK',when:'2026-11-20'}}]}})
    await read().click();await page.waitForFunction(()=>!!window.clinical.releaseReview)
    await page.evaluate(mode=>{const c=window.clinical;if(mode==='auth'){c.auth++;c.rerender()}if(mode==='account')c.setSession({userId:'other'});if(mode==='branch')c.setSession({branchId:'b2',branchScopes:['b2']});if(mode==='permission'||mode==='permission-cycle')c.configure({permission:false});if(mode==='permission-cycle')c.configure({permission:true});if(mode==='unmount')c.configure({mounted:false});c.releaseReview()},mode)
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
    assert.equal(await page.getByText(/OBSOLETE-LINK/).count(),0);assert.deepEqual(await page.evaluate(()=>window.clinical.feedback),[]);await noPost()
  })
  await run('remount and reload keep an explicit recovery limitation without storing commands',async()=>{
    await fresh();const before=await page.evaluate(()=>[JSON.stringify(localStorage),JSON.stringify(sessionStorage)])
    await book().click();await page.keyboard.press('Escape')
    await page.evaluate(()=>window.clinical.configure({mounted:false}));await page.evaluate(()=>window.clinical.configure({mounted:true}))
    await page.getByText('Unverified earlier booking?',{exact:true}).waitFor()
    await page.reload();await page.getByText('Unverified earlier booking?',{exact:true}).waitFor()
    assert.deepEqual(await page.evaluate(()=>[JSON.stringify(localStorage),JSON.stringify(sessionStorage)]),before);await noPost()
  })
  await run('existing Contacted and Close actions still use the clinical task command',async()=>{
    await fresh();await row().getByRole('button',{name:'Contacted',exact:true}).click()
    await row().getByText('Contacted',{exact:true}).waitFor()
    await row().getByRole('button',{name:'Close',exact:true}).click()
    await row().getByRole('textbox',{name:'Why is it closed without a booking?',exact:true}).fill('Synthetic closure note')
    await row().getByRole('button',{name:'Close it',exact:true}).click();await row().getByText('Closed',{exact:true}).first().waitFor()
    const writes=await page.evaluate(()=>window.clinical.requests.filter(r=>r.method==='PATCH'))
    assert.equal(writes.length,2);assert.equal(writes[0].path.endsWith(await page.evaluate(()=>window.clinical.ids.B)),true)
    assert.equal(writes[0].credentials,'include');await noPost()
  })
  assert.deepEqual(errors,[],'browser runtime errors')
  return {synthetic:true,liveBackend:false,database:false,widths:[375,430,768,1024,1440],results,errors,blocked:['Activated clinical-row POST, pending/unknown/retry/conflict/verified creation: no trustworthy deployment gate','Navigation guard for an active unresolved booking: shared lifecycle interface requires separate scope review']}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const base=process.env.AUD10_FIXTURE_BASE||'http://127.0.0.1:5194',evidence=process.env.AUD10_EVIDENCE_DIR||'/private/tmp/aud10-clinical-browser'
  await mkdir(evidence,{recursive:true})
  const {chromium}=await import(process.env.AUD10_PLAYWRIGHT_MODULE||'playwright')
  const browser=await chromium.launch({headless:true,executablePath:process.env.AUD10_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
  try{const page=await browser.newPage();await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());const result=await runClinicalAcceptance(page,base,evidence);await writeFile(evidence+'/browser-results.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.results.filter(r=>r.pass).length,failed:result.results.filter(r=>!r.pass),synthetic:true}));if(result.results.some(r=>!r.pass))process.exitCode=1}finally{await browser.close()}
}
